package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/network/client"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

// Sync mirrors coordinator state: own participant info, sessions of both roles,
// ledger entries, heartbeats for published nodes and consumer liveness.
// All steps are failure-isolated: a coordinator outage never blocks the panel.
func (s NetworkService) Sync() {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf("SharX Network sync panic (recovered): %v", r)
		}
	}()
	p, err := s.Participant()
	if err != nil || p == nil || p.ParticipantID == "" || !p.Enabled {
		return
	}
	cl, err := s.clientFor(p)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	me, err := cl.Me(ctx)
	if client.AuthenticationRejected(err) {
		s.quarantineLocalNetwork()
		_ = s.db().Model(&model.SnParticipant{}).Where("id=1").Updates(map[string]any{"status": "blocked", "enabled": false}).Error
		return
	}

	if err == nil {
		updates := map[string]any{"last_sync_at": time.Now().Unix(), "status": me.Status}

		_ = s.db().Model(&model.SnParticipant{}).Where("id = 1").Updates(updates).Error
	}

	s.syncSessions(ctx, cl, p, "provider", &p.SyncCursor)
	s.syncSessions(ctx, cl, p, "consumer", &p.SyncCursorConsumer)
	s.syncLedger(ctx, cl)
	s.heartbeatNodes(ctx, cl)
	s.refreshNodeSnapshots(ctx, cl)
	s.pushLiveness(ctx, cl)
}

func (s NetworkService) syncSessions(ctx context.Context, cl *client.Client, p *model.SnParticipant, role string, cursor *int64) {
	sessions, seq, err := cl.SyncSessions(ctx, role, *cursor)
	if err != nil {
		return
	}
	for i := range sessions {
		sess := sessions[i]
		if role == "provider" {
			s.applyProviderSession(&sess)
		} else {
			s.applyConsumerSession(&sess)
		}
	}
	if seq > *cursor {
		col := "sync_cursor"
		if role == "consumer" {
			col = "sync_cursor_consumer"
		}
		_ = s.db().Model(&model.SnParticipant{}).Where("id = 1").Update(col, seq).Error
		*cursor = seq
	}
}

func (s NetworkService) applyProviderSession(sess *protocol.Session) {
	linkJSON, _ := json.Marshal(sess.Link)
	var nodeID *int
	var localNode model.SnSharedNode
	if err := s.db().Where("coordinator_node_id = ?", sess.NodeID).First(&localNode).Error; err == nil {
		nodeID = &localNode.NodeId
	}
	rec := model.SnSession{
		Id: sess.ID, Role: "provider", CoordinatorNodeId: sess.NodeID,
		PeerParticipantId: sess.ConsumerID, NodeId: nodeID,
		ClientRef: sess.ClientRef, Protocol: sess.Protocol, QuotaGB: sess.QuotaGB,
		Status: sess.Status, Link: string(linkJSON), SyncSeq: sess.ChangeSeq,
		UsageUpBytes: sess.ServedUpBytes, UsageDownBytes: sess.ServedDownBytes,
		OpenedAt: sess.OpenedAt, ClosedAt: sess.ClosedAt, UpdatedAt: time.Now().Unix(),
	}
	if sess.Link != nil {
		rec.ClientEmail = sess.Link.ClientEmail
	}
	if err := s.db().Where("id = ?", rec.Id).Assign(rec).FirstOrCreate(&model.SnSession{}).Error; err != nil {
		logger.Warningf("network: mirror provider session: %v", err)
		return
	}
	s.maybeEnqueueProvision(sess, &localNode)
}

// maybeEnqueueProvision translates coordinator commands into the local at-least-once queue.
func (s NetworkService) maybeEnqueueProvision(sess *protocol.Session, localNode *model.SnSharedNode) {
	if localNode == nil || localNode.NodeId == 0 {
		return
	}
	if sess.Status == protocol.SessionProvisioning && sess.Link != nil && sess.Link.Provision != nil {
		payload, _ := json.Marshal(sess.Link.Provision)
		s.enqueueOnce(sess.ID, localNode.NodeId, "add_user", string(payload))
	}
	if (sess.Status == protocol.SessionClosing || sess.Status == protocol.SessionClosed) && sess.Link != nil {
		payload, _ := json.Marshal(map[string]any{"inbound_tag": sess.InboundTag, "email": sess.Link.ClientEmail, "probe_email": probeEmail(sess.Link.ProbeUUID), "session_id": sess.ID})
		s.enqueueOnce(sess.ID, localNode.NodeId, "remove_user", string(payload))
	}
}

func (s NetworkService) enqueueOnce(sessionID string, nodeID int, op, payload string) {
	var count int64
	s.db().Model(&model.SnProvisionQueue{}).
		Where("session_id = ? AND op = ? AND status IN ('pending','done')", sessionID, op).Count(&count)
	if count > 0 {
		return
	}
	_ = s.db().Create(&model.SnProvisionQueue{
		SessionID: sessionID, NodeId: nodeID, Op: op, Payload: payload,
		Status: "pending", NextAttemptAt: time.Now().Unix(),
	}).Error
}

func (s NetworkService) applyConsumerSession(sess *protocol.Session) {
	linkJSON, _ := json.Marshal(sess.Link)
	var existing model.SnSession
	found := s.db().First(&existing, "id = ?", sess.ID).Error == nil
	updates := map[string]any{
		"status": sess.Status, "link": string(linkJSON), "sync_seq": sess.ChangeSeq,
		"usage_up_bytes": sess.ServedUpBytes, "usage_down_bytes": sess.ServedDownBytes,
		"closed_at": sess.ClosedAt, "updated_at": time.Now().Unix(),
	}
	if sess.Link != nil {
		updates["client_email"] = sess.Link.ClientEmail
	}
	if !found {
		rec := model.SnSession{
			Id: sess.ID, Role: "consumer", CoordinatorNodeId: sess.NodeID,
			PeerParticipantId: sess.ProviderID,
			ClientRef:         sess.ClientRef, Protocol: sess.Protocol, QuotaGB: sess.QuotaGB,
			OpenedAt: sess.OpenedAt,
		}
		if err := s.db().Where("id = ?", rec.Id).Assign(rec).FirstOrCreate(&model.SnSession{}).Error; err != nil {
			return
		}
	}
	if err := s.db().Model(&model.SnSession{}).Where("id = ?", sess.ID).Updates(updates).Error; err != nil {
		return
	}
	var current model.SnSession
	if err := s.db().First(&current, "id = ?", sess.ID).Error; err != nil {
		return
	}
	if current.InboundId == nil {
		if err := s.ensureConsumerResources(&current); err != nil {
			logger.Warningf("network: create consumer resources for %s: %v", sess.ID, err)
			return
		}
	}
	s.setConsumerResourcesEnabled(sess.ID, sess.Status == protocol.SessionActive || sess.Status == protocol.SessionDegraded)
}

func (s NetworkService) syncLedger(ctx context.Context, cl *client.Client) {
	var participant model.SnParticipant
	if err := s.db().Select("ledger_cursor").First(&participant, "id = 1").Error; err != nil {
		return
	}
	entries, nextCursor, err := cl.Ledger(ctx, participant.LedgerCursor, 500)
	if err != nil {
		return
	}
	if nextCursor < participant.LedgerCursor {
		logger.Warningf("network: ledger cursor moved backwards: %d -> %d", participant.LedgerCursor, nextCursor)
		return
	}
	for i := range entries {
		e := entries[i]
		if err := s.db().Where("entry_uid = ?", e.EntryUID).Assign(model.SnLedgerMirror{
			EntryUID: e.EntryUID, Direction: e.Direction, AmountCredits: e.AmountCredits,
			AmountBytes: e.AmountBytes, CounterpartyParticipantID: e.CounterpartyID,
			SessionID: e.SessionID, Status: e.Status, Reason: e.Reason, Memo: e.Memo, Ts: e.Ts,
		}).FirstOrCreate(&model.SnLedgerMirror{}).Error; err != nil {
			return
		}
	}
	if nextCursor > participant.LedgerCursor {
		_ = s.db().Model(&model.SnParticipant{}).Where("id = 1").Update("ledger_cursor", nextCursor).Error
	}
}

func (s NetworkService) heartbeatNodes(ctx context.Context, cl *client.Client) {
	var pubs []model.SnSharedNode
	if err := s.db().Where("status = 'published' AND coordinator_node_id <> ''").Find(&pubs).Error; err != nil {
		return
	}
	nodeService := NodeService{}
	for i := range pubs {
		node, err := nodeService.GetNode(pubs[i].NodeId)
		if err != nil {
			continue
		}
		health := protocol.NodeHealth{Status: node.Status, XrayUp: node.XrayState == "running"}
		ns := NodeService{}
		if _, err := ns.networkQoSRequest(ctx, node, nil); err != nil {
			health.XrayUp = false
			health.Status = "offline"
		}
		if node.ResponseTime > 0 {
			health.RTTMs = float64(node.ResponseTime)
		}
		// Bandwidth: latest net load sample if the node reports it via stats job.
		var stats struct {
			NetBps int64 `gorm:"column:net_bps"`
		}
		_ = s.db().Raw(`SELECT net_bps FROM node_net_load_samples WHERE node_id = ? ORDER BY ts DESC LIMIT 1`, node.Id).Scan(&stats).Error
		_ = cl.NodeHeartbeat(ctx, pubs[i].CoordinatorNodeId, health, 0)
	}
}

func (s NetworkService) pushLiveness(ctx context.Context, cl *client.Client) {
	var sessions []model.SnSession
	if err := s.db().Where("role = 'consumer' AND status IN ('active','degraded')").Find(&sessions).Error; err != nil || len(sessions) == 0 {
		return
	}
	now := time.Now().Unix()
	items := make([]protocol.LivenessItem, 0, len(sessions))
	for i := range sessions {
		state := "idle"
		var lastOnline int64
		if sessions[i].InboundId != nil {
			_ = s.db().Raw(`SELECT COALESCE(MAX(ce.last_online), 0)
				FROM hosts h
				JOIN bundle_hosts bh ON bh.host_id = h.id
				JOIN client_bundles cb ON cb.bundle_id = bh.bundle_id
				JOIN client_entities ce ON ce.id = cb.client_id
				WHERE h.inbound_id = ? AND h.source = ?`, *sessions[i].InboundId, model.HostSourceNetwork).Scan(&lastOnline).Error
		} else if sessions[i].ClientEntityId != nil {
			_ = s.db().Model(&model.ClientEntity{}).Where("id = ?", *sessions[i].ClientEntityId).
				Select("last_online").Scan(&lastOnline).Error
		}
		if lastOnline/1000 >= now-600 { // ClientEntity timestamps are milliseconds
			state = "active"
		}
		items = append(items, protocol.LivenessItem{SessionID: sessions[i].Id, State: state, Ts: now})
	}
	_ = cl.PushLiveness(ctx, items)
}

// ProcessProvisionQueue dispatches pending node commands with exponential backoff.
func (s NetworkService) ProcessProvisionQueue() {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf("SharX Network provision panic (recovered): %v", r)
		}
	}()
	var items []model.SnProvisionQueue
	if err := s.db().Where("status = 'pending' AND next_attempt_at <= ?", time.Now().Unix()).Limit(20).Find(&items).Error; err != nil {
		return
	}
	nodeService := NodeService{}
	for i := range items {
		item := items[i]
		node, err := nodeService.GetNode(item.NodeId)
		if err != nil {
			s.failProvision(&item, "node not found")
			continue
		}
		var opErr error
		switch item.Op {
		case "add_user":
			var cmd protocol.ProvisionCommand
			if err := json.Unmarshal([]byte(item.Payload), &cmd); err != nil {
				s.failProvision(&item, "bad payload")
				continue
			}
			user := map[string]any{
				"email": cmd.ClientEmail,
				"id":    cmd.ClientUUID,
				"flow":  "xtls-rprx-vision",
				"level": 0,
			}
			opErr = nodeService.AddUserToNode(node, "vless", cmd.InboundTag, user)
			if opErr == nil && cmd.ProbeUUID != "" {
				probeUser := map[string]any{"email": probeEmail(cmd.ProbeUUID), "id": cmd.ProbeUUID, "flow": "xtls-rprx-vision", "level": 0}
				opErr = nodeService.AddUserToNode(node, "vless", cmd.InboundTag, probeUser)
			}
			if opErr == nil {
				if cl, _, err := s.activeClient(); err == nil {
					_ = cl.MarkProvisioned(context.Background(), item.SessionID)
				}
				// Bookkeeping entity: keeps node full-config rebuilds consistent and
				// attributes provider-side stats to a dedicated local record.
				s.ensureProviderClientEntity(cmd, item)
				if cmd.ProbeUUID != "" {
					probeCmd := cmd
					probeCmd.ClientEmail, probeCmd.ClientUUID = probeEmail(cmd.ProbeUUID), cmd.ProbeUUID
					s.ensureProviderClientEntity(probeCmd, item)
				}
			}
		case "remove_user":
			var cmd struct {
				InboundTag string `json:"inbound_tag"`
				Email      string `json:"email"`
				ProbeEmail string `json:"probe_email"`
			}
			if err := json.Unmarshal([]byte(item.Payload), &cmd); err != nil {
				s.failProvision(&item, "bad payload")
				continue
			}
			if cmd.ProbeEmail != "" {
				opErr = nodeService.RemoveUserFromNode(node, cmd.InboundTag, cmd.ProbeEmail)
				s.disableProviderClientEntity(cmd.ProbeEmail)
			}
			opErr = errors.Join(opErr, nodeService.RevokeNetworkUser(node, cmd.InboundTag, cmd.Email))
			s.disableProviderClientEntity(cmd.Email)
		default:
			s.failProvision(&item, "unknown op")
			continue
		}
		if opErr != nil {
			s.failProvision(&item, opErr.Error())
			continue
		}
		_ = s.db().Model(&model.SnProvisionQueue{}).Where("id = ?", item.Id).Updates(map[string]any{
			"status": "done", "updated_at": time.Now().Unix(),
		}).Error
	}
}

func (s NetworkService) failProvision(item *model.SnProvisionQueue, cause string) {
	attempts := item.Attempts + 1
	status := "pending"
	if attempts >= 10 {
		status = "failed"
		logger.Warningf("SharX Network: provision %s for session %s failed permanently: %s", item.Op, item.SessionID, cause)
	}
	backoff := int64(15 * (1 << min(attempts, 5)))
	_ = s.db().Model(&model.SnProvisionQueue{}).Where("id = ?", item.Id).Updates(map[string]any{
		"status": status, "attempts": attempts,
		"next_attempt_at": time.Now().Unix() + backoff, "updated_at": time.Now().Unix(),
	}).Error
}

// ensureProviderClientEntity creates the local ClientEntity backing a network user so
// full worker-config rebuilds keep the user and stats stay attributable.
func (s NetworkService) ensureProviderClientEntity(cmd protocol.ProvisionCommand, item model.SnProvisionQueue) {
	var count int64
	s.db().Model(&model.ClientEntity{}).Where("name = ?", cmd.ClientEmail).Count(&count)
	if count > 0 {
		return
	}
	var inbound model.Inbound
	if err := s.db().Where("tag = ?", cmd.InboundTag).First(&inbound).Error; err != nil {
		return
	}
	entity := model.ClientEntity{
		Name: cmd.ClientEmail, UUID: cmd.ClientUUID, Password: cmd.ClientUUID,
		Enable: true, SubID: randomHex(8), Comment: "SharX Network session " + item.SessionID[:8],
	}
	clientService := ClientService{}
	if _, err := clientService.AddClient(inbound.UserId, &entity); err != nil {
		logger.Warningf("network: create provider client entity: %v", err)
		return
	}
	_ = s.db().Create(&model.ClientInboundMapping{ClientId: entity.Id, InboundId: inbound.Id}).Error
}

func (s NetworkService) disableProviderClientEntity(email string) {
	_ = s.db().Model(&model.ClientEntity{}).Where("name = ?", email).Update("enable", false).Error
}

func (s NetworkService) providerUsageCounters(sess *model.SnSession) (int64, int64, bool) {
	var entity model.ClientEntity
	if err := s.db().Select("id").Where("name = ?", sess.ClientEmail).First(&entity).Error; err != nil {
		return 0, 0, false
	}
	var traffic model.ClientNodeTraffic
	if err := s.db().Where("client_id = ? AND node_id = ?", entity.Id, sess.NodeId).First(&traffic).Error; err != nil {
		return 0, 0, false
	}
	return traffic.Up, traffic.Down, true
}

// CollectUsage reports the worker's signed persistent network counters.
func (s NetworkService) CollectUsage() {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf("SharX Network usage panic (recovered): %v", r)
		}
	}()
	p, err := s.Participant()
	if err != nil || p == nil || p.ParticipantID == "" || !p.Enabled {
		return
	}
	cl, err := s.clientFor(p)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var pubs []model.SnSharedNode
	if err := s.db().Where("status = 'published'").Find(&pubs).Error; err != nil || len(pubs) == 0 {
		return
	}
	for i := range pubs {
		var sessions []model.SnSession
		_ = s.db().Where("role = 'provider' AND node_id = ? AND status IN ('active','degraded','disputed')", pubs[i].NodeId).Find(&sessions).Error
		for j := range sessions {
			sess := sessions[j]
			if sess.ClientEmail == "" {
				continue
			}

			var last model.SnUsageMirror
			hasLast := s.db().Where("session_id = ?", sess.Id).Order("seq DESC").First(&last).Error == nil
			var prevUp, prevDown int64
			seq := int64(1)
			if hasLast {
				prevUp, prevDown, seq = last.CumUpBytes, last.CumDownBytes, int64(last.Seq)+1
			}
			ns := NodeService{}
			node, err := ns.GetNode(pubs[i].NodeId)
			if err != nil {
				continue
			}
			var evidence protocol.NodeEvidence
			request := map[string]any{"node_id": pubs[i].CoordinatorNodeId, "provider_id": p.ParticipantID, "session_id": sess.Id, "email": sess.ClientEmail, "seq": seq}
			if err := ns.networkEvidenceRequest(ctx, node, request, &evidence); err != nil {
				continue
			}
			cumUp, cumDown := evidence.CumUpBytes, evidence.CumDownBytes

			deltaUp, deltaDown := cumUp-prevUp, cumDown-prevDown
			if deltaUp < 0 || deltaDown < 0 {
				// A local traffic reset establishes a new baseline without billing earlier traffic again.
				_ = s.db().Create(&model.SnUsageMirror{
					SessionID: sess.Id, Seq: int(seq), UpBytes: 0, DownBytes: 0,
					CumUpBytes: cumUp, CumDownBytes: cumDown, ReportedAt: time.Now().Unix(),
				}).Error
				continue
			}

			report := protocol.UsageReport{Evidence: &evidence,
				SessionID: sess.Id, Seq: seq, UpBytes: deltaUp, DownBytes: deltaDown,
				CumUpBytes: cumUp, CumDownBytes: cumDown, Ts: time.Now().Unix(),
			}
			if err := cl.SignUsageReport(&report); err != nil {
				continue
			}
			accepted, duplicates, err := cl.PushUsageReports(ctx, []protocol.UsageReport{report})
			if err != nil || accepted+duplicates == 0 {
				continue
			}
			_ = s.db().Create(&model.SnUsageMirror{
				SessionID: sess.Id, Seq: int(seq), UpBytes: deltaUp, DownBytes: deltaDown,
				CumUpBytes: cumUp, CumDownBytes: cumDown, ReportedAt: time.Now().Unix(),
			}).Error
		}
		// Traffic-limit enforcement: pause the publication when the limit is exhausted.
		s.enforceTrafficLimit(&pubs[i])
	}
}

func (s NetworkService) enforceTrafficLimit(pub *model.SnSharedNode) {
	var usedBytes int64
	s.db().Model(&model.SnSession{}).Where("role = 'provider' AND node_id = ?", pub.NodeId).
		Select("COALESCE(SUM(usage_up_bytes + usage_down_bytes),0)").Scan(&usedBytes)
	usedGB := float64(usedBytes) / 1e9
	if usedGB < pub.TrafficLimitGB {
		return
	}
	logger.Infof("SharX Network: node %d reached traffic limit (%.1f/%.1f GB); draining", pub.NodeId, usedGB, pub.TrafficLimitGB)
	_ = s.SetNodePaused(pub.Id, true)
}

// Probe users share the inbound policy but never enter the sn-* billing counters.
func probeEmail(id string) string {
	if id == "" {
		return ""
	}
	return "snv-" + id
}

// Refresh the coordinator's session and usage totals rather than keeping the
// snapshot from the initial publication forever.
func (s NetworkService) refreshNodeSnapshots(ctx context.Context, cl *client.Client) {
	nodes, err := cl.ListMyNodes(ctx)
	if err != nil {
		return
	}
	for _, node := range nodes {
		raw, err := json.Marshal(node)
		if err != nil {
			continue
		}
		_ = s.db().Model(&model.SnSharedNode{}).Where("coordinator_node_id = ?", node.ID).Updates(map[string]any{"coordinator_snapshot": string(raw), "price_credits_per_gb": node.PriceCreditsPerGB}).Error
	}
}
