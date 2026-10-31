package mesh

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestEmbeddedEnrollmentSeparatesWorkersAndBalancers(t *testing.T) {
	var configured []string
	c := &Controller{ctx: context.Background(), dir: t.TempDir(), enrolled: map[string]Enrolled{}, ports: map[string]int{}}
	c.bridge = func(ctx context.Context, op string, raw json.RawMessage) (any, error) {
		switch op {
		case "nodes":
			return []map[string]any{{"uuid": "node-1", "address": "192.0.2.1", "enabled": true}, {"uuid": "balancer-1", "address": "192.0.2.2", "enabled": true}}, nil
		case "ports":
			return []int{}, nil
		case "mesh-agent":
			var q struct {
				UUID      string `json:"uuid"`
				Operation string `json:"operation"`
			}
			if e := json.Unmarshal(raw, &q); e != nil {
				return nil, e
			}
			switch q.Operation {
			case "identity":
				key := bytes.Repeat([]byte{1}, 32)
				if q.UUID == "balancer-1" {
					key[0] = 2
				}
				return map[string]any{"pubkey": base64.StdEncoding.EncodeToString(key), "embedded": true}, nil
			case "configure":
				configured = append(configured, q.UUID)
				return map[string]bool{"ok": true}, nil
			}
			t.Fatal("unexpected embedded command", q.Operation)
		}
		t.Fatal("unexpected bridge operation", op)
		return nil, nil
	}
	if e := c.identity(); e != nil {
		t.Fatal(e)
	}
	if e := c.enroll(EnrollRequest{NodeID: 1, Role: "exit"}, nil); e != nil {
		t.Fatal(e)
	}
	if e := c.enroll(EnrollRequest{NodeID: 1, Kind: "balancer", Role: "entry"}, nil); e != nil {
		t.Fatal(e)
	}
	if len(c.enrolled) != 2 || c.enrolled["n1"].Overlay == c.enrolled["b1"].Overlay || c.enrolled["b1"].Transport != "embedded" || len(configured) != 3 {
		t.Fatal(c.enrolled, configured)
	}
	if e := c.enroll(EnrollRequest{NodeID: 1, Kind: "balancer", Role: "exit"}, nil); e == nil {
		t.Fatal("balancer enrolled as worker exit")
	}
}
func TestEmbeddedEtcdProxyPreservesUint64(t *testing.T) {
	raw := json.RawMessage(`{"header":{"revision":"18446744073709551615"},"leader":18446744073709551615}`)
	c := &Controller{enrolled: map[string]Enrolled{"b1": {Node: "balancer-1", Transport: "embedded"}}, bridge: func(_ context.Context, op string, body json.RawMessage) (any, error) {
		var q struct {
			UUID      string `json:"uuid"`
			Operation string `json:"operation"`
		}
		_ = json.Unmarshal(body, &q)
		if op != "mesh-agent" || q.UUID != "balancer-1" || q.Operation != "etcd-proxy" {
			t.Fatal(op, q)
		}
		return raw, nil
	}}
	tr := &agentTransport{controller: c, names: map[string]string{"10.203.0.1": "b1"}}
	req, _ := http.NewRequest("POST", "https://10.203.0.1:2399/v3/maintenance/status", strings.NewReader(`{}`))
	resp, e := tr.RoundTrip(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if string(b) != string(raw) {
		t.Fatal("uint64 changed", string(b))
	}
	req, _ = http.NewRequest("POST", "https://10.203.0.99:2399/v3/maintenance/status", strings.NewReader(`{}`))
	if _, e = tr.RoundTrip(req); e == nil {
		t.Fatal("unregistered endpoint accepted")
	}
}
