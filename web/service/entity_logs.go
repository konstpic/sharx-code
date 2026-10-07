package service

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/websocket"
)

// EntityLogQuery filters a per-entity journal (Nodes -> node -> Logs, Balancers -> balancer -> Logs).
type EntityLogQuery struct {
	Count      int      // newest N after filtering (default 500, max 100000 for downloads)
	Level      string   // minimum level: debug|info|warn|error (default info)
	Levels     []string // exact level set (the level chips); overrides Level when not empty
	Component  string   // comma-separated components (xray, amneziawg, telemt, config, health, connection, ...)
	Q          string   // case-insensitive terms, all must be present; a term starting with "-" must be absent
	Since      int64    // unix ms; only newer entries
	Until      int64    // unix ms; only older entries (0 = now)
	components map[string]bool
	terms      []string
	notTerms   []string
}

// MaxLogCount bounds one request; downloads may ask for the large end.
const MaxLogCount = 100000

func (q *EntityLogQuery) normalize() {
	if q.Count <= 0 {
		q.Count = 500
	}
	if q.Count > MaxLogCount {
		q.Count = MaxLogCount
	}
	if strings.TrimSpace(q.Level) == "" {
		q.Level = "info"
	}
	if len(q.Levels) > 0 {
		q.Level = "debug" // read everything, the exact set is applied in match()
	}
	q.components = map[string]bool{}
	for _, c := range strings.Split(q.Component, ",") {
		if c = strings.TrimSpace(c); c != "" {
			q.components[c] = true
		}
	}
	q.Q = strings.ToLower(strings.TrimSpace(q.Q))
	for _, t := range strings.Fields(q.Q) {
		if strings.HasPrefix(t, "-") && len(t) > 1 {
			q.notTerms = append(q.notTerms, t[1:])
		} else {
			q.terms = append(q.terms, t)
		}
	}
}

func (q EntityLogQuery) match(e websocket.UnifiedLogEntry) bool {
	if len(q.components) > 0 && !q.components[e.Component] {
		return false
	}
	if q.Since > 0 && e.Ts <= q.Since {
		return false
	}
	if q.Until > 0 && e.Ts > q.Until {
		return false
	}
	if len(q.Levels) == 0 && levelOrder(e.Level) < levelOrder(q.Level) {
		return false
	}
	if len(q.Levels) > 0 {
		ok := false
		for _, l := range q.Levels {
			if strings.EqualFold(l, e.Level) || (l == "warn" && e.Level == "warning") {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if len(q.terms) == 0 && len(q.notTerms) == 0 {
		return true
	}
	hay := strings.ToLower(e.Message + " " + e.Component + " " + e.ConnID)
	for _, t := range q.terms {
		if !strings.Contains(hay, t) {
			return false
		}
	}
	for _, t := range q.notTerms {
		if strings.Contains(hay, t) {
			return false
		}
	}
	return true
}

// EntityLogResult is the journal of one node or balancer, newest first.
type EntityLogResult struct {
	Entries []websocket.UnifiedLogEntry `json:"entries"`
	// Components lists the components present in the (unfiltered by component) result, to build the filter.
	Components []string `json:"components"`
	// Volume is the log volume over the requested window by level, for the histogram above the list.
	Volume []VolumeBucket `json:"volume"`
	// Total is how many entries matched before Count was applied.
	Total int `json:"total"`
	// AgentLogLevel is the balancer agent's journal level (info|debug); empty for nodes or when the agent is unreachable.
	AgentLogLevel string `json:"agentLogLevel,omitempty"`
	// AgentError explains why the agent's own journal is missing from a balancer result.
	AgentError string `json:"agentError,omitempty"`
}

// VolumeBucket is one bar of the histogram.
type VolumeBucket struct {
	T     int64 `json:"t"` // bucket start, unix ms
	Debug int   `json:"debug"`
	Info  int   `json:"info"`
	Warn  int   `json:"warn"`
	Error int   `json:"error"`
}

func volumeOf(entries []websocket.UnifiedLogEntry, from, to int64) []VolumeBucket {
	if len(entries) == 0 {
		return []VolumeBucket{}
	}
	if from <= 0 {
		from = entries[len(entries)-1].Ts // entries are newest first
	}
	if to <= 0 || to < from {
		to = entries[0].Ts + 1
	}
	const n = 60
	step := (to - from) / n
	if step < 1000 {
		step = 1000
	}
	cnt := int((to-from)/step) + 1
	out := make([]VolumeBucket, cnt)
	for i := range out {
		out[i].T = from + int64(i)*step
	}
	for _, e := range entries {
		i := int((e.Ts - from) / step)
		if i < 0 || i >= cnt {
			continue
		}
		switch e.Level {
		case "error":
			out[i].Error++
		case "warn", "warning":
			out[i].Warn++
		case "debug":
			out[i].Debug++
		default:
			out[i].Info++
		}
	}
	return out
}

// GetEntityLogs returns the journal of one entity. Panel-side events and, for nodes, the entries the node pushed to the
// panel come from the panel log; for a balancer the agent's own journal is fetched live and merged in.
func (s *ServerService) GetEntityLogs(entityType, entityID string, q EntityLogQuery) EntityLogResult {
	q.normalize()
	entityType, entityID = strings.ToLower(strings.TrimSpace(entityType)), strings.TrimSpace(entityID)

	var all []websocket.UnifiedLogEntry
	if entityType == "audit" {
		all = auditEntries(q.Since, q.Until, MaxLogCount)
		return finishEntityLogs(all, EntityLogResult{}, q)
	}
	stored := logger.ReadEntries(q.Since) // the whole log file, plus rotated archives when the window reaches that far
	if len(stored) == 0 {
		stored = logger.GetEntries(0, "debug", nil) // no log file (e.g. Grafana/Loki mode): use the in-memory buffer
	}
	for _, e := range stored {
		if !entryBelongsTo(e, entityType, entityID) {
			continue
		}
		u, ok := unifiedFromEntry(e)
		if !ok {
			continue
		}
		u.Message = logger.StripANSI(u.Message) // entries stored before capture stripped colours
		if u.Component == "xray" || u.Source == "xray" {
			// entries stored before the panel tidied xray lines on receipt
			clean, id, drop := logger.TidyXrayMessage(u.Message)
			if drop || clean == "" {
				continue
			}
			u.Message = clean
			if u.ConnID == "" {
				u.ConnID = id
			}
		}
		all = append(all, u)
	}
	res := EntityLogResult{}
	if entityType == "balancer" {
		if id, err := strconv.Atoi(entityID); err == nil {
			// The panel and agent journals have the same shape; a per-component filter is applied by the agent too.
			aq := EntityLogQuery{Count: 5000, Level: q.Level, Since: q.Since}
			entries, level, err := (&BalancerService{}).AgentLogs(id, aq)
			if err != nil {
				res.AgentError = err.Error()
			} else {
				res.AgentLogLevel = level
				for _, e := range entries {
					all = append(all, agentEntryToUnified(e))
				}
			}
		}
	}

	return finishEntityLogs(all, res, q)
}

// finishEntityLogs applies the query to the collected entries and builds the result (components, volume, newest N).
func finishEntityLogs(all []websocket.UnifiedLogEntry, res EntityLogResult, q EntityLogQuery) EntityLogResult {
	comps := map[string]bool{}
	for _, e := range all {
		if e.Component != "" {
			comps[e.Component] = true
		}
	}
	for c := range comps {
		res.Components = append(res.Components, c)
	}
	sort.Strings(res.Components)

	out := all[:0:0]
	for _, e := range all {
		if q.match(e) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Ts > out[j].Ts })
	res.Total = len(out)
	res.Volume = volumeOf(out, q.Since, q.Until)
	if len(out) > q.Count {
		out = out[:q.Count]
	}
	if out == nil {
		out = []websocket.UnifiedLogEntry{}
	}
	res.Entries = out
	return res
}

func entryBelongsTo(e logger.Entry, entityType, entityID string) bool {
	if entityType == "panel" {
		// The panel journal is what the panel itself did (actions, jobs, API). Node, xray and agent output has its own
		// journal under Nodes / Balancers and must not be duplicated here.
		return strings.EqualFold(e.Source, "panel") || e.Source == ""
	}
	if strings.EqualFold(e.EntityType, entityType) && e.EntityID == entityID {
		return true
	}
	// Entries pushed by a node before entity tags existed carry only the node id.
	return entityType == "node" && e.NodeID == entityID
}

func agentEntryToUnified(e logger.Entry) websocket.UnifiedLogEntry {
	ts := e.TsUnixMs
	if ts == 0 {
		ts = time.Now().UnixMilli()
	}
	return websocket.UnifiedLogEntry{
		Source: "balancer-agent", Level: strings.ToLower(e.Level), Channel: "service", Message: strings.TrimSpace(e.Msg), Ts: ts,
		Component: e.Component, ConnID: e.ConnID,
	}
}

func levelOrder(l string) int {
	switch strings.ToLower(strings.TrimSpace(l)) {
	case "error":
		return 4
	case "warn", "warning":
		return 3
	case "debug":
		return 1
	default:
		return 2 // info, notice, unknown
	}
}
