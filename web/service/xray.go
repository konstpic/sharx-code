package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/xray"

	"go.uber.org/atomic"
)

var (
	p                 *xray.Process
	lock              sync.Mutex
	isNeedXrayRestart atomic.Bool // Indicates that restart was requested for Xray
	isManuallyStopped atomic.Bool // Indicates that Xray was stopped manually from the panel
	result            string
	// API connection pool: map[apiPort]*xray.XrayAPI
	apiConnectionPool sync.Map
	apiPoolLock       sync.Mutex
	// When local Xray is not running (multi-node), the online set is not stored on *Process p.
	// We keep a copy here so GetOnlineClients() / WebSocket traffic broadcast still work.
	panelOnlineMu     sync.RWMutex
	panelOnlineEmails []string
)

// setPanelOnlineClients updates the in-memory online list. When local Xray is running,
// the same list is also applied to the *Process. When p is nil (typical in multi-node),
// only the snapshot is updated — otherwise panel would always show all clients as offline.
func setPanelOnlineClients(emails []string) {
	cpy := append([]string(nil), emails...)
	panelOnlineMu.Lock()
	panelOnlineEmails = cpy
	panelOnlineMu.Unlock()
	if p != nil {
		p.SetOnlineClients(cpy)
	}
}

// getPanelOnlineClients returns the current online list from the local Xray when it exists,
// otherwise the last snapshot (multi-node, node traffic collection, etc.).
func getPanelOnlineClients() []string {
	if p != nil {
		return p.GetOnlineClients()
	}
	panelOnlineMu.RLock()
	defer panelOnlineMu.RUnlock()
	return append([]string(nil), panelOnlineEmails...)
}

// AppendPanelOnlineClients merges additional emails into the panel online snapshot.
func AppendPanelOnlineClients(additional []string) {
	if len(additional) == 0 {
		return
	}
	current := getPanelOnlineClients()
	seen := make(map[string]struct{}, len(current)+len(additional))
	merged := make([]string, 0, len(current)+len(additional))
	for _, e := range current {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		k := strings.ToLower(e)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		merged = append(merged, e)
	}
	for _, e := range additional {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		k := strings.ToLower(e)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		merged = append(merged, e)
	}
	setPanelOnlineClients(merged)
}

// XrayService provides business logic for Xray process management.
// It handles starting, stopping, restarting Xray, and managing its configuration.
// In multi-node mode, it sends configurations to nodes instead of running Xray locally.
type XrayService struct {
	inboundService InboundService
	settingService SettingService
	nodeService    NodeService
	xrayAPI        xray.XrayAPI
}

// NewXrayService creates a new XrayService with default dependencies.
// This is used in places (like application startup) where we don't have
// an already-wired instance but need to operate on Xray configuration.
func NewXrayService() XrayService {
	return XrayService{
		inboundService: InboundService{},
		settingService: SettingService{},
		nodeService:    NodeService{},
	}
}

// IsXrayRunning checks if the Xray process is currently running.
func (s *XrayService) IsXrayRunning() bool {
	return p != nil && p.IsRunning()
}

// GetAPIPort returns the API port of the running Xray process.
func (s *XrayService) GetAPIPort() int {
	if p != nil && p.IsRunning() {
		return p.GetAPIPort()
	}
	return 0
}

// GetConfig returns the current Xray configuration.
func (s *XrayService) GetConfig() *xray.Config {
	if p != nil && p.IsRunning() {
		return p.GetConfig()
	}
	return nil
}

// GetOrCreateAPI gets or creates a cached XrayAPI connection for the given API port.
// This reuses connections to avoid the overhead of creating new gRPC connections.
// Returns the API client and a cleanup function that should be called when done.
// Note: The cleanup function does NOT close the connection (it's reused), it just releases the reference.
func (s *XrayService) GetOrCreateAPI(apiPort int) (*xray.XrayAPI, func(), error) {
	if apiPort <= 0 {
		return nil, nil, fmt.Errorf("invalid API port: %d", apiPort)
	}

	// Try to get existing connection
	if conn, ok := apiConnectionPool.Load(apiPort); ok {
		api := conn.(*xray.XrayAPI)
		if api.IsConnected() {
			// Connection is still valid, reuse it
			return api, func() {
				// No-op: connection stays in pool for reuse
			}, nil
		}
		// Connection is dead, remove it from pool
		apiConnectionPool.Delete(apiPort)
	}

	// Create new connection
	apiPoolLock.Lock()
	defer apiPoolLock.Unlock()

	// Double-check after acquiring lock (another goroutine might have created it)
	if conn, ok := apiConnectionPool.Load(apiPort); ok {
		api := conn.(*xray.XrayAPI)
		if api.IsConnected() {
			return api, func() {}, nil
		}
	}

	// Create new API connection
	api := &xray.XrayAPI{}
	if err := api.Init(apiPort); err != nil {
		return nil, nil, fmt.Errorf("failed to init XrayAPI: %w", err)
	}

	// Store in pool
	apiConnectionPool.Store(apiPort, api)

	return api, func() {
		// No-op: connection stays in pool for reuse
	}, nil
}

// CloseAPIConnections closes all cached API connections.
// This should be called when Xray is stopped or restarted.
func (s *XrayService) CloseAPIConnections() {
	apiConnectionPool.Range(func(key, value interface{}) bool {
		api := value.(*xray.XrayAPI)
		api.Close()
		apiConnectionPool.Delete(key)
		return true
	})
	logger.Debug("All API connections closed")
}

// GetXrayErr returns the error from the Xray process, if any.
func (s *XrayService) GetXrayErr() error {
	if p == nil {
		return nil
	}

	err := p.GetErr()

	if runtime.GOOS == "windows" && err.Error() == "exit status 1" {
		// exit status 1 on Windows means that Xray process was killed
		// as we kill process to stop in on Windows, this is not an error
		return nil
	}

	return err
}

// GetXrayResult returns the result string from the Xray process.
func (s *XrayService) GetXrayResult() string {
	if result != "" {
		return result
	}
	if s.IsXrayRunning() {
		return ""
	}
	if p == nil {
		return ""
	}

	result = p.GetResult()

	if runtime.GOOS == "windows" && result == "exit status 1" {
		// exit status 1 on Windows means that Xray process was killed
		// as we kill process to stop in on Windows, this is not an error
		return ""
	}

	return result
}

// GetXrayVersion returns the version of the running Xray process.
func (s *XrayService) GetXrayVersion() string {
	if p == nil {
		return "Unknown"
	}
	return p.GetVersion()
}

// RemoveIndex removes an element at the specified index from a slice.
// Returns a new slice with the element removed.
func RemoveIndex(s []any, index int) []any {
	return append(s[:index], s[index+1:]...)
}

// normalizeHysteriaClientAuth maps legacy settings.clients[].password to auth (Xray Hysteria inbound
// only accepts auth per Project X docs) and drops password so the core never sees the wrong key.
func normalizeHysteriaClientAuth(c map[string]any) {
	if c == nil {
		return
	}
	auth := ""
	if s, ok := c["auth"].(string); ok {
		auth = strings.TrimSpace(s)
	}
	if s, ok := c["password"].(string); ok && auth == "" {
		auth = strings.TrimSpace(s)
	}
	if auth != "" {
		c["auth"] = auth
	}
	delete(c, "password")
}

// ApplyPanelInboundTransformsForXray applies the same settings/stream mutations as
// GetXrayConfig for one inbound before BuildInboundXrayConfig. Mutates inbound in place.
func ApplyPanelInboundTransformsForXray(inbound *model.Inbound) error {
	if inbound == nil {
		return nil
	}
	settings := map[string]any{}
	json.Unmarshal([]byte(inbound.Settings), &settings)
	clients, ok := settings["clients"].([]any)
	if ok {
		clientStats := inbound.ClientStats
		for _, clientTraffic := range clientStats {
			indexDecrease := 0
			for index, client := range clients {
				c := client.(map[string]any)
				if c["email"] == clientTraffic.Email {
					if !clientTraffic.Enable {
						clients = RemoveIndex(clients, index-indexDecrease)
						indexDecrease++
						logger.Infof("Remove Inbound User %s due to expiration or traffic limit", c["email"])
					}
				}
			}
		}

		var finalClients []any
		proto := model.NormalizeProtocol(inbound.Protocol)
		for _, client := range clients {
			c := client.(map[string]any)
			if c["enable"] != nil {
				if enable, ok := c["enable"].(bool); ok && !enable {
					continue
				}
			}
			for key := range c {
				if key != "email" && key != "id" && key != "password" && key != "auth" && key != "flow" && key != "method" {
					delete(c, key)
				}
				if c["flow"] == "xtls-rprx-vision-udp443" {
					c["flow"] = "xtls-rprx-vision"
				}
			}
			if proto != model.VLESS {
				delete(c, "flow")
			}
			if model.IsHysteria(inbound.Protocol) {
				normalizeHysteriaClientAuth(c)
			}
			finalClients = append(finalClients, any(c))
		}

		settings["clients"] = finalClients
		modifiedSettings, err := json.MarshalIndent(settings, "", "  ")
		if err != nil {
			return err
		}
		inbound.Settings = string(modifiedSettings)
	}

	if len(inbound.StreamSettings) > 0 {
		var stream map[string]any
		json.Unmarshal([]byte(inbound.StreamSettings), &stream)

		tlsSettings, ok1 := stream["tlsSettings"].(map[string]any)
		realitySettings, ok2 := stream["realitySettings"].(map[string]any)
		if ok1 || ok2 {
			if ok1 {
				stream["tlsSettings"] = xray.SanitizeClientTLSSettings(tlsSettings)
			} else if ok2 {
				delete(realitySettings, "settings")
			}
		}
		delete(stream, "externalProxy")
		newStream, err := json.MarshalIndent(stream, "", "  ")
		if err != nil {
			return err
		}
		inbound.StreamSettings = string(newStream)
	}
	return nil
}

// PreviewInboundCoreConfig builds the Xray core inbound detour (same as in the generated config) from panel inbound fields.
func (s *XrayService) PreviewInboundCoreConfig(inbound *model.Inbound) (*xray.InboundConfig, error) {
	if inbound == nil {
		return nil, errors.New("inbound is nil")
	}
	if !model.IsXrayInboundProtocol(inbound.Protocol) {
		return nil, errors.New("preview is only available for Xray inbounds")
	}
	hyCert, _ := s.settingService.GetCertFile()
	hyKey, _ := s.settingService.GetKeyFile()
	if err := ApplyPanelInboundTransformsForXray(inbound); err != nil {
		return nil, err
	}
	cfg := BuildInboundXrayConfig(inbound, hyCert, hyKey)
	if cfg == nil {
		return nil, errors.New("failed to build Xray inbound config")
	}
	return cfg, nil
}

// GetXrayConfig retrieves and builds the Xray configuration from settings and inbounds.
func (s *XrayService) GetXrayConfig() (*xray.Config, error) {
	// Ensure xrayTemplateConfig is valid before using it.
	// This is critical when updating only the panel image without DB migrations,
	// as old JSON in the DB may be incompatible with the new code.
	if err := s.settingService.EnsureXrayTemplateConfigValid(); err != nil {
		logger.Debugf("[DEBUG-AGENT] GetXrayConfig: failed EnsureXrayTemplateConfigValid: %v", err)
		// Continue anyway; GetXrayConfigTemplate() will still try to return something.
	}

	templateConfig, err := s.settingService.GetXrayConfigTemplate()
	if err != nil {
		logger.Debugf("[DEBUG-AGENT] GetXrayConfig: GetXrayConfigTemplate error: %v", err)
		return nil, err
	}

	xrayConfig := &xray.Config{}
	err = json.Unmarshal([]byte(templateConfig), xrayConfig)
	if err != nil {
		logger.Debugf("[DEBUG-AGENT] GetXrayConfig: failed to unmarshal template JSON: %v", err)
		return nil, err
	}
	xray.EnsureAPIServicesRoutingService(xrayConfig)
	xray.EnsureAPIRoutingOutbound(xrayConfig)
	xray.EnsurePolicyStatsUserOnline(xrayConfig)

	s.inboundService.AddTraffic(nil, nil)

	inbounds, err := s.inboundService.GetAllInbounds()
	if err != nil {
		return nil, err
	}
	hyCert, _ := s.settingService.GetCertFile()
	hyKey, _ := s.settingService.GetKeyFile()
	clientService := ClientService{}
	for _, inbound := range inbounds {
		if !inbound.Enable {
			continue
		}
		if !model.IsXrayInboundProtocol(inbound.Protocol) {
			continue
		}
		// WireGuard / AmneziaWG / Shadowsocks: rebuild settings from ClientEntity so Xray gets
		// valid peers or clients[] (SS2022 keys, classic SS per-client method, etc.).
		if proto := model.NormalizeProtocol(inbound.Protocol); proto == model.WireGuard || proto == model.AmneziaWG || proto == model.Shadowsocks {
			clientEntities, err := clientService.GetClientsForInbound(inbound.Id)
			if err == nil {
				if built, err := s.inboundService.RebuildInboundSettingsForXray(inbound, clientEntities); err == nil && built != "" {
					inbound.Settings = built
				} else if err != nil {
					logger.Warningf("GetXrayConfig: inbound %d settings build: %v", inbound.Id, err)
				}
			}
		}
		if err := ApplyPanelInboundTransformsForXray(inbound); err != nil {
			return nil, err
		}
		inboundConfig := BuildInboundXrayConfig(inbound, hyCert, hyKey)
		xrayConfig.InboundConfigs = append(xrayConfig.InboundConfigs, *inboundConfig)
	}
	if err := MergeSessionIPBlockRoutingIntoConfig(xrayConfig, nil); err != nil {
		logger.Warningf("session IP block routing merge (local config): %v", err)
	}
	return xrayConfig, nil
}

// GetXrayTraffic fetches the current traffic statistics from the running Xray process.
func (s *XrayService) GetXrayTraffic() ([]*xray.Traffic, []*xray.ClientTraffic, error) {
	if !s.IsXrayRunning() {
		err := errors.New("xray is not running")
		logger.Debug("Attempted to fetch Xray traffic, but Xray is not running:", err)
		return nil, nil, err
	}
	apiPort := p.GetAPIPort()
	api, cleanup, err := s.GetOrCreateAPI(apiPort)
	if err != nil {
		return nil, nil, err
	}
	defer cleanup()

	traffic, clientTraffic, err := api.GetTraffic(true)
	if err != nil {
		logger.Debug("Failed to fetch Xray traffic:", err)
		return nil, nil, err
	}
	return traffic, clientTraffic, nil
}

// GetXrayTrafficNoReset fetches cumulative traffic counters from Xray without reset.
func (s *XrayService) GetXrayTrafficNoReset() ([]*xray.Traffic, []*xray.ClientTraffic, error) {
	if !s.IsXrayRunning() {
		err := errors.New("xray is not running")
		logger.Debug("Attempted to fetch Xray traffic (no reset), but Xray is not running:", err)
		return nil, nil, err
	}
	apiPort := p.GetAPIPort()
	api, cleanup, err := s.GetOrCreateAPI(apiPort)
	if err != nil {
		return nil, nil, err
	}
	defer cleanup()

	traffic, clientTraffic, err := api.GetTraffic(false)
	if err != nil {
		logger.Debug("Failed to fetch Xray traffic (no reset):", err)
		return nil, nil, err
	}
	return traffic, clientTraffic, nil
}

// RestartXray restarts the Xray process, optionally forcing a restart even if config unchanged.
// In multi-node mode, it sends configurations to nodes instead of restarting local Xray.
func (s *XrayService) RestartXray(isForce bool) error {
	lock.Lock()
	defer lock.Unlock()
	logger.Debug("restart Xray, force:", isForce)
	isManuallyStopped.Store(false)

	// Check if multi-node mode is enabled
	multiMode, err := s.settingService.GetMultiNodeMode()
	if err != nil {
		multiMode = false // Default to single mode on error
	}

	if multiMode {
		StopLocalTelemtStandalone()
		StopLocalAmneziaWgStandalone()
		return s.restartXrayMultiMode(isForce)
	}

	// Single mode: local Xray + Telemt sidecars on this host.
	xrayConfig, err := s.GetXrayConfig()
	if err != nil {
		return err
	}

	needRestart := isForce || isNeedXrayRestart.Load()
	if s.IsXrayRunning() {
		needRestart = needRestart || !p.GetConfig().Equals(xrayConfig)
	} else {
		needRestart = true
	}

	if s.IsXrayRunning() && needRestart {
		// Close API connections before stopping Xray
		s.CloseAPIConnections()
		p.Stop()
	}

	if needRestart {
		p = xray.NewProcess(xrayConfig)
		result = ""
		err = p.Start()
		if err != nil {
			return err
		}
	} else {
		logger.Debug("It does not need to restart Xray")
	}

	TryApplyLocalTelemtStandalone(s)
	TryApplyLocalAmneziaWgStandalone(s)
	return nil
}

// RestartXrayAsync restarts Xray asynchronously in a goroutine.
// This is useful when you don't want to block the HTTP response waiting for configs to be sent to nodes.
// Errors are logged but not returned.
func (s *XrayService) RestartXrayAsync(isForce bool) {
	go func() {
		if err := s.RestartXray(isForce); err != nil {
			logger.Warningf("Failed to restart Xray asynchronously: %v", err)
		} else {
			logger.Debug("Xray restarted asynchronously")
		}
	}()
}

// ApplySessionIPBlockHotAfterDB writes merged routing to disk (reboot-safe), then applies RoutingService AddRule/RemoveRule
// on the local core (single-node) or on each worker (multi-node) without a full restart when possible.
func (s *XrayService) ApplySessionIPBlockHotAfterDB(clientId int, email, normalizedIP string, blocked bool) {
	go func() {
		if err := s.EnsureXrayConfigFile(); err != nil {
			logger.Warningf("session IP block: ensure xray config file: %v", err)
		}

		normalizedIP = NormalizeClientIP(normalizedIP)
		if normalizedIP == "" {
			return
		}
		cidr := ipToRoutingCIDR(normalizedIP)
		tag := xray.SessionIPBlockRuleTag(clientId, normalizedIP)
		email = strings.TrimSpace(email)

		multiMode, err := s.settingService.GetMultiNodeMode()
		if err != nil {
			logger.Warningf("session IP block: multi-node check: %v", err)
			multiMode = false
		}
		if multiMode {
			ns := NodeService{}
			nodes, err := ns.GetAllNodes()
			if err != nil {
				logger.Warningf("session IP block: list nodes: %v", err)
				s.RestartXrayAsync(false)
				return
			}
			if len(nodes) == 0 {
				return
			}
			var failed int
			for _, n := range nodes {
				if n == nil {
					continue
				}
				if err := ns.ApplySessionIPBlockRoutingToNode(n, blocked, tag, email, cidr); err != nil {
					logger.Warningf("session IP block: hot push node %q: %v (skipped apply-config fallback; rule is in panel config for next sync)", n.Name, err)
					failed++
				}
			}
			if failed == len(nodes) && len(nodes) > 0 {
				logger.Warningf("session IP block: hot push failed on all %d node(s); no apply-config fallback (avoids Xray restart storm)", len(nodes))
			}
			return
		}

		if !s.IsXrayRunning() {
			return
		}

		apiPort := s.GetAPIPort()
		if apiPort <= 0 {
			s.RestartXrayAsync(false)
			return
		}

		apiInst, cleanup, err := s.GetOrCreateAPI(apiPort)
		if err != nil || apiInst == nil {
			if err != nil {
				logger.Warningf("session IP block: xray API: %v", err)
			}
			s.RestartXrayAsync(false)
			return
		}
		defer cleanup()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		var apiErr error
		if blocked {
			if email == "" || cidr == "" {
				return
			}
			apiErr = apiInst.AddSessionIPBlockRule(ctx, tag, email, cidr)
		} else {
			apiErr = apiInst.RemoveSessionIPBlockRule(ctx, tag)
		}
		if apiErr != nil {
			logger.Warningf("session IP block: routing API failed (%v), restarting Xray", apiErr)
			s.RestartXrayAsync(false)
		}
	}()
}

// buildNodeWorkerConfigJSON builds the same Xray JSON that ApplyConfigToNode sends for one node.
// The returned core profile hash is SHA-256 hex of the selected profile's ConfigJson (DB), or "" if none.
func (s *XrayService) buildNodeWorkerConfigJSON(node *model.Node, inbounds []*model.Inbound, baseConfig *xray.Config, hyCert, hyKey string) ([]byte, string, error) {
	sortInboundsForWorkerConfig(inbounds)
	// Determine which core config profile to use
	var coreConfigProfile *model.XrayCoreConfigProfile
	profileService := XrayCoreConfigProfileService{}

	if len(inbounds) > 0 {
		profiles, err := profileService.GetAllProfiles(inbounds[0].UserId)
		if err == nil {
			for _, profile := range profiles {
				for _, profileNodeId := range profile.NodeIds {
					if profileNodeId == node.Id {
						coreConfigProfile = profile
						break
					}
				}
				if coreConfigProfile != nil {
					break
				}
			}
		}
	}

	// Explicit profile_node_mappings win (e.g. no inbounds on the node yet, or inbound user != profile owner).
	if coreConfigProfile == nil && node != nil {
		assigned, err := profileService.GetProfilesForNode(node.Id)
		if err == nil && len(assigned) > 0 {
			coreConfigProfile = assigned[0]
		}
	}

	if coreConfigProfile == nil && len(inbounds) > 0 {
		profile, err := profileService.EnsureDefaultProfile(inbounds[0].UserId)
		if err == nil && profile != nil {
			coreConfigProfile = profile
		}
	}

	var configToUse *xray.Config
	if coreConfigProfile != nil {
		configToUse = &xray.Config{}
		if err := json.Unmarshal([]byte(coreConfigProfile.ConfigJson), configToUse); err == nil {
			// ok
		} else {
			configToUse = baseConfig
		}
	} else {
		configToUse = baseConfig
	}

	nodeConfig := *configToUse
	xray.EnsureAPIServicesRoutingService(&nodeConfig)
	xray.EnsureAPIRoutingOutbound(&nodeConfig)
	xray.EnsurePolicyStatsUserOnline(&nodeConfig)
	apiInbound := xray.InboundConfig{}
	hasAPIInbound := false
	for _, inbound := range baseConfig.InboundConfigs {
		if inbound.Tag == "api" {
			apiInbound = inbound
			hasAPIInbound = true
			break
		}
	}
	nodeConfig.InboundConfigs = []xray.InboundConfig{}
	if hasAPIInbound {
		nodeConfig.InboundConfigs = append(nodeConfig.InboundConfigs, apiInbound)
	}

	nodeClientService := ClientService{}
	for _, inbound := range inbounds {
		if !model.IsXrayInboundProtocol(inbound.Protocol) {
			continue
		}
		proto := model.NormalizeProtocol(inbound.Protocol)
		if clientEntities, err := nodeClientService.GetClientsForInbound(inbound.Id); err == nil {
			switch proto {
			case model.WireGuard, model.AmneziaWG, model.Shadowsocks:
				if built, err := s.inboundService.RebuildInboundSettingsForXray(inbound, clientEntities); err == nil && built != "" {
					inbound.Settings = built
				} else if err != nil {
					logger.Warningf("buildNodeWorkerConfigJSON: inbound %d settings build: %v", inbound.Id, err)
				}
			default:
				if built, err := s.inboundService.BuildSettingsFromClientEntities(inbound, clientEntities); err == nil {
					inbound.Settings = built
				} else if err != nil {
					logger.Warningf("buildNodeWorkerConfigJSON: inbound %d settings build: %v", inbound.Id, err)
				}
			}
		}

		if len(inbound.StreamSettings) > 0 {
			var stream map[string]any
			json.Unmarshal([]byte(inbound.StreamSettings), &stream)
			tlsSettings, ok1 := stream["tlsSettings"].(map[string]any)
			realitySettings, ok2 := stream["realitySettings"].(map[string]any)
			if ok1 || ok2 {
				if ok1 {
					stream["tlsSettings"] = xray.SanitizeClientTLSSettings(tlsSettings)
				} else if ok2 {
					delete(realitySettings, "settings")
				}
			}
			delete(stream, "externalProxy")
			newStream, _ := json.MarshalIndent(stream, "", "  ")
			inbound.StreamSettings = string(newStream)
		}

		inboundConfig := BuildInboundXrayConfig(inbound, hyCert, hyKey)
		nodeConfig.InboundConfigs = append(nodeConfig.InboundConfigs, *inboundConfig)
	}

	clientIDSet := make(map[int]struct{})
	cs := ClientService{}
	for _, ib := range inbounds {
		list, err := cs.GetClientsForInbound(ib.Id)
		if err != nil {
			continue
		}
		for _, c := range list {
			if c != nil && c.Id > 0 {
				clientIDSet[c.Id] = struct{}{}
			}
		}
	}
	if err := MergeSessionIPBlockRoutingIntoConfig(&nodeConfig, clientIDSet); err != nil {
		logger.Warningf("session IP block routing merge (node worker): %v", err)
	}

	out, err := json.MarshalIndent(&nodeConfig, "", "  ")
	if err != nil {
		return nil, "", err
	}
	coreHash := ""
	if coreConfigProfile != nil {
		coreHash = coreConfigContentHash(coreConfigProfile.ConfigJson)
	}
	return out, coreHash, nil
}

// InboundsForWorkerNode returns enabled inbounds assigned to the node (same set as worker Xray/Telemt sync).
func (s *XrayService) InboundsForWorkerNode(node *model.Node) ([]*model.Inbound, error) {
	if node == nil {
		return nil, fmt.Errorf("node is nil")
	}
	if s.nodeService == (NodeService{}) {
		s.nodeService = NodeService{}
	}
	if s.inboundService == (InboundService{}) {
		s.inboundService = InboundService{}
	}

	nodeInbounds := make(map[int][]*model.Inbound)
	allInbounds, err := s.inboundService.GetAllInbounds()
	if err != nil {
		return nil, fmt.Errorf("failed to get inbounds: %w", err)
	}

	for _, inbound := range allInbounds {
		if !inbound.Enable {
			continue
		}
		nodesForIB, err := s.nodeService.GetNodesForInbound(inbound.Id)
		if err != nil || len(nodesForIB) == 0 {
			logger.Debugf("Inbound %d is not assigned to any node, skipping", inbound.Id)
			continue
		}
		for _, n := range nodesForIB {
			nodeInbounds[n.Id] = append(nodeInbounds[n.Id], inbound)
		}
	}

	var ibs []*model.Inbound
	if v, ok := nodeInbounds[node.Id]; ok {
		ibs = v
	}
	return ibs, nil
}

// BuildWorkerXrayConfigForNode returns the Xray config JSON for a worker node (same as apply-config payload).
func (s *XrayService) BuildWorkerXrayConfigForNode(node *model.Node) ([]byte, error) {
	b, _, err := s.BuildWorkerXrayConfigForNodeWithMeta(node)
	return b, err
}

// BuildWorkerXrayConfigForNodeWithMeta returns worker Xray JSON and SHA-256 hex of the panel core profile ConfigJson
// when the build selected a profile (empty string when using template-only base).
func (s *XrayService) BuildWorkerXrayConfigForNodeWithMeta(node *model.Node) ([]byte, string, error) {
	if node == nil {
		return nil, "", fmt.Errorf("node is nil")
	}
	if s.settingService == (SettingService{}) {
		s.settingService = SettingService{}
	}

	if err := s.settingService.EnsureXrayTemplateConfigValid(); err != nil {
		logger.Warningf("Failed to ensure xrayTemplateConfig is valid in BuildWorkerXrayConfigForNodeWithMeta: %v", err)
	}

	templateConfig, err := s.settingService.GetXrayConfigTemplate()
	if err != nil {
		return nil, "", err
	}

	baseConfig := &xray.Config{}
	if err := json.Unmarshal([]byte(templateConfig), baseConfig); err != nil {
		return nil, "", err
	}

	ibs, err := s.InboundsForWorkerNode(node)
	if err != nil {
		return nil, "", err
	}

	hyCert, _ := s.settingService.GetCertFile()
	hyKey, _ := s.settingService.GetKeyFile()
	return s.buildNodeWorkerConfigJSON(node, ibs, baseConfig, hyCert, hyKey)
}

// MergeUniquePositiveInts returns ids > 0, each once, preserving first-seen order.
func MergeUniquePositiveInts(lists ...[]int) []int {
	seen := make(map[int]struct{})
	var out []int
	for _, list := range lists {
		for _, id := range list {
			if id <= 0 {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}

// multiWorkerNodeIDsNeedingPush returns enabled node IDs that should receive worker Xray config
// (have inbounds and/or a core config profile mapping).
func (s *XrayService) multiWorkerNodeIDsNeedingPush() ([]int, error) {
	if s.nodeService == (NodeService{}) {
		s.nodeService = NodeService{}
	}

	nodes, err := s.nodeService.GetAllNodes()
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}

	nodeInbounds := make(map[int][]*model.Inbound)
	allInbounds, err := s.inboundService.GetAllInbounds()
	if err != nil {
		return nil, fmt.Errorf("failed to get inbounds: %w", err)
	}

	for _, inbound := range allInbounds {
		if !inbound.Enable {
			continue
		}
		nodesForIB, err := s.nodeService.GetNodesForInbound(inbound.Id)
		if err != nil || len(nodesForIB) == 0 {
			logger.Debugf("Inbound %d is not assigned to any node, skipping", inbound.Id)
			continue
		}
		for _, n := range nodesForIB {
			nodeInbounds[n.Id] = append(nodeInbounds[n.Id], inbound)
		}
	}

	profileSvc := &XrayCoreConfigProfileService{}
	nodesWithProfile, err := profileSvc.GetNodeIDsWithProfileAssignment()
	if err != nil {
		logger.Warningf("multiWorkerNodeIDsNeedingPush: list profile node mappings: %v", err)
		nodesWithProfile = nil
	}

	var ids []int
	for _, node := range nodes {
		if !node.Enable {
			continue
		}
		inbounds := nodeInbounds[node.Id]
		_, hasProfile := nodesWithProfile[node.Id]
		if len(inbounds) == 0 && !hasProfile {
			continue
		}
		ids = append(ids, node.Id)
	}
	return ids, nil
}

// applyWorkerConfigToNodeIDsMulti pushes built Xray JSON (+ Telemt) to the given worker node IDs via node API.
// Caller must ensure multi-node mode; does not stop local Telemt or touch local Xray.
func (s *XrayService) applyWorkerConfigToNodeIDsMulti(nodeIDs []int) error {
	nodeIDs = MergeUniquePositiveInts(nodeIDs)
	if len(nodeIDs) == 0 {
		return nil
	}

	if s.nodeService == (NodeService{}) {
		s.nodeService = NodeService{}
	}

	if err := s.settingService.EnsureXrayTemplateConfigValid(); err != nil {
		logger.Warningf("applyWorkerConfigToNodeIDsMulti: ensure xrayTemplateConfig: %v", err)
	}

	var nodes []*model.Node
	for _, nid := range nodeIDs {
		node, err := s.nodeService.GetNode(nid)
		if err != nil {
			logger.Warningf("applyWorkerConfigToNodeIDsMulti: skip node %d: %v", nid, err)
			continue
		}
		if !node.Enable {
			continue
		}
		nodes = append(nodes, node)
	}

	attempted := len(nodes)
	if attempted == 0 {
		return nil
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	var errors []error

	for _, node := range nodes {
		n := node
		wg.Add(1)
		go func() {
			defer wg.Done()
			configJSON, coreH, err := s.BuildWorkerXrayConfigForNodeWithMeta(n)
			if err != nil {
				logger.Errorf("[Node: %s] Failed to marshal config: %v", n.Name, err)
				mu.Lock()
				errors = append(errors, fmt.Errorf("node %s: failed to marshal config: %w", n.Name, err))
				mu.Unlock()
				return
			}
			ibs, _ := s.InboundsForWorkerNode(n)
			telm, awg, terr := BuildWorkerSidecarPayloadsForNode(n, ibs)
			if terr != nil {
				logger.Warningf("[Node: %s] Sidecar payload build: %v", n.Name, terr)
			}
			meta := NewApplyWorkerConfigMeta(configJSON, coreH)
			if err := s.nodeService.ApplyConfigToNode(n, configJSON, &telm, &awg, meta); err != nil {
				logger.Errorf("[Node: %s] Failed to apply config: %v", n.Name, err)
				mu.Lock()
				errors = append(errors, fmt.Errorf("node %s: %w", n.Name, err))
				mu.Unlock()
			} else {
				logger.Infof("[Node: %s] Successfully applied config", n.Name)
			}
		}()
	}

	wg.Wait()

	if len(errors) > 0 {
		logger.Warningf("Failed to apply config to %d node(s) out of %d", len(errors), attempted)
		for _, err := range errors {
			logger.Warningf("  - %v", err)
		}
		if len(errors) == attempted {
			return fmt.Errorf("failed to apply config to all targeted nodes: %d errors", len(errors))
		}
	} else {
		logger.Infof("Successfully applied config to %d node(s)", attempted)
	}

	return nil
}

// ApplyWorkerConfigToNodeIDs sends worker Xray config to the listed nodes via node API (multi-node).
// In single-node mode, falls back to RestartXray (local core).
func (s *XrayService) ApplyWorkerConfigToNodeIDs(nodeIDs []int) error {
	multiMode, err := s.settingService.GetMultiNodeMode()
	if err != nil {
		multiMode = false
	}
	if !multiMode {
		return s.RestartXray(false)
	}
	return s.applyWorkerConfigToNodeIDsMulti(nodeIDs)
}

// ApplyWorkerXrayConfigToAllMultiWorkerNodes pushes config to every worker that normally receives sync
// (same set as a full multi-node RestartXray, without stopping local Telemt).
func (s *XrayService) ApplyWorkerXrayConfigToAllMultiWorkerNodes() error {
	multiMode, err := s.settingService.GetMultiNodeMode()
	if err != nil {
		multiMode = false
	}
	if !multiMode {
		return s.RestartXray(false)
	}
	ids, err := s.multiWorkerNodeIDsNeedingPush()
	if err != nil {
		return err
	}
	return s.applyWorkerConfigToNodeIDsMulti(ids)
}

// restartXrayMultiMode handles Xray restart in multi-node mode by sending configs to nodes.
func (s *XrayService) restartXrayMultiMode(isForce bool) error {
	ids, err := s.multiWorkerNodeIDsNeedingPush()
	if err != nil {
		return err
	}
	return s.applyWorkerConfigToNodeIDsMulti(ids)
}

// EnsureXrayConfigFile generates and saves the Xray configuration file from database.
// This ensures the config file is ready before Xray starts, even if Xray is not yet running.
// The configuration is built from xrayTemplateConfig in database and current inbounds.
func (s *XrayService) EnsureXrayConfigFile() error {
	// Ensure template config is valid in DB
	if err := s.settingService.EnsureXrayTemplateConfigValid(); err != nil {
		logger.Warningf("Failed to ensure xrayTemplateConfig is valid in EnsureXrayConfigFile: %v", err)
		// Continue; GetXrayConfig may still succeed.
	}

	cfg, err := s.GetXrayConfig()
	if err != nil {
		return err
	}

	if _, err := xray.WriteConfigFile(cfg); err != nil {
		return err
	}

	logger.Info("Xray configuration file pre-generated from database")
	return nil
}

// StopXray stops the running Xray process.
func (s *XrayService) StopXray() error {
	lock.Lock()
	defer lock.Unlock()
	isManuallyStopped.Store(true)
	logger.Debug("Attempting to stop Xray...")
	multiMode, multiErr := s.settingService.GetMultiNodeMode()
	if multiErr != nil {
		multiMode = false
	}
	if !multiMode {
		StopLocalTelemtStandalone()
	}
	if s.IsXrayRunning() {
		// Close API connections before stopping Xray
		s.CloseAPIConnections()
		return p.Stop()
	}
	// Xray is not running, nothing to stop - this is not an error
	logger.Debug("Xray is not running, nothing to stop")
	return nil
}

// SetToNeedRestart marks that Xray needs to be restarted.
func (s *XrayService) SetToNeedRestart() {
	isNeedXrayRestart.Store(true)
}

// IsNeedRestartAndSetFalse checks if restart is needed and resets the flag to false.
func (s *XrayService) IsNeedRestartAndSetFalse() bool {
	return isNeedXrayRestart.CompareAndSwap(true, false)
}

// DidXrayCrash checks if Xray crashed by verifying it's not running and wasn't manually stopped.
func (s *XrayService) DidXrayCrash() bool {
	return !s.IsXrayRunning() && !isManuallyStopped.Load()
}
