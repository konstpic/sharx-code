// Package service provides Client management service.
package service

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/random"
	"github.com/konstpic/sharx-code/v2/xray"

	"gorm.io/gorm"
)

// ClientService provides business logic for managing clients.
type ClientService struct{}

// normalizeClientUUID parses s as a UUID and returns the canonical string form, or an error.
func normalizeClientUUID(s string) (string, error) {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return "", common.NewError("UUID is empty")
	}
	parsed, err := uuid.Parse(trimmed)
	if err != nil {
		return "", common.NewError("Invalid UUID: ", err.Error())
	}
	return parsed.String(), nil
}

func inboundProtocolUsesClientSecret(p model.Protocol) bool {
	switch model.NormalizeProtocol(p) {
	case model.Trojan, model.Shadowsocks, model.Mixed, model.Hysteria, model.Hysteria2:
		return true
	default:
		return false
	}
}

// ensurePasswordForSecretInbounds returns password unchanged if already set or if no assigned inbound
// needs a per-client secret; otherwise generates a random password (Trojan / Shadowsocks / Mixed / Hysteria).
func (s *ClientService) ensurePasswordForSecretInbounds(password string, inboundIds []int) string {
	if strings.TrimSpace(password) != "" || len(inboundIds) == 0 {
		return password
	}
	inboundSvc := InboundService{}
	for _, id := range inboundIds {
		inb, err := inboundSvc.GetInbound(id)
		if err != nil || inb == nil {
			continue
		}
		if model.NormalizeProtocol(inb.Protocol) == model.Shadowsocks {
			method := ShadowsocksMethodFromSettings(inb.Settings)
			if newPass, err := RandomShadowsocksUserPassword(method); err == nil {
				return newPass
			}
			return random.Seq(32)
		}
		if inboundProtocolUsesClientSecret(inb.Protocol) {
			return random.Seq(32)
		}
	}
	return password
}

// isClientUUIDTaken returns true if another client of this user already has the given uuid.
// For inserts use excludeId 0. For updates pass the current client's id to exclude.
func (s *ClientService) isClientUUIDTaken(userId int, u string, excludeId int) (bool, error) {
	db := database.GetDB()
	q := db.Model(&model.ClientEntity{}).Where("user_id = ? AND LOWER(uuid) = LOWER(?)", userId, u)
	if excludeId > 0 {
		q = q.Where("id != ?", excludeId)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func clientHasExpiredStatus(status string) bool {
	return status == "expired_traffic" || status == "expired_time"
}

// GetClients retrieves all clients for a specific user.
// Also loads traffic statistics and last online time for each client.
// NOTE: No caching - data should be real-time (traffic, HWID, online status change frequently).
func (s *ClientService) GetClients(userId int) ([]*model.ClientEntity, error) {
	db := database.GetDB()
	var clients []*model.ClientEntity
	err := db.Where("user_id = ?", userId).Find(&clients).Error
	if err != nil {
		return nil, err
	}

	// Load inbound assignments, traffic statistics, and HWIDs for each client
	for _, client := range clients {
		// Load inbound assignments
		inboundIds, err := s.GetInboundIdsForClient(client.Id)
		if err == nil {
			client.InboundIds = inboundIds
		}

		// Traffic statistics are now stored directly in ClientEntity table
		// No need to load from client_traffics - fields are already loaded from DB
		MergePanelClientLastConnectedNodeInto(client)

		// Check if client exceeded limits and update status if needed (but keep Enable = true)
		now := time.Now().Unix() * 1000
		totalUsed := client.Up + client.Down
		trafficLimit := int64(client.TotalGB * 1024 * 1024 * 1024)
		trafficExceeded := client.TotalGB > 0 && totalUsed >= trafficLimit
		timeExpired := client.ExpiryTime > 0 && client.ExpiryTime <= now

		// Update status if expired, but don't change Enable
		if trafficExceeded || timeExpired {
			status := "expired_traffic"
			if timeExpired {
				status = "expired_time"
			}
			// Only update if status changed
			if client.Status != status {
				oldClientForNotify := *client
				client.Status = status
				err = db.Model(&model.ClientEntity{}).Where("id = ?", client.Id).Update("status", status).Error
				if err != nil {
					logger.Warningf("Failed to update status for client %s: %v", client.Name, err)
				}
				tgbotService := Tgbot{}
				if tgbotService.IsRunning() {
					tgbotService.NotifyClientStateChanged(&oldClientForNotify, client)
				}
				// Xray/node sync is handled by XrayTrafficJob → DisableClientsByName (inbound rebuild).
			}
		}

		// Load HWIDs for this client
		hwidService := ClientHWIDService{}
		hwids, err := hwidService.GetHWIDsForClient(client.Id)
		if err == nil {
			client.HWIDs = hwids
		} else {
			logger.Warningf("Failed to load HWIDs for client %d: %v", client.Id, err)
		}
	}

	return clients, nil
}

// GetClient retrieves a client by ID.
// Traffic statistics are now stored directly in ClientEntity table.
func (s *ClientService) GetClient(id int) (*model.ClientEntity, error) {
	db := database.GetDB()
	var client model.ClientEntity
	err := db.First(&client, id).Error
	if err != nil {
		return nil, err
	}

	// Load inbound assignments
	inboundIds, err := s.GetInboundIdsForClient(client.Id)
	if err == nil {
		client.InboundIds = inboundIds
	}
	if tags, tagErr := s.GetTelemtAdTagsForClient(client.Id); tagErr == nil {
		client.TelemtAdTags = tags
	}

	// Traffic statistics (Up, Down, AllTime, LastOnline) are already loaded from ClientEntity table
	// No need to load from client_traffics
	MergePanelClientLastConnectedNodeInto(&client)

	// Load HWIDs for this client
	hwidService := ClientHWIDService{}
	hwids, err := hwidService.GetHWIDsForClient(client.Id)
	if err == nil {
		client.HWIDs = hwids
	}

	return &client, nil
}

// GetClientByName retrieves a client by name for a specific user.
func (s *ClientService) GetClientByName(userId int, name string) (*model.ClientEntity, error) {
	db := database.GetDB()
	var client model.ClientEntity
	err := db.Where("user_id = ? AND name = ?", userId, strings.ToLower(name)).First(&client).Error
	if err != nil {
		return nil, err
	}

	// Load inbound assignments
	inboundIds, err := s.GetInboundIdsForClient(client.Id)
	if err == nil {
		client.InboundIds = inboundIds
	}

	return &client, nil
}

// GetInboundIdsForClient retrieves all inbound IDs assigned to a client.
func (s *ClientService) GetInboundIdsForClient(clientId int) ([]int, error) {
	db := database.GetDB()
	var mappings []model.ClientInboundMapping
	err := db.Where("client_id = ?", clientId).Order("sort_order ASC, id ASC").Find(&mappings).Error
	if err != nil {
		return nil, err
	}

	inboundIds := make([]int, len(mappings))
	for i, mapping := range mappings {
		inboundIds[i] = mapping.InboundId
	}

	return inboundIds, nil
}

var telemtAdTagHexRe = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)

func normalizeTelemtAdTag(raw string) (string, error) {
	tag := strings.ToLower(strings.TrimSpace(raw))
	if tag == "" {
		return "", nil
	}
	if !telemtAdTagHexRe.MatchString(tag) {
		return "", fmt.Errorf("telemt ad tag must be exactly 32 hex characters")
	}
	return tag, nil
}

// GetTelemtAdTagsForClient loads per-inbound Telemt ad tags for a client.
func (s *ClientService) GetTelemtAdTagsForClient(clientId int) (map[string]string, error) {
	db := database.GetDB()
	var mappings []model.ClientInboundMapping
	if err := db.Where("client_id = ?", clientId).Find(&mappings).Error; err != nil {
		return nil, err
	}
	out := make(map[string]string)
	for _, m := range mappings {
		tag := strings.TrimSpace(m.TelemtAdTag)
		if tag != "" {
			out[strconv.Itoa(m.InboundId)] = tag
		}
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// SyncClientTelemtAdTags updates telemt_ad_tag on existing mappings. Nil tags means unchanged.
func (s *ClientService) SyncClientTelemtAdTags(tx *gorm.DB, clientId int, tags map[string]string) error {
	if tags == nil {
		return nil
	}
	var mappings []model.ClientInboundMapping
	if err := tx.Where("client_id = ?", clientId).Find(&mappings).Error; err != nil {
		return err
	}
	for _, m := range mappings {
		raw, ok := tags[strconv.Itoa(m.InboundId)]
		if !ok {
			continue
		}
		tag, err := normalizeTelemtAdTag(raw)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.ClientInboundMapping{}).Where("id = ?", m.Id).Update("telemt_ad_tag", tag).Error; err != nil {
			return err
		}
	}
	return nil
}

// vlessFlowFromAssignedInboundList returns VLESS flow from the first assigned VLESS inbound (lowest
// inbound id first). Flow is read only from that inbound's settings JSON.
func (s *ClientService) xrayUserPayloadForInbound(client *model.ClientEntity, inbound *model.Inbound) map[string]interface{} {
	clientData := make(map[string]interface{})
	clientData["email"] = client.Name
	switch inbound.Protocol {
	case model.Trojan:
		clientData["password"] = client.Password
	case model.Mixed:
		clientData["password"] = client.Password
		u := client.Name
		if i := strings.IndexByte(u, '@'); i > 0 {
			u = u[:i]
		}
		if u == "" {
			u = "user"
		}
		clientData["user"] = u
		clientData["pass"] = client.Password
	case model.Hysteria, model.Hysteria2:
		clientData["auth"] = client.Password
	case model.Shadowsocks:
		if cipher := ShadowsocksCipherForAddUser(inbound.Settings); cipher != "" {
			clientData["cipher"] = cipher
		}
		clientData["password"] = client.Password
	case model.VMESS, model.VLESS:
		clientData["id"] = client.UUID
		if inbound.Protocol == model.VMESS && client.Security != "" {
			clientData["security"] = client.Security
		}
		if inbound.Protocol == model.VLESS {
			if f := VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); f != "" {
				clientData["flow"] = f
			}
		}
	}
	return clientData
}

func (s *ClientService) vlessFlowFromAssignedInboundList(inboundIds []int) string {
	if len(inboundIds) == 0 {
		return ""
	}
	ids := append([]int(nil), inboundIds...)
	sort.Ints(ids)
	is := InboundService{}
	for _, id := range ids {
		in, err := is.GetInbound(id)
		if err != nil {
			continue
		}
		if model.NormalizeProtocol(in.Protocol) != model.VLESS {
			continue
		}
		return VLESSEffectiveFlow(in.Settings, in.StreamSettings, in.Protocol)
	}
	return ""
}

// AddClient creates a new client.
// Returns whether Xray needs restart and any error.
func (s *ClientService) AddClient(userId int, client *model.ClientEntity) (bool, error) {
	// Validate name uniqueness for this user
	existing, err := s.GetClientByName(userId, client.Name)
	if err == nil && existing != nil {
		return false, common.NewError("Client with name already exists: ", client.Name)
	}

	// Generate or normalize UUID, then ensure uniqueness for this user
	if client.UUID == "" {
		newUUID, err := uuid.NewRandom()
		if err != nil {
			return false, common.NewError("Failed to generate UUID: ", err.Error())
		}
		client.UUID = newUUID.String()
	} else {
		canon, err := normalizeClientUUID(client.UUID)
		if err != nil {
			return false, err
		}
		client.UUID = canon
	}
	taken, err := s.isClientUUIDTaken(userId, client.UUID, 0)
	if err != nil {
		return false, err
	}
	if taken {
		return false, common.NewError("This UUID is already used by another client for your account")
	}

	// Generate SubID if not provided
	if client.SubID == "" {
		client.SubID = random.Seq(16)
	}

	client.Password = s.ensurePasswordForSecretInbounds(client.Password, client.InboundIds)

	// Validate comment length (spaces count as characters)
	if len(client.Comment) > 100 {
		return false, common.NewError("Client comment exceeds maximum length of 100 characters (spaces count as characters)")
	}
	if len(client.Announce) > 200 {
		return false, common.NewError("Client announce exceeds maximum length of 200 characters")
	}

	// Trim whitespace from comment
	client.Comment = strings.TrimSpace(client.Comment)
	client.Announce = strings.TrimSpace(client.Announce)

	// Normalize name to lowercase
	client.Name = strings.ToLower(client.Name)
	client.UserId = userId

	// Set timestamps
	now := time.Now().Unix()
	if client.CreatedAt == 0 {
		client.CreatedAt = now
	}
	client.UpdatedAt = now

	db := database.GetDB()
	tx := db.Begin()
	defer func() {
		if err != nil {
			tx.Rollback()
		} else {
			tx.Commit()
		}
	}()

	// Initialize traffic fields to 0 (they are stored in ClientEntity now)
	client.Up = 0
	client.Down = 0
	client.AllTime = 0
	client.LastOnline = 0

	// Set default status to "active" if not specified
	if client.Status == "" {
		client.Status = "active"
	}

	// Ensure GroupId is explicitly set (can be nil for no group)
	// This prevents foreign key constraint violations
	if client.GroupId != nil && *client.GroupId <= 0 {
		client.GroupId = nil
	}

	// VLESS flow comes only from assigned inbound(s), not the client form
	client.Flow = s.vlessFlowFromAssignedInboundList(client.InboundIds)

	// Use Select to explicitly control which fields are inserted
	// This ensures that nil GroupId is properly handled as NULL
	fieldsToInsert := []string{
		"user_id", "name", "uuid", "security", "password", "flow",
		"total_gb", "expiry_time", "enable", "status",
		"tg_id", "sub_id", "comment", "reset", "created_at", "updated_at",
		"up", "down", "all_time", "last_online", "hwid_enabled", "max_hwid",
		"announce",
	}
	// Add group_id only if it's not nil
	if client.GroupId != nil {
		fieldsToInsert = append(fieldsToInsert, "group_id")
	}

	err = tx.Select(fieldsToInsert).Create(client).Error
	if err != nil {
		return false, err
	}

	// Traffic statistics are now stored directly in ClientEntity table
	// No need to create separate client_traffics records

	// Assign to inbounds if provided
	if len(client.InboundIds) > 0 {
		err = s.AssignClientToInbounds(tx, client.Id, client.InboundIds)
		if err != nil {
			return false, err
		}
	}
	if client.TelemtAdTags != nil {
		if err = s.SyncClientTelemtAdTags(tx, client.Id, client.TelemtAdTags); err != nil {
			return false, err
		}
	}

	// Commit client transaction first to avoid nested transactions
	err = tx.Commit().Error
	if err != nil {
		return false, err
	}

	// Sync assigned inbounds: persist settings in DB, add user via API (no full inbound replace / restart).
	needRestart := false
	needSidecarSync := false
	if len(client.InboundIds) > 0 {
		inboundService := InboundService{}
		settingService := SettingService{}
		multiMode, _ := settingService.GetMultiNodeMode()
		nodeService := NodeService{}
		xrayService := XrayService{}

		for _, inboundId := range client.InboundIds {
			inbound, err := inboundService.GetInbound(inboundId)
			if err != nil {
				logger.Warningf("Failed to get inbound %d for settings update: %v", inboundId, err)
				continue
			}

			clientEntities, err := s.GetClientsForInbound(inboundId)
			if err != nil {
				logger.Warningf("Failed to get clients for inbound %d: %v", inboundId, err)
				continue
			}

			newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
			if err != nil {
				logger.Warningf("Failed to build settings for inbound %d: %v", inboundId, err)
				continue
			}
			if err := inboundService.updateInboundSettingsDBOnly(inboundId, newSettings); err != nil {
				logger.Warningf("Failed to persist inbound %d settings: %v", inboundId, err)
				continue
			}
			inbound.Settings = newSettings

			if !client.Enable {
				continue
			}

			if model.IsSidecarProtocol(inbound.Protocol) {
				needSidecarSync = true
				continue
			}
			if !model.IsXrayInboundProtocol(inbound.Protocol) {
				continue
			}
			// WireGuard has no AlterInbound AddUser; push full inbound (peers) via UpdateInbound.
			if model.NormalizeProtocol(inbound.Protocol) == model.WireGuard {
				_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
				if err != nil {
					logger.Warningf("AddClient: failed to sync wireguard inbound %d: %v", inboundId, err)
					needRestart = true
				} else if inboundNeedRestart {
					needRestart = true
				}
				continue
			}

			clientData := s.xrayUserPayloadForInbound(client, inbound)
			if multiMode {
				nodes, err := nodeService.GetNodesForInbound(inboundId)
				if err != nil || len(nodes) == 0 {
					needRestart = true
					continue
				}
				for _, node := range nodes {
					if err := nodeService.AddUserToNode(node, string(inbound.Protocol), inbound.Tag, clientData); err != nil {
						logger.Warningf("AddClient: failed to add client %s to node %s via API: %v", client.Name, node.Name, err)
						needRestart = true
					} else {
						logger.Infof("AddClient: added client %s to node %s via API (instant)", client.Name, node.Name)
					}
				}
			} else if xrayService.IsXrayRunning() {
				apiPort := p.GetAPIPort()
				api, err := inboundService.getXrayAPI(apiPort)
				if err != nil {
					needRestart = true
					continue
				}
				if err := api.AddUser(string(inbound.Protocol), inbound.Tag, clientData); err != nil {
					if strings.Contains(err.Error(), "already exists") {
						logger.Debugf("AddClient: client %s already exists in Xray (tag: %s)", client.Name, inbound.Tag)
					} else {
						logger.Warningf("AddClient: failed to add client %s to Xray (tag: %s): %v", client.Name, inbound.Tag, err)
						needRestart = true
					}
				} else {
					logger.Infof("AddClient: added client %s to Xray (tag: %s) via API", client.Name, inbound.Tag)
				}
			} else {
				needRestart = true
			}
		}
	}

	// Send notification about client creation
	tgbotService := Tgbot{}
	if tgbotService.IsRunning() {
		tgbotService.NotifyClientCreated(client)
	}

	if needSidecarSync {
		(&XrayService{}).SyncWorkerSidecarsAsync()
	}

	return needRestart, nil
}

// UpdateClient updates an existing client.
// Returns whether Xray needs restart and any error.
func (s *ClientService) UpdateClient(userId int, client *model.ClientEntity) (bool, error) {
	// Check if client exists and belongs to user
	existing, err := s.GetClient(client.Id)
	if err != nil {
		return false, err
	}
	if existing.UserId != userId {
		return false, common.NewError("Client not found or access denied")
	}

	// Name is immutable after creation (WireGuard peer tags, stats, subscriptions bind to it).
	reqName := strings.ToLower(strings.TrimSpace(client.Name))
	storedName := strings.ToLower(strings.TrimSpace(existing.Name))
	if reqName != "" && reqName != storedName {
		return false, common.NewError("Client name cannot be changed after creation")
	}
	client.Name = existing.Name

	// Normalize and validate UUID when client supplies one; ensure uniqueness on change
	if client.UUID != "" {
		canon, err := normalizeClientUUID(client.UUID)
		if err != nil {
			return false, err
		}
		if !strings.EqualFold(canon, existing.UUID) {
			taken, err := s.isClientUUIDTaken(userId, canon, client.Id)
			if err != nil {
				return false, err
			}
			if taken {
				return false, common.NewError("This UUID is already used by another client for your account")
			}
		}
		client.UUID = canon
	} else {
		// keep existing UUID in model so downstream logic is consistent
		client.UUID = existing.UUID
	}

	// Validate comment length if provided (spaces count as characters)
	if client.Comment != "" && len(client.Comment) > 100 {
		return false, common.NewError("Client comment exceeds maximum length of 100 characters (spaces count as characters)")
	}

	// Trim whitespace from comment if provided
	if client.Comment != "" {
		client.Comment = strings.TrimSpace(client.Comment)
	}
	if len(client.Announce) > 200 {
		return false, common.NewError("Client announce exceeds maximum length of 200 characters")
	}
	client.Announce = strings.TrimSpace(client.Announce)

	var effectiveInboundIds []int
	if client.InboundIds != nil {
		effectiveInboundIds = append(effectiveInboundIds, client.InboundIds...)
	} else if ids, err := s.GetInboundIdsForClient(client.Id); err == nil {
		effectiveInboundIds = ids
	}
	client.Password = s.ensurePasswordForSecretInbounds(client.Password, effectiveInboundIds)

	// Update timestamp
	client.UpdatedAt = time.Now().Unix()

	// Validate group_id if it's being set
	if client.GroupId != nil && *client.GroupId > 0 {
		groupService := ClientGroupService{}
		_, err := groupService.GetGroup(*client.GroupId, userId)
		if err != nil {
			// Group doesn't exist or doesn't belong to user
			// Set group_id to nil instead of failing
			logger.Warningf("Group %d not found for user %d, setting group_id to nil for client %d", *client.GroupId, userId, client.Id)
			client.GroupId = nil
		}
	}

	db := database.GetDB()
	tx := db.Begin()
	// Track if transaction was committed to avoid double rollback
	committed := false
	defer func() {
		// Only rollback if there was an error and transaction wasn't committed
		if err != nil && !committed {
			tx.Rollback()
		}
	}()

	// Update only provided fields (email is never updated here — immutable after creation)
	updates := make(map[string]interface{})
	if client.UUID != "" {
		updates["uuid"] = client.UUID
	}
	if client.Security != "" {
		updates["security"] = client.Security
	}
	if client.Password != "" {
		updates["password"] = client.Password
	}
	// Always update these fields - they can be 0 (unlimited/disabled) or empty
	updates["total_gb"] = client.TotalGB
	updates["expiry_time"] = client.ExpiryTime
	updates["enable"] = client.Enable
	updates["status"] = client.Status
	updates["tg_id"] = client.TgID
	updates["sub_id"] = client.SubID
	updates["comment"] = client.Comment
	updates["announce"] = client.Announce
	// flow is set from assigned VLESS inbounds after mapping (see below), not from the request
	updates["reset"] = client.Reset
	// Update group_id - can be nil (no group)
	// Only update if it's different from existing value
	if existing.GroupId == nil && client.GroupId == nil {
		// Both nil, no change needed
	} else if existing.GroupId != nil && client.GroupId != nil && *existing.GroupId == *client.GroupId {
		// Same value, no change needed
	} else {
		// Value changed, update it
		updates["group_id"] = client.GroupId
	}
	// Update HWID settings - GORM converts field names to snake_case automatically
	// HWIDEnabled -> hwid_enabled, MaxHWID -> max_hwid
	// Only update HWID settings if they differ from existing values to preserve them when not explicitly changed
	if client.HWIDEnabled != existing.HWIDEnabled {
		updates["hwid_enabled"] = client.HWIDEnabled
	}
	// Only update max_hwid if it differs from existing value to preserve it when not explicitly changed
	if client.MaxHWID != existing.MaxHWID {
		updates["max_hwid"] = client.MaxHWID
	}
	// IP limit settings. Must be always-updated (zero-valued false / 0 are legitimate
	// states the admin can save), otherwise GORM's "Updates(struct)" semantics drop them
	// silently. Mirrors the always-update pattern used for `enable` / `total_gb` above.
	updates["ip_limit_enabled"] = client.IPLimitEnabled
	updates["max_ips"] = client.MaxIPs
	updates["updated_at"] = client.UpdatedAt

	// First try to update with all fields including HWID and IP limit
	err = tx.Model(&model.ClientEntity{}).Where("id = ? AND user_id = ?", client.Id, userId).Updates(updates).Error
	if err != nil {
		// Some columns may not exist on very old databases that skipped migrations 0040 (HWID)
		// or 0043 (IP limit). Strip the offending columns and retry once.
		msg := err.Error()
		stripped := false
		for _, col := range []string{"hwid_enabled", "max_hwid", "ip_limit_enabled", "max_ips"} {
			if strings.Contains(msg, "no such column: "+col) {
				delete(updates, col)
				stripped = true
			}
		}
		if stripped {
			err = tx.Model(&model.ClientEntity{}).Where("id = ? AND user_id = ?", client.Id, userId).Updates(updates).Error
		}
	}
	if err != nil {
		return false, err
	}

	// Get current inbound assignments to determine which inbounds need updating
	var currentMappings []model.ClientInboundMapping
	tx.Where("client_id = ?", client.Id).Find(&currentMappings)
	oldInboundIds := make(map[int]bool)
	for _, mapping := range currentMappings {
		oldInboundIds[mapping.InboundId] = true
	}

	// Track all affected inbounds (old + new) for settings update
	affectedInboundIds := make(map[int]bool)
	for inboundId := range oldInboundIds {
		affectedInboundIds[inboundId] = true
	}

	// Update inbound assignments if provided
	// Note: InboundIds is a slice, so we need to check if it was explicitly set
	// We'll always update if InboundIds is not nil (even if empty array means remove all)
	if client.InboundIds != nil {
		logger.Debugf("UpdateClient: updating inbound assignments for client %d, inboundIds=%v (len=%d)", client.Id, client.InboundIds, len(client.InboundIds))
		// Sync by diff so Telemt (and other) mapping rows stay stable — same idea as WireGuard keys:
		// do not delete+recreate everything (that regenerated telemt_secret on every save).
		if err = s.SyncClientInboundAssignments(tx, client.Id, client.InboundIds); err != nil {
			logger.Errorf("UpdateClient: failed to sync inbound mappings for client %d: %v", client.Id, err)
			return false, err
		}
		logger.Debugf("UpdateClient: synced inbound mappings for client %d to: %v", client.Id, client.InboundIds)
		for _, inboundId := range client.InboundIds {
			if inboundId > 0 {
				affectedInboundIds[inboundId] = true
			}
		}
	} else {
		logger.Debugf("UpdateClient: inboundIds is nil for client %d, keeping existing assignments", client.Id)
	}

	if client.TelemtAdTags != nil {
		if err = s.SyncClientTelemtAdTags(tx, client.Id, client.TelemtAdTags); err != nil {
			return false, err
		}
		for inboundIdStr := range client.TelemtAdTags {
			if inboundId, convErr := strconv.Atoi(inboundIdStr); convErr == nil && inboundId > 0 {
				affectedInboundIds[inboundId] = true
			}
		}
	}

	var mappingRows []model.ClientInboundMapping
	tx.Where("client_id = ?", client.Id).Order("sort_order ASC, id ASC").Find(&mappingRows)
	assignedInboundIds := make([]int, 0, len(mappingRows))
	for _, m := range mappingRows {
		assignedInboundIds = append(assignedInboundIds, m.InboundId)
	}
	syncedFlow := s.vlessFlowFromAssignedInboundList(assignedInboundIds)
	if err = tx.Model(&model.ClientEntity{}).Where("id = ? AND user_id = ?", client.Id, userId).Update("flow", syncedFlow).Error; err != nil {
		return false, err
	}
	client.Flow = syncedFlow

	// Traffic statistics are now stored directly in ClientEntity table
	// No need to sync with client_traffics - all fields (TotalGB, ExpiryTime, Enable, Email) are in ClientEntity

	// Check if client was expired and is now no longer expired (traffic reset or limit increased)
	// Reload client to get updated values
	var updatedClient model.ClientEntity
	if err := tx.Where("id = ?", client.Id).First(&updatedClient).Error; err == nil {
		wasExpired := existing.Status == "expired_traffic" || existing.Status == "expired_time"

		// Check if client is no longer expired
		now := time.Now().Unix() * 1000
		totalUsed := updatedClient.Up + updatedClient.Down
		trafficLimit := int64(updatedClient.TotalGB * 1024 * 1024 * 1024)
		trafficExceeded := updatedClient.TotalGB > 0 && totalUsed >= trafficLimit
		timeExpired := updatedClient.ExpiryTime > 0 && updatedClient.ExpiryTime <= now

		// If client was expired but is no longer expired, reset status and re-add to Xray
		if wasExpired && !trafficExceeded && !timeExpired && updatedClient.Enable {
			updates["status"] = "active"
			if err := tx.Model(&model.ClientEntity{}).Where("id = ?", client.Id).Update("status", "active").Error; err == nil {
				updatedClient.Status = "active"
				logger.Infof("Client %s is no longer expired, status reset to active", updatedClient.Name)
			}
		}
	}

	// #region agent log
	logger.Debugf("[DEBUG-AGENT] UpdateClient: before Commit, clientId=%d, userId=%d", client.Id, userId)
	// #endregion

	// Commit client transaction first to avoid nested transactions
	err = tx.Commit().Error
	committed = true

	// #region agent log
	logger.Debugf("[DEBUG-AGENT] UpdateClient: after Commit, clientId=%d, error=%v", client.Id, err)
	// #endregion

	if err != nil {
		return false, err
	}

	// Reload client from DB after commit to get latest status and values
	var finalClient model.ClientEntity
	db = database.GetDB()
	if err = db.Where("id = ?", client.Id).First(&finalClient).Error; err != nil {
		logger.Warningf("UpdateClient: failed to reload client %d after commit: %v", client.Id, err)
		finalClient = updatedClient // Fallback to previous value
	}

	// Now update Settings for all affected inbounds (old + new) ASYNCHRONOUSLY
	// This is needed even if InboundIds wasn't changed, because client data (UUID, password, etc.) might have changed
	// We do this AFTER committing the client transaction to avoid nested transactions and database locks
	// Run asynchronously to avoid blocking the HTTP response - changes will be applied immediately in background
	go func() {
		needXrayRestart := false
		needSidecarSync := false
		inboundService := InboundService{}
		settingService := SettingService{}
		multiMode, _ := settingService.GetMultiNodeMode()
		xrayService := XrayService{}

		// Check if enable status changed
		enableChanged := existing.Enable != finalClient.Enable
		inboundAssignmentsChanged := false
		if client.InboundIds != nil {
			priorInboundIds := inboundAssignmentIDs(currentMappings)
			inboundAssignmentsChanged = !inboundIDsEqual(client.InboundIds, priorInboundIds)
		}
		subscriptionStateChanged := existing.TotalGB != finalClient.TotalGB ||
			existing.ExpiryTime != finalClient.ExpiryTime ||
			existing.Enable != finalClient.Enable ||
			existing.Status != finalClient.Status
		settingsAffectingChange := enableChanged ||
			inboundAssignmentsChanged ||
			subscriptionStateChanged ||
			existing.UUID != finalClient.UUID ||
			existing.Password != finalClient.Password ||
			existing.Security != finalClient.Security ||
			!strings.EqualFold(existing.Name, finalClient.Name)
		if !settingsAffectingChange {
			logger.Debugf("UpdateClient: skipping inbound/Xray sync (metadata-only change), clientId=%d", client.Id)
			return
		}
		wasExpired := clientHasExpiredStatus(existing.Status)

		// Check if client is no longer expired (by traffic or time)
		now := time.Now().Unix() * 1000
		totalUsed := finalClient.Up + finalClient.Down
		trafficLimit := int64(finalClient.TotalGB * 1024 * 1024 * 1024)
		trafficExceeded := finalClient.TotalGB > 0 && totalUsed >= trafficLimit
		timeExpired := finalClient.ExpiryTime > 0 && finalClient.ExpiryTime <= now
		nowActive := (!trafficExceeded && !timeExpired) && (finalClient.Status == "active" || finalClient.Status == "")

		needsReAdd := wasExpired && nowActive && finalClient.Enable

		// External billing often sends enable=false after the panel expiry job already rebuilt inbounds.
		if wasExpired && enableChanged && !finalClient.Enable && !needsReAdd && !inboundAssignmentsChanged &&
			existing.UUID == finalClient.UUID && existing.Password == finalClient.Password &&
			existing.Security == finalClient.Security && strings.EqualFold(existing.Name, finalClient.Name) {
			logger.Debugf("UpdateClient: skipping inbound sync (redundant disable of already-expired client %d)", client.Id)
			return
		}

		// Instant config update + async restart approach (no API needed)
		// 1. Update config.json instantly (add/remove client from Settings)
		// 2. Update DB Settings
		// 3. Async restart to apply changes
		logger.Infof("UpdateClient: enableChanged=%v, needsReAdd=%v, multiMode=%v, xrayRunning=%v",
			enableChanged, needsReAdd, multiMode, xrayService.IsXrayRunning())

		// Single mode: keep config.json in sync (same idea as nodes: live core via API + persisted config).
		// Touch every affected inbound so name changes and inbound reassignment update the file correctly.
		if !multiMode {
			if xrayService.IsXrayRunning() {
				processConfig := xrayService.GetConfig()
				if processConfig != nil {
					clientInboundIds, err := s.GetInboundIdsForClient(client.Id)
					if err != nil {
						logger.Warningf("UpdateClient: GetInboundIdsForClient: %v", err)
					} else {
						assignedSet := make(map[int]bool, len(clientInboundIds))
						for _, inboundId := range clientInboundIds {
							assignedSet[inboundId] = true
						}
						for inboundId := range affectedInboundIds {
							inbound, err := inboundService.GetInbound(inboundId)
							if err != nil {
								continue
							}
							assigned := assignedSet[inboundId]
							if !assigned || !finalClient.Enable {
								if err := xray.UpdateConfigFileAfterUserRemoval(processConfig, inbound.Tag, existing.Name); err != nil {
									logger.Warningf("UpdateClient: failed to remove client %s from config.json (inbound %s): %v", existing.Name, inbound.Tag, err)
								} else {
									logger.Infof("UpdateClient: removed client %s from config.json (inbound: %s)", existing.Name, inbound.Tag)
								}
								continue
							}
							if !strings.EqualFold(existing.Name, finalClient.Name) {
								if err := xray.UpdateConfigFileAfterUserRemoval(processConfig, inbound.Tag, existing.Name); err != nil {
									logger.Warningf("UpdateClient: failed to remove old name %s from config.json (inbound %s): %v", existing.Name, inbound.Tag, err)
								}
							}
							clientData := make(map[string]interface{})
							clientData["email"] = finalClient.Name
							switch inbound.Protocol {
							case model.Trojan, model.Mixed:
								clientData["password"] = finalClient.Password
								if inbound.Protocol == model.Mixed {
									u := finalClient.Name
									if i := strings.IndexByte(u, '@'); i > 0 {
										u = u[:i]
									}
									if u == "" {
										u = "user"
									}
									clientData["user"] = u
									clientData["pass"] = finalClient.Password
								}
							case model.Hysteria, model.Hysteria2:
								clientData["auth"] = finalClient.Password
							case model.Shadowsocks:
								if cipher := ShadowsocksCipherForAddUser(inbound.Settings); cipher != "" {
									clientData["cipher"] = cipher
								}
								clientData["password"] = finalClient.Password
							case model.VMESS, model.VLESS:
								clientData["id"] = finalClient.UUID
								if inbound.Protocol == model.VMESS && finalClient.Security != "" {
									clientData["security"] = finalClient.Security
								}
								if inbound.Protocol == model.VLESS {
									if f := VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); f != "" {
										clientData["flow"] = f
									}
								}
							}
							if err := xray.UpdateConfigFileAfterUserAddition(processConfig, inbound.Tag, clientData); err != nil {
								logger.Warningf("UpdateClient: failed to add client %s to config.json: %v", finalClient.Name, err)
							} else {
								logger.Infof("UpdateClient: added client %s to config.json (inbound: %s)", finalClient.Name, inbound.Tag)
							}
						}
					}
				}
			}
		}

		// Update Settings for affected inbounds (needed to keep DB in sync)
		for inboundId := range affectedInboundIds {
			inbound, err := inboundService.GetInbound(inboundId)
			if err != nil {
				logger.Warningf("Failed to get inbound %d for settings update: %v", inboundId, err)
				continue
			}

			// Get all clients for this inbound (from ClientEntity)
			clientEntities, err := s.GetClientsForInbound(inboundId)
			if err != nil {
				logger.Warningf("Failed to get clients for inbound %d: %v", inboundId, err)
				continue
			}

			// Rebuild Settings from ClientEntity
			newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
			if err != nil {
				logger.Warningf("Failed to build settings for inbound %d: %v", inboundId, err)
				continue
			}

			logger.Debugf("UpdateClient: rebuilding settings for inbound %d (%s), clientCount=%d",
				inboundId, inbound.Protocol, len(clientEntities))

			// Update inbound Settings in DB (to keep database in sync)
			// Use retry logic to handle database lock errors
			inbound.Settings = newSettings
			_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
			if err != nil {
				logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
				// Continue with other inbounds
			} else if inboundNeedRestart {
				if model.IsSidecarProtocol(inbound.Protocol) {
					needSidecarSync = true
				} else {
					needXrayRestart = true
				}
			}
		}

		if needSidecarSync {
			logger.Debugf("UpdateClient: syncing sidecars only (Xray untouched)")
			xrayService.SyncWorkerSidecarsAsync()
		}
		if needXrayRestart {
			inboundIDs := make([]int, 0, len(affectedInboundIds))
			for inboundID := range affectedInboundIds {
				inboundIDs = append(inboundIDs, inboundID)
			}
			logger.Debugf("UpdateClient: syncing worker Xray for %d inbound(s) on assigned nodes only", len(inboundIDs))
			xrayService.SyncWorkerXrayForInboundsAsync(inboundIDs)
		}
	}()

	// Load HWIDs for notification
	hwidService := ClientHWIDService{}
	hwids, err := hwidService.GetHWIDsForClient(finalClient.Id)
	if err == nil {
		finalClient.HWIDs = hwids
	}
	// Also load HWIDs for old client if available
	if existing.Id > 0 {
		oldHwids, err := hwidService.GetHWIDsForClient(existing.Id)
		if err == nil {
			existing.HWIDs = oldHwids
		}
	}

	// Send notification about client update
	tgbotService := Tgbot{}
	if tgbotService.IsRunning() {
		tgbotService.NotifyClientUpdated(&finalClient, existing)
		tgbotService.NotifyClientStateChanged(existing, &finalClient)
	}

	// Return needRestart based on whether API operation was done
	// If API operation was done, no restart needed (handled asynchronously)
	// If API operation wasn't done, might need restart (handled asynchronously)
	// We return false here because restart is handled asynchronously in goroutine above
	// The controller will check needRestart from the goroutine result
	return false, nil
}

// DeleteClient deletes a client by ID.
// Returns whether Xray needs restart and any error.
func (s *ClientService) DeleteClient(userId int, id int) (bool, error) {
	// Check if client exists and belongs to user
	existing, err := s.GetClient(id)
	if err != nil {
		return false, err
	}
	if existing.UserId != userId {
		return false, common.NewError("Client not found or access denied")
	}

	// Get inbound assignments before deleting
	var mappings []model.ClientInboundMapping
	db := database.GetDB()
	err = db.Where("client_id = ?", id).Find(&mappings).Error
	if err != nil {
		return false, err
	}

	affectedInboundIds := make(map[int]bool)
	for _, mapping := range mappings {
		affectedInboundIds[mapping.InboundId] = true
	}

	needXrayRestart := false
	needSidecarSync := false

	tx := db.Begin()
	// Track if transaction was committed to avoid double rollback
	committed := false
	defer func() {
		// Only rollback if there was an error and transaction wasn't committed
		if err != nil && !committed {
			tx.Rollback()
		}
	}()

	// Delete inbound mappings
	err = tx.Where("client_id = ?", id).Delete(&model.ClientInboundMapping{}).Error
	if err != nil {
		return false, err
	}

	// Delete client
	err = tx.Where("id = ? AND user_id = ?", id, userId).Delete(&model.ClientEntity{}).Error
	if err != nil {
		return false, err
	}

	// #region agent log
	logger.Debugf("[DEBUG-AGENT] DeleteClient: before Commit, clientId=%d, userId=%d", id, userId)
	// #endregion

	// Commit deletion transaction first to avoid nested transactions
	err = tx.Commit().Error
	committed = true

	// #region agent log
	logger.Debugf("[DEBUG-AGENT] DeleteClient: after Commit, clientId=%d, error=%v", id, err)
	// #endregion

	if err != nil {
		return false, err
	}

	// Instant config update + async restart approach (no API needed)
	// 1. Update config.json instantly (remove client from Settings)
	// 2. Update DB Settings
	// 3. Async restart to apply changes
	settingService := SettingService{}
	multiMode, _ := settingService.GetMultiNodeMode()
	inboundService := InboundService{}
	xrayService := XrayService{}

	// Single mode: instantly update config.json before restart
	if !multiMode {
		if xrayService.IsXrayRunning() {
			processConfig := xrayService.GetConfig()
			if processConfig != nil {
				// Instantly remove client from config.json for all affected inbounds
				for inboundId := range affectedInboundIds {
					inbound, err := inboundService.GetInbound(inboundId)
					if err != nil {
						logger.Warningf("DeleteClient: failed to get inbound %d: %v", inboundId, err)
						continue
					}
					// Instantly update config.json (remove client from Settings)
					if err := xray.UpdateConfigFileAfterUserRemoval(processConfig, inbound.Tag, existing.Name); err != nil {
						logger.Warningf("DeleteClient: failed to instantly update config.json for inbound %s: %v", inbound.Tag, err)
					} else {
						logger.Infof("DeleteClient: instantly removed client %s from config.json (inbound: %s)", existing.Name, inbound.Tag)
					}
				}
			}
		}
	}

	// Update Settings for affected inbounds (after deletion)
	// We do this AFTER committing the deletion transaction to avoid nested transactions and database locks
	for inboundId := range affectedInboundIds {
		inbound, err := inboundService.GetInbound(inboundId)
		if err != nil {
			logger.Warningf("Failed to get inbound %d for settings update: %v", inboundId, err)
			continue
		}

		// Get all remaining clients for this inbound (from ClientEntity)
		clientEntities, err := s.GetClientsForInbound(inboundId)
		if err != nil {
			logger.Warningf("Failed to get clients for inbound %d: %v", inboundId, err)
			continue
		}

		// Rebuild Settings from ClientEntity
		newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
		if err != nil {
			logger.Warningf("Failed to build settings for inbound %d: %v", inboundId, err)
			continue
		}

		// Update inbound Settings in DB (to keep database in sync)
		// Use retry logic to handle database lock errors
		inbound.Settings = newSettings
		_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
		if err != nil {
			logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
			// Continue with other inbounds
		} else if inboundNeedRestart {
			if model.IsSidecarProtocol(inbound.Protocol) {
				needSidecarSync = true
			} else {
				needXrayRestart = true
			}
		}
	}

	if needSidecarSync {
		logger.Debugf("DeleteClient: syncing sidecars only (Xray untouched)")
		go func() {
			xrayService.SyncWorkerSidecarsAsync()
		}()
	}
	if needXrayRestart {
		inboundIDs := make([]int, 0, len(affectedInboundIds))
		for inboundID := range affectedInboundIds {
			inboundIDs = append(inboundIDs, inboundID)
		}
		logger.Debugf("DeleteClient: syncing worker Xray for %d inbound(s) on assigned nodes only", len(inboundIDs))
		go func() {
			xs := XrayService{}
			if err := xs.syncWorkerXrayForInbounds(inboundIDs); err != nil {
				logger.Warningf("DeleteClient: failed to sync worker Xray: %v", err)
			} else {
				logger.Debugf("DeleteClient: worker Xray synced for affected inbounds")
			}
		}()

		// Send notification about client deletion
		tgbotService := Tgbot{}
		if tgbotService.IsRunning() {
			tgbotService.NotifyClientDeleted(existing)
		}

		return false, nil // No need for synchronous restart
	}

	// Send notification about client deletion
	tgbotService := Tgbot{}
	if tgbotService.IsRunning() {
		tgbotService.NotifyClientDeleted(existing)
	}

	return false, nil
}

// AssignClientToInbounds assigns a client to multiple inbounds.
func (s *ClientService) AssignClientToInbounds(tx *gorm.DB, clientId int, inboundIds []int) error {
	for i, inboundId := range inboundIds {
		var ib model.Inbound
		if err := tx.Select("protocol").First(&ib, inboundId).Error; err != nil {
			return err
		}
		mapping := &model.ClientInboundMapping{
			ClientId:  clientId,
			InboundId: inboundId,
			SortOrder: i * 10,
		}
		if model.NormalizeProtocol(ib.Protocol) == model.Telemt {
			sec, err := GenerateTelemtSecretHex()
			if err != nil {
				return err
			}
			mapping.TelemtSecret = sec
		}
		if err := tx.Create(mapping).Error; err != nil {
			logger.Warningf("Failed to assign client %d to inbound %d: %v", clientId, inboundId, err)
			return err
		}
	}
	return nil
}

// inboundAssignmentIDs returns inbound ids in mapping sort order (before a sync).
func inboundAssignmentIDs(mappings []model.ClientInboundMapping) []int {
	if len(mappings) == 0 {
		return nil
	}
	sorted := append([]model.ClientInboundMapping(nil), mappings...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].SortOrder != sorted[j].SortOrder {
			return sorted[i].SortOrder < sorted[j].SortOrder
		}
		return sorted[i].InboundId < sorted[j].InboundId
	})
	out := make([]int, 0, len(sorted))
	for _, m := range sorted {
		if m.InboundId > 0 {
			out = append(out, m.InboundId)
		}
	}
	return out
}

// normalizeInboundIDList deduplicates inbound ids preserving first-seen order (matches SyncClientInboundAssignments).
func normalizeInboundIDList(ids []int) []int {
	if len(ids) == 0 {
		return nil
	}
	out := make([]int, 0, len(ids))
	seen := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func inboundIDsEqual(want, have []int) bool {
	a := normalizeInboundIDList(want)
	b := normalizeInboundIDList(have)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// SyncClientInboundAssignments updates client↔inbound rows to match wantInboundIds order without
// replacing existing mapping rows (preserves Telemt secrets and DB ids). New inbounds get a new
// row; removed inbounds are deleted; sort_order follows the slice order.
func (s *ClientService) SyncClientInboundAssignments(tx *gorm.DB, clientId int, wantInboundIds []int) error {
	if clientId <= 0 {
		return nil
	}
	want := make([]int, 0, len(wantInboundIds))
	seen := make(map[int]struct{}, len(wantInboundIds))
	for _, id := range wantInboundIds {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		want = append(want, id)
	}

	var current []model.ClientInboundMapping
	if err := tx.Where("client_id = ?", clientId).Find(&current).Error; err != nil {
		return err
	}

	for _, m := range current {
		if _, ok := seen[m.InboundId]; !ok {
			if err := tx.Where("id = ?", m.Id).Delete(&model.ClientInboundMapping{}).Error; err != nil {
				return err
			}
		}
	}

	for i, inboundId := range want {
		sortOrder := i * 10
		var row model.ClientInboundMapping
		err := tx.Where("client_id = ? AND inbound_id = ?", clientId, inboundId).First(&row).Error
		if err == nil {
			if row.SortOrder != sortOrder {
				if err := tx.Model(&model.ClientInboundMapping{}).Where("id = ?", row.Id).Update("sort_order", sortOrder).Error; err != nil {
					return err
				}
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		var ib model.Inbound
		if err := tx.Select("protocol").First(&ib, inboundId).Error; err != nil {
			return err
		}
		mapping := &model.ClientInboundMapping{
			ClientId:  clientId,
			InboundId: inboundId,
			SortOrder: sortOrder,
		}
		if model.NormalizeProtocol(ib.Protocol) == model.Telemt {
			sec, genErr := GenerateTelemtSecretHex()
			if genErr != nil {
				return genErr
			}
			mapping.TelemtSecret = sec
		}
		if err := tx.Create(mapping).Error; err != nil {
			return err
		}
	}
	return nil
}

// GetClientsForInbound retrieves all clients assigned to an inbound.
func (s *ClientService) GetClientsForInbound(inboundId int) ([]*model.ClientEntity, error) {
	db := database.GetDB()
	var mappings []model.ClientInboundMapping
	err := db.Where("inbound_id = ?", inboundId).Order("sort_order ASC, id ASC").Find(&mappings).Error
	if err != nil {
		return nil, err
	}

	if len(mappings) == 0 {
		return []*model.ClientEntity{}, nil
	}

	clientIds := make([]int, len(mappings))
	for i, mapping := range mappings {
		clientIds[i] = mapping.ClientId
	}

	var clients []*model.ClientEntity
	err = db.Where("id IN ?", clientIds).Order("id ASC").Find(&clients).Error
	if err != nil {
		return nil, err
	}

	return clients, nil
}

// ConvertClientEntityToClient converts ClientEntity to legacy Client struct for backward compatibility.
func (s *ClientService) ConvertClientEntityToClient(entity *model.ClientEntity) model.Client {
	return model.Client{
		ID:         entity.UUID,
		Security:   entity.Security,
		Password:   entity.Password,
		Flow:       entity.Flow,
		Email:      entity.Name,
		TotalGB:    int64(entity.TotalGB), // Convert float64 to int64 for legacy compatibility (rounds down)
		ExpiryTime: entity.ExpiryTime,
		Enable:     entity.Enable,
		TgID:       entity.TgID,
		SubID:      entity.SubID,
		Comment:    entity.Comment,
		Reset:      entity.Reset,
		CreatedAt:  entity.CreatedAt,
		UpdatedAt:  entity.UpdatedAt,
	}
}

// ConvertClientToEntity converts legacy Client struct to ClientEntity.
func (s *ClientService) ConvertClientToEntity(client *model.Client, userId int) *model.ClientEntity {
	status := "active"
	if !client.Enable {
		// If client is disabled, check if it's expired
		now := time.Now().Unix() * 1000
		totalUsed := int64(0) // We don't have traffic info here, assume 0
		trafficLimit := int64(client.TotalGB * 1024 * 1024 * 1024)
		trafficExceeded := client.TotalGB > 0 && totalUsed >= trafficLimit
		timeExpired := client.ExpiryTime > 0 && client.ExpiryTime <= now
		if trafficExceeded {
			status = "expired_traffic"
		} else if timeExpired {
			status = "expired_time"
		}
	}
	password := client.Password
	if client.Auth != "" {
		password = client.Auth
	}
	return &model.ClientEntity{
		UserId:      userId,
		Name:        strings.ToLower(client.Email),
		UUID:        client.ID,
		Security:    client.Security,
		Password:    password,
		Flow:        client.Flow,
		TotalGB:     float64(client.TotalGB), // Convert int64 to float64
		ExpiryTime:  client.ExpiryTime,
		Enable:      client.Enable,
		Status:      status,
		TgID:        client.TgID,
		SubID:       client.SubID,
		Comment:     client.Comment,
		Reset:       client.Reset,
		HWIDEnabled: client.HWIDEnabled,
		MaxHWID:     client.MaxHWID,
		CreatedAt:   client.CreatedAt,
		UpdatedAt:   client.UpdatedAt,
	}
}

// DisableClientsByName removes expired clients from Xray API and updates their status.
// This is called after AddClientTraffic marks clients as expired.
func (s *ClientService) DisableClientsByName(clientsToDisable map[string]string, inboundService *InboundService) (bool, error) {
	if len(clientsToDisable) == 0 {
		logger.Debugf("DisableClientsByName: no clients to disable")
		return false, nil
	}

	logger.Infof("DisableClientsByName: syncing %d expired client(s) via inbound rebuild", len(clientsToDisable))

	db := database.GetDB()
	needRestart := false

	// Update client status in database (but keep Enable = true)
	emails := make([]string, 0, len(clientsToDisable))
	for email := range clientsToDisable {
		emails = append(emails, email)
	}

	// Get clients and update their status
	var clients []*model.ClientEntity
	if err := db.Where("LOWER(name) IN (?)", emails).Find(&clients).Error; err == nil {
		for _, client := range clients {
			// Status should already be set by AddClientTraffic, but ensure it's set
			if client.Status != "expired_traffic" && client.Status != "expired_time" {
				// Determine status based on limits
				now := time.Now().Unix() * 1000
				totalUsed := client.Up + client.Down
				trafficLimit := int64(client.TotalGB * 1024 * 1024 * 1024)
				trafficExceeded := client.TotalGB > 0 && totalUsed >= trafficLimit
				timeExpired := client.ExpiryTime > 0 && client.ExpiryTime <= now

				if trafficExceeded {
					client.Status = "expired_traffic"
				} else if timeExpired {
					client.Status = "expired_time"
				}
			}
		}
		db.Save(clients)
	}

	// Update inbound settings to remove expired clients
	// Get all affected inbounds
	allTags := make(map[string]bool)
	for _, tag := range clientsToDisable {
		allTags[tag] = true
	}

	for tag := range allTags {
		var inbound model.Inbound
		if err := db.Where("tag = ?", tag).First(&inbound).Error; err == nil {
			logger.Debugf("DisableClientsByName: updating inbound %d (tag: %s) to remove expired clients", inbound.Id, tag)
			// Rebuild settings without expired clients
			allClients, err := s.GetClientsForInbound(inbound.Id)
			if err == nil {
				// Count expired clients before filtering
				expiredCount := 0
				for _, client := range allClients {
					if client.Status == "expired_traffic" || client.Status == "expired_time" {
						expiredCount++
					}
				}
				logger.Debugf("DisableClientsByName: inbound %d has %d total clients, %d expired", inbound.Id, len(allClients), expiredCount)

				newSettings, err := inboundService.BuildSettingsFromClientEntities(&inbound, allClients)
				if err == nil {
					inbound.Settings = newSettings
					_, _, err = inboundService.updateInboundWithRetry(&inbound)
					if err != nil {
						logger.Warningf("DisableClientsByName: failed to update inbound %d: %v", inbound.Id, err)
						needRestart = true
					} else {
						logger.Infof("DisableClientsByName: successfully updated inbound %d (tag: %s) without expired clients", inbound.Id, tag)
					}
				} else {
					logger.Warningf("DisableClientsByName: failed to build settings for inbound %d: %v", inbound.Id, err)
				}
			} else {
				logger.Warningf("DisableClientsByName: failed to get clients for inbound %d: %v", inbound.Id, err)
			}
		} else {
			logger.Warningf("DisableClientsByName: failed to find inbound with tag %s: %v", tag, err)
		}
	}

	return needRestart, nil
}

// ResetAllClientTraffics resets traffic counters for all clients of a specific user.
// Returns whether Xray needs restart and any error.
func (s *ClientService) ResetAllClientTraffics(userId int) (bool, error) {
	db := database.GetDB()

	// Get all clients that were expired due to traffic before reset
	var expiredClients []model.ClientEntity
	err := db.Where("user_id = ? AND status = ?", userId, "expired_traffic").Find(&expiredClients).Error
	if err != nil {
		return false, err
	}

	// Reset traffic for all clients of this user in ClientEntity table
	result := db.Model(&model.ClientEntity{}).
		Where("user_id = ?", userId).
		Updates(map[string]interface{}{
			"up":       0,
			"down":     0,
			"all_time": 0,
		})

	if result.Error != nil {
		return false, result.Error
	}

	_ = db.Where("client_id IN (?)", db.Model(&model.ClientEntity{}).Select("id").Where("user_id = ?", userId)).Delete(&model.ClientNodeTraffic{}).Error

	// Reset status to "active" for clients expired due to traffic
	// This will allow clients to be re-added to Xray if they were removed
	db.Model(&model.ClientEntity{}).
		Where("user_id = ? AND status = ?", userId, "expired_traffic").
		Update("status", "active")

	// Re-add expired clients to Xray if they were removed
	needRestart := false
	if len(expiredClients) > 0 {
		inboundService := InboundService{}
		settingService := SettingService{}
		multiMode, _ := settingService.GetMultiNodeMode()
		xrayService := XrayService{}

		// Re-add expired clients to Xray if they were removed
		{
			// Group clients by inbound
			inboundClients := make(map[int][]model.ClientEntity)
			for _, client := range expiredClients {
				if !client.Enable {
					continue
				}
				inboundIds, err := s.GetInboundIdsForClient(client.Id)
				if err == nil {
					for _, inboundId := range inboundIds {
						inboundClients[inboundId] = append(inboundClients[inboundId], client)
					}
				}
			}

			// Re-add clients to Xray for each inbound
			for inboundId, clients := range inboundClients {
				inbound, err := inboundService.GetInbound(inboundId)
				if err != nil {
					continue
				}
				if !model.IsXrayInboundProtocol(inbound.Protocol) {
					continue
				}

				for _, client := range clients {
					// Build client data for Xray API
					clientData := make(map[string]any)
					clientData["email"] = client.Name

					switch inbound.Protocol {
					case model.Trojan:
						clientData["password"] = client.Password
					case model.Mixed:
						clientData["password"] = client.Password
						u := client.Name
						if i := strings.IndexByte(u, '@'); i > 0 {
							u = u[:i]
						}
						if u == "" {
							u = "user"
						}
						clientData["user"] = u
						clientData["pass"] = client.Password
					case model.Hysteria, model.Hysteria2:
						clientData["auth"] = client.Password
					case model.Shadowsocks:
						if cipher := ShadowsocksCipherForAddUser(inbound.Settings); cipher != "" {
							clientData["cipher"] = cipher
						}
						clientData["password"] = client.Password
					case model.VMESS, model.VLESS:
						clientData["id"] = client.UUID
						if inbound.Protocol == model.VMESS && client.Security != "" {
							clientData["security"] = client.Security
						}
						if inbound.Protocol == model.VLESS {
							if f := VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); f != "" {
								clientData["flow"] = f
							}
						}
					}

					// Single mode: instantly update config.json and restart
					if !multiMode {
						if xrayService.IsXrayRunning() {
							processConfig := xrayService.GetConfig()
							if processConfig != nil {
								// Instantly add client to config.json
								if err := xray.UpdateConfigFileAfterUserAddition(processConfig, inbound.Tag, clientData); err != nil {
									logger.Warningf("ResetAllClientTraffics: failed to instantly add client %s to config.json: %v", client.Name, err)
									needRestart = true
								} else {
									logger.Infof("ResetAllClientTraffics: instantly added client %s to config.json (inbound: %s)", client.Name, inbound.Tag)
									needRestart = true
								}
							}
						}
					}
				}

				// Update inbound settings to include all clients
				allClients, err := s.GetClientsForInbound(inboundId)
				if err == nil {
					newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, allClients)
					if err == nil {
						inbound.Settings = newSettings
						_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
						if err != nil {
							logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
						} else if inboundNeedRestart {
							needRestart = true
						}
					}
				}
			}
		}
	}

	return needRestart, nil
}

// ResetClientTraffic resets traffic counter for a specific client.
// Returns whether Xray needs restart and any error.
func (s *ClientService) ResetClientTraffic(userId int, clientId int) (bool, error) {
	db := database.GetDB()

	// Get client and verify ownership
	client, err := s.GetClient(clientId)
	if err != nil {
		return false, err
	}
	if client.UserId != userId {
		return false, common.NewError("Client not found or access denied")
	}

	// Check if client was expired due to traffic
	wasExpired := client.Status == "expired_traffic" || client.Status == "expired_time"

	// Reset traffic in ClientEntity
	result := db.Model(&model.ClientEntity{}).
		Where("id = ? AND user_id = ?", clientId, userId).
		Updates(map[string]interface{}{
			"up":       0,
			"down":     0,
			"all_time": 0,
		})

	if result.Error != nil {
		return false, result.Error
	}

	_ = db.Where("client_id = ?", clientId).Delete(&model.ClientNodeTraffic{}).Error

	// Reset status to "active" if client was expired due to traffic
	if wasExpired {
		db.Model(&model.ClientEntity{}).
			Where("id = ? AND user_id = ?", clientId, userId).
			Update("status", "active")
	}

	// Re-add client to Xray if it was expired and is now active
	needRestart := false
	if wasExpired && client.Enable {
		inboundService := InboundService{}
		settingService := SettingService{}
		multiMode, _ := settingService.GetMultiNodeMode()
		nodeService := NodeService{}
		xrayService := XrayService{}

		// Check if we can use API (multi-node mode or local Xray running)
		canUseAPI := multiMode || xrayService.IsXrayRunning()

		if canUseAPI {
			// Get all inbounds for this client
			inboundIds, err := s.GetInboundIdsForClient(clientId)
			if err == nil {
				for _, inboundId := range inboundIds {
					inbound, err := inboundService.GetInbound(inboundId)
					if err != nil {
						continue
					}
					if !model.IsXrayInboundProtocol(inbound.Protocol) {
						continue
					}

					// Build client data for Xray API
					clientData := make(map[string]any)
					clientData["email"] = client.Name

					switch inbound.Protocol {
					case model.Trojan:
						clientData["password"] = client.Password
					case model.Mixed:
						clientData["password"] = client.Password
						u := client.Name
						if i := strings.IndexByte(u, '@'); i > 0 {
							u = u[:i]
						}
						if u == "" {
							u = "user"
						}
						clientData["user"] = u
						clientData["pass"] = client.Password
					case model.Hysteria, model.Hysteria2:
						clientData["auth"] = client.Password
					case model.Shadowsocks:
						if cipher := ShadowsocksCipherForAddUser(inbound.Settings); cipher != "" {
							clientData["cipher"] = cipher
						}
						clientData["password"] = client.Password
					case model.VMESS, model.VLESS:
						clientData["id"] = client.UUID
						if inbound.Protocol == model.VMESS && client.Security != "" {
							clientData["security"] = client.Security
						}
						if inbound.Protocol == model.VLESS {
							if f := VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); f != "" {
								clientData["flow"] = f
							}
						}
					}

					if multiMode {
						// Multi-node mode: add to all nodes assigned to this inbound
						nodes, err := nodeService.GetNodesForInbound(inboundId)
						if err == nil && len(nodes) > 0 {
							for _, node := range nodes {
								go func(n *model.Node) {
									if err := nodeService.AddUserToNode(n, string(inbound.Protocol), inbound.Tag, clientData); err != nil {
										logger.Warningf("ResetClientTraffic: failed to re-add client %s to node %s via API: %v", client.Name, n.Name, err)
									} else {
										logger.Infof("ResetClientTraffic: re-added client %s to node %s via API after traffic reset", client.Name, n.Name)
									}
								}(node)
							}
						}
					} else {
						// Single mode: add to local Xray
						if p != nil && p.IsRunning() {
							apiPort := p.GetAPIPort()
							api, err := inboundService.getXrayAPI(apiPort)
							if err == nil {
								err1 := api.AddUser(string(inbound.Protocol), inbound.Tag, clientData)
								if err1 != nil {
									if strings.Contains(err1.Error(), "already exists") {
										logger.Debugf("ResetClientTraffic: client %s already exists in Xray (tag: %s)", client.Name, inbound.Tag)
									} else {
										logger.Warningf("ResetClientTraffic: failed to re-add client %s to Xray (tag: %s): %v", client.Name, inbound.Tag, err1)
										needRestart = true
									}
								} else {
									logger.Infof("ResetClientTraffic: re-added client %s to Xray (tag: %s) after traffic reset", client.Name, inbound.Tag)
								}
							} else {
								logger.Debugf("ResetClientTraffic: failed to get XrayAPI connection: %v", err)
								needRestart = true
							}
						}
					}
				}

				// Update inbound settings to include the client
				for _, inboundId := range inboundIds {
					inbound, err := inboundService.GetInbound(inboundId)
					if err != nil {
						continue
					}

					// Get all clients for this inbound
					clientEntities, err := s.GetClientsForInbound(inboundId)
					if err != nil {
						continue
					}

					// Rebuild Settings from ClientEntity
					newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
					if err != nil {
						continue
					}

					// Update inbound Settings
					inbound.Settings = newSettings
					_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
					if err != nil {
						logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
					} else if inboundNeedRestart {
						needRestart = true
					}
				}
			}
		}
	}

	return needRestart, nil
}

// DelDepletedClients deletes clients that have exhausted their traffic limits or expired.
// Returns the number of deleted clients, whether Xray needs restart, and any error.
func (s *ClientService) DelDepletedClients(userId int) (int, bool, error) {
	db := database.GetDB()
	now := time.Now().Unix() * 1000

	// Get all clients for this user
	var clients []model.ClientEntity
	err := db.Where("user_id = ?", userId).Find(&clients).Error
	if err != nil {
		return 0, false, err
	}

	if len(clients) == 0 {
		return 0, false, nil
	}

	emails := make([]string, len(clients))
	for i, client := range clients {
		emails[i] = strings.ToLower(client.Name)
	}

	// Find depleted client traffics
	var depletedTraffics []xray.ClientTraffic
	err = db.Model(&xray.ClientTraffic{}).
		Where("email IN (?) AND ((total > 0 AND up + down >= total) OR (expiry_time > 0 AND expiry_time <= ?))", emails, now).
		Find(&depletedTraffics).Error
	if err != nil {
		return 0, false, err
	}

	if len(depletedTraffics) == 0 {
		return 0, false, nil
	}

	// Get emails of depleted clients
	depletedEmails := make([]string, len(depletedTraffics))
	for i, traffic := range depletedTraffics {
		depletedEmails[i] = traffic.Email
	}

	// Get client IDs to delete
	var clientIdsToDelete []int
	err = db.Model(&model.ClientEntity{}).
		Where("user_id = ? AND LOWER(name) IN (?)", userId, depletedEmails).
		Pluck("id", &clientIdsToDelete).Error
	if err != nil {
		return 0, false, err
	}

	if len(clientIdsToDelete) == 0 {
		return 0, false, nil
	}

	// Delete clients and their mappings
	tx := db.Begin()
	defer func() {
		if err != nil {
			tx.Rollback()
		} else {
			tx.Commit()
		}
	}()

	// Delete client-inbound mappings
	err = tx.Where("client_id IN (?)", clientIdsToDelete).Delete(&model.ClientInboundMapping{}).Error
	if err != nil {
		return 0, false, err
	}

	// Delete client traffic records
	err = tx.Where("email IN (?)", depletedEmails).Delete(&xray.ClientTraffic{}).Error
	if err != nil {
		return 0, false, err
	}

	// Delete clients
	err = tx.Where("id IN (?) AND user_id = ?", clientIdsToDelete, userId).Delete(&model.ClientEntity{}).Error
	if err != nil {
		return 0, false, err
	}

	// Commit transaction before rebuilding inbounds (to avoid nested transactions)
	err = tx.Commit().Error
	if err != nil {
		return 0, false, err
	}

	// Rebuild Settings for all affected inbounds
	needRestart := false
	inboundService := InboundService{}

	// Get all unique inbound IDs that had these clients (from committed data)
	var affectedInboundIds []int
	err = db.Model(&model.ClientInboundMapping{}).
		Where("client_id IN (?)", clientIdsToDelete).
		Distinct("inbound_id").
		Pluck("inbound_id", &affectedInboundIds).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return 0, false, err
	}

	// Also check from client_traffics for backward compatibility (before deletion)
	// Note: This query runs after deletion, so we need to get inbound IDs from depleted traffics before deletion
	var trafficInboundIds []int
	for _, traffic := range depletedTraffics {
		if traffic.InboundId > 0 {
			// Check if already in list
			found := false
			for _, id := range trafficInboundIds {
				if id == traffic.InboundId {
					found = true
					break
				}
			}
			if !found {
				trafficInboundIds = append(trafficInboundIds, traffic.InboundId)
			}
		}
	}

	// Merge inbound IDs
	inboundIdSet := make(map[int]bool)
	for _, id := range affectedInboundIds {
		inboundIdSet[id] = true
	}
	for _, id := range trafficInboundIds {
		if !inboundIdSet[id] {
			affectedInboundIds = append(affectedInboundIds, id)
		}
	}

	// Rebuild Settings for each affected inbound
	for _, inboundId := range affectedInboundIds {
		var inbound model.Inbound
		err = db.First(&inbound, inboundId).Error
		if err != nil {
			continue
		}

		// Get all remaining clients for this inbound (from ClientEntity)
		clientEntities, err := s.GetClientsForInbound(inboundId)
		if err != nil {
			continue
		}

		// Rebuild Settings from ClientEntity
		newSettings, err := inboundService.BuildSettingsFromClientEntities(&inbound, clientEntities)
		if err != nil {
			logger.Warningf("Failed to build settings for inbound %d: %v", inboundId, err)
			continue
		}

		// Update inbound Settings
		inbound.Settings = newSettings
		_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(&inbound)
		if err != nil {
			logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
			continue
		} else if inboundNeedRestart {
			needRestart = true
		}
	}

	return len(clientIdsToDelete), needRestart, nil
}

// BulkResetTraffic resets traffic counters for multiple clients.
// Returns whether Xray needs restart and any error.
func (s *ClientService) BulkResetTraffic(userId int, clientIds []int) (bool, error) {
	if len(clientIds) == 0 {
		return false, nil
	}

	db := database.GetDB()

	// Verify all clients belong to user
	var count int64
	err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	if int(count) != len(clientIds) {
		return false, common.NewError("Some clients not found or access denied")
	}

	// Get clients that were expired due to traffic before reset
	var expiredClients []model.ClientEntity
	err = db.Where("id IN ? AND user_id = ? AND status = ?", clientIds, userId, "expired_traffic").Find(&expiredClients).Error
	if err != nil {
		return false, err
	}

	// Reset traffic for selected clients
	result := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Updates(map[string]interface{}{
			"up":       0,
			"down":     0,
			"all_time": 0,
		})

	if result.Error != nil {
		return false, result.Error
	}

	_ = db.Where("client_id IN ?", clientIds).Delete(&model.ClientNodeTraffic{}).Error

	// Reset status to "active" for clients expired due to traffic
	if len(expiredClients) > 0 {
		db.Model(&model.ClientEntity{}).
			Where("id IN ? AND user_id = ? AND status = ?", clientIds, userId, "expired_traffic").
			Update("status", "active")
	}

	// Re-add expired clients to Xray if they were removed
	needRestart := false
	if len(expiredClients) > 0 {
		inboundService := InboundService{}
		settingService := SettingService{}
		multiMode, _ := settingService.GetMultiNodeMode()
		nodeService := NodeService{}
		xrayService := XrayService{}

		// Check if we can use API (multi-node mode or local Xray running)
		canUseAPI := multiMode || xrayService.IsXrayRunning()

		if canUseAPI {
			// Group clients by inbound
			inboundClients := make(map[int][]model.ClientEntity)
			for _, client := range expiredClients {
				if !client.Enable {
					continue
				}
				inboundIds, err := s.GetInboundIdsForClient(client.Id)
				if err == nil {
					for _, inboundId := range inboundIds {
						inboundClients[inboundId] = append(inboundClients[inboundId], client)
					}
				}
			}

			// Re-add clients to Xray for each inbound
			for inboundId, clients := range inboundClients {
				inbound, err := inboundService.GetInbound(inboundId)
				if err != nil {
					continue
				}
				if !model.IsXrayInboundProtocol(inbound.Protocol) {
					continue
				}

				for _, client := range clients {
					// Build client data for Xray API
					clientData := make(map[string]any)
					clientData["email"] = client.Name

					switch inbound.Protocol {
					case model.Trojan:
						clientData["password"] = client.Password
					case model.Mixed:
						clientData["password"] = client.Password
						u := client.Name
						if i := strings.IndexByte(u, '@'); i > 0 {
							u = u[:i]
						}
						if u == "" {
							u = "user"
						}
						clientData["user"] = u
						clientData["pass"] = client.Password
					case model.Hysteria, model.Hysteria2:
						clientData["auth"] = client.Password
					case model.Shadowsocks:
						if cipher := ShadowsocksCipherForAddUser(inbound.Settings); cipher != "" {
							clientData["cipher"] = cipher
						}
						clientData["password"] = client.Password
					case model.VMESS, model.VLESS:
						clientData["id"] = client.UUID
						if inbound.Protocol == model.VMESS && client.Security != "" {
							clientData["security"] = client.Security
						}
						if inbound.Protocol == model.VLESS {
							if f := VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); f != "" {
								clientData["flow"] = f
							}
						}
					}

					if multiMode {
						// Multi-node mode: add to all nodes assigned to this inbound
						nodes, err := nodeService.GetNodesForInbound(inboundId)
						if err == nil && len(nodes) > 0 {
							for _, node := range nodes {
								go func(n *model.Node) {
									if err := nodeService.AddUserToNode(n, string(inbound.Protocol), inbound.Tag, clientData); err != nil {
										logger.Warningf("BulkResetTraffic: failed to re-add client %s to node %s via API: %v", client.Name, n.Name, err)
									} else {
										logger.Infof("BulkResetTraffic: re-added client %s to node %s via API after traffic reset", client.Name, n.Name)
									}
								}(node)
							}
						}
					} else {
						// Single mode: add to local Xray
						if p != nil && p.IsRunning() {
							apiPort := p.GetAPIPort()
							api, err := inboundService.getXrayAPI(apiPort)
							if err == nil {
								err1 := api.AddUser(string(inbound.Protocol), inbound.Tag, clientData)
								if err1 != nil {
									if strings.Contains(err1.Error(), "already exists") {
										logger.Debugf("BulkResetTraffic: client %s already exists in Xray (tag: %s)", client.Name, inbound.Tag)
									} else {
										logger.Warningf("BulkResetTraffic: failed to re-add client %s to Xray (tag: %s): %v", client.Name, inbound.Tag, err1)
										needRestart = true
									}
								} else {
									logger.Infof("BulkResetTraffic: re-added client %s to Xray (tag: %s) after traffic reset", client.Name, inbound.Tag)
								}
							} else {
								logger.Debugf("BulkResetTraffic: failed to get XrayAPI connection: %v", err)
								needRestart = true
							}
						}
					}
				}

				// Update inbound settings
				clientEntities, err := s.GetClientsForInbound(inboundId)
				if err == nil {
					newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
					if err == nil {
						inbound.Settings = newSettings
						_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
						if err != nil {
							logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
						} else if inboundNeedRestart {
							needRestart = true
						}
					}
				}
			}
		}
	}

	return needRestart, nil
}

// BulkClearHWIDs clears HWIDs for multiple clients.
func (s *ClientService) BulkClearHWIDs(userId int, clientIds []int) error {
	if len(clientIds) == 0 {
		return nil
	}

	// Verify all clients belong to user
	db := database.GetDB()
	var count int64
	err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error
	if err != nil {
		return err
	}
	if int(count) != len(clientIds) {
		return common.NewError("Some clients not found or access denied")
	}

	// Clear HWIDs for selected clients
	hwidService := ClientHWIDService{}
	for _, clientId := range clientIds {
		err = hwidService.ClearHWIDsForClient(clientId)
		if err != nil {
			logger.Warningf("Failed to clear HWIDs for client %d: %v", clientId, err)
		}
	}

	return nil
}

// BulkDelete deletes multiple clients.
// Returns whether Xray needs restart and any error.
func (s *ClientService) BulkDelete(userId int, clientIds []int) (bool, error) {
	if len(clientIds) == 0 {
		return false, nil
	}

	// Verify all clients belong to user
	db := database.GetDB()
	var count int64
	err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	if int(count) != len(clientIds) {
		return false, common.NewError("Some clients not found or access denied")
	}

	// Get inbound assignments before deleting
	var mappings []model.ClientInboundMapping
	err = db.Where("client_id IN ?", clientIds).Find(&mappings).Error
	if err != nil {
		return false, err
	}

	affectedInboundIds := make(map[int]bool)
	for _, mapping := range mappings {
		affectedInboundIds[mapping.InboundId] = true
	}

	needRestart := false

	tx := db.Begin()
	defer func() {
		if err != nil {
			tx.Rollback()
		} else {
			tx.Commit()
		}
	}()

	// Delete inbound mappings
	err = tx.Where("client_id IN ?", clientIds).Delete(&model.ClientInboundMapping{}).Error
	if err != nil {
		return false, err
	}

	// Delete clients
	err = tx.Where("id IN ? AND user_id = ?", clientIds, userId).Delete(&model.ClientEntity{}).Error
	if err != nil {
		return false, err
	}

	// Update Settings for affected inbounds
	inboundService := InboundService{}
	for inboundId := range affectedInboundIds {
		inbound, err := inboundService.GetInbound(inboundId)
		if err != nil {
			continue
		}

		clientEntities, err := s.GetClientsForInbound(inboundId)
		if err != nil {
			continue
		}

		newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
		if err != nil {
			continue
		}

		inbound.Settings = newSettings
		_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
		if err != nil {
			logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
		} else if inboundNeedRestart {
			needRestart = true
		}
	}

	return needRestart, nil
}

// BulkEnable enables or disables multiple clients.
// Returns whether Xray needs restart and any error.
func (s *ClientService) BulkEnable(userId int, clientIds []int, enable bool) (bool, error) {
	if len(clientIds) == 0 {
		return false, nil
	}

	// Verify all clients belong to user
	db := database.GetDB()
	var count int64
	err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	if int(count) != len(clientIds) {
		return false, common.NewError("Some clients not found or access denied")
	}

	// Get inbound assignments
	var mappings []model.ClientInboundMapping
	err = db.Where("client_id IN ?", clientIds).Find(&mappings).Error
	if err != nil {
		return false, err
	}

	affectedInboundIds := make(map[int]bool)
	for _, mapping := range mappings {
		affectedInboundIds[mapping.InboundId] = true
	}

	// Update enable status
	err = db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Update("enable", enable).Error
	if err != nil {
		return false, err
	}

	// Use Xray API for instant user add/remove (both local and nodes)
	needRestart := false
	inboundService := InboundService{}
	settingService := SettingService{}
	multiMode, _ := settingService.GetMultiNodeMode()
	xrayService := XrayService{}
	// Get clients that are being enabled/disabled
	var clientsToUpdate []model.ClientEntity
	err = db.Where("id IN ? AND user_id = ?", clientIds, userId).Find(&clientsToUpdate).Error
	if err == nil {
		for _, client := range clientsToUpdate {
			// Get all inbound IDs for this client
			clientInboundIds, err := s.GetInboundIdsForClient(client.Id)
			if err == nil {
				for _, inboundId := range clientInboundIds {
					inbound, err := inboundService.GetInbound(inboundId)
					if err != nil {
						continue
					}
					if !model.IsXrayInboundProtocol(inbound.Protocol) {
						continue
					}

					if enable {
						// Enable: Add user via Xray API
						// Build client data for Xray API
						clientData := make(map[string]interface{})
						clientData["email"] = client.Name

						switch inbound.Protocol {
						case model.Trojan:
							clientData["password"] = client.Password
						case model.Mixed:
							clientData["password"] = client.Password
							u := client.Name
							if i := strings.IndexByte(u, '@'); i > 0 {
								u = u[:i]
							}
							if u == "" {
								u = "user"
							}
							clientData["user"] = u
							clientData["pass"] = client.Password
						case model.Hysteria, model.Hysteria2:
							clientData["auth"] = client.Password
						case model.Shadowsocks:
							if cipher := ShadowsocksCipherForAddUser(inbound.Settings); cipher != "" {
								clientData["cipher"] = cipher
							}
							clientData["password"] = client.Password
						case model.VMESS, model.VLESS:
							clientData["id"] = client.UUID
							if inbound.Protocol == model.VMESS && client.Security != "" {
								clientData["security"] = client.Security
							}
							if inbound.Protocol == model.VLESS {
								if f := VLESSEffectiveFlow(inbound.Settings, inbound.StreamSettings, inbound.Protocol); f != "" {
									clientData["flow"] = f
								}
							}
						}

						// Single mode: instantly update config.json
						if !multiMode {
							if xrayService.IsXrayRunning() {
								processConfig := xrayService.GetConfig()
								if processConfig != nil {
									if enable {
										// Instantly add client to config.json
										if err := xray.UpdateConfigFileAfterUserAddition(processConfig, inbound.Tag, clientData); err != nil {
											logger.Warningf("BulkEnable: failed to instantly add client %s to config.json: %v", client.Name, err)
											needRestart = true
										} else {
											logger.Infof("BulkEnable: instantly added client %s to config.json (inbound: %s)", client.Name, inbound.Tag)
											needRestart = true
										}
									} else {
										// Instantly remove client from config.json
										if err := xray.UpdateConfigFileAfterUserRemoval(processConfig, inbound.Tag, client.Name); err != nil {
											logger.Warningf("BulkEnable: failed to instantly remove client %s from config.json: %v", client.Name, err)
											needRestart = true
										} else {
											logger.Infof("BulkEnable: instantly removed client %s from config.json (inbound: %s)", client.Name, inbound.Tag)
											needRestart = true
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Update Settings for affected inbounds (needed to keep DB in sync)
	// But if API operations were successful, we don't need to send full config to nodes
	// Note: updateInboundWithRetry will not send notifications if only Settings changed
	// (thanks to the real changes check in UpdateInbound)
	for inboundId := range affectedInboundIds {
		inbound, err := inboundService.GetInbound(inboundId)
		if err != nil {
			continue
		}

		clientEntities, err := s.GetClientsForInbound(inboundId)
		if err != nil {
			continue
		}

		newSettings, err := inboundService.BuildSettingsFromClientEntities(inbound, clientEntities)
		if err != nil {
			continue
		}

		// Update inbound Settings in DB (to keep database in sync)
		// This will not trigger notification because only Settings changed
		inbound.Settings = newSettings
		_, inboundNeedRestart, err := inboundService.updateInboundWithRetry(inbound)
		if err != nil {
			logger.Warningf("Failed to update inbound %d settings: %v", inboundId, err)
		} else if inboundNeedRestart {
			needRestart = true
		}
	}

	// Multi-node: sync only workers hosting affected inbounds; single-node: async local restart.
	if needRestart {
		inboundIDs := make([]int, 0, len(affectedInboundIds))
		for inboundID := range affectedInboundIds {
			inboundIDs = append(inboundIDs, inboundID)
		}
		if multiMode {
			xrayService.SyncWorkerXrayForInboundsAsync(inboundIDs)
			return false, nil
		}
		logger.Debugf("BulkEnable: scheduling async restart to apply changes")
		go func() {
			if err := xrayService.RestartXray(false); err != nil {
				logger.Warningf("BulkEnable: failed to restart Xray: %v", err)
			} else {
				logger.Debugf("BulkEnable: Xray restarted successfully (config synced)")
			}
		}()
		return false, nil
	}

	// Note: Notifications are now handled by the caller (e.g., bulkEnable controller)
	// to allow sending group-level notifications instead of per-client notifications

	return needRestart, nil
}

// BulkSetHWIDLimit sets HWID limit for multiple clients.
func (s *ClientService) BulkSetHWIDLimit(userId int, clientIds []int, maxHwid int, enabled bool) error {
	if len(clientIds) == 0 {
		return nil
	}

	// Verify all clients belong to user
	db := database.GetDB()
	var count int64
	err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error
	if err != nil {
		return err
	}
	if int(count) != len(clientIds) {
		return common.NewError("Some clients not found or access denied")
	}

	// Update HWID settings
	err = db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Updates(map[string]interface{}{
			"hwid_enabled": enabled,
			"max_hwid":     maxHwid,
		}).Error

	if err != nil {
		return err
	}

	return nil
}

// BulkAssignInbounds assigns inbounds to multiple clients.
// mode controls the merge strategy:
//   - "replace" (default): the selected inboundIds become the exact set for each client
//     (adds missing ones AND removes any that are no longer selected).
//   - "add": legacy union behaviour — only adds, never removes.
//
// Returns whether Xray needs restart and any error.
func (s *ClientService) BulkAssignInbounds(userId int, clientIds []int, inboundIds []int, mode string) (bool, error) {
	if len(clientIds) == 0 {
		return false, nil
	}
	if mode != "add" {
		mode = "replace" // default
	}

	// Verify all clients belong to user
	db := database.GetDB()
	var clientCount int64
	err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&clientCount).Error
	if err != nil {
		return false, err
	}
	if int(clientCount) != len(clientIds) {
		return false, common.NewError("Some clients not found or access denied")
	}

	// Verify all inbounds belong to user (skip when replacing with empty set)
	inboundService := InboundService{}
	for _, inboundId := range inboundIds {
		inbound, err := inboundService.GetInbound(inboundId)
		if err != nil {
			return false, common.NewErrorf("Inbound not found: %d", inboundId)
		}
		if inbound.UserId != userId {
			return false, common.NewErrorf("Inbound access denied: %d", inboundId)
		}
	}

	needRestart := false

	// Get clients to update
	var clients []model.ClientEntity
	err = db.Where("id IN ? AND user_id = ?", clientIds, userId).Find(&clients).Error
	if err != nil {
		return false, err
	}

	for _, client := range clients {
		var newInboundIds []int

		if mode == "add" {
			// Legacy: union of current + requested
			currentInboundIds, err := s.GetInboundIdsForClient(client.Id)
			if err != nil {
				continue
			}
			inboundIdSet := make(map[int]bool, len(currentInboundIds)+len(inboundIds))
			for _, id := range currentInboundIds {
				inboundIdSet[id] = true
			}
			for _, id := range inboundIds {
				inboundIdSet[id] = true
			}
			newInboundIds = make([]int, 0, len(inboundIdSet))
			for id := range inboundIdSet {
				newInboundIds = append(newInboundIds, id)
			}
		} else {
			// Replace: requested set is the exact new assignment
			newInboundIds = append([]int(nil), inboundIds...)
		}

		client.InboundIds = newInboundIds
		clientNeedRestart, err := s.UpdateClient(userId, &client)
		if err != nil {
			logger.Warningf("Failed to update client %d inbounds: %v", client.Id, err)
			continue
		}
		if clientNeedRestart {
			needRestart = true
		}
	}

	return needRestart, nil
}

// BulkSetExpiry sets the expiry timestamp (Unix ms) for all given clients.
// expiryTime == 0 means no expiry (unlimited).
func (s *ClientService) BulkSetExpiry(userId int, clientIds []int, expiryTime int64) error {
	if len(clientIds) == 0 {
		return nil
	}
	db := database.GetDB()
	var count int64
	if err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error; err != nil {
		return err
	}
	if int(count) != len(clientIds) {
		return common.NewError("some clients not found or access denied")
	}
	return db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Update("expiry_time", expiryTime).Error
}

// BulkSetTrafficLimit sets the total traffic cap (bytes) for all given clients.
// totalGB == 0 means unlimited.
func (s *ClientService) BulkSetTrafficLimit(userId int, clientIds []int, totalGB int64) error {
	if len(clientIds) == 0 {
		return nil
	}
	db := database.GetDB()
	var count int64
	if err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error; err != nil {
		return err
	}
	if int(count) != len(clientIds) {
		return common.NewError("some clients not found or access denied")
	}
	return db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Update("total_gb", float64(totalGB)).Error
}

// BulkSetIPLimit sets IP connection limit for all given clients.
func (s *ClientService) BulkSetIPLimit(userId int, clientIds []int, maxIPs int, enabled bool) error {
	if len(clientIds) == 0 {
		return nil
	}
	db := database.GetDB()
	var count int64
	if err := db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Count(&count).Error; err != nil {
		return err
	}
	if int(count) != len(clientIds) {
		return common.NewError("some clients not found or access denied")
	}
	return db.Model(&model.ClientEntity{}).
		Where("id IN ? AND user_id = ?", clientIds, userId).
		Updates(map[string]interface{}{
			"ip_limit_enabled": enabled,
			"max_ips":          maxIPs,
		}).Error
}
