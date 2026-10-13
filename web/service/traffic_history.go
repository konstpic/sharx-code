package service

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const trafficHistoryMinute int64 = 60_000

// No automatic deletion until a retention period is explicitly chosen.
const trafficHistoryMinuteRetentionDays = 0

type TrafficHistoryBytes struct {
	Upload   int64 `json:"upload"`
	Download int64 `json:"download"`
	Total    int64 `json:"total"`
}
type TrafficHistoryPoint struct {
	T        int64                       `json:"t"`
	Upload   *int64                      `json:"upload"`
	Download *int64                      `json:"download"`
	Total    *int64                      `json:"total"`
	Nodes    map[int]TrafficHistoryBytes `json:"nodes,omitempty"`
}
type TrafficHistoryNode struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	TrafficHistoryBytes
}
type TrafficHistoryResult struct {
	Points          []TrafficHistoryPoint `json:"points"`
	Nodes           []TrafficHistoryNode  `json:"nodes"`
	Cumulative      TrafficHistoryBytes   `json:"cumulative"`
	CumulativeNodes []TrafficHistoryNode  `json:"cumulativeNodes"`
	Baseline        TrafficHistoryBytes   `json:"baseline"`
	RangeStart      int64                 `json:"rangeStart"`
	RangeEnd        int64                 `json:"rangeEnd"`
	StartedAt       int64                 `json:"startedAt"`
	BucketSeconds   int                   `json:"bucketSeconds"`
}

type accountedTrafficSample struct {
	ID                   int
	BeforeUp, BeforeDown int64
	Up, Down             int64
	RawUp, RawDown       int64
}
type trafficHistoryBatch struct {
	At      int64
	Nodes   map[int]map[int]TrafficHistoryBytes
	Origins []model.TrafficHistoryOrigin
	Samples []accountedTrafficSample
}

func newTrafficHistoryBatch(at int64) *trafficHistoryBatch {
	return &trafficHistoryBatch{At: at, Nodes: make(map[int]map[int]TrafficHistoryBytes)}
}
func nonnegative(n int64) int64 {
	if n < 0 {
		return 0
	}
	return n
}
func trafficBytes(up, down int64) TrafficHistoryBytes {
	return TrafficHistoryBytes{Upload: up, Download: down, Total: up + down}
}

// Allocate the same accepted bytes the client accounting saved, including quota clipping.
// The existing raw per-node counters are preserved independently and exposed as cumulativeNodes.
func allocateAccountedTraffic(sample accountedTrafficSample, nodes map[int]TrafficHistoryBytes) map[int]TrafficHistoryBytes {
	result := make(map[int]TrafficHistoryBytes)
	ids := make([]int, 0, len(nodes))
	var knownUp, knownDown int64
	for id, n := range nodes {
		ids = append(ids, id)
		knownUp += n.Upload
		knownDown += n.Download
	}
	sort.Ints(ids)
	remainingUp, remainingDown := nonnegative(sample.Up), nonnegative(sample.Down)
	denomUp, denomDown := max(sample.RawUp, knownUp), max(sample.RawDown, knownDown)
	for i, id := range ids {
		n := nodes[id]
		var up, down int64
		if denomUp > 0 {
			up = min(remainingUp, int64(float64(n.Upload)/float64(denomUp)*float64(sample.Up)))
		}
		if denomDown > 0 {
			down = min(remainingDown, int64(float64(n.Download)/float64(denomDown)*float64(sample.Down)))
		}
		if i == len(ids)-1 {
			if knownUp == denomUp && denomUp > 0 {
				up = remainingUp
			}
			if knownDown == denomDown && denomDown > 0 {
				down = remainingDown
			}
		}
		remainingUp -= up
		remainingDown -= down
		if up+down > 0 {
			result[id] = trafficBytes(up, down)
		}
	}
	if remainingUp+remainingDown > 0 {
		result[0] = trafficBytes(remainingUp, remainingDown)
	}
	return result
}
func trafficBuckets(kind string, id, nodeID int, at, up, down int64) []model.TrafficHistoryBucket {
	if up+down <= 0 {
		return nil
	}
	rows := make([]model.TrafficHistoryBucket, 0, 2)
	for _, resolution := range []int{60, 86400} {
		span := int64(resolution) * 1000
		rows = append(rows, model.TrafficHistoryBucket{Kind: kind, EntityID: id, NodeID: nodeID, Resolution: resolution, Bucket: at / span * span, Up: up, Down: down})
	}
	return rows
}
func saveHistoryRows(tx *gorm.DB, origins []model.TrafficHistoryOrigin, rows []model.TrafficHistoryBucket, coverage []model.TrafficHistoryCoverage) error {
	if len(origins) > 0 {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(origins, 1000).Error; err != nil {
			return err
		}
	}
	// Coalesce duplicate entity/node/bucket rows before PostgreSQL ON CONFLICT.
	type key struct {
		kind              string
		entity, node, res int
		bucket            int64
	}
	combined := make(map[key]model.TrafficHistoryBucket, len(rows))
	for _, r := range rows {
		k := key{r.Kind, r.EntityID, r.NodeID, r.Resolution, r.Bucket}
		prev := combined[k]
		if prev.Kind == "" {
			prev = r
		} else {
			prev.Up += r.Up
			prev.Down += r.Down
		}
		combined[k] = prev
	}
	rows = rows[:0]
	for _, r := range combined {
		rows = append(rows, r)
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.EntityID != b.EntityID {
			return a.EntityID < b.EntityID
		}
		if a.NodeID != b.NodeID {
			return a.NodeID < b.NodeID
		}
		if a.Resolution != b.Resolution {
			return a.Resolution < b.Resolution
		}
		return a.Bucket < b.Bucket
	})
	if len(rows) > 0 {
		err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "kind"}, {Name: "entity_id"}, {Name: "node_id"}, {Name: "resolution"}, {Name: "bucket"}}, DoUpdates: clause.Assignments(map[string]interface{}{"up": gorm.Expr("traffic_history_buckets.up + EXCLUDED.up"), "down": gorm.Expr("traffic_history_buckets.down + EXCLUDED.down")})}).CreateInBatches(rows, 1000).Error
		if err != nil {
			return err
		}
	}
	if len(coverage) > 0 {
		expanded := make([]model.TrafficHistoryCoverage, 0, len(coverage)*2)
		for _, c := range coverage {
			c.Resolution = 60
			expanded = append(expanded, c)
			c.Resolution = 86400
			c.Bucket = c.Bucket / (86400 * 1000) * (86400 * 1000)
			expanded = append(expanded, c)
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(expanded, 1000).Error
	}
	return nil
}
func persistClientTrafficHistory(tx *gorm.DB, batch *trafficHistoryBatch) error {
	if batch == nil {
		return nil
	}
	origins := append([]model.TrafficHistoryOrigin(nil), batch.Origins...)
	var rows []model.TrafficHistoryBucket
	for _, s := range batch.Samples {
		origins = append(origins, model.TrafficHistoryOrigin{Kind: "client", EntityID: s.ID, NodeID: -1, Up: s.BeforeUp, Down: s.BeforeDown, StartedAt: batch.At})
		rows = append(rows, trafficBuckets("client", s.ID, -1, batch.At, s.Up, s.Down)...)
		for nodeID, n := range allocateAccountedTraffic(s, batch.Nodes[s.ID]) {
			rows = append(rows, trafficBuckets("client", s.ID, nodeID, batch.At, n.Upload, n.Download)...)
		}
	}
	if err := saveHistoryRows(tx, origins, rows, []model.TrafficHistoryCoverage{{Kind: "client", EntityID: 0, Bucket: batch.At / trafficHistoryMinute * trafficHistoryMinute}}); err != nil {
		return err
	}
	return nil
}
func recordIdleClientTrafficPoll(at int64) {
	err := saveHistoryRows(database.GetDB(), nil, nil, []model.TrafficHistoryCoverage{{Kind: "client", EntityID: 0, Bucket: at / trafficHistoryMinute * trafficHistoryMinute}})
	if err != nil {
		logger.Warningf("traffic history coverage: %v", err)
	}
}

func aggregateTrafficHistory(rows []model.TrafficHistoryBucket, coverage []model.TrafficHistoryCoverage, kind string, start, end, step int64) ([]TrafficHistoryPoint, []TrafficHistoryNode) {
	byTime := make(map[int64]map[int]TrafficHistoryBytes)
	observed := make(map[int64]bool)
	for _, c := range coverage {
		observed[c.Bucket/step*step] = true
	}
	for _, r := range rows {
		t := r.Bucket / step * step
		if byTime[t] == nil {
			byTime[t] = make(map[int]TrafficHistoryBytes)
		}
		n := byTime[t][r.NodeID]
		byTime[t][r.NodeID] = trafficBytes(n.Upload+r.Up, n.Download+r.Down)
	}
	points := []TrafficHistoryPoint{}
	totals := make(map[int]TrafficHistoryBytes)
	for t := start; t <= end; t += step {
		p := TrafficHistoryPoint{T: t, Nodes: make(map[int]TrafficHistoryBytes)}
		n, hasTotal := byTime[t][-1]
		if hasTotal || observed[t] {
			up, down, total := n.Upload, n.Download, n.Total
			p.Upload = &up
			p.Download = &down
			p.Total = &total
		}
		if kind == "client" {
			for id, n := range byTime[t] {
				if id < 0 {
					continue
				}
				p.Nodes[id] = n
				v := totals[id]
				totals[id] = trafficBytes(v.Upload+n.Upload, v.Download+n.Download)
			}
		}
		points = append(points, p)
	}
	ids := make([]int, 0, len(totals))
	for id := range totals {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	nodes := make([]TrafficHistoryNode, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, TrafficHistoryNode{ID: id, TrafficHistoryBytes: totals[id]})
	}
	return points, nodes
}

type TrafficHistoryRange struct{ From, To int64 }

func GetTrafficHistory(kind string, id, minutes int, absolute ...TrafficHistoryRange) (TrafficHistoryResult, error) {
	now := time.Now().UnixMilli()
	from, to := now-int64(minutes)*trafficHistoryMinute, now
	if len(absolute) > 0 {
		from, to = absolute[0].From, absolute[0].To
	}
	if from <= 0 || to <= from || to-from > 366*24*60*trafficHistoryMinute {
		return TrafficHistoryResult{}, fmt.Errorf("invalid history range")
	}
	minutes = int((to - from + trafficHistoryMinute - 1) / trafficHistoryMinute)
	db := database.GetDB()
	out := TrafficHistoryResult{Points: []TrafficHistoryPoint{}, Nodes: []TrafficHistoryNode{}, CumulativeNodes: []TrafficHistoryNode{}, BucketSeconds: 60}
	out.RangeStart, out.RangeEnd = from, to
	var origin model.TrafficHistoryOrigin
	err := db.Where("kind = ? AND entity_id = ? AND node_id = -1", kind, id).First(&origin).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return out, err
	}
	if err == nil {
		out.StartedAt = origin.StartedAt
		out.Baseline = trafficBytes(origin.Up, origin.Down)
	}
	var counters struct{ Up, Down int64 }
	table := "client_entities"
	if kind == "node" {
		table = "nodes"
	}
	if err := db.Table(table).Select("up", "down").Where("id = ?", id).Take(&counters).Error; err != nil {
		return out, err
	}
	out.Cumulative = trafficBytes(counters.Up, counters.Down)
	if kind == "client" {
		var stored []model.ClientNodeTraffic
		if err := db.Where("client_id = ?", id).Find(&stored).Error; err != nil {
			return out, err
		}
		for _, n := range stored {
			out.CumulativeNodes = append(out.CumulativeNodes, TrafficHistoryNode{ID: n.NodeId, TrafficHistoryBytes: trafficBytes(n.Down, n.Up)})
		}
	}
	if out.StartedAt > 0 {
		step, resolution := trafficHistoryMinute, 60
		if minutes > 720 {
			step *= 2
		}
		if minutes > 1440 {
			step = 60 * trafficHistoryMinute
		}
		if minutes > 10080 {
			step = 24 * 60 * trafficHistoryMinute
			resolution = 86400
		}
		out.BucketSeconds = int(step / 1000)
		queryStart, queryEnd := from/(int64(resolution)*1000)*(int64(resolution)*1000), to
		// Absolute ranges retain minute precision at their edges, even when plotted as days.
		if len(absolute) > 0 {
			resolution = 60
			queryStart = from / trafficHistoryMinute * trafficHistoryMinute
			queryEnd = to - 1
		}
		start := from / step * step
		first := out.StartedAt / step * step
		var rows []model.TrafficHistoryBucket
		if err := db.Model(&model.TrafficHistoryBucket{}).
			Select("node_id, (bucket / "+fmt.Sprint(step)+") * "+fmt.Sprint(step)+" AS bucket, SUM(up) AS up, SUM(down) AS down").
			Where("kind = ? AND entity_id = ? AND resolution = ? AND bucket >= ? AND bucket <= ?", kind, id, resolution, queryStart, queryEnd).
			Group("node_id, (bucket / " + fmt.Sprint(step) + ") * " + fmt.Sprint(step)).Scan(&rows).Error; err != nil {
			return out, err
		}
		var coverage []model.TrafficHistoryCoverage
		coverageID := id
		if kind == "client" {
			coverageID = 0
		}
		if err := db.Model(&model.TrafficHistoryCoverage{}).Select("DISTINCT (bucket / ?) * ? AS bucket", step, step).
			Where("kind = ? AND entity_id = ? AND resolution = ? AND bucket >= ? AND bucket <= ?", kind, coverageID, resolution, max(queryStart, first), queryEnd).Scan(&coverage).Error; err != nil {
			return out, err
		}
		out.Points, out.Nodes = aggregateTrafficHistory(rows, coverage, kind, start, to, step)
	}
	ids := []int{}
	for _, n := range append(append([]TrafficHistoryNode(nil), out.Nodes...), out.CumulativeNodes...) {
		if n.ID > 0 {
			ids = append(ids, n.ID)
		}
	}
	if len(ids) > 0 {
		var nodes []model.Node
		if err := db.Select("id", "name").Where("id IN ?", ids).Find(&nodes).Error; err != nil {
			return out, err
		}
		names := make(map[int]string)
		for _, n := range nodes {
			names[n.Id] = n.Name
		}
		for i := range out.Nodes {
			out.Nodes[i].Name = names[out.Nodes[i].ID]
		}
		for i := range out.CumulativeNodes {
			out.CumulativeNodes[i].Name = names[out.CumulativeNodes[i].ID]
		}
	}
	return out, nil
}

var trafficHistoryPruneMu sync.Mutex
var trafficHistoryLastPrune time.Time

func pruneTrafficHistory() {
	if !trafficHistoryPruneMu.TryLock() {
		return
	}
	defer trafficHistoryPruneMu.Unlock()
	now := time.Now()
	if now.Sub(trafficHistoryLastPrune) < time.Hour {
		return
	}
	if trafficHistoryMinuteRetentionDays <= 0 {
		return
	}
	cutoff := now.Add(-trafficHistoryMinuteRetentionDays * 24 * time.Hour).UnixMilli()
	// Never remove origins or daily totals.
	db := database.GetDB()
	if err := db.Where("resolution = 60 AND bucket < ?", cutoff).Delete(&model.TrafficHistoryBucket{}).Error; err != nil {
		logger.Warningf("traffic history retention: %v", err)
		return
	}
	if err := db.Where("resolution = 60 AND bucket < ?", cutoff).Delete(&model.TrafficHistoryCoverage{}).Error; err != nil {
		logger.Warningf("traffic history coverage retention: %v", err)
		return
	}
	trafficHistoryLastPrune = now
}

func recordIdleNodeTrafficPoll(id int, at int64) {
	err := saveHistoryRows(database.GetDB(), nil, nil, []model.TrafficHistoryCoverage{{Kind: "node", EntityID: id, Bucket: at / trafficHistoryMinute * trafficHistoryMinute}})
	if err != nil {
		logger.Warningf("node traffic history coverage: %v", err)
	}
}
