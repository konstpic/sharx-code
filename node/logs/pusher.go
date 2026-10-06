// Package logs provides log pushing functionality for sending logs from node to panel in real-time.
package logs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	nodeConfigPkg "github.com/konstpic/sharx-code/v2/node/config"
	"github.com/konstpic/sharx-code/v2/util/pairing_outbound"
)

// LogPusher sends logs to the panel in real-time.
type LogPusher struct {
	panelURL    string
	hmacKey     [32]byte
	nodeAddress string // Node's own address for identification
	logBuffer   []nodeLogItem
	bufferMu    sync.Mutex
	client      *http.Client
	enabled     bool
	lastPush    time.Time
	pushTicker  *time.Ticker
	stopCh      chan struct{}
}

type nodeLogItem struct {
	Entry logger.Entry
}

var (
	outboundHmacKey  [32]byte
	outboundHmacSet  bool
	outboundHmacLock sync.Mutex
)

// SetOutboundHMACKey sets the key derived from the SECRET_KEY bundle. Call before InitLogPusher.
func SetOutboundHMACKey(k [32]byte) {
	outboundHmacLock.Lock()
	defer outboundHmacLock.Unlock()
	outboundHmacKey = k
	outboundHmacSet = true
}

var (
	pusher     *LogPusher
	pusherOnce sync.Once
	pusherMu   sync.RWMutex
)

// InitLogPusher initializes the log pusher when HMAC (from SECRET_KEY) is set. Pairing-only.
// nodeAddress is the address of this node (e.g., "https://host:8080") for HMAC/address matching.
func InitLogPusher(nodeAddress string) {
	pusherOnce.Do(func() {
		outboundHmacLock.Lock()
		hmacK := outboundHmacKey
		haveHmac := outboundHmacSet
		outboundHmacLock.Unlock()

		if !haveHmac {
			logger.Debug("Log pusher disabled: SECRET_KEY HMAC not set")
			return
		}

		// Try to get panel URL from environment variable first, then from saved config
		panelURL := os.Getenv("PANEL_URL")
		if panelURL == "" {
			cfg := getNodeConfig()
			if cfg != nil && cfg.PanelURL != "" {
				panelURL = cfg.PanelURL
				logger.Debug("Using panel URL from saved configuration for log pusher")
			}
		}

		pusher = &LogPusher{
			panelURL:    panelURL,
			hmacKey:     hmacK,
			nodeAddress: nodeAddress,
			logBuffer:   make([]nodeLogItem, 0, 10),
			client: &http.Client{
				Timeout: 5 * time.Second,
			},
			enabled: panelURL != "", // Enable only if panel URL is set
			stopCh:  make(chan struct{}),
		}

		if pusher.enabled {
			// Start periodic push (every 2 seconds or when buffer is full)
			pusher.pushTicker = time.NewTicker(2 * time.Second)
			go pusher.run()
			logger.Debugf("Log pusher initialized: sending logs to %s", panelURL)
		} else {
			logger.Debug("Log pusher initialized but disabled: waiting for panel URL")
		}
	})
}

// nodeConfigData represents the node configuration structure.
type nodeConfigData struct {
	PanelURL    string `json:"panelUrl"`
	NodeAddress string `json:"nodeAddress"`
	NodeId      int    `json:"nodeId,omitempty"`
}

// getNodeConfig is a helper to get node config without circular dependency.
// It reads the config file directly to avoid importing the config package.
func getNodeConfig() *nodeConfigData {
	// The node's own persisted config (data volume, loaded at startup) is the source of truth: it holds the panel-assigned
	// nodeId. Reading only the legacy bin/config paths below missed it, so pushes carried no nodeId and a node without
	// NODE_ADDRESS (address falls back to 127.0.0.1) could not be matched by the panel: its journal stayed empty.
	if c := nodeConfigPkg.GetConfig(); c != nil && (c.PanelURL != "" || c.NodeAddress != "" || c.NodeId > 0) {
		return &nodeConfigData{PanelURL: c.PanelURL, NodeAddress: c.NodeAddress, NodeId: c.NodeId}
	}
	configPaths := []string{"bin/node-config.json", "config/node-config.json", "./node-config.json", "/app/bin/node-config.json", "/app/config/node-config.json"}

	for _, path := range configPaths {
		if data, err := os.ReadFile(path); err == nil {
			var config nodeConfigData
			if err := json.Unmarshal(data, &config); err == nil {
				return &config
			}
		}
	}
	return nil
}

// SetPanelURL sets the panel URL and enables the log pusher.
// PANEL_URL from environment variable has priority and won't be overwritten.
func SetPanelURL(url string) {
	pusherMu.Lock()
	defer pusherMu.Unlock()

	// Check if PANEL_URL is set in environment - it has priority
	envPanelURL := os.Getenv("PANEL_URL")
	if envPanelURL != "" {
		// Environment variable has priority, ignore URL from config
		if pusher != nil && pusher.panelURL == envPanelURL {
			// Already set from env, don't update
			return
		}
		// Use environment variable instead
		url = envPanelURL
		logger.Debugf("Using PANEL_URL from environment: %s (ignoring config URL)", envPanelURL)
	}

	if pusher == nil {
		outboundHmacLock.Lock()
		hk := outboundHmacKey
		hHmac := outboundHmacSet
		outboundHmacLock.Unlock()
		if !hHmac {
			logger.Debug("Cannot set panel URL: SECRET_KEY HMAC not set")
			return
		}

		nodeAddress := os.Getenv("NODE_ADDRESS")
		if nodeAddress == "" {
			cfg := getNodeConfig()
			if cfg != nil && cfg.NodeAddress != "" {
				nodeAddress = cfg.NodeAddress
			}
		}

		pusher = &LogPusher{
			hmacKey:     hk,
			nodeAddress: nodeAddress,
			logBuffer:   make([]nodeLogItem, 0, 10),
			client: &http.Client{
				Timeout: 5 * time.Second,
			},
			stopCh: make(chan struct{}),
		}
	}

	if url == "" {
		logger.Debug("Panel URL cleared, disabling log pusher")
		pusher.enabled = false
		if pusher.pushTicker != nil {
			pusher.pushTicker.Stop()
			pusher.pushTicker = nil
		}
		return
	}

	wasEnabled := pusher.enabled
	pusher.panelURL = url
	pusher.enabled = true

	if !wasEnabled && pusher.pushTicker == nil {
		// Start periodic push if it wasn't running
		pusher.pushTicker = time.NewTicker(2 * time.Second)
		go pusher.run()
		// Don't log here to avoid recursion - log will be sent via pusher
	} else if wasEnabled && pusher.panelURL != url {
		// Don't log here to avoid recursion
	}
}

// PushLog adds a log entry to the buffer for sending to panel.
func PushLog(logLine string) {
	pusherMu.RLock()
	pusherLocal := pusher
	pusherMu.RUnlock()

	if pusherLocal == nil {
		// Don't log here to avoid infinite loop
		return
	}

	if !pusherLocal.enabled {
		// Don't log here to avoid infinite loop
		return
	}

	// Skip logs that already contain node prefix to avoid infinite loop
	// These are logs that came from panel and shouldn't be sent back
	if strings.Contains(logLine, "[Node:") {
		return
	}

	// Skip logs about log pushing itself to avoid infinite loop
	if strings.Contains(logLine, "Logs pushed:") ||
		strings.Contains(logLine, "Failed to push logs") ||
		strings.Contains(logLine, "Log pusher") ||
		strings.Contains(logLine, "Panel URL") {
		return
	}

	// Prefer structured JSON line produced by logger.Emit (NDJSON).
	var e logger.Entry
	if err := json.Unmarshal([]byte(logLine), &e); err != nil {
		// Node log pusher is structured-only. Ignore non-JSON lines to avoid
		// reintroducing legacy parsing across the system.
		return
	}
	if strings.TrimSpace(e.Source) == "" {
		e.Source = "node"
	}

	item := nodeLogItem{
		Entry: e,
	}

	pusherLocal.bufferMu.Lock()
	defer pusherLocal.bufferMu.Unlock()

	pusherLocal.logBuffer = append(pusherLocal.logBuffer, item)

	// If buffer is getting large, push immediately
	if len(pusherLocal.logBuffer) >= 10 {
		go pusherLocal.push()
	}
}

// run periodically pushes logs to panel.
func (lp *LogPusher) run() {
	for {
		select {
		case <-lp.pushTicker.C:
			lp.bufferMu.Lock()
			if len(lp.logBuffer) > 0 {
				itemsToPush := make([]nodeLogItem, len(lp.logBuffer))
				copy(itemsToPush, lp.logBuffer)
				lp.logBuffer = lp.logBuffer[:0]
				lp.bufferMu.Unlock()

				go lp.pushLogs(itemsToPush)
			} else {
				lp.bufferMu.Unlock()
			}
		case <-lp.stopCh:
			return
		}
	}
}

// push immediately pushes current buffer to panel.
func (lp *LogPusher) push() {
	lp.bufferMu.Lock()
	if len(lp.logBuffer) == 0 {
		lp.bufferMu.Unlock()
		return
	}

	itemsToPush := make([]nodeLogItem, len(lp.logBuffer))
	copy(itemsToPush, lp.logBuffer)
	lp.logBuffer = lp.logBuffer[:0]
	lp.bufferMu.Unlock()

	lp.pushLogs(itemsToPush)
}

// pushLogs sends logs to the panel.
func (lp *LogPusher) pushLogs(items []nodeLogItem) {
	if len(items) == 0 || strings.TrimSpace(lp.nodeAddress) == "" {
		return
	}

	// Construct panel URL
	panelEndpoint := lp.panelURL
	if panelEndpoint[len(panelEndpoint)-1] != '/' {
		panelEndpoint += "/"
	}
	panelEndpoint += "panel/api/node/push-logs"

	// Don't log here to avoid recursion - this function is called from logger

	entries := make([]logger.Entry, 0, len(items))
	for _, it := range items {
		entries = append(entries, it.Entry)
	}

	// Structured-only: unified logger across node -> panel.
	reqBody := map[string]interface{}{
		"nodeAddress": lp.nodeAddress,
		"entries":     entries,
	}
	if cfg := getNodeConfig(); cfg != nil && cfg.NodeId > 0 {
		reqBody["nodeId"] = cfg.NodeId
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		logger.Emit(logger.Entry{
			Level:     "error",
			Source:    "node",
			Component: "log_pusher",
			Channel:   "service",
			Msg:       fmt.Sprintf("log_pusher: failed to marshal push request: %v", err),
		})
		return
	}

	req, err := http.NewRequest("POST", panelEndpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		logger.Emit(logger.Entry{
			Level:     "error",
			Source:    "node",
			Component: "log_pusher",
			Channel:   "service",
			Msg:       fmt.Sprintf("log_pusher: failed to create push request: %v", err),
		})
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sharx-Signature", "v1="+pairing_outbound.SignBody(lp.hmacKey, jsonData))

	// Use context with timeout to avoid blocking forever
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	resp, err := lp.client.Do(req)
	if err != nil {
		// Don't log here to avoid recursion - errors are expected if panel is unreachable
		// Silently fail - this is non-critical
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		// Don't log here to avoid recursion
		// Silently fail - this is non-critical
		_ = body // Suppress unused variable warning
		return
	}

	lp.lastPush = time.Now()
}

// Stop stops the log pusher.
func Stop() {
	if pusher != nil && pusher.pushTicker != nil {
		pusher.pushTicker.Stop()
		close(pusher.stopCh)
		// Push remaining logs
		pusher.push()
	}
}
