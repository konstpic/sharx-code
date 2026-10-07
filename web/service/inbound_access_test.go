package service

import (
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

const vlessSettings = `{"clients":[{"id":"aaaa-1111","email":"alice"},{"id":"bbbb-2222","email":"bob"}],"decryption":"none"}`
const realityStream = `{"network":"tcp","security":"reality","realitySettings":{"privateKey":"SERVER-PRIVATE","shortIds":["ab"],"serverNames":["example.com"]}}`

func TestRedactInboundHidesClientsAndSecretsSeparately(t *testing.T) {
	in := &model.Inbound{Settings: vlessSettings, StreamSettings: realityStream}
	// can see the inbound only
	r := RedactInbound(in, false, false)
	if strings.Contains(r.Settings, "aaaa-1111") || strings.Contains(r.Settings, "alice") {
		t.Fatalf("client credentials leaked: %s", r.Settings)
	}
	if strings.Contains(r.StreamSettings, "SERVER-PRIVATE") {
		t.Fatalf("server private key leaked: %s", r.StreamSettings)
	}
	if !strings.Contains(r.StreamSettings, "example.com") || !strings.Contains(r.Settings, "decryption") {
		t.Fatal("the non-secret configuration must stay visible")
	}
	// can see clients but not server secrets
	r = RedactInbound(in, true, false)
	if !strings.Contains(r.Settings, "aaaa-1111") || strings.Contains(r.StreamSettings, "SERVER-PRIVATE") {
		t.Fatal("clients:read shows clients, not keys")
	}
	// can edit the inbound (secrets) but not read clients
	r = RedactInbound(in, false, true)
	if strings.Contains(r.Settings, "aaaa-1111") || !strings.Contains(r.StreamSettings, "SERVER-PRIVATE") {
		t.Fatal("inbounds:update shows keys, not clients")
	}
	// the original is untouched (it may be broadcast to other users)
	if !strings.Contains(in.Settings, "aaaa-1111") || !strings.Contains(in.StreamSettings, "SERVER-PRIVATE") {
		t.Fatal("redaction must work on a copy")
	}
	if RedactInbound(in, true, true) != in {
		t.Fatal("full access returns the inbound itself")
	}
}

func TestRedactInboundPeersAndAccounts(t *testing.T) {
	in := &model.Inbound{Settings: `{"peers":[{"publicKey":"PK","privateKey":"PEER-PRIV","allowedIPs":["10.8.0.2/32"]}],"privateKey":"IFACE-PRIV","accounts":[{"user":"u","pass":"hunter2"}]}`}
	r := RedactInbound(in, false, false)
	for _, leak := range []string{"PEER-PRIV", "IFACE-PRIV", "hunter2", "10.8.0.2"} {
		if strings.Contains(r.Settings, leak) {
			t.Fatalf("%s leaked: %s", leak, r.Settings)
		}
	}
}

func TestGuardInboundClientsIgnoresChangesFromCallersWithoutClientPermissions(t *testing.T) {
	existing := &model.Inbound{Settings: vlessSettings}
	// the caller (inbounds:update only) posts a form where a client was added and another removed
	incoming := &model.Inbound{Settings: `{"clients":[{"id":"aaaa-1111","email":"alice"},{"id":"evil-9999","email":"mallory"}],"decryption":"none","fallbacks":[]}`}
	if !GuardInboundClients(incoming, existing, false) {
		t.Fatal("a client change must be reported as ignored")
	}
	if strings.Contains(incoming.Settings, "mallory") || !strings.Contains(incoming.Settings, "bbbb-2222") || !strings.Contains(incoming.Settings, "fallbacks") {
		t.Fatalf("clients must be the stored ones, the rest of the form kept: %s", incoming.Settings)
	}
	// an unchanged form is not reported
	same := &model.Inbound{Settings: vlessSettings}
	if GuardInboundClients(same, existing, false) {
		t.Fatal("an unchanged client list is not a change")
	}
	// a caller who manages clients is not touched
	own := &model.Inbound{Settings: `{"clients":[]}`}
	if GuardInboundClients(own, existing, true) || own.Settings != `{"clients":[]}` {
		t.Fatal("clients:update holders keep their behaviour")
	}
}

func TestGuardInboundClientsOnCreate(t *testing.T) {
	in := &model.Inbound{Settings: `{"clients":[{"id":"x","email":"smuggled"}],"decryption":"none"}`}
	if !GuardInboundClients(in, nil, false) {
		t.Fatal("clients in a new inbound from a caller without clients:create must be dropped")
	}
	if strings.Contains(in.Settings, "smuggled") || !strings.Contains(in.Settings, `"clients": []`) {
		t.Fatalf("%s", in.Settings)
	}
	// protocols without clients (socks, dokodemo) are not given an empty list they never had
	plain := &model.Inbound{Settings: `{"auth":"noauth","udp":false}`}
	if GuardInboundClients(plain, nil, false) || strings.Contains(plain.Settings, "clients") {
		t.Fatalf("no clients key must stay absent: %s", plain.Settings)
	}
}
