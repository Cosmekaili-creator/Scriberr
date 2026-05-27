package repository

import (
	"context"

	"ascribe/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserUsageRepository tracks per-user resource usage
type UserUsageRepository interface {
	Get(ctx context.Context, userID uint) (*models.UserUsage, error)
	Upsert(ctx context.Context, userID uint, diskDelta int64, secondsDelta int64, jobsCompletedDelta int64) error
}

type userUsageRepository struct {
	db *gorm.DB
}

func NewUserUsageRepository(db *gorm.DB) UserUsageRepository {
	return &userUsageRepository{db: db}
}

func (r *userUsageRepository) Get(ctx context.Context, userID uint) (*models.UserUsage, error) {
	var u models.UserUsage
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *userUsageRepository) Upsert(ctx context.Context, userID uint, diskDelta int64, secondsDelta int64, jobsCompletedDelta int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var u models.UserUsage
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", userID).
			FirstOrCreate(&u, models.UserUsage{UserID: userID}).Error
		if err != nil {
			return err
		}
		u.DiskBytes += diskDelta
		if u.DiskBytes < 0 {
			u.DiskBytes = 0
		}
		u.TranscriptionSeconds += secondsDelta
		u.JobsCompleted += jobsCompletedDelta
		return tx.Save(&u).Error
	})
}
