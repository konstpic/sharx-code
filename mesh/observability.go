package mesh

import (
	"encoding/json"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"strconv"
	"time"
)

// numericText preserves 64-bit Raft counters and member IDs exactly. Missing
// measurements stay absent; a running etcd process alone is not quorum health.
func numericText(v any) string {
	switch n := v.(type) {
	case string:
		if _, e := strconv.ParseUint(n, 10, 64); e == nil {
			return n
		}
	case json.Number:
		if _, e := strconv.ParseUint(n.String(), 10, 64); e == nil {
			return n.String()
		}
	}
	return ""
}
func quorumView(records []Member, live []EtcdMember, healthy map[string]bool, details map[string]map[string]any) map[string]any {
	ids := map[string]string{}
	for _, m := range live {
		if !m.Learner {
			ids[m.ID] = m.Name
		}
	}
	leaderIDs := map[string]bool{}
	for _, d := range details {
		if id := numericText(d["leader"]); id != "" && id != "0" {
			leaderIDs[id] = true
		}
	}
	leader := ""
	if len(leaderIDs) == 1 {
		for id := range leaderIDs {
			leader = ids[id]
		}
	}
	rows := []map[string]any{}
	count := 0
	for _, m := range records {
		row := map[string]any{"name": m.Name, "endpoint": m.ClientURL, "healthy": healthy[m.Name], "leader": leader != "" && m.Name == leader}
		if healthy[m.Name] {
			count++
		}
		if d := details[m.Name]; d != nil {
			if version, ok := d["version"].(string); ok {
				row["version"] = version
			}
			for _, field := range [][2]string{{"raftTerm", "raft_term"}, {"raftIndex", "raft_index"}, {"raftAppliedIndex", "raft_applied_index"}} {
				if value := numericText(d[field[0]]); value != "" {
					row[field[1]] = value
				}
			}
			if text := numericText(d["dbSize"]); text != "" {
				if n, e := strconv.ParseUint(text, 10, 64); e == nil {
					row["db_size"] = n
				}
			}
		}
		rows = append(rows, row)
	}
	return map[string]any{"healthy": count, "size": len(records), "members": rows, "leader": leader, "quorum": len(records) > 0 && count >= len(records)/2+1, "observed_at": time.Now().Unix()}
}
func (c *Controller) readQuorum() map[string]any {
	healthy := map[string]bool{}
	details := map[string]map[string]any{}
	s, e := c.store()
	if e != nil {
		return quorumView(c.members, nil, healthy, details)
	}
	defer s.Client.CloseIdleConnections()
	var response struct {
		Members []EtcdMember `json:"members"`
	}
	if e = s.RPC(c.ctx, "/cluster/member/list", map[string]any{}, &response); e != nil {
		response.Members = nil
	}
	for _, m := range c.members {
		one := *s
		one.Endpoints = []string{m.ClientURL}
		var probe map[string]any
		healthy[m.Name] = one.RPC(c.ctx, "/kv/range", map[string]string{"key": protocol.B64(protocol.Prefix + "health")}, &probe) == nil
		var detail map[string]any
		if e = one.RPC(c.ctx, "/maintenance/status", map[string]any{}, &detail); e == nil {
			details[m.Name] = detail
		}
	}
	return quorumView(c.members, response.Members, healthy, details)
}
