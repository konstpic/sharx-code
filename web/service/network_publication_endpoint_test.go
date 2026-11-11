package service

import (
	"github.com/konstpic/sharx-code/v2/database/model"
	"testing"
)

func TestNetworkPublicationEndpoint(t *testing.T) {
	node := &model.Node{Address: "http://internal-worker:8080"}
	if got := publicationEndpointHost(node, "82.24.195.249"); got != "82.24.195.249" {
		t.Fatal(got)
	}
	if got := publicationEndpointHost(node, ""); got != "internal-worker" {
		t.Fatal(got)
	}
}
func TestNetworkPublicationPortRange(t *testing.T) {
	t.Setenv("SHARX_NETWORK_PORT_MIN", "37000")
	t.Setenv("SHARX_NETWORK_PORT_MAX", "37100")
	low, high, err := networkPortRange()
	if err != nil || low != 37000 || high != 37100 {
		t.Fatalf("%d %d %v", low, high, err)
	}
	for _, bad := range []string{"0", "37101", "oops"} {
		t.Setenv("SHARX_NETWORK_PORT_MIN", bad)
		if _, _, err := networkPortRange(); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}
