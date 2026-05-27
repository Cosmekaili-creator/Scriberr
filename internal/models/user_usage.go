package models

import "time"

// UserUsage aggregates resource consumption per user.
// Writes happen on job completion; TranscriptionSeconds and LLMCostCents are reserved for Phase 2.
type UserUsage struct {
	UserID               uint      `json:"user_id" gorm:"primaryKey"`
	DiskBytes            int64     `json:"disk_bytes" gorm:"not null;default:0"`
	TranscriptionSeconds int64     `json:"transcription_seconds" gorm:"not null;default:0"`
	LLMCostCents         int64     `json:"llm_cost_cents" gorm:"not null;default:0"`
	JobsCompleted        int64     `json:"jobs_completed" gorm:"not null;default:0"`
	UpdatedAt            time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}
