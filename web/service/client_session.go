package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/conndrop"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/xray"
)

// ClientSessionNodeResult is online IP sessions for one panel Xray (local) or one worker.
type ClientSessionNodeResult struct {
	NodeID                *int                   `json:"nodeId,omitempty"`
	NodeName              string                 `json:"nodeName"`
	IsOfflineBlockedGroup bool                   `json:"isOfflineBlockedGroup,omitempty"`
	Sessions              []xray.OnlineIPSession `json:"sessions"`
	DropAvailable         bool                   `json:"dropAvailable"`
	Error                 string                 `json:"error,omitempty"`
}

// offlineBlockedDropAvailable reports whether conntrack drop can run for offline blocklist IPs
// (local panel in single-node mode, or any worker that already reported dropAvailable).
func offlineBlockedDropAvailable(results []ClientSessionNodeResult) bool {
	if conndrop.Available() {
		return true
	}
	for _, block := range results {
		if block.DropAvailable {
			return true
		}
	}
	return false
}

// mergeOfflineBlockedSessionRows appends a synthetic group for IPs on the session blocklist that no
// longer appear in Xray user-online stats (e.g. after IP routing block), so the UI can still unblock.
func mergeOfflineBlockedSessionRows(results []ClientSessionNodeResult, blockedIPs []string) []ClientSessionNodeResult {
	if len(blockedIPs) == 0 {
		return results
	}
	seen := make(map[string]struct{})
	for _, block := range results {
		for _, s := range block.Sessions {
			if n := NormalizeClientIP(s.IP); n != "" {
				seen[n] = struct{}{}
			}
		}
	}
	var extra []xray.OnlineIPSession
	for _, bip := range blockedIPs {
		n := NormalizeClientIP(bip)
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		extra = append(extra, xray.OnlineIPSession{IP: n, LastSeen: 0})
	}
	if len(extra) == 0 {
		return results
	}
	return append(results, ClientSessionNodeResult{
		NodeName:              "",
		IsOfflineBlockedGroup: true,
		Sessions:              extra,
		DropAvailable:         offlineBlockedDropAvailable(results),
	})
}

// ClientOnlineSessionsResponse aggregates results from local Xray and/or worker nodes.
type ClientOnlineSessionsResponse struct {
	Name              string                    `json:"name"`
	Results           []ClientSessionNodeResult `json:"results"`
	BlockedSessionIPs []string                  `json:"blockedSessionIps,omitempty"`
}

// ClientSessionService lists and drops per-IP client sessions (Xray user>>>clientName>>>online + conntrack).
// clientName is ClientEntity.Name, which is set as the Xray "email" field in the inbound config.
type ClientSessionService struct{}

// GetOnlineSessionsForClient returns sessions for the client on all relevant nodes (and local in single-mode).
func (s *ClientSessionService) GetOnlineSessionsForClient(userId, clientId int) (*ClientOnlineSessionsResponse, error) {
	cs := ClientService{}
	client, err := cs.GetClient(clientId)
	if err != nil {
		return nil, err
	}
	if client.UserId != userId {
		return nil, fmt.Errorf("client not found")
	}
	// client.Name is used as the Xray "email" key (see inbound.go: client["email"] = entity.Name)
	clientName := strings.TrimSpace(client.Name)
	if clientName == "" {
		return &ClientOnlineSessionsResponse{Name: clientName, Results: []ClientSessionNodeResult{}}, nil
	}

	blockSvc := ClientSessionBlockService{}
	blockedIPs, _ := blockSvc.ListBlockedSessionIPs(clientId)

	ss := SettingService{}
	multi, _ := ss.GetMultiNodeMode()

	out := &ClientOnlineSessionsResponse{Name: clientName, BlockedSessionIPs: blockedIPs, Results: []ClientSessionNodeResult{}}

	if !multi {
		xs := XrayService{}
		var sessions []xray.OnlineIPSession
		var xrayErr string
		if xs.IsXrayRunning() {
			apiPort := xs.GetAPIPort()
			api, cleanup, err := xs.GetOrCreateAPI(apiPort)
			if err != nil {
				xrayErr = err.Error()
			} else {
				defer cleanup()
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				xsSess, err := api.GetUserOnlineIPList(ctx, clientName, false)
				if err != nil {
					logger.Warningf("local user online IP list: %v", err)
					xrayErr = err.Error()
				} else {
					sessions = append(sessions, xsSess...)
				}
			}
		}
		sessions = append(sessions, CollectLocalTelemtOnlineSessions(clientName)...)
		errStr := ""
		if len(sessions) == 0 && xrayErr != "" {
			errStr = xrayErr
		}
		out.Results = append(out.Results, ClientSessionNodeResult{
			NodeName:      "Local",
			Sessions:      sessions,
			DropAvailable: conndrop.Available(),
			Error:         errStr,
		})
		out.Results = mergeOfflineBlockedSessionRows(out.Results, blockedIPs)
		return out, nil
	}

	// Multi-node: union of nodes assigned to this client's inbounds
	inboundIds, err := cs.GetInboundIdsForClient(clientId)
	if err != nil {
		return nil, err
	}
	nodeSvc := NodeService{}
	seen := make(map[int]struct{})
	for _, iid := range inboundIds {
		nodes, err := nodeSvc.GetNodesForInbound(iid)
		if err != nil {
			continue
		}
		for _, n := range nodes {
			if n == nil || !n.Enable {
				continue
			}
			if _, ok := seen[n.Id]; ok {
				continue
			}
			seen[n.Id] = struct{}{}
			sess, err := nodeSvc.GetUserOnlineSessionsFromNode(n, clientName, false)
			if err != nil {
				nid := n.Id
				out.Results = append(out.Results, ClientSessionNodeResult{
					NodeID:   &nid,
					NodeName: n.Name,
					Error:    err.Error(),
				})
				continue
			}
			nid := n.Id
			out.Results = append(out.Results, ClientSessionNodeResult{
				NodeID:        &nid,
				NodeName:      n.Name,
				Sessions:      sess.Sessions,
				DropAvailable: sess.DropAvailable,
			})
		}
	}
	out.Results = mergeOfflineBlockedSessionRows(out.Results, blockedIPs)
	return out, nil
}

// DropAllSessionsForClient resolves IPs from Xray online map and drops conntrack entries on each target (local and/or workers).
func (s *ClientSessionService) DropAllSessionsForClient(userId, clientId int) error {
	resp, err := s.GetOnlineSessionsForClient(userId, clientId)
	if err != nil {
		return err
	}
	clientName := strings.TrimSpace(resp.Name)
	if clientName == "" {
		return nil
	}
	ss := SettingService{}
	multi, _ := ss.GetMultiNodeMode()
	if !multi {
		if !conndrop.Available() {
			return conndrop.ErrConntrackUnavailable
		}
		xs := XrayService{}
		if !xs.IsXrayRunning() {
			return fmt.Errorf("xray is not running")
		}
		apiPort := xs.GetAPIPort()
		api, cleanup, err := xs.GetOrCreateAPI(apiPort)
		if err != nil {
			return err
		}
		defer cleanup()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		sessions, err := api.GetUserOnlineIPList(ctx, clientName, true)
		if err != nil {
			return err
		}
		ips := make([]string, 0, len(sessions))
		for _, se := range sessions {
			if se.IP != "" {
				ips = append(ips, se.IP)
			}
		}
		if len(ips) == 0 {
			return nil
		}
		return conndrop.DropIPs(ips)
	}

	// multi-node: call each worker's drop-connections
	nodeSvc := NodeService{}
	cs := ClientService{}
	inboundIds, _ := cs.GetInboundIdsForClient(clientId)
	seen := make(map[int]struct{})
	for _, iid := range inboundIds {
		nodes, err := nodeSvc.GetNodesForInbound(iid)
		if err != nil {
			continue
		}
		for _, n := range nodes {
			if n == nil || !n.Enable {
				continue
			}
			if _, ok := seen[n.Id]; ok {
				continue
			}
			seen[n.Id] = struct{}{}
			if err := nodeSvc.PostDropConnectionsToNode(n, []string{clientName}); err != nil {
				return fmt.Errorf("node %s: %w", n.Name, err)
			}
		}
	}
	return nil
}

// DropSessionsByIPsForClient drops conntrack for specific IPs on nodes that have this client (multi) or local (single).
func (s *ClientSessionService) DropSessionsByIPsForClient(userId, clientId int, ips []string) error {
	if len(ips) == 0 {
		return nil
	}
	if !conndrop.Available() {
		return conndrop.ErrConntrackUnavailable
	}
	cs := ClientService{}
	client, err := cs.GetClient(clientId)
	if err != nil {
		return err
	}
	if client.UserId != userId {
		return fmt.Errorf("client not found")
	}
	ss := SettingService{}
	multi, _ := ss.GetMultiNodeMode()
	if !multi {
		return conndrop.DropIPs(ips)
	}
	nodeSvc := NodeService{}
	seen := make(map[int]struct{})
	inboundIds, _ := cs.GetInboundIdsForClient(clientId)
	for _, iid := range inboundIds {
		nodes, err := nodeSvc.GetNodesForInbound(iid)
		if err != nil {
			continue
		}
		for _, n := range nodes {
			if n == nil || !n.Enable {
				continue
			}
			if _, ok := seen[n.Id]; ok {
				continue
			}
			seen[n.Id] = struct{}{}
			if err := nodeSvc.PostDropIPsToNode(n, ips); err != nil {
				return fmt.Errorf("node %s: %w", n.Name, err)
			}
		}
	}
	return nil
}
