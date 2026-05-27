package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"ascribe/internal/models"
)

// NoteCreateRequest is the payload for creating a note
type NoteCreateRequest struct {
	StartWordIndex int     `json:"start_word_index" binding:"gte=0"`
	EndWordIndex   int     `json:"end_word_index" binding:"gte=0"`
	StartTime      float64 `json:"start_time" binding:"gte=0"`
	EndTime        float64 `json:"end_time" binding:"gte=0"`
	Quote          string  `json:"quote" binding:"required,min=1"`
	Content        string  `json:"content" binding:"required,min=1"`
}

// NoteUpdateRequest updates content of a note
type NoteUpdateRequest struct {
	Content string `json:"content" binding:"required,min=1"`
}

// ListNotes returns all notes for a transcription owned by the current user
// @Summary List notes for a transcription
// @Tags notes
// @Produce json
// @Param id path string true "Transcription ID"
// @Success 200 {array} models.Note
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/transcription/{id}/notes [get]
func (h *Handler) ListNotes(c *gin.Context) {
	transcriptionID := c.Param("id")
	if transcriptionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transcription ID is required"})
		return
	}

	if _, ok := h.requireJobOwner(c, transcriptionID); !ok {
		return
	}

	notes, err := h.noteRepo.ListByJob(c.Request.Context(), transcriptionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch notes"})
		return
	}

	c.JSON(http.StatusOK, notes)
}

// CreateNote stores a new note for a transcription
// @Summary Create a note for a transcription
// @Tags notes
// @Accept json
// @Produce json
// @Param id path string true "Transcription ID"
// @Param request body NoteCreateRequest true "Note create payload"
// @Success 200 {object} models.Note
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/transcription/{id}/notes [post]
func (h *Handler) CreateNote(c *gin.Context) {
	transcriptionID := c.Param("id")
	if transcriptionID == "" {
		log.Printf("notes.CreateNote: missing transcription ID")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transcription ID is required"})
		return
	}

	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req NoteCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("notes.CreateNote: invalid payload for transcription %s: %v", transcriptionID, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload", "details": err.Error()})
		return
	}

	if req.EndWordIndex < req.StartWordIndex {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_word_index must be >= start_word_index"})
		return
	}
	if req.EndTime < req.StartTime {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_time must be >= start_time"})
		return
	}

	if _, ok := h.requireJobOwner(c, transcriptionID); !ok {
		return
	}

	n := &models.Note{
		ID:              uuid.New().String(),
		UserID:          userID,
		TranscriptionID: transcriptionID,
		StartWordIndex:  req.StartWordIndex,
		EndWordIndex:    req.EndWordIndex,
		StartTime:       req.StartTime,
		EndTime:         req.EndTime,
		Quote:           req.Quote,
		Content:         req.Content,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if err := h.noteRepo.Create(c.Request.Context(), n); err != nil {
		log.Printf("notes.CreateNote: DB error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create note"})
		return
	}

	c.JSON(http.StatusOK, n)
}

// GetNote returns a note by ID (verifies parent job ownership)
// @Summary Get a note
// @Tags notes
// @Produce json
// @Param note_id path string true "Note ID"
// @Success 200 {object} models.Note
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/notes/{note_id} [get]
func (h *Handler) GetNote(c *gin.Context) {
	noteID := c.Param("note_id")
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	n, err := h.noteRepo.FindByID(c.Request.Context(), noteID)
	if err != nil || n.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Note not found"})
		return
	}
	c.JSON(http.StatusOK, n)
}

// UpdateNote updates the content of an existing note
// @Summary Update a note
// @Tags notes
// @Accept json
// @Produce json
// @Param note_id path string true "Note ID"
// @Param request body NoteUpdateRequest true "Note update payload"
// @Success 200 {object} models.Note
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/notes/{note_id} [put]
func (h *Handler) UpdateNote(c *gin.Context) {
	noteID := c.Param("note_id")
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req NoteUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	n, err := h.noteRepo.FindByID(c.Request.Context(), noteID)
	if err != nil || n.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Note not found"})
		return
	}

	n.Content = req.Content
	n.UpdatedAt = time.Now()

	if err := h.noteRepo.Update(c.Request.Context(), n); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update note"})
		return
	}

	c.JSON(http.StatusOK, n)
}

// DeleteNote removes a note by ID
// @Summary Delete a note
// @Tags notes
// @Produce json
// @Param note_id path string true "Note ID"
// @Success 200 {object} map[string]string
// @Security ApiKeyAuth
// @Router /api/v1/notes/{note_id} [delete]
func (h *Handler) DeleteNote(c *gin.Context) {
	noteID := c.Param("note_id")
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	n, err := h.noteRepo.FindByID(c.Request.Context(), noteID)
	if err != nil || n.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Note not found"})
		return
	}

	if err := h.noteRepo.Delete(c.Request.Context(), noteID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete note"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Note deleted"})
}
