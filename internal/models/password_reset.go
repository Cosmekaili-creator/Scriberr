package models

import "time"

// PasswordResetToken reserves the table for Phase 2 self-service password reset via email.
type PasswordResetToken struct {
	ID        uint       `json:"id" gorm:"primaryKey"`
	UserID    uint       `json:"user_id" gorm:"not null;index"`
	Hashed    string     `json:"-" gorm:"not null;uniqueIndex;type:varchar(128)"`
	ExpiresAt time.Time  `json:"expires_at" gorm:"not null;index"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `json:"created_at" gorm:"autoCreateTime"`
}
