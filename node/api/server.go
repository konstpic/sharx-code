// Package api provides REST API endpoints for the node service.
package api

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/konstpic/sharx-code/v2/conndrop"
	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/auth"
	nodeConfig "github.com/konstpic/sharx-code/v2/node/config"
	"github.com/konstpic/sharx-code/v2/node/geopush"
	nodeLogs "github.com/konstpic/sharx-code/v2/node/logs"
	"github.com/konstpic/sharx-code/v2/node/amneziawg"
	"github.com/konstpic/sharx-code/v2/node/telemt"
	"github.com/konstpic/sharx-code/v2/node/xray"
	telemtinstall "github.com/konstpic/sharx-code/v2/telemt/install"
	"github.com/konstpic/sharx-code/v2/util/dockerupdater"
)

// try executes a function and recovers from panics, logging them as warnings
func try(fn func()) {
	defer func() {
		if r := recover(); r != nil {
			logger.Warningf("Non-critical operation failed (recovered): %v", r)
		}
	}()
	fn()
}

// Server provides REST API for managing the node.
type Server struct {
	port              int
	xrayManager       *xray.Manager
	telemtManager     *telemt.Manager
	amneziawgManager  *amneziawg.Manager
	httpServer        *http.Server
	certFile           string
	keyFile            string
	// clientCAFile, if set with cert/key, enables mTLS (panel must present a cert signed by this CA).
	clientCAFile string
	// pairing, if set, enables JWT auth for API routes (plain HTTP).
	pairing *auth.Bundle
}

// Code returned in JSON when Xray is not running (expected before first apply-config).
const errCodeXrayNotReady = "XRAY_NOT_READY"

var (
	notReadyLogMu   sync.Mutex
	lastLogStats503 time.Time
	lastLogLogs503  time.Time
)

// logXrayNotReadyThrottled logs at most once per minute per endpoint to avoid log spam from panel polls.
func logXrayNotReadyThrottled(endpoint string) {
	const interval = time.Minute
	now := time.Now()
	notReadyLogMu.Lock()
	defer notReadyLogMu.Unlock()
	switch endpoint {
	case "stats":
		if now.Sub(lastLogStats503) < interval {
			return
		}
		lastLogStats503 = now
	case "logs":
		if now.Sub(lastLogLogs503) < interval {
			return
		}
		lastLogLogs503 = now
	}
	logger.Debugf("Xray not ready: returning 503 for %s (repeats suppressed for %v)", endpoint, interval)
}

// NewServer creates a new API server instance. Call SetPairing before Start (pairing-only).
func NewServer(port int, xrayManager *xray.Manager, telemtManager *telemt.Manager, amneziawgManager *amneziawg.Manager) *Server {
	return &Server{
		port:             port,
		xrayManager:      xrayManager,
		telemtManager:    telemtManager,
		amneziawgManager: amneziawgManager,
	}
}

// SetTLS sets TLS certificate files for HTTPS.
func (s *Server) SetTLS(certFile, keyFile string) {
	s.certFile = certFile
	s.keyFile = keyFile
}

// SetMTLSClientCA sets the PEM file with CA certificate(s) used to verify client certificates (panel).
// Requires SetTLS; connections without a valid client cert are rejected before handlers run.
func (s *Server) SetMTLSClientCA(caFile string) {
	s.clientCAFile = caFile
}

// SetPairing configures JWT verification from SECRET_KEY.
func (s *Server) SetPairing(b *auth.Bundle) {
	s.pairing = b
}

// Start starts the HTTP server.
func (s *Server) Start() error {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	// Add request logging middleware
	router.Use(func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		logger.Debugf("%s %s - %d - %v", method, path, status, latency)
	})

	router.Use(s.authMiddleware())

	// Health check endpoint (no auth required)
	router.GET("/health", s.health)
	router.GET("/api/v1/ready", s.health)

	// API endpoints (require auth)
	api := router.Group("/api/v1")
	{
		api.POST("/apply-config", s.applyConfig)
		api.POST("/apply-sidecars", s.applySidecars)
		api.POST("/stop-xray", s.stopXray)
		api.POST("/stop-telemt", s.stopTelemt)
		api.POST("/restart-telemt", s.restartTelemt)
		api.POST("/stop-amneziawg", s.stopAmneziaWg)
		api.POST("/restart-amneziawg", s.restartAmneziaWg)
		api.POST("/reload", s.reload)
		api.POST("/force-reload", s.forceReload)
		api.POST("/install-xray/:version", s.installXray)
		api.POST("/install-telemt/:version", s.installTelemt)
		api.GET("/status", s.status)
		api.GET("/stats", s.stats)
		api.GET("/user-online-sessions", s.userOnlineSessions)
		api.POST("/drop-connections", s.dropConnections)
		api.POST("/drop-ips", s.dropIPs)
		api.GET("/logs", s.getLogs)
		api.GET("/service-logs", s.getServiceLogs)
		api.POST("/add-user", s.addUser)
		api.POST("/remove-user", s.removeUser)
		api.POST("/update-inbound", s.updateInbound)
		api.POST("/remove-inbound", s.removeInbound)
		api.POST("/session-ip-block-routing", s.sessionIPBlockRouting)
		api.POST("/geofile/upload/:fileName", s.uploadGeofile)
		api.POST("/geofile/rollback/:fileName", s.rollbackGeofile)
		api.GET("/docker-updater", s.dockerUpdaterStatus)
		api.POST("/docker-updater/trigger", s.dockerUpdaterTrigger)
	}

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", s.port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,  // Increased for large configs
		WriteTimeout: 30 * time.Second,  // Increased for large responses
		IdleTimeout:  120 * time.Second, // Keep connections alive longer
	}

	if s.pairing != nil {
		logger.Infof("API server listening on port %d with JWT auth (SECRET_KEY)", s.port)
		return s.httpServer.ListenAndServe()
	}

	if s.certFile != "" && s.keyFile != "" {
		cert, err := tls.LoadX509KeyPair(s.certFile, s.keyFile)
		if err != nil {
			return fmt.Errorf("load TLS key pair: %w", err)
		}
		tlsCfg := &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		}
		if s.clientCAFile != "" {
			caPEM, err := os.ReadFile(s.clientCAFile)
			if err != nil {
				return fmt.Errorf("read client CA file: %w", err)
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(caPEM) {
				return fmt.Errorf("no certificates parsed from client CA file %s", s.clientCAFile)
			}
			tlsCfg.ClientCAs = pool
			tlsCfg.ClientAuth = tls.RequireAndVerifyClientCert
			logger.Infof("API server mTLS enabled: client CA %s", s.clientCAFile)
		}
		addr := fmt.Sprintf(":%d", s.port)
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			return err
		}
		tlsLn := tls.NewListener(ln, tlsCfg)
		logger.Infof("API server listening on port %d with HTTPS (cert: %s, key: %s)", s.port, s.certFile, s.keyFile)
		return s.httpServer.Serve(tlsLn)
	}

	logger.Infof("API server listening on port %d", s.port)
	return s.httpServer.ListenAndServe()
}

// Stop stops the HTTP server.
func (s *Server) Stop() error {
	if s.httpServer == nil {
		return nil
	}
	return s.httpServer.Close()
}

// authMiddleware validates API key from Authorization header.
func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip auth for health
		if c.Request.URL.Path == "/health" || c.Request.URL.Path == "/api/v1/ready" {
			c.Next()
			return
		}

		// Log incoming request for debugging
		logger.Debugf("Incoming request: %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			logger.Warningf("Request to %s rejected: missing Authorization header", c.Request.URL.Path)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing Authorization header"})
			c.Abort()
			return
		}

		if s.pairing == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server not configured"})
			c.Abort()
			return
		}
		if err := verifyBearerJWT(authHeader, s.pairing); err != nil {
			logger.Warningf("Request to %s rejected: JWT: %v", c.Request.URL.Path, err)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func verifyBearerJWT(authHeader string, bundle *auth.Bundle) error {
	if bundle == nil || strings.TrimSpace(bundle.AuthSecret) == "" {
		return fmt.Errorf("jwt not configured")
	}
	if len(authHeader) < 8 || !strings.HasPrefix(authHeader, "Bearer ") {
		return fmt.Errorf("missing bearer")
	}
	tokenStr := strings.TrimSpace(authHeader[7:])
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(auth.JWTIssuer),
		jwt.WithAudience(auth.JWTAudience),
	)
	_, err := parser.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(bundle.AuthSecret), nil
	})
	return err
}

// health returns the health status of the node (includes xray readiness; no auth required).
func (s *Server) health(c *gin.Context) {
	st := s.xrayManager.GetStatus()
	tCount := 0
	aCount := 0
	if s.telemtManager != nil {
		tCount = s.telemtManager.RunningCount()
	}
	if s.amneziawgManager != nil {
		aCount = s.amneziawgManager.RunningCount()
	}
	c.JSON(http.StatusOK, gin.H{
		"status":           "ok",
		"service":          "sharx-node",
		"sharxVersion":     config.GetVersion(),
		"xrayRunning":      st["running"],
		"xrayVersion":      st["version"],
		"xrayUptime":       st["uptime"],
		"telemtRunning":    tCount > 0,
		"telemtCount":      tCount,
		"telemtVersion":    telemtinstall.ReadVersion(""),
		"amneziawgRunning": aCount > 0,
		"amneziawgCount":   aCount,
	})
}

// applyConfig applies a new XRAY configuration.
func (s *Server) applyConfig(c *gin.Context) {
	logger.Infof("Apply config request received")

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.Errorf("Failed to read request body: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
		return
	}

	logger.Infof("Request body read, size: %d bytes", len(body))

	var telemtRaw json.RawMessage
	var amneziawgRaw json.RawMessage
	reqCoreProfileHash := ""
	reqExpectedSHA := ""

	var requestData struct {
		Config               json.RawMessage `json:"config"`
		PanelURL             string          `json:"panelUrl,omitempty"`
		NodeId               int             `json:"nodeId,omitempty"`
		Telemt               json.RawMessage `json:"telemt"`
		AmneziaWG            json.RawMessage `json:"amneziawg"`
		CoreProfileHash      string          `json:"coreProfileHash,omitempty"`
		ExpectedConfigSha256 string          `json:"expectedConfigSha256,omitempty"`
		LogRotate            json.RawMessage `json:"logRotate,omitempty"`
	}

	configBytes := body
	// Envelope: { "config": {...}, "panelUrl", "telemt": [...], "amneziawg": [...] }
	if err := json.Unmarshal(body, &requestData); err == nil && len(requestData.Config) > 0 {
		configBytes = requestData.Config
		telemtRaw = requestData.Telemt
		amneziawgRaw = requestData.AmneziaWG
		reqCoreProfileHash = strings.TrimSpace(requestData.CoreProfileHash)
		reqExpectedSHA = strings.TrimSpace(requestData.ExpectedConfigSha256)
		if len(requestData.LogRotate) > 0 {
			applyLogRotateFromJSON(requestData.LogRotate)
		}
		if requestData.NodeId > 0 {
			if err := nodeConfig.SetNodeId(requestData.NodeId); err != nil {
				logger.Warningf("Failed to persist node id: %v", err)
			} else {
				logger.Infof("Parsed request with nodeId: %d", requestData.NodeId)
			}
		}
		if requestData.PanelURL != "" {
			panelURL := requestData.PanelURL
			logger.Infof("Parsed request with panelUrl: %s", panelURL)
			go try(func() {
				if err := nodeConfig.SetPanelURL(panelURL); err != nil {
					logger.Warningf("Failed to persist panel URL: %v", err)
				}
				nodeLogs.SetPanelURL(panelURL)
				logger.Infof("Panel URL updated in log pusher: %s", panelURL)
				// Startup geopush may have skipped with empty PANEL_URL; panel sends URL on first apply-config.
				if s.pairing != nil {
					hk := s.pairing.OutboundHMACKey()
					nodeAddr := nodeConfig.GetConfig().NodeAddress
					if nodeAddr == "" {
						nodeAddr = os.Getenv("NODE_ADDRESS")
					}
					if nodeAddr == "" {
						nodeAddr = fmt.Sprintf("http://127.0.0.1:%d", s.port)
					}
					geopush.Run(panelURL, nodeAddr, hk)
				}
			})
		}
	} else {
		// Raw Xray JSON (no envelope)
		logger.Infof("Parsing as raw Xray config (no envelope)")
		var configJSON json.RawMessage
		if err := json.Unmarshal(body, &configJSON); err != nil {
			logger.Errorf("Invalid JSON: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
			return
		}
	}

	cfgHash := sha256.Sum256(configBytes)
	cfgHashHex := hex.EncodeToString(cfgHash[:])

	if reqExpectedSHA != "" && !strings.EqualFold(reqExpectedSHA, cfgHashHex) {
		logger.Warningf("apply-config: expectedConfigSha256 mismatch: actual=%s expected=%s", cfgHashHex, reqExpectedSHA)
	}
	if reqCoreProfileHash != "" {
		logger.Infof("apply-config: coreProfileHash from panel: %s", reqCoreProfileHash)
	}

	logger.Infof("Applying XRAY configuration...")
	if err := s.xrayManager.ApplyConfig(configBytes); err != nil {
		logger.Errorf("Failed to apply config: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.applySidecarPayloads(telemtRaw, amneziawgRaw)

	st := s.xrayManager.GetStatus()
	appliedAt := time.Now().Unix()
	resp := gin.H{
		"message":      "Configuration applied successfully",
		"appliedAt":    appliedAt,
		"configSha256": cfgHashHex,
		"xrayVersion":  st["version"],
		"xrayUptime":   st["uptime"],
		"xrayRunning":  st["running"],
	}
	if reqCoreProfileHash != "" {
		resp["coreProfileHash"] = reqCoreProfileHash
	}
	if reqExpectedSHA != "" {
		resp["configSha256Match"] = strings.EqualFold(reqExpectedSHA, cfgHashHex)
	}
	logger.Infof("Configuration applied successfully, sending response")
	c.JSON(http.StatusOK, resp)
	logger.Infof("Apply config response sent")
}

func (s *Server) applySidecarPayloads(telemtRaw, amneziawgRaw json.RawMessage) {
	if s.telemtManager != nil && len(telemtRaw) > 0 && string(telemtRaw) != "null" {
		var telemtPayloads []telemt.Payload
		if err := json.Unmarshal(telemtRaw, &telemtPayloads); err != nil {
			logger.Warningf("telemt: invalid JSON: %v", err)
		} else if err := s.telemtManager.Apply(telemtPayloads); err != nil {
			logger.Warningf("telemt: apply: %v", err)
		}
	}

	if s.amneziawgManager != nil && len(amneziawgRaw) > 0 && string(amneziawgRaw) != "null" {
		var awgPayloads []amneziawg.Payload
		if err := json.Unmarshal(amneziawgRaw, &awgPayloads); err != nil {
			logger.Warningf("amneziawg: invalid JSON: %v", err)
		} else if err := s.amneziawgManager.Apply(awgPayloads); err != nil {
			logger.Warningf("amneziawg: apply: %v", err)
		}
	}
}

// applySidecars updates Telemt / AmneziaWG sidecars without touching Xray-core.
func (s *Server) applySidecars(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
		return
	}

	var requestData struct {
		Telemt    json.RawMessage `json:"telemt"`
		AmneziaWG json.RawMessage `json:"amneziawg"`
		PanelURL  string          `json:"panelUrl,omitempty"`
		NodeId    int             `json:"nodeId,omitempty"`
	}
	if err := json.Unmarshal(body, &requestData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	if requestData.NodeId > 0 {
		if err := nodeConfig.SetNodeId(requestData.NodeId); err != nil {
			logger.Warningf("apply-sidecars: persist node id: %v", err)
		}
	}
	if requestData.PanelURL != "" {
		panelURL := requestData.PanelURL
		go try(func() {
			if err := nodeConfig.SetPanelURL(panelURL); err != nil {
				logger.Warningf("apply-sidecars: persist panel URL: %v", err)
			}
			nodeLogs.SetPanelURL(panelURL)
		})
	}

	logger.Infof("apply-sidecars: syncing sidecars (Xray untouched)")
	s.applySidecarPayloads(requestData.Telemt, requestData.AmneziaWG)

	tCount, aCount := 0, 0
	if s.telemtManager != nil {
		tCount = s.telemtManager.RunningCount()
	}
	if s.amneziawgManager != nil {
		aCount = s.amneziawgManager.RunningCount()
	}
	c.JSON(http.StatusOK, gin.H{
		"message":          "Sidecars applied successfully",
		"appliedAt":        time.Now().Unix(),
		"telemtRunning":    tCount > 0,
		"telemtCount":      tCount,
		"amneziawgRunning": aCount > 0,
		"amneziawgCount":   aCount,
	})
}

// stopXray stops the Xray core process on this worker. Telemt sidecars are unaffected; use POST /stop-telemt separately.
func (s *Server) stopXray(c *gin.Context) {
	logger.Infof("stop-xray: stopping Xray core on worker")
	if err := s.xrayManager.Stop(); err != nil {
		logger.Errorf("stop-xray: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "XRAY stopped", "xrayRunning": false})
}

// stopTelemt stops Telemt sidecars only (Xray keeps running).
func (s *Server) stopTelemt(c *gin.Context) {
	logger.Infof("stop-telemt: stopping Telemt sidecars on worker")
	if s.telemtManager == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Telemt not configured", "telemtRunning": false, "telemtCount": 0})
		return
	}
	s.telemtManager.Stop()
	c.JSON(http.StatusOK, gin.H{"message": "Telemt stopped", "telemtRunning": false, "telemtCount": 0})
}

// restartTelemt stops Telemt sidecars and reapplies the last successful Telemt payloads from the panel.
func (s *Server) restartTelemt(c *gin.Context) {
	logger.Infof("restart-telemt: restarting Telemt sidecars on worker")
	if s.telemtManager == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Telemt not configured", "telemtRunning": false, "telemtCount": 0})
		return
	}
	payloads, ok := s.telemtManager.ReplaySnapshotForRestart()
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no Telemt config applied yet; push config from the panel first"})
		return
	}
	s.telemtManager.Stop()
	if err := s.telemtManager.Apply(payloads); err != nil {
		logger.Errorf("restart-telemt: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tCount := s.telemtManager.RunningCount()
	c.JSON(http.StatusOK, gin.H{"message": "Telemt restarted", "telemtRunning": tCount > 0, "telemtCount": tCount})
}

// stopAmneziaWg stops AmneziaWG sidecars only (Xray keeps running).
func (s *Server) stopAmneziaWg(c *gin.Context) {
	logger.Infof("stop-amneziawg: stopping AmneziaWG sidecars on worker")
	if s.amneziawgManager == nil {
		c.JSON(http.StatusOK, gin.H{"message": "AmneziaWG not configured", "amneziawgRunning": false, "amneziawgCount": 0})
		return
	}
	s.amneziawgManager.Stop()
	c.JSON(http.StatusOK, gin.H{"message": "AmneziaWG stopped", "amneziawgRunning": false, "amneziawgCount": 0})
}

// restartAmneziaWg stops AmneziaWG sidecars and reapplies the last successful payloads from the panel.
func (s *Server) restartAmneziaWg(c *gin.Context) {
	logger.Infof("restart-amneziawg: restarting AmneziaWG sidecars on worker")
	if s.amneziawgManager == nil {
		c.JSON(http.StatusOK, gin.H{"message": "AmneziaWG not configured", "amneziawgRunning": false, "amneziawgCount": 0})
		return
	}
	payloads, ok := s.amneziawgManager.ReplaySnapshotForRestart()
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no AmneziaWG config applied yet; push config from the panel first"})
		return
	}
	s.amneziawgManager.Stop()
	if err := s.amneziawgManager.Apply(payloads); err != nil {
		logger.Errorf("restart-amneziawg: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	aCount := s.amneziawgManager.RunningCount()
	c.JSON(http.StatusOK, gin.H{"message": "AmneziaWG restarted", "amneziawgRunning": aCount > 0, "amneziawgCount": aCount})
}

// reload reloads XRAY configuration.
func (s *Server) reload(c *gin.Context) {
	if err := s.xrayManager.Reload(); err != nil {
		logger.Errorf("Failed to reload: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "XRAY reloaded successfully"})
}

// forceReload forcefully reloads XRAY even if it's hung or not running.
func (s *Server) forceReload(c *gin.Context) {
	if err := s.xrayManager.ForceReload(); err != nil {
		logger.Errorf("Failed to force reload: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "XRAY force reloaded successfully"})
}

// status returns the current status of XRAY.
func (s *Server) status(c *gin.Context) {
	status := s.xrayManager.GetStatus()
	tCount := 0
	if s.telemtManager != nil {
		tCount = s.telemtManager.RunningCount()
	}
	aCount := 0
	if s.amneziawgManager != nil {
		aCount = s.amneziawgManager.RunningCount()
	}
	status["telemtRunning"] = tCount > 0
	status["telemtCount"] = tCount
	status["telemtVersion"] = telemtinstall.ReadVersion("")
	status["amneziawgRunning"] = aCount > 0
	status["amneziawgCount"] = aCount
	status["sharxVersion"] = config.GetVersion()
	for k, v := range hostMetricsForStatusJSON() {
		status[k] = v
	}
	c.JSON(http.StatusOK, status)
}

func (s *Server) dockerUpdaterStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"enabled": dockerupdater.Configured()})
}

func (s *Server) dockerUpdaterTrigger(c *gin.Context) {
	ctx := c.Request.Context()
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 2*time.Minute {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 3*time.Minute)
		defer cancel()
	}
	if err := dockerupdater.Trigger(ctx); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Docker updater triggered"})
}

// stats returns traffic and online clients statistics from XRAY.
func (s *Server) stats(c *gin.Context) {
	logger.Debugf("Stats request received")

	// Get reset parameter (default: false)
	reset := c.DefaultQuery("reset", "false") == "true"
	logger.Debugf("Getting stats (reset=%v)", reset)

	stats, err := s.xrayManager.GetStats(reset)
	if err != nil {
		if errors.Is(err, xray.ErrXrayNotReady) {
			logXrayNotReadyThrottled("stats")
			// Telemt runs outside Xray. Returning 503 here hid all MTProto counters/online in the panel
			// whenever the core was stopped or not ready, even though Telegram still worked.
			stats = &xray.NodeStats{}
			if s.telemtManager != nil {
				s.telemtManager.MergeTelemtIntoNodeStats(&stats.Traffic, &stats.ClientTraffic, &stats.OnlineClients)
			}
			if s.amneziawgManager != nil {
				s.amneziawgManager.MergeAmneziaWgIntoNodeStats(&stats.Traffic, &stats.ClientTraffic, &stats.OnlineClients)
			}
			c.JSON(http.StatusOK, stats)
			return
		}
		logger.Errorf("Failed to get stats: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	logger.Debugf("Stats retrieved successfully, sending response")
	if s.telemtManager != nil {
		s.telemtManager.MergeTelemtIntoNodeStats(&stats.Traffic, &stats.ClientTraffic, &stats.OnlineClients)
	}
	if s.amneziawgManager != nil {
		s.amneziawgManager.MergeAmneziaWgIntoNodeStats(&stats.Traffic, &stats.ClientTraffic, &stats.OnlineClients)
	}
	c.JSON(http.StatusOK, stats)
	logger.Debugf("Stats response sent")
}

// userOnlineSessions returns per-IP online data from Xray stats (user>>>email>>>online) plus Telemt MTProto IPs.
func (s *Server) userOnlineSessions(c *gin.Context) {
	email := strings.TrimSpace(c.Query("email"))
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email query parameter is required"})
		return
	}
	reset := c.DefaultQuery("reset", "false") == "true"
	sessions, err := s.xrayManager.GetUserOnlineSessions(email, reset)
	xrayNotReady := errors.Is(err, xray.ErrXrayNotReady)
	if err != nil && !xrayNotReady {
		// Do not fail the whole handler: Telemt session IPs come from the sidecar API, not Xray.
		// Missing statsUserOnline / gRPC errors would otherwise hide MTProto sessions in multi-node.
		logger.Warningf("user-online-sessions: xray query failed (continuing with telemt): %v", err)
		sessions = nil
	} else if xrayNotReady {
		sessions = nil
	}
	if s.telemtManager != nil {
		sessions = append(sessions, s.telemtManager.CollectOnlineSessionsForUser(email)...)
	}
	if xrayNotReady && len(sessions) == 0 && (s.telemtManager == nil || !s.telemtManager.HasRunning()) {
		logXrayNotReadyThrottled("user-online-sessions")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": xray.ErrXrayNotReady.Error(), "code": errCodeXrayNotReady})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"email":         email,
		"sessions":      sessions,
		"dropAvailable": s.xrayManager.ConntrackDropAvailable(),
	})
}

type dropConnBody struct {
	Emails []string `json:"emails"`
	Email  string   `json:"email"`
}

// dropConnections drops kernel connections for one or more client emails (all IPs in their online map).
func (s *Server) dropConnections(c *gin.Context) {
	var body dropConnBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	emails := body.Emails
	if body.Email != "" {
		emails = append(emails, body.Email)
	}
	if len(emails) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email or emails required"})
		return
	}
	if !s.xrayManager.ConntrackDropAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": conndrop.ErrConntrackUnavailable.Error()})
		return
	}
	var lastErr error
	for _, e := range emails {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if err := s.xrayManager.DropConnectionsByEmail(e); err != nil {
			lastErr = err
		}
	}
	if lastErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": lastErr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type dropIPsBody struct {
	IPs []string `json:"ips"`
}

// dropIPs drops kernel connections for the given IPs (conntrack).
func (s *Server) dropIPs(c *gin.Context) {
	var body dropIPsBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(body.IPs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ips required"})
		return
	}
	if !s.xrayManager.ConntrackDropAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": conndrop.ErrConntrackUnavailable.Error()})
		return
	}
	if err := s.xrayManager.DropConnectionsByIPs(body.IPs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// getLogs returns XRAY access logs from the node.
func (s *Server) getLogs(c *gin.Context) {
	// Get query parameters
	countStr := c.DefaultQuery("count", "100")
	filter := c.DefaultQuery("filter", "")

	count, err := strconv.Atoi(countStr)
	if err != nil || count < 1 || count > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid count parameter (must be 1-10000)"})
		return
	}

	logs, err := s.xrayManager.GetLogs(count, filter)
	if err != nil {
		if errors.Is(err, xray.ErrXrayNotReady) {
			logXrayNotReadyThrottled("logs")
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error(), "code": errCodeXrayNotReady})
			return
		}
		logger.Errorf("Failed to get logs: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"logs": logs})
}

// getServiceLogs returns service application logs from the node (node service logs and XRAY core logs).
func (s *Server) getServiceLogs(c *gin.Context) {
	// Get query parameters
	countStr := c.DefaultQuery("count", "100")
	level := c.DefaultQuery("level", "debug")

	count, err := strconv.Atoi(countStr)
	if err != nil || count < 1 || count > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid count parameter (must be 1-10000)"})
		return
	}

	// Get logs from logger buffer
	logs := logger.GetLogs(count, level)
	c.JSON(http.StatusOK, gin.H{"logs": logs})
}

// installXray installs or updates Xray to the specified version.
func (s *Server) installXray(c *gin.Context) {
	version := c.Param("version")
	if version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Version parameter is required"})
		return
	}

	// Remove 'v' prefix if present
	if strings.HasPrefix(version, "v") {
		version = version[1:]
	}

	logger.Infof("Installing Xray version %s", version)
	if err := s.xrayManager.InstallXrayVersion(version); err != nil {
		logger.Errorf("Failed to install Xray version %s: %v", version, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Xray version %s installed successfully", version),
		"version": version,
	})
}

// installTelemt installs or updates Telemt to the specified version.
func (s *Server) installTelemt(c *gin.Context) {
	version := c.Param("version")
	if version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Version parameter is required"})
		return
	}
	if strings.HasPrefix(version, "v") {
		version = version[1:]
	}
	if s.telemtManager == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Telemt manager not configured"})
		return
	}

	logger.Infof("Installing Telemt version %s", version)
	if err := s.telemtManager.InstallVersion(version); err != nil {
		logger.Errorf("Failed to install Telemt version %s: %v", version, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Telemt version %s installed successfully", version),
		"version": version,
	})
}

func isNodeGeofileAllowed(name string) bool {
	switch strings.TrimSpace(name) {
	case "geoip.dat", "geosite.dat":
		return true
	default:
		return false
	}
}

func resolveNodeBinDir() (string, error) {
	candidates := []string{"bin", "/app/bin", "./bin"}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p, nil
		}
	}
	return "", fmt.Errorf("bin directory not found")
}

func writeNodeGeofileWithBackup(fileName string, content []byte) error {
	if len(content) == 0 {
		return fmt.Errorf("empty geofile payload")
	}
	binDir, err := resolveNodeBinDir()
	if err != nil {
		return err
	}
	dest := filepath.Join(binDir, fileName)
	backup := dest + ".bak"
	tmp := fmt.Sprintf("%s.tmp.%d", dest, time.Now().UnixNano())

	if err := os.WriteFile(tmp, content, 0644); err != nil {
		return err
	}
	if _, err := os.Stat(dest); err == nil {
		_ = os.Remove(backup)
		if err := os.Rename(dest, backup); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func rollbackNodeGeofile(fileName string) error {
	binDir, err := resolveNodeBinDir()
	if err != nil {
		return err
	}
	dest := filepath.Join(binDir, fileName)
	backup := dest + ".bak"
	if _, err := os.Stat(backup); err != nil {
		return fmt.Errorf("backup not found for %s", fileName)
	}
	swap := fmt.Sprintf("%s.swap.%d", dest, time.Now().UnixNano())
	destExists := true
	if _, err := os.Stat(dest); err != nil {
		destExists = false
	}
	if destExists {
		if err := os.Rename(dest, swap); err != nil {
			return err
		}
	}
	if err := os.Rename(backup, dest); err != nil {
		if destExists {
			_ = os.Rename(swap, dest)
		}
		return err
	}
	if destExists {
		if err := os.Rename(swap, backup); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) restartXrayIfRunning() error {
	st := s.xrayManager.GetStatus()
	running, _ := st["running"].(bool)
	if !running {
		return nil
	}
	return s.xrayManager.ForceReload()
}

func (s *Server) uploadGeofile(c *gin.Context) {
	fileName := strings.TrimSpace(c.Param("fileName"))
	if !isNodeGeofileAllowed(fileName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid geofile name"})
		return
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()
	const nodeMaxGeoSize = 256 * 1024 * 1024
	content, err := io.ReadAll(io.LimitReader(file, nodeMaxGeoSize+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(content) > nodeMaxGeoSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}
	if err := writeNodeGeofileWithBackup(fileName, content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := s.restartXrayIfRunning(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "geofile uploaded"})
}

func (s *Server) rollbackGeofile(c *gin.Context) {
	fileName := strings.TrimSpace(c.Param("fileName"))
	if !isNodeGeofileAllowed(fileName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid geofile name"})
		return
	}
	if err := rollbackNodeGeofile(fileName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := s.restartXrayIfRunning(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "geofile rolled back"})
}

// sessionIPBlockRouting adds or removes one session-IP routing rule via Xray RoutingService (no core restart).
func (s *Server) sessionIPBlockRouting(c *gin.Context) {
	var req struct {
		Blocked bool   `json:"blocked"`
		RuleTag string `json:"ruleTag"`
		Email   string `json:"email"`
		Cidr    string `json:"cidr"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Blocked {
		if strings.TrimSpace(req.RuleTag) == "" || strings.TrimSpace(req.Email) == "" || strings.TrimSpace(req.Cidr) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "blocked=true requires ruleTag, email, and cidr"})
			return
		}
	} else if strings.TrimSpace(req.RuleTag) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "blocked=false requires ruleTag"})
		return
	}

	if !s.xrayManager.IsRunning() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": errCodeXrayNotReady, "error": "XRAY is not running"})
		return
	}

	if err := s.xrayManager.ApplySessionIPBlockRoutingHot(req.Blocked, req.RuleTag, req.Email, req.Cidr); err != nil {
		if errors.Is(err, xray.ErrXrayNotReady) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": errCodeXrayNotReady, "error": err.Error()})
			return
		}
		logger.Errorf("session-ip-block-routing: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "routing updated"})
}

// addUser adds a user to an inbound via Xray API (instant, no restart).
func (s *Server) addUser(c *gin.Context) {
	var req struct {
		Protocol   string                 `json:"protocol" binding:"required"`
		InboundTag string                 `json:"inboundTag" binding:"required"`
		User       map[string]interface{} `json:"user" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	email, _ := req.User["email"].(string)
	logger.Infof("Add user request received: email=%s, protocol=%s, inboundTag=%s", email, req.Protocol, req.InboundTag)

	if !s.xrayManager.IsRunning() {
		logger.Warningf("Cannot add user %s: XRAY is not running", email)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "XRAY is not running"})
		return
	}

	// Add user via Xray API (instant, no restart needed)
	if err := s.xrayManager.AddUser(req.Protocol, req.InboundTag, req.User); err != nil {
		// Check if user already exists (this is OK - user is already in Xray)
		if strings.Contains(err.Error(), "already exists") {
			logger.Infof("User %s already exists in Xray (protocol=%s, inboundTag=%s) - this is OK", email, req.Protocol, req.InboundTag)
			c.JSON(http.StatusOK, gin.H{"message": "User already exists"})
			return
		}
		logger.Errorf("Failed to add user %s via API: %v", email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	logger.Infof("User added successfully via API: %s (protocol=%s, inboundTag=%s)", email, req.Protocol, req.InboundTag)
	c.JSON(http.StatusOK, gin.H{"message": "User added successfully"})
}

// removeUser removes a user from an inbound via Xray API (instant, no restart).
func (s *Server) removeUser(c *gin.Context) {
	var req struct {
		InboundTag string `json:"inboundTag" binding:"required"`
		Email      string `json:"email" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	logger.Infof("Remove user request received: email=%s, inboundTag=%s", req.Email, req.InboundTag)

	if !s.xrayManager.IsRunning() {
		logger.Warningf("Cannot remove user %s: XRAY is not running", req.Email)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "XRAY is not running"})
		return
	}

	// Remove user via Xray API (instant, no restart needed)
	if err := s.xrayManager.RemoveUser(req.InboundTag, req.Email); err != nil {
		// Check if user not found (this is OK - might already be removed)
		if strings.Contains(err.Error(), "not found") {
			logger.Infof("User %s already removed or not found in inbound %s", req.Email, req.InboundTag)
			c.JSON(http.StatusOK, gin.H{"message": "User already removed or not found"})
			return
		}
		logger.Errorf("Failed to remove user %s via API: %v", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	logger.Infof("User removed successfully via API: %s from inbound %s", req.Email, req.InboundTag)
	c.JSON(http.StatusOK, gin.H{"message": "User removed successfully"})
}

// removeInbound removes an inbound configuration via Xray API (instant, no restart).
func (s *Server) removeInbound(c *gin.Context) {
	var req struct {
		Tag string `json:"tag" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Warningf("Remove inbound request failed: invalid request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	logger.Infof("Remove inbound request received: tag=%s", req.Tag)

	if !s.xrayManager.IsRunning() {
		logger.Warningf("Cannot remove inbound %s: XRAY is not running", req.Tag)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "XRAY is not running"})
		return
	}

	// Remove inbound via Xray API (instant, no restart needed)
	if err := s.xrayManager.DelInbound(req.Tag); err != nil {
		logger.Errorf("Failed to remove inbound %s via API: %v", req.Tag, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	logger.Infof("Inbound removed successfully via API: %s", req.Tag)
	c.JSON(http.StatusOK, gin.H{"message": "Inbound removed successfully"})
}

// updateInbound updates an inbound configuration via Xray API (instant, no restart).
func (s *Server) updateInbound(c *gin.Context) {
	var req struct {
		InboundConfig json.RawMessage `json:"inboundConfig" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Warningf("Update inbound request failed: invalid request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Parse inbound config to get tag for logging
	var inboundJSON map[string]interface{}
	if err := json.Unmarshal(req.InboundConfig, &inboundJSON); err == nil {
		if tag, ok := inboundJSON["tag"].(string); ok {
			logger.Infof("Update inbound request received: tag=%s", tag)
		}
	}

	if !s.xrayManager.IsRunning() {
		logger.Warningf("Cannot update inbound: XRAY is not running")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "XRAY is not running"})
		return
	}

	// Update inbound via Xray API (instant, no restart needed)
	if err := s.xrayManager.UpdateInbound(req.InboundConfig); err != nil {
		logger.Errorf("Failed to update inbound via API: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tag, _ := inboundJSON["tag"].(string)
	logger.Infof("Inbound updated successfully via API: %s", tag)
	c.JSON(http.StatusOK, gin.H{"message": "Inbound updated successfully"})
}
