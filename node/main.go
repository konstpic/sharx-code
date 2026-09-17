// Package main is the entry point for the SharX node service (worker).
// This service runs XRAY Core and provides a REST API for the master panel to manage it.
// Authentication is pairing-only: SECRET_KEY (JWT + HMAC); log push uses HMAC.
package main

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/api"
	"github.com/konstpic/sharx-code/v2/node/auth"
	nodeConfig "github.com/konstpic/sharx-code/v2/node/config"
	"github.com/konstpic/sharx-code/v2/node/configpull"
	"github.com/konstpic/sharx-code/v2/node/defaults"
	"github.com/konstpic/sharx-code/v2/node/geopush"
	nodeLogs "github.com/konstpic/sharx-code/v2/node/logs"
	"github.com/konstpic/sharx-code/v2/node/amneziawg"
	"github.com/konstpic/sharx-code/v2/node/telemt"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
	"github.com/konstpic/sharx-code/v2/node/xray"
	"github.com/op/go-logging"
)

func main() {
	var port int
	flag.IntVar(&port, "port", defaults.APIListenPort, "API server port (default "+fmt.Sprint(defaults.APIListenPort)+", host network)")
	flag.Parse()

	envPort := strings.TrimSpace(os.Getenv("SHARX_NODE_PORT"))
	if envPort == "" {
		envPort = strings.TrimSpace(os.Getenv("PORT"))
	}
	if envPort != "" {
		if p, err := strconv.Atoi(envPort); err == nil && p > 0 && p <= 65535 {
			port = p
		}
	}

	logger.InitLogger(logging.INFO)
	logger.SetSource("node")

	// node-config.json (panelUrl/nodeId) must live on the always-persistent data volume, not
	// /app/bin: several deployed nodes don't mount a bin volume at all, so anything written
	// there is lost on every container recreation. Without a saved panelUrl, configpull's
	// startup/background pull (this file's TryPullAndApply/StartBackgroundPull below) can't
	// proactively ask the panel for config after a restart, leaving Xray stopped until the
	// panel's own periodic health check happens to notice and push config down.
	preferredConfigDir := strings.TrimSpace(os.Getenv("SHARX_NODE_DATA_DIR"))
	if preferredConfigDir == "" {
		preferredConfigDir = "/app/data"
	}
	configDirs := []string{preferredConfigDir, "data", "bin", "config", ".", "/app/bin", "/app/config"}
	var configDir string
	for _, dir := range configDirs {
		if _, err := os.Stat(dir); err == nil {
			configDir = dir
			break
		}
	}
	if configDir == "" {
		configDir = "."
	}

	if err := nodeConfig.InitConfig(configDir); err != nil {
		logger.Errorf("Failed to initialize node config: %v", err)
		os.Exit(1)
	}

	bundle, err := auth.LoadBundleFromEnv()
	if err != nil {
		logger.Errorf("SECRET_KEY: %v", err)
		os.Exit(1)
	}
	if bundle == nil {
		logger.Error("SECRET_KEY is required (set env SECRET_KEY to the plain secret from the panel)")
		os.Exit(1)
	}
	h := bundle.OutboundHMACKey()
	nodeLogs.SetOutboundHMACKey(h)

	savedConfig := nodeConfig.GetConfig()
	// Environment must have priority over persisted config to avoid stale nodeAddress
	// in node-config.json overriding runtime docker-compose values.
	nodeAddress := os.Getenv("NODE_ADDRESS")
	if nodeAddress == "" {
		nodeAddress = savedConfig.NodeAddress
	}
	if nodeAddress == "" {
		nodeAddress = fmt.Sprintf("http://127.0.0.1:%d", port)
	}

	// Environment must have priority over persisted config to avoid stale panelUrl
	// in node-config.json overriding runtime docker-compose values.
	panelURL := os.Getenv("PANEL_URL")
	if panelURL == "" {
		panelURL = savedConfig.PanelURL
	}

	nodeLogs.InitLogPusher(nodeAddress)
	if panelURL != "" {
		nodeLogs.SetPanelURL(panelURL)
	}
	logger.SetLogPusher(nodeLogs.PushLog)

	// xray.NewManager() already loads and reapplies its own last-known-good config.json from
	// disk (see LoadConfigFromFile in node/xray/manager.go) — Telemt/AmneziaWG/telemtweb get
	// the equivalent below via nodecache, so every sidecar-serving component on this node can
	// resume traffic on its own after a restart even if the panel happens to be unreachable
	// at that exact moment (e.g. a panel outage overlapping a Watchtower image update).
	nodeDataDir := strings.TrimSpace(os.Getenv("SHARX_NODE_DATA_DIR"))
	if nodeDataDir == "" {
		nodeDataDir = "/app/data"
	}
	nodeCacheDir := filepath.Join(nodeDataDir, "node-cache")

	xrayManager := xray.NewManager()
	telemtManager := telemt.NewManager()
	telemtManager.SetCachePath(filepath.Join(nodeCacheDir, "telemt.json"))
	if err := telemtManager.LoadAndApplyCache(); err != nil {
		logger.Warningf("Telemt: resume from local cache: %v", err)
	}
	amneziawgManager := amneziawg.NewManager()
	amneziawgManager.SetCachePath(filepath.Join(nodeCacheDir, "amneziawg.json"))
	if err := amneziawgManager.LoadAndApplyCache(); err != nil {
		logger.Warningf("AmneziaWG: resume from local cache: %v", err)
	}
	telemtWebCertDir := strings.TrimSpace(os.Getenv("TELEMTWEB_CERT_DIR"))
	if telemtWebCertDir == "" {
		// Under /app/data (sharx-node-data volume in docker-compose) so issued certs survive
		// container restarts/recreates instead of re-issuing (and risking Let's Encrypt rate
		// limits) every time.
		telemtWebCertDir = filepath.Join(nodeDataDir, "telemtweb-certs")
	}
	telemtWebManager := telemtweb.NewManager(telemtWebCertDir)
	telemtWebManager.SetCachePath(filepath.Join(nodeCacheDir, "telemtweb.json"))
	if err := telemtWebManager.LoadAndApplyCache(); err != nil {
		logger.Warningf("telemtweb: resume from local cache: %v", err)
	}
	if panelURL != "" {
		configpull.TryPullAndApply(panelURL, nodeAddress, h, xrayManager, telemtManager, amneziawgManager, telemtWebManager)
		configpull.StartBackgroundPull(panelURL, nodeAddress, h, xrayManager, telemtManager, amneziawgManager, telemtWebManager)
	}
	// Xray has no auto-restart on an unexpected crash (unrelated to the panel — see
	// node/xray/process.go: cmd.Wait() failing only logs, never retries); this backstop
	// periodically reloads the last-known-good config.json whenever Xray isn't running,
	// independent of panel reachability.
	go xrayCrashWatchdog(xrayManager)
	server := api.NewServer(port, xrayManager, telemtManager, amneziawgManager, telemtWebManager)
	server.SetPairing(bundle)
	logger.Info("SECRET_KEY: JWT auth; log push uses HMAC (optional PANEL_URL in config or env)")

	logger.Infof("Starting SharX Node Service on port %d", port)
	// Must run before Start(): Start blocks on Serve(), so code after it never runs.
	go geopush.Run(panelURL, nodeAddress, h)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Start()
	}()

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Errorf("Failed to start server: %v", err)
			os.Exit(1)
		}
	case <-sigCh:
		logger.Info("Shutting down...")
		xrayManager.Stop()
		telemtManager.Stop()
		amneziawgManager.Stop()
		telemtWebManager.Stop()
		if err := server.Stop(); err != nil {
			logger.Warningf("server stop: %v", err)
		}
	}

	logger.Info("Shutdown complete")
}

// xrayCrashWatchdog periodically reloads Xray's last-known-good config.json whenever the
// process isn't running. It is the only thing that retries beyond configpull's one-shot
// ~30-minute startup window (see node/configpull/pull.go StartBackgroundPull), and it works
// entirely from local disk state — no panel reachability required — so a spontaneous Xray
// crash days into a node's uptime still gets self-healed instead of staying dark forever.
func xrayCrashWatchdog(mgr *xray.Manager) {
	const interval = 30 * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		if mgr == nil || mgr.IsRunning() {
			continue
		}
		logger.Warningf("Xray watchdog: process not running, attempting reload from local config.json")
		if err := mgr.LoadConfigFromFile(); err != nil {
			logger.Warningf("Xray watchdog: reload failed: %v", err)
		}
	}
}
