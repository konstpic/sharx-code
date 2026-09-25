// Package service provides Client traffic management service.
package service

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/xray"

	"gorm.io/gorm"
)

// bpsPair holds last computed upload/download speeds (bits per second) for panel display.
// Speed is derived in AddClientTraffic and is not stored in the database (ClientEntity gorm:"-").
type bpsPair struct {
	up   int64
	down int64
}

var (
	// panelLiveSpeed is the latest per-client speeds from the traffic collector (replaced each tick).
	// Merged into HTTP list/get and WebSocket client payloads so the Speed column is not always empty.
	panelLiveSpeedMu     sync.RWMutex
	panelLiveSpeed       map[int]bpsPair
	panelLastNodeMu      sync.RWMutex
	panelLastNodeByEmail map[string]string

	hysteriaInboundCumulativeMap = make(map[string]struct {
		up   int64
		down int64
	})
	hysteriaInboundCumulativeMu sync.Mutex
)

func setPanelClientLastConnectedNodes(m map[string]string) {
	panelLastNodeMu.Lock()
	defer panelLastNodeMu.Unlock()
	if len(m) == 0 {
		panelLastNodeByEmail = nil
		return
	}
	panelLastNodeByEmail = make(map[string]string, len(m))
	for email, nodeName := range m {
		k := strings.ToLower(strings.TrimSpace(email))
		v := strings.TrimSpace(nodeName)
		if k == "" || v == "" {
			continue
		}
		panelLastNodeByEmail[k] = v
	}
}

func panelClientLastConnectedNode(email string) (string, bool) {
	k := strings.ToLower(strings.TrimSpace(email))
	if k == "" {
		return "", false
	}
	panelLastNodeMu.RLock()
	defer panelLastNodeMu.RUnlock()
	if panelLastNodeByEmail == nil {
		return "", false
	}
	v, ok := panelLastNodeByEmail[k]
	return v, ok
}

func MergePanelClientLastConnectedNodeInto(c *model.ClientEntity) {
	if c == nil {
		return
	}
	if nodeName, ok := panelClientLastConnectedNode(c.Name); ok {
		c.LastConnectedNode = nodeName
	}
}

func setPanelClientLiveSpeeds(m map[int]bpsPair) {
	panelLiveSpeedMu.Lock()
	defer panelLiveSpeedMu.Unlock()
	if len(m) == 0 {
		panelLiveSpeed = nil
		return
	}
	panelLiveSpeed = make(map[int]bpsPair, len(m))
	for id, v := range m {
		panelLiveSpeed[id] = v
	}
}

// RefreshPanelClientLiveSpeeds recomputes the live speeds from the sliding window so that
// values decay while no new traffic ticks arrive. Call before merging speeds into a broadcast.
func RefreshPanelClientLiveSpeeds() {
	setPanelClientLiveSpeeds(liveSpeedTracker.snapshot(time.Now().UnixMilli()))
}

func panelClientLiveSpeedFor(clientID int) (up, down int64, ok bool) {
	panelLiveSpeedMu.RLock()
	defer panelLiveSpeedMu.RUnlock()
	if panelLiveSpeed == nil {
		return 0, 0, false
	}
	v, ok := panelLiveSpeed[clientID]
	if !ok {
		return 0, 0, false
	}
	return v.up, v.down, true
}

// MergePanelClientLiveSpeedInto overlays last computed traffic speeds (bps) from the stats collector
// into the client struct for API/WebSocket responses. Speed is not persisted in the database.
func MergePanelClientLiveSpeedInto(c *model.ClientEntity) {
	if c == nil {
		return
	}
	if up, down, ok := panelClientLiveSpeedFor(c.Id); ok {
		c.UpSpeed = up
		c.DownSpeed = down
	}
}

// AddClientTraffic updates client traffic statistics and returns clients that need to be disabled.
// This method handles traffic tracking for clients in the new architecture (ClientEntity).
// After updating client traffic, it synchronizes inbound traffic as the sum of all its clients' traffic.
// saveClientTrafficFields writes back only the columns the traffic accounting changes. It must not save whole rows: the
// clients were loaded at the start of the tick, and a full save would overwrite anything an admin changed since (HWID
// and IP limits, expiry, comment, group ...) with the stale copy. status is written only when statusBefore says this
// tick changed it (nil = never).
func saveClientTrafficFields(tx *gorm.DB, clients []*model.ClientEntity, statusBefore map[int]string) error {
	for _, c := range clients {
		if c == nil || c.Id == 0 {
			continue
		}
		upd := map[string]any{"up": c.Up, "down": c.Down, "all_time": c.AllTime, "last_online": c.LastOnline}
		if statusBefore != nil {
			if before, ok := statusBefore[c.Id]; !ok || before != c.Status {
				upd["status"] = c.Status
			}
		}
		if err := tx.Model(&model.ClientEntity{}).Where("id = ?", c.Id).Updates(upd).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *ClientService) AddClientTraffic(tx *gorm.DB, traffics []*xray.ClientTraffic, _ *InboundService) (map[string]string, map[int]bool, error) {
	clientsToDisable := make(map[string]string) // map[email]tag
	affectedInboundIds := make(map[int]bool)    // Track affected inbounds for traffic sync

	// No per-user rows this tick: treat as nobody had traffic (same idea as node stats, where
	// online is derived from positive deltas). Clear the panel list so clients do not stay
	// "online" forever after disconnect; the UI debounces brief gaps via OFFLINE_STATUS_DELAY.
	if len(traffics) == 0 {
		setPanelOnlineClients(nil)
		setPanelClientLiveSpeeds(liveSpeedTracker.snapshot(time.Now().UnixMilli()))
		return clientsToDisable, affectedInboundIds, nil
	}

	onlineSet := make(map[string]struct{})
	onlineList := make([]string, 0)
	addOnline := func(email string) {
		email = strings.TrimSpace(email)
		if email == "" {
			return
		}
		k := strings.ToLower(email)
		if _, ok := onlineSet[k]; ok {
			return
		}
		onlineSet[k] = struct{}{}
		onlineList = append(onlineList, email)
	}

	// Group traffic by email (aggregate traffic from all inbounds for each client)
	emailTrafficMap := make(map[string]struct {
		Up         int64
		Down       int64
		InboundIds []int
	})

	traffics = s.remapWireGuardStatEmailsToClientNames(traffics)

	for _, traffic := range traffics {
		email := strings.ToLower(traffic.Email)
		existing := emailTrafficMap[email]
		existing.Up += traffic.Up
		existing.Down += traffic.Down
		// Track all inbound IDs for this email
		if traffic.InboundId > 0 {
			found := false
			for _, id := range existing.InboundIds {
				if id == traffic.InboundId {
					found = true
					break
				}
			}
			if !found {
				existing.InboundIds = append(existing.InboundIds, traffic.InboundId)
				affectedInboundIds[traffic.InboundId] = true
			}
		}
		emailTrafficMap[email] = existing
	}

	// Get all unique emails
	emails := make([]string, 0, len(emailTrafficMap))
	for email := range emailTrafficMap {
		emails = append(emails, email)
	}

	if len(emails) == 0 {
		return clientsToDisable, affectedInboundIds, nil
	}

	// Load ClientEntity records for these emails
	var clientEntities []*model.ClientEntity
	err := tx.Model(&model.ClientEntity{}).Where("LOWER(name) IN (?)", emails).Find(&clientEntities).Error
	if err != nil {
		return nil, nil, err
	}
	// Hysteria(2) in some Xray builds may report user traffic key by client secret instead of email.
	// Re-map unmatched stat identifiers to real clients by password/uuid, then continue as usual.
	if len(clientEntities) < len(emailTrafficMap) {
		foundByEmail := make(map[string]struct{}, len(clientEntities))
		for _, c := range clientEntities {
			foundByEmail[strings.ToLower(strings.TrimSpace(c.Name))] = struct{}{}
		}
		unmatched := make([]string, 0)
		for k := range emailTrafficMap {
			if _, ok := foundByEmail[k]; !ok && strings.TrimSpace(k) != "" {
				unmatched = append(unmatched, k)
			}
		}
		if len(unmatched) > 0 {
			var fallbackClients []*model.ClientEntity
			if ferr := tx.Model(&model.ClientEntity{}).
				Where("LOWER(password) IN (?) OR LOWER(uuid) IN (?)", unmatched, unmatched).
				Find(&fallbackClients).Error; ferr == nil {
				matchedClientIDs := make(map[int]struct{})
				for _, c := range clientEntities {
					matchedClientIDs[c.Id] = struct{}{}
				}
				for _, c := range fallbackClients {
					// Prefer password mapping for hysteria/trojan/ss, then uuid for vmess/vless.
					sourceKey := ""
					passKey := strings.ToLower(strings.TrimSpace(c.Password))
					if passKey != "" {
						if _, ok := emailTrafficMap[passKey]; ok {
							sourceKey = passKey
						}
					}
					if sourceKey == "" {
						uuidKey := strings.ToLower(strings.TrimSpace(c.UUID))
						if uuidKey != "" {
							if _, ok := emailTrafficMap[uuidKey]; ok {
								sourceKey = uuidKey
							}
						}
					}
					if sourceKey == "" {
						continue
					}
					targetKey := strings.ToLower(strings.TrimSpace(c.Name))
					if targetKey == "" || targetKey == sourceKey {
						continue
					}
					src := emailTrafficMap[sourceKey]
					dst := emailTrafficMap[targetKey]
					if dst.InboundIds == nil {
						dst.InboundIds = make([]int, 0)
					}
					dst.Up += src.Up
					dst.Down += src.Down
					for _, id := range src.InboundIds {
						exists := false
						for _, e := range dst.InboundIds {
							if e == id {
								exists = true
								break
							}
						}
						if !exists {
							dst.InboundIds = append(dst.InboundIds, id)
						}
					}
					emailTrafficMap[targetKey] = dst
					delete(emailTrafficMap, sourceKey)
					if _, ok := matchedClientIDs[c.Id]; !ok {
						clientEntities = append(clientEntities, c)
						matchedClientIDs[c.Id] = struct{}{}
					}
				}
			}
		}
	}

	// Get inbound tags for clients that need to be disabled
	inboundIdMap := make(map[int]string) // map[inboundId]tag
	if len(affectedInboundIds) > 0 {
		inboundIdList := make([]int, 0, len(affectedInboundIds))
		for id := range affectedInboundIds {
			inboundIdList = append(inboundIdList, id)
		}
		var inbounds []*model.Inbound
		err = tx.Model(model.Inbound{}).Where("id IN (?)", inboundIdList).Find(&inbounds).Error
		if err == nil {
			for _, inbound := range inbounds {
				inboundIdMap[inbound.Id] = inbound.Tag
			}
		}
	}

	now := time.Now().Unix() * 1000

	speedNow := time.Now().UnixMilli()
	speedFrom := liveSpeedTracker.startTick(speedNow)

	// Update traffic for each client
	// Statuses as loaded: only a status this tick changed may be written back (see saveClientTrafficFields).
	statusBefore := make(map[int]string, len(clientEntities))
	for _, c := range clientEntities {
		statusBefore[c.Id] = c.Status
	}
	for _, client := range clientEntities {
		email := strings.ToLower(client.Name)
		trafficData, ok := emailTrafficMap[email]
		if !ok {
			continue
		}

		// Check limits BEFORE adding traffic
		currentUsed := client.Up + client.Down
		newUp := trafficData.Up
		newDown := trafficData.Down
		newTotal := newUp + newDown

		// Check if time is already expired
		timeExpired := client.ExpiryTime > 0 && client.ExpiryTime <= now

		// Check if adding this traffic would exceed the limit
		trafficLimit := int64(client.TotalGB * 1024 * 1024 * 1024)
		if client.TotalGB > 0 && trafficLimit > 0 {
			remaining := trafficLimit - currentUsed
			if remaining <= 0 {
				// Already exceeded, don't add any traffic
				newUp = 0
				newDown = 0
				newTotal = 0
			} else if newTotal > remaining {
				// Would exceed, add only up to the limit
				allowedTraffic := remaining
				// Proportionally distribute allowed traffic between up and down
				if newTotal > 0 {
					ratio := float64(allowedTraffic) / float64(newTotal)
					newUp = int64(float64(newUp) * ratio)
					newDown = int64(float64(newDown) * ratio)
					newTotal = allowedTraffic
				} else {
					newUp = 0
					newDown = 0
					newTotal = 0
				}
			}
		}

		// Add traffic (may be reduced if limit would be exceeded)
		// Note: ClientTraffic.Up = uplink (server→client) = Download for client
		//       ClientTraffic.Down = downlink (client→server) = Upload for client
		// So we swap them when saving to ClientEntity to match client perspective
		// IMPORTANT: All traffic values are in BYTES (not KB, MB, GB)
		// Xray API returns traffic in bytes, and we store it directly in bytes
		if newTotal > 0 {
			// Log traffic values to debug unit issues
			// If these values seem too small (e.g., 1024 bytes for 1MB transfer),
			// it means traffic is being divided somewhere
			// Check if traffic values are suspiciously small (might be in KB instead of bytes)
			if trafficData.Up > 0 || trafficData.Down > 0 {
				logger.Debugf("AddClientTraffic: client %s - incoming Up: %d, Down: %d, Total: %d | "+
					"adding Up: %d, Down: %d | current total: %d bytes (Up: %.2f MB, Down: %.2f MB)",
					client.Name, trafficData.Up, trafficData.Down, newTotal, newDown, newUp, client.Up+client.Down,
					float64(client.Up)/(1024*1024), float64(client.Down)/(1024*1024))
			}
		}
		// Client upload = xray downlink delta (newDown), client download = uplink delta (newUp).
		liveSpeedTracker.observe(client.Id, speedFrom, speedNow, newDown, newUp)

		client.Up += newDown // Upload (client→server) goes to Up
		client.Down += newUp // Download (server→client) goes to Down
		client.AllTime += newTotal

		// Check final state after adding traffic
		finalUsed := client.Up + client.Down
		finalTrafficExceeded := client.TotalGB > 0 && finalUsed >= trafficLimit

		// Mark client with expired status if limit exceeded or time expired
		if (finalTrafficExceeded || timeExpired) && client.Enable {
			oldClientForNotify := *client
			// Update status if not already set or if reason changed
			shouldUpdateStatus := false
			if finalTrafficExceeded && client.Status != "expired_traffic" {
				client.Status = "expired_traffic"
				shouldUpdateStatus = true
			} else if timeExpired && client.Status != "expired_time" {
				client.Status = "expired_time"
				shouldUpdateStatus = true
			}

			// Only add to disable list if status was just set (not already expired)
			// This prevents repeated attempts to remove already-removed clients
			if shouldUpdateStatus {
				// Mark for removal from Xray API - get all inbound IDs for this client
				clientInboundIds, err := s.GetInboundIdsForClient(client.Id)
				if err == nil && len(clientInboundIds) > 0 {
					// Try to find tag from inboundIdMap first (from traffic data)
					found := false
					for _, inboundId := range clientInboundIds {
						if tag, ok := inboundIdMap[inboundId]; ok {
							clientsToDisable[client.Name] = tag
							found = true
							break
						}
					}
					// If not found in map, query database for tag
					if !found {
						var inbound model.Inbound
						if err := tx.Model(&model.Inbound{}).Where("id = ?", clientInboundIds[0]).First(&inbound).Error; err == nil {
							clientsToDisable[client.Name] = inbound.Tag
						}
					}
				}

				logger.Infof("Client %s marked with status %s: trafficExceeded=%v, timeExpired=%v, currentUsed=%d, newTraffic=%d, finalUsed=%d, total=%d",
					client.Name, client.Status, finalTrafficExceeded, timeExpired, currentUsed, newTotal, finalUsed, trafficLimit)
				go func(oldClient model.ClientEntity, newClient *model.ClientEntity) {
					tgbotService := Tgbot{}
					if tgbotService.IsRunning() {
						tgbotService.NotifyClientStateChanged(&oldClient, newClient)
					}
				}(oldClientForNotify, client)
			}
		}

		// Online for panel: match node GetStats — only clients with traffic delta > 0 this read.
		// (Node merges process list + onlineFromTraffic; node process list is unused, so this
		// aligns standalone with multi-node behavior and avoids stuck "online" when Xray still
		// returns user>>>...>>>traffic rows at 0 after disconnect.)
		if !client.Enable {
			continue
		}
		if newTotal > 0 {
			wasFirstConnection := client.LastOnline == 0
			client.LastOnline = time.Now().UnixMilli()
			if wasFirstConnection {
				go func(c *model.ClientEntity) {
					tgbotService := Tgbot{}
					if tgbotService.IsRunning() {
						tgbotService.NotifyClientFirstConnection(c)
					}
				}(client)
			}
			addOnline(client.Name)
		}
	}

	setPanelClientLiveSpeeds(liveSpeedTracker.snapshot(time.Now().UnixMilli()))

	// Set online list for the panel (works with or without local *Process: multi-node has p==nil)
	setPanelOnlineClients(onlineList)

	// Save client entities with retry logic for database lock errors
	maxRetries := 3
	baseDelay := 10 * time.Millisecond
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			delay := baseDelay * time.Duration(1<<uint(attempt-1))
			logger.Debugf("Retrying Save client entities (attempt %d/%d) after %v", attempt+1, maxRetries, delay)
			time.Sleep(delay)
		}

		err = saveClientTrafficFields(tx, clientEntities, statusBefore)
		if err == nil {
			break
		}

		// Check if error is "database is locked"
		errStr := err.Error()
		if strings.Contains(errStr, "database is locked") || strings.Contains(errStr, "locked") {
			if attempt < maxRetries-1 {
				logger.Debugf("Database locked when saving client entities, will retry: %v", err)
				continue
			}
			// Last attempt failed
			logger.Warningf("Failed to save client entities after %d retries: %v", maxRetries, err)
			return nil, nil, err
		}

		// For other errors, don't retry
		logger.Warning("AddClientTraffic update data ", err)
		return nil, nil, err
	}

	return clientsToDisable, affectedInboundIds, nil
}

// AddHysteriaInboundTrafficFallbackFromCumulative applies Hysteria traffic to clients using
// cumulative (reset=false) inbound counters and local delta calculation.
// Safety rule: apply only to inbounds that have exactly one enabled client assignment.
func (s *ClientService) AddHysteriaInboundTrafficFallbackFromCumulative(tx *gorm.DB, inboundTraffics []*xray.Traffic) error {
	if len(inboundTraffics) == 0 {
		return nil
	}

	// Convert cumulative counters to per-tick deltas per inbound tag.
	cumulative := make(map[string]struct {
		up   int64
		down int64
	})
	for _, t := range inboundTraffics {
		if t == nil || !t.IsInbound || strings.TrimSpace(t.Tag) == "" || t.Tag == "api" {
			continue
		}
		cumulative[t.Tag] = struct {
			up   int64
			down int64
		}{up: t.Up, down: t.Down}
	}
	if len(cumulative) == 0 {
		return nil
	}

	tagDelta := make(map[string]struct {
		up   int64
		down int64
	})

	hysteriaInboundCumulativeMu.Lock()
	for tag, cur := range cumulative {
		prev, ok := hysteriaInboundCumulativeMap[tag]
		hysteriaInboundCumulativeMap[tag] = cur
		if !ok {
			continue
		}
		du := cur.up - prev.up
		dd := cur.down - prev.down
		// Counter reset / xray restart / wrap-around: skip negative jumps.
		if du < 0 || dd < 0 {
			continue
		}
		if du == 0 && dd == 0 {
			continue
		}
		tagDelta[tag] = struct {
			up   int64
			down int64
		}{up: du, down: dd}
	}
	hysteriaInboundCumulativeMu.Unlock()

	if len(tagDelta) == 0 {
		logger.Debug("Hy2 fallback: no positive inbound deltas in this tick")
		return nil
	}

	tags := make([]string, 0, len(tagDelta))
	for tag := range tagDelta {
		tags = append(tags, tag)
	}

	var inbounds []*model.Inbound
	if err := tx.Model(&model.Inbound{}).Where("tag IN (?)", tags).Find(&inbounds).Error; err != nil {
		return err
	}

	inboundByID := make(map[int]*model.Inbound, len(inbounds))
	hysteriaInboundIDs := make([]int, 0, len(inbounds))
	for _, inb := range inbounds {
		switch model.NormalizeProtocol(inb.Protocol) {
		case model.Hysteria, model.Hysteria2, model.WireGuard:
			hysteriaInboundIDs = append(hysteriaInboundIDs, inb.Id)
			inboundByID[inb.Id] = inb
		}
	}
	if len(hysteriaInboundIDs) == 0 {
		return nil
	}

	var maps []*model.ClientInboundMapping
	if err := tx.Model(&model.ClientInboundMapping{}).Where("inbound_id IN (?)", hysteriaInboundIDs).Find(&maps).Error; err != nil {
		return err
	}
	if len(maps) == 0 {
		return nil
	}

	clientIDsByInbound := make(map[int][]int)
	clientIDSet := make(map[int]struct{})
	for _, m := range maps {
		clientIDsByInbound[m.InboundId] = append(clientIDsByInbound[m.InboundId], m.ClientId)
		clientIDSet[m.ClientId] = struct{}{}
	}

	clientIDs := make([]int, 0, len(clientIDSet))
	for id := range clientIDSet {
		clientIDs = append(clientIDs, id)
	}
	var clients []*model.ClientEntity
	if err := tx.Model(&model.ClientEntity{}).Where("id IN (?)", clientIDs).Find(&clients).Error; err != nil {
		return err
	}
	clientByID := make(map[int]*model.ClientEntity, len(clients))
	for _, c := range clients {
		clientByID[c.Id] = c
	}

	nowMs := time.Now().UnixMilli()
	onlineSet := make(map[string]struct{})
	onlineList := make([]string, 0)
	for inboundID, ids := range clientIDsByInbound {
		inb := inboundByID[inboundID]
		if inb == nil {
			continue
		}
		d, ok := tagDelta[inb.Tag]
		if !ok || (d.up == 0 && d.down == 0) {
			continue
		}

		enabled := make([]*model.ClientEntity, 0, len(ids))
		for _, id := range ids {
			c := clientByID[id]
			if c != nil && c.Enable {
				enabled = append(enabled, c)
			}
		}
		if len(enabled) != 1 {
			// Ambiguous attribution for shared hysteria inbound: skip to avoid wrong billing.
			logger.Debugf("Hy2 fallback: skip inbound %s (id=%d), enabled clients=%d", inb.Tag, inboundID, len(enabled))
			continue
		}

		c := enabled[0]
		logger.Debugf("Hy2 fallback: apply tag=%s delta(up=%d,down=%d) to client=%s",
			inb.Tag, d.up, d.down, c.Name)
		c.Up += d.down
		c.Down += d.up
		c.AllTime += d.up + d.down
		c.LastOnline = nowMs
		key := strings.ToLower(strings.TrimSpace(c.Name))
		if key != "" {
			if _, ok := onlineSet[key]; !ok {
				onlineSet[key] = struct{}{}
				onlineList = append(onlineList, c.Name)
			}
		}
	}

	if len(onlineList) > 0 {
		setPanelOnlineClients(onlineList)
	}

	logger.Debugf("Hy2 fallback: saving %d clients, online=%d", len(clients), len(onlineList))
	return s.applyHysteriaTagDeltas(tx, tagDelta)
}

// AddHysteriaInboundTrafficFallbackFromDeltas applies already-delta inbound traffic (reset=true path)
// for Hysteria/Hysteria2 when user>>> stats are missing.
func (s *ClientService) AddHysteriaInboundTrafficFallbackFromDeltas(tx *gorm.DB, inboundTraffics []*xray.Traffic) error {
	if len(inboundTraffics) == 0 {
		return nil
	}
	tagDelta := make(map[string]struct {
		up   int64
		down int64
	})
	for _, t := range inboundTraffics {
		if t == nil || !t.IsInbound || strings.TrimSpace(t.Tag) == "" || t.Tag == "api" {
			continue
		}
		if t.Up == 0 && t.Down == 0 {
			continue
		}
		tagDelta[t.Tag] = struct {
			up   int64
			down int64
		}{up: t.Up, down: t.Down}
	}
	if len(tagDelta) == 0 {
		return nil
	}
	return s.applyHysteriaTagDeltas(tx, tagDelta)
}

func (s *ClientService) applyHysteriaTagDeltas(tx *gorm.DB, tagDelta map[string]struct {
	up   int64
	down int64
}) error {
	if len(tagDelta) == 0 {
		return nil
	}
	tags := make([]string, 0, len(tagDelta))
	for tag := range tagDelta {
		tags = append(tags, tag)
	}

	var inbounds []*model.Inbound
	if err := tx.Model(&model.Inbound{}).Where("tag IN (?)", tags).Find(&inbounds).Error; err != nil {
		return err
	}
	inboundByID := make(map[int]*model.Inbound, len(inbounds))
	hysteriaInboundIDs := make([]int, 0, len(inbounds))
	for _, inb := range inbounds {
		switch model.NormalizeProtocol(inb.Protocol) {
		case model.Hysteria, model.Hysteria2, model.WireGuard:
			hysteriaInboundIDs = append(hysteriaInboundIDs, inb.Id)
			inboundByID[inb.Id] = inb
		}
	}
	if len(hysteriaInboundIDs) == 0 {
		return nil
	}

	var maps []*model.ClientInboundMapping
	if err := tx.Model(&model.ClientInboundMapping{}).Where("inbound_id IN (?)", hysteriaInboundIDs).Find(&maps).Error; err != nil {
		return err
	}
	if len(maps) == 0 {
		return nil
	}

	clientIDsByInbound := make(map[int][]int)
	clientIDSet := make(map[int]struct{})
	for _, m := range maps {
		clientIDsByInbound[m.InboundId] = append(clientIDsByInbound[m.InboundId], m.ClientId)
		clientIDSet[m.ClientId] = struct{}{}
	}
	clientIDs := make([]int, 0, len(clientIDSet))
	for id := range clientIDSet {
		clientIDs = append(clientIDs, id)
	}
	var clients []*model.ClientEntity
	if err := tx.Model(&model.ClientEntity{}).Where("id IN (?)", clientIDs).Find(&clients).Error; err != nil {
		return err
	}
	clientByID := make(map[int]*model.ClientEntity, len(clients))
	for _, c := range clients {
		clientByID[c.Id] = c
	}

	nowMs := time.Now().UnixMilli()
	onlineSet := make(map[string]struct{})
	onlineList := make([]string, 0)
	speedFrom := liveSpeedTracker.startTick(nowMs)
	for inboundID, ids := range clientIDsByInbound {
		inb := inboundByID[inboundID]
		if inb == nil {
			continue
		}
		d, ok := tagDelta[inb.Tag]
		if !ok || (d.up == 0 && d.down == 0) {
			continue
		}
		enabled := make([]*model.ClientEntity, 0, len(ids))
		for _, id := range ids {
			c := clientByID[id]
			if c != nil && c.Enable {
				enabled = append(enabled, c)
			}
		}
		if len(enabled) != 1 {
			continue
		}
		c := enabled[0]

		// Fallback path also feeds the speed tracker, otherwise the Speed column stays empty
		// when traffic is attributed only via hysteria inbound deltas.
		liveSpeedTracker.observe(c.Id, speedFrom, nowMs, d.down, d.up)

		c.Up += d.down
		c.Down += d.up
		c.AllTime += d.up + d.down
		c.LastOnline = nowMs
		key := strings.ToLower(strings.TrimSpace(c.Name))
		if key != "" {
			if _, ok := onlineSet[key]; !ok {
				onlineSet[key] = struct{}{}
				onlineList = append(onlineList, c.Name)
			}
		}
	}
	if len(onlineList) > 0 {
		setPanelOnlineClients(onlineList)
	}
	setPanelClientLiveSpeeds(liveSpeedTracker.snapshot(time.Now().UnixMilli()))
	return saveClientTrafficFields(tx, clients, nil)
}

// syncInboundTrafficFromClients synchronizes inbound traffic as the sum of all its clients' traffic.
// This ensures that inbound traffic always equals the sum of all its clients' traffic.
// Traffic is now stored in ClientEntity, so we sum traffic from all enabled clients assigned to each inbound.
func (s *ClientService) syncInboundTrafficFromClients(tx *gorm.DB, inboundIds map[int]bool, inboundService *InboundService) error {
	if len(inboundIds) == 0 {
		return nil
	}

	inboundIdList := make([]int, 0, len(inboundIds))
	for id := range inboundIds {
		inboundIdList = append(inboundIdList, id)
	}

	// For each inbound, get all its clients and sum their traffic
	for _, inboundId := range inboundIdList {
		// Get all clients assigned to this inbound
		clientEntities, err := s.GetClientsForInbound(inboundId)
		if err != nil {
			logger.Warningf("Failed to get clients for inbound %d: %v", inboundId, err)
			continue
		}

		// Sum traffic from ALL clients (both enabled and disabled) for inbound statistics
		// This ensures inbound traffic reflects total usage, not just active clients
		var totalUp int64
		var totalDown int64
		var totalAllTime int64
		enabledClientCount := 0
		totalClientCount := len(clientEntities)

		for _, client := range clientEntities {
			// Sum traffic from all clients (enabled and disabled) for statistics
			totalUp += client.Up
			totalDown += client.Down
			totalAllTime += client.AllTime
			if client.Enable {
				enabledClientCount++
			}
		}

		// Update inbound traffic
		err = tx.Model(&model.Inbound{}).Where("id = ?", inboundId).
			Updates(map[string]any{
				"up":       totalUp,
				"down":     totalDown,
				"all_time": totalAllTime,
			}).Error
		if err != nil {
			logger.Warningf("Failed to sync inbound %d traffic: %v", inboundId, err)
			continue
		}
		logger.Debugf("Synced inbound %d traffic: up=%d, down=%d, all_time=%d (from %d total clients, %d enabled)",
			inboundId, totalUp, totalDown, totalAllTime, totalClientCount, enabledClientCount)
	}

	return nil
}

// RemapWireGuardStatEmailsList maps WireGuard/AmneziaWG public keys to panel client names.
func RemapWireGuardStatEmailsList(emails []string) []string {
	if len(emails) == 0 {
		return emails
	}
	pubKeyToClient := (&ClientService{}).wireGuardPubKeyToClientMap()
	if len(pubKeyToClient) == 0 {
		return emails
	}
	out := make([]string, 0, len(emails))
	for _, e := range emails {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if name, ok := pubKeyToClient[strings.ToLower(e)]; ok && name != "" {
			out = append(out, name)
		} else {
			out = append(out, e)
		}
	}
	return out
}

func (s *ClientService) wireGuardPubKeyToClientMap() map[string]string {
	db := database.GetDB()
	var wgInbounds []model.Inbound
	if err := db.Where("LOWER(protocol) IN ?", []string{string(model.WireGuard), string(model.AmneziaWG)}).Find(&wgInbounds).Error; err != nil || len(wgInbounds) == 0 {
		return nil
	}
	pubKeyToClient := make(map[string]string)
	for _, inb := range wgInbounds {
		var settings map[string]any
		if err := json.Unmarshal([]byte(inb.Settings), &settings); err != nil || settings == nil {
			continue
		}
		peers, _ := settings["peers"].([]any)
		for _, p := range peers {
			pm, ok := p.(map[string]any)
			if !ok {
				continue
			}
			clientName := strings.ToLower(strings.TrimSpace(wireGuardPeerAnyEmail(pm)))
			pk := strings.TrimSpace(strAny(pm["publicKey"]))
			if clientName == "" || pk == "" {
				continue
			}
			pubKeyToClient[strings.ToLower(pk)] = clientName
		}
	}
	if len(pubKeyToClient) == 0 {
		return nil
	}
	return pubKeyToClient
}

// remapWireGuardStatEmailsToClientNames maps Xray stat keys that use WireGuard publicKey
// instead of panel client name (email) back to the client name used in ClientEntity.
func (s *ClientService) remapWireGuardStatEmailsToClientNames(traffics []*xray.ClientTraffic) []*xray.ClientTraffic {
	if len(traffics) == 0 {
		return traffics
	}
	pubKeyToClient := s.wireGuardPubKeyToClientMap()
	if len(pubKeyToClient) == 0 {
		return traffics
	}
	out := make([]*xray.ClientTraffic, 0, len(traffics))
	for _, t := range traffics {
		if t == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(t.Email))
		if clientName, ok := pubKeyToClient[key]; ok && clientName != "" {
			cp := *t
			cp.Email = clientName
			out = append(out, &cp)
			continue
		}
		out = append(out, t)
	}
	return out
}
