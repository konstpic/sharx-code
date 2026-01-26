package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v2/config"
	"github.com/mhsanaei/3x-ui/v2/database"
	"github.com/mhsanaei/3x-ui/v2/util/crypto"
	"github.com/mhsanaei/3x-ui/v2/web/entity"
	"github.com/mhsanaei/3x-ui/v2/web/service"
	"github.com/mhsanaei/3x-ui/v2/web/session"

	"github.com/gin-gonic/gin"
)

// updateUserForm represents the form for updating user credentials.
type updateUserForm struct {
	OldUsername string `json:"oldUsername" form:"oldUsername"`
	OldPassword string `json:"oldPassword" form:"oldPassword"`
	NewUsername string `json:"newUsername" form:"newUsername"`
	NewPassword string `json:"newPassword" form:"newPassword"`
}

// SettingController handles settings and user management operations.
type SettingController struct {
	settingService  service.SettingService
	userService     service.UserService
	panelService    service.PanelService
	bugReportService service.BugReportService
}

// NewSettingController creates a new SettingController and initializes its routes.
func NewSettingController(g *gin.RouterGroup) *SettingController {
	a := &SettingController{}
	a.initRouter(g)
	return a
}

// initRouter sets up the routes for settings management.
func (a *SettingController) initRouter(g *gin.RouterGroup) {
	g = g.Group("/setting")

	g.POST("/all", a.getAllSetting)
	g.POST("/defaultSettings", a.getDefaultSettings)
	g.POST("/update", a.updateSetting)
	g.POST("/updateUser", a.updateUser)
	g.POST("/restartPanel", a.restartPanel)
	g.GET("/getDefaultJsonConfig", a.getDefaultXrayConfig)

	// Bug report endpoints
	g.POST("/submitBugReport", a.submitBugReport)
	g.GET("/bugReport/:id/status", a.getBugReportStatus)
	g.GET("/bugReports", a.getBugReports)

	// Initialize migration controller
	NewMigrationController(g)
}

// getAllSetting retrieves all current settings.
func (a *SettingController) getAllSetting(c *gin.Context) {
	allSetting, err := a.settingService.GetAllSetting()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.getSettings"), err)
		return
	}
	jsonObj(c, allSetting, nil)
}

// getDefaultSettings retrieves the default settings based on the host.
func (a *SettingController) getDefaultSettings(c *gin.Context) {
	result, err := a.settingService.GetDefaultSettings(c.Request.Host)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.getSettings"), err)
		return
	}
	jsonObj(c, result, nil)
}

// updateSetting updates all settings with the provided data.
func (a *SettingController) updateSetting(c *gin.Context) {
	allSetting := &entity.AllSetting{}
	err := c.ShouldBind(allSetting)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifySettings"), err)
		return
	}
	err = a.settingService.UpdateAllSetting(allSetting)
	jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifySettings"), err)
}

// updateUser updates the current user's username and password.
func (a *SettingController) updateUser(c *gin.Context) {
	form := &updateUserForm{}
	err := c.ShouldBind(form)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifySettings"), err)
		return
	}
	user := session.GetLoginUser(c)
	if user.Username != form.OldUsername || !crypto.CheckPasswordHash(user.Password, form.OldPassword) {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifyUserError"), errors.New(I18nWeb(c, "pages.settings.toasts.originalUserPassIncorrect")))
		return
	}
	if form.NewUsername == "" || form.NewPassword == "" {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifyUserError"), errors.New(I18nWeb(c, "pages.settings.toasts.userPassMustBeNotEmpty")))
		return
	}
	err = a.userService.UpdateUser(user.Id, form.NewUsername, form.NewPassword)
	if err == nil {
		user.Username = form.NewUsername
		user.Password, _ = crypto.HashPasswordAsBcrypt(form.NewPassword)
		session.SetLoginUser(c, user)
	}
	jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifyUser"), err)
}

// restartPanel restarts the panel service after a delay.
func (a *SettingController) restartPanel(c *gin.Context) {
	err := a.panelService.RestartPanel(time.Second * 3)
	jsonMsg(c, I18nWeb(c, "pages.settings.restartPanelSuccess"), err)
}

// getDefaultXrayConfig retrieves the default Xray configuration.
func (a *SettingController) getDefaultXrayConfig(c *gin.Context) {
	defaultJsonConfig, err := a.settingService.GetDefaultXrayConfig()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.getSettings"), err)
		return
	}
	jsonObj(c, defaultJsonConfig, nil)
}

// submitBugReport submits a bug report to the bug report service.
func (a *SettingController) submitBugReport(c *gin.Context) {
	bugReportURL := os.Getenv("BUG_REPORT_SERVICE_URL")
	if bugReportURL == "" {
		bugReportURL = getDefaultBugReportURL()
	}

	// Parse multipart form
	err := c.Request.ParseMultipartForm(10 << 20) // 10 MB max
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), err)
		return
	}

	// Get form values
	appVersion := c.PostForm("app_version")
	title := c.PostForm("title")
	description := c.PostForm("description")
	platform := c.PostForm("platform")
	logs := c.PostForm("logs")

	// Validate required fields
	if appVersion == "" || title == "" || description == "" || platform == "" {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), errors.New(I18nWeb(c, "pages.settings.bugReport.missingFields")))
		return
	}

	// Use panel version if app_version is empty or default
	if appVersion == "" {
		appVersion = config.GetVersion()
	}

	// Automatically fetch panel error logs and append to logs field
	serverService := service.ServerService{}
	panelLogs := serverService.GetLogs("50", "error", "false")
	if len(panelLogs) > 0 {
		// Format logs: extract message part after " - " and join with newlines
		var formattedLogs []string
		for _, log := range panelLogs {
			if log == "" {
				continue
			}
			// Extract message part after " - "
			parts := strings.SplitN(log, " - ", 2)
			if len(parts) > 1 {
				formattedLogs = append(formattedLogs, parts[1])
			} else {
				formattedLogs = append(formattedLogs, log)
			}
		}
		if len(formattedLogs) > 0 {
			panelLogsText := strings.Join(formattedLogs, "\n")
			if logs != "" {
				logs = logs + "\n\n--- Panel Error Logs (automatically attached) ---\n" + panelLogsText
			} else {
				logs = "--- Panel Error Logs (automatically attached) ---\n" + panelLogsText
			}
		}
	}

	// Create multipart form data
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)

	// Add form fields
	writer.WriteField("app_version", appVersion)
	writer.WriteField("title", title)
	writer.WriteField("description", description)
	writer.WriteField("platform", platform)
	if logs != "" {
		writer.WriteField("logs", logs)
	}

	// Add files
	form, err := c.MultipartForm()
	if err == nil && form.File != nil {
		files := form.File["files"]
		for _, fileHeader := range files {
			file, err := fileHeader.Open()
			if err != nil {
				continue
			}

			part, err := writer.CreateFormFile("files", fileHeader.Filename)
			if err != nil {
				file.Close()
				continue
			}
			io.Copy(part, file)
			file.Close()
		}
	}

	writer.Close()

	// Send request to bug report service
	req, err := http.NewRequest("POST", bugReportURL+"/api/bug-report", &requestBody)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), err)
		return
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), err)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), err)
		return
	}

	if resp.StatusCode != http.StatusCreated {
		var errorResp map[string]interface{}
		if err := json.Unmarshal(body, &errorResp); err == nil {
			if detail, ok := errorResp["detail"].(string); ok {
				jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), errors.New(detail))
				return
			}
		}
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), fmt.Errorf("status code: %d", resp.StatusCode))
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.submitError"), err)
		return
	}

	// Save to database
	user := session.GetLoginUser(c)
	reportId, ok := result["id"].(string)
	if !ok {
		// Try to get from different field names
		if id, ok := result["report_id"].(string); ok {
			reportId = id
		} else if id, ok := result["reportId"].(string); ok {
			reportId = id
		}
	}
	
	if reportId != "" {
		taigaTaskId, _ := result["taiga_task_id"].(float64)
		taigaTaskRef, _ := result["taiga_task_ref"].(string)
		status, _ := result["status"].(string)
		
		var taskIdPtr *int
		if taigaTaskId > 0 {
			taskId := int(taigaTaskId)
			taskIdPtr = &taskId
		}
		
		// Try to get existing report or create new one
		existingReport, err := a.bugReportService.GetBugReport(reportId)
		if err != nil || existingReport == nil {
			// Create new report in DB with the same ID from bug report service
			_, err = a.bugReportService.CreateBugReportWithId(reportId, user.Id, appVersion, title, description, logs, platform)
			
			if err == nil && taskIdPtr != nil {
				a.bugReportService.UpdateBugReportTaigaInfo(reportId, taskIdPtr, taigaTaskRef)
			}
		} else {
			// Update existing report
			if taskIdPtr != nil {
				a.bugReportService.UpdateBugReportTaigaInfo(reportId, taskIdPtr, taigaTaskRef)
			}
			if status != "" {
				a.bugReportService.UpdateBugReportStatus(reportId, status)
			}
		}
	}

	jsonObj(c, result, nil)
}

// getBugReportStatus retrieves the status of a bug report.
func (a *SettingController) getBugReportStatus(c *gin.Context) {
	reportID := c.Param("id")
	if reportID == "" {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), errors.New("report ID is required"))
		return
	}

	user := session.GetLoginUser(c)
	
	// Always sync with bug-report-service first (which syncs with Taiga)
	// This ensures we get the latest status from Taiga API
	bugReportURL := os.Getenv("BUG_REPORT_SERVICE_URL")
	if bugReportURL == "" {
		bugReportURL = getDefaultBugReportURL()
	}

	// Send request to bug report service
	url := fmt.Sprintf("%s/api/bug-report/%s", bugReportURL, reportID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), err)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), err)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), err)
		return
	}

	if resp.StatusCode == http.StatusNotFound {
		// Bug report not found in service - check if it exists in panel database
		// If it exists, mark it as deleted (user story was deleted in Taiga)
		existingReport, err := a.bugReportService.GetBugReport(reportID)
		if err == nil && existingReport != nil {
			// Update status to deleted in panel database
			a.bugReportService.UpdateBugReportStatus(reportID, "deleted")
			// Return deleted status
			jsonObj(c, map[string]interface{}{
				"status":         "deleted",
				"taiga_task_id":   existingReport.TaigaTaskId,
				"taiga_task_ref":  existingReport.TaigaTaskRef,
			}, nil)
			return
		}
		// Report doesn't exist in panel database either
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), errors.New("Bug report not found"))
		return
	}

	if resp.StatusCode != http.StatusOK {
		var errorResp map[string]interface{}
		if err := json.Unmarshal(body, &errorResp); err == nil {
			if detail, ok := errorResp["detail"].(string); ok {
				jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), errors.New(detail))
				return
			}
		}
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), fmt.Errorf("status code: %d", resp.StatusCode))
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), err)
		return
	}

	// Update database with synced status from service (which syncs with Taiga)
	if status, ok := result["status"].(string); ok {
		taigaTaskRef, _ := result["taiga_task_ref"].(string)
		taigaTaskId, _ := result["taiga_task_id"].(float64)
		
		var taskIdPtr *int
		if taigaTaskId > 0 {
			taskId := int(taigaTaskId)
			taskIdPtr = &taskId
		}
		
		// Update or create in database
		existingReport, _ := a.bugReportService.GetBugReport(reportID)
		if existingReport == nil {
			// Create if doesn't exist (with minimal data from service response)
			now := time.Now().Unix()
			database.GetDB().Exec(`
				INSERT INTO bug_reports (id, user_id, app_version, title, description, logs, platform, status, taiga_task_id, taiga_task_ref, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, reportID, user.Id, "", "", "", "", "", status, taskIdPtr, taigaTaskRef, now, now)
		} else {
			// Update existing - status is already synced from Taiga by bug-report-service
			if taskIdPtr != nil {
				a.bugReportService.UpdateBugReportTaigaInfo(reportID, taskIdPtr, taigaTaskRef)
			}
			if status != "" && status != existingReport.Status {
				a.bugReportService.UpdateBugReportStatus(reportID, status)
			}
		}
	}

	jsonObj(c, result, nil)
}

// getBugReports retrieves all bug reports for the current user.
func (a *SettingController) getBugReports(c *gin.Context) {
	user := session.GetLoginUser(c)
	reports, err := a.bugReportService.GetBugReports(user.Id, 50)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.bugReport.statusError"), err)
		return
	}
	
	jsonObj(c, reports, nil)
}
