package cloudprovider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"ascribe/internal/transcription/interfaces"
	"ascribe/pkg/logger"
)

const (
	assemblyAIUploadURL     = "https://api.assemblyai.com/v2/upload"
	assemblyAITranscriptURL = "https://api.assemblyai.com/v2/transcript"
	assemblyAIAuthHeader    = "Authorization"
	assemblyAIAuthPrefix    = "" // AssemblyAI does not use a "Bearer " prefix
)

// assemblyAIUpload implements the 3-step AssemblyAI submission flow:
//  1. Upload raw audio bytes → receive a CDN upload_url
//  2. POST a transcript request with that URL → receive a transcript ID
//  3. Return the transcript ID so the polling loop can track it
func assemblyAIUpload(
	ctx context.Context,
	client *http.Client,
	input interfaces.AudioInput,
	params map[string]interface{},
	apiKey string,
) (jobID string, result *interfaces.TranscriptResult, err error) {
	// Step 1 — upload raw audio.
	audioBytes, err := os.ReadFile(input.FilePath)
	if err != nil {
		return "", nil, fmt.Errorf("failed to read audio file: %w", err)
	}

	uploadResp, err := DoRequest(ctx, client,
		http.MethodPost, assemblyAIUploadURL,
		bytes.NewReader(audioBytes), "application/octet-stream",
		assemblyAIAuthHeader, assemblyAIAuthPrefix, apiKey)
	if err != nil {
		return "", nil, fmt.Errorf("audio upload failed: %w", err)
	}

	var uploadResult struct {
		UploadURL string `json:"upload_url"`
	}
	if err := json.Unmarshal(uploadResp, &uploadResult); err != nil {
		return "", nil, fmt.Errorf("failed to parse upload response: %w", err)
	}
	if uploadResult.UploadURL == "" {
		return "", nil, fmt.Errorf("AssemblyAI did not return an upload_url")
	}

	logger.Debug("AssemblyAI audio uploaded", "upload_url", uploadResult.UploadURL)

	// Step 2 — submit transcript request.
	requestBody := map[string]interface{}{
		"audio_url": uploadResult.UploadURL,
	}

	validModels := map[string]bool{"universal-2": true, "universal-3-pro": true}
	model, _ := params["model"].(string)
	if !validModels[model] {
		model = "universal-2"
	}
	requestBody["speech_models"] = []string{model}
	if lang, ok := params["language"].(string); ok && lang != "" {
		requestBody["language_code"] = lang
	}
	if diarize, ok := params["diarize"].(bool); ok && diarize {
		requestBody["speaker_labels"] = true
		if n, ok := params["speakers_expected"].(int); ok && n > 0 {
			requestBody["speakers_expected"] = n
		}
	}

	bodyJSON, err := json.Marshal(requestBody)
	if err != nil {
		return "", nil, fmt.Errorf("failed to marshal transcript request: %w", err)
	}

	transcriptResp, err := DoRequest(ctx, client,
		http.MethodPost, assemblyAITranscriptURL,
		bytes.NewReader(bodyJSON), "application/json",
		assemblyAIAuthHeader, assemblyAIAuthPrefix, apiKey)
	if err != nil {
		return "", nil, fmt.Errorf("transcript request failed: %w", err)
	}

	var transcriptJob struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(transcriptResp, &transcriptJob); err != nil {
		return "", nil, fmt.Errorf("failed to parse transcript response: %w", err)
	}
	if transcriptJob.ID == "" {
		return "", nil, fmt.Errorf("AssemblyAI did not return a transcript ID")
	}
	if transcriptJob.Error != "" {
		return "", nil, fmt.Errorf("AssemblyAI error on submission: %s", transcriptJob.Error)
	}

	logger.Debug("AssemblyAI transcript submitted", "id", transcriptJob.ID, "status", transcriptJob.Status)
	return transcriptJob.ID, nil, nil
}

// assemblyAIPoll checks the status of a submitted transcript job.
// Returns (nil, nil) while still processing, (result, nil) on completion,
// or (nil, err) on terminal failure.
func assemblyAIPoll(
	ctx context.Context,
	client *http.Client,
	jobID string,
	params map[string]interface{},
	apiKey string,
) (*interfaces.TranscriptResult, error) {
	pollURL := assemblyAITranscriptURL + "/" + jobID

	respBody, err := DoRequest(ctx, client,
		http.MethodGet, pollURL,
		nil, "",
		assemblyAIAuthHeader, assemblyAIAuthPrefix, apiKey)
	if err != nil {
		return nil, fmt.Errorf("poll request failed: %w", err)
	}

	var resp assemblyAITranscriptResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse poll response: %w", err)
	}

	switch resp.Status {
	case "queued", "processing":
		return nil, nil // still working

	case "completed":
		return mapAssemblyAIResponse(&resp), nil

	case "error":
		msg := resp.Error
		if msg == "" {
			msg = "unknown error"
		}
		return nil, fmt.Errorf("AssemblyAI transcription failed: %s", msg)

	default:
		return nil, fmt.Errorf("unexpected AssemblyAI status: %s", resp.Status)
	}
}

// assemblyAITranscriptResponse is the AssemblyAI poll/result JSON shape.
type assemblyAITranscriptResponse struct {
	ID           string  `json:"id"`
	Status       string  `json:"status"`
	Error        string  `json:"error"`
	Text         string  `json:"text"`
	LanguageCode string  `json:"language_code"`
	Confidence   float64 `json:"confidence"`

	// Word-level timing (milliseconds)
	Words []struct {
		Text       string  `json:"text"`
		Start      int     `json:"start"`
		End        int     `json:"end"`
		Confidence float64 `json:"confidence"`
		Speaker    string  `json:"speaker,omitempty"`
	} `json:"words"`

	// Utterances (populated when speaker_labels=true)
	Utterances []struct {
		Speaker string `json:"speaker"`
		Text    string `json:"text"`
		Start   int    `json:"start"`
		End     int    `json:"end"`
		Words   []struct {
			Text       string  `json:"text"`
			Start      int     `json:"start"`
			End        int     `json:"end"`
			Confidence float64 `json:"confidence"`
			Speaker    string  `json:"speaker"`
		} `json:"words"`
	} `json:"utterances"`
}

// mapAssemblyAIResponse converts a completed AssemblyAI response to TranscriptResult.
func mapAssemblyAIResponse(resp *assemblyAITranscriptResponse) *interfaces.TranscriptResult {
	result := &interfaces.TranscriptResult{
		Text:       resp.Text,
		Language:   resp.LanguageCode,
		Confidence: resp.Confidence,
		Metadata: map[string]string{
			"provider":   "assemblyai",
			"remote_id":  resp.ID,
		},
	}

	// Word-level segments (convert ms → seconds).
	if len(resp.Words) > 0 {
		result.WordSegments = make([]interfaces.TranscriptWord, len(resp.Words))
		for i, w := range resp.Words {
			speaker := w.Speaker
			var sp *string
			if speaker != "" {
				sp = &speaker
			}
			result.WordSegments[i] = interfaces.TranscriptWord{
				Word:    w.Text,
				Start:   msToSeconds(w.Start),
				End:     msToSeconds(w.End),
				Score:   w.Confidence,
				Speaker: sp,
			}
		}
	}

	// Sentence-level segments from utterances (speaker-diarized) or word grouping.
	if len(resp.Utterances) > 0 {
		result.Segments = make([]interfaces.TranscriptSegment, len(resp.Utterances))
		for i, u := range resp.Utterances {
			speaker := u.Speaker
			result.Segments[i] = interfaces.TranscriptSegment{
				Start:   msToSeconds(u.Start),
				End:     msToSeconds(u.End),
				Text:    u.Text,
				Speaker: &speaker,
			}
		}
	} else if resp.Text != "" {
		// No utterances: create a single segment spanning the full audio.
		var end float64
		if len(resp.Words) > 0 {
			end = msToSeconds(resp.Words[len(resp.Words)-1].End)
		}
		result.Segments = []interfaces.TranscriptSegment{
			{Start: 0, End: end, Text: resp.Text},
		}
	}

	return result
}

// msToSeconds converts milliseconds (AssemblyAI's unit) to seconds.
func msToSeconds(ms int) float64 {
	return float64(ms) / 1000.0
}

// NewAssemblyAIAdapter returns a GenericHTTPAdapter configured for AssemblyAI.
func NewAssemblyAIAdapter(globalKey string) *GenericHTTPAdapter {
	capabilities := interfaces.ModelCapabilities{
		ModelID:     "assemblyai",
		ModelFamily: "assemblyai",
		DisplayName: "AssemblyAI",
		Description: "Cloud transcription via AssemblyAI API (async, high accuracy)",
		Version:     "v2",
		SupportedLanguages: []string{
			"en", "fr", "de", "es", "it", "pt", "nl", "hi", "ja", "zh",
			"fi", "ko", "pl", "ru", "tr", "uk", "vi",
		},
		SupportedFormats:  []string{"mp3", "mp4", "m4a", "wav", "flac", "ogg", "webm", "aac"},
		RequiresGPU:       false,
		MemoryRequirement: 0,
		Features: map[string]bool{
			"timestamps":         true,
			"word_level":         true,
			"diarization":        true,
			"language_detection": true,
			"translation":        false,
		},
		Metadata: map[string]string{
			"provider":   "assemblyai",
			"mode":       "async",
			"api_url":    assemblyAITranscriptURL,
		},
	}

	schema := []interfaces.ParameterSchema{
		{
			Name:        "api_key",
			Type:        "string",
			Required:    false,
			Description: "AssemblyAI API key — overrides the ASSEMBLYAI_API_KEY environment variable",
			Group:       "authentication",
		},
		{
			Name:        "model",
			Type:        "string",
			Required:    false,
			Default:     "universal-2",
			Options:     []string{"universal-2", "universal-3-pro"},
			Description: "'universal-2' for high accuracy; 'universal-3-pro' for best quality (English, Spanish, French, German, Italian, Portuguese)",
			Group:       "basic",
		},
		{
			Name:        "language",
			Type:        "string",
			Required:    false,
			Default:     "",
			Description: "ISO-639-1 language code (e.g. 'en', 'fr'). Leave empty for automatic detection.",
			Group:       "basic",
		},
		{
			Name:        "diarize",
			Type:        "bool",
			Required:    false,
			Default:     false,
			Description: "Enable speaker labels (diarization)",
			Group:       "basic",
		},
	}

	cfg := ProviderConfig{
		ProviderID:      "assemblyai",
		DisplayName:     "AssemblyAI",
		AuthHeaderName:  assemblyAIAuthHeader,
		AuthValuePrefix: assemblyAIAuthPrefix,
		PollInterval:    3 * time.Second,
		MaxPollTime:     2 * time.Hour,
		Upload:          assemblyAIUpload,
		Poll:            assemblyAIPoll,
		Capabilities:    capabilities,
		Schema:          schema,
	}

	return NewGenericHTTPAdapter(cfg, globalKey)
}

