// Package cloudprovider implements a generic HTTP adapter for cloud transcription APIs.
// Any provider (AssemblyAI, Deepgram, etc.) is described by a ProviderConfig containing
// two function values — Upload and Poll — which encapsulate all provider-specific HTTP
// logic. The GenericHTTPAdapter drives the TranscriptionAdapter interface and handles
// the shared orchestration: key resolution, upload, optional polling loop, and context
// cancellation.
package cloudprovider

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"scriberr/internal/transcription/adapters"
	"scriberr/internal/transcription/interfaces"
	"scriberr/pkg/logger"
)

const (
	defaultPollInterval = 3 * time.Second
	defaultMaxPollTime  = 30 * time.Minute
	httpClientTimeout   = 15 * time.Minute
)

// UploadFunc submits audio to a provider and returns either a job ID (async) or an
// immediate TranscriptResult (sync). Exactly one of jobID and result will be non-zero.
//
//   - Sync providers: return ("", result, nil)
//   - Async providers: return (jobID, nil, nil)
type UploadFunc func(
	ctx    context.Context,
	client *http.Client,
	input  interfaces.AudioInput,
	params map[string]interface{},
	apiKey string,
) (jobID string, result *interfaces.TranscriptResult, err error)

// PollFunc checks the status of an async transcription job.
//
//   - Still processing: return (nil, nil)
//   - Completed:        return (result, nil)
//   - Terminal failure: return (nil, err)
type PollFunc func(
	ctx    context.Context,
	client *http.Client,
	jobID  string,
	params map[string]interface{},
	apiKey string,
) (result *interfaces.TranscriptResult, err error)

// ProviderConfig fully describes a cloud transcription provider.
// Only Upload is required; Poll may be nil for synchronous providers.
type ProviderConfig struct {
	// Identity
	ProviderID  string
	DisplayName string

	// Auth — how to authenticate requests.
	// The final header value is AuthValuePrefix + apiKey.
	// Examples:
	//   AssemblyAI: AuthHeaderName="Authorization", AuthValuePrefix=""
	//   Deepgram:   AuthHeaderName="Authorization", AuthValuePrefix="Token "
	//   OpenAI:     AuthHeaderName="Authorization", AuthValuePrefix="Bearer "
	AuthHeaderName  string
	AuthValuePrefix string

	// Async polling configuration (ignored for sync providers).
	PollInterval time.Duration // default: 3 s
	MaxPollTime  time.Duration // default: 30 min

	// HTTP functions — all provider-specific logic lives here.
	Upload UploadFunc
	Poll   PollFunc // nil = sync provider

	// Registry metadata
	Capabilities interfaces.ModelCapabilities
	Schema       []interfaces.ParameterSchema
}

// GenericHTTPAdapter implements interfaces.TranscriptionAdapter for any HTTP provider
// described by a ProviderConfig.
type GenericHTTPAdapter struct {
	*adapters.BaseAdapter
	cfg       ProviderConfig
	globalKey string
	client    *http.Client
}

// NewGenericHTTPAdapter constructs a GenericHTTPAdapter from a ProviderConfig and a
// global API key (typically read from an environment variable at startup). The per-job
// params map may override the key via the "api_key" field.
func NewGenericHTTPAdapter(cfg ProviderConfig, globalKey string) *GenericHTTPAdapter {
	base := adapters.NewBaseAdapter(cfg.ProviderID, "", cfg.Capabilities, cfg.Schema)
	return &GenericHTTPAdapter{
		BaseAdapter: base,
		cfg:         cfg,
		globalKey:   globalKey,
		client:      &http.Client{Timeout: httpClientTimeout},
	}
}

// GetSupportedModels satisfies TranscriptionAdapter.
func (a *GenericHTTPAdapter) GetSupportedModels() []string {
	return []string{a.cfg.ProviderID}
}

// PrepareEnvironment delegates to BaseAdapter (which sets initialized=true).
// No Python environment setup is needed for cloud adapters.
func (a *GenericHTTPAdapter) PrepareEnvironment(ctx context.Context) error {
	return a.BaseAdapter.PrepareEnvironment(ctx)
}

// IsReady returns true only when an API key is available (global or per-job).
func (a *GenericHTTPAdapter) IsReady(_ context.Context) bool {
	return a.resolveAPIKey(nil) != ""
}

// GetEstimatedProcessingTime for cloud providers: 5 % of audio duration + 10 s overhead.
func (a *GenericHTTPAdapter) GetEstimatedProcessingTime(input interfaces.AudioInput) time.Duration {
	d := input.Duration
	if d == 0 {
		return 15 * time.Second
	}
	return time.Duration(float64(d)*0.05) + 10*time.Second
}

// Transcribe implements interfaces.TranscriptionAdapter.
// It resolves the API key, calls cfg.Upload, then either returns the immediate result
// (sync) or enters a polling loop (async) that respects context cancellation.
//
//nolint:gocyclo
func (a *GenericHTTPAdapter) Transcribe(
	ctx context.Context,
	input interfaces.AudioInput,
	params map[string]interface{},
	procCtx interfaces.ProcessingContext,
) (*interfaces.TranscriptResult, error) {
	startTime := time.Now()
	a.LogProcessingStart(input, procCtx)

	apiKey := a.resolveAPIKey(params)
	if apiKey == "" {
		return nil, fmt.Errorf("%s: no API key configured — set the environment variable or provide api_key in job parameters", a.cfg.DisplayName)
	}

	if err := a.ValidateAudioInput(input); err != nil {
		return nil, fmt.Errorf("invalid audio input: %w", err)
	}

	logger.Info("Uploading audio to cloud provider",
		"provider", a.cfg.ProviderID,
		"job_id", procCtx.JobID,
		"file", input.FilePath)

	jobID, result, err := a.cfg.Upload(ctx, a.client, input, params, apiKey)
	if err != nil {
		return nil, fmt.Errorf("%s upload failed: %w", a.cfg.DisplayName, err)
	}

	if result != nil {
		// Synchronous provider returned an immediate result.
		result.ProcessingTime = time.Since(startTime)
		result.ModelUsed = a.cfg.ProviderID
		a.LogProcessingEnd(procCtx, result.ProcessingTime, nil)
		return result, nil
	}

	// Asynchronous provider: poll until complete.
	if a.cfg.Poll == nil {
		return nil, fmt.Errorf("%s: Upload returned a job ID but Poll is nil", a.cfg.DisplayName)
	}

	logger.Info("Polling cloud provider for result",
		"provider", a.cfg.ProviderID,
		"job_id", procCtx.JobID,
		"remote_id", jobID)

	result, err = a.poll(ctx, jobID, params, apiKey)
	if err != nil {
		a.LogProcessingEnd(procCtx, time.Since(startTime), err)
		return nil, err
	}

	result.ProcessingTime = time.Since(startTime)
	result.ModelUsed = a.cfg.ProviderID
	a.LogProcessingEnd(procCtx, result.ProcessingTime, nil)
	return result, nil
}

// poll drives the polling loop with configurable interval and deadline.
func (a *GenericHTTPAdapter) poll(
	ctx context.Context,
	jobID string,
	params map[string]interface{},
	apiKey string,
) (*interfaces.TranscriptResult, error) {
	interval := a.cfg.PollInterval
	if interval <= 0 {
		interval = defaultPollInterval
	}
	maxWait := a.cfg.MaxPollTime
	if maxWait <= 0 {
		maxWait = defaultMaxPollTime
	}

	deadline := time.Now().Add(maxWait)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("%s: context cancelled while polling job %s: %w", a.cfg.DisplayName, jobID, ctx.Err())

		case t := <-ticker.C:
			if t.After(deadline) {
				return nil, fmt.Errorf("%s: polling timed out after %v for job %s", a.cfg.DisplayName, maxWait, jobID)
			}

			result, err := a.cfg.Poll(ctx, a.client, jobID, params, apiKey)
			if err != nil {
				return nil, fmt.Errorf("%s poll error for job %s: %w", a.cfg.DisplayName, jobID, err)
			}
			if result != nil {
				return result, nil
			}
			// nil result means still processing — keep waiting.
			logger.Debug("Cloud provider still processing",
				"provider", a.cfg.ProviderID,
				"remote_id", jobID)
		}
	}
}

// resolveAPIKey returns the per-job key if set, otherwise the global key.
func (a *GenericHTTPAdapter) resolveAPIKey(params map[string]interface{}) string {
	if params != nil {
		if key, ok := params["api_key"].(string); ok && key != "" {
			return key
		}
	}
	return a.globalKey
}

// DoRequest is a package-level helper for provider Upload/Poll functions.
// It builds an authenticated HTTP request, executes it, and returns the response body.
// A nil body performs a GET; a non-nil body performs a POST (or the specified method).
func DoRequest(
	ctx         context.Context,
	client      *http.Client,
	method      string,
	url         string,
	body        io.Reader,
	contentType string,
	authHeader  string,
	authPrefix  string,
	apiKey      string,
) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set(authHeader, authPrefix+apiKey)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}
