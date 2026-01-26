// Package service provides BugReport management service.
package service

import (
	"time"

	"github.com/mhsanaei/3x-ui/v2/database"
	"github.com/mhsanaei/3x-ui/v2/database/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BugReportService provides business logic for managing bug reports.
type BugReportService struct{}

// CreateBugReport creates a new bug report in the database.
// If reportId is provided, it will be used; otherwise a new UUID will be generated.
func (s *BugReportService) CreateBugReport(userId int, appVersion, title, description, logs, platform string) (*model.BugReport, error) {
	return s.CreateBugReportWithId("", userId, appVersion, title, description, logs, platform)
}

// CreateBugReportWithId creates a new bug report in the database with a specific ID.
func (s *BugReportService) CreateBugReportWithId(reportId string, userId int, appVersion, title, description, logs, platform string) (*model.BugReport, error) {
	db := database.GetDB()
	
	// Generate UUID if not provided
	if reportId == "" {
		reportId = uuid.New().String()
	}
	
	now := time.Now().Unix()
	
	// Use raw SQL to insert with UUID
	err := db.Exec(`
		INSERT INTO bug_reports (id, user_id, app_version, title, description, logs, platform, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, reportId, userId, appVersion, title, description, logs, platform, "open", now, now).Error
	
	if err != nil {
		return nil, err
	}
	
	// Fetch the created report
	return s.GetBugReport(reportId)
}

// GetBugReport retrieves a bug report by ID.
func (s *BugReportService) GetBugReport(id string) (*model.BugReport, error) {
	db := database.GetDB()
	var report model.BugReport
	err := db.Where("id = ?", id).First(&report).Error
	if err != nil {
		return nil, err
	}
	return &report, nil
}

// UpdateBugReportTaigaInfo updates Taiga task information for a bug report.
func (s *BugReportService) UpdateBugReportTaigaInfo(id string, taigaTaskId *int, taigaTaskRef string) error {
	db := database.GetDB()
	
	updates := map[string]interface{}{
		"taiga_task_id":  taigaTaskId,
		"taiga_task_ref": taigaTaskRef,
		"updated_at":     time.Now().Unix(),
	}
	
	return db.Model(&model.BugReport{}).Where("id = ?", id).Updates(updates).Error
}

// UpdateBugReportStatus updates the status of a bug report.
func (s *BugReportService) UpdateBugReportStatus(id string, status string) error {
	db := database.GetDB()
	
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().Unix(),
	}
	
	return db.Model(&model.BugReport{}).Where("id = ?", id).Updates(updates).Error
}

// GetBugReports retrieves all bug reports for a user, ordered by creation date (newest first).
func (s *BugReportService) GetBugReports(userId int, limit int) ([]*model.BugReport, error) {
	db := database.GetDB()
	var reports []*model.BugReport
	
	query := db.Where("user_id = ?", userId).Order("created_at DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	
	err := query.Find(&reports).Error
	if err != nil {
		return nil, err
	}
	
	return reports, nil
}

// GetLatestBugReport retrieves the most recent bug report for a user.
func (s *BugReportService) GetLatestBugReport(userId int) (*model.BugReport, error) {
	db := database.GetDB()
	var report model.BugReport
	err := db.Where("user_id = ?", userId).Order("created_at DESC").First(&report).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil // No reports found, return nil without error
		}
		return nil, err
	}
	return &report, nil
}
