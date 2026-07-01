package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/global"
	"github.com/konstpic/sharx-code/v2/web/logsse"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
	"github.com/konstpic/sharx-code/v2/web/websocket"

	"github.com/gin-gonic/gin"
)

var filenameRegex = regexp.MustCompile(`^[a-zA-Z0-9_\-.]+$`)

// ServerController handles server management and status-related operations.
type ServerController struct {
	BaseController

	serverService  service.ServerService
	settingService service.SettingService
	panelService   service.PanelService

	lastStatus *service.Status

	lastVersions        []string
	lastGetVersionsTime int64 // unix seconds

	lastTelemtVersions        []string
	lastGetTelemtVersionsTime int64

	workerHostMetricsMu       sync.Mutex
	lastWorkerHostMetricsPoll time.Time
}

// NewServerController creates a new ServerController, initializes routes, and starts background tasks.
func NewServerController(g *gin.RouterGroup) *ServerController {
	a := &ServerController{}
	a.initRouter(g)
	a.startTask()
	return a
}

// initRouter sets up the routes for server status, Xray management, and utility endpoints.
func (a *ServerController) initRouter(g *gin.RouterGroup) {

	g.GET("/status", a.status)
	g.GET("/updater", a.dockerUpdaterStatus)
	g.GET("/updater/plan", a.dockerUpdaterPlan)
	g.POST("/updater/workers/prep", a.dockerUpdaterWorkersPrep)
	g.POST("/updater/workers/trigger", a.dockerUpdaterWorkersTrigger)
	g.POST("/updater/workers/finish", a.dockerUpdaterWorkersFinish)
	g.POST("/updater/panel/trigger", a.dockerUpdaterPanelTrigger)
	g.POST("/updater/trigger", a.dockerUpdaterTrigger)
	g.GET("/cpuHistory/:bucket", a.getCpuHistoryBucket)
	g.GET("/memHistory/:bucket", a.getMemHistoryBucket)
	g.GET("/diskHistory/:bucket", a.getDiskHistoryBucket)
	g.GET("/getXrayVersion", a.getXrayVersion)
	g.GET("/getTelemtVersion", a.getTelemtVersion)
	g.GET("/getConfigJson", a.getConfigJson)
	g.GET("/getDb", a.getDb)
	g.GET("/getNewUUID", a.getNewUUID)
	g.GET("/getNewX25519Cert", a.getNewX25519Cert)
	g.GET("/getNewmldsa65", a.getNewmldsa65)
	g.GET("/getNewmlkem768", a.getNewmlkem768)
	g.GET("/getNewVlessEnc", a.getNewVlessEnc)

	g.POST("/stopXrayService", a.stopXrayService)
	g.POST("/stopTelemtService", a.stopTelemtService)
	g.POST("/restartTelemtService", a.restartTelemtService)
	g.POST("/restartXrayService", a.restartXrayService)
	g.POST("/installXray/:version", a.installXray)
	g.POST("/installXrayOnNodes/:version", a.installXrayOnNodes)
	g.POST("/installTelemt/:version", a.installTelemt)
	g.POST("/installTelemtOnNodes/:version", a.installTelemtOnNodes)
	g.POST("/updateGeofile", a.updateGeofile)
	g.POST("/updateGeofile/:fileName", a.updateGeofile)
	g.POST("/uploadGeofile/:fileName", a.uploadGeofile)
	g.POST("/rollbackGeofile/:fileName", a.rollbackGeofile)
	g.POST("/downloadGeofileByUrl/:fileName", a.downloadGeofileByURL)
	g.GET("/downloadGeofileTask/:taskID", a.downloadGeofileTask)
	g.GET("/geofileAssets/:fileName", a.listGeofileAssets)
	g.POST("/geofileAssets/upload/:fileName", a.uploadGeofileAsset)
	g.POST("/geofileAssets/download/:fileName", a.downloadGeofileAsset)
	g.POST("/geofileAssets/apply/:id", a.applyGeofileAsset)
	g.POST("/geofileAssets/delete/:id", a.deleteGeofileAsset)
	g.POST("/logs/:count", a.getLogs)
	g.GET("/logs/unified/:count", a.getUnifiedLogs)
	g.GET("/logs/stream", a.getLogsSSE)
	g.POST("/xraylogs/:count", a.getXrayLogs)
	g.POST("/importDB", a.importDB)
	g.POST("/getNewEchCert", a.getNewEchCert)
	g.GET("/metrics", a.getMetrics)
}

func (a *ServerController) listGeofileAssets(c *gin.Context) {
	user := session.GetLoginUser(c)
	fileName := strings.TrimSpace(c.Param("fileName"))
	rows, err := a.serverService.ListGeofileAssets(user.Id, fileName)
	if err != nil {
		jsonMsg(c, "failed to list geofile assets", err)
		return
	}
	jsonObj(c, rows, nil)
}

func (a *ServerController) uploadGeofileAsset(c *gin.Context) {
	user := session.GetLoginUser(c)
	fileName := strings.TrimSpace(c.Param("fileName"))
	formFile, _, err := c.Request.FormFile("file")
	if err != nil {
		jsonMsg(c, "failed to read uploaded geofile", err)
		return
	}
	defer formFile.Close()
	displayName := strings.TrimSpace(c.PostForm("displayName"))
	row, err := a.serverService.UploadGeofileAsset(user.Id, fileName, formFile, displayName, "")
	if err != nil {
		jsonMsg(c, "failed to store geofile asset", err)
		return
	}
	jsonObj(c, row, nil)
}

func (a *ServerController) downloadGeofileAsset(c *gin.Context) {
	user := session.GetLoginUser(c)
	fileName := strings.TrimSpace(c.Param("fileName"))
	srcURL := strings.TrimSpace(c.PostForm("url"))
	displayName := strings.TrimSpace(c.PostForm("displayName"))
	if srcURL == "" {
		var body struct {
			URL         string `json:"url"`
			DisplayName string `json:"displayName"`
		}
		if err := c.ShouldBindJSON(&body); err == nil {
			srcURL = strings.TrimSpace(body.URL)
			if displayName == "" {
				displayName = strings.TrimSpace(body.DisplayName)
			}
		}
	}
	if srcURL == "" {
		jsonMsg(c, "url is required", fmt.Errorf("empty url"))
		return
	}
	row, err := a.serverService.DownloadGeofileAssetFromURL(user.Id, fileName, srcURL, displayName)
	if err != nil {
		jsonMsg(c, "failed to download geofile asset", err)
		return
	}
	jsonObj(c, row, nil)
}

type geofileAssetApplyResponse struct {
	Asset  *model.GeofileAsset         `json:"asset"`
	Result *service.GeofileApplyResult `json:"result"`
}

func (a *ServerController) applyGeofileAsset(c *gin.Context) {
	user := session.GetLoginUser(c)
	id, err := strconv.Atoi(strings.TrimSpace(c.Param("id")))
	if err != nil || id <= 0 {
		jsonMsg(c, "invalid asset id", fmt.Errorf("bad id"))
		return
	}
	result, asset, applyErr := a.serverService.ApplyGeofileAsset(user.Id, id)
	msg := "Apply geofile asset"
	if asset != nil {
		if fileName, mapErr := service.GeofileNameFromType(asset.FileType); mapErr == nil {
			msg = geofileMessageFromResult(c, "Apply", fileName, result)
		}
	}
	if applyErr != nil {
		jsonMsgObj(c, msg, geofileAssetApplyResponse{Asset: asset, Result: result}, applyErr)
		return
	}
	jsonMsgObj(c, msg, geofileAssetApplyResponse{Asset: asset, Result: result}, nil)
}

func (a *ServerController) deleteGeofileAsset(c *gin.Context) {
	user := session.GetLoginUser(c)
	id, err := strconv.Atoi(strings.TrimSpace(c.Param("id")))
	if err != nil || id <= 0 {
		jsonMsg(c, "invalid asset id", fmt.Errorf("bad id"))
		return
	}
	if err := a.serverService.DeleteGeofileAsset(user.Id, id); err != nil {
		jsonMsg(c, "failed to delete geofile asset", err)
		return
	}
	jsonMsg(c, "geofile asset deleted", nil)
}

// refreshStatus updates the cached server status and collects CPU history.
func (a *ServerController) refreshStatus() {
	a.lastStatus = a.serverService.GetStatus(a.lastStatus)
	// collect cpu history when status is fresh
	if a.lastStatus != nil {
		now := time.Now()
		a.serverService.AppendCpuSample(now, a.lastStatus.Cpu)
		memPct := 0.0
		if a.lastStatus.Mem.Total > 0 {
			memPct = float64(a.lastStatus.Mem.Current) / float64(a.lastStatus.Mem.Total) * 100
		}
		a.serverService.AppendMemSample(now, memPct)
		diskPct := 0.0
		if a.lastStatus.Disk.Total > 0 {
			diskPct = float64(a.lastStatus.Disk.Current) / float64(a.lastStatus.Disk.Total) * 100
		}
		a.serverService.AppendDiskSample(now, diskPct)
		// Broadcast status update via WebSocket
		websocket.BroadcastStatus(a.lastStatus)
	}
	a.pollWorkerHostMetricsIfDue()
}

// startTask initiates background tasks for continuous status monitoring.
func (a *ServerController) startTask() {
	webServer := global.GetWebServer()
	c := webServer.GetCron()
	c.AddFunc("@every 1s", func() {
		// Always refresh to keep CPU history collected continuously for real-time updates.
		// Sampling is lightweight and capped to ~6 hours in memory.
		a.refreshStatus()
	})
}

// status returns the current server status information.
func (a *ServerController) status(c *gin.Context) { jsonObj(c, a.lastStatus, nil) }

func (a *ServerController) dockerUpdaterStatus(c *gin.Context) {
	jsonObj(c, gin.H{"enabled": service.DockerUpdaterConfigured()}, nil)
}

func (a *ServerController) dockerUpdaterPlan(c *gin.Context) {
	plan, err := service.GetDockerUpdatePlan()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerError"), err)
		return
	}
	jsonObj(c, plan, nil)
}

func (a *ServerController) dockerUpdaterWorkersPrep(c *gin.Context) {
	if err := service.PrepWorkersForDockerUpdate(); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerError"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "success"), nil)
}

func (a *ServerController) dockerUpdaterWorkersTrigger(c *gin.Context) {
	ctx := c.Request.Context()
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 2*time.Minute {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
	}
	results := service.TriggerWorkersDockerUpdate(ctx)
	jsonObj(c, gin.H{"nodes": results}, nil)
}

func (a *ServerController) dockerUpdaterWorkersFinish(c *gin.Context) {
	if err := service.FinishWorkersForDockerUpdate(); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerError"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "success"), nil)
}

func (a *ServerController) dockerUpdaterPanelTrigger(c *gin.Context) {
	ctx := c.Request.Context()
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 2*time.Minute {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 3*time.Minute)
		defer cancel()
	}
	if err := service.TriggerPanelDockerUpdate(ctx); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerError"), err)
		return
	}
	tg := service.Tgbot{}
	if tg.IsRunning() {
		tg.NotifyPanelAction("Docker sidecar updater triggered (e.g. Watchtower)", "", getRemoteIp(c))
	}
	jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerSuccess"), nil)
}

func (a *ServerController) dockerUpdaterTrigger(c *gin.Context) {
	ctx := c.Request.Context()
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 2*time.Minute {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
	}
	nodeErrs, err := service.OrchestratePanelDockerUpdate(ctx)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerError"), err)
		return
	}
	if len(nodeErrs) > 0 {
		logger.Warningf("Docker updater on workers: %d failure(s): %s", len(nodeErrs), strings.Join(nodeErrs, "; "))
	}
	tg := service.Tgbot{}
	if tg.IsRunning() {
		tg.NotifyPanelAction("Docker sidecar updater triggered (e.g. Watchtower)", "", getRemoteIp(c))
		if len(nodeErrs) > 0 {
			tg.NotifyPanelAction(
				fmt.Sprintf("Node worker docker updater: %d error(s)", len(nodeErrs)),
				strings.Join(nodeErrs, "; "),
				getRemoteIp(c),
			)
		}
	}
	jsonMsg(c, I18nWeb(c, "pages.settings.dockerUpdaterTriggerSuccess"), nil)
}

// getCpuHistoryBucket retrieves aggregated CPU usage history (panel + worker nodes when multi-node).
func (a *ServerController) getCpuHistoryBucket(c *gin.Context) {
	a.resourceHistoryBucket(c, "cpu")
}

// getMemHistoryBucket retrieves aggregated host memory usage history (percent) for panel + workers.
func (a *ServerController) getMemHistoryBucket(c *gin.Context) {
	a.resourceHistoryBucket(c, "mem")
}

func (a *ServerController) getDiskHistoryBucket(c *gin.Context) {
	a.resourceHistoryBucket(c, "disk")
}

func allowedResourceHistoryBucket(bucket int) bool {
	allowed := map[int]bool{
		2:   true,
		30:  true,
		60:  true,
		120: true,
		180: true,
		300: true,
	}
	return allowed[bucket]
}

func (a *ServerController) resourceHistoryBucket(c *gin.Context, metric string) {
	bucketStr := c.Param("bucket")
	bucket, err := strconv.Atoi(bucketStr)
	if err != nil || bucket <= 0 {
		jsonMsg(c, "invalid bucket", fmt.Errorf("bad bucket"))
		return
	}
	if !allowedResourceHistoryBucket(bucket) {
		jsonMsg(c, "invalid bucket", fmt.Errorf("unsupported bucket"))
		return
	}
	settingSvc := service.SettingService{}
	multi, _ := settingSvc.GetMultiNodeMode()

	var panelPoints []map[string]any
	switch metric {
	case "cpu":
		panelPoints = a.serverService.AggregateCpuHistory(bucket, 60)
	case "disk":
		panelPoints = a.serverService.AggregateDiskHistory(bucket, 60)
	default:
		panelPoints = a.serverService.AggregateMemHistory(bucket, 60)
	}

	series := []gin.H{
		{"key": "panel", "name": "Panel", "points": panelPoints},
	}
	if multi {
		for _, nodeID := range a.serverService.WorkerResourceNodeIDs() {
			display := strings.TrimSpace(a.serverService.WorkerDisplayName(nodeID))
			if display == "" {
				display = fmt.Sprintf("Node %d", nodeID)
			}
			var pts []map[string]any
			switch metric {
			case "cpu":
				pts = a.serverService.AggregateWorkerCpuHistory(nodeID, bucket, 60)
			case "disk":
				pts = a.serverService.AggregateWorkerDiskHistory(nodeID, bucket, 60)
			default:
				pts = a.serverService.AggregateWorkerMemHistory(nodeID, bucket, 60)
			}
			series = append(series, gin.H{
				"key":    fmt.Sprintf("node-%d", nodeID),
				"nodeId": nodeID,
				"name":   display,
				"points": pts,
			})
		}
	}
	jsonObj(c, gin.H{"series": series}, nil)
}

func (a *ServerController) pollWorkerHostMetricsIfDue() {
	settingSvc := service.SettingService{}
	multi, err := settingSvc.GetMultiNodeMode()
	if err != nil || !multi {
		return
	}
	const minGap = 2 * time.Second
	now := time.Now()
	a.workerHostMetricsMu.Lock()
	if now.Sub(a.lastWorkerHostMetricsPoll) < minGap {
		a.workerHostMetricsMu.Unlock()
		return
	}
	a.lastWorkerHostMetricsPoll = now
	a.workerHostMetricsMu.Unlock()

	go func() {
		nodeSvc := service.NodeService{}
		nodes, err := nodeSvc.GetAllNodes()
		if err != nil || len(nodes) == 0 {
			return
		}
		ts := time.Now()
		for _, node := range nodes {
			if node == nil || !node.Enable {
				continue
			}
			status, err := nodeSvc.GetNodeStatus(node)
			if err != nil {
				continue
			}
			cpuV := statusHostCpuPercent(status)
			memPct := statusHostMemPercent(status)
			diskPct := statusHostDiskPercent(status)
			a.serverService.AppendWorkerResourceSample(node.Id, node.Name, ts, cpuV, memPct, diskPct)
		}
	}()
}

func statusHostCpuPercent(st map[string]interface{}) float64 {
	v, ok := st["hostCpu"]
	if !ok || v == nil {
		return 0
	}
	switch x := v.(type) {
	case float64:
		return clampPercent(x)
	case float32:
		return clampPercent(float64(x))
	default:
		return 0
	}
}

func statusHostMemPercent(st map[string]interface{}) float64 {
	hm, ok := st["hostMem"].(map[string]interface{})
	if !ok || hm == nil {
		return 0
	}
	cur := uint64Interface(hm["current"])
	tot := uint64Interface(hm["total"])
	if tot == 0 {
		return 0
	}
	return clampPercent(float64(cur) / float64(tot) * 100)
}

func statusHostDiskPercent(st map[string]interface{}) float64 {
	hd, ok := st["hostDisk"].(map[string]interface{})
	if !ok || hd == nil {
		return 0
	}
	cur := uint64Interface(hd["current"])
	tot := uint64Interface(hd["total"])
	if tot == 0 {
		return 0
	}
	return clampPercent(float64(cur) / float64(tot) * 100)
}

func uint64Interface(v interface{}) uint64 {
	switch x := v.(type) {
	case float64:
		if x < 0 {
			return 0
		}
		return uint64(x)
	case json.Number:
		i, err := x.Int64()
		if err != nil {
			return 0
		}
		if i < 0 {
			return 0
		}
		return uint64(i)
	default:
		return 0
	}
}

func clampPercent(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// getXrayVersion retrieves available Xray versions, with caching for 1 minute.
func (a *ServerController) getXrayVersion(c *gin.Context) {
	now := time.Now().Unix()
	if now-a.lastGetVersionsTime <= 60 { // 1 minute cache
		jsonObj(c, a.lastVersions, nil)
		return
	}

	versions, err := a.serverService.GetXrayVersions()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "getVersion"), err)
		return
	}

	a.lastVersions = versions
	a.lastGetVersionsTime = now

	jsonObj(c, versions, nil)
}

// getTelemtVersion retrieves available Telemt versions, with caching for 1 minute.
func (a *ServerController) getTelemtVersion(c *gin.Context) {
	now := time.Now().Unix()
	if now-a.lastGetTelemtVersionsTime <= 60 {
		jsonObj(c, a.lastTelemtVersions, nil)
		return
	}

	versions, err := a.serverService.GetTelemtVersions()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "getVersion"), err)
		return
	}

	a.lastTelemtVersions = versions
	a.lastGetTelemtVersionsTime = now

	jsonObj(c, versions, nil)
}

// installXray installs or updates Xray to the specified version.
func (a *ServerController) installXray(c *gin.Context) {
	version := c.Param("version")
	err := a.serverService.UpdateXray(version)
	jsonMsg(c, I18nWeb(c, "pages.index.xraySwitchVersionPopover"), err)
}

// installTelemt installs or updates Telemt to the specified version (standalone panel host).
func (a *ServerController) installTelemt(c *gin.Context) {
	version := c.Param("version")
	err := a.serverService.UpdateTelemt(version)
	jsonMsg(c, I18nWeb(c, "pages.index.telemtSwitchVersionPopover"), err)
}

// parseNodeIDsForInstall extracts nodeIds from JSON body, form, query, or raw form-urlencoded body.
func parseNodeIDsForInstall(c *gin.Context) []int {
	contentType := c.ContentType()
	var nodeIdsFromJSON []int
	var hasNodeIdsInJSON bool

	if contentType == "application/json" {
		bodyBytes, err := c.GetRawData()
		if err == nil && len(bodyBytes) > 0 {
			var jsonData map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &jsonData); err == nil {
				if nodeIdsVal, ok := jsonData["nodeIds"]; ok {
					hasNodeIdsInJSON = true
					if nodeIdsArray, ok := nodeIdsVal.([]interface{}); ok {
						for _, val := range nodeIdsArray {
							if num, ok := val.(float64); ok {
								nodeIdsFromJSON = append(nodeIdsFromJSON, int(num))
							} else if num, ok := val.(int); ok {
								nodeIdsFromJSON = append(nodeIdsFromJSON, num)
							}
						}
					}
				}
			}
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}
	}

	if hasNodeIdsInJSON {
		return nodeIdsFromJSON
	}

	var nodeIds []int
	formBodyBytes, _ := c.GetRawData()
	if len(formBodyBytes) > 0 {
		c.Request.Body = io.NopCloser(bytes.NewBuffer(formBodyBytes))
	}
	if err := c.Request.ParseForm(); err == nil {
		nodeIdsStr := c.PostFormArray("nodeIds")
		if len(nodeIdsStr) == 0 {
			nodeIdsStr = c.QueryArray("nodeIds")
		}
		for _, idStr := range nodeIdsStr {
			if idStr != "" {
				if id, err := strconv.Atoi(idStr); err == nil && id > 0 {
					nodeIds = append(nodeIds, id)
				}
			}
		}
	}
	if len(nodeIds) == 0 && len(formBodyBytes) > 0 {
		bodyStr := string(formBodyBytes)
		for _, part := range strings.Split(bodyStr, "&") {
			if strings.HasPrefix(part, "nodeIds=") {
				idStr := strings.TrimPrefix(part, "nodeIds=")
				if decoded, err := url.QueryUnescape(idStr); err == nil {
					idStr = decoded
				}
				idStr = strings.TrimSpace(idStr)
				if id, err := strconv.Atoi(idStr); err == nil && id > 0 {
					nodeIds = append(nodeIds, id)
				}
			}
		}
	}
	return nodeIds
}

// installXrayOnNodes installs Xray version on selected nodes.
func (a *ServerController) installXrayOnNodes(c *gin.Context) {
	version := c.Param("version")
	nodeIds := parseNodeIDsForInstall(c)
	if len(nodeIds) == 0 {
		jsonMsg(c, "No nodes selected", nil)
		return
	}

	logger.Debugf("Installing Xray version %s on nodes: %v", version, nodeIds)

	nodeService := service.NodeService{}
	var errors []string
	var success []string

	for _, nodeId := range nodeIds {
		node, err := nodeService.GetNode(nodeId)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Node %d: %v", nodeId, err))
			continue
		}

		err = nodeService.InstallXrayVersion(node, version)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Node %d (%s): %v", nodeId, node.Name, err))
		} else {
			success = append(success, fmt.Sprintf("Node %d (%s)", nodeId, node.Name))
		}
	}

	var message string
	if len(success) > 0 && len(errors) == 0 {
		message = fmt.Sprintf("Xray version %s installed successfully on %d node(s)", version, len(success))
	} else if len(success) > 0 && len(errors) > 0 {
		message = fmt.Sprintf("Installed on %d node(s), failed on %d node(s)", len(success), len(errors))
	} else {
		message = fmt.Sprintf("Failed to install on all nodes")
	}

	if len(errors) > 0 {
		message += ": " + errors[0] // Show first error
		if len(errors) > 1 {
			message += fmt.Sprintf(" (and %d more)", len(errors)-1)
		}
	}

	if len(errors) > 0 && len(success) == 0 {
		jsonMsg(c, message, fmt.Errorf("installation failed"))
	} else {
		jsonMsg(c, message, nil)
	}
}

// installTelemtOnNodes installs Telemt version on selected nodes.
func (a *ServerController) installTelemtOnNodes(c *gin.Context) {
	version := c.Param("version")
	nodeIds := parseNodeIDsForInstall(c)

	if len(nodeIds) == 0 {
		jsonMsg(c, "No nodes selected", nil)
		return
	}

	nodeService := service.NodeService{}
	var errors []string
	var success []string

	for _, nodeId := range nodeIds {
		node, err := nodeService.GetNode(nodeId)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Node %d: %v", nodeId, err))
			continue
		}

		err = nodeService.InstallTelemtVersion(node, version)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Node %d (%s): %v", nodeId, node.Name, err))
		} else {
			success = append(success, fmt.Sprintf("Node %d (%s)", nodeId, node.Name))
		}
	}

	var message string
	if len(success) > 0 && len(errors) == 0 {
		message = fmt.Sprintf("Telemt version %s installed successfully on %d node(s)", version, len(success))
	} else if len(success) > 0 && len(errors) > 0 {
		message = fmt.Sprintf("Installed on %d node(s), failed on %d node(s)", len(success), len(errors))
	} else {
		message = fmt.Sprintf("Failed to install on all nodes")
	}

	if len(errors) > 0 {
		message += ": " + errors[0]
		if len(errors) > 1 {
			message += fmt.Sprintf(" (and %d more)", len(errors)-1)
		}
	}

	if len(errors) > 0 && len(success) == 0 {
		jsonMsg(c, message, fmt.Errorf("installation failed"))
	} else {
		jsonMsg(c, message, nil)
	}
}

// updateGeofile updates the specified geo file for Xray.
func (a *ServerController) updateGeofile(c *gin.Context) {
	fileName := c.Param("fileName")

	// Validate the filename for security (prevent path traversal attacks)
	if fileName != "" && !a.serverService.IsValidGeofileName(fileName) {
		jsonMsg(c, I18nWeb(c, "pages.index.geofileUpdatePopover"),
			fmt.Errorf("invalid filename: contains unsafe characters or path traversal patterns"))
		return
	}

	err := a.serverService.UpdateGeofile(fileName)
	jsonMsg(c, I18nWeb(c, "pages.index.geofileUpdatePopover"), err)
}

func geofileActionLabel(c *gin.Context, action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "upload":
		return I18nWeb(c, "pages.index.geofileActionUpload")
	case "rollback":
		return I18nWeb(c, "pages.index.geofileActionRollback")
	case "apply":
		return I18nWeb(c, "pages.index.geofileActionApply")
	default:
		return action
	}
}

func geofileMessageFromResult(c *gin.Context, action, fileName string, result *service.GeofileApplyResult) string {
	actionLabel := geofileActionLabel(c, action)
	if result == nil || !result.LocalOK {
		return fmt.Sprintf("%s %s %s", actionLabel, fileName, I18nWeb(c, "pages.index.geofileResultFailedLocallyTail"))
	}
	nodeSuccess := len(result.NodeSuccess)
	nodeErrors := len(result.NodeErrors)
	if nodeSuccess == 0 && nodeErrors == 0 {
		return fmt.Sprintf("%s %s %s", actionLabel, fileName, I18nWeb(c, "pages.index.geofileResultCompletedLocallyTail"))
	}
	if nodeErrors == 0 {
		return fmt.Sprintf("%s %s: %s + %d %s", actionLabel, fileName, I18nWeb(c, "pages.index.localNodeLabel"), nodeSuccess, I18nWeb(c, "pages.index.nodeSuffix"))
	}
	if nodeSuccess == 0 {
		return fmt.Sprintf("%s %s: %s; %s %d %s", actionLabel, fileName, I18nWeb(c, "pages.index.localCompletedLabel"), I18nWeb(c, "pages.index.failedOnLabel"), nodeErrors, I18nWeb(c, "pages.index.nodeSuffix"))
	}
	return fmt.Sprintf("%s %s: %d %s, %d %s", actionLabel, fileName, nodeSuccess, I18nWeb(c, "pages.index.nodesSuccessLabel"), nodeErrors, I18nWeb(c, "pages.index.nodesFailedLabel"))
}

func (a *ServerController) uploadGeofile(c *gin.Context) {
	fileName := c.Param("fileName")
	if !a.serverService.IsValidGeofileName(fileName) {
		jsonMsg(c, "invalid geofile name", fmt.Errorf("invalid filename"))
		return
	}
	formFile, _, err := c.Request.FormFile("file")
	if err != nil {
		jsonMsg(c, "failed to read uploaded geofile", err)
		return
	}
	defer formFile.Close()
	result, err := a.serverService.UploadGeofile(fileName, formFile)
	if err != nil {
		jsonMsgObj(c, geofileMessageFromResult(c, "Upload", fileName, result), result, err)
		return
	}
	jsonMsgObj(c, geofileMessageFromResult(c, "Upload", fileName, result), result, nil)
}

func (a *ServerController) rollbackGeofile(c *gin.Context) {
	fileName := c.Param("fileName")
	if !a.serverService.IsValidGeofileName(fileName) {
		jsonMsg(c, "invalid geofile name", fmt.Errorf("invalid filename"))
		return
	}
	result, err := a.serverService.RollbackGeofile(fileName)
	if err != nil {
		jsonMsgObj(c, geofileMessageFromResult(c, "Rollback", fileName, result), result, err)
		return
	}
	jsonMsgObj(c, geofileMessageFromResult(c, "Rollback", fileName, result), result, nil)
}

func (a *ServerController) downloadGeofileByURL(c *gin.Context) {
	fileName := c.Param("fileName")
	if !a.serverService.IsValidGeofileName(fileName) {
		jsonMsg(c, "invalid geofile name", fmt.Errorf("invalid filename"))
		return
	}
	srcURL := strings.TrimSpace(c.PostForm("url"))
	if srcURL == "" {
		var body struct {
			URL string `json:"url"`
		}
		if err := c.ShouldBindJSON(&body); err == nil {
			srcURL = strings.TrimSpace(body.URL)
		}
	}
	if srcURL == "" {
		jsonMsg(c, "url is required", fmt.Errorf("empty url"))
		return
	}
	taskID, err := a.serverService.StartGeofileDownloadTask(fileName, srcURL)
	if err != nil {
		jsonMsg(c, "failed to start geofile download", err)
		return
	}
	jsonObj(c, gin.H{"taskId": taskID}, nil)
}

func (a *ServerController) downloadGeofileTask(c *gin.Context) {
	taskID := strings.TrimSpace(c.Param("taskID"))
	task, err := a.serverService.GetGeofileDownloadTask(taskID)
	if err != nil {
		jsonMsg(c, "failed to get geofile task", err)
		return
	}
	jsonObj(c, task, nil)
}

// stopXrayService stops the Xray service.
func (a *ServerController) stopXrayService(c *gin.Context) {
	err := a.serverService.StopXrayService()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.xray.stopError"), err)
		websocket.BroadcastXrayState("error", err.Error())
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.xray.stopSuccess"), err)
	websocket.BroadcastXrayState("stop", "")
	websocket.BroadcastNotification(
		I18nWeb(c, "pages.xray.stopSuccess"),
		"Xray service has been stopped",
		"warning",
	)
	tg := service.Tgbot{}
	if tg.IsRunning() {
		tg.NotifyPanelAction("Xray service stopped (panel)", "", getRemoteIp(c))
	}
}

// stopTelemtService stops local Telemt sidecars on the panel host (standalone mode only).
func (a *ServerController) stopTelemtService(c *gin.Context) {
	err := a.serverService.StopTelemtService()
	if err != nil {
		jsonMsg(c, err.Error(), err)
		return
	}
	jsonMsg(c, "Telemt stopped", nil)
}

// restartTelemtService restarts Telemt sidecars from the latest config (standalone panel host only).
func (a *ServerController) restartTelemtService(c *gin.Context) {
	err := a.serverService.RestartTelemtService()
	if err != nil {
		jsonMsg(c, err.Error(), err)
		return
	}
	jsonMsg(c, "Telemt restarted", nil)
}

// restartXrayService restarts the Xray service.
func (a *ServerController) restartXrayService(c *gin.Context) {
	err := a.serverService.RestartXrayService()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.xray.restartError"), err)
		websocket.BroadcastXrayState("error", err.Error())
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.xray.restartSuccess"), err)
	websocket.BroadcastXrayState("running", "")
	websocket.BroadcastNotification(
		I18nWeb(c, "pages.xray.restartSuccess"),
		"Xray service has been restarted successfully",
		"success",
	)
	tg := service.Tgbot{}
	if tg.IsRunning() {
		tg.NotifyPanelAction("Xray service restarted (panel)", "", getRemoteIp(c))
	}
}

// getLogs retrieves the application logs based on count, level, and syslog filters.
func (a *ServerController) getLogs(c *gin.Context) {
	count := c.Param("count")
	level := c.PostForm("level")
	logs := a.serverService.GetLogs(count, level)
	jsonObj(c, logs, nil)
}

func (a *ServerController) getUnifiedLogs(c *gin.Context) {
	countStr := c.Param("count")
	count, err := strconv.Atoi(countStr)
	if err != nil {
		count = 0
	}
	// 0 means "all available history". Positive counts are bounded for safety.
	if count < 0 {
		count = 0
	}
	if count > 200000 {
		count = 200000
	}
	logs := a.serverService.GetUnifiedLogs(count)
	jsonObj(c, logs, nil)
}

// getXrayLogs retrieves Xray logs with filtering options for direct, blocked, and proxy traffic.
func (a *ServerController) getXrayLogs(c *gin.Context) {
	count := c.Param("count")
	filter := c.PostForm("filter")
	showDirect := c.PostForm("showDirect")
	showBlocked := c.PostForm("showBlocked")
	showProxy := c.PostForm("showProxy")

	var freedoms []string
	var blackholes []string

	//getting tags for freedom and blackhole outbounds
	config, err := a.settingService.GetDefaultXrayConfig()
	if err == nil && config != nil {
		if cfgMap, ok := config.(map[string]any); ok {
			if outbounds, ok := cfgMap["outbounds"].([]any); ok {
				for _, outbound := range outbounds {
					if obMap, ok := outbound.(map[string]any); ok {
						switch obMap["protocol"] {
						case "freedom":
							if tag, ok := obMap["tag"].(string); ok {
								freedoms = append(freedoms, tag)
							}
						case "blackhole":
							if tag, ok := obMap["tag"].(string); ok {
								blackholes = append(blackholes, tag)
							}
						}
					}
				}
			}
		}
	}

	if len(freedoms) == 0 {
		freedoms = []string{"direct"}
	}
	if len(blackholes) == 0 {
		blackholes = []string{"blocked"}
	}

	nodeId := c.PostForm("nodeId")
	logs := a.serverService.GetXrayLogs(count, filter, showDirect, showBlocked, showProxy, freedoms, blackholes, nodeId)
	jsonObj(c, logs, nil)
}

// getConfigJson retrieves the Xray configuration as JSON.
func (a *ServerController) getConfigJson(c *gin.Context) {
	configJson, err := a.serverService.GetConfigJson()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.index.getConfigError"), err)
		return
	}
	jsonObj(c, configJson, nil)
}

// getDb downloads the database file.
func (a *ServerController) getDb(c *gin.Context) {
	db, err := a.serverService.GetDb()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.index.getDatabaseError"), err)
		return
	}

	filename := "x-ui-db-backup.sql"

	if !isValidFilename(filename) {
		c.AbortWithError(http.StatusBadRequest, fmt.Errorf("invalid filename"))
		return
	}

	// Set the headers for the response
	c.Header("Content-Type", "application/sql")
	c.Header("Content-Disposition", "attachment; filename="+filename)

	// Write the file contents to the response
	c.Writer.Write(db)
}

func isValidFilename(filename string) bool {
	// Validate that the filename only contains allowed characters
	return filenameRegex.MatchString(filename)
}

// importDB imports a database file and restarts the container.
func (a *ServerController) importDB(c *gin.Context) {
	// Get the file from the request body
	file, _, err := c.Request.FormFile("db")
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.index.readDatabaseError"), err)
		return
	}
	defer file.Close()

	// Import database
	err = a.serverService.ImportDB(file)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.index.importDatabaseError"), err)
		return
	}

	// Restart container after successful import to ensure all services use new database
	if err := a.panelService.RestartContainer(time.Second * 3); err != nil {
		logger.Warningf("Failed to restart container after DB import: %v", err)
		// Don't fail the import if container restart fails, but log it
	}

	jsonObj(c, I18nWeb(c, "pages.index.importDatabaseSuccess"), nil)
}

// getNewX25519Cert generates a new X25519 certificate.
func (a *ServerController) getNewX25519Cert(c *gin.Context) {
	cert, err := a.serverService.GetNewX25519Cert()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.getNewX25519CertError"), err)
		return
	}
	jsonObj(c, cert, nil)
}

// getNewmldsa65 generates a new ML-DSA-65 key.
func (a *ServerController) getNewmldsa65(c *gin.Context) {
	cert, err := a.serverService.GetNewmldsa65()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.getNewmldsa65Error"), err)
		return
	}
	jsonObj(c, cert, nil)
}

// getNewEchCert generates a new ECH certificate for the given SNI.
func (a *ServerController) getNewEchCert(c *gin.Context) {
	sni := c.PostForm("sni")
	cert, err := a.serverService.GetNewEchCert(sni)
	if err != nil {
		jsonMsg(c, "get ech certificate", err)
		return
	}
	jsonObj(c, cert, nil)
}

// getNewVlessEnc generates a new VLESS encryption key.
func (a *ServerController) getNewVlessEnc(c *gin.Context) {
	out, err := a.serverService.GetNewVlessEnc()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.getNewVlessEncError"), err)
		return
	}
	jsonObj(c, out, nil)
}

// getNewUUID generates a new UUID.
func (a *ServerController) getNewUUID(c *gin.Context) {
	uuidResp, err := a.serverService.GetNewUUID()
	if err != nil {
		jsonMsg(c, "Failed to generate UUID", err)
		return
	}

	jsonObj(c, uuidResp, nil)
}

// getNewmlkem768 generates a new ML-KEM-768 key.
func (a *ServerController) getNewmlkem768(c *gin.Context) {
	out, err := a.serverService.GetNewmlkem768()
	if err != nil {
		jsonMsg(c, "Failed to generate mlkem768 keys", err)
		return
	}
	jsonObj(c, out, nil)
}

// getMetrics returns metrics in Prometheus format
func (a *ServerController) getMetrics(c *gin.Context) {
	metrics := service.CollectMetrics()
	c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	c.String(http.StatusOK, metrics)
}

// getLogsSSE streams real-time log entries to the client via Server-Sent Events.
// Query params: level (debug|info|warn|error, default "debug"), source (panel|xray|node|all, default "all").
func (a *ServerController) getLogsSSE(c *gin.Context) {
	level := strings.ToLower(strings.TrimSpace(c.Query("level")))
	if level == "" {
		level = "debug"
	}
	source := strings.ToLower(strings.TrimSpace(c.Query("source")))
	if source == "" {
		source = "all"
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	sub, cancel := logsse.Subscribe(level, source)
	defer cancel()

	ctx := c.Request.Context()
	c.Stream(func(w io.Writer) bool {
		select {
		case <-ctx.Done():
			return false
		case batch, ok := <-sub.Chan():
			if !ok {
				return false
			}
			data, err := logsse.MarshalSSEBatch(batch)
			if err != nil {
				return true
			}
			_, writeErr := w.Write(data)
			if writeErr != nil {
				return false
			}
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			return true
		}
	})
}
