// Package config provides node configuration persistence (panel URL, node address).
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// NodeConfig represents the node's configuration stored on disk.
type NodeConfig struct {
	PanelURL    string `json:"panelUrl"`
	NodeAddress string `json:"nodeAddress"`
	// NodeId is assigned by the panel on first apply-config / pull-xray-config and
	// echoed back by this worker in push-geo/push-logs so the panel can identify the
	// source node unambiguously even when many workers share PANEL_URL / SECRET_KEY
	// and listen on the same port. Zero = not yet assigned.
	NodeId int `json:"nodeId,omitempty"`
}

var (
	config     *NodeConfig
	configMu   sync.RWMutex
	configPath string
)

// InitConfig initializes the configuration system and loads existing config if available.
func InitConfig(configDir string) error {
	configMu.Lock()
	defer configMu.Unlock()

	if configDir == "" {
		// Prefer the always-persistent data volume over bin/config, which several deployed
		// nodes don't mount as a named volume at all (see node/main.go for the full rationale).
		possibleDirs := []string{"/app/data", "data", "bin", "config", ".", "/app/bin", "/app/config"}
		for _, dir := range possibleDirs {
			if _, err := os.Stat(dir); err == nil {
				configDir = dir
				break
			}
		}
		if configDir == "" {
			configDir = "."
		}
	}

	configPath = filepath.Join(configDir, "node-config.json")

	if data, err := os.ReadFile(configPath); err == nil {
		var loadedConfig NodeConfig
		if err := json.Unmarshal(data, &loadedConfig); err == nil {
			config = &loadedConfig
			return nil
		}
	}

	config = &NodeConfig{}
	return nil
}

// GetConfig returns the current node configuration.
func GetConfig() *NodeConfig {
	configMu.RLock()
	defer configMu.RUnlock()

	if config == nil {
		return &NodeConfig{}
	}

	return &NodeConfig{
		PanelURL:    config.PanelURL,
		NodeAddress: config.NodeAddress,
		NodeId:      config.NodeId,
	}
}

// ClearNodeId removes a persisted panel node id (e.g. after pull 401 with stale id).
func ClearNodeId() error {
	return SetNodeId(0)
}

// SetNodeId persists the node id assigned by the panel.
func SetNodeId(id int) error {
	configMu.Lock()
	defer configMu.Unlock()

	if config == nil {
		config = &NodeConfig{}
	}
	if config.NodeId == id {
		return nil
	}
	config.NodeId = id
	return saveConfig()
}

// SetPanelURL sets the panel URL and saves it to disk.
func SetPanelURL(url string) error {
	configMu.Lock()
	defer configMu.Unlock()

	if config == nil {
		config = &NodeConfig{}
	}

	config.PanelURL = url
	return saveConfig()
}

// SetNodeAddress sets the node address and saves it to disk.
func SetNodeAddress(address string) error {
	configMu.Lock()
	defer configMu.Unlock()

	if config == nil {
		config = &NodeConfig{}
	}

	config.NodeAddress = address
	return saveConfig()
}

func saveConfig() error {
	if configPath == "" {
		return fmt.Errorf("config path not initialized, call InitConfig first")
	}

	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0600); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}

// GetConfigPath returns the path to the config file.
func GetConfigPath() string {
	configMu.RLock()
	defer configMu.RUnlock()
	return configPath
}
