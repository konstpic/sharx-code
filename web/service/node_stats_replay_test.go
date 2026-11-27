package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

func TestNodeStatsReplay(t *testing.T) {
	db := testdb.New(t)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check((&SettingService{}).SetMultiNodeMode(true))
	inbound := seedInbound(t, db, 8443, model.VLESS)
	client := seedClient(t, db, "fixture")
	wg := seedInbound(t, db, 51820, model.AmneziaWG)
	check(db.Model(wg).Update("settings", `{"peers":[{"name":"fixture","publicKey":"fixture-key"}]}`).Error)
	const id = "00000000-0000-4000-8000-000000000001"
	acks := make(chan string, 3)
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			_, _ = w.Write([]byte("{}"))
			return
		}
		if r.URL.Path != "/api/v1/stats" || r.URL.Query().Get("delivery") != "replay" {
			http.NotFound(w, r)
			return
		}
		acks <- r.URL.Query().Get("ack")
		// Deliberately repeat even after acknowledgment to test duplicate delivery.
		_ = json.NewEncoder(w).Encode(NodeStatsResponse{BatchID: id,
			Traffic:       []*NodeTraffic{{Tag: inbound.Tag, IsInbound: true, Up: 7, Down: 13}},
			ClientTraffic: []*NodeClientTraffic{{Email: "fixture-key", Up: 7, Down: 13}},
			OnlineClients: []string{"fixture-key"},
		})
	}))
	defer worker.Close()
	node := seedNode(t, db, "worker", worker.URL)
	check(db.Create(&model.ClientInboundMapping{ClientId: client.Id, InboundId: inbound.Id}).Error)
	check(db.Create(&model.InboundNodeMapping{InboundId: inbound.Id, NodeId: node.Id}).Error)
	collector := NodeService{}
	assertTotals := func(up, down int64, checkpoint string) {
		t.Helper()
		var n model.Node
		var in model.Inbound
		var c model.ClientEntity
		check(db.First(&n, node.Id).Error)
		check(db.First(&in, inbound.Id).Error)
		check(db.First(&c, client.Id).Error)
		if n.Up != up || n.Down != down || n.StatsBatchID != checkpoint || in.Up != up || in.Down != down || c.Up != down || c.Down != up {
			t.Fatalf("node %d/%d inbound %d/%d client %d/%d checkpoint %q", n.Up, n.Down, in.Up, in.Down, c.Up, c.Down, n.StatsBatchID)
		}
		var details []model.ClientNodeTraffic
		check(db.Where("node_id = ? AND client_id = ?", node.Id, client.Id).Find(&details).Error)
		if up == 0 && len(details) != 0 {
			t.Fatal("rolled-back poll left per-node client traffic")
		}
		if up != 0 && (len(details) != 1 || details[0].Up != up || details[0].Down != down || c.LastOnline == 0) {
			t.Fatal("missing per-node counters or online timestamp")
		}

	}
	check(db.Exec("ALTER TABLE inbounds ADD CONSTRAINT reject_poll CHECK (up=0)").Error)
	if err := collector.CollectNodeStats(); err == nil {
		t.Fatal("expected rejected poll")
	}
	assertTotals(0, 0, "")
	check(db.Exec("ALTER TABLE inbounds DROP CONSTRAINT reject_poll").Error)
	check(collector.CollectNodeStats())
	assertTotals(7, 13, id)
	check(collector.CollectNodeStats())
	assertTotals(7, 13, id)
	close(acks)
	var got []string
	for ack := range acks {
		got = append(got, ack)
	}
	if len(got) != 3 || got[0] != "" || got[1] != "" || got[2] != id {
		t.Fatalf("unexpected acknowledgments %q", got)
	}
}
