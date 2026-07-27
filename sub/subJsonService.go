package sub

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"maps"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/json_util"
	"github.com/konstpic/sharx-code/v2/util/random"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/xray"
)

//go:embed default.json
var defaultJson string

// SubJsonService handles JSON subscription configuration generation and management.
type SubJsonService struct {
	configJson       map[string]any
	defaultOutbounds []json_util.RawMessage
	fragment         string
	noises           string
	mux              string

	inboundService service.InboundService
	SubService     *SubService
}

// NewSubJsonService creates a new JSON subscription service with the given configuration.
func NewSubJsonService(fragment string, noises string, mux string, rules string, subService *SubService) *SubJsonService {
	s := &SubJsonService{SubService: subService}
	s.applyTemplates(fragment, noises, mux, rules)
	return s
}

// applyTemplates rebuilds the inline default config from the given Xray JSON
// fragments (fragment / noises / mux / rules). Called on first construction
// and on every request so edits in the subscription builder apply without
// restarting the server.
func (s *SubJsonService) applyTemplates(fragment string, noises string, mux string, rules string) {
	var configJson map[string]any
	var defaultOutbounds []json_util.RawMessage
	json.Unmarshal([]byte(defaultJson), &configJson)
	if outboundSlices, ok := configJson["outbounds"].([]any); ok {
		for _, defaultOutbound := range outboundSlices {
			jsonBytes, _ := json.Marshal(defaultOutbound)
			defaultOutbounds = append(defaultOutbounds, jsonBytes)
		}
	}

	if rules != "" {
		var newRules []any
		routing, _ := configJson["routing"].(map[string]any)
		defaultRules, _ := routing["rules"].([]any)
		json.Unmarshal([]byte(rules), &newRules)
		defaultRules = append(newRules, defaultRules...)
		routing["rules"] = defaultRules
		configJson["routing"] = routing
	}

	if fragment != "" {
		defaultOutbounds = append(defaultOutbounds, json_util.RawMessage(fragment))
	}

	if noises != "" {
		defaultOutbounds = append(defaultOutbounds, json_util.RawMessage(noises))
	}

	s.configJson = configJson
	s.defaultOutbounds = defaultOutbounds
	s.fragment = fragment
	s.noises = noises
	s.mux = mux
}

// GetJson generates a JSON subscription configuration for the given subscription ID and host.
// If gin.Context is provided, it will also register HWID from HTTP headers.
func (s *SubJsonService) GetJson(subId string, host string, c *gin.Context) (string, string, error) {
	// Register HWID from headers if context is provided
	if c != nil {
		// Try to find client by subId
		db := database.GetDB()
		var clientEntity *model.ClientEntity
		err := db.Where("sub_id = ? AND enable = ?", subId, true).First(&clientEntity).Error
		if err == nil && clientEntity != nil {
			sb := service.ClientSessionBlockService{}
			if err := sb.CheckSessionIPAllowed(clientEntity.Id, c.ClientIP()); err != nil {
				return "", "", err
			}
			err := s.SubService.registerHWIDFromRequest(c, clientEntity)
			if err != nil {
				subCfg, _ := (service.SubscriptionPageConfigService{}).GetActiveV2Config()
				if service.ShowCustomRemarksEnabled(subCfg) {
					merged := service.EffectiveCustomRemarks(subCfg)
					if len(merged.HWIDMaxDevicesExceeded) > 0 {
						body := jsonSubscriptionNoticeBody(merged.HWIDMaxDevicesExceeded)
						header := "upload=0; download=0; total=0; expire=0"
						if clientEntity != nil {
							tr := trafficFromClientEntity(clientEntity)
							header = fmt.Sprintf("upload=%d; download=%d; total=%d; expire=%d", tr.Up, tr.Down, tr.Total, tr.ExpiryTime/1000)
						}
						return body, header, nil
					}
				}
				return "", "", fmt.Errorf("HWID limit exceeded: %w", err)
			}
		}
	}

	inbounds, err := s.SubService.getInboundsBySubId(subId)
	if err != nil || len(inbounds) == 0 {
		return "", "", err
	}

	var header string
	var traffic xray.ClientTraffic
	var clientTraffics []xray.ClientTraffic
	var configArray []json_util.RawMessage

	// Prepare Inbounds
	for _, inbound := range inbounds {
		clients, err := s.inboundService.GetClients(inbound)
		if err != nil {
			logger.Error("SubJsonService - GetClients: Unable to get clients from inbound")
		}
		if clients == nil {
			continue
		}
		if len(inbound.Listen) > 0 && inbound.Listen[0] == '@' {
			listen, port, streamSettings, err := s.SubService.getFallbackMaster(inbound.Listen, inbound.StreamSettings)
			if err == nil {
				inbound.Listen = listen
				inbound.Port = port
				inbound.StreamSettings = streamSettings
			}
		}

		for _, client := range clients {
			if client.Enable && client.SubID == subId {
				clientTraffics = append(clientTraffics, s.SubService.getClientTraffics(inbound.ClientStats, client.Email))
				newConfigs := s.getConfig(inbound, client, host)
				configArray = append(configArray, newConfigs...)
			}
		}
	}

	if len(configArray) == 0 {
		return "", "", nil
	}

	// Prepare statistics
	for index, clientTraffic := range clientTraffics {
		if index == 0 {
			traffic.Up = clientTraffic.Up
			traffic.Down = clientTraffic.Down
			traffic.Total = clientTraffic.Total
			if clientTraffic.ExpiryTime > 0 {
				traffic.ExpiryTime = clientTraffic.ExpiryTime
			}
		} else {
			traffic.Up += clientTraffic.Up
			traffic.Down += clientTraffic.Down
			if traffic.Total == 0 || clientTraffic.Total == 0 {
				traffic.Total = 0
			} else {
				traffic.Total += clientTraffic.Total
			}
			if clientTraffic.ExpiryTime != traffic.ExpiryTime {
				traffic.ExpiryTime = 0
			}
		}
	}

	// Combile outbounds
	var finalJson []byte
	if len(configArray) == 1 {
		finalJson, _ = json.MarshalIndent(configArray[0], "", "  ")
	} else {
		finalJson, _ = json.MarshalIndent(configArray, "", "  ")
	}

	header = fmt.Sprintf("upload=%d; download=%d; total=%d; expire=%d", traffic.Up, traffic.Down, traffic.Total, traffic.ExpiryTime/1000)
	return string(finalJson), header, nil
}

func (s *SubJsonService) getConfig(inbound *model.Inbound, client model.Client, host string) []json_util.RawMessage {
	var newJsonArray []json_util.RawMessage
	stream := s.streamData(inbound.StreamSettings)

	externalProxies, ok := stream["externalProxy"].([]any)
	if !ok || len(externalProxies) == 0 {
		// Multi-node aware default. The previous fallback hardcoded the
		// panel host into a synthetic externalProxy, which produced wrong
		// addresses for hysteria/hysteria2 (and any protocol relying on
		// the panel-derived host) when nodes were configured. We now seed
		// the per-iteration list from getAddressesForInbound so the loop
		// below mirrors how genVlessLink/genTrojanLink iterate node rows.
		var nodeAddrs []AddressPort
		if s.SubService != nil {
			nodeAddrs, _ = s.SubService.getAddressesForInbound(inbound)
		}
		if len(nodeAddrs) == 0 {
			nodeAddrs = []AddressPort{{Address: host, Port: inbound.Port}}
		}
		seeds := make([]any, 0, len(nodeAddrs))
		for _, ap := range nodeAddrs {
			addr := strings.TrimSpace(ap.Address)
			if addr == "" {
				continue
			}
			port := ap.Port
			if port <= 0 {
				port = inbound.Port
			}
			seeds = append(seeds, map[string]any{
				"forceTls": "same",
				"dest":     addr,
				"port":     float64(port),
				"remark":   strings.TrimSpace(ap.RemarkSuffix),
			})
		}
		if len(seeds) == 0 {
			// Last-resort: keep prior behaviour rather than emitting nothing.
			seeds = []any{
				map[string]any{
					"forceTls": "same",
					"dest":     host,
					"port":     float64(inbound.Port),
					"remark":   "",
				},
			}
		}
		externalProxies = seeds
	}

	delete(stream, "externalProxy")

	for _, ep := range externalProxies {
		extPrxy := ep.(map[string]any)
		inbound.Listen = extPrxy["dest"].(string)
		inbound.Port = int(extPrxy["port"].(float64))
		newStream := stream
		switch extPrxy["forceTls"].(string) {
		case "tls":
			if newStream["security"] != "tls" {
				newStream["security"] = "tls"
				newStream["tlsSettings"] = map[string]any{}
			}
		case "none":
			if newStream["security"] != "none" {
				newStream["security"] = "none"
				delete(newStream, "tlsSettings")
			}
		}
		streamSettings, _ := json.MarshalIndent(newStream, "", "  ")

		var newOutbounds []json_util.RawMessage

		switch string(model.NormalizeProtocol(inbound.Protocol)) {
		case string(model.VMESS):
			newOutbounds = append(newOutbounds, s.genVnext(inbound, streamSettings, client))
		case string(model.VLESS):
			newOutbounds = append(newOutbounds, s.genVless(inbound, streamSettings, client))
		case string(model.Trojan), string(model.Shadowsocks):
			newOutbounds = append(newOutbounds, s.genServer(inbound, streamSettings, client))
		case string(model.Mixed):
			if mx := s.genMixed(inbound, streamSettings, client); len(mx) > 0 {
				newOutbounds = append(newOutbounds, mx)
			}
		case string(model.Hysteria), string(model.Hysteria2):
			newOutbounds = append(newOutbounds, s.genHy(inbound, newStream, client))
		}

		if len(newOutbounds) == 0 {
			continue
		}

		newOutbounds = append(newOutbounds, s.defaultOutbounds...)
		newConfigJson := make(map[string]any)
		maps.Copy(newConfigJson, s.configJson)

		newConfigJson["outbounds"] = newOutbounds
		newConfigJson["remarks"] = s.SubService.genRemark(inbound, client.Email, extPrxy["remark"].(string), nil)

		newConfig, _ := json.MarshalIndent(newConfigJson, "", "  ")
		newJsonArray = append(newJsonArray, newConfig)
	}

	return newJsonArray
}

// effectivePassword resolves ClientEntity password or falls back to inbound settings (see SubService.passwordForSubLink).
func (s *SubJsonService) effectivePassword(inbound *model.Inbound, client model.Client) string {
	if p := strings.TrimSpace(client.Password); p != "" {
		return p
	}
	if s.SubService == nil || inbound == nil {
		return ""
	}
	return s.SubService.passwordForSubLink(inbound, &model.ClientEntity{Name: client.Email, Password: client.Password})
}

// genMixed builds an Xray SOCKS outbound to a remote Mixed inbound (HTTP+SOCKS on one port).
func (s *SubJsonService) genMixed(inbound *model.Inbound, streamSettings json_util.RawMessage, client model.Client) json_util.RawMessage {
	pass := s.effectivePassword(inbound, client)
	if pass == "" {
		return nil
	}
	user := mixedProxyUserFromEmail(client.Email)
	outbound := Outbound{
		Protocol:       "socks",
		Tag:            "proxy",
		StreamSettings: streamSettings,
		Settings: map[string]any{
			"servers": []map[string]any{
				{
					"address": inbound.Listen,
					"port":    inbound.Port,
					"users": []map[string]any{
						{"user": user, "pass": pass, "level": 8},
					},
				},
			},
		},
	}
	if s.mux != "" {
		outbound.Mux = json_util.RawMessage(s.mux)
	}
	result, _ := json.MarshalIndent(outbound, "", "  ")
	return result
}

func (s *SubJsonService) streamData(stream string) map[string]any {
	streamSettings := parseInboundStreamSettings(stream)
	security, _ := streamSettings["security"].(string)
	if security == "reality" {
		if rs, ok := streamSettings["realitySettings"].(map[string]any); ok {
			streamSettings["realitySettings"] = s.realityData(rs)
		}
	}
	delete(streamSettings, "sockopt")

	if s.fragment != "" {
		streamSettings["sockopt"] = json_util.RawMessage(`{"dialerProxy": "fragment", "tcpKeepAliveIdle": 100, "tcpMptcp": true, "penetrate": true}`)
	}

	// remove proxy protocol
	network, _ := streamSettings["network"].(string)
	switch network {
	case "tcp":
		streamSettings["tcpSettings"] = s.removeAcceptProxy(streamSettings["tcpSettings"])
	case "ws":
		streamSettings["wsSettings"] = s.removeAcceptProxy(streamSettings["wsSettings"])
	case "httpupgrade":
		streamSettings["httpupgradeSettings"] = s.removeAcceptProxy(streamSettings["httpupgradeSettings"])
	}
	return streamSettings
}

func (s *SubJsonService) removeAcceptProxy(setting any) map[string]any {
	netSettings, ok := setting.(map[string]any)
	if ok {
		delete(netSettings, "acceptProxyProtocol")
	}
	return netSettings
}

func (s *SubJsonService) tlsData(tData map[string]any) map[string]any {
	if tData == nil {
		return map[string]any{}
	}
	// Copy panel inbound tlsSettings into client outbound form; Xray >= 2026-06-01 rejects allowInsecure.
	return xray.SanitizeClientTLSSettings(tData)
}

func (s *SubJsonService) realityData(rData map[string]any) map[string]any {
	rltyData := make(map[string]any, 1)
	rltyClientSettings, _ := rData["settings"].(map[string]any)

	rltyData["show"] = false
	rltyData["publicKey"] = rltyClientSettings["publicKey"]
	rltyData["fingerprint"] = rltyClientSettings["fingerprint"]
	rltyData["mldsa65Verify"] = rltyClientSettings["mldsa65Verify"]

	// Set random data
	rltyData["spiderX"] = "/" + random.Seq(15)
	shortIds, ok := rData["shortIds"].([]any)
	if ok && len(shortIds) > 0 {
		rltyData["shortId"] = shortIds[random.Num(len(shortIds))].(string)
	} else {
		rltyData["shortId"] = ""
	}
	serverNames, ok := rData["serverNames"].([]any)
	if ok && len(serverNames) > 0 {
		rltyData["serverName"] = serverNames[random.Num(len(serverNames))].(string)
	} else {
		rltyData["serverName"] = ""
	}

	return rltyData
}

func (s *SubJsonService) genVnext(inbound *model.Inbound, streamSettings json_util.RawMessage, client model.Client) json_util.RawMessage {
	outbound := Outbound{}
	usersData := make([]UserVnext, 1)

	usersData[0].ID = client.ID
	usersData[0].Email = client.Email
	usersData[0].Security = client.Security
	vnextData := make([]VnextSetting, 1)
	vnextData[0] = VnextSetting{
		Address: inbound.Listen,
		Port:    inbound.Port,
		Users:   usersData,
	}

	outbound.Protocol = string(inbound.Protocol)
	outbound.Tag = "proxy"
	if s.mux != "" {
		outbound.Mux = json_util.RawMessage(s.mux)
	}
	outbound.StreamSettings = streamSettings
	outbound.Settings = map[string]any{
		"vnext": vnextData,
	}

	result, _ := json.MarshalIndent(outbound, "", "  ")
	return result
}

func (s *SubJsonService) genVless(inbound *model.Inbound, streamSettings json_util.RawMessage, client model.Client) json_util.RawMessage {
	outbound := Outbound{}
	outbound.Protocol = string(inbound.Protocol)
	outbound.Tag = "proxy"
	if s.mux != "" {
		outbound.Mux = json_util.RawMessage(s.mux)
	}
	outbound.StreamSettings = streamSettings
	settings := make(map[string]any)
	settings["address"] = inbound.Listen
	settings["port"] = inbound.Port
	settings["id"] = client.ID
	if flow := service.VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); flow != "" {
		settings["flow"] = flow
	}

	// Add encryption for VLESS outbound from inbound settings
	var inboundSettings map[string]any
	json.Unmarshal([]byte(inbound.Settings), &inboundSettings)
	if encryption, ok := inboundSettings["encryption"].(string); ok {
		settings["encryption"] = encryption
	}

	outbound.Settings = settings
	result, _ := json.MarshalIndent(outbound, "", "  ")
	return result
}

func (s *SubJsonService) genServer(inbound *model.Inbound, streamSettings json_util.RawMessage, client model.Client) json_util.RawMessage {
	outbound := Outbound{}

	serverData := make([]ServerSetting, 1)
	secret := s.effectivePassword(inbound, client)
	serverData[0] = ServerSetting{
		Address:  inbound.Listen,
		Port:     inbound.Port,
		Level:    8,
		Password: secret,
	}

	if model.NormalizeProtocol(inbound.Protocol) == model.Shadowsocks {
		var inboundSettings map[string]any
		json.Unmarshal([]byte(inbound.Settings), &inboundSettings)
		method, _ := inboundSettings["method"].(string)
		serverData[0].Method = method

		// server password in multi-user 2022 protocols
		if strings.HasPrefix(method, "2022") {
			if serverPassword, ok := inboundSettings["password"].(string); ok {
				serverData[0].Password = fmt.Sprintf("%s:%s", serverPassword, secret)
			}
		}
	}

	outbound.Protocol = string(model.NormalizeProtocol(inbound.Protocol))
	outbound.Tag = "proxy"
	if s.mux != "" {
		outbound.Mux = json_util.RawMessage(s.mux)
	}
	outbound.StreamSettings = streamSettings
	outbound.Settings = map[string]any{
		"servers": serverData,
	}

	result, _ := json.MarshalIndent(outbound, "", "  ")
	return result
}

func (s *SubJsonService) genHy(inbound *model.Inbound, newStream map[string]any, client model.Client) json_util.RawMessage {
	outbound := Outbound{}

	// Xray outbound id is "hysteria"; version 2 comes from settings / hysteriaSettings (same as inbound GenXrayInboundConfig).
	outbound.Protocol = string(model.Hysteria)
	outbound.Tag = "proxy"

	if s.mux != "" {
		outbound.Mux = json_util.RawMessage(s.mux)
	}

	var settings map[string]any
	json.Unmarshal([]byte(inbound.Settings), &settings)
	version, _ := settings["version"].(float64)
	outbound.Settings = map[string]any{
		"version": int(version),
		"address": inbound.Listen,
		"port":    inbound.Port,
	}

	auth := s.effectivePassword(inbound, client)
	if strings.TrimSpace(client.Auth) != "" {
		auth = strings.TrimSpace(client.Auth)
	}

	hyStream, ok := newStream["hysteriaSettings"].(map[string]any)
	if !ok {
		hyStream = map[string]any{}
	}
	// finalmask lives on streamSettings root in Xray, not inside hysteriaSettings (legacy mistake read nested only).
	var preservedFinalmask map[string]any
	if fm, ok := newStream["finalmask"].(map[string]any); ok && len(fm) > 0 {
		preservedFinalmask = fm
	} else if fm, ok := hyStream["finalmask"].(map[string]any); ok && len(fm) > 0 {
		preservedFinalmask = fm
	}
	outHyStream := map[string]any{
		"version": int(version),
		"auth":    auth,
	}
	if udpIdleTimeout, ok := hyStream["udpIdleTimeout"].(float64); ok {
		outHyStream["udpIdleTimeout"] = int(udpIdleTimeout)
	}
	newStream["hysteriaSettings"] = outHyStream
	if preservedFinalmask != nil {
		newStream["finalmask"] = preservedFinalmask
	}

	newStream["network"] = "hysteria"
	newStream["security"] = "tls"
	if tls, ok := newStream["tlsSettings"].(map[string]any); ok {
		newStream["tlsSettings"] = s.tlsData(tls)
	}

	outbound.StreamSettings, _ = json.MarshalIndent(newStream, "", "  ")

	result, _ := json.MarshalIndent(outbound, "", "  ")
	return result
}

type Outbound struct {
	Protocol       string               `json:"protocol"`
	Tag            string               `json:"tag"`
	StreamSettings json_util.RawMessage `json:"streamSettings"`
	Mux            json_util.RawMessage `json:"mux,omitempty"`
	Settings       map[string]any       `json:"settings,omitempty"`
}

type VnextSetting struct {
	Address string      `json:"address"`
	Port    int         `json:"port"`
	Users   []UserVnext `json:"users"`
}

type UserVnext struct {
	ID       string `json:"id"`
	Email    string `json:"email,omitempty"`
	Security string `json:"security,omitempty"`
}

type ServerSetting struct {
	Password string `json:"password"`
	Level    int    `json:"level"`
	Address  string `json:"address"`
	Port     int    `json:"port"`
	Method   string `json:"method,omitempty"`
}
