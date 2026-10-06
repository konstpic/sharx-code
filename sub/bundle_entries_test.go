package sub

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestAddressPortFromHostNodeHostsKeepOverrides(t *testing.T) {
	s := &SubService{}
	for _, kind := range []string{model.HostKindPlacement, model.HostKindPool} {
		h := &model.Host{Kind: kind, Address: "node.example.com", SubscriptionFingerprint: "firefox"}
		ap, ok := s.addressPortFromHost(h, &model.Inbound{})
		if !ok {
			t.Fatalf("%s: row not built", kind)
		}
		got := ap.overrideHostFor(nil)
		if got != h {
			t.Fatalf("%s: host overrides not applied to row", kind)
		}
		params := map[string]string{}
		applyHostOverridesToParams(got, "tcp", params)
		if params["fp"] != "firefox" {
			t.Fatalf("%s: fp = %q, want firefox", kind, params["fp"])
		}
	}
}
