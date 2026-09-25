package sub

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

// The host form saves a name suffix and a server description for every kind of host. Each kind must carry them into the
// address row the link generators use (they become the link name suffix and #name?serverDescription=).
func TestAddressPortFromHostCarriesSuffixAndDescription(t *testing.T) {
	s := &SubService{}
	inbound := &model.Inbound{Id: 1}
	poolId, nodeId := 7, 3
	for name, h := range map[string]*model.Host{
		"placement": {Kind: model.HostKindPlacement, Name: "n", Address: "a.example.com", NodeId: &nodeId, RemarkSuffix: " EU", ServerDescription: "fast"},
		"pool":      {Kind: model.HostKindPool, Name: "lb", Address: "lb.example.com", PoolId: &poolId, RemarkSuffix: " EU", ServerDescription: "fast"},
		"address":   {Kind: model.HostKindAddress, Name: "cdn", Address: "cdn.example.com", RemarkSuffix: " EU", ServerDescription: "fast"},
	} {
		ap, ok := s.addressPortFromHost(h, inbound)
		if !ok {
			t.Fatalf("%s: no address row", name)
		}
		if ap.ServerDescription != "fast" || ap.RemarkSuffix != " EU" {
			t.Errorf("%s: suffix=%q description=%q, want \" EU\" and \"fast\"", name, ap.RemarkSuffix, ap.ServerDescription)
		}
	}
	// Empty stays empty: converted hosts produce the same rows as before.
	ap, _ := s.addressPortFromHost(&model.Host{Kind: model.HostKindPool, Address: "lb", PoolId: &poolId}, inbound)
	if ap.ServerDescription != "" || ap.RemarkSuffix != "" {
		t.Errorf("empty pool host: %+v", ap)
	}
}
