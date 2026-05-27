package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ascribe/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// adminID holds the promoted admin's ID after AutoMigrate + backfill; used by other packages.
var AdminID uint

// DB is the global database instance
var DB *gorm.DB

// Initialize initializes the database connection with optimized settings
func Initialize(dbPath string) error {
	var err error

	// Create database directory if it doesn't exist
	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return fmt.Errorf("failed to create database directory: %v", err)
	}

	// SQLite connection string with performance optimizations
	dsn := fmt.Sprintf("%s?"+
		"_pragma=foreign_keys(1)&"+ // Enable foreign keys
		"_pragma=journal_mode(WAL)&"+ // Use WAL mode for better concurrency
		"_pragma=synchronous(NORMAL)&"+ // Balance between safety and performance
		"_pragma=cache_size(-64000)&"+ // 64MB cache size
		"_pragma=temp_store(MEMORY)&"+ // Store temp tables in memory
		"_pragma=mmap_size(268435456)&"+ // 256MB mmap size
		"_timeout=30000", // 30 second timeout
		dbPath)

	// Open database connection with optimized config
	DB, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger:          logger.Default.LogMode(logger.Warn), // Reduce logging overhead
		CreateBatchSize: 100,                                 // Optimize batch inserts
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %v", err)
	}

	// Get underlying sql.DB for connection pool configuration
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %v", err)
	}

	// Configure connection pool for optimal performance
	sqlDB.SetMaxOpenConns(10)                  // SQLite generally works well with lower connection counts
	sqlDB.SetMaxIdleConns(5)                   // Keep some connections idle
	sqlDB.SetConnMaxLifetime(30 * time.Minute) // Reset connections every 30 minutes
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)  // Close idle connections after 5 minutes

	// Auto migrate the schema
	if err := DB.AutoMigrate(
		&models.TranscriptionJob{},
		&models.TranscriptionJobExecution{},
		&models.SpeakerMapping{},
		&models.MultiTrackFile{},
		&models.User{},
		&models.APIKey{},
		&models.TranscriptionProfile{},
		&models.LLMConfig{},
		&models.ChatSession{},
		&models.ChatMessage{},
		&models.SummaryTemplate{},
		&models.SummarySetting{},
		&models.Summary{},
		&models.Note{},
		&models.RefreshToken{},
		&models.Collection{},
		&models.CollectionRecording{},
		&models.UserUsage{},
		&models.PasswordResetToken{},
	); err != nil {
		return fmt.Errorf("failed to auto migrate: %v", err)
	}

	// Multi-user backfill (idempotent — safe to re-run on every boot)
	// 1. Promote the earliest user to admin
	if err := DB.Exec(`
		UPDATE users SET role = 'admin'
		WHERE id = (SELECT MIN(id) FROM users)
		  AND (role IS NULL OR role = '' OR role = 'user')
	`).Error; err != nil {
		return fmt.Errorf("backfill admin role: %v", err)
	}
	// 2. Default all remaining users to 'user' role
	if err := DB.Exec(`UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''`).Error; err != nil {
		return fmt.Errorf("backfill user role: %v", err)
	}
	// 3. Mark all existing users active
	if err := DB.Exec(`UPDATE users SET is_active = 1 WHERE is_active IS NULL`).Error; err != nil {
		return fmt.Errorf("backfill is_active: %v", err)
	}
	// 4. Backfill user_id = admin's ID on legacy single-user tables
	var adminID uint
	if err := DB.Raw(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`).Scan(&adminID).Error; err == nil && adminID > 0 {
		AdminID = adminID
		for _, q := range []string{
			`UPDATE transcription_jobs SET user_id = ? WHERE user_id IS NULL OR user_id = 0`,
			`UPDATE notes SET user_id = ? WHERE user_id IS NULL OR user_id = 0`,
			`UPDATE summaries SET user_id = ? WHERE user_id IS NULL OR user_id = 0`,
			`UPDATE chat_sessions SET user_id = ? WHERE user_id IS NULL OR user_id = 0`,
			`UPDATE api_keys SET user_id = ? WHERE user_id IS NULL OR user_id = 0`,
			// Profiles and templates: leave owner_user_id NULL (global) for existing rows.
		} {
			if err := DB.Exec(q, adminID).Error; err != nil {
				return fmt.Errorf("backfill user_id on legacy data: %v", err)
			}
		}
		// 5. Seed user_usage row for admin if missing
		DB.Exec(`INSERT OR IGNORE INTO user_usages (user_id, disk_bytes, transcription_seconds, llm_cost_cents, jobs_completed, updated_at) VALUES (?, 0, 0, 0, 0, CURRENT_TIMESTAMP)`, adminID)
	}

	// Cleanup duplicate speaker mappings before creating unique index (for backward compatibility)
	// Keep the latest mapping for each (job_id, original_speaker) pair
	cleanupQuery := `
		DELETE FROM speaker_mappings 
		WHERE id NOT IN (
			SELECT MAX(id) 
			FROM speaker_mappings 
			GROUP BY transcription_job_id, original_speaker
		)
	`
	if err := DB.Exec(cleanupQuery).Error; err != nil {
		// Log warning but continue, as table might not exist yet or query might fail for other reasons
		// We don't want to block startup if this fails, but index creation might fail next.
		fmt.Printf("Warning: Failed to cleanup duplicate speaker mappings: %v\n", err)
	}

	// Add unique constraint for speaker mappings (transcription_job_id + original_speaker)
	if err := DB.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_speaker_mappings_unique ON speaker_mappings(transcription_job_id, original_speaker)").Error; err != nil {
		return fmt.Errorf("failed to create unique constraint for speaker mappings: %v", err)
	}

	return nil
}

// Close closes the database connection gracefully
func Close() error {
	if DB == nil {
		return nil
	}
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	err = sqlDB.Close()
	DB = nil // Set to nil after closing
	return err
}

// HealthCheck performs a health check on the database connection
func HealthCheck() error {
	if DB == nil {
		return fmt.Errorf("database connection is nil")
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %v", err)
	}

	// Test the connection with a ping
	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("database ping failed: %v", err)
	}

	return nil
}

// GetConnectionStats returns database connection pool statistics
func GetConnectionStats() sql.DBStats {
	if DB == nil {
		return sql.DBStats{}
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return sql.DBStats{}
	}

	return sqlDB.Stats()
}
