package repository

import (
	"context"
	"ascribe/internal/models"
	"time"

	"gorm.io/gorm"
)

// UserRepository handles user-specific database operations
type UserRepository interface {
	Repository[models.User]
	FindByUsername(ctx context.Context, username string) (*models.User, error)
	FindByEmail(ctx context.Context, email string) (*models.User, error)
	Count(ctx context.Context) (int64, error)
	CountWithAutoTranscription(ctx context.Context) (int64, error)
	CountAdmins(ctx context.Context) (int64, error)
	ListAll(ctx context.Context) ([]models.User, error)
	SetActive(ctx context.Context, id uint, active bool) error
}

type userRepository struct {
	*BaseRepository[models.User]
}

func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepository{
		BaseRepository: NewBaseRepository[models.User](db),
	}
}

func (r *userRepository) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) Count(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.User{}).Count(&count).Error
	return count, err
}

func (r *userRepository) CountWithAutoTranscription(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.User{}).Where("auto_transcription_enabled = ?", true).Count(&count).Error
	return count, err
}

func (r *userRepository) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) ListAll(ctx context.Context) ([]models.User, error) {
	var users []models.User
	err := r.db.WithContext(ctx).Order("id asc").Find(&users).Error
	return users, err
}

func (r *userRepository) CountAdmins(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.User{}).Where("role = ? AND is_active = ?", "admin", true).Count(&count).Error
	return count, err
}

func (r *userRepository) SetActive(ctx context.Context, id uint, active bool) error {
	return r.db.WithContext(ctx).Model(&models.User{}).Where("id = ?", id).Update("is_active", active).Error
}

// JobRepository handles transcription job operations
// JobSearchResult pairs a job with its FTS5 match snippet.
type JobSearchResult struct {
	Job     models.TranscriptionJob
	Snippet string
}

type JobRepository interface {
	Repository[models.TranscriptionJob]
	FindWithAssociations(ctx context.Context, id string) (*models.TranscriptionJob, error)
	FindActiveTrackJobs(ctx context.Context, parentJobID string) ([]models.TranscriptionJob, error)
	FindLatestCompletedExecution(ctx context.Context, jobID string) (*models.TranscriptionJobExecution, error)
	ListWithParams(ctx context.Context, offset, limit int, sortBy, sortOrder, searchQuery string, updatedAfter *time.Time) ([]models.TranscriptionJob, int64, error)
	ListByUserWithParams(ctx context.Context, userID uint, offset, limit int, sortBy, sortOrder, searchQuery string, updatedAfter *time.Time) ([]models.TranscriptionJob, int64, error)
	SearchByUser(ctx context.Context, userID uint, query string, offset, limit int) ([]JobSearchResult, int64, error)
	UpdateTranscript(ctx context.Context, jobID string, transcript string) error
	IndexTranscript(ctx context.Context, jobID string, userID uint, title, text string) error
	UpdateFTSTitle(ctx context.Context, jobID, title string) error
	RemoveFTSEntry(ctx context.Context, jobID string) error
	CreateExecution(ctx context.Context, execution *models.TranscriptionJobExecution) error
	UpdateExecution(ctx context.Context, execution *models.TranscriptionJobExecution) error
	DeleteExecutionsByJobID(ctx context.Context, jobID string) error
	DeleteMultiTrackFilesByJobID(ctx context.Context, jobID string) error
	UpdateStatus(ctx context.Context, jobID string, status models.JobStatus) error
	UpdateError(ctx context.Context, jobID string, errorMsg string) error
	FindByStatus(ctx context.Context, status models.JobStatus) ([]models.TranscriptionJob, error)
	CountByStatus(ctx context.Context, status models.JobStatus) (int64, error)
	UpdateSummary(ctx context.Context, jobID string, summary string) error
}

type jobRepository struct {
	*BaseRepository[models.TranscriptionJob]
}

func NewJobRepository(db *gorm.DB) JobRepository {
	return &jobRepository{
		BaseRepository: NewBaseRepository[models.TranscriptionJob](db),
	}
}

func (r *jobRepository) FindWithAssociations(ctx context.Context, id string) (*models.TranscriptionJob, error) {
	var job models.TranscriptionJob
	err := r.db.WithContext(ctx).
		Preload("MultiTrackFiles").
		Where("id = ?", id).
		First(&job).Error
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func (r *jobRepository) ListWithParams(ctx context.Context, offset, limit int, sortBy, sortOrder, searchQuery string, updatedAfter *time.Time) ([]models.TranscriptionJob, int64, error) {
	var jobs []models.TranscriptionJob
	var count int64

	db := r.db.WithContext(ctx).Model(&models.TranscriptionJob{})

	// Handle delta sync if updatedAfter provided
	if updatedAfter != nil {
		db = db.Unscoped().Where("updated_at > ?", *updatedAfter)
	}

	// Apply search filter
	if searchQuery != "" {
		search := "%" + searchQuery + "%"
		db = db.Where("title LIKE ? OR audio_path LIKE ?", search, search)
	}

	// Count total matching records
	if err := db.Count(&count).Error; err != nil {
		return nil, 0, err
	}

	// Apply sorting
	if sortBy != "" {
		if sortOrder == "" {
			sortOrder = "desc"
		}
		db = db.Order(sortBy + " " + sortOrder)
	} else {
		// Default sort
		db = db.Order("created_at desc")
	}

	// Apply pagination
	err := db.Offset(offset).Limit(limit).Find(&jobs).Error
	if err != nil {
		return nil, 0, err
	}

	return jobs, count, nil
}

func (r *jobRepository) ListByUserWithParams(ctx context.Context, userID uint, offset, limit int, sortBy, sortOrder, searchQuery string, updatedAfter *time.Time) ([]models.TranscriptionJob, int64, error) {
	var jobs []models.TranscriptionJob
	var count int64

	db := r.db.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("user_id = ?", userID)

	if updatedAfter != nil {
		db = db.Unscoped().Where("updated_at > ?", *updatedAfter)
	}

	if searchQuery != "" {
		search := "%" + searchQuery + "%"
		db = db.Where("title LIKE ? OR audio_path LIKE ?", search, search)
	}

	if err := db.Count(&count).Error; err != nil {
		return nil, 0, err
	}

	if sortBy != "" {
		if sortOrder == "" {
			sortOrder = "desc"
		}
		db = db.Order(sortBy + " " + sortOrder)
	} else {
		db = db.Order("created_at desc")
	}

	err := db.Offset(offset).Limit(limit).Find(&jobs).Error
	return jobs, count, err
}

func (r *jobRepository) UpdateTranscript(ctx context.Context, jobID string, transcript string) error {
	return r.db.WithContext(ctx).Model(&models.TranscriptionJob{}).
		Where("id = ?", jobID).
		Update("transcript", transcript).Error
}

func (r *jobRepository) IndexTranscript(ctx context.Context, jobID string, userID uint, title, text string) error {
	db := r.db.WithContext(ctx)
	if err := db.Exec("DELETE FROM transcription_jobs_fts WHERE job_id = ?", jobID).Error; err != nil {
		return err
	}
	return db.Exec(
		"INSERT INTO transcription_jobs_fts (job_id, user_id, title, transcript_text) VALUES (?, ?, ?, ?)",
		jobID, userID, title, text,
	).Error
}

func (r *jobRepository) UpdateFTSTitle(ctx context.Context, jobID, title string) error {
	return r.db.WithContext(ctx).Exec(
		"UPDATE transcription_jobs_fts SET title = ? WHERE job_id = ?",
		title, jobID,
	).Error
}

func (r *jobRepository) RemoveFTSEntry(ctx context.Context, jobID string) error {
	return r.db.WithContext(ctx).Exec(
		"DELETE FROM transcription_jobs_fts WHERE job_id = ?", jobID,
	).Error
}

func (r *jobRepository) SearchByUser(ctx context.Context, userID uint, query string, offset, limit int) ([]JobSearchResult, int64, error) {
	type ftsRow struct {
		JobID   string `gorm:"column:job_id"`
		Snippet string `gorm:"column:snippet"`
	}
	var rows []ftsRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT job_id,
		       snippet(transcription_jobs_fts, 3, '**', '**', '…', 32) AS snippet
		FROM transcription_jobs_fts
		WHERE transcription_jobs_fts MATCH ?
		  AND user_id = ?
		ORDER BY bm25(transcription_jobs_fts)
	`, query, userID).Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}

	total := int64(len(rows))
	if total == 0 {
		return nil, 0, nil
	}

	// Apply pagination to BM25-ranked results
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	if offset >= len(rows) {
		return nil, total, nil
	}
	page := rows[offset:end]

	// Build ordered ID list and snippet map
	ids := make([]string, len(page))
	snippetMap := make(map[string]string, len(page))
	for i, row := range page {
		ids[i] = row.JobID
		snippetMap[row.JobID] = row.Snippet
	}

	// Fetch full job records (GORM's soft-delete scope is applied automatically)
	var jobs []models.TranscriptionJob
	if err := r.db.WithContext(ctx).
		Where("id IN ?", ids).
		Find(&jobs).Error; err != nil {
		return nil, 0, err
	}

	// Map for O(1) lookup
	jobMap := make(map[string]models.TranscriptionJob, len(jobs))
	for _, j := range jobs {
		jobMap[j.ID] = j
	}

	// Return in BM25 order
	results := make([]JobSearchResult, 0, len(ids))
	for _, id := range ids {
		if job, ok := jobMap[id]; ok {
			results = append(results, JobSearchResult{Job: job, Snippet: snippetMap[id]})
		}
	}
	return results, total, nil
}

func (r *jobRepository) CreateExecution(ctx context.Context, execution *models.TranscriptionJobExecution) error {
	return r.db.WithContext(ctx).Create(execution).Error
}

func (r *jobRepository) UpdateExecution(ctx context.Context, execution *models.TranscriptionJobExecution) error {
	return r.db.WithContext(ctx).Save(execution).Error
}

func (r *jobRepository) DeleteExecutionsByJobID(ctx context.Context, jobID string) error {
	return r.db.WithContext(ctx).Where("transcription_job_id = ?", jobID).Delete(&models.TranscriptionJobExecution{}).Error
}

func (r *jobRepository) DeleteMultiTrackFilesByJobID(ctx context.Context, jobID string) error {
	return r.db.WithContext(ctx).Where("transcription_job_id = ?", jobID).Delete(&models.MultiTrackFile{}).Error
}

func (r *jobRepository) FindActiveTrackJobs(ctx context.Context, parentJobID string) ([]models.TranscriptionJob, error) {
	var jobs []models.TranscriptionJob
	err := r.db.WithContext(ctx).
		Where("id LIKE ? AND status IN (?)", "track_"+parentJobID+"_%", []string{"processing", "pending"}).
		Find(&jobs).Error
	return jobs, err
}

func (r *jobRepository) FindLatestCompletedExecution(ctx context.Context, jobID string) (*models.TranscriptionJobExecution, error) {
	var execution models.TranscriptionJobExecution
	err := r.db.WithContext(ctx).
		Where("transcription_job_id = ? AND status = ?", jobID, models.StatusCompleted).
		Order("created_at DESC").
		First(&execution).Error
	if err != nil {
		return nil, err
	}
	return &execution, nil
}

func (r *jobRepository) UpdateStatus(ctx context.Context, jobID string, status models.JobStatus) error {
	return r.db.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("id = ?", jobID).Update("status", status).Error
}

func (r *jobRepository) UpdateError(ctx context.Context, jobID string, errorMsg string) error {
	return r.db.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("id = ?", jobID).Update("error_message", errorMsg).Error
}

func (r *jobRepository) FindByStatus(ctx context.Context, status models.JobStatus) ([]models.TranscriptionJob, error) {
	var jobs []models.TranscriptionJob
	err := r.db.WithContext(ctx).Where("status = ?", status).Find(&jobs).Error
	if err != nil {
		return nil, err
	}
	return jobs, nil
}

func (r *jobRepository) CountByStatus(ctx context.Context, status models.JobStatus) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("status = ?", status).Count(&count).Error
	return count, err
}

func (r *jobRepository) UpdateSummary(ctx context.Context, jobID string, summary string) error {
	return r.db.WithContext(ctx).Model(&models.TranscriptionJob{}).Where("id = ?", jobID).Update("summary", summary).Error
}

// APIKeyRepository handles API key operations
type APIKeyRepository interface {
	Repository[models.APIKey]
	FindByKey(ctx context.Context, key string) (*models.APIKey, error)
	ListActive(ctx context.Context) ([]models.APIKey, error)
	ListByUser(ctx context.Context, userID uint) ([]models.APIKey, error)
	FindByIDAndUser(ctx context.Context, id uint, userID uint) (*models.APIKey, error)
	Revoke(ctx context.Context, id uint) error
}

type apiKeyRepository struct {
	*BaseRepository[models.APIKey]
}

func NewAPIKeyRepository(db *gorm.DB) APIKeyRepository {
	return &apiKeyRepository{
		BaseRepository: NewBaseRepository[models.APIKey](db),
	}
}

func (r *apiKeyRepository) FindByKey(ctx context.Context, key string) (*models.APIKey, error) {
	var apiKey models.APIKey
	err := r.db.WithContext(ctx).Where("key = ?", key).First(&apiKey).Error
	if err != nil {
		return nil, err
	}
	return &apiKey, nil
}

func (r *apiKeyRepository) ListActive(ctx context.Context) ([]models.APIKey, error) {
	var apiKeys []models.APIKey
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Find(&apiKeys).Error
	if err != nil {
		return nil, err
	}
	return apiKeys, nil
}

func (r *apiKeyRepository) ListByUser(ctx context.Context, userID uint) ([]models.APIKey, error) {
	var keys []models.APIKey
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at desc").Find(&keys).Error
	return keys, err
}

func (r *apiKeyRepository) FindByIDAndUser(ctx context.Context, id uint, userID uint) (*models.APIKey, error) {
	var key models.APIKey
	err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&key).Error
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *apiKeyRepository) Revoke(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Model(&models.APIKey{}).Where("id = ?", id).Update("is_active", false).Error
}

// ProfileRepository handles transcription profile operations
type ProfileRepository interface {
	Repository[models.TranscriptionProfile]
	FindDefault(ctx context.Context) (*models.TranscriptionProfile, error)
	FindByName(ctx context.Context, name string) (*models.TranscriptionProfile, error)
	ListVisibleToUser(ctx context.Context, userID uint) ([]models.TranscriptionProfile, error)
	FindByIDForUser(ctx context.Context, id string, userID uint, role string) (*models.TranscriptionProfile, error)
}

type profileRepository struct {
	*BaseRepository[models.TranscriptionProfile]
}

func NewProfileRepository(db *gorm.DB) ProfileRepository {
	return &profileRepository{
		BaseRepository: NewBaseRepository[models.TranscriptionProfile](db),
	}
}

func (r *profileRepository) FindDefault(ctx context.Context) (*models.TranscriptionProfile, error) {
	var profile models.TranscriptionProfile
	err := r.db.WithContext(ctx).Where("is_default = ?", true).First(&profile).Error
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

func (r *profileRepository) FindByName(ctx context.Context, name string) (*models.TranscriptionProfile, error) {
	var profile models.TranscriptionProfile
	err := r.db.WithContext(ctx).Where("name = ?", name).First(&profile).Error
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

func (r *profileRepository) ListVisibleToUser(ctx context.Context, userID uint) ([]models.TranscriptionProfile, error) {
	var profiles []models.TranscriptionProfile
	err := r.db.WithContext(ctx).
		Where("owner_user_id IS NULL OR owner_user_id = ?", userID).
		Order("is_default desc, name asc").
		Find(&profiles).Error
	return profiles, err
}

func (r *profileRepository) FindByIDForUser(ctx context.Context, id string, userID uint, role string) (*models.TranscriptionProfile, error) {
	var profile models.TranscriptionProfile
	var err error
	if role == "admin" {
		err = r.db.WithContext(ctx).Where("id = ?", id).First(&profile).Error
	} else {
		err = r.db.WithContext(ctx).Where("id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", id, userID).First(&profile).Error
	}
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

// LLMConfigRepository handles LLM configuration operations
type LLMConfigRepository interface {
	Repository[models.LLMConfig]
	GetActive(ctx context.Context) (*models.LLMConfig, error)
}

type llmConfigRepository struct {
	*BaseRepository[models.LLMConfig]
}

func NewLLMConfigRepository(db *gorm.DB) LLMConfigRepository {
	return &llmConfigRepository{
		BaseRepository: NewBaseRepository[models.LLMConfig](db),
	}
}

func (r *llmConfigRepository) GetActive(ctx context.Context) (*models.LLMConfig, error) {
	var config models.LLMConfig
	err := r.db.WithContext(ctx).Where("is_active = ?", true).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// SummaryRepository handles summary templates and settings
type SummaryRepository interface {
	Repository[models.SummaryTemplate]
	ListVisibleToUser(ctx context.Context, userID uint) ([]models.SummaryTemplate, error)
	GetSettings(ctx context.Context) (*models.SummarySetting, error)
	SaveSettings(ctx context.Context, settings *models.SummarySetting) error
	SaveSummary(ctx context.Context, summary *models.Summary) error
	GetLatestSummary(ctx context.Context, transcriptionID string) (*models.Summary, error)
	DeleteByTranscriptionID(ctx context.Context, transcriptionID string) error
}

type summaryRepository struct {
	*BaseRepository[models.SummaryTemplate]
}

func NewSummaryRepository(db *gorm.DB) SummaryRepository {
	return &summaryRepository{
		BaseRepository: NewBaseRepository[models.SummaryTemplate](db),
	}
}

func (r *summaryRepository) ListVisibleToUser(ctx context.Context, userID uint) ([]models.SummaryTemplate, error) {
	var items []models.SummaryTemplate
	err := r.db.WithContext(ctx).
		Where("owner_user_id IS NULL OR owner_user_id = ?", userID).
		Order("name asc").
		Find(&items).Error
	return items, err
}

func (r *summaryRepository) GetSettings(ctx context.Context) (*models.SummarySetting, error) {
	var settings models.SummarySetting
	// Assuming singleton settings or per-user (but currently model might not have user_id)
	// If it's a singleton table:
	err := r.db.WithContext(ctx).First(&settings).Error
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

func (r *summaryRepository) SaveSettings(ctx context.Context, settings *models.SummarySetting) error {
	return r.db.WithContext(ctx).Save(settings).Error
}

func (r *summaryRepository) SaveSummary(ctx context.Context, summary *models.Summary) error {
	return r.db.WithContext(ctx).Create(summary).Error
}

func (r *summaryRepository) GetLatestSummary(ctx context.Context, transcriptionID string) (*models.Summary, error) {
	var summary models.Summary
	err := r.db.WithContext(ctx).Where("transcription_id = ?", transcriptionID).Order("created_at DESC").First(&summary).Error
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (r *summaryRepository) DeleteByTranscriptionID(ctx context.Context, transcriptionID string) error {
	return r.db.WithContext(ctx).Where("transcription_id = ?", transcriptionID).Delete(&models.Summary{}).Error
}

// ChatRepository handles chat sessions and messages
type ChatRepository interface {
	Repository[models.ChatSession]
	GetSessionWithMessages(ctx context.Context, id string) (*models.ChatSession, error)
	GetSessionWithTranscription(ctx context.Context, id string) (*models.ChatSession, error)
	AddMessage(ctx context.Context, message *models.ChatMessage) error
	ListByJob(ctx context.Context, jobID string) ([]models.ChatSession, error)
	ListByJobAndUser(ctx context.Context, jobID string, userID uint) ([]models.ChatSession, error)
	DeleteSession(ctx context.Context, id string) error
	GetMessages(ctx context.Context, sessionID string, limit int) ([]models.ChatMessage, error)
	DeleteByJobID(ctx context.Context, jobID string) error
	GetMessageCountsBySessionIDs(ctx context.Context, sessionIDs []string) (map[string]int64, error)
	GetLastMessagesBySessionIDs(ctx context.Context, sessionIDs []string) (map[string]*models.ChatMessage, error)
}

type chatRepository struct {
	*BaseRepository[models.ChatSession]
}

func NewChatRepository(db *gorm.DB) ChatRepository {
	return &chatRepository{
		BaseRepository: NewBaseRepository[models.ChatSession](db),
	}
}

func (r *chatRepository) GetSessionWithMessages(ctx context.Context, id string) (*models.ChatSession, error) {
	var session models.ChatSession
	err := r.db.WithContext(ctx).Preload("Messages").Where("id = ?", id).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *chatRepository) GetSessionWithTranscription(ctx context.Context, id string) (*models.ChatSession, error) {
	var session models.ChatSession
	err := r.db.WithContext(ctx).Preload("Transcription").Where("id = ?", id).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *chatRepository) AddMessage(ctx context.Context, message *models.ChatMessage) error {
	return r.db.WithContext(ctx).Create(message).Error
}

func (r *chatRepository) ListByJob(ctx context.Context, jobID string) ([]models.ChatSession, error) {
	var sessions []models.ChatSession
	err := r.db.WithContext(ctx).Where("transcription_id = ?", jobID).Order("created_at DESC").Find(&sessions).Error
	if err != nil {
		return nil, err
	}
	return sessions, nil
}

func (r *chatRepository) ListByJobAndUser(ctx context.Context, jobID string, userID uint) ([]models.ChatSession, error) {
	var sessions []models.ChatSession
	err := r.db.WithContext(ctx).
		Where("transcription_id = ? AND user_id = ?", jobID, userID).
		Order("created_at DESC").
		Find(&sessions).Error
	return sessions, err
}

func (r *chatRepository) DeleteSession(ctx context.Context, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Delete messages first
		if err := tx.Where("chat_session_id = ?", id).Delete(&models.ChatMessage{}).Error; err != nil {
			return err
		}
		// Delete session
		return tx.Delete(&models.ChatSession{}, "id = ?", id).Error
	})
}

func (r *chatRepository) DeleteByJobID(ctx context.Context, jobID string) error {
	// Find all sessions for this job
	var sessions []models.ChatSession
	if err := r.db.WithContext(ctx).Where("transcription_id = ?", jobID).Find(&sessions).Error; err != nil {
		return err
	}

	// Delete each session (which deletes messages)
	for _, session := range sessions {
		if err := r.DeleteSession(ctx, session.ID); err != nil {
			return err
		}
	}
	return nil
}

func (r *chatRepository) GetMessages(ctx context.Context, sessionID string, limit int) ([]models.ChatMessage, error) {
	var messages []models.ChatMessage
	query := r.db.WithContext(ctx).Where("chat_session_id = ?", sessionID).Order("created_at ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *chatRepository) GetMessageCountsBySessionIDs(ctx context.Context, sessionIDs []string) (map[string]int64, error) {
	if len(sessionIDs) == 0 {
		return make(map[string]int64), nil
	}

	type MessageCount struct {
		SessionID string `gorm:"column:session_id"`
		Count     int64  `gorm:"column:count"`
	}
	var counts []MessageCount

	err := r.db.WithContext(ctx).Model(&models.ChatMessage{}).
		Select("chat_session_id as session_id, COUNT(*) as count").
		Where("chat_session_id IN ?", sessionIDs).
		Group("chat_session_id").
		Scan(&counts).Error
	if err != nil {
		return nil, err
	}

	result := make(map[string]int64)
	for _, c := range counts {
		result[c.SessionID] = c.Count
	}
	return result, nil
}

func (r *chatRepository) GetLastMessagesBySessionIDs(ctx context.Context, sessionIDs []string) (map[string]*models.ChatMessage, error) {
	if len(sessionIDs) == 0 {
		return make(map[string]*models.ChatMessage), nil
	}

	var lastMessages []models.ChatMessage
	err := r.db.WithContext(ctx).Where(`id IN (
		SELECT id FROM chat_messages cm1
		WHERE cm1.chat_session_id IN ? 
		AND cm1.created_at = (
			SELECT MAX(cm2.created_at) 
			FROM chat_messages cm2 
			WHERE cm2.chat_session_id = cm1.chat_session_id
		)
	)`, sessionIDs).Find(&lastMessages).Error
	if err != nil {
		return nil, err
	}

	result := make(map[string]*models.ChatMessage)
	for i := range lastMessages {
		result[lastMessages[i].ChatSessionID] = &lastMessages[i]
	}
	return result, nil
}

// NoteRepository handles notes
type NoteRepository interface {
	Repository[models.Note]
	ListByJob(ctx context.Context, jobID string) ([]models.Note, error)
	DeleteByTranscriptionID(ctx context.Context, transcriptionID string) error
}

type noteRepository struct {
	*BaseRepository[models.Note]
}

func NewNoteRepository(db *gorm.DB) NoteRepository {
	return &noteRepository{
		BaseRepository: NewBaseRepository[models.Note](db),
	}
}

func (r *noteRepository) ListByJob(ctx context.Context, jobID string) ([]models.Note, error) {
	var notes []models.Note
	err := r.db.WithContext(ctx).Where("transcription_id = ?", jobID).Order("created_at DESC").Find(&notes).Error
	if err != nil {
		return nil, err
	}
	return notes, nil
}

func (r *noteRepository) DeleteByTranscriptionID(ctx context.Context, transcriptionID string) error {
	return r.db.WithContext(ctx).Where("transcription_id = ?", transcriptionID).Delete(&models.Note{}).Error
}

// SpeakerMappingRepository handles speaker mappings
type SpeakerMappingRepository interface {
	Repository[models.SpeakerMapping]
	ListByJob(ctx context.Context, jobID string) ([]models.SpeakerMapping, error)
	UpdateMappings(ctx context.Context, jobID string, mappings []models.SpeakerMapping) error
	DeleteByJobID(ctx context.Context, jobID string) error
}

type speakerMappingRepository struct {
	*BaseRepository[models.SpeakerMapping]
}

func NewSpeakerMappingRepository(db *gorm.DB) SpeakerMappingRepository {
	return &speakerMappingRepository{
		BaseRepository: NewBaseRepository[models.SpeakerMapping](db),
	}
}

func (r *speakerMappingRepository) ListByJob(ctx context.Context, jobID string) ([]models.SpeakerMapping, error) {
	var mappings []models.SpeakerMapping
	err := r.db.WithContext(ctx).Where("transcription_job_id = ?", jobID).Find(&mappings).Error
	if err != nil {
		return nil, err
	}
	return mappings, nil
}

func (r *speakerMappingRepository) DeleteByJobID(ctx context.Context, jobID string) error {
	return r.db.WithContext(ctx).Where("transcription_job_id = ?", jobID).Delete(&models.SpeakerMapping{}).Error
}

func (r *speakerMappingRepository) UpdateMappings(ctx context.Context, jobID string, mappings []models.SpeakerMapping) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, m := range mappings {
			var existing models.SpeakerMapping
			err := tx.Where("transcription_job_id = ? AND original_speaker = ?", jobID, m.OriginalSpeaker).
				First(&existing).Error
			if err == gorm.ErrRecordNotFound {
				m.TranscriptionJobID = jobID
				if err := tx.Create(&m).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				if err := tx.Model(&existing).Update("custom_name", m.CustomName).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// RefreshTokenRepository handles refresh token operations
type RefreshTokenRepository interface {
	Create(ctx context.Context, token *models.RefreshToken) error
	FindByHash(ctx context.Context, hash string) (*models.RefreshToken, error)
	Revoke(ctx context.Context, id uint) error
	RevokeByHash(ctx context.Context, hash string) error
	RevokeByUserID(ctx context.Context, userID uint) error
}

type refreshTokenRepository struct {
	db *gorm.DB
}

func NewRefreshTokenRepository(db *gorm.DB) RefreshTokenRepository {
	return &refreshTokenRepository{db: db}
}

func (r *refreshTokenRepository) Create(ctx context.Context, token *models.RefreshToken) error {
	return r.db.WithContext(ctx).Create(token).Error
}

func (r *refreshTokenRepository) FindByHash(ctx context.Context, hash string) (*models.RefreshToken, error) {
	var token models.RefreshToken
	err := r.db.WithContext(ctx).Where("hashed = ?", hash).First(&token).Error
	if err != nil {
		return nil, err
	}
	return &token, nil
}

func (r *refreshTokenRepository) Revoke(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Model(&models.RefreshToken{}).Where("id = ?", id).Update("revoked", true).Error
}

func (r *refreshTokenRepository) RevokeByHash(ctx context.Context, hash string) error {
	return r.db.WithContext(ctx).Model(&models.RefreshToken{}).Where("hashed = ?", hash).Update("revoked", true).Error
}

func (r *refreshTokenRepository) RevokeByUserID(ctx context.Context, userID uint) error {
	return r.db.WithContext(ctx).Model(&models.RefreshToken{}).Where("user_id = ?", userID).Update("revoked", true).Error
}

// CollectionRepository handles collection operations.
type CollectionRepository interface {
	Create(ctx context.Context, c *models.Collection) error
	FindByID(ctx context.Context, id string, userID uint) (*models.Collection, error)
	ListByUser(ctx context.Context, userID uint) ([]models.Collection, error)
	Update(ctx context.Context, c *models.Collection) error
	Delete(ctx context.Context, id string, userID uint) error
	AddRecordings(ctx context.Context, collectionID string, recordingIDs []string) error
	RemoveRecording(ctx context.Context, collectionID string, recordingID string) error
	ListRecordings(ctx context.Context, collectionID string) ([]models.TranscriptionJob, error)
	ListByRecording(ctx context.Context, recordingID string, userID uint) ([]models.Collection, error)
}

type collectionRepository struct {
	db *gorm.DB
}

func NewCollectionRepository(db *gorm.DB) CollectionRepository {
	return &collectionRepository{db: db}
}

func (r *collectionRepository) Create(ctx context.Context, c *models.Collection) error {
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *collectionRepository) FindByID(ctx context.Context, id string, userID uint) (*models.Collection, error) {
	var c models.Collection
	err := r.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	// Populate recording count.
	var count int64
	r.db.WithContext(ctx).Model(&models.CollectionRecording{}).
		Where("collection_id = ?", id).Count(&count)
	c.RecordingCount = int(count)
	return &c, nil
}

func (r *collectionRepository) ListByUser(ctx context.Context, userID uint) ([]models.Collection, error) {
	var collections []models.Collection
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&collections).Error; err != nil {
		return nil, err
	}
	// Populate counts in a single query.
	if len(collections) == 0 {
		return collections, nil
	}
	type countRow struct {
		CollectionID string
		Count        int
	}
	var rows []countRow
	r.db.WithContext(ctx).
		Model(&models.CollectionRecording{}).
		Select("collection_id, count(*) as count").
		Group("collection_id").
		Scan(&rows)
	countMap := make(map[string]int, len(rows))
	for _, row := range rows {
		countMap[row.CollectionID] = row.Count
	}
	for i := range collections {
		collections[i].RecordingCount = countMap[collections[i].ID]
	}
	return collections, nil
}

func (r *collectionRepository) Update(ctx context.Context, c *models.Collection) error {
	return r.db.WithContext(ctx).Save(c).Error
}

func (r *collectionRepository) Delete(ctx context.Context, id string, userID uint) error {
	// Delete join table entries first, then the collection.
	if err := r.db.WithContext(ctx).
		Where("collection_id = ?", id).
		Delete(&models.CollectionRecording{}).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&models.Collection{}).Error
}

func (r *collectionRepository) AddRecordings(ctx context.Context, collectionID string, recordingIDs []string) error {
	rows := make([]models.CollectionRecording, 0, len(recordingIDs))
	for _, rid := range recordingIDs {
		rows = append(rows, models.CollectionRecording{
			CollectionID: collectionID,
			RecordingID:  rid,
		})
	}
	// INSERT OR IGNORE to avoid duplicate errors.
	return r.db.WithContext(ctx).
		Exec("INSERT OR IGNORE INTO collection_recordings (collection_id, recording_id, created_at) VALUES "+
			buildInsertPlaceholders(len(rows)), buildInsertArgs(rows)...).Error
}

func (r *collectionRepository) RemoveRecording(ctx context.Context, collectionID string, recordingID string) error {
	return r.db.WithContext(ctx).
		Where("collection_id = ? AND recording_id = ?", collectionID, recordingID).
		Delete(&models.CollectionRecording{}).Error
}

func (r *collectionRepository) ListRecordings(ctx context.Context, collectionID string) ([]models.TranscriptionJob, error) {
	var jobs []models.TranscriptionJob
	err := r.db.WithContext(ctx).
		Joins("JOIN collection_recordings cr ON cr.recording_id = transcription_jobs.id").
		Where("cr.collection_id = ? AND transcription_jobs.deleted_at IS NULL", collectionID).
		Order("cr.created_at DESC").
		Find(&jobs).Error
	return jobs, err
}

func (r *collectionRepository) ListByRecording(ctx context.Context, recordingID string, userID uint) ([]models.Collection, error) {
	var collections []models.Collection
	err := r.db.WithContext(ctx).
		Joins("JOIN collection_recordings cr ON cr.collection_id = collections.id").
		Where("cr.recording_id = ? AND collections.user_id = ? AND collections.deleted_at IS NULL", recordingID, userID).
		Find(&collections).Error
	return collections, err
}

// buildInsertPlaceholders creates "(?,?,?),(?,?,?)..." for n rows.
func buildInsertPlaceholders(n int) string {
	if n == 0 {
		return ""
	}
	s := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			s += ","
		}
		s += "(?,?,CURRENT_TIMESTAMP)"
	}
	return s
}

func buildInsertArgs(rows []models.CollectionRecording) []interface{} {
	args := make([]interface{}, 0, len(rows)*2)
	for _, r := range rows {
		args = append(args, r.CollectionID, r.RecordingID)
	}
	return args
}
