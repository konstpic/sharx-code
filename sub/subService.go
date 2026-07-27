package sub

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-json"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	"github.com/konstpic/sharx-code/v2/util/random"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/xray"
)

// SubService provides business logic for generating subscription links and managing subscription data.
type SubService struct {
	address        string
	showInfo       bool
	remarkModel    string
	datepicker     string
	inboundService service.InboundService
	settingService service.SettingService
	nodeService    service.NodeService
	hostService    service.HostService
	clientService  service.ClientService
	hwidService    service.ClientHWIDService
}

// NewSubService creates a new subscription service with the given configuration.
func NewSubService(showInfo bool, remarkModel string) *SubService {
	return &SubService{
		showInfo:    showInfo,
		remarkModel: remarkModel,
	}
}

// NewPanelSubService returns a SubService wired for panel-side link generation (no subscription HTTP context).
func NewPanelSubService(defaultHost string) *SubService {
	var ss service.SettingService
	remark, _ := ss.GetRemarkModel()
	remark = strings.TrimSpace(remark)
	if remark == "" {
		remark = "-ieo"
	}
	s := NewSubService(false, remark)
	s.address = defaultHost
	s.inboundService = service.InboundService{}
	s.settingService = service.SettingService{}
	s.nodeService = service.NodeService{}
	s.hostService = service.HostService{}
	s.clientService = service.ClientService{}
	s.hwidService = service.ClientHWIDService{}
	return s
}

// NewCompatSubService returns a SubService fully wired for panel/public subscription APIs (GetSubs, ResolveRequest).
func NewCompatSubService(showInfo bool, remarkModel string) *SubService {
	s := NewSubService(showInfo, remarkModel)
	s.inboundService = service.InboundService{}
	s.settingService = service.SettingService{}
	s.nodeService = service.NodeService{}
	s.hostService = service.HostService{}
	s.clientService = service.ClientService{}
	s.hwidService = service.ClientHWIDService{}
	return s
}

// ClientShareLinks builds share URLs for a client for each assigned inbound (newline-separated if multiple addresses).
func (s *SubService) ClientShareLinks(client *model.ClientEntity, inboundIDs []int) []model.ClientInboundShareLink {
	out := make([]model.ClientInboundShareLink, 0, len(inboundIDs))
	for _, id := range inboundIDs {
		if id <= 0 {
			continue
		}
		inbound, err := s.inboundService.GetInbound(id)
		if err != nil || inbound == nil {
			continue
		}
		prepared := s.prepareInboundForSubscription(inbound)
		link := s.getLinkWithClient(prepared, client)
		if link == "" && client != nil && strings.TrimSpace(client.Name) != "" {
			link = s.getLink(prepared, client.Name)
		}
		if link == "" {
			continue
		}
		wgConf := ""
		if p := model.NormalizeProtocol(inbound.Protocol); p == model.WireGuard || p == model.AmneziaWG {
			wgConf = wireguardConfBlockFromPanelInfo(link)
		}
		out = append(out, model.ClientInboundShareLink{
			InboundId: id,
			Remark:    inbound.Remark,
			Protocol:  string(inbound.Protocol),
			Link:      link,
			WgConf:    wgConf,
		})
	}
	return out
}

// GetSubs retrieves subscription links for a given subscription ID and host.
// If gin.Context is provided, it will also register HWID from HTTP headers (x-hwid, x-device-os, etc.).
func (s *SubService) GetSubs(subId string, host string, c *gin.Context) ([]string, int64, xray.ClientTraffic, error) {
	s.address = host
	var result []string
	var traffic xray.ClientTraffic
	var lastOnline int64
	var clientTraffics []xray.ClientTraffic

	subCfg, _ := (service.SubscriptionPageConfigService{}).GetActiveV2Config()
	mergedRemarks := service.EffectiveCustomRemarks(subCfg)
	showCustom := service.ShowCustomRemarksEnabled(subCfg)

	// Try to find client by subId in new architecture (ClientEntity)
	db := database.GetDB()

	var disabledClient model.ClientEntity
	if err := db.Where("sub_id = ?", subId).First(&disabledClient).Error; err == nil && !disabledClient.Enable {
		lines := subscriptionPlaceholderLines(mergedRemarks.DisabledUsers)
		if len(lines) > 0 {
			t := trafficFromClientEntity(&disabledClient)
			return lines, disabledClient.LastOnline, t, nil
		}
		return nil, 0, xray.ClientTraffic{}, common.NewError("subscription disabled for ", subId)
	}

	var clientEntity *model.ClientEntity
	err := db.Where("sub_id = ? AND enable = ?", subId, true).First(&clientEntity).Error
	useNewArchitecture := (err == nil && clientEntity != nil)

	if err != nil {
		logger.Debugf("GetSubs: Client not found by subId '%s': %v", subId, err)
	} else if clientEntity != nil {
		logger.Debugf("GetSubs: Found client by subId '%s': clientId=%d, email=%s, hwidEnabled=%v",
			subId, clientEntity.Id, clientEntity.Name, clientEntity.HWIDEnabled)

		// Check traffic limits and expiry time before returning subscription
		// Traffic statistics are now stored directly in ClientEntity
		now := time.Now().Unix() * 1000
		totalUsed := clientEntity.Up + clientEntity.Down
		trafficLimit := int64(clientEntity.TotalGB * 1024 * 1024 * 1024)
		trafficExceeded := clientEntity.TotalGB > 0 && totalUsed >= trafficLimit
		timeExpired := clientEntity.ExpiryTime > 0 && clientEntity.ExpiryTime <= now

		// Check if client exceeded limits - set status but keep Enable = true to allow subscription
		if trafficExceeded || timeExpired {
			status := "expired_traffic"
			if timeExpired {
				status = "expired_time"
			}

			if clientEntity.Status != status {
				db.Model(&model.ClientEntity{}).Where("id = ?", clientEntity.Id).Update("status", status)
				clientEntity.Status = status
				logger.Warningf("GetSubs: Client %s (subId: %s) exceeded limits - set status to %s: trafficExceeded=%v, timeExpired=%v, totalUsed=%d, total=%d",
					clientEntity.Name, subId, status, trafficExceeded, timeExpired, totalUsed, trafficLimit)
			}
		}

		if showCustom {
			if timeExpired && len(mergedRemarks.ExpiredUsers) > 0 {
				t := trafficFromClientEntity(clientEntity)
				return subscriptionPlaceholderLines(mergedRemarks.ExpiredUsers), clientEntity.LastOnline, t, nil
			}
			if trafficExceeded && len(mergedRemarks.LimitedUsers) > 0 {
				t := trafficFromClientEntity(clientEntity)
				return subscriptionPlaceholderLines(mergedRemarks.LimitedUsers), clientEntity.LastOnline, t, nil
			}
		}
	}

	if c != nil && clientEntity != nil {
		sb := service.ClientSessionBlockService{}
		if err := sb.CheckSessionIPAllowed(clientEntity.Id, c.ClientIP()); err != nil {
			return nil, 0, xray.ClientTraffic{}, err
		}
	}

	// Register HWID from headers if context is provided and client is found
	if c != nil && clientEntity != nil {
		err := s.registerHWIDFromRequest(c, clientEntity)
		if err != nil {
			if showCustom && isHWIDLimitStyleError(err) && len(mergedRemarks.HWIDMaxDevicesExceeded) > 0 {
				t := trafficFromClientEntity(clientEntity)
				return subscriptionPlaceholderLines(mergedRemarks.HWIDMaxDevicesExceeded), clientEntity.LastOnline, t, nil
			}
			return nil, 0, xray.ClientTraffic{}, fmt.Errorf("HWID limit exceeded: %w", err)
		}
	} else if c != nil {
		logger.Debugf("GetSubs: Skipping HWID registration - client not found or context is nil (subId: %s)", subId)
	}

	inbounds, err := s.getInboundsBySubId(subId)
	if err != nil {
		return nil, 0, traffic, err
	}

	if len(inbounds) == 0 {
		lines := subscriptionPlaceholderLines(mergedRemarks.EmptyHosts)
		if len(lines) > 0 {
			tr := xray.ClientTraffic{}
			lo := int64(0)
			if clientEntity != nil {
				tr = trafficFromClientEntity(clientEntity)
				lo = clientEntity.LastOnline
			}
			return lines, lo, tr, nil
		}
		return nil, 0, traffic, common.NewError("No inbounds found with ", subId)
	}

	s.datepicker, err = s.settingService.GetDatepicker()
	if err != nil {
		s.datepicker = "gregorian"
	}

	// New architecture: traffic lives on ClientEntity once; do not append per-inbound or aggregation doubles it.
	var newArchTrafficAdded bool
	for _, inbound := range inbounds {
		prepared := s.prepareInboundForSubscription(inbound)

		if useNewArchitecture {
			// New architecture: use ClientEntity data directly
			link := s.getLinkWithClient(prepared, clientEntity)
			result = appendSubscriptionLinks(result, prepared, link)
			// Single ClientTraffic row for this sub (same counters for all inbounds)
			if !newArchTrafficAdded {
				trafficLimit := int64(clientEntity.TotalGB * 1024 * 1024 * 1024)
				ct := xray.ClientTraffic{
					Email:      clientEntity.Name,
					Up:         clientEntity.Up,
					Down:       clientEntity.Down,
					Total:      trafficLimit,
					ExpiryTime: clientEntity.ExpiryTime,
					LastOnline: clientEntity.LastOnline,
				}
				clientTraffics = append(clientTraffics, ct)
				if ct.LastOnline > lastOnline {
					lastOnline = ct.LastOnline
				}
				newArchTrafficAdded = true
			}
		} else {
			// Old architecture: parse clients from Settings
			clients, err := s.inboundService.GetClients(prepared)
			if err != nil {
				logger.Error("SubService - GetClients: Unable to get clients from inbound")
			}
			if clients == nil {
				continue
			}
			for _, client := range clients {
				if client.Enable && client.SubID == subId {
					// Use ClientEntity for traffic (new architecture only)
					var clientEntity model.ClientEntity
					err = db.Where("LOWER(name) = ?", strings.ToLower(client.Email)).First(&clientEntity).Error
					if err != nil {
						// Client not found in ClientEntity - skip (old architecture clients should be migrated)
						logger.Warningf("GetSubs: Client %s (subId: %s) not found in ClientEntity - skipping",
							client.Email, subId)
						continue
					}

					// Check traffic limits from ClientEntity
					now := time.Now().Unix() * 1000
					totalUsed := clientEntity.Up + clientEntity.Down
					trafficLimit := int64(clientEntity.TotalGB * 1024 * 1024 * 1024)
					trafficExceeded := clientEntity.TotalGB > 0 && totalUsed >= trafficLimit
					timeExpired := clientEntity.ExpiryTime > 0 && clientEntity.ExpiryTime <= now

					if trafficExceeded || timeExpired || !clientEntity.Enable {
						logger.Warningf("GetSubs: Client %s (subId: %s) exceeded limits or disabled - skipping",
							client.Email, subId)
						continue
					}

					// Create ClientTraffic from ClientEntity for statistics
					clientTraffic := xray.ClientTraffic{
						Email:      clientEntity.Name,
						Up:         clientEntity.Up,
						Down:       clientEntity.Down,
						Total:      trafficLimit,
						ExpiryTime: clientEntity.ExpiryTime,
						LastOnline: clientEntity.LastOnline,
					}

					link := s.getLink(prepared, client.Email)
					result = appendSubscriptionLinks(result, prepared, link)
					ct := s.getClientTraffics(prepared.ClientStats, client.Email)
					if ct.Email == "" {
						ct = clientTraffic
					}
					clientTraffics = append(clientTraffics, ct)
					if ct.LastOnline > lastOnline {
						lastOnline = ct.LastOnline
					}
				}
			}
		}
	}

	// Protocol filtering was previously gated behind `subOnlyHappV2RayTun`.
	// That toggle has been removed: the panel now emits the full list of
	// configs and relies on per-client filtering (done in the Add-to-App
	// block templates or at the client side).

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
	return result, lastOnline, traffic, nil
}

// getInboundsBySubId retrieves all inbounds assigned to a client with the given subId.
// New architecture: Find client by subId, then find inbounds through ClientInboundMapping.
func (s *SubService) getInboundsBySubId(subId string) ([]*model.Inbound, error) {
	db := database.GetDB()

	// First, try to find client by subId in ClientEntity (new architecture)
	var client model.ClientEntity
	err := db.Where("sub_id = ? AND enable = ?", subId, true).First(&client).Error
	if err == nil {
		// Found client in new architecture, get inbounds through mapping
		var mappings []model.ClientInboundMapping
		err = db.Where("client_id = ?", client.Id).Order("sort_order ASC, id ASC").Find(&mappings).Error
		if err != nil {
			return nil, err
		}

		if len(mappings) == 0 {
			return []*model.Inbound{}, nil
		}

		inboundIds := make([]int, len(mappings))
		for i, mapping := range mappings {
			inboundIds[i] = mapping.InboundId
		}

		var all []*model.Inbound
		err = db.Model(model.Inbound{}).Preload("ClientStats").
			Where("id IN ? AND enable = ?", inboundIds, true).
			Find(&all).Error
		if err != nil {
			return nil, err
		}
		allowedSub := map[model.Protocol]struct{}{
			model.VMESS:       {},
			model.VLESS:       {},
			model.Trojan:      {},
			model.Shadowsocks: {},
			model.Mixed:       {},
			model.Hysteria:    {},
			model.Hysteria2:   {},
			model.WireGuard:   {},
			model.AmneziaWG:   {},
		}
		inboundById := make(map[int]*model.Inbound, len(all))
		for _, inb := range all {
			inboundById[inb.Id] = inb
		}
		inbounds := make([]*model.Inbound, 0, len(inboundIds))
		for _, id := range inboundIds {
			inb, ok := inboundById[id]
			if !ok {
				continue
			}
			if _, allowed := allowedSub[model.NormalizeProtocol(inb.Protocol)]; !allowed {
				continue
			}
			inbounds = append(inbounds, inb)
		}
		return inbounds, nil
	}

	// Fallback to old architecture: search in Settings JSON (for backward compatibility)
	var inbounds []*model.Inbound
	err = db.Model(model.Inbound{}).Preload("ClientStats").Where(`id in (
		SELECT DISTINCT inbounds.id
		FROM inbounds,
			jsonb_array_elements(
				CASE 
					WHEN jsonb_typeof((inbounds.settings::jsonb)->'clients') = 'array' 
					THEN (inbounds.settings::jsonb)->'clients'
					ELSE '[]'::jsonb
				END
			) AS client 
		WHERE
			protocol in ('vmess','vless','trojan','shadowsocks','mixed','hysteria','hysteria2')
			AND (client.value::jsonb)->>'subId' = ? AND enable = ?
	)`, subId, true).Order("id ASC").Find(&inbounds).Error
	if err != nil {
		return nil, err
	}
	return inbounds, nil
}

func (s *SubService) getClientTraffics(traffics []xray.ClientTraffic, email string) xray.ClientTraffic {
	for _, traffic := range traffics {
		if traffic.Email == email {
			return traffic
		}
	}
	return xray.ClientTraffic{}
}

// prepareInboundForSubscription resolves fallback-master listen/port/stream when the inbound uses a UDS @dest tag,
// matching the behavior expected by subscription link generation. It returns a shallow copy so callers do not mutate
// the cached inbound from the DB slice.
func (s *SubService) prepareInboundForSubscription(inbound *model.Inbound) *model.Inbound {
	if inbound == nil {
		return nil
	}
	out := *inbound
	if len(out.Listen) > 0 && out.Listen[0] == '@' {
		listen, port, streamSettings, err := s.getFallbackMaster(out.Listen, out.StreamSettings)
		if err == nil {
			out.Listen = listen
			out.Port = port
			out.StreamSettings = streamSettings
		}
	}
	return &out
}

func (s *SubService) getFallbackMaster(dest string, streamSettings string) (string, int, string, error) {
	db := database.GetDB()
	var inbound *model.Inbound
	err := db.Model(model.Inbound{}).
		Where("jsonb_typeof((settings::jsonb)->'fallbacks') = 'array'").
		Where("EXISTS (SELECT * FROM jsonb_array_elements((settings::jsonb)->'fallbacks') WHERE (value::jsonb)->>'dest' = ?)", dest).
		Find(&inbound).Error
	if err != nil {
		return "", 0, "", err
	}
	if inbound == nil {
		return "", 0, "", fmt.Errorf("fallback master inbound not found for %s", dest)
	}

	stream := parseInboundStreamSettings(streamSettings)
	masterStream := parseInboundStreamSettings(inbound.StreamSettings)
	stream["security"] = masterStream["security"]
	if tls, ok := masterStream["tlsSettings"].(map[string]any); ok {
		stream["tlsSettings"] = tls
	} else {
		delete(stream, "tlsSettings")
	}
	stream["externalProxy"] = masterStream["externalProxy"]
	if masterStream["security"] != "tls" {
		delete(stream, "tlsSettings")
	}
	modifiedStream, _ := json.MarshalIndent(stream, "", "  ")

	return inbound.Listen, inbound.Port, string(modifiedStream), nil
}

func (s *SubService) getLink(inbound *model.Inbound, email string) string {
	if inbound == nil {
		return ""
	}
	in := *inbound
	in.Protocol = model.Protocol(strings.ToLower(strings.TrimSpace(string(inbound.Protocol))))
	switch in.Protocol {
	case model.VMESS:
		return s.genVmessLink(&in, email)
	case model.VLESS:
		return s.genVlessLink(&in, email)
	case model.Trojan:
		return s.genTrojanLink(&in, email)
	case model.Shadowsocks:
		return s.genShadowsocksLink(&in, email)
	case model.Mixed:
		return s.genMixedLink(&in, email)
	case model.WireGuard:
		return s.buildWireguardPanelInfo(&in, email)
	case model.AmneziaWG:
		return s.buildAmneziaWgPanelInfo(&in, email)
	case model.Telemt:
		if email == "" {
			return ""
		}
		clients, err := s.clientService.GetClientsForInbound(inbound.Id)
		if err != nil {
			return ""
		}
		em := strings.ToLower(strings.TrimSpace(email))
		for _, c := range clients {
			if c == nil {
				continue
			}
			if strings.ToLower(strings.TrimSpace(c.Name)) == em {
				return s.genTelemtLinkWithClient(&in, c)
			}
		}
		return ""
	default:
		if model.IsHysteria(in.Protocol) {
			return s.genHysteriaLink(&in, email)
		}
	}
	return ""
}

// appendSubscriptionLinks adds one subscription entry. WireGuard panel info is kept as a single
// multi-line string so the sub page can extract the wg-quick [Interface]/[Peer] block; other
// protocols may return several URLs separated by newlines (multi-node).
func appendSubscriptionLinks(dst []string, inbound *model.Inbound, link string) []string {
	link = strings.TrimSpace(link)
	if link == "" {
		return dst
	}
	if inbound != nil && (model.NormalizeProtocol(inbound.Protocol) == model.WireGuard || model.NormalizeProtocol(inbound.Protocol) == model.AmneziaWG) {
		return append(dst, link)
	}
	for _, linkLine := range strings.Split(link, "\n") {
		linkLine = strings.TrimSpace(linkLine)
		if linkLine != "" {
			dst = append(dst, linkLine)
		}
	}
	return dst
}

// getLinkWithClient generates a subscription link using ClientEntity data (new architecture)
func (s *SubService) getLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound == nil {
		return ""
	}
	in := *inbound
	in.Protocol = model.Protocol(strings.ToLower(strings.TrimSpace(string(inbound.Protocol))))
	// WireGuard / AmneziaWG: optional ClientEntity; email matches a peer in inbound JSON
	if in.Protocol == model.WireGuard || in.Protocol == model.AmneziaWG {
		email := ""
		if client != nil {
			email = client.Name
		}
		if in.Protocol == model.WireGuard {
			return s.buildWireguardPanelInfo(&in, email)
		}
		return s.buildAmneziaWgPanelInfo(&in, email)
	}
	if client == nil {
		return ""
	}
	switch in.Protocol {
	case model.VMESS:
		return s.genVmessLinkWithClient(&in, client)
	case model.VLESS:
		return s.genVlessLinkWithClient(&in, client)
	case model.Trojan:
		return s.genTrojanLinkWithClient(&in, client)
	case model.Shadowsocks:
		return s.genShadowsocksLinkWithClient(&in, client)
	case model.Mixed:
		return s.genMixedLinkWithClient(&in, client)
	case model.Telemt:
		return s.genTelemtLinkWithClient(&in, client)
	default:
		if model.IsHysteria(in.Protocol) {
			return s.genHysteriaLinkWithClient(&in, client)
		}
	}
	return ""
}

func (s *SubService) genTelemtLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound == nil || client == nil || model.NormalizeProtocol(inbound.Protocol) != model.Telemt {
		return ""
	}
	var m model.ClientInboundMapping
	if err := database.GetDB().Where("client_id = ? AND inbound_id = ?", client.Id, inbound.Id).First(&m).Error; err != nil {
		return ""
	}
	sec := strings.TrimSpace(m.TelemtSecret)
	raw, err := hex.DecodeString(strings.ToLower(sec))
	if err != nil || len(raw) != 16 {
		return ""
	}
	secure, tlsMode := false, true
	var root map[string]any
	_ = json.Unmarshal([]byte(inbound.Settings), &root)
	if t, ok := root["telemt"].(map[string]any); ok {
		if modes, ok2 := t["modes"].(map[string]any); ok2 {
			if v, ok := modes["secure"].(bool); ok {
				secure = v
			}
			if v, ok := modes["tls"].(bool); ok {
				tlsMode = v
			}
		}
	}
	// Telegram MTProto share links use lowercase hex in `secret` (see Telemt / Telegram clients).
	// Param order is server, port, secret — do not use url.Values.Encode() (sorts keys).
	tlsDom := telemtTlsDomainForSubLink(inbound.Settings)
	secretHex := telemtTgProxySecretForLink(raw, tlsMode, secure, tlsDom)

	addrs, _ := s.getAddressesForInbound(inbound)
	if len(addrs) == 0 {
		return ""
	}
	var b strings.Builder
	for i, ap := range addrs {
		host := strings.TrimSpace(ap.Address)
		if host == "" {
			continue
		}
		p := ap.Port
		if p <= 0 {
			p = inbound.Port
		}
		if i > 0 {
			b.WriteByte('\n')
		}
		qHost := url.QueryEscape(host)
		b.WriteString(fmt.Sprintf("tg://proxy?server=%s&port=%d&secret=%s", qHost, p, secretHex))
	}
	return b.String()
}

// TelemtTgProxyLinesForSubscription returns tg://proxy lines for the first-party subscription HTML page.
// Telemt inbounds are excluded from GetSubs (see getInboundsBySubId allowed protocols), so VPN clients never
// receive tg:// lines in the raw subscription body.
func (s *SubService) TelemtTgProxyLinesForSubscription(subId string, host string) []string {
	s.address = host
	db := database.GetDB()
	var client model.ClientEntity
	if err := db.Where("sub_id = ? AND enable = ?", subId, true).First(&client).Error; err != nil {
		return nil
	}
	var mappings []model.ClientInboundMapping
	if err := db.Where("client_id = ?", client.Id).Order("sort_order ASC, id ASC").Find(&mappings).Error; err != nil || len(mappings) == 0 {
		return nil
	}
	ids := make([]int, 0, len(mappings))
	for _, m := range mappings {
		ids = append(ids, m.InboundId)
	}
	var inbounds []*model.Inbound
	if err := db.Model(&model.Inbound{}).Preload("ClientStats").Where("id IN ? AND enable = ?", ids, true).Find(&inbounds).Error; err != nil {
		return nil
	}
	byID := make(map[int]*model.Inbound, len(inbounds))
	for _, inb := range inbounds {
		byID[inb.Id] = inb
	}
	var out []string
	for _, m := range mappings {
		inb, ok := byID[m.InboundId]
		if !ok || model.NormalizeProtocol(inb.Protocol) != model.Telemt {
			continue
		}
		prepared := s.prepareInboundForSubscription(inb)
		link := s.getLinkWithClient(prepared, &client)
		for _, line := range strings.Split(link, "\n") {
			line = strings.TrimSpace(line)
			if line != "" && strings.HasPrefix(strings.ToLower(line), "tg://proxy") {
				out = append(out, line)
			}
		}
	}
	return out
}

// passwordForSubLink returns the secret for SS/Mixed links: ClientEntity first, then inbound settings (legacy/stale rows).
func (s *SubService) passwordForSubLink(inbound *model.Inbound, client *model.ClientEntity) string {
	if client == nil {
		return ""
	}
	if p := strings.TrimSpace(client.Password); p != "" {
		return p
	}
	if inbound == nil || strings.TrimSpace(inbound.Settings) == "" {
		return ""
	}
	var settings map[string]any
	if err := json.Unmarshal([]byte(inbound.Settings), &settings); err != nil {
		return ""
	}
	switch model.NormalizeProtocol(inbound.Protocol) {
	case model.Mixed:
		want := mixedProxyUserFromEmail(client.Name)
		accs, _ := settings["accounts"].([]any)
		for _, a := range accs {
			am, _ := a.(map[string]any)
			if am == nil {
				continue
			}
			if strings.TrimSpace(mapGetString(am, "user")) == want {
				return mapGetString(am, "pass")
			}
		}
	case model.Shadowsocks:
		want := strings.ToLower(strings.TrimSpace(client.Name))
		clients, _ := settings["clients"].([]any)
		for _, c := range clients {
			cm, _ := c.(map[string]any)
			if cm == nil {
				continue
			}
			if strings.ToLower(strings.TrimSpace(mapGetString(cm, "email"))) == want {
				return mapGetString(cm, "password")
			}
		}
	}
	return ""
}

// mixedProxyUserFromEmail matches web/inbound mixed account user (local-part of email, fallback "user").
func mixedProxyUserFromEmail(email string) string {
	u := strings.TrimSpace(email)
	if i := strings.IndexByte(u, '@'); i > 0 {
		u = u[:i]
	}
	if u == "" {
		return "user"
	}
	return u
}

// genMixedLinkWithClient returns SOCKS5 and HTTP proxy URIs (one address per line group) for Xray mixed inbound.
func (s *SubService) genMixedLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.Mixed || client == nil {
		return ""
	}
	pass := strings.TrimSpace(s.passwordForSubLink(inbound, client))
	if pass == "" {
		return ""
	}
	user := mixedProxyUserFromEmail(client.Name)
	nodeAddresses, _ := s.getAddressesForInbound(inbound)
	if len(nodeAddresses) == 0 {
		return ""
	}
	var b strings.Builder
	idx := 0
	for _, ap := range nodeAddresses {
		host := strings.TrimSpace(ap.Address)
		if host == "" {
			continue
		}
		linkPort := inbound.Port
		if ap.Port > 0 {
			linkPort = ap.Port
		}
		hp := net.JoinHostPort(host, fmt.Sprintf("%d", linkPort))
		socks := &url.URL{Scheme: "socks5", User: url.UserPassword(user, pass), Host: hp}
		httpU := &url.URL{Scheme: "http", User: url.UserPassword(user, pass), Host: hp}
		if idx > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(socks.String())
		b.WriteByte('\n')
		b.WriteString(httpU.String())
		idx++
	}
	if b.Len() == 0 {
		return ""
	}
	return b.String()
}

func (s *SubService) genMixedLink(inbound *model.Inbound, email string) string {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.Mixed {
		return ""
	}
	clients, err := s.inboundService.GetClients(inbound)
	if err != nil {
		return ""
	}
	for _, c := range clients {
		if c.Email == email && strings.TrimSpace(c.Password) != "" {
			return s.genMixedLinkWithClient(inbound, &model.ClientEntity{Name: c.Email, Password: c.Password})
		}
	}
	return ""
}

// AddressPort represents an address and port for subscription links.
type AddressPort struct {
	Address           string
	Port              int // 0 means use inbound.Port
	RemarkSuffix      string
	ServerDescription string
	RemarkNodeName    string
	RemarkDisplayHost string
	// ApplyHostSubscriptionOverrides is true only for the endpoint row derived from the panel Host (CDN/front).
	// Host TLS/stream overrides apply to those rows only; node-derived rows keep inbound stream settings.
	ApplyHostSubscriptionOverrides bool
}

// RemarkTplNode overrides remark template n/p slots for per-endpoint links.
type RemarkTplNode struct {
	Name        string
	DisplayHost string
}

func remarkTplFromAP(ap AddressPort) *RemarkTplNode {
	if strings.TrimSpace(ap.RemarkNodeName) == "" && strings.TrimSpace(ap.RemarkDisplayHost) == "" {
		return nil
	}
	return &RemarkTplNode{Name: ap.RemarkNodeName, DisplayHost: ap.RemarkDisplayHost}
}

func hostAddressPort(h *model.Host) AddressPort {
	ap := AddressPort{
		Address:                        h.Address,
		ApplyHostSubscriptionOverrides: true,
	}
	if h.Port > 0 {
		ap.Port = h.Port
	}
	return ap
}

func (s *SubService) defaultAddressPorts(inbound *model.Inbound) []AddressPort {
	var defaultAddress string
	if inbound.Listen == "" || inbound.Listen == "0.0.0.0" || inbound.Listen == "::" || inbound.Listen == "::0" {
		defaultAddress = s.address
	} else {
		defaultAddress = inbound.Listen
	}
	if defaultAddress == "" {
		if d, err := s.settingService.GetSubDomain(); err == nil {
			defaultAddress = strings.TrimSpace(d)
		}
	}
	if defaultAddress == "" {
		if d, err := s.settingService.GetWebDomain(); err == nil {
			defaultAddress = strings.TrimSpace(d)
			if strings.Contains(defaultAddress, "://") {
				if u, err := url.Parse(defaultAddress); err == nil && u.Host != "" {
					defaultAddress = u.Host
					if i := strings.Index(defaultAddress, ":"); i >= 0 {
						defaultAddress = defaultAddress[:i]
					}
				}
			}
		}
	}
	return []AddressPort{{Address: defaultAddress, Port: 0}}
}

func (s *SubService) buildNodeAddressPorts(inbound *model.Inbound) []AddressPort {
	multiMode, _ := s.settingService.GetMultiNodeMode()
	if !multiMode {
		return nil
	}
	rows, err := s.nodeService.GetInboundNodeSubscriptionRows(inbound.Id)
	if err != nil || len(rows) == 0 {
		return nil
	}
	out := make([]AddressPort, 0, len(rows))
	for _, row := range rows {
		if !row.Mapping.IncludeInSubscription {
			continue
		}
		addr := strings.TrimSpace(row.Mapping.PublishedAddress)
		if addr == "" {
			addr = s.extractNodeHost(row.Node.Address)
		}
		if addr == "" {
			continue
		}
		out = append(out, AddressPort{
			Address:           addr,
			Port:              row.Mapping.PublishedPort,
			RemarkSuffix:      row.Mapping.SubscriptionRemarkSuffix,
			ServerDescription: row.Mapping.ServerDescription,
			RemarkNodeName:    row.Node.Name,
			RemarkDisplayHost: addr,
		})
	}
	return out
}

// getAddressesForInbound returns addresses for subscription links.
// Host mode replace uses only the host; prepend/append merge host with node-derived addresses.
// When the second value is non-nil, it is the enabled Host mapped to this inbound (for subscription TLS/stream overrides).
func (s *SubService) getAddressesForInbound(inbound *model.Inbound) ([]AddressPort, *model.Host) {
	nodeAddrs := s.buildNodeAddressPorts(inbound)
	if len(nodeAddrs) == 0 {
		nodeAddrs = s.defaultAddressPorts(inbound)
	}

	var subHost *model.Host
	host, err := s.hostService.GetHostForInbound(inbound.Id)
	if err != nil {
		host = nil
	}
	if host != nil && host.Enable {
		subHost = host
		mode := model.NormalizeHostSubscriptionApplyMode(host.SubscriptionApplyMode)
		hp := hostAddressPort(host)
		// AmneziaWG / WireGuard listen on the worker as UDP sidecars — Host "replace" must not
		// hide node published addresses (unlike TCP/TLS front domains that proxy to nodes).
		udpOnWorker := inbound != nil && (model.NormalizeProtocol(inbound.Protocol) == model.AmneziaWG || model.NormalizeProtocol(inbound.Protocol) == model.WireGuard)
		switch mode {
		case model.HostSubscriptionApplyPrepend:
			nodeAddrs = append([]AddressPort{hp}, nodeAddrs...)
		case model.HostSubscriptionApplyAppend:
			nodeAddrs = append(nodeAddrs, hp)
		default:
			if udpOnWorker && len(nodeAddrs) > 0 {
				// keep worker node address(es) for UDP tunnel endpoint
			} else {
				nodeAddrs = []AddressPort{hp}
			}
		}
	}

	nonEmpty := make([]AddressPort, 0, len(nodeAddrs))
	for _, ap := range nodeAddrs {
		if strings.TrimSpace(ap.Address) != "" {
			nonEmpty = append(nonEmpty, ap)
		}
	}
	if len(nonEmpty) > 0 {
		return nonEmpty, subHost
	}
	if h := strings.TrimSpace(s.address); h != "" {
		return []AddressPort{{Address: h, Port: 0}}, subHost
	}
	return nodeAddrs, subHost
}

func (s *SubService) genVmessLink(inbound *model.Inbound, email string) string {
	if inbound.Protocol != model.VMESS {
		return ""
	}

	// Get addresses (Host > Nodes > Default)
	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	// Base object template (address will be set per node)
	baseObj := map[string]any{
		"v":    "2",
		"port": inbound.Port,
		"type": "none",
	}
	var stream map[string]any
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	network, _ := stream["network"].(string)
	baseObj["net"] = network
	switch network {
	case "tcp":
		tcp, _ := stream["tcpSettings"].(map[string]any)
		var typeStr string
		if tcp != nil {
			if header, _ := tcp["header"].(map[string]any); header != nil {
				typeStr, _ = header["type"].(string)
			}
		}
		baseObj["type"] = typeStr
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			baseObj["path"] = path
			baseObj["host"] = host
		}
	case "kcp":
		kcp, _ := stream["kcpSettings"].(map[string]any)
		header, _ := kcp["header"].(map[string]any)
		baseObj["type"], _ = header["type"].(string)
		baseObj["path"], _ = kcp["seed"].(string)
	case "ws":
		ws, _ := stream["wsSettings"].(map[string]any)
		baseObj["path"] = ws["path"].(string)
		if host, ok := ws["host"].(string); ok && len(host) > 0 {
			baseObj["host"] = host
		} else {
			headers, _ := ws["headers"].(map[string]any)
			baseObj["host"] = searchHost(headers)
		}
	case "grpc":
		grpc, _ := stream["grpcSettings"].(map[string]any)
		baseObj["path"] = grpc["serviceName"].(string)
		baseObj["authority"] = grpc["authority"].(string)
		if jsonBool(grpc, "multiMode") {
			baseObj["type"] = "multi"
		}
	case "httpupgrade":
		httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any)
		baseObj["path"] = httpupgrade["path"].(string)
		if host, ok := httpupgrade["host"].(string); ok && len(host) > 0 {
			baseObj["host"] = host
		} else {
			headers, _ := httpupgrade["headers"].(map[string]any)
			baseObj["host"] = searchHost(headers)
		}
	case "xhttp":
		xhttp, _ := stream["xhttpSettings"].(map[string]any)
		baseObj["path"] = xhttp["path"].(string)
		if host, ok := xhttp["host"].(string); ok && len(host) > 0 {
			baseObj["host"] = host
		} else {
			headers, _ := xhttp["headers"].(map[string]any)
			baseObj["host"] = searchHost(headers)
		}
		if m, ok := xhttp["mode"].(string); ok {
			baseObj["mode"] = m
		}
		applyXhttpPaddingToVmessObj(xhttp, baseObj)
	}
	security, _ := stream["security"].(string)
	baseObj["tls"] = security
	if security == "tls" {
		tlsSetting, _ := stream["tlsSettings"].(map[string]any)
		alpns, _ := tlsSetting["alpn"].([]any)
		if len(alpns) > 0 {
			var alpn []string
			for _, a := range alpns {
				alpn = append(alpn, a.(string))
			}
			baseObj["alpn"] = strings.Join(alpn, ",")
		}
		if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
			baseObj["sni"], _ = sniValue.(string)
		}

		tlsSettings, _ := searchKey(tlsSetting, "settings")
		if tlsSetting != nil {
			if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
				baseObj["fp"], _ = fpValue.(string)
			}
		}
		finalizeVmessTLSBase(tlsSetting, baseObj)
	}

	clients, _ := s.inboundService.GetClients(inbound)
	clientIndex := -1
	for i, client := range clients {
		if client.Email == email {
			clientIndex = i
			break
		}
	}
	baseObj["id"] = clients[clientIndex].ID
	baseObj["scy"] = clients[clientIndex].Security

	externalProxies, _ := stream["externalProxy"].([]any)

	// Generate links for each node address (or external proxy)
	links := ""
	linkIndex := 0

	// First, handle external proxies if any
	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			newSecurity, _ := ep["forceTls"].(string)
			newObj := map[string]any{}
			for key, value := range baseObj {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(key)) {
					newObj[key] = value
				}
			}
			newObj["ps"] = s.genRemark(inbound, email, ep["remark"].(string), nil)
			newObj["add"] = ep["dest"].(string)
			newObj["port"] = int(ep["port"].(float64))

			if newSecurity != "same" {
				newObj["tls"] = newSecurity
			}
			if subHost != nil {
				applyHostOverridesToVmessBase(subHost, network, newObj)
			}
			if linkIndex > 0 {
				links += "\n"
			}
			jsonStr, _ := json.MarshalIndent(newObj, "", "  ")
			links += "vmess://" + base64.StdEncoding.EncodeToString(jsonStr)
			linkIndex++
		}
		return links
	}

	// Generate links for each node address
	for _, addrPort := range nodeAddresses {
		obj := shallowCopyAnyMap(baseObj)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToVmessBase(subHost, network, obj)
		}
		obj["add"] = addrPort.Address
		// Use port from Host if specified, otherwise use inbound.Port
		if addrPort.Port > 0 {
			obj["port"] = addrPort.Port
		}
		obj["ps"] = s.genRemark(inbound, email, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort))

		if linkIndex > 0 {
			links += "\n"
		}
		jsonStr, _ := json.MarshalIndent(obj, "", "  ")
		links += "vmess://" + base64.StdEncoding.EncodeToString(jsonStr)
		linkIndex++
	}

	return links
}

// genVmessLinkWithClient generates VMESS link using ClientEntity data (new architecture)
func (s *SubService) genVmessLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound.Protocol != model.VMESS {
		return ""
	}

	// Get addresses (Host > Nodes > Default)
	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	// Base object template (address will be set per node)
	baseObj := map[string]any{
		"v":    "2",
		"port": inbound.Port,
		"type": "none",
	}
	var stream map[string]any
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	network, _ := stream["network"].(string)
	baseObj["net"] = network
	switch network {
	case "tcp":
		tcp, _ := stream["tcpSettings"].(map[string]any)
		var typeStr string
		if tcp != nil {
			if header, _ := tcp["header"].(map[string]any); header != nil {
				typeStr, _ = header["type"].(string)
			}
		}
		baseObj["type"] = typeStr
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			baseObj["path"] = path
			baseObj["host"] = host
		}
	case "kcp":
		kcp, _ := stream["kcpSettings"].(map[string]any)
		header, _ := kcp["header"].(map[string]any)
		baseObj["type"], _ = header["type"].(string)
		baseObj["path"], _ = kcp["seed"].(string)
	case "ws":
		ws, _ := stream["wsSettings"].(map[string]any)
		baseObj["path"] = ws["path"].(string)
		if host, ok := ws["host"].(string); ok && len(host) > 0 {
			baseObj["host"] = host
		} else {
			headers, _ := ws["headers"].(map[string]any)
			baseObj["host"] = searchHost(headers)
		}
	case "grpc":
		grpc, _ := stream["grpcSettings"].(map[string]any)
		baseObj["path"] = grpc["serviceName"].(string)
		baseObj["authority"] = grpc["authority"].(string)
		if jsonBool(grpc, "multiMode") {
			baseObj["type"] = "multi"
		}
	case "httpupgrade":
		httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any)
		baseObj["path"] = httpupgrade["path"].(string)
		if host, ok := httpupgrade["host"].(string); ok && len(host) > 0 {
			baseObj["host"] = host
		} else {
			headers, _ := httpupgrade["headers"].(map[string]any)
			baseObj["host"] = searchHost(headers)
		}
	case "xhttp":
		xhttp, _ := stream["xhttpSettings"].(map[string]any)
		baseObj["path"] = xhttp["path"].(string)
		if host, ok := xhttp["host"].(string); ok && len(host) > 0 {
			baseObj["host"] = host
		} else {
			headers, _ := xhttp["headers"].(map[string]any)
			baseObj["host"] = searchHost(headers)
		}
		if m, ok := xhttp["mode"].(string); ok {
			baseObj["mode"] = m
		}
		applyXhttpPaddingToVmessObj(xhttp, baseObj)
	}
	security, _ := stream["security"].(string)
	baseObj["tls"] = security
	if security == "tls" {
		tlsSetting, _ := stream["tlsSettings"].(map[string]any)
		alpns, _ := tlsSetting["alpn"].([]any)
		if len(alpns) > 0 {
			var alpn []string
			for _, a := range alpns {
				alpn = append(alpn, a.(string))
			}
			baseObj["alpn"] = strings.Join(alpn, ",")
		}
		if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
			baseObj["sni"], _ = sniValue.(string)
		}

		tlsSettings, _ := searchKey(tlsSetting, "settings")
		if tlsSetting != nil {
			if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
				baseObj["fp"], _ = fpValue.(string)
			}
		}
		finalizeVmessTLSBase(tlsSetting, baseObj)
	}

	// Use ClientEntity data directly
	baseObj["id"] = client.UUID
	baseObj["scy"] = client.Security

	externalProxies, _ := stream["externalProxy"].([]any)

	// Generate links for each node address (or external proxy)
	links := ""
	linkIndex := 0

	// First, handle external proxies if any
	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			newSecurity, _ := ep["forceTls"].(string)
			newObj := map[string]any{}
			for key, value := range baseObj {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(key)) {
					newObj[key] = value
				}
			}
			newObj["ps"] = s.genRemarkWithClient(inbound, client, ep["remark"].(string), nil)
			newObj["add"] = ep["dest"].(string)
			newObj["port"] = int(ep["port"].(float64))

			if newSecurity != "same" {
				newObj["tls"] = newSecurity
			}
			if subHost != nil {
				applyHostOverridesToVmessBase(subHost, network, newObj)
			}
			if linkIndex > 0 {
				links += "\n"
			}
			jsonStr, _ := json.MarshalIndent(newObj, "", "  ")
			links += "vmess://" + base64.StdEncoding.EncodeToString(jsonStr)
			linkIndex++
		}
		return links
	}

	// Generate links for each node address
	for _, addrPort := range nodeAddresses {
		obj := shallowCopyAnyMap(baseObj)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToVmessBase(subHost, network, obj)
		}
		obj["add"] = addrPort.Address
		// Use port from Host if specified, otherwise use inbound.Port
		if addrPort.Port > 0 {
			obj["port"] = addrPort.Port
		}
		obj["ps"] = s.genRemarkWithClient(inbound, client, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort))

		if linkIndex > 0 {
			links += "\n"
		}
		jsonStr, _ := json.MarshalIndent(obj, "", "  ")
		links += "vmess://" + base64.StdEncoding.EncodeToString(jsonStr)
		linkIndex++
	}

	return links
}

// vlessFlowForShareLink returns VLESS flow when allowed for this inbound transport (clientFlow is ignored).
func vlessFlowForShareLink(_ string, inbound *model.Inbound) string {
	if inbound == nil {
		return ""
	}
	return service.VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol)
}

// applyXhttpPaddingParams copies xPadding* fields from xhttpSettings into vless:// / trojan:// / ss://
// query params (aligned with 3x-ui): x_padding_bytes, extra=<json> for Xray/sing-box clients.
func applyXhttpPaddingParams(xhttp map[string]any, params map[string]string) {
	if xhttp == nil {
		return
	}
	if xpb, ok := xhttp["xPaddingBytes"].(string); ok && len(xpb) > 0 {
		params["x_padding_bytes"] = xpb
	}
	extra := map[string]any{}
	if xpb, ok := xhttp["xPaddingBytes"].(string); ok && len(xpb) > 0 {
		extra["xPaddingBytes"] = xpb
	}
	if obfs, ok := xhttp["xPaddingObfsMode"].(bool); ok && obfs {
		extra["xPaddingObfsMode"] = true
		for _, field := range []string{"xPaddingKey", "xPaddingHeader", "xPaddingPlacement", "xPaddingMethod"} {
			if v, ok := xhttp[field].(string); ok && len(v) > 0 {
				extra[field] = v
			}
		}
	}
	if len(extra) > 0 {
		if b, err := json.Marshal(extra); err == nil {
			params["extra"] = string(b)
		}
	}
}

// applyXhttpPaddingToVmessObj copies xhttp padding into the VMess base64 share JSON (aligned with 3x-ui).
func applyXhttpPaddingToVmessObj(xhttp map[string]any, obj map[string]any) {
	if xhttp == nil || obj == nil {
		return
	}
	if xpb, ok := xhttp["xPaddingBytes"].(string); ok && len(xpb) > 0 {
		obj["x_padding_bytes"] = xpb
	}
	if obfs, ok := xhttp["xPaddingObfsMode"].(bool); ok && obfs {
		obj["xPaddingObfsMode"] = true
		for _, field := range []string{"xPaddingKey", "xPaddingHeader", "xPaddingPlacement", "xPaddingMethod"} {
			if v, ok := xhttp[field].(string); ok && len(v) > 0 {
				obj[field] = v
			}
		}
	}
}

// genVlessLinkWithClient generates VLESS link using ClientEntity data (new architecture)
func (s *SubService) genVlessLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound.Protocol != model.VLESS || client == nil {
		return ""
	}

	// Get addresses (Host > Nodes > Default)
	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	var stream map[string]any
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	uuid := client.UUID
	port := inbound.Port
	streamNetwork, _ := stream["network"].(string)
	if streamNetwork == "" {
		streamNetwork = "tcp"
	}
	vlessFlow := vlessFlowForShareLink(client.Flow, inbound)
	params := make(map[string]string)
	params["type"] = streamNetwork

	// Add encryption parameter for VLESS from inbound settings
	var settings map[string]any
	json.Unmarshal([]byte(inbound.Settings), &settings)
	if encryption, ok := settings["encryption"].(string); ok {
		params["encryption"] = encryption
	}

	switch streamNetwork {
	case "tcp":
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			params["path"] = path
			params["host"] = host
			params["headerType"] = "http"
		}
	case "kcp":
		kcp, _ := stream["kcpSettings"].(map[string]any)
		header, _ := kcp["header"].(map[string]any)
		params["headerType"] = header["type"].(string)
		params["seed"] = kcp["seed"].(string)
	case "ws":
		ws, _ := stream["wsSettings"].(map[string]any)
		params["path"] = ws["path"].(string)
		if host, ok := ws["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := ws["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "grpc":
		grpc, _ := stream["grpcSettings"].(map[string]any)
		params["serviceName"] = grpc["serviceName"].(string)
		params["authority"], _ = grpc["authority"].(string)
		if mm, ok := grpc["multiMode"].(bool); ok && mm {
			params["mode"] = "multi"
		}
	case "httpupgrade":
		httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any)
		params["path"] = httpupgrade["path"].(string)
		if host, ok := httpupgrade["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := httpupgrade["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "xhttp":
		xhttp, _ := stream["xhttpSettings"].(map[string]any)
		params["path"] = xhttp["path"].(string)
		if host, ok := xhttp["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := xhttp["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
		params["mode"] = xhttp["mode"].(string)
		applyXhttpPaddingParams(xhttp, params)
	}
	security, _ := stream["security"].(string)
	if security == "tls" {
		params["security"] = "tls"
		tlsSetting, _ := stream["tlsSettings"].(map[string]any)
		alpns, _ := tlsSetting["alpn"].([]any)
		var alpn []string
		for _, a := range alpns {
			alpn = append(alpn, a.(string))
		}
		if len(alpn) > 0 {
			params["alpn"] = strings.Join(alpn, ",")
		}
		if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
			params["sni"], _ = sniValue.(string)
		}

		tlsSettings, _ := searchKey(tlsSetting, "settings")
		if tlsSetting != nil {
			if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
				params["fp"], _ = fpValue.(string)
			}
		}
		finalizeTLSQueryParams(tlsSetting, params)

		if len(vlessFlow) > 0 {
			params["flow"] = vlessFlow
		}
	}

	if security == "reality" {
		params["security"] = "reality"
		realitySetting, _ := stream["realitySettings"].(map[string]any)
		realitySettings, _ := searchKey(realitySetting, "settings")
		if realitySetting != nil {
			if sniValue, ok := searchKey(realitySetting, "serverNames"); ok {
				sNames, _ := sniValue.([]any)
				if n := len(sNames); n > 0 {
					if sn, ok := sNames[random.Num(n)].(string); ok {
						params["sni"] = sn
					}
				}
			}
			if pbkValue, ok := searchKey(realitySettings, "publicKey"); ok {
				params["pbk"], _ = pbkValue.(string)
			}
			if sidValue, ok := searchKey(realitySetting, "shortIds"); ok {
				shortIds, _ := sidValue.([]any)
				if n := len(shortIds); n > 0 {
					if sid, ok := shortIds[random.Num(n)].(string); ok {
						params["sid"] = sid
					}
				}
			}
			if fpValue, ok := searchKey(realitySettings, "fingerprint"); ok {
				if fp, ok := fpValue.(string); ok && len(fp) > 0 {
					params["fp"] = fp
				}
			}
			if pqvValue, ok := searchKey(realitySettings, "mldsa65Verify"); ok {
				if pqv, ok := pqvValue.(string); ok && len(pqv) > 0 {
					params["pqv"] = pqv
				}
			}
			params["spx"] = "/" + random.Seq(15)
		}

		if len(vlessFlow) > 0 {
			params["flow"] = vlessFlow
		}
	}

	if security != "tls" && security != "reality" {
		params["security"] = "none"
	}

	sn := streamNetwork
	if sn == "" {
		sn = "tcp"
	}
	baseParams := shallowCopyStringMap(params)

	externalProxies, _ := stream["externalProxy"].([]any)

	// Generate links for each node address (or external proxy)
	var initialCapacity int
	if len(externalProxies) > 0 {
		initialCapacity = len(externalProxies)
	} else {
		initialCapacity = len(nodeAddresses)
	}
	links := make([]string, 0, initialCapacity)

	// First, handle external proxies if any
	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			newSecurity, _ := ep["forceTls"].(string)
			dest, _ := ep["dest"].(string)
			epPort := int(ep["port"].(float64))
			link := fmt.Sprintf("vless://%s@%s:%d", uuid, dest, epPort)

			epParams := shallowCopyStringMap(baseParams)
			if subHost != nil {
				applyHostOverridesToParams(subHost, sn, epParams)
			}

			if newSecurity != "same" {
				epParams["security"] = newSecurity
			} else {
				epParams["security"] = security
			}
			url, _ := url.Parse(link)
			q := url.Query()

			for k, v := range epParams {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(k)) {
					q.Add(k, v)
				}
			}

			url.RawQuery = q.Encode()
			url.Fragment = s.genShareLinkFragmentWithClient(inbound, client, ep["remark"].(string), nil, "")
			links = append(links, url.String())
		}
		return strings.Join(links, "\n")
	}

	// Generate links for each node address
	for _, addrPort := range nodeAddresses {
		linkPort := port
		if addrPort.Port > 0 {
			linkPort = addrPort.Port
		}
		link := fmt.Sprintf("vless://%s@%s:%d", uuid, addrPort.Address, linkPort)
		url, _ := url.Parse(link)
		q := url.Query()

		rowParams := shallowCopyStringMap(baseParams)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToParams(subHost, sn, rowParams)
		}

		for k, v := range rowParams {
			q.Add(k, v)
		}

		url.RawQuery = q.Encode()
		url.Fragment = s.genShareLinkFragmentWithClient(inbound, client, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort), addrPort.ServerDescription)
		links = append(links, url.String())
	}

	return strings.Join(links, "\n")
}

func (s *SubService) genVlessLink(inbound *model.Inbound, email string) string {
	if inbound.Protocol != model.VLESS {
		return ""
	}

	// Get addresses (Host > Nodes > Default)
	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	var stream map[string]any
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	clients, _ := s.inboundService.GetClients(inbound)
	clientIndex := -1
	for i, client := range clients {
		if client.Email == email {
			clientIndex = i
			break
		}
	}
	uuid := clients[clientIndex].ID
	vlessFlow := vlessFlowForShareLink(clients[clientIndex].Flow, inbound)
	port := inbound.Port
	streamNetwork := stream["network"].(string)
	params := make(map[string]string)
	params["type"] = streamNetwork

	// Add encryption parameter for VLESS from inbound settings
	var settings map[string]any
	json.Unmarshal([]byte(inbound.Settings), &settings)
	if encryption, ok := settings["encryption"].(string); ok {
		params["encryption"] = encryption
	}

	switch streamNetwork {
	case "tcp":
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			params["path"] = path
			params["host"] = host
			params["headerType"] = "http"
		}
	case "kcp":
		kcp, _ := stream["kcpSettings"].(map[string]any)
		header, _ := kcp["header"].(map[string]any)
		params["headerType"] = header["type"].(string)
		params["seed"] = kcp["seed"].(string)
	case "ws":
		ws, _ := stream["wsSettings"].(map[string]any)
		params["path"] = ws["path"].(string)
		if host, ok := ws["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := ws["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "grpc":
		grpc, _ := stream["grpcSettings"].(map[string]any)
		params["serviceName"] = grpc["serviceName"].(string)
		params["authority"], _ = grpc["authority"].(string)
		if jsonBool(grpc, "multiMode") {
			params["mode"] = "multi"
		}
	case "httpupgrade":
		httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any)
		params["path"] = httpupgrade["path"].(string)
		if host, ok := httpupgrade["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := httpupgrade["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "xhttp":
		xhttp, _ := stream["xhttpSettings"].(map[string]any)
		params["path"] = xhttp["path"].(string)
		if host, ok := xhttp["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := xhttp["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
		params["mode"] = xhttp["mode"].(string)
		applyXhttpPaddingParams(xhttp, params)
	}
	security, _ := stream["security"].(string)
	if security == "tls" {
		params["security"] = "tls"
		tlsSetting, _ := stream["tlsSettings"].(map[string]any)
		alpns, _ := tlsSetting["alpn"].([]any)
		var alpn []string
		for _, a := range alpns {
			alpn = append(alpn, a.(string))
		}
		if len(alpn) > 0 {
			params["alpn"] = strings.Join(alpn, ",")
		}
		if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
			params["sni"], _ = sniValue.(string)
		}

		tlsSettings, _ := searchKey(tlsSetting, "settings")
		if tlsSetting != nil {
			if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
				params["fp"], _ = fpValue.(string)
			}
		}
		finalizeTLSQueryParams(tlsSetting, params)

		if len(vlessFlow) > 0 {
			params["flow"] = vlessFlow
		}
	}

	if security == "reality" {
		params["security"] = "reality"
		realitySetting, _ := stream["realitySettings"].(map[string]any)
		realitySettings, _ := searchKey(realitySetting, "settings")
		if realitySetting != nil {
			if sniValue, ok := searchKey(realitySetting, "serverNames"); ok {
				sNames, _ := sniValue.([]any)
				params["sni"] = sNames[random.Num(len(sNames))].(string)
			}
			if pbkValue, ok := searchKey(realitySettings, "publicKey"); ok {
				params["pbk"], _ = pbkValue.(string)
			}
			if sidValue, ok := searchKey(realitySetting, "shortIds"); ok {
				shortIds, _ := sidValue.([]any)
				params["sid"] = shortIds[random.Num(len(shortIds))].(string)
			}
			if fpValue, ok := searchKey(realitySettings, "fingerprint"); ok {
				if fp, ok := fpValue.(string); ok && len(fp) > 0 {
					params["fp"] = fp
				}
			}
			if pqvValue, ok := searchKey(realitySettings, "mldsa65Verify"); ok {
				if pqv, ok := pqvValue.(string); ok && len(pqv) > 0 {
					params["pqv"] = pqv
				}
			}
			params["spx"] = "/" + random.Seq(15)
		}

		if len(vlessFlow) > 0 {
			params["flow"] = vlessFlow
		}
	}

	if security != "tls" && security != "reality" {
		params["security"] = "none"
	}

	sn := streamNetwork
	if sn == "" {
		sn = "tcp"
	}
	baseParams := shallowCopyStringMap(params)

	externalProxies, _ := stream["externalProxy"].([]any)

	// Generate links for each node address (or external proxy)
	// Pre-allocate capacity based on external proxies or node addresses
	var initialCapacity int
	if len(externalProxies) > 0 {
		initialCapacity = len(externalProxies)
	} else {
		initialCapacity = len(nodeAddresses)
	}
	links := make([]string, 0, initialCapacity)

	// First, handle external proxies if any
	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			newSecurity, _ := ep["forceTls"].(string)
			dest, _ := ep["dest"].(string)
			epPort := int(ep["port"].(float64))
			link := fmt.Sprintf("vless://%s@%s:%d", uuid, dest, epPort)

			epParams := shallowCopyStringMap(baseParams)
			if subHost != nil {
				applyHostOverridesToParams(subHost, sn, epParams)
			}

			if newSecurity != "same" {
				epParams["security"] = newSecurity
			} else {
				epParams["security"] = security
			}
			url, _ := url.Parse(link)
			q := url.Query()

			for k, v := range epParams {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(k)) {
					q.Add(k, v)
				}
			}

			// Set the new query values on the URL
			url.RawQuery = q.Encode()

			url.Fragment = s.genShareLinkFragment(inbound, email, ep["remark"].(string), nil, "")

			links = append(links, url.String())
		}
		return strings.Join(links, "\n")
	}

	// Generate links for each node address
	for _, addrPort := range nodeAddresses {
		// Use port from Host if specified, otherwise use inbound.Port
		linkPort := port
		if addrPort.Port > 0 {
			linkPort = addrPort.Port
		}
		link := fmt.Sprintf("vless://%s@%s:%d", uuid, addrPort.Address, linkPort)
		url, _ := url.Parse(link)
		q := url.Query()

		rowParams := shallowCopyStringMap(baseParams)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToParams(subHost, sn, rowParams)
		}

		for k, v := range rowParams {
			q.Add(k, v)
		}

		// Set the new query values on the URL
		url.RawQuery = q.Encode()

		url.Fragment = s.genShareLinkFragment(inbound, email, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort), addrPort.ServerDescription)

		links = append(links, url.String())
	}

	return strings.Join(links, "\n")
}

// genTrojanLinkWithClient generates Trojan link using ClientEntity data (new architecture)
func (s *SubService) genTrojanLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound.Protocol != model.Trojan {
		return ""
	}

	// Get addresses (Host > Nodes > Default)
	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	var stream map[string]any
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	password := client.Password
	port := inbound.Port
	streamNetwork := stream["network"].(string)
	params := make(map[string]string)
	params["type"] = streamNetwork

	switch streamNetwork {
	case "tcp":
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			params["path"] = path
			params["host"] = host
			params["headerType"] = "http"
		}
	case "kcp":
		kcp, _ := stream["kcpSettings"].(map[string]any)
		header, _ := kcp["header"].(map[string]any)
		params["headerType"] = header["type"].(string)
		params["seed"] = kcp["seed"].(string)
	case "ws":
		ws, _ := stream["wsSettings"].(map[string]any)
		params["path"] = ws["path"].(string)
		if host, ok := ws["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := ws["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "grpc":
		grpc, _ := stream["grpcSettings"].(map[string]any)
		params["serviceName"] = grpc["serviceName"].(string)
		params["authority"], _ = grpc["authority"].(string)
		if jsonBool(grpc, "multiMode") {
			params["mode"] = "multi"
		}
	case "httpupgrade":
		httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any)
		params["path"] = httpupgrade["path"].(string)
		if host, ok := httpupgrade["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := httpupgrade["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "xhttp":
		xhttp, _ := stream["xhttpSettings"].(map[string]any)
		params["path"] = xhttp["path"].(string)
		if host, ok := xhttp["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := xhttp["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
		params["mode"] = xhttp["mode"].(string)
		applyXhttpPaddingParams(xhttp, params)
	}
	security, _ := stream["security"].(string)
	if security == "tls" {
		params["security"] = "tls"
		tlsSetting, _ := stream["tlsSettings"].(map[string]any)
		alpns, _ := tlsSetting["alpn"].([]any)
		var alpn []string
		for _, a := range alpns {
			alpn = append(alpn, a.(string))
		}
		if len(alpn) > 0 {
			params["alpn"] = strings.Join(alpn, ",")
		}
		if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
			params["sni"], _ = sniValue.(string)
		}

		tlsSettings, _ := searchKey(tlsSetting, "settings")
		if tlsSetting != nil {
			if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
				params["fp"], _ = fpValue.(string)
			}
		}
		finalizeTLSQueryParams(tlsSetting, params)
	}

	if security == "reality" {
		params["security"] = "reality"
		realitySetting, _ := stream["realitySettings"].(map[string]any)
		realitySettings, _ := searchKey(realitySetting, "settings")
		if realitySetting != nil {
			if sniValue, ok := searchKey(realitySetting, "serverNames"); ok {
				sNames, _ := sniValue.([]any)
				params["sni"] = sNames[random.Num(len(sNames))].(string)
			}
			if pbkValue, ok := searchKey(realitySettings, "publicKey"); ok {
				params["pbk"], _ = pbkValue.(string)
			}
			if sidValue, ok := searchKey(realitySetting, "shortIds"); ok {
				shortIds, _ := sidValue.([]any)
				params["sid"] = shortIds[random.Num(len(shortIds))].(string)
			}
			if fpValue, ok := searchKey(realitySettings, "fingerprint"); ok {
				if fp, ok := fpValue.(string); ok && len(fp) > 0 {
					params["fp"] = fp
				}
			}
			if pqvValue, ok := searchKey(realitySettings, "mldsa65Verify"); ok {
				if pqv, ok := pqvValue.(string); ok && len(pqv) > 0 {
					params["pqv"] = pqv
				}
			}
			params["spx"] = "/" + random.Seq(15)
		}
	}

	if security != "tls" && security != "reality" {
		params["security"] = "none"
	}

	sn := streamNetwork
	if sn == "" {
		sn = "tcp"
	}
	baseParams := shallowCopyStringMap(params)

	externalProxies, _ := stream["externalProxy"].([]any)

	links := ""
	linkIndex := 0

	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			newSecurity, _ := ep["forceTls"].(string)
			dest, _ := ep["dest"].(string)
			epPort := int(ep["port"].(float64))
			link := fmt.Sprintf("trojan://%s@%s:%d", password, dest, epPort)

			epParams := shallowCopyStringMap(baseParams)
			if subHost != nil {
				applyHostOverridesToParams(subHost, sn, epParams)
			}

			if newSecurity != "same" {
				epParams["security"] = newSecurity
			} else {
				epParams["security"] = security
			}
			url, _ := url.Parse(link)
			q := url.Query()

			for k, v := range epParams {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(k)) {
					q.Add(k, v)
				}
			}

			url.RawQuery = q.Encode()
			url.Fragment = s.genShareLinkFragmentWithClient(inbound, client, ep["remark"].(string), nil, "")

			if linkIndex > 0 {
				links += "\n"
			}
			links += url.String()
			linkIndex++
		}
		return links
	}

	for _, addrPort := range nodeAddresses {
		linkPort := port
		if addrPort.Port > 0 {
			linkPort = addrPort.Port
		}
		link := fmt.Sprintf("trojan://%s@%s:%d", password, addrPort.Address, linkPort)
		url, _ := url.Parse(link)
		q := url.Query()

		rowParams := shallowCopyStringMap(baseParams)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToParams(subHost, sn, rowParams)
		}

		for k, v := range rowParams {
			q.Add(k, v)
		}

		url.RawQuery = q.Encode()
		url.Fragment = s.genShareLinkFragmentWithClient(inbound, client, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort), addrPort.ServerDescription)

		if linkIndex > 0 {
			links += "\n"
		}
		links += url.String()
		linkIndex++
	}

	return links
}

func (s *SubService) genTrojanLink(inbound *model.Inbound, email string) string {
	if inbound.Protocol != model.Trojan {
		return ""
	}

	// Get addresses (Host > Nodes > Default)
	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	var stream map[string]any
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	clients, _ := s.inboundService.GetClients(inbound)
	clientIndex := -1
	for i, client := range clients {
		if client.Email == email {
			clientIndex = i
			break
		}
	}
	password := clients[clientIndex].Password
	port := inbound.Port
	streamNetwork := stream["network"].(string)
	params := make(map[string]string)
	params["type"] = streamNetwork

	switch streamNetwork {
	case "tcp":
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			params["path"] = path
			params["host"] = host
			params["headerType"] = "http"
		}
	case "kcp":
		kcp, _ := stream["kcpSettings"].(map[string]any)
		header, _ := kcp["header"].(map[string]any)
		params["headerType"] = header["type"].(string)
		params["seed"] = kcp["seed"].(string)
	case "ws":
		ws, _ := stream["wsSettings"].(map[string]any)
		params["path"] = ws["path"].(string)
		if host, ok := ws["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := ws["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "grpc":
		grpc, _ := stream["grpcSettings"].(map[string]any)
		params["serviceName"] = grpc["serviceName"].(string)
		params["authority"], _ = grpc["authority"].(string)
		if jsonBool(grpc, "multiMode") {
			params["mode"] = "multi"
		}
	case "httpupgrade":
		httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any)
		params["path"] = httpupgrade["path"].(string)
		if host, ok := httpupgrade["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := httpupgrade["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
	case "xhttp":
		xhttp, _ := stream["xhttpSettings"].(map[string]any)
		params["path"] = xhttp["path"].(string)
		if host, ok := xhttp["host"].(string); ok && len(host) > 0 {
			params["host"] = host
		} else {
			headers, _ := xhttp["headers"].(map[string]any)
			params["host"] = searchHost(headers)
		}
		params["mode"] = xhttp["mode"].(string)
		applyXhttpPaddingParams(xhttp, params)
	}
	security, _ := stream["security"].(string)
	if security == "tls" {
		params["security"] = "tls"
		tlsSetting, _ := stream["tlsSettings"].(map[string]any)
		alpns, _ := tlsSetting["alpn"].([]any)
		var alpn []string
		for _, a := range alpns {
			alpn = append(alpn, a.(string))
		}
		if len(alpn) > 0 {
			params["alpn"] = strings.Join(alpn, ",")
		}
		if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
			params["sni"], _ = sniValue.(string)
		}

		tlsSettings, _ := searchKey(tlsSetting, "settings")
		if tlsSetting != nil {
			if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
				params["fp"], _ = fpValue.(string)
			}
		}
		finalizeTLSQueryParams(tlsSetting, params)
	}

	if security == "reality" {
		params["security"] = "reality"
		realitySetting, _ := stream["realitySettings"].(map[string]any)
		realitySettings, _ := searchKey(realitySetting, "settings")
		if realitySetting != nil {
			if sniValue, ok := searchKey(realitySetting, "serverNames"); ok {
				sNames, _ := sniValue.([]any)
				params["sni"] = sNames[random.Num(len(sNames))].(string)
			}
			if pbkValue, ok := searchKey(realitySettings, "publicKey"); ok {
				params["pbk"], _ = pbkValue.(string)
			}
			if sidValue, ok := searchKey(realitySetting, "shortIds"); ok {
				shortIds, _ := sidValue.([]any)
				params["sid"] = shortIds[random.Num(len(shortIds))].(string)
			}
			if fpValue, ok := searchKey(realitySettings, "fingerprint"); ok {
				if fp, ok := fpValue.(string); ok && len(fp) > 0 {
					params["fp"] = fp
				}
			}
			if pqvValue, ok := searchKey(realitySettings, "mldsa65Verify"); ok {
				if pqv, ok := pqvValue.(string); ok && len(pqv) > 0 {
					params["pqv"] = pqv
				}
			}
			params["spx"] = "/" + random.Seq(15)
		}
	}

	if security != "tls" && security != "reality" {
		params["security"] = "none"
	}

	sn := streamNetwork
	if sn == "" {
		sn = "tcp"
	}
	baseParams := shallowCopyStringMap(params)

	externalProxies, _ := stream["externalProxy"].([]any)

	// Generate links for each node address (or external proxy)
	links := ""
	linkIndex := 0

	// First, handle external proxies if any
	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			newSecurity, _ := ep["forceTls"].(string)
			dest, _ := ep["dest"].(string)
			epPort := int(ep["port"].(float64))
			link := fmt.Sprintf("trojan://%s@%s:%d", password, dest, epPort)

			epParams := shallowCopyStringMap(baseParams)
			if subHost != nil {
				applyHostOverridesToParams(subHost, sn, epParams)
			}

			if newSecurity != "same" {
				epParams["security"] = newSecurity
			} else {
				epParams["security"] = security
			}
			url, _ := url.Parse(link)
			q := url.Query()

			for k, v := range epParams {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(k)) {
					q.Add(k, v)
				}
			}

			// Set the new query values on the URL
			url.RawQuery = q.Encode()

			url.Fragment = s.genShareLinkFragment(inbound, email, ep["remark"].(string), nil, "")

			if linkIndex > 0 {
				links += "\n"
			}
			links += url.String()
			linkIndex++
		}
		return links
	}

	// Generate links for each node address
	for _, addrPort := range nodeAddresses {
		// Use port from Host if specified, otherwise use inbound.Port
		linkPort := port
		if addrPort.Port > 0 {
			linkPort = addrPort.Port
		}
		link := fmt.Sprintf("trojan://%s@%s:%d", password, addrPort.Address, linkPort)
		url, _ := url.Parse(link)
		q := url.Query()

		rowParams := shallowCopyStringMap(baseParams)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToParams(subHost, sn, rowParams)
		}

		for k, v := range rowParams {
			q.Add(k, v)
		}

		// Set the new query values on the URL
		url.RawQuery = q.Encode()

		url.Fragment = s.genShareLinkFragment(inbound, email, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort), addrPort.ServerDescription)

		if linkIndex > 0 {
			links += "\n"
		}
		links += url.String()
		linkIndex++
	}

	return links
}

func parseJSONMap(raw string) map[string]any {
	var m map[string]any
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	if err := json.Unmarshal([]byte(raw), &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func mapGetString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%.0f", t)
		}
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", t), "0"), ".")
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(v)
	}
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

// genShadowsocksLinkWithClient generates Shadowsocks link using ClientEntity data (new architecture)
func (s *SubService) genShadowsocksLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.Shadowsocks || client == nil {
		return ""
	}
	clientPass := strings.TrimSpace(s.passwordForSubLink(inbound, client))
	if clientPass == "" {
		return ""
	}

	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	stream := parseJSONMap(inbound.StreamSettings)
	settings := parseJSONMap(inbound.Settings)

	method := mapGetString(settings, "method")
	if method == "" {
		method = "aes-256-gcm"
	}
	inboundPassword := mapGetString(settings, "password")
	streamNetwork := mapGetString(stream, "network")
	if streamNetwork == "" {
		streamNetwork = "tcp"
	}
	params := make(map[string]string)
	params["type"] = streamNetwork

	switch streamNetwork {
	case "tcp":
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			params["path"] = path
			params["host"] = host
			params["headerType"] = "http"
		}
	case "kcp":
		if kcp, _ := stream["kcpSettings"].(map[string]any); kcp != nil {
			if header, _ := kcp["header"].(map[string]any); header != nil {
				params["headerType"] = mapGetString(header, "type")
			}
			params["seed"] = mapGetString(kcp, "seed")
		}
	case "ws":
		if ws, _ := stream["wsSettings"].(map[string]any); ws != nil {
			params["path"] = mapGetString(ws, "path")
			if host := mapGetString(ws, "host"); host != "" {
				params["host"] = host
			} else if headers, _ := ws["headers"].(map[string]any); headers != nil {
				params["host"] = searchHost(headers)
			}
		}
	case "grpc":
		if grpc, _ := stream["grpcSettings"].(map[string]any); grpc != nil {
			params["serviceName"] = mapGetString(grpc, "serviceName")
			params["authority"] = mapGetString(grpc, "authority")
			if jsonBool(grpc, "multiMode") {
				params["mode"] = "multi"
			}
		}
	case "httpupgrade":
		if httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any); httpupgrade != nil {
			params["path"] = mapGetString(httpupgrade, "path")
			if host := mapGetString(httpupgrade, "host"); host != "" {
				params["host"] = host
			} else if headers, _ := httpupgrade["headers"].(map[string]any); headers != nil {
				params["host"] = searchHost(headers)
			}
		}
	case "xhttp":
		if xhttp, _ := stream["xhttpSettings"].(map[string]any); xhttp != nil {
			params["path"] = mapGetString(xhttp, "path")
			if host := mapGetString(xhttp, "host"); host != "" {
				params["host"] = host
			} else if headers, _ := xhttp["headers"].(map[string]any); headers != nil {
				params["host"] = searchHost(headers)
			}
			params["mode"] = mapGetString(xhttp, "mode")
			applyXhttpPaddingParams(xhttp, params)
		}
	}

	security := mapGetString(stream, "security")
	if security == "tls" {
		params["security"] = "tls"
		if tlsSetting, _ := stream["tlsSettings"].(map[string]any); tlsSetting != nil {
			if alpns, _ := tlsSetting["alpn"].([]any); len(alpns) > 0 {
				var alpn []string
				for _, a := range alpns {
					if str, ok := a.(string); ok {
						alpn = append(alpn, str)
					}
				}
				if len(alpn) > 0 {
					params["alpn"] = strings.Join(alpn, ",")
				}
			}
			if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
				params["sni"], _ = sniValue.(string)
			}
			if tlsInnerRaw, ok := searchKey(tlsSetting, "settings"); ok {
				if innerMap, ok := tlsInnerRaw.(map[string]any); ok {
					if fpValue, ok := searchKey(innerMap, "fingerprint"); ok {
						params["fp"], _ = fpValue.(string)
					}
				}
			}
			finalizeTLSQueryParams(tlsSettingToAnyMap(tlsSetting), params)
		}
	}

	sn := streamNetwork
	if sn == "" {
		sn = "tcp"
	}
	baseParams := shallowCopyStringMap(params)

	encPart := fmt.Sprintf("%s:%s", method, clientPass)
	if strings.HasPrefix(method, "2022") {
		encPart = fmt.Sprintf("%s:%s:%s", method, inboundPassword, clientPass)
	}

	externalProxies, _ := stream["externalProxy"].([]any)

	links := ""
	linkIndex := 0

	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			if ep == nil {
				continue
			}
			newSecurity := mapGetString(ep, "forceTls")
			dest := mapGetString(ep, "dest")
			epPort := intFromAny(ep["port"])
			if dest == "" || epPort <= 0 {
				continue
			}
			link := fmt.Sprintf("ss://%s@%s:%d", base64.StdEncoding.EncodeToString([]byte(encPart)), dest, epPort)

			epParams := shallowCopyStringMap(baseParams)
			if subHost != nil {
				applyHostOverridesToParams(subHost, sn, epParams)
			}

			if newSecurity != "same" {
				epParams["security"] = newSecurity
			} else {
				epParams["security"] = security
			}
			u, err := url.Parse(link)
			if err != nil {
				continue
			}
			q := u.Query()
			for k, v := range epParams {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(k)) {
					q.Add(k, v)
				}
			}
			u.RawQuery = q.Encode()
			u.Fragment = s.genShareLinkFragmentWithClient(inbound, client, mapGetString(ep, "remark"), nil, "")

			if linkIndex > 0 {
				links += "\n"
			}
			links += u.String()
			linkIndex++
		}
		return links
	}

	for _, addrPort := range nodeAddresses {
		addr := strings.TrimSpace(addrPort.Address)
		if addr == "" {
			continue
		}
		linkPort := inbound.Port
		if addrPort.Port > 0 {
			linkPort = addrPort.Port
		}
		link := fmt.Sprintf("ss://%s@%s:%d", base64.StdEncoding.EncodeToString([]byte(encPart)), addr, linkPort)
		u, err := url.Parse(link)
		if err != nil {
			continue
		}
		q := u.Query()
		rowParams := shallowCopyStringMap(baseParams)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToParams(subHost, sn, rowParams)
		}
		for k, v := range rowParams {
			q.Add(k, v)
		}
		u.RawQuery = q.Encode()
		u.Fragment = s.genShareLinkFragmentWithClient(inbound, client, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort), addrPort.ServerDescription)

		if linkIndex > 0 {
			links += "\n"
		}
		links += u.String()
		linkIndex++
	}

	return links
}

func (s *SubService) genShadowsocksLink(inbound *model.Inbound, email string) string {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.Shadowsocks {
		return ""
	}

	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	stream := parseJSONMap(inbound.StreamSettings)
	clients, _ := s.inboundService.GetClients(inbound)

	settings := parseJSONMap(inbound.Settings)
	method := mapGetString(settings, "method")
	if method == "" {
		method = "aes-256-gcm"
	}
	inboundPassword := mapGetString(settings, "password")
	clientIndex := -1
	for i, client := range clients {
		if client.Email == email {
			clientIndex = i
			break
		}
	}
	if clientIndex < 0 {
		return ""
	}
	clientPass := strings.TrimSpace(clients[clientIndex].Password)
	if clientPass == "" {
		return ""
	}

	streamNetwork := mapGetString(stream, "network")
	if streamNetwork == "" {
		streamNetwork = "tcp"
	}
	params := make(map[string]string)
	params["type"] = streamNetwork

	switch streamNetwork {
	case "tcp":
		if path, host, httpOK := tcpHTTPPathHostForShareLink(stream); httpOK {
			params["path"] = path
			params["host"] = host
			params["headerType"] = "http"
		}
	case "kcp":
		if kcp, _ := stream["kcpSettings"].(map[string]any); kcp != nil {
			if header, _ := kcp["header"].(map[string]any); header != nil {
				params["headerType"] = mapGetString(header, "type")
			}
			params["seed"] = mapGetString(kcp, "seed")
		}
	case "ws":
		if ws, _ := stream["wsSettings"].(map[string]any); ws != nil {
			params["path"] = mapGetString(ws, "path")
			if host := mapGetString(ws, "host"); host != "" {
				params["host"] = host
			} else if headers, _ := ws["headers"].(map[string]any); headers != nil {
				params["host"] = searchHost(headers)
			}
		}
	case "grpc":
		if grpc, _ := stream["grpcSettings"].(map[string]any); grpc != nil {
			params["serviceName"] = mapGetString(grpc, "serviceName")
			params["authority"] = mapGetString(grpc, "authority")
			if jsonBool(grpc, "multiMode") {
				params["mode"] = "multi"
			}
		}
	case "httpupgrade":
		if httpupgrade, _ := stream["httpupgradeSettings"].(map[string]any); httpupgrade != nil {
			params["path"] = mapGetString(httpupgrade, "path")
			if host := mapGetString(httpupgrade, "host"); host != "" {
				params["host"] = host
			} else if headers, _ := httpupgrade["headers"].(map[string]any); headers != nil {
				params["host"] = searchHost(headers)
			}
		}
	case "xhttp":
		if xhttp, _ := stream["xhttpSettings"].(map[string]any); xhttp != nil {
			params["path"] = mapGetString(xhttp, "path")
			if host := mapGetString(xhttp, "host"); host != "" {
				params["host"] = host
			} else if headers, _ := xhttp["headers"].(map[string]any); headers != nil {
				params["host"] = searchHost(headers)
			}
			params["mode"] = mapGetString(xhttp, "mode")
			applyXhttpPaddingParams(xhttp, params)
		}
	}

	security := mapGetString(stream, "security")
	if security == "tls" {
		params["security"] = "tls"
		if tlsSetting, _ := stream["tlsSettings"].(map[string]any); tlsSetting != nil {
			if alpns, _ := tlsSetting["alpn"].([]any); len(alpns) > 0 {
				var alpn []string
				for _, a := range alpns {
					if str, ok := a.(string); ok {
						alpn = append(alpn, str)
					}
				}
				if len(alpn) > 0 {
					params["alpn"] = strings.Join(alpn, ",")
				}
			}
			if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
				params["sni"], _ = sniValue.(string)
			}
			if tlsInnerRaw, ok := searchKey(tlsSetting, "settings"); ok {
				if innerMap, ok := tlsInnerRaw.(map[string]any); ok {
					if fpValue, ok := searchKey(innerMap, "fingerprint"); ok {
						params["fp"], _ = fpValue.(string)
					}
				}
			}
			finalizeTLSQueryParams(tlsSettingToAnyMap(tlsSetting), params)
		}
	}

	sn := streamNetwork
	if sn == "" {
		sn = "tcp"
	}
	baseParams := shallowCopyStringMap(params)

	encPart := fmt.Sprintf("%s:%s", method, clientPass)
	if strings.HasPrefix(method, "2022") {
		encPart = fmt.Sprintf("%s:%s:%s", method, inboundPassword, clientPass)
	}

	externalProxies, _ := stream["externalProxy"].([]any)

	links := ""
	linkIndex := 0

	if len(externalProxies) > 0 {
		for _, externalProxy := range externalProxies {
			ep, _ := externalProxy.(map[string]any)
			if ep == nil {
				continue
			}
			newSecurity := mapGetString(ep, "forceTls")
			dest := mapGetString(ep, "dest")
			epPort := intFromAny(ep["port"])
			if dest == "" || epPort <= 0 {
				continue
			}
			link := fmt.Sprintf("ss://%s@%s:%d", base64.StdEncoding.EncodeToString([]byte(encPart)), dest, epPort)

			epParams := shallowCopyStringMap(baseParams)
			if subHost != nil {
				applyHostOverridesToParams(subHost, sn, epParams)
			}

			if newSecurity != "same" {
				epParams["security"] = newSecurity
			} else {
				epParams["security"] = security
			}
			u, err := url.Parse(link)
			if err != nil {
				continue
			}
			q := u.Query()
			for k, v := range epParams {
				if !(newSecurity == "none" && tlsQueryKeysStrippedForPlainSecurity(k)) {
					q.Add(k, v)
				}
			}
			u.RawQuery = q.Encode()
			u.Fragment = s.genShareLinkFragment(inbound, email, mapGetString(ep, "remark"), nil, "")

			if linkIndex > 0 {
				links += "\n"
			}
			links += u.String()
			linkIndex++
		}
		return links
	}

	for _, addrPort := range nodeAddresses {
		addr := strings.TrimSpace(addrPort.Address)
		if addr == "" {
			continue
		}
		linkPort := inbound.Port
		if addrPort.Port > 0 {
			linkPort = addrPort.Port
		}
		link := fmt.Sprintf("ss://%s@%s:%d", base64.StdEncoding.EncodeToString([]byte(encPart)), addr, linkPort)
		u, err := url.Parse(link)
		if err != nil {
			continue
		}
		q := u.Query()
		rowParams := shallowCopyStringMap(baseParams)
		if subHost != nil && addrPort.ApplyHostSubscriptionOverrides {
			applyHostOverridesToParams(subHost, sn, rowParams)
		}
		for k, v := range rowParams {
			q.Add(k, v)
		}
		u.RawQuery = q.Encode()
		u.Fragment = s.genShareLinkFragment(inbound, email, strings.TrimSpace(addrPort.RemarkSuffix), remarkTplFromAP(addrPort), addrPort.ServerDescription)

		if linkIndex > 0 {
			links += "\n"
		}
		links += u.String()
		linkIndex++
	}

	return links
}

// genHysteriaLink produces hysteria2:// (or v1) subscription URLs from inbound + client email.
func (s *SubService) genHysteriaLink(inbound *model.Inbound, email string) string {
	clients, _ := s.inboundService.GetClients(inbound)
	var auth string
	for _, c := range clients {
		if c.Email == email {
			auth = c.Password
			if c.Auth != "" {
				auth = c.Auth
			}
			break
		}
	}
	if auth == "" {
		return ""
	}
	return s.hysteriaLinkForAuth(inbound, email, auth)
}

// genHysteriaLinkWithClient is the new-architecture variant using ClientEntity.
func (s *SubService) genHysteriaLinkWithClient(inbound *model.Inbound, client *model.ClientEntity) string {
	if client == nil {
		return ""
	}
	auth := strings.TrimSpace(client.Password)
	if auth == "" && client.UUID != "" {
		auth = strings.TrimSpace(client.UUID)
	}
	if auth == "" {
		return ""
	}
	return s.hysteriaLinkForAuth(inbound, client.Name, auth)
}

func (s *SubService) hysteriaLinkForAuth(inbound *model.Inbound, email, auth string) string {
	if !model.IsHysteria(inbound.Protocol) || auth == "" {
		return ""
	}
	var stream map[string]interface{}
	json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	params := make(map[string]string)

	tlsSetting, _ := stream["tlsSettings"].(map[string]interface{})
	alpns, _ := tlsSetting["alpn"].([]interface{})
	var alpn []string
	for _, a := range alpns {
		if s, ok := a.(string); ok {
			alpn = append(alpn, s)
		}
	}
	if len(alpn) > 0 {
		params["alpn"] = strings.Join(alpn, ",")
	}
	if sniValue, ok := searchKey(tlsSetting, "serverName"); ok {
		params["sni"], _ = sniValue.(string)
	}

	tlsSettings, _ := searchKey(tlsSetting, "settings")
	if tlsSettings != nil {
		if fpValue, ok := searchKey(tlsSettings, "fingerprint"); ok {
			params["fp"], _ = fpValue.(string)
		}
	}

	finalizeHysteriaTLSParams(tlsSetting, params)

	if finalmask, ok := stream["finalmask"].(map[string]interface{}); ok {
		if udpMasks, ok := finalmask["udp"].([]interface{}); ok {
			for _, m := range udpMasks {
				mask, _ := m.(map[string]interface{})
				if mask == nil || mask["type"] != "salamander" {
					continue
				}
				settings, _ := mask["settings"].(map[string]interface{})
				if pw, ok := settings["password"].(string); ok && pw != "" {
					params["obfs"] = "salamander"
					params["obfs-password"] = pw
					break
				}
			}
		}
	}

	nodeAddresses, subHost := s.getAddressesForInbound(inbound)
	applyHostOverridesToHysteriaParams(subHost, params)

	var settings map[string]interface{}
	json.Unmarshal([]byte(inbound.Settings), &settings)
	version, _ := settings["version"].(float64)
	protocol := "hysteria2"
	if int(version) == 1 {
		protocol = "hysteria"
	}

	externalProxies, _ := stream["externalProxy"].([]interface{})
	if len(externalProxies) > 0 {
		links := make([]string, 0, len(externalProxies))
		for _, externalProxy := range externalProxies {
			ep, ok := externalProxy.(map[string]interface{})
			if !ok {
				continue
			}
			dest, _ := ep["dest"].(string)
			portF, okPort := ep["port"].(float64)
			if dest == "" || !okPort {
				continue
			}
			epRemark, _ := ep["remark"].(string)

			u := buildCredentialShareURL(protocol, auth, dest, int(portF))
			q := u.Query()
			for k, v := range params {
				q.Add(k, v)
			}
			u.RawQuery = q.Encode()
			u.Fragment = s.genShareLinkFragment(inbound, email, epRemark, nil, "")
			links = append(links, u.String())
		}
		return strings.Join(links, "\n")
	}

	// Multi-node aware: emit one link per node address (or the single
	// default address in non-multi-node mode). Mirrors genVlessLink so
	// hysteria/hysteria2 no longer hardcode s.address (panel host).
	links := make([]string, 0, len(nodeAddresses))
	for _, ap := range nodeAddresses {
		addr := strings.TrimSpace(ap.Address)
		if addr == "" {
			continue
		}
		linkPort := inbound.Port
		if ap.Port > 0 {
			linkPort = ap.Port
		}

		rowParams := shallowCopyStringMap(params)
		if subHost != nil && ap.ApplyHostSubscriptionOverrides {
			applyHostOverridesToHysteriaParams(subHost, rowParams)
		}

		u := buildCredentialShareURL(protocol, auth, addr, linkPort)
		q := u.Query()
		for k, v := range rowParams {
			q.Add(k, v)
		}
		u.RawQuery = q.Encode()
		u.Fragment = s.genShareLinkFragment(inbound, email, strings.TrimSpace(ap.RemarkSuffix), remarkTplFromAP(ap), ap.ServerDescription)
		links = append(links, u.String())
	}
	return strings.Join(links, "\n")
}

// splitRemarkModel splits the model string: first rune = separator, rest = ASCII order letters (i, e, o, n, p, r).
// Using runes for the first character so UTF-8 symbols (e.g. em dash) are not read as a raw byte.
func splitRemarkModel(model string) (separationChar string, orderChars string) {
	if model == "" {
		return "-", "ieo"
	}
	r := []rune(model)
	if len(r) < 1 {
		return "-", "ieo"
	}
	separationChar = string(r[0:1])
	if len(r) < 2 {
		return separationChar, ""
	}
	return separationChar, string(r[1:])
}

func (s *SubService) genRemark(inbound *model.Inbound, email string, extra string, tpl *RemarkTplNode) string {
	model := s.remarkModel
	if model == "" {
		model = "-ieo"
	}
	separationChar, orderChars := splitRemarkModel(model)

	var nodeName, nodeIP string
	if tpl != nil && (strings.TrimSpace(tpl.Name) != "" || strings.TrimSpace(tpl.DisplayHost) != "") {
		nodeName = strings.TrimSpace(tpl.Name)
		nodeIP = strings.TrimSpace(tpl.DisplayHost)
	} else {
		nodes, err := s.nodeService.GetNodesForInbound(inbound.Id)
		if err == nil && len(nodes) > 0 {
			node := nodes[0]
			nodeName = node.Name
			nodeIP = s.extractNodeHost(node.Address)
		}
	}

	orders := map[byte]string{
		'i': "",
		'e': "",
		'o': "",
		'n': "",
		'p': "",
		'r': "",
	}
	if len(email) > 0 {
		orders['e'] = email
	}
	if len(inbound.Remark) > 0 {
		orders['i'] = inbound.Remark
	}
	if len(extra) > 0 {
		orders['o'] = extra
	}
	if len(nodeName) > 0 {
		orders['n'] = nodeName
	}
	if len(nodeIP) > 0 {
		orders['p'] = nodeIP
	}
	orders['r'] = fmt.Sprintf("%d", inbound.Port)

	var remark []string
	for i := 0; i < len(orderChars); i++ {
		char := orderChars[i]
		order, exists := orders[char]
		if exists && order != "" {
			remark = append(remark, order)
		}
	}

	if s.showInfo {
		statsExist := false
		var stats xray.ClientTraffic
		for _, clientStat := range inbound.ClientStats {
			if clientStat.Email == email {
				stats = clientStat
				statsExist = true
				break
			}
		}

		// Get remained days
		if statsExist {
			if !stats.Enable {
				return fmt.Sprintf("⛔️N/A%s%s", separationChar, strings.Join(remark, separationChar))
			}
			if vol := stats.Total - (stats.Up + stats.Down); vol > 0 {
				remark = append(remark, fmt.Sprintf("%s%s", common.FormatTraffic(vol), "📊"))
			}
			now := time.Now().Unix()
			switch exp := stats.ExpiryTime / 1000; {
			case exp > 0:
				remainingSeconds := exp - now
				days := remainingSeconds / 86400
				hours := (remainingSeconds % 86400) / 3600
				minutes := (remainingSeconds % 3600) / 60
				if days > 0 {
					if hours > 0 {
						remark = append(remark, fmt.Sprintf("%dD,%dH⏳", days, hours))
					} else {
						remark = append(remark, fmt.Sprintf("%dD⏳", days))
					}
				} else if hours > 0 {
					remark = append(remark, fmt.Sprintf("%dH⏳", hours))
				} else {
					remark = append(remark, fmt.Sprintf("%dM⏳", minutes))
				}
			case exp < 0:
				days := exp / -86400
				hours := (exp % -86400) / 3600
				minutes := (exp % -3600) / 60
				if days > 0 {
					if hours > 0 {
						remark = append(remark, fmt.Sprintf("%dD,%dH⏳", days, hours))
					} else {
						remark = append(remark, fmt.Sprintf("%dD⏳", days))
					}
				} else if hours > 0 {
					remark = append(remark, fmt.Sprintf("%dH⏳", hours))
				} else {
					remark = append(remark, fmt.Sprintf("%dM⏳", minutes))
				}
			}
		}
	}
	return strings.Join(remark, separationChar)
}

func (s *SubService) genShareLinkFragment(inbound *model.Inbound, email, extra string, tpl *RemarkTplNode, serverDescription string) string {
	return FormatShareLinkFragment(s.genRemark(inbound, email, extra, tpl), serverDescription)
}

func (s *SubService) genShareLinkFragmentWithClient(inbound *model.Inbound, client *model.ClientEntity, extra string, tpl *RemarkTplNode, serverDescription string) string {
	return FormatShareLinkFragment(s.genRemarkWithClient(inbound, client, extra, tpl), serverDescription)
}

// genRemarkWithClient generates remark for ClientEntity, checking Enable and Status
func (s *SubService) genRemarkWithClient(inbound *model.Inbound, client *model.ClientEntity, extra string, tpl *RemarkTplNode) string {
	model := s.remarkModel
	if model == "" {
		model = "-ieo"
	}
	separationChar, orderChars := splitRemarkModel(model)

	var nodeName, nodeIP string
	if tpl != nil && (strings.TrimSpace(tpl.Name) != "" || strings.TrimSpace(tpl.DisplayHost) != "") {
		nodeName = strings.TrimSpace(tpl.Name)
		nodeIP = strings.TrimSpace(tpl.DisplayHost)
	} else {
		nodes, err := s.nodeService.GetNodesForInbound(inbound.Id)
		if err == nil && len(nodes) > 0 {
			node := nodes[0]
			nodeName = node.Name
			nodeIP = s.extractNodeHost(node.Address)
		}
	}

	orders := map[byte]string{
		'i': "",
		'e': "",
		'o': "",
		'n': "",
		'p': "",
		'r': "",
	}
	if len(client.Name) > 0 {
		orders['e'] = client.Name
	}
	if len(inbound.Remark) > 0 {
		orders['i'] = inbound.Remark
	}
	if len(extra) > 0 {
		orders['o'] = extra
	}
	if len(nodeName) > 0 {
		orders['n'] = nodeName
	}
	if len(nodeIP) > 0 {
		orders['p'] = nodeIP
	}
	orders['r'] = fmt.Sprintf("%d", inbound.Port)

	var remark []string
	for i := 0; i < len(orderChars); i++ {
		char := orderChars[i]
		order, exists := orders[char]
		if exists && order != "" {
			remark = append(remark, order)
		}
	}

	// Check if client is disabled or expired - add brick emoji
	if !client.Enable || client.Status == "expired_traffic" || client.Status == "expired_time" {
		return fmt.Sprintf("🚫%s%s", separationChar, strings.Join(remark, separationChar))
	}

	if s.showInfo {
		// Get remained traffic
		if client.TotalGB > 0 {
			totalBytes := int64(client.TotalGB * 1024 * 1024 * 1024)
			usedBytes := client.Up + client.Down
			if vol := totalBytes - usedBytes; vol > 0 {
				remark = append(remark, fmt.Sprintf("%s%s", common.FormatTraffic(vol), "📊"))
			}
		}
		// Get remained days
		now := time.Now().Unix()
		switch exp := client.ExpiryTime / 1000; {
		case exp > 0:
			remainingSeconds := exp - now
			days := remainingSeconds / 86400
			hours := (remainingSeconds % 86400) / 3600
			minutes := (remainingSeconds % 3600) / 60
			if days > 0 {
				if hours > 0 {
					remark = append(remark, fmt.Sprintf("%dD,%dH⏳", days, hours))
				} else {
					remark = append(remark, fmt.Sprintf("%dD⏳", days))
				}
			} else if hours > 0 {
				remark = append(remark, fmt.Sprintf("%dH⏳", hours))
			} else {
				remark = append(remark, fmt.Sprintf("%dM⏳", minutes))
			}
		case exp < 0:
			days := exp / -86400
			hours := (exp % -86400) / 3600
			minutes := (exp % -3600) / 60
			if days > 0 {
				if hours > 0 {
					remark = append(remark, fmt.Sprintf("%dD,%dH⏳", days, hours))
				} else {
					remark = append(remark, fmt.Sprintf("%dD⏳", days))
				}
			} else if hours > 0 {
				remark = append(remark, fmt.Sprintf("%dH⏳", hours))
			} else {
				remark = append(remark, fmt.Sprintf("%dM⏳", minutes))
			}
		}
	}
	return strings.Join(remark, separationChar)
}

func searchKey(data any, key string) (any, bool) {
	switch val := data.(type) {
	case map[string]any:
		for k, v := range val {
			if k == key {
				return v, true
			}
			if result, ok := searchKey(v, key); ok {
				return result, true
			}
		}
	case []any:
		for _, v := range val {
			if result, ok := searchKey(v, key); ok {
				return result, true
			}
		}
	}
	return nil, false
}

func jsonBool(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	b, ok := v.(bool)
	return ok && b
}

// tcpHTTPPathHostForShareLink parses tcpSettings fake-http path and Host for vmess/vless/trojan/ss links.
func tcpHTTPPathHostForShareLink(stream map[string]any) (path, host string, ok bool) {
	if stream == nil {
		return "", "", false
	}
	tcp, _ := stream["tcpSettings"].(map[string]any)
	if tcp == nil {
		return "", "", false
	}
	header, _ := tcp["header"].(map[string]any)
	if header == nil {
		return "", "", false
	}
	typeStr, _ := header["type"].(string)
	if typeStr != "http" {
		return "", "", false
	}
	request, _ := header["request"].(map[string]any)
	if request == nil {
		return "", "", false
	}
	requestPath, _ := request["path"].([]any)
	if len(requestPath) == 0 {
		return "", "", false
	}
	p, pOK := requestPath[0].(string)
	if !pOK {
		return "", "", false
	}
	headers, _ := request["headers"].(map[string]any)
	return p, searchHost(headers), true
}

func searchHost(headers any) string {
	data, _ := headers.(map[string]any)
	for k, v := range data {
		if strings.EqualFold(k, "host") {
			switch v.(type) {
			case []any:
				hosts, _ := v.([]any)
				if len(hosts) > 0 {
					return hosts[0].(string)
				} else {
					return ""
				}
			case any:
				return v.(string)
			}
		}
	}

	return ""
}

// PageData is a view model for subpage.html
// PageData contains data for rendering the subscription information page.
type PageData struct {
	Host                 string
	BasePath             string
	SId                  string
	Download             string
	Upload               string
	Total                string
	Used                 string
	Remained             string
	Expire               int64
	LastOnline           int64
	Datepicker           string
	DownloadByte         int64
	UploadByte           int64
	TotalByte            int64
	SubUrl               string
	SubJsonUrl           string
	Result               []string
	HappEncryptedUrl     string // Encrypted URL for Happ app (happ://crypt4/...)
	V2RayTunEncryptedUrl string // Encrypted URL for V2RayTun app (v2raytun://crypt/...)
	Theme                string // Subscription page theme
	LogoUrl              string // Logo URL for subscription page
	BrandText            string // Brand text for subscription page
	BackgroundUrl        string // Background image URL for subscription card
}

// ResolveRequest extracts scheme and host info from request/headers consistently.
// ResolveRequest extracts scheme, host, and header information from an HTTP request.
func (s *SubService) ResolveRequest(c *gin.Context) (scheme string, host string, hostWithPort string, hostHeader string) {
	// scheme
	scheme = "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}

	// base host (no port)
	if h, err := getHostFromXFH(c.GetHeader("X-Forwarded-Host")); err == nil && h != "" {
		host = h
	}
	if host == "" {
		host = c.GetHeader("X-Real-IP")
	}
	if host == "" {
		var err error
		host, _, err = net.SplitHostPort(c.Request.Host)
		if err != nil {
			host = c.Request.Host
		}
	}

	// host:port for URLs
	hostWithPort = c.GetHeader("X-Forwarded-Host")
	if hostWithPort == "" {
		hostWithPort = c.Request.Host
	}
	if hostWithPort == "" {
		hostWithPort = host
	}

	// header display host
	hostHeader = c.GetHeader("X-Forwarded-Host")
	if hostHeader == "" {
		hostHeader = c.GetHeader("X-Real-IP")
	}
	if hostHeader == "" {
		hostHeader = host
	}
	return
}

// BuildURLs constructs absolute subscription and JSON subscription URLs for a given subscription ID.
// It prioritizes configured URIs, then individual settings, and finally falls back to request-derived components.
func (s *SubService) BuildURLs(scheme, hostWithPort, subPath, subJsonPath, subId string) (subURL, subJsonURL string) {
	// Input validation
	if subId == "" {
		return "", ""
	}

	// Get configured URIs first (highest priority)
	configuredSubURI, _ := s.settingService.GetSubURI()
	configuredSubJsonURI, _ := s.settingService.GetSubJsonURI()

	// Determine base scheme and host (cached to avoid duplicate calls)
	var baseScheme, baseHostWithPort string
	if configuredSubURI == "" || configuredSubJsonURI == "" {
		baseScheme, baseHostWithPort = s.getBaseSchemeAndHost(scheme, hostWithPort)
	}

	// Build subscription URL
	subURL = s.buildSingleURL(configuredSubURI, baseScheme, baseHostWithPort, subPath, subId)

	// Build JSON subscription URL
	subJsonURL = s.buildSingleURL(configuredSubJsonURI, baseScheme, baseHostWithPort, subJsonPath, subId)

	return subURL, subJsonURL
}

// getBaseSchemeAndHost determines the base scheme and host from settings or falls back to request values
func (s *SubService) getBaseSchemeAndHost(requestScheme, requestHostWithPort string) (string, string) {
	subDomain, err := s.settingService.GetSubDomain()
	if err != nil || subDomain == "" {
		return requestScheme, requestHostWithPort
	}

	// Get port and TLS settings
	subPort, _ := s.settingService.GetSubPort()
	subKeyFile, _ := s.settingService.GetSubKeyFile()
	subCertFile, _ := s.settingService.GetSubCertFile()

	// Determine scheme from TLS configuration
	scheme := "http"
	if subKeyFile != "" && subCertFile != "" {
		scheme = "https"
	}

	// Build host:port, always include port for clarity
	hostWithPort := fmt.Sprintf("%s:%d", subDomain, subPort)

	return scheme, hostWithPort
}

// buildSingleURL constructs a single URL using configured URI or base components
func (s *SubService) buildSingleURL(configuredURI, baseScheme, baseHostWithPort, basePath, subId string) string {
	if configuredURI != "" {
		return s.joinPathWithID(configuredURI, subId)
	}

	baseURL := fmt.Sprintf("%s://%s", baseScheme, baseHostWithPort)
	return s.joinPathWithID(baseURL+basePath, subId)
}

// joinPathWithID safely joins a base path with a subscription ID
func (s *SubService) joinPathWithID(basePath, subId string) string {
	subURL := ""
	if strings.HasSuffix(basePath, "/") {
		subURL = basePath + subId
	} else {
		subURL = basePath + "/" + subId
	}

	// Add Provider ID to URL if configured and method is "url" (for Happ extended headers)
	providerID, err := s.settingService.GetSubProviderID()
	if err == nil && providerID != "" {
		providerMethod, err := s.settingService.GetSubProviderIDMethod()
		if err == nil && providerMethod == "url" {
			// Add Provider ID as query parameter (according to Happ documentation: providerid)
			if strings.Contains(subURL, "?") {
				subURL += "&providerid=" + url.QueryEscape(providerID)
			} else {
				subURL += "?providerid=" + url.QueryEscape(providerID)
			}
		}
	}

	return subURL
}

// BuildPageData parses header and prepares the template view model.
// BuildPageData constructs page data for rendering the subscription information page.
func (s *SubService) BuildPageData(subId string, hostHeader string, traffic xray.ClientTraffic, lastOnline int64, subs []string, subURL, subJsonURL string, basePath string) PageData {
	download := common.FormatTraffic(traffic.Down)
	upload := common.FormatTraffic(traffic.Up)
	total := "∞"
	used := common.FormatTraffic(traffic.Up + traffic.Down)
	remained := ""
	if traffic.Total > 0 {
		total = common.FormatTraffic(traffic.Total)
		left := max(traffic.Total-(traffic.Up+traffic.Down), 0)
		remained = common.FormatTraffic(left)
	}

	datepicker := s.datepicker
	if datepicker == "" {
		datepicker = "gregorian"
	}

	// Always compute encrypted subscription URLs. The public page decides per
	// button whether to use them via the `useEncrypted` flag in AddToApp.
	var happEncryptedUrl, v2raytunEncryptedUrl string
	if happEncrypted, err := crypto.EncryptForHapp(subURL); err == nil {
		happEncryptedUrl = "happ://crypt4/" + happEncrypted
	} else {
		logger.Warningf("Failed to encrypt subscription URL for Happ: %v", err)
	}
	if v2raytunEncrypted, err := crypto.EncryptForV2RayTun(subURL); err == nil {
		v2raytunEncryptedUrl = "v2raytun://crypt/" + v2raytunEncrypted
	} else {
		logger.Warningf("Failed to encrypt subscription URL for V2RayTun: %v", err)
	}

	// Get subscription page customization settings
	theme, _ := s.settingService.GetSubPageTheme()
	logoUrl, _ := s.settingService.GetSubPageLogoUrl()
	brandText, _ := s.settingService.GetSubPageBrandText()

	return PageData{
		Host:                 hostHeader,
		BasePath:             basePath,
		SId:                  subId,
		Download:             download,
		Upload:               upload,
		Total:                total,
		Used:                 used,
		Remained:             remained,
		Expire:               traffic.ExpiryTime / 1000,
		LastOnline:           lastOnline,
		Datepicker:           datepicker,
		DownloadByte:         traffic.Down,
		UploadByte:           traffic.Up,
		TotalByte:            traffic.Total,
		SubUrl:               subURL,
		SubJsonUrl:           subJsonURL,
		Result:               subs,
		HappEncryptedUrl:     happEncryptedUrl,
		V2RayTunEncryptedUrl: v2raytunEncryptedUrl,
		Theme:                theme,
		LogoUrl:              logoUrl,
		BrandText:            brandText,
	}
}

func getHostFromXFH(s string) (string, error) {
	if strings.Contains(s, ":") {
		realHost, _, err := net.SplitHostPort(s)
		if err != nil {
			return "", err
		}
		return realHost, nil
	}
	return s, nil
}

// extractNodeHost extracts the host from a node API address.
// Example: "http://192.168.1.100:8080" -> "192.168.1.100"
func (s *SubService) extractNodeHost(nodeAddress string) string {
	// Remove protocol prefix
	address := strings.TrimPrefix(nodeAddress, "http://")
	address = strings.TrimPrefix(address, "https://")

	// Extract host (remove port if present)
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		// No port, return as is
		return address
	}
	return host
}

// registerHWIDFromRequest registers HWID from HTTP headers in the request context.
// This method reads HWID and device metadata from headers and calls RegisterHWIDFromHeaders.
// Returns error if HWID limit is exceeded (should block subscription).
func (s *SubService) registerHWIDFromRequest(c *gin.Context, clientEntity *model.ClientEntity) error {
	logger.Debugf("registerHWIDFromRequest called for client %d (subId: %s, email: %s, hwidEnabled: %v)",
		clientEntity.Id, clientEntity.SubID, clientEntity.Name, clientEntity.HWIDEnabled)

	// Check HWID mode - only register in client_header mode
	settingService := service.SettingService{}
	hwidMode, err := settingService.GetHwidMode()
	if err != nil {
		logger.Debugf("Failed to get hwidMode setting: %v", err)
		return nil
	}
	logger.Debugf("Current hwidMode: %s", hwidMode)

	// Only register in client_header mode
	if hwidMode != "client_header" {
		logger.Debugf("HWID registration skipped: hwidMode is '%s' (not 'client_header') for client %d (subId: %s)",
			hwidMode, clientEntity.Id, clientEntity.SubID)
		return nil
	}

	// Check if client has HWID tracking enabled
	if !clientEntity.HWIDEnabled {
		logger.Debugf("HWID registration skipped: HWID tracking disabled for client %d (subId: %s, email: %s)",
			clientEntity.Id, clientEntity.SubID, clientEntity.Name)
		return nil
	}

	// Read HWID from headers (required)
	hwid := c.GetHeader("x-hwid")
	if hwid == "" {
		// Try alternative header name (case-insensitive)
		hwid = c.GetHeader("X-HWID")
	}
	if hwid == "" {
		// No HWID header - mark as "unknown" device, don't register
		// In client_header mode, we don't auto-generate HWID
		logger.Debugf("No x-hwid header provided for client %d (subId: %s, email: %s) - HWID not registered",
			clientEntity.Id, clientEntity.SubID, clientEntity.Name)
		return nil
	}

	// Read device metadata from headers (optional)
	deviceOS := c.GetHeader("x-device-os")
	if deviceOS == "" {
		deviceOS = c.GetHeader("X-Device-OS")
	}
	deviceModel := c.GetHeader("x-device-model")
	if deviceModel == "" {
		deviceModel = c.GetHeader("X-Device-Model")
	}
	osVersion := c.GetHeader("x-ver-os")
	if osVersion == "" {
		osVersion = c.GetHeader("X-Ver-OS")
	}
	userAgent := c.GetHeader("User-Agent")
	ipAddress := c.ClientIP()

	// Register HWID
	hwidService := service.ClientHWIDService{}
	hwidRecord, err := hwidService.RegisterHWIDFromHeaders(clientEntity.Id, hwid, deviceOS, deviceModel, osVersion, ipAddress, userAgent)
	if err != nil {
		if errors.Is(err, service.ErrHWIDAdminBlocked) {
			logger.Errorf("HWID blocked for client %d (subId: %s, email: %s): %v - BLOCKING subscription",
				clientEntity.Id, clientEntity.SubID, clientEntity.Name, err)
			return fmt.Errorf("HWID limit exceeded: %w", err)
		}
		// Check if error is HWID limit exceeded
		if strings.Contains(err.Error(), "HWID limit exceeded") {
			// Log as error - this should block subscription access
			logger.Errorf("HWID limit exceeded for client %d (subId: %s, email: %s): %v - BLOCKING subscription",
				clientEntity.Id, clientEntity.SubID, clientEntity.Name, err)
			// Return error to block subscription - this will prevent the subscription from being returned
			// The calling function should handle this error and return appropriate response to client
			return fmt.Errorf("HWID limit exceeded: %w", err)
		} else {
			// Other errors - log as warning but don't fail subscription (HWID registration is optional)
			logger.Warningf("Failed to register HWID for client %d (subId: %s): %v", clientEntity.Id, clientEntity.SubID, err)
		}
		// For non-limit errors, HWID registration failure should not block subscription access
		// The subscription will still be returned, but HWID won't be registered
	} else if hwidRecord != nil {
		// Successfully registered HWID
		logger.Debugf("Successfully registered HWID for client %d (subId: %s, email: %s, hwid: %s, hwidId: %d)",
			clientEntity.Id, clientEntity.SubID, clientEntity.Name, hwid, hwidRecord.Id)
	}
	return nil
}
