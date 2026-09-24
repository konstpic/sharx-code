package sub

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
)

func addrs(list []AddressPort) []string {
	var out []string
	for _, a := range list {
		out = append(out, a.Address)
	}
	return out
}

func eq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestApplyBalancerEntries(t *testing.T) {
	direct := []AddressPort{{Address: "n1"}, {Address: "n2"}}
	cases := []struct {
		name    string
		entries []service.BalancerSubEntry
		want    []string
	}{
		{"none", nil, []string{"n1", "n2"}},
		{"prepend", []service.BalancerSubEntry{{Address: "lb", Mode: model.BalancerSubPrepend}}, []string{"lb", "n1", "n2"}},
		{"append", []service.BalancerSubEntry{{Address: "lb", Mode: model.BalancerSubAppend}}, []string{"n1", "n2", "lb"}},
		{"replace", []service.BalancerSubEntry{{Address: "lb", Mode: model.BalancerSubReplace}}, []string{"lb"}},
		{"two replace", []service.BalancerSubEntry{{Address: "lb1", Mode: model.BalancerSubReplace}, {Address: "lb2", Mode: model.BalancerSubReplace}}, []string{"lb1", "lb2"}},
		{"replace plus prepend keeps both", []service.BalancerSubEntry{{Address: "lb1", Mode: model.BalancerSubReplace}, {Address: "lb2", Mode: model.BalancerSubPrepend}}, []string{"lb2", "lb1"}},
		{"prepend and append", []service.BalancerSubEntry{{Address: "a", Mode: model.BalancerSubPrepend}, {Address: "z", Mode: model.BalancerSubAppend}}, []string{"a", "n1", "n2", "z"}},
	}
	for _, c := range cases {
		got := addrs(applyBalancerEntries(append([]AddressPort(nil), direct...), c.entries))
		if !eq(got, c.want) {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
