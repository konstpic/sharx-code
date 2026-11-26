package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

func TestClientListRelations(t *testing.T) {
	db := testdb.New(t)
	c := seedClient(t, db, "linked")
	empty := seedClient(t, db, "empty")
	other := seedClient(t, db, "other")
	if err := db.Model(other).Update("user_id", 2).Error; err != nil {
		t.Fatal(err)
	}
	blocked := int64(3)
	for _, v := range []any{
		&[]model.ClientInboundMapping{{ClientId: c.Id, InboundId: 12, SortOrder: 2}, {ClientId: c.Id, InboundId: 13, SortOrder: 1}, {ClientId: other.Id, InboundId: 14}},
		&[]model.ClientHWID{{ClientId: c.Id, HWID: "older", LastSeenAt: 1}, {ClientId: c.Id, HWID: "recent", LastSeenAt: 2, BlockedAt: &blocked}, {ClientId: other.Id, HWID: "private"}},
	} {
		if err := db.Create(v).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(c).Updates(map[string]any{"expiry_time": 1, "up": int64(1) << 31, "total_gb": 1}).Error; err != nil {
		t.Fatal(err)
	}
	clients, err := (&ClientService{}).GetClients(1)
	if err != nil || len(clients) != 2 {
		t.Fatalf("clients=%v err=%v", clients, err)
	}
	for _, row := range clients {
		ids, err := (&ClientService{}).GetInboundIdsForClient(row.Id)
		if err != nil {
			t.Fatal(err)
		}
		hwids, err := (&ClientHWIDService{}).GetHWIDsForClient(row.Id)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(ids, row.InboundIds) || !reflect.DeepEqual(hwids, row.HWIDs) {
			t.Fatalf("relations differ for %s", row.Name)
		}
		switch row.Id {
		case c.Id:
			if row.Status != "expired_time" || !row.Enable || !reflect.DeepEqual(ids, []int{13, 12}) || len(hwids) != 2 || !hwids[0].Blocked {
				t.Fatalf("wrong client state: %+v", row)
			}
		case empty.Id:
			if row.InboundIds == nil || row.HWIDs == nil || len(hwids) != 0 || len(ids) != 0 {
				t.Fatal("expected empty slices")
			}
		default:
			t.Fatal("cross-user row")
		}
	}
}

func TestTrafficMatrixAccountViews(t *testing.T) {
	db := testdb.New(t)
	first := seedClient(t, db, "first")
	second := seedClient(t, db, "second")
	if err := db.Model(second).Updates(map[string]any{"user_id": 2, "up": 17}).Error; err != nil {
		t.Fatal(err)
	}
	svc := NodeService{}
	setting := SettingService{}
	if err := setting.SetMultiNodeMode(false); err != nil {
		t.Fatal(err)
	}
	local, err := svc.GetClientTrafficPerNodeMatrix(2)
	if err != nil || len(local.Rows) != 1 || len(local.Nodes) != 1 || local.Rows[0].Values[0].Up != 17 || local.Nodes[0].Name != "Local" {
		t.Fatalf("local=%+v err=%v", local, err)
	}
	if err := setting.SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	var health, stats atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			health.Add(1)
			fmt.Fprint(w, `{"xrayRunning":true}`)
		case "/api/v1/stats":
			stats.Add(1)
			if r.URL.Query().Has("reset") {
				t.Error("unexpected stats reset")
			}
			fmt.Fprint(w, `{"onlineClients":["FIRST"],"clientTraffic":[{"email":"first","up":77}]}`)
		default:
			t.Errorf("unexpected worker URL %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	node := seedNode(t, db, "worker", srv.URL)
	if err := db.Model(node).Update("use_tls", false).Error; err != nil {
		t.Fatal(err)
	}
	none, err := svc.GetClientTrafficPerNodeMatrix(1)
	if err != nil || none.Rows != nil || none.Nodes != nil {
		t.Fatalf("empty=%+v err=%v", none, err)
	}
	inb := seedInbound(t, db, 1443, model.VLESS)
	if err := db.Create(&model.InboundNodeMapping{InboundId: inb.Id, NodeId: node.Id}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ClientNodeTraffic{ClientId: first.Id, NodeId: node.Id, Up: 10, Down: 20}).Error; err != nil {
		t.Fatal(err)
	}
	snapshot, err := svc.ClientTrafficSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		user     int
		email    string
		up, down int64
		online   bool
	}{{1, "first", 10, 20, true}, {2, "second", 0, 0, false}} {
		m, err := snapshot.ForUser(tc.user)
		if err != nil || len(m.Rows) != 1 || len(m.Nodes) != 1 || m.Nodes[0].Fetch != "ok" {
			t.Fatalf("multi=%+v err=%v", m, err)
		}
		want := ClientTrafficPerNodeCell{Up: tc.up, Down: tc.down, Online: tc.online, OK: true}
		if m.Rows[0].Email != tc.email || !reflect.DeepEqual(m.Rows[0].Values, []ClientTrafficPerNodeCell{want}) {
			t.Fatalf("unexpected row %+v", m.Rows[0])
		}
	}
	larger := seedClient(t, db, "larger")
	if err := db.Create(&model.ClientNodeTraffic{ClientId: larger.Id, NodeId: node.Id, Up: 31}).Error; err != nil {
		t.Fatal(err)
	}
	sorted, err := snapshot.ForUser(1)
	if err != nil || len(sorted.Rows) != 2 || sorted.Rows[0].Email != "larger" || sorted.Rows[1].Email != "first" {
		t.Fatalf("wrong order: %+v err=%v", sorted, err)
	}
	if health.Load() != 1 || stats.Load() != 1 {
		t.Fatalf("worker polls health=%d stats=%d", health.Load(), stats.Load())
	}
}
