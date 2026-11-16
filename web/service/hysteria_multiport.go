package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
	"github.com/konstpic/sharx-code/v2/util/hysteria"
)

// IsHysteriaVersion2 reports whether the inbound speaks hysteria2 (version 2).
// Version 1 is selected by settings.version == 1 (same rule the share-link
// builder uses); every other hysteria/hysteria2 inbound is treated as v2.
func IsHysteriaVersion2(inbound *model.Inbound) bool {
	if inbound == nil {
		return false
	}
	if proto := model.NormalizeProtocol(inbound.Protocol); proto != model.Hysteria && proto != model.Hysteria2 {
		return false
	}
	var settings map[string]any
	json.Unmarshal([]byte(inbound.Settings), &settings)
	version, _ := settings["version"].(float64)
	return int(version) != 1
}

// streamSettingsMap unmarshals a streamSettings JSON blob. A malformed blob is
// reported as nil so the pre-existing validation paths surface it.
func streamSettingsMap(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var stream map[string]any
	if err := json.Unmarshal([]byte(raw), &stream); err != nil {
		return nil
	}
	return stream
}

func encodeStreamSettings(stream map[string]any) (string, bool) {
	if stream == nil {
		return "", false
	}
	body, err := json.MarshalIndent(stream, "", "  ")
	if err != nil {
		return "", false
	}
	return string(body), true
}

// ApplyHysteriaMultiPortOnSave validates and normalizes the panel-only
// streamSettings.hysteriaMultiPort range of a Hysteria2 inbound in place.
//
// The range never reaches Xray: it is stripped in BuildInboundXrayConfig and
// translated into host NAT rules (finalmask.UDPHopNatIntent). Keeping it in
// streamSettings means the regular full-object inbound write round-trips it
// without a database migration.
func ApplyHysteriaMultiPortOnSave(inbound *model.Inbound) error {
	if inbound == nil {
		return nil
	}
	stream := streamSettingsMap(inbound.StreamSettings)
	if stream == nil {
		return nil
	}
	raw, has := stream[hysteria.MultiPortKey]
	if !has {
		return nil
	}
	value, _ := raw.(string)

	// A range left over from a protocol switch (or set on v1) is removed
	// silently: only hysteria2 understands port hopping, and leaving it would
	// advertise a range the node has no rules for.
	if !IsHysteriaVersion2(inbound) {
		delete(stream, hysteria.MultiPortKey)
		if body, ok := encodeStreamSettings(stream); ok {
			inbound.StreamSettings = body
		}
		return nil
	}

	rangePort, present, err := hysteria.ValidateMultiPort(value, inbound.Port)
	if err != nil {
		return common.NewError("invalid hysteria2 multi-port:", err.Error())
	}
	if present && value == rangePort.String() {
		return nil // already normalized: do not re-render the JSON blob on every save
	}
	if !present {
		delete(stream, hysteria.MultiPortKey)
	} else {
		stream[hysteria.MultiPortKey] = rangePort.String()
	}
	if body, ok := encodeStreamSettings(stream); ok && body != inbound.StreamSettings {
		inbound.StreamSettings = body
		if present {
			logger.Debugf("hysteria2 multi-port normalized for inbound %q: %s", inbound.Tag, rangePort.String())
		}
	}
	return nil
}

// ValidateHysteriaMultiPortDeployment rejects a stored range the panel cannot
// serve. Port hopping relies on the node agent installing the NAT REDIRECT
// rules; in single-node mode the inbound is served by the panel's local core,
// which never runs udphopnat, so the link would advertise a range with no
// rules behind it.
func ValidateHysteriaMultiPortDeployment(inbound *model.Inbound, multiNode bool) error {
	if inbound == nil {
		return nil
	}
	stream := streamSettingsMap(inbound.StreamSettings)
	if _, ok := hysteria.MultiPortFromStream(stream); !ok {
		return nil
	}
	if !multiNode {
		return common.NewError("invalid hysteria2 multi-port:",
			"port hopping requires multi-node mode — the node agent installs the NAT redirect rules, the local panel core does not")
	}
	return nil
}

// multiPortPeer is one co-located inbound considered by the conflict check.
type multiPortPeer struct {
	InboundID int
	Tag       string
	Port      int
	Range     hysteria.MultiPort
	HasRange  bool
	UDP       bool
}

func multiPortPeerLabel(p multiPortPeer) string {
	if strings.TrimSpace(p.Tag) != "" {
		return p.Tag
	}
	return fmt.Sprintf("#%d", p.InboundID)
}

// hysteriaMultiPortConflicts lists the reasons a range cannot coexist with the
// given peers on the same node. A node REDIRECTs every UDP packet addressed to
// a port of the range onto the inbound listener, so:
//
//   - a range covering another UDP listener steals that inbound's traffic;
//   - two ranges that intersect make the first REDIRECT win, so the other
//     inbound silently loses its hopping.
func hysteriaMultiPortConflicts(own hysteria.MultiPort, listenerPort int, peers []multiPortPeer) []string {
	var problems []string
	for _, p := range peers {
		if p.UDP && p.Port != listenerPort && own.Contains(p.Port) {
			problems = append(problems, fmt.Sprintf(
				"range %s covers UDP port %d of inbound %q on the same node — the NAT redirect would steal its traffic",
				own.String(), p.Port, multiPortPeerLabel(p)))
		}
		if p.HasRange && p.Range.Intersects(own) {
			problems = append(problems, fmt.Sprintf(
				"range %s overlaps multi-port range %s of inbound %q on the same node",
				own.String(), p.Range.String(), multiPortPeerLabel(p)))
		}
		if p.HasRange && p.UDP && p.Port != listenerPort && p.Range.Contains(listenerPort) {
			problems = append(problems, fmt.Sprintf(
				"multi-port range %s of inbound %q covers this inbound's UDP port %d — that inbound's NAT redirect would steal its traffic",
				p.Range.String(), multiPortPeerLabel(p), listenerPort))
		}
	}
	return problems
}

// inboundNodeIDs returns the node ids the inbound is assigned to (empty in
// single-node mode or before the first assignment).
func inboundNodeIDs(inboundID int) []int {
	db := database.GetDB()
	if db == nil || inboundID <= 0 {
		return nil
	}
	var ids []int
	if err := db.Model(&model.InboundNodeMapping{}).Where("inbound_id = ?", inboundID).Pluck("node_id", &ids).Error; err != nil {
		logger.Warningf("hysteria2 multi-port: load node ids of inbound %d: %v", inboundID, err)
		return nil
	}
	return ids
}

// loadMultiPortPeers loads the other enabled inbounds placed on the same nodes.
func loadMultiPortPeers(inbound *model.Inbound, nodeIDs []int) []multiPortPeer {
	if inbound == nil || len(nodeIDs) == 0 {
		return nil
	}
	db := database.GetDB()
	if db == nil {
		return nil
	}
	var ids []int
	if err := db.Model(&model.InboundNodeMapping{}).
		Where("node_id IN ?", nodeIDs).
		Where("inbound_id <> ?", inbound.Id).
		Distinct().Pluck("inbound_id", &ids).Error; err != nil {
		logger.Warningf("hysteria2 multi-port: load co-located inbounds of %d: %v", inbound.Id, err)
		return nil
	}
	if len(ids) == 0 {
		return nil
	}
	var rows []model.Inbound
	if err := db.Where("id IN ? AND enable = ?", ids, true).Find(&rows).Error; err != nil {
		logger.Warningf("hysteria2 multi-port: load co-located inbound rows: %v", err)
		return nil
	}
	peers := make([]multiPortPeer, 0, len(rows))
	for _, row := range rows {
		stream := streamSettingsMap(row.StreamSettings)
		_, udpOK := finalmask.SidesFor(string(model.NormalizeProtocol(row.Protocol)), finalmask.StreamNetwork(stream), finalmask.StreamALPN(stream))
		p := multiPortPeer{InboundID: row.Id, Tag: row.Tag, Port: row.Port, UDP: udpOK}
		if r, ok := hysteria.MultiPortFromStream(stream); ok {
			p.Range, p.HasRange = r, true
		}
		peers = append(peers, p)
	}
	return peers
}

// ValidateHysteriaMultiPortOnNodes checks the inbound's range against the other
// enabled inbounds placed on the same nodes (see hysteriaMultiPortConflicts),
// and — when the inbound itself has no range — whether a neighbouring range
// would capture its own UDP listener. An inbound without nodes produces no
// error.
func ValidateHysteriaMultiPortOnNodes(inbound *model.Inbound, nodeIDs []int) error {
	if inbound == nil || len(nodeIDs) == 0 {
		return nil
	}
	stream := streamSettingsMap(inbound.StreamSettings)
	own, hasOwn := hysteria.MultiPortFromStream(stream)
	_, ownUDP := finalmask.SidesFor(string(model.NormalizeProtocol(inbound.Protocol)), finalmask.StreamNetwork(stream), finalmask.StreamALPN(stream))
	if !hasOwn && !ownUDP {
		return nil // neither hops nor listens UDP: nothing a REDIRECT could touch
	}
	peers := loadMultiPortPeers(inbound, nodeIDs)
	var problems []string
	if hasOwn {
		problems = hysteriaMultiPortConflicts(own, inbound.Port, peers)
	} else {
		// The new inbound does not hop itself, but a co-located range may
		// already cover its listener (mirror of the check above).
		for _, p := range peers {
			if p.HasRange && p.UDP && p.Range.Contains(inbound.Port) {
				problems = append(problems, fmt.Sprintf(
					"multi-port range %s of inbound %q on the same node covers this inbound's UDP port %d — the NAT redirect would steal its traffic",
					p.Range.String(), multiPortPeerLabel(p), inbound.Port))
			}
		}
	}
	if len(problems) == 0 {
		return nil
	}
	return common.NewError("invalid hysteria2 multi-port:", strings.Join(problems, "; "))
}

// validateHysteriaMultiPortForSavedInbound is the update-path entry point: it
// loads the inbound's node ids only when a UDP port-hopping range can matter,
// so ordinary inbound updates do not pay for the extra queries.
func validateHysteriaMultiPortForSavedInbound(inbound *model.Inbound) error {
	if inbound == nil {
		return nil
	}
	stream := streamSettingsMap(inbound.StreamSettings)
	if _, hasRange := hysteria.MultiPortFromStream(stream); !hasRange {
		if _, udpOK := finalmask.SidesFor(string(model.NormalizeProtocol(inbound.Protocol)), finalmask.StreamNetwork(stream), finalmask.StreamALPN(stream)); !udpOK {
			return nil
		}
	}
	return ValidateHysteriaMultiPortOnNodes(inbound, inboundNodeIDs(inbound.Id))
}
