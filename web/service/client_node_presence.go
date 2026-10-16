package service

import (
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Persistent per-node client presence ("last connection node").
//
// Key choice: rows are keyed by client_id (FK to client_entities, ON DELETE CASCADE) rather than by name.
// Online emails from Xray are client names, but names are only unique per user, can be remapped (WireGuard,
// Telemt) and ids give free cleanup. The name->id step is a single query per poll for the online names only;
// if the same name exists for two users (they share one Xray email anyway) both ids get the observation.
//
// Single-node/local mode: CollectNodeStats returns early without multi-node mode and the code has no notion of a
// "local node" row in nodes, so nothing is recorded there (rows from earlier multi-node use are kept).

const (
	// presenceWriteInterval throttles last_seen_at updates per (client,node) pair.
	presenceWriteInterval = 30 * time.Second
	// presenceSessionGap: a gap longer than this between observations counts as a new session.
	presenceSessionGap = 10 * time.Minute
	// presenceCacheTTL bounds how stale the in-memory copy of the table may get besides explicit invalidation.
	presenceCacheTTL  = 20 * time.Second
	presenceBatchSize = 1000
)

type presencePair struct{ ClientID, NodeID int }

// presenceObs is one observation to persist (unix ms).
type presenceObs struct {
	ClientID, NodeID int
	At               int64
}

// planPresenceWrites returns the observations that must be written now: pairs never written by this process
// or last written at least interval ms ago. It does not mutate written.
func planPresenceWrites(obs []presenceObs, written map[presencePair]int64, intervalMs int64) []presenceObs {
	out := make([]presenceObs, 0, len(obs))
	for _, o := range obs {
		if last, ok := written[presencePair{o.ClientID, o.NodeID}]; ok && o.At-last < intervalMs {
			continue
		}
		out = append(out, o)
	}
	return out
}

// buildPresenceObs expands "node -> online lower-case names" into per-client-id observations.
func buildPresenceObs(onlineByNode map[int]map[string]struct{}, nameToIDs map[string][]int, at int64) []presenceObs {
	var out []presenceObs
	for nodeID, names := range onlineByNode {
		for name := range names {
			for _, id := range nameToIDs[name] {
				out = append(out, presenceObs{ClientID: id, NodeID: nodeID, At: at})
			}
		}
	}
	return out
}

// orderConnectedNodes sorts newest first; ties: online node first, then lowest node id (deterministic).
func orderConnectedNodes(list []model.ClientConnectedNode) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.LastSeenAt != b.LastSeenAt {
			return a.LastSeenAt > b.LastSeenAt
		}
		if a.Online != b.Online {
			return a.Online
		}
		return a.NodeId < b.NodeId
	})
}

var (
	presenceWriteMu sync.Mutex
	presenceWritten = make(map[presencePair]int64)

	presenceCacheMu       sync.Mutex
	presenceCacheByClient map[int][]model.ClientConnectedNode
	presenceCacheLoadedAt time.Time
	presenceCacheDirty    = true

	// live online state, replaced every poll
	panelOnlineNodesMu sync.RWMutex
	panelOnlineNodes   map[string][]int // lower(name) -> node ids online now
	panelOnlinePolled  int64            // unix ms of the poll that produced panelOnlineNodes
)

// setPanelClientLastConnectedNodes replaces the live "online on which nodes" map (nil clears it).
func setPanelClientLastConnectedNodes(m map[string][]int) {
	panelOnlineNodesMu.Lock()
	defer panelOnlineNodesMu.Unlock()
	if len(m) == 0 {
		panelOnlineNodes = nil
		return
	}
	panelOnlineNodes = make(map[string][]int, len(m))
	for email, ids := range m {
		k := strings.ToLower(strings.TrimSpace(email))
		if k != "" && len(ids) > 0 {
			panelOnlineNodes[k] = append([]int(nil), ids...)
		}
	}
	panelOnlinePolled = time.Now().UnixMilli()
}

func panelClientOnlineNodeIDs(name string) (ids []int, polledAt int64) {
	k := strings.ToLower(strings.TrimSpace(name))
	if k == "" {
		return nil, 0
	}
	panelOnlineNodesMu.RLock()
	defer panelOnlineNodesMu.RUnlock()
	return panelOnlineNodes[k], panelOnlinePolled
}

// recordClientNodePresence persists observations with one name lookup and one batched upsert per chunk.
// Errors are logged only: presence is informational and must never break stats collection.
func recordClientNodePresence(onlineByNode map[int]map[string]struct{}, at int64) {
	names := make(map[string]struct{})
	for _, set := range onlineByNode {
		for n := range set {
			names[n] = struct{}{}
		}
	}
	if len(names) == 0 {
		return
	}
	db := database.GetDB()
	if db == nil {
		return
	}
	nameList := make([]string, 0, len(names))
	for n := range names {
		nameList = append(nameList, n)
	}
	nameToIDs := make(map[string][]int, len(nameList))
	for i := 0; i < len(nameList); i += presenceBatchSize {
		end := i + presenceBatchSize
		if end > len(nameList) {
			end = len(nameList)
		}
		var rows []struct {
			Id   int
			Name string
		}
		if err := db.Model(&model.ClientEntity{}).Select("id, LOWER(TRIM(name)) AS name").
			Where("LOWER(TRIM(name)) IN ?", nameList[i:end]).Scan(&rows).Error; err != nil {
			logger.Warningf("client presence: resolve names: %v", err)
			return
		}
		for _, r := range rows {
			nameToIDs[r.Name] = append(nameToIDs[r.Name], r.Id)
		}
	}
	obs := buildPresenceObs(onlineByNode, nameToIDs, at)

	presenceWriteMu.Lock()
	defer presenceWriteMu.Unlock()
	todo := planPresenceWrites(obs, presenceWritten, presenceWriteInterval.Milliseconds())
	// forget pairs not seen for an hour so the map cannot grow without bound
	for p, t := range presenceWritten {
		if at-t > int64(time.Hour/time.Millisecond) {
			delete(presenceWritten, p)
		}
	}
	if len(todo) == 0 {
		return
	}
	wrote := false
	for i := 0; i < len(todo); i += presenceBatchSize {
		end := i + presenceBatchSize
		if end > len(todo) {
			end = len(todo)
		}
		if err := upsertPresence(db, todo[i:end]); err != nil {
			// e.g. FK violation when a client/node was deleted mid-poll; next poll re-resolves.
			logger.Warningf("client presence: upsert: %v", err)
			continue
		}
		for _, o := range todo[i:end] {
			presenceWritten[presencePair{o.ClientID, o.NodeID}] = o.At
		}
		wrote = true
	}
	if wrote {
		invalidatePresenceCache()
	}
}

func upsertPresence(db *gorm.DB, obs []presenceObs) error {
	rows := make([]model.ClientNodePresence, 0, len(obs))
	for _, o := range obs {
		rows = append(rows, model.ClientNodePresence{ClientID: o.ClientID, NodeID: o.NodeID, FirstSeenAt: o.At, LastSeenAt: o.At, Sessions: 1})
	}
	gap := presenceSessionGap.Milliseconds()
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "client_id"}, {Name: "node_id"}},
		DoUpdates: clause.Set{
			{Column: clause.Column{Name: "last_seen_at"}, Value: gorm.Expr("GREATEST(client_node_presence.last_seen_at, EXCLUDED.last_seen_at)")},
			{Column: clause.Column{Name: "sessions"}, Value: gorm.Expr("client_node_presence.sessions + CASE WHEN EXCLUDED.last_seen_at - client_node_presence.last_seen_at > ? THEN 1 ELSE 0 END", gap)},
		},
	}).Create(&rows).Error
}

func invalidatePresenceCache() {
	presenceCacheMu.Lock()
	presenceCacheDirty = true
	presenceCacheMu.Unlock()
}

// presenceFor returns a copy of the persisted entries for a client (reloading the whole table with one query when stale).
func presenceFor(clientID int) []model.ClientConnectedNode {
	presenceCacheMu.Lock()
	defer presenceCacheMu.Unlock()
	if presenceCacheDirty || presenceCacheByClient == nil || time.Since(presenceCacheLoadedAt) > presenceCacheTTL {
		if db := database.GetDB(); db != nil {
			var rows []struct {
				ClientID   int
				NodeID     int
				LastSeenAt int64
				NodeName   string
			}
			err := db.Table("client_node_presence AS p").
				Select("p.client_id, p.node_id, p.last_seen_at, n.name AS node_name").
				Joins("INNER JOIN nodes AS n ON n.id = p.node_id").Scan(&rows).Error
			if err != nil {
				logger.Debugf("client presence: reload: %v", err)
				presenceCacheLoadedAt = time.Now() // back off; keep the previous copy
			} else {
				m := make(map[int][]model.ClientConnectedNode)
				for _, r := range rows {
					m[r.ClientID] = append(m[r.ClientID], model.ClientConnectedNode{NodeId: r.NodeID, NodeName: r.NodeName, LastSeenAt: r.LastSeenAt})
				}
				presenceCacheByClient = m
				presenceCacheLoadedAt = time.Now()
				presenceCacheDirty = false
			}
		}
	}
	src := presenceCacheByClient[clientID]
	return append([]model.ClientConnectedNode(nil), src...)
}

// mergeConnectedNodes overlays the live online set on persisted entries and fills the client fields.
// Online nodes get last-seen = poll time (the DB value is throttled and may lag by up to the write interval).
func mergeConnectedNodes(c *model.ClientEntity, stored []model.ClientConnectedNode, onlineIDs []int, polledAt int64) {
	online := make(map[int]bool, len(onlineIDs))
	for _, id := range onlineIDs {
		online[id] = true
	}
	for i := range stored {
		if online[stored[i].NodeId] {
			stored[i].Online = true
			if polledAt > stored[i].LastSeenAt {
				stored[i].LastSeenAt = polledAt
			}
		}
	}
	if len(stored) == 0 {
		return
	}
	orderConnectedNodes(stored)
	c.ConnectedNodes = stored
	c.LastConnectedNode = stored[0].NodeName
	c.LastConnectedNodeAt = stored[0].LastSeenAt
}

// MergePanelClientLastConnectedNodeInto fills LastConnectedNode, LastConnectedNodeAt and ConnectedNodes.
func MergePanelClientLastConnectedNodeInto(c *model.ClientEntity) {
	if c == nil || c.Id == 0 {
		return
	}
	stored := presenceFor(c.Id)
	if len(stored) == 0 {
		return
	}
	ids, polled := panelClientOnlineNodeIDs(c.Name)
	mergeConnectedNodes(c, stored, ids, polled)
}
