package sub

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

func TestConsumerSubscriptionUsesSessionCredentialAndFixedHost(t *testing.T) {
	db := testdb.New(t)
	remoteUUID := "11111111-2222-3333-4444-555555555555"
	link := protocol.SessionLink{
		Protocol: "vless-reality", EndpointHost: "de.example.com", EndpointPort: 443,
		ClientUUID: remoteUUID, ClientEmail: "sn-remote",
		AccessTemplate: protocol.AccessTemplate{
			Security: "reality", Transport: "tcp", SNI: "www.microsoft.com",
			PublicKey: "PUBKEY", ShortIDs: []string{"abcd0123"}, Fingerprint: "chrome",
		},
	}
	settings, stream, err := consumerSettingsForSubTest(&link)
	if err != nil {
		t.Fatal(err)
	}
	inbound := model.Inbound{
		UserId: 1, Remark: "rented", Enable: true, Port: 443, Protocol: model.VLESS,
		Tag: "sn-consumer-test", Settings: settings, StreamSettings: stream,
		SnNetwork: true, SnNetworkRole: "consumer",
	}
	if err := db.Create(&inbound).Error; err != nil {
		t.Fatal(err)
	}
	linkJSON, _ := json.Marshal(link)
	sess := model.SnSession{Id: "11111111-1111-1111-1111-111111111111", Role: "consumer", InboundId: &inbound.Id, Link: string(linkJSON), Status: "active"}
	if err := db.Create(&sess).Error; err != nil {
		t.Fatal(err)
	}
	host := model.Host{
		UserId: 1, Name: "rented", Address: link.EndpointHost, Port: link.EndpointPort, Enable: true,
		Kind: model.HostKindAddress, Source: model.HostSourceNetwork, InboundId: &inbound.Id,
	}
	client := model.ClientEntity{Id: 1, Name: "local", UUID: "99999999-9999-9999-9999-999999999999", Enable: true}
	prepared := inbound
	prepared.SubHosts = []model.Host{host}
	prepared.SubHostsSet = true
	got := (&SubService{}).getLinkWithClient(&prepared, &client)
	if !strings.HasPrefix(got, "vless://"+remoteUUID+"@de.example.com:443?") {
		t.Fatalf("subscription must use remote credential and fixed host: %s", got)
	}
	for _, part := range []string{"security=reality", "pbk=PUBKEY", "sid=abcd0123", "sni=www.microsoft.com", "flow=xtls-rprx-vision"} {
		if !strings.Contains(got, part) {
			t.Fatalf("link missing %s: %s", part, got)
		}
	}
	if strings.Contains(got, client.UUID) {
		t.Fatal("local client UUID leaked into rented session link")
	}
	if err := db.Model(&sess).Update("status", "closed").Error; err != nil {
		t.Fatal(err)
	}
	if got := (&SubService{}).getLinkWithClient(&prepared, &client); got != "" {
		t.Fatalf("closed session must not render a client link: %s", got)
	}
}

func consumerSettingsForSubTest(link *protocol.SessionLink) (string, string, error) {
	settings, err := json.Marshal(map[string]any{
		"clients":    []map[string]any{{"id": link.ClientUUID, "email": link.ClientEmail, "flow": "xtls-rprx-vision"}},
		"decryption": "none",
	})
	if err != nil {
		return "", "", err
	}
	stream, err := json.Marshal(map[string]any{
		"network": "tcp", "security": "reality",
		"realitySettings": map[string]any{
			"serverNames": []string{link.AccessTemplate.SNI}, "shortIds": link.AccessTemplate.ShortIDs,
			"settings": map[string]any{"publicKey": link.AccessTemplate.PublicKey, "fingerprint": "chrome"},
		},
	})
	return string(settings), string(stream), err
}
