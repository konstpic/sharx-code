package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
	"github.com/konstpic/sharx-code/v2/util/pairing_outbound"
	"github.com/konstpic/sharx-code/v2/web/logsse"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
	"github.com/konstpic/sharx-code/v2/web/websocket"

	"github.com/gin-gonic/gin"
)

// APIController handles the main API routes for the SharX panel, including inbounds and server management.
type APIController struct {
	BaseController
	inboundController *InboundController
	serverController  *ServerController
	Tgbot             service.Tgbot
	docsFS            fs.FS // Embedded docs filesystem
}

// NewAPIController creates a new APIController instance and initializes its routes.
func NewAPIController(g *gin.RouterGroup) *APIController {
	a := &APIController{}
	a.initRouter(g)
	return a
}

// SetDocsFS sets the embedded docs filesystem for the API controller.
func (a *APIController) SetDocsFS(docsFS fs.FS) {
	a.docsFS = docsFS
}

// checkAPIAuth is a middleware that returns 404 for unauthenticated API requests
// to hide the existence of API endpoints from unauthorized users
func (a *APIController) checkAPIAuth(c *gin.Context) {
	TryAttachAPITokenFromBearer(c)
	if !session.IsLogin(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	c.Next()
}

// initRouter sets up the API routes for inbounds, server, and other endpoints.
func (a *APIController) initRouter(g *gin.RouterGroup) {
	registerPublicSubscriptionRoutes(g, nil)

	// Node push-logs endpoint (no session auth, uses API key)
	// Register in separate group without session auth middleware
	nodeAPI := g.Group("/panel/api/node")
	nodeAPI.POST("/push-logs", a.pushNodeLogs)
	nodeAPI.POST("/push-geo", a.pushNodeGeo)
	nodeAPI.POST("/pull-xray-config", a.pullWorkerXrayConfig)

	// Main API group with session auth
	api := g.Group("/panel/api")
	api.Use(a.checkAPIAuth)

	// Inbounds API
	inbounds := api.Group("/inbounds")
	a.inboundController = NewInboundController(inbounds)

	// Server API
	server := api.Group("/server")
	a.serverController = NewServerController(server)

	// Extra routes
	api.GET("/backuptotgbot", a.BackuptoTgbot)

	a.registerAPITokenRoutes(api)

	// API Documentation
	apiDocs := api.Group("/api-docs")
	apiDocs.GET("/markdown", a.getAPIDocsMarkdown)
}

// BackuptoTgbot sends a backup of the panel data to Telegram bot admins.
func (a *APIController) BackuptoTgbot(c *gin.Context) {
	a.Tgbot.SendBackupToAdmins()
}

// extractPort extracts port number from URL address (e.g., "http://192.168.0.7:8080" -> "8080")
func extractPort(address string) string {
	re := regexp.MustCompile(`:(\d+)(?:/|$)`)
	matches := re.FindStringSubmatch(address)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func parseSharxV1Signature(s string) (hex string, ok bool) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "v1=") {
		return "", false
	}
	return strings.TrimSpace(s[3:]), true
}

// findNodeByAddressForLogPush matches node by address for log push.
// Behavior mirrors NodeService.FindNodeByPushAddress:
// - exact address match first
// - port-only fallback only when unique
func findNodeByAddressForLogPush(nodes []*model.Node, nodeAddress string) *model.Node {
	reqAddr := strings.TrimSuffix(strings.TrimSpace(nodeAddress), "/")
	reqPort := extractPort(reqAddr)

	// Exact match first.
	for _, n := range nodes {
		nodeAddr := strings.TrimSuffix(strings.TrimSpace(n.Address), "/")
		if nodeAddr == reqAddr {
			return n
		}
	}

	// Port fallback only when it points to exactly one node.
	if reqPort != "" {
		var byPort []*model.Node
		for _, n := range nodes {
			nodeAddr := strings.TrimSuffix(strings.TrimSpace(n.Address), "/")
			nodePort := extractPort(nodeAddr)
			if nodePort != "" && nodePort == reqPort {
				byPort = append(byPort, n)
			}
		}
		if len(byPort) == 1 {
			return byPort[0]
		}
	}
	return nil
}

// pushNodeLogs receives logs from a node; authenticates with X-Sharx-Signature (HMAC, pairing).
func (a *APIController) pushNodeLogs(c *gin.Context) {
	const sigHeader = "X-Sharx-Signature"

	type PushLogRequest struct {
		NodeAddress string         `json:"nodeAddress,omitempty"`
		NodeId      int            `json:"nodeId,omitempty"`
		Entries     []logger.Entry `json:"entries,omitempty"`
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read body"})
		return
	}
	_ = c.Request.Body.Close()
	c.Request.Body = io.NopCloser(bytes.NewReader(body))

	var req PushLogRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON: " + err.Error()})
		return
	}
	if len(req.Entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "entries is required"})
		return
	}

	nodeService := service.NodeService{}
	nodes, err := nodeService.GetAllNodes()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get nodes"})
		return
	}

	sig := strings.TrimSpace(c.GetHeader(sigHeader))
	if sig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": sigHeader + " (HMAC v1) is required"})
		return
	}
	v1, ok := parseSharxV1Signature(sig)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid " + sigHeader + " (expected v1=hex)"})
		return
	}
	pairing := &service.PanelPairingService{}
	key, err := pairing.GetOutboundHMACKey()
	if err != nil {
		logger.Errorf("pairing HMAC key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Pairing not configured"})
		return
	}
	if !pairing_outbound.ValidSignature(key, body, v1) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}
	// Prefer panel-assigned nodeId (immune to address/port collisions).
	var node *model.Node
	if req.NodeId > 0 {
		for _, n := range nodes {
			if n.Id == req.NodeId {
				node = n
				break
			}
		}
		if node == nil {
			logger.Debugf("HMAC log push: nodeId %d not found, falling back to address match", req.NodeId)
		}
	}
	if node == nil {
		if strings.TrimSpace(req.NodeAddress) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "nodeId or nodeAddress is required"})
			return
		}
		node = findNodeByAddressForLogPush(nodes, req.NodeAddress)
	}
	if node == nil {
		logger.Debugf("HMAC log push: no node for address %s", req.NodeAddress)
		c.JSON(http.StatusUnauthorized, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.unknownNode")})
		return
	}

	// Log which node is sending logs (for debugging)
	logger.Debugf("Received %d logs from node: %s (ID: %d, Address: %s)",
		len(req.Entries), node.Name, node.Id, node.Address)

	normalizeLevel := func(level string) string {
		l := strings.ToLower(strings.TrimSpace(level))
		switch l {
		case "debug":
			return "debug"
		case "info":
			return "info"
		case "warn", "warning":
			return "warn"
		case "error":
			return "error"
		case "notice":
			// Keep UI level-set stable (notice behaves like info).
			return "info"
		default:
			return "info"
		}
	}

	emitFromNode := func(level string, message string, ts string) {
		message = strings.TrimSpace(message)
		if message == "" {
			return
		}
		level = normalizeLevel(level)
		nodeIDStr := fmt.Sprintf("%d", node.Id)
		logger.Emit(logger.Entry{
			Ts:        strings.TrimSpace(ts),
			Level:     level,
			Source:    "node",
			Msg:       fmt.Sprintf("[Node: %s] %s", node.Name, message),
			NodeID:    nodeIDStr,
			Channel:   "service",
			Component: "node",
		})

		logsse.Emit(logger.Entry{
			Ts:        strings.TrimSpace(ts),
			Level:     level,
			Source:    websocket.LogStreamSourceNode,
			Msg:       message,
			NodeID:    nodeIDStr,
			NodeName:  node.Name,
			Channel:   "service",
			Component: "node",
		})
	}

	for _, e := range req.Entries {
		emitFromNode(e.Level, e.Msg, e.Ts)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Logs received"})
}

// pushNodeGeo receives approximate lat/lon from a worker (HMAC, pairing); same auth as push-logs.
func (a *APIController) pushNodeGeo(c *gin.Context) {
	const sigHeader = "X-Sharx-Signature"

	type pushGeoRequest struct {
		NodeAddress string  `json:"nodeAddress"`
		NodeId      int     `json:"nodeId,omitempty"`
		Lat         float64 `json:"lat"`
		Lng         float64 `json:"lng"`
		Source      string  `json:"source,omitempty"`
		IP          string  `json:"ip,omitempty"`
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read body"})
		return
	}
	_ = c.Request.Body.Close()
	c.Request.Body = io.NopCloser(bytes.NewReader(body))

	var req pushGeoRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON: " + err.Error()})
		return
	}
	if req.NodeId == 0 && strings.TrimSpace(req.NodeAddress) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nodeId or nodeAddress is required"})
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid coordinates"})
		return
	}

	sig := strings.TrimSpace(c.GetHeader(sigHeader))
	if sig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": sigHeader + " (HMAC v1) is required"})
		return
	}
	v1, ok := parseSharxV1Signature(sig)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid " + sigHeader + " (expected v1=hex)"})
		return
	}
	pairing := &service.PanelPairingService{}
	key, err := pairing.GetOutboundHMACKey()
	if err != nil {
		logger.Errorf("pairing HMAC key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Pairing not configured"})
		return
	}
	if !pairing_outbound.ValidSignature(key, body, v1) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	nodeService := service.NodeService{}
	var node *model.Node
	if req.NodeId > 0 {
		n, gerr := nodeService.GetNode(req.NodeId)
		if gerr == nil {
			node = n
		} else {
			logger.Debugf("HMAC geo push: nodeId %d not found, falling back to address match", req.NodeId)
		}
	}
	if node == nil {
		n, ferr := nodeService.FindNodeByPushAddress(req.NodeAddress)
		if ferr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get nodes"})
			return
		}
		node = n
	}
	if node == nil {
		logger.Debugf("HMAC geo push: no node for nodeId=%d address=%q", req.NodeId, req.NodeAddress)
		c.JSON(http.StatusUnauthorized, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.unknownNode")})
		return
	}

	src := strings.TrimSpace(req.Source)
	if src == "" {
		src = "unknown"
	}
	if err := nodeService.UpdateNodeGeography(node.Id, req.Lat, req.Lng, src); err != nil {
		logger.Errorf("geo push update node %d: %v", node.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save geography"})
		return
	}
	logger.Debugf("Geo push: node %s (%d) → %.4f, %.4f (%s, ip=%s)", node.Name, node.Id, req.Lat, req.Lng, src, strings.TrimSpace(req.IP))
	c.JSON(http.StatusOK, gin.H{"message": "Geography received"})
}

// pullWorkerXrayConfig returns the current Xray JSON for a worker (HMAC, pairing); same auth as push-geo.
func (a *APIController) pullWorkerXrayConfig(c *gin.Context) {
	const sigHeader = "X-Sharx-Signature"

	type pullReq struct {
		NodeAddress string `json:"nodeAddress"`
		NodeId      int    `json:"nodeId,omitempty"`
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read body"})
		return
	}
	_ = c.Request.Body.Close()
	c.Request.Body = io.NopCloser(bytes.NewReader(body))

	var req pullReq
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON: " + err.Error()})
		return
	}
	if req.NodeId == 0 && strings.TrimSpace(req.NodeAddress) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nodeId or nodeAddress is required"})
		return
	}

	sig := strings.TrimSpace(c.GetHeader(sigHeader))
	if sig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": sigHeader + " (HMAC v1) is required"})
		return
	}
	v1, ok := parseSharxV1Signature(sig)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid " + sigHeader + " (expected v1=hex)"})
		return
	}
	pairing := &service.PanelPairingService{}
	key, err := pairing.GetOutboundHMACKey()
	if err != nil {
		logger.Errorf("pairing HMAC key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Pairing not configured"})
		return
	}
	if !pairing_outbound.ValidSignature(key, body, v1) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	nodeService := service.NodeService{}
	var node *model.Node
	if req.NodeId > 0 {
		n, gerr := nodeService.GetNode(req.NodeId)
		if gerr == nil {
			node = n
		} else {
			logger.Debugf("HMAC pull-xray-config: nodeId %d not found, falling back to address", req.NodeId)
		}
	}
	if node == nil {
		n, ferr := nodeService.FindNodeByPushAddress(req.NodeAddress)
		if ferr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get nodes"})
			return
		}
		node = n
	}
	if node == nil {
		logger.Debugf("HMAC pull-xray-config: no node for nodeId=%d address=%q", req.NodeId, req.NodeAddress)
		c.JSON(http.StatusUnauthorized, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.unknownNode")})
		return
	}
	if !node.Enable {
		c.JSON(http.StatusForbidden, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.nodeDisabled")})
		return
	}

	xraySvc := service.NewXrayService()
	configJSON, coreHash, err := xraySvc.BuildWorkerXrayConfigForNodeWithMeta(node)
	if err != nil {
		logger.Errorf("pull-xray-config build for node %d: %v", node.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.buildFailed")})
		return
	}
	sum := sha256.Sum256(configJSON)
	cfgHex := hex.EncodeToString(sum[:])
	ibs, err := xraySvc.InboundsForWorkerNode(node)
	if err != nil {
		logger.Errorf("pull-xray-config inbounds for node %d: %v", node.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.buildFailed")})
		return
	}
	telemtPayloads, awgPayloads, webVhosts, err := service.BuildWorkerSidecarPayloadsForNode(node, ibs)
	if err != nil {
		logger.Errorf("pull-xray-config sidecars for node %d: %v", node.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": I18nWeb(c, "api.pullXrayConfig.buildFailed")})
		return
	}

	type pullResp struct {
		Config          json.RawMessage               `json:"config"`
		Telemt          []service.TelemtNodePayload   `json:"telemt"`
		AmneziaWG       []service.AmneziaWGNodePayload `json:"amneziawg"`
		TelemtWeb       []telemtweb.Vhost              `json:"telemtWeb"`
		NodeId          int                           `json:"nodeId"`
		CoreProfileHash string                        `json:"coreProfileHash,omitempty"`
		ConfigSha256    string                        `json:"configSha256,omitempty"`
	}
	logger.Debugf("pull-xray-config: node %s (%d), %d bytes, telemt=%d amneziawg=%d telemtWeb=%d", node.Name, node.Id, len(configJSON), len(telemtPayloads), len(awgPayloads), len(webVhosts))
	c.JSON(http.StatusOK, pullResp{Config: configJSON, Telemt: telemtPayloads, AmneziaWG: awgPayloads, TelemtWeb: webVhosts, NodeId: node.Id, CoreProfileHash: coreHash, ConfigSha256: cfgHex})
}

// getAPIDocsMarkdown returns the API documentation markdown file.
func (a *APIController) getAPIDocsMarkdown(c *gin.Context) {
	var content []byte
	var err error

	// Try reading from embedded docs filesystem first
	if a.docsFS != nil {
		// When using //go:embed docs, files are accessible as "docs/API.md"
		apiDocPaths := []string{"docs/API.md", "API.md"}
		for _, path := range apiDocPaths {
			content, err = fs.ReadFile(a.docsFS, path)
			if err == nil {
				c.Header("Content-Type", "text/markdown; charset=utf-8")
				c.String(http.StatusOK, string(content))
				return
			}
		}
		logger.Debugf("Failed to read API.md from embedded filesystem (trying disk): %v", err)
	}

	// Fallback to disk
	diskPaths := []string{"web/docs/API.md", "docs/API.md", "API.md"}
	for _, path := range diskPaths {
		content, err = os.ReadFile(path)
		if err == nil {
			logger.Debugf("Successfully read API.md from disk: %s", path)
			c.Header("Content-Type", "text/markdown; charset=utf-8")
			c.String(http.StatusOK, string(content))
			return
		}
	}

	logger.Warningf("Failed to read API.md: %v", err)
	c.String(http.StatusNotFound, "API documentation not found")
}
