// Package main is the entry point for the SharX node service (worker).
// This service runs XRAY Core and provides a REST API for the master panel to manage it.
// Authentication is pairing-only: SECRET_KEY (TLS + mTLS + JWT); log push uses HMAC.
package main

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

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
	"github.com/konstpic/sharx-code/v2/node/xray"
	"github.com/konstpic/sharx-code/v2/util/pairing_outbound"
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

	configDirs := []string{"bin", "config", ".", "/app/bin", "/app/config"}
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
		logger.Error("SECRET_KEY is required (set env SECRET_KEY to the base64 JSON bundle from the panel)")
		os.Exit(1)
	}
	h := pairing_outbound.OutboundHMACKey(bundle.Payload.CACertPem, bundle.Payload.JWTPublicKey)
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

	xrayManager := xray.NewManager()
	telemtManager := telemt.NewManager()
	amneziawgManager := amneziawg.NewManager()
	if panelURL != "" {
		configpull.TryPullAndApply(panelURL, nodeAddress, h, xrayManager, telemtManager, amneziawgManager)
		configpull.StartBackgroundPull(panelURL, nodeAddress, h, xrayManager, telemtManager, amneziawgManager)
	}
	server := api.NewServer(port, xrayManager, telemtManager, amneziawgManager)
	server.SetPairing(bundle)
	logger.Info("SECRET_KEY: TLS + mTLS + JWT; log push uses HMAC (optional PANEL_URL in config or env)")

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
		if err := server.Stop(); err != nil {
			logger.Warningf("server stop: %v", err)
		}
	}

	logger.Info("Shutdown complete")
}
