package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

// These tests pin the delivery of the udphop NAT intents on the INSTANT inbound
// paths (add / delete / update), which is where the live stand lost them: the
// panel shipped the envelope without udphopNat, so the node reconciled nothing
// and the REDIRECT rules appeared only after a full apply-config or a restart
// pull. They need a PostgreSQL test database (SHARX_TEST_DB); without it they
// are skipped like the rest of the database-backed service tests.

const natUdphopRemoteStreamForPush = `{"network":"kcp","finalmask":{"udp":[{"type":"udphop","settings":{
	"mode":"intervalremote","interval":30,
	"remoteIPs":["1.2.3.4"],"remotePorts":"20000-20010"}}]}}`

type capturedNodeRequest struct {
	path string
	body map[string]json.RawMessage
}

func captureNodeServer(t *testing.T) (*[]capturedNodeRequest, chan capturedNodeRequest, *httptest.Server) {
	t.Helper()
	var mu = make(chan struct{}, 1)
	mu <- struct{}{}
	calls := &[]capturedNodeRequest{}
	ch := make(chan capturedNodeRequest, 16)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var m map[string]json.RawMessage
		_ = json.Unmarshal(raw, &m)
		req := capturedNodeRequest{path: r.URL.Path, body: m}
		<-mu
		*calls = append(*calls, req)
		mu <- struct{}{}
		select {
		case ch <- req:
		default:
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"ok"}`))
	}))
	t.Cleanup(srv.Close)
	return calls, ch, srv
}

func awaitNodeRequest(t *testing.T, ch chan capturedNodeRequest) capturedNodeRequest {
	t.Helper()
	select {
	case req := <-ch:
		return req
	case <-time.After(5 * time.Second):
		t.Fatal("node never received the instant inbound request")
		return capturedNodeRequest{}
	}
}

func drainNodeRequests(t *testing.T, ch chan capturedNodeRequest, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		awaitNodeRequest(t, ch)
	}
}

func decodeNatIntents(t *testing.T, req capturedNodeRequest) []finalmask.UDPHopNatIntent {
	t.Helper()
	raw, ok := req.body["udphopNat"]
	if !ok {
		t.Fatalf("%s envelope has no udphopNat field: %v", req.path, keysOf(req.body))
	}
	var intents []finalmask.UDPHopNatIntent
	if err := json.Unmarshal(raw, &intents); err != nil {
		t.Fatalf("%s udphopNat does not decode as an intent list (%s): %v", req.path, string(raw), err)
	}
	return intents
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func natPorts(intents []finalmask.UDPHopNatIntent) map[int]bool {
	out := make(map[int]bool, len(intents))
	for _, it := range intents {
		out[it.ToPort] = true
	}
	return out
}

func seedUdphopNodeAndInbounds(t *testing.T, ports ...int) (*InboundService, *NodeService, *model.Node, []*model.Inbound, chan capturedNodeRequest) {
	t.Helper()
	db := testdb.New(t)
	ss := SettingService{}
	if err := ss.SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	_, ch, srv := captureNodeServer(t)
	n := &model.Node{Name: "nat-node", Address: srv.URL, Enable: true, Status: "online", ApiKey: "nat-key"}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}
	is := &InboundService{}
	var ibs []*model.Inbound
	for _, port := range ports {
		ib := &model.Inbound{
			UserId: 1, Enable: true, Port: port, Protocol: model.VLESS,
			Remark: "hop", Settings: `{"clients":[],"decryption":"none"}`, Sniffing: "{}",
			StreamSettings: natUdphopRemoteStreamForPush,
		}
		created, _, err := is.AddInbound(ib)
		if err != nil {
			t.Fatalf("AddInbound port %d: %v", port, err)
		}
		ibs = append(ibs, created)
	}
	ns := &NodeService{}
	// Assign the inbounds one by one, mirroring the live add flow: each add must
	// ship the full desired list of everything assigned to the node so far.
	for i := range ibs {
		if err := ns.AssignInboundToNodesWithBindings(ibs[i].Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
			t.Fatalf("assign inbound %d: %v", ibs[i].Id, err)
		}
	}
	return is, ns, n, ibs, ch
}

// Adding an inbound to a node must ship the full desired list with the push;
// the live stand bug shipped no list at all, so the node reconciled nothing
// and the REDIRECT rule appeared only after a later full apply or a restart.
func TestInstantInboundAddShipsUDPHopNat(t *testing.T) {
	_, _, _, _, ch := seedUdphopNodeAndInbounds(t, 39615, 39616)
	first := awaitNodeRequest(t, ch)
	if first.path != "/api/v1/update-inbound" {
		t.Fatalf("expected update-inbound push, got %s", first.path)
	}
	if got := natPorts(decodeNatIntents(t, first)); !got[39615] {
		t.Fatalf("first add push list = %v, want the new inbound 39615", got)
	}
	second := awaitNodeRequest(t, ch)
	if second.path != "/api/v1/update-inbound" {
		t.Fatalf("expected update-inbound push, got %s", second.path)
	}
	got := natPorts(decodeNatIntents(t, second))
	if !got[39615] || !got[39616] {
		t.Fatalf("second add push list = %v, want both inbounds", got)
	}
}

func TestInstantInboundDelShipsPostDeleteUDPHopNat(t *testing.T) {
	is, _, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615, 39616)
	if len(ibs) != 2 {
		t.Fatalf("expected two inbounds, got %d", len(ibs))
	}
	drainNodeRequests(t, ch, len(ibs)) // add pushes
	if _, err := is.DelInbound(ibs[1].Id); err != nil {
		t.Fatalf("DelInbound: %v", err)
	}
	req := awaitNodeRequest(t, ch)
	if req.path != "/api/v1/remove-inbound" {
		t.Fatalf("expected remove-inbound push, got %s", req.path)
	}
	intents := decodeNatIntents(t, req)
	got := natPorts(intents)
	if !got[39615] {
		t.Fatalf("post-delete list lost the remaining inbound (39615): %v", intents)
	}
	if got[39616] {
		t.Fatalf("post-delete list still contains the deleted inbound (39616): %v", intents)
	}
	_ = n
}

func TestInstantInboundUpdateShipsUDPHopNat(t *testing.T) {
	is, _, _, ibs, ch := seedUdphopNodeAndInbounds(t, 39615, 39616)
	drainNodeRequests(t, ch, len(ibs)) // add pushes
	upd := *ibs[0]
	upd.Settings = `{"clients":[],"decryption":"none","marker":1}`
	if _, _, err := is.UpdateInbound(&upd); err != nil {
		t.Fatalf("UpdateInbound: %v", err)
	}
	req := awaitNodeRequest(t, ch)
	if req.path != "/api/v1/update-inbound" {
		t.Fatalf("expected update-inbound push, got %s", req.path)
	}
	got := natPorts(decodeNatIntents(t, req))
	if !got[39615] || !got[39616] {
		t.Fatalf("update list must carry both inbounds, got %v", got)
	}
}

// A hysteria2 inbound with the panel-only multi-port range must reach the node
// through the same instant path: the panel derives the range->listener intent
// from the stored streamSettings even though the Xray config never carries the
// key (BuildInboundXrayConfig strips it).
func TestInstantInboundAddShipsHysteriaMultiPortNat(t *testing.T) {
	db := testdb.New(t)
	ss := SettingService{}
	if err := ss.SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	_, ch, srv := captureNodeServer(t)
	n := &model.Node{Name: "hy2-nat-node", Address: srv.URL, Enable: true, Status: "online", ApiKey: "hy2-nat-key"}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}
	is := &InboundService{}
	ib := &model.Inbound{
		UserId: 1, Enable: true, Port: 443, Protocol: model.Hysteria2,
		Remark: "hy2-hop", Settings: `{"version":2,"clients":[]}`, Sniffing: "{}",
		StreamSettings: `{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39649"}`,
	}
	created, _, err := is.AddInbound(ib)
	if err != nil {
		t.Fatalf("AddInbound: %v", err)
	}
	ns := &NodeService{}
	if err := ns.AssignInboundToNodesWithBindings(created.Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
		t.Fatalf("assign: %v", err)
	}
	req := awaitNodeRequest(t, ch)
	if req.path != "/api/v1/update-inbound" {
		t.Fatalf("expected update-inbound push, got %s", req.path)
	}
	intents := decodeNatIntents(t, req)
	want := []finalmask.UDPHopNatIntent{{FromPortMin: 39640, FromPortMax: 39649, ToPort: 443}}
	if len(intents) != 1 || intents[0] != want[0] {
		t.Fatalf("udphopNat = %v, want %v", intents, want)
	}
}
