package api

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"time"

	"ascribe/internal/llm"
	"ascribe/internal/models"
	"ascribe/pkg/logger"

	"github.com/gin-gonic/gin"
)

// ---- helpers ----

func (h *Handler) currentUserID(c *gin.Context) (uint, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

// ---- CRUD ----

func (h *Handler) ListCollections(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	cols, err := h.collectionRepo.ListByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list collections"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"collections": cols})
}

func (h *Handler) CreateCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req struct {
		Name        string  `json:"name" binding:"required,min=1,max=200"`
		Description *string `json:"description,omitempty"`
		Color       string  `json:"color,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	col := &models.Collection{
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
	}
	if req.Color != "" {
		col.Color = req.Color
	}
	if err := h.collectionRepo.Create(c.Request.Context(), col); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create collection"})
		return
	}
	c.JSON(http.StatusCreated, col)
}

func (h *Handler) GetCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	col, err := h.collectionRepo.FindByID(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return
	}
	recordings, err := h.collectionRepo.ListRecordings(c.Request.Context(), col.ID)
	if err != nil {
		recordings = []models.TranscriptionJob{}
	}
	c.JSON(http.StatusOK, gin.H{"collection": col, "recordings": recordings})
}

func (h *Handler) UpdateCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	col, err := h.collectionRepo.FindByID(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return
	}
	var req struct {
		Name        *string `json:"name,omitempty"`
		Description *string `json:"description,omitempty"`
		Color       *string `json:"color,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != nil {
		col.Name = *req.Name
	}
	if req.Description != nil {
		col.Description = req.Description
	}
	if req.Color != nil {
		col.Color = *req.Color
	}
	if err := h.collectionRepo.Update(c.Request.Context(), col); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update collection"})
		return
	}
	c.JSON(http.StatusOK, col)
}

func (h *Handler) DeleteCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if err := h.collectionRepo.Delete(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete collection"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// ---- Recording management ----

func (h *Handler) AddToCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	col, err := h.collectionRepo.FindByID(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return
	}
	var req struct {
		RecordingIDs []string `json:"recording_ids" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.collectionRepo.AddRecordings(c.Request.Context(), col.ID, req.RecordingIDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add recordings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "added"})
}

func (h *Handler) RemoveFromCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	// Verify ownership before removing.
	if _, err := h.collectionRepo.FindByID(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return
	}
	if err := h.collectionRepo.RemoveRecording(c.Request.Context(), c.Param("id"), c.Param("recording_id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove recording"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "removed"})
}

func (h *Handler) GetCollectionsForRecording(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	cols, err := h.collectionRepo.ListByRecording(c.Request.Context(), c.Param("recording_id"), userID)
	if err != nil {
		cols = []models.Collection{}
	}
	c.JSON(http.StatusOK, gin.H{"collections": cols})
}

// ---- LLM summarization ----

// SummarizeCollection streams a summary of all transcripts in the collection.
func (h *Handler) SummarizeCollection(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	col, err := h.collectionRepo.FindByID(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return
	}
	var req struct {
		Model      string  `json:"model" binding:"required"`
		TemplateID *string `json:"template_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	recordings, err := h.collectionRepo.ListRecordings(c.Request.Context(), col.ID)
	if err != nil || len(recordings) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "collection has no recordings with transcripts"})
		return
	}

	// Build combined content from all transcripts.
	var sb strings.Builder
	sb.WriteString("The following are transcripts from a collection titled \"")
	sb.WriteString(col.Name)
	sb.WriteString("\":\n\n")
	included := 0
	for _, r := range recordings {
		if r.Transcript == nil || *r.Transcript == "" {
			continue
		}
		title := r.ID
		if r.Title != nil && *r.Title != "" {
			title = *r.Title
		}
		sb.WriteString("--- ")
		sb.WriteString(title)
		sb.WriteString(" ---\n")
		sb.WriteString(*r.Transcript)
		sb.WriteString("\n\n")
		included++
	}
	if included == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no completed transcripts found in collection"})
		return
	}

	svc, _, err := h.getLLMService(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	messages := []llm.ChatMessage{{Role: "user", Content: sb.String()}}
	if req.TemplateID != nil && *req.TemplateID != "" {
		if tmpl, err := h.summaryRepo.FindByID(c.Request.Context(), *req.TemplateID); err == nil && tmpl.Prompt != "" {
			messages = append([]llm.ChatMessage{{Role: "system", Content: tmpl.Prompt}}, messages...)
		}
	}

	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Minute)
	defer cancel()

	contentChan, errChan := svc.ChatCompletionStream(ctx, req.Model, messages, 0.0)
	flusher, _ := c.Writer.(http.Flusher)
	writer := bufio.NewWriter(c.Writer)

	for {
		select {
		case chunk, ok := <-contentChan:
			if !ok {
				writer.Flush()
				if flusher != nil {
					flusher.Flush()
				}
				return
			}
			_, _ = writer.WriteString(chunk)
			writer.Flush()
			if flusher != nil {
				flusher.Flush()
			}
		case err := <-errChan:
			if err != nil {
				logger.Error("Collection summarize error", "collection_id", col.ID, "error", err)
			}
			writer.Flush()
			if flusher != nil {
				flusher.Flush()
			}
			return
		case <-ctx.Done():
			return
		}
	}
}

// CombineCollectionSummaries streams a meta-summary from existing per-recording summaries.
func (h *Handler) CombineCollectionSummaries(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	col, err := h.collectionRepo.FindByID(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return
	}
	var req struct {
		Model      string  `json:"model" binding:"required"`
		TemplateID *string `json:"template_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	recordings, err := h.collectionRepo.ListRecordings(c.Request.Context(), col.ID)
	if err != nil || len(recordings) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "collection has no recordings"})
		return
	}

	// Build content from per-recording summaries.
	var sb strings.Builder
	sb.WriteString("The following are individual summaries from a collection titled \"")
	sb.WriteString(col.Name)
	sb.WriteString("\". Please synthesize them into a single cohesive overview:\n\n")
	included := 0
	for _, r := range recordings {
		if r.Summary == nil || *r.Summary == "" {
			continue
		}
		title := r.ID
		if r.Title != nil && *r.Title != "" {
			title = *r.Title
		}
		sb.WriteString("--- ")
		sb.WriteString(title)
		sb.WriteString(" ---\n")
		sb.WriteString(*r.Summary)
		sb.WriteString("\n\n")
		included++
	}
	if included == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no summaries found in collection recordings"})
		return
	}

	svc, _, err := h.getLLMService(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	messages := []llm.ChatMessage{{Role: "user", Content: sb.String()}}
	if req.TemplateID != nil && *req.TemplateID != "" {
		if tmpl, err := h.summaryRepo.FindByID(c.Request.Context(), *req.TemplateID); err == nil && tmpl.Prompt != "" {
			messages = append([]llm.ChatMessage{{Role: "system", Content: tmpl.Prompt}}, messages...)
		}
	}

	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Minute)
	defer cancel()

	contentChan, errChan := svc.ChatCompletionStream(ctx, req.Model, messages, 0.0)
	flusher, _ := c.Writer.(http.Flusher)
	writer := bufio.NewWriter(c.Writer)

	for {
		select {
		case chunk, ok := <-contentChan:
			if !ok {
				writer.Flush()
				if flusher != nil {
					flusher.Flush()
				}
				return
			}
			_, _ = writer.WriteString(chunk)
			writer.Flush()
			if flusher != nil {
				flusher.Flush()
			}
		case err := <-errChan:
			if err != nil {
				logger.Error("Combine summaries error", "collection_id", col.ID, "error", err)
			}
			writer.Flush()
			if flusher != nil {
				flusher.Flush()
			}
			return
		case <-ctx.Done():
			return
		}
	}
}
