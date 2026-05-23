package cloudprovider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"scriberr/internal/transcription/interfaces"
)

const (
	deepgramListenURL  = "https://api.deepgram.com/v1/listen"
	deepgramAuthHeader = "Authorization"
	deepgramAuthPrefix = "Token "
)

// deepgramMIMETypes maps common audio extensions to MIME types accepted by Deepgram.
var deepgramMIMETypes = map[string]string{
	"mp3":  "audio/mpeg",
	"mp4":  "audio/mp4",
	"m4a":  "audio/mp4",
	"wav":  "audio/wav",
	"flac": "audio/flac",
	"ogg":  "audio/ogg",
	"webm": "audio/webm",
	"aac":  "audio/aac",
	"opus": "audio/opus",
}

// deepgramUpload streams the audio file to Deepgram's synchronous /v1/listen endpoint
// and returns the full TranscriptResult immediately — no polling required.
func deepgramUpload(
	ctx context.Context,
	client *http.Client,
	input interfaces.AudioInput,
	params map[string]interface{},
	apiKey string,
) (jobID string, result *interfaces.TranscriptResult, err error) {
	// Build query parameters.
	q := url.Values{}
	q.Set("smart_format", "true") // punctuation, paragraphs, etc.

	if model, ok := params["model"].(string); ok && model != "" {
		q.Set("model", model)
	} else {
		q.Set("model", "nova-2")
	}
	if lang, ok := params["language"].(string); ok && lang != "" {
		q.Set("language", lang)
	}
	if diarize, ok := params["diarize"].(bool); ok && diarize {
		q.Set("diarize", "true")
	}

	endpoint := deepgramListenURL + "?" + q.Encode()

	// Determine MIME type from audio format.
	format := strings.ToLower(input.Format)
	mimeType, ok := deepgramMIMETypes[format]
	if !ok {
		mimeType = "audio/mpeg" // fallback
	}

	// Open and stream audio.
	f, err := os.Open(input.FilePath)
	if err != nil {
		return "", nil, fmt.Errorf("failed to open audio file: %w", err)
	}
	defer f.Close()

	respBody, err := DoRequest(ctx, client,
		http.MethodPost, endpoint,
		f, mimeType,
		deepgramAuthHeader, deepgramAuthPrefix, apiKey)
	if err != nil {
		return "", nil, fmt.Errorf("Deepgram request failed: %w", err)
	}

	result, err = mapDeepgramResponse(respBody)
	if err != nil {
		return "", nil, err
	}
	return "", result, nil // sync: return result directly
}

// deepgramResponse mirrors the relevant parts of Deepgram's /v1/listen response.
type deepgramResponse struct {
	Metadata struct {
		RequestID string `json:"request_id"`
	} `json:"metadata"`
	Results struct {
		Channels []struct {
			DetectedLanguage string `json:"detected_language"`
			Alternatives     []struct {
				Transcript string  `json:"transcript"`
				Confidence float64 `json:"confidence"`
				Words      []struct {
					Word            string  `json:"word"`
					PunctuatedWord  string  `json:"punctuated_word"`
					Start           float64 `json:"start"`
					End             float64 `json:"end"`
					Confidence      float64 `json:"confidence"`
					Speaker         *int    `json:"speaker,omitempty"`
					SpeakerConfidence float64 `json:"speaker_confidence,omitempty"`
				} `json:"words"`
				Paragraphs *struct {
					Transcript string `json:"transcript"`
					Paragraphs []struct {
						Sentences []struct {
							Text  string  `json:"text"`
							Start float64 `json:"start"`
							End   float64 `json:"end"`
						} `json:"sentences"`
						Start   float64 `json:"start"`
						End     float64 `json:"end"`
						Speaker *int    `json:"speaker,omitempty"`
					} `json:"paragraphs"`
				} `json:"paragraphs,omitempty"`
			} `json:"alternatives"`
		} `json:"channels"`
	} `json:"results"`
}

// mapDeepgramResponse converts a Deepgram JSON response to a TranscriptResult.
func mapDeepgramResponse(body []byte) (*interfaces.TranscriptResult, error) {
	var resp deepgramResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse Deepgram response: %w", err)
	}

	if len(resp.Results.Channels) == 0 || len(resp.Results.Channels[0].Alternatives) == 0 {
		return nil, fmt.Errorf("Deepgram returned no transcription results")
	}

	ch := resp.Results.Channels[0]
	alt := ch.Alternatives[0]

	result := &interfaces.TranscriptResult{
		Text:       alt.Transcript,
		Language:   ch.DetectedLanguage,
		Confidence: alt.Confidence,
		Metadata: map[string]string{
			"provider":   "deepgram",
			"request_id": resp.Metadata.RequestID,
		},
	}

	// Word-level segments.
	if len(alt.Words) > 0 {
		result.WordSegments = make([]interfaces.TranscriptWord, len(alt.Words))
		for i, w := range alt.Words {
			word := w.PunctuatedWord
			if word == "" {
				word = w.Word
			}
			var sp *string
			if w.Speaker != nil {
				s := fmt.Sprintf("Speaker %d", *w.Speaker)
				sp = &s
			}
			result.WordSegments[i] = interfaces.TranscriptWord{
				Word:    word,
				Start:   w.Start,
				End:     w.End,
				Score:   w.Confidence,
				Speaker: sp,
			}
		}
	}

	// Sentence-level segments from paragraphs (most structured), or word grouping.
	if alt.Paragraphs != nil && len(alt.Paragraphs.Paragraphs) > 0 {
		for _, para := range alt.Paragraphs.Paragraphs {
			for _, sent := range para.Sentences {
				seg := interfaces.TranscriptSegment{
					Start: sent.Start,
					End:   sent.End,
					Text:  sent.Text,
				}
				if para.Speaker != nil {
					s := fmt.Sprintf("Speaker %d", *para.Speaker)
					seg.Speaker = &s
				}
				result.Segments = append(result.Segments, seg)
			}
		}
	} else if len(alt.Words) > 0 {
		// Group words into segments by pause (gap > 1 s) or every 10 words.
		result.Segments = groupWordsIntoSegments(alt.Words, 1.0, 10)
	} else if alt.Transcript != "" {
		result.Segments = []interfaces.TranscriptSegment{
			{Start: 0, Text: alt.Transcript},
		}
	}

	return result, nil
}

// groupWordsIntoSegments bundles words into segments based on a pause threshold
// or a maximum word count per segment.
func groupWordsIntoSegments(words []struct {
	Word            string  `json:"word"`
	PunctuatedWord  string  `json:"punctuated_word"`
	Start           float64 `json:"start"`
	End             float64 `json:"end"`
	Confidence      float64 `json:"confidence"`
	Speaker         *int    `json:"speaker,omitempty"`
	SpeakerConfidence float64 `json:"speaker_confidence,omitempty"`
}, pauseThreshold float64, maxWords int) []interfaces.TranscriptSegment {
	if len(words) == 0 {
		return nil
	}

	var segments []interfaces.TranscriptSegment
	segStart := words[0].Start
	var segTexts []string
	var segSpeaker *int
	count := 0

	flush := func(endTime float64) {
		if len(segTexts) == 0 {
			return
		}
		seg := interfaces.TranscriptSegment{
			Start: segStart,
			End:   endTime,
			Text:  strings.Join(segTexts, " "),
		}
		if segSpeaker != nil {
			s := fmt.Sprintf("Speaker %d", *segSpeaker)
			seg.Speaker = &s
		}
		segments = append(segments, seg)
		segTexts = nil
		count = 0
	}

	for i, w := range words {
		word := w.PunctuatedWord
		if word == "" {
			word = w.Word
		}

		// Start new segment on speaker change or pause.
		if i > 0 {
			prev := words[i-1]
			speakerChanged := (w.Speaker == nil) != (prev.Speaker == nil) ||
				(w.Speaker != nil && prev.Speaker != nil && *w.Speaker != *prev.Speaker)
			paused := w.Start-prev.End > pauseThreshold

			if speakerChanged || paused || count >= maxWords {
				flush(prev.End)
				segStart = w.Start
				segSpeaker = w.Speaker
			}
		} else {
			segSpeaker = w.Speaker
		}

		segTexts = append(segTexts, word)
		count++
	}
	flush(words[len(words)-1].End)

	return segments
}

// NewDeepgramAdapter returns a GenericHTTPAdapter configured for Deepgram.
// Deepgram is a synchronous provider (Poll is nil).
func NewDeepgramAdapter(globalKey string) *GenericHTTPAdapter {
	capabilities := interfaces.ModelCapabilities{
		ModelID:     "deepgram",
		ModelFamily: "deepgram",
		DisplayName: "Deepgram",
		Description: "Cloud transcription via Deepgram API (synchronous, fast)",
		Version:     "v1",
		SupportedLanguages: []string{
			"en", "en-US", "en-GB", "en-AU", "en-NZ", "en-IN",
			"fr", "fr-CA", "de", "es", "es-419", "it", "pt", "pt-BR",
			"nl", "hi", "ja", "ko", "zh", "zh-CN", "zh-TW",
			"ru", "pl", "uk", "tr", "sv", "da", "no", "fi",
		},
		SupportedFormats:  []string{"mp3", "mp4", "m4a", "wav", "flac", "ogg", "webm", "aac", "opus"},
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
			"provider": "deepgram",
			"mode":     "sync",
			"api_url":  deepgramListenURL,
		},
	}

	schema := []interfaces.ParameterSchema{
		{
			Name:        "api_key",
			Type:        "string",
			Required:    false,
			Description: "Deepgram API key — overrides the DEEPGRAM_API_KEY environment variable",
			Group:       "authentication",
		},
		{
			Name:    "model",
			Type:    "string",
			Required: false,
			Default: "nova-2",
			Options: []string{"nova-2", "nova-2-medical", "enhanced", "base"},
			Description: "Deepgram model. 'nova-2' offers the best accuracy for general use.",
			Group:   "basic",
		},
		{
			Name:        "language",
			Type:        "string",
			Required:    false,
			Default:     "en",
			Description: "BCP-47 language tag (e.g. 'en', 'fr', 'de'). Required for non-nova-2 models.",
			Group:       "basic",
		},
		{
			Name:        "diarize",
			Type:        "bool",
			Required:    false,
			Default:     false,
			Description: "Enable speaker diarization",
			Group:       "basic",
		},
	}

	cfg := ProviderConfig{
		ProviderID:      "deepgram",
		DisplayName:     "Deepgram",
		AuthHeaderName:  deepgramAuthHeader,
		AuthValuePrefix: deepgramAuthPrefix,
		Upload:          deepgramUpload,
		Poll:            nil, // synchronous — no polling needed
		Capabilities:    capabilities,
		Schema:          schema,
	}

	return NewGenericHTTPAdapter(cfg, globalKey)
}
