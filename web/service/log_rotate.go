package service

import (
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/entity"
)

// ApplyLogRotateFromSettings configures on-disk log rotation from panel settings.
func ApplyLogRotateFromSettings(s *entity.AllSetting) {
	if s == nil {
		return
	}
	logger.ConfigureRotate(logger.RotateConfig{
		MaxSizeMB:  clampInt(s.LogRotateMaxSizeMB, 1, 1024, 50),
		MaxAgeDays: clampInt(s.LogRotateMaxAgeDays, 1, 365, 14),
		MaxBackups: clampInt(s.LogRotateMaxBackups, 1, 100, 5),
		Compress:   s.LogRotateCompress,
	})
}

func clampInt(v, min, max, fallback int) int {
	if v < min || v > max {
		return fallback
	}
	return v
}

// LogRotatePayload returns rotation settings for node apply-config envelope.
func LogRotatePayload(s *entity.AllSetting) map[string]interface{} {
	if s == nil {
		return map[string]interface{}{
			"maxSizeMB":  50,
			"maxAgeDays": 14,
			"maxBackups": 5,
			"compress":   true,
		}
	}
	return map[string]interface{}{
		"maxSizeMB":  clampInt(s.LogRotateMaxSizeMB, 1, 1024, 50),
		"maxAgeDays": clampInt(s.LogRotateMaxAgeDays, 1, 365, 14),
		"maxBackups": clampInt(s.LogRotateMaxBackups, 1, 100, 5),
		"compress":   s.LogRotateCompress,
	}
}

// AuditRetentionDays is how long audit entries are kept: the same "max age" as the on-disk journals.
func AuditRetentionDays(s *entity.AllSetting) int {
	if s == nil {
		return 14
	}
	return clampInt(s.LogRotateMaxAgeDays, 1, 365, 14)
}
