package service

import (
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/database"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/xray"
	"gorm.io/gorm"
)

func TestTrafficHistoryAccountedAllocation(t *testing.T) {
	cases := []struct {
		sample      accountedTrafficSample
		nodes       map[int]TrafficHistoryBytes
		wantUnknown int64
	}{
		{accountedTrafficSample{Up: 13, Down: 17, RawUp: 100, RawDown: 100}, map[int]TrafficHistoryBytes{10: trafficBytes(25, 75), 11: trafficBytes(75, 25)}, 0},
		{accountedTrafficSample{Up: 100, Down: 100, RawUp: 100, RawDown: 100}, map[int]TrafficHistoryBytes{10: trafficBytes(50, 25)}, 125},
		{accountedTrafficSample{Up: 10, Down: 20, RawUp: 10, RawDown: 20}, nil, 30},
	}
	for _, tc := range cases {
		allocated := allocateAccountedTraffic(tc.sample, tc.nodes)
		var up, down int64
		for _, n := range allocated {
			up += n.Upload
			down += n.Download
		}
		if up != tc.sample.Up || down != tc.sample.Down || allocated[0].Total != tc.wantUnknown {
			t.Fatalf("allocation: %+v", allocated)
		}
	}
}
func TestTrafficHistoryAggregationConservesBytesAndGaps(t *testing.T) {
	base := int64(600000)
	rows := []model.TrafficHistoryBucket{
		{Bucket: base, NodeID: -1, Up: 100, Down: 200}, {Bucket: base, NodeID: 10, Up: 100, Down: 200},
		{Bucket: base + 60000, NodeID: -1, Up: 300, Down: 400}, {Bucket: base + 60000, NodeID: 11, Up: 300, Down: 400},
	}
	coverage := []model.TrafficHistoryCoverage{{Bucket: base}, {Bucket: base + 60000}, {Bucket: base + 120000}}
	for _, step := range []int64{60000, 120000} {
		points, nodes := aggregateTrafficHistory(rows, coverage, "client", base, base+240000, step)
		var total, byNodes int64
		for _, p := range points {
			if p.Total != nil {
				total += *p.Total
			}
		}
		for _, n := range nodes {
			byNodes += n.Total
		}
		if total != 1000 || byNodes != total {
			t.Fatalf("step %d sums %d %d", step, total, byNodes)
		}
		if points[len(points)-1].Total != nil {
			t.Fatal("missing poll must be a gap")
		}
	}
}
func TestTrafficHistoryPostgresQuotaAndPersistence(t *testing.T) {
	db := testdb.New(t)
	client := model.ClientEntity{Name: "timeline-test", UserId: 1, TotalGB: 1, Up: 100, Down: 100, AllTime: 200}
	if err := db.Create(&client).Error; err != nil {
		t.Fatal(err)
	}
	const gib = int64(1024 * 1024 * 1024)
	at := time.Now().UnixMilli()
	batch := newTrafficHistoryBatch(at)
	batch.Nodes[client.Id] = map[int]TrafficHistoryBytes{10: trafficBytes(gib, gib), 11: trafficBytes(gib, gib)}
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, err := (&ClientService{}).AddClientTraffic(tx, []*xray.ClientTraffic{{Email: client.Name, Up: 2 * gib, Down: 2 * gib}}, nil, batch)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	var saved model.ClientEntity
	if err := db.First(&saved, client.Id).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Up+saved.Down != gib {
		t.Fatalf("client accounting: %d", saved.Up+saved.Down)
	}
	got, err := GetTrafficHistory("client", client.Id, 60)
	if err != nil {
		t.Fatal(err)
	}
	if got.Baseline.Total != 200 || got.Cumulative.Total != gib {
		t.Fatalf("baseline/cumulative: %+v", got)
	}
	var period, nodeSum int64
	for _, p := range got.Points {
		if p.Total != nil {
			period += *p.Total
		}
	}
	for _, n := range got.Nodes {
		nodeSum += n.Total
	}
	if period != gib-200 || nodeSum != period {
		t.Fatalf("quota history=%d nodes=%d, expected %d", period, nodeSum, gib-200)
	}
	for _, minutes := range []int{15, 360, 1440, 10080, 43200, 129600} {
		rangeHistory, err := GetTrafficHistory("client", client.Id, minutes)
		if err != nil {
			t.Fatal(err)
		}
		var sum int64
		for _, point := range rangeHistory.Points {
			if point.Total != nil {
				sum += *point.Total
			}
		}
		if sum != period {
			t.Fatalf("range %d changed recorded volume: %d vs %d", minutes, sum, period)
		}
	}
	custom, err := GetTrafficHistory("client", client.Id, 60, TrafficHistoryRange{From: at - 7200000, To: at + 60000})
	if err != nil {
		t.Fatal(err)
	}
	var customTotal int64
	for _, p := range custom.Points {
		if p.Total != nil {
			customTotal += *p.Total
		}
	}
	if custom.RangeStart != at-7200000 || custom.RangeEnd != at+60000 || customTotal != period || custom.Points[0].Total != nil {
		t.Fatalf("custom range loses bounds, volume, or gaps: %+v", custom)
	}
	past, err := GetTrafficHistory("client", client.Id, 60, TrafficHistoryRange{From: at - 30*86400000, To: at / 60000 * 60000})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range past.Points {
		if p.Total != nil && *p.Total != 0 {
			t.Fatal("absolute end includes later traffic from the same daily bucket")
		}
	}
	// Read through a fresh GORM session to verify there is no in-memory history dependency.
	var minutes, daily []model.TrafficHistoryBucket
	if err := db.Session(&gorm.Session{NewDB: true}).Where("kind='client' AND entity_id=? AND node_id=-1 AND resolution=60", client.Id).Find(&minutes).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("kind='client' AND entity_id=? AND node_id=-1 AND resolution=86400", client.Id).Find(&daily).Error; err != nil {
		t.Fatal(err)
	}
	if len(minutes) != 1 || len(daily) != 1 || minutes[0].Up+minutes[0].Down != daily[0].Up+daily[0].Down {
		t.Fatal("minute/daily persistence differs")
	}
}
func TestTrafficHistoryPostgresRollbackAndExistingCounters(t *testing.T) {
	db := testdb.New(t)
	client := model.ClientEntity{Name: "rollback-test", UserId: 1, Up: 1000, Down: 2000, AllTime: 3000}
	if err := db.Create(&client).Error; err != nil {
		t.Fatal(err)
	}
	before := client
	batch := newTrafficHistoryBatch(time.Now().UnixMilli())
	batch.Samples = []accountedTrafficSample{{ID: client.Id, BeforeUp: client.Up, BeforeDown: client.Down, Up: 10, Down: 20, RawUp: 10, RawDown: 20}}
	fail := errors.New("rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		client.Up += 10
		client.Down += 20
		client.AllTime += 30
		if err := saveClientTrafficFields(tx, []*model.ClientEntity{&client}, nil, batch); err != nil {
			return err
		}
		return fail
	})
	if !errors.Is(err, fail) {
		t.Fatal(err)
	}
	var saved model.ClientEntity
	if err := db.First(&saved, client.Id).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Up != before.Up || saved.Down != before.Down || saved.AllTime != before.AllTime {
		t.Fatal("existing counters changed after rollback")
	}
	var count int64
	db.Model(&model.TrafficHistoryBucket{}).Count(&count)
	if count != 0 {
		t.Fatal("history survived a rolled-back accounting transaction")
	}
}
func TestTrafficHistoryPostgresSameBucketBatchAndNodeCounter(t *testing.T) {
	db := testdb.New(t)
	node := model.Node{Name: "timeline-node", Address: "http://127.0.0.1:8080", Up: 100, Down: 200, AllTime: 300}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := (&NodeService{}).UpdateNodeTraffic(node.Id, 10, 20); err != nil {
		t.Fatal(err)
	}
	got, err := GetTrafficHistory("node", node.Id, 60)
	if err != nil {
		t.Fatal(err)
	}
	if got.Baseline.Total != 300 || got.Cumulative.Total != 330 {
		t.Fatalf("node snapshot: %+v", got)
	}
	at := time.Now().UnixMilli()
	rows := append(trafficBuckets("client", 123, -1, at, 10, 20), trafficBuckets("client", 123, -1, at, 30, 40)...)
	if err := db.Transaction(func(tx *gorm.DB) error { return saveHistoryRows(tx, nil, rows, nil) }); err != nil {
		t.Fatal(err)
	}
	var stored []model.TrafficHistoryBucket
	db.Where("kind='client' AND entity_id=123").Find(&stored)
	if len(stored) != 2 {
		t.Fatalf("rows=%d", len(stored))
	}
	for _, r := range stored {
		if r.Up != 40 || r.Down != 60 {
			t.Fatalf("coalescing: %+v", r)
		}
	}
}

func TestTrafficHistoryPostgresMigrationKeepsLegacyCounters(t *testing.T) {
	db := testdb.New(t)
	client := model.ClientEntity{Name: "legacy-migration", UserId: 1, Up: 1234, Down: 5678, AllTime: 6912}
	node := model.Node{Name: "legacy-node", Address: "http://127.0.0.1:8080", Up: 90, Down: 110, AllTime: 200}
	if err := db.Create(&client).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	stored := model.ClientNodeTraffic{ClientId: client.Id, NodeId: node.Id, Up: 900, Down: 300}
	if err := db.Create(&stored).Error; err != nil {
		t.Fatal(err)
	}
	migrations, err := database.NewMigrator(db).LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations {
		if m.Version == 70 {
			for i := 0; i < 2; i++ {
				if err := db.Exec(m.Content).Error; err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	var saved model.ClientEntity
	db.First(&saved, client.Id)
	if saved.Up != 1234 || saved.Down != 5678 || saved.AllTime != 6912 {
		t.Fatal("migration changed existing client counters")
	}
	var savedPair model.ClientNodeTraffic
	db.First(&savedPair, stored.Id)
	if savedPair.Up != 900 || savedPair.Down != 300 {
		t.Fatal("migration changed per-node counters")
	}
	got, err := GetTrafficHistory("client", client.Id, 60)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cumulative.Total != 6912 || got.Baseline.Total != 6912 || len(got.CumulativeNodes) != 1 || got.CumulativeNodes[0].Total != 1200 {
		t.Fatalf("legacy data hidden or lost: %+v", got)
	}
	for _, p := range got.Points {
		if p.Total != nil && *p.Total > 0 {
			t.Fatal("legacy total was invented as a timestamped burst")
		}
	}
}
func TestTrafficHistoryPostgresBatchOf1000Clients(t *testing.T) {
	db := testdb.New(t)
	batch := newTrafficHistoryBatch(time.Now().UnixMilli())
	for i := 1; i <= 1000; i++ {
		batch.Samples = append(batch.Samples, accountedTrafficSample{ID: i, Up: 3, Down: 7, RawUp: 3, RawDown: 7})
		batch.Nodes[i] = map[int]TrafficHistoryBytes{10: trafficBytes(1, 2), 11: trafficBytes(2, 5)}
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return persistClientTrafficHistory(tx, batch) }); err != nil {
		t.Fatal(err)
	}
	var rows int64
	db.Model(&model.TrafficHistoryBucket{}).Count(&rows)
	if rows != 6000 {
		t.Fatalf("expected 6000 coalesced minute/daily rows, got %d", rows)
	}
	for _, resolution := range []int{60, 86400} {
		var total struct{ V int64 }
		db.Model(&model.TrafficHistoryBucket{}).Select("SUM(up+down) AS v").Where("node_id=-1 AND resolution=?", resolution).Scan(&total)
		if total.V != 10000 {
			t.Fatal(fmt.Sprintf("resolution %d total %d", resolution, total.V))
		}
	}
}
