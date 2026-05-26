package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Collection groups recordings together for batch operations.
type Collection struct {
	ID          string         `json:"id" gorm:"primaryKey;type:varchar(36)"`
	UserID      uint           `json:"user_id" gorm:"not null;index"`
	Name        string         `json:"name" gorm:"type:text;not null"`
	Description *string        `json:"description,omitempty" gorm:"type:text"`
	Color       string         `json:"color" gorm:"type:varchar(20);default:'#6366f1'"`
	CreatedAt   time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
	DeletedAt   gorm.DeletedAt `json:"deleted_at,omitempty" gorm:"index" swaggertype:"string"`

	// Virtual field populated by ListByUser — not stored in DB.
	RecordingCount int `json:"recording_count" gorm:"-"`
}

// CollectionRecording is the join table linking collections to recordings.
type CollectionRecording struct {
	CollectionID string    `json:"collection_id" gorm:"primaryKey;type:varchar(36);index"`
	RecordingID  string    `json:"recording_id" gorm:"primaryKey;type:varchar(36);index"`
	CreatedAt    time.Time `json:"created_at" gorm:"autoCreateTime"`
}

func (c *Collection) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	return nil
}
