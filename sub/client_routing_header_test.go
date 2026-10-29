package sub

import (
	"net/http"
	"testing"
)

func TestApplyClientRoutingHeaderOverridesSharedRouting(t *testing.T) {
	h := http.Header{}
	h.Set("Routing", "happ://routing/add/c2hhcmVk")
	h.Set("Routing-Enable", "0")

	applyClientRoutingHeader(h, "  happ://routing/onadd/e30=  ")

	if got := h.Get("Routing"); got != "happ://routing/onadd/e30=" {
		t.Fatalf("Routing = %q, want the trimmed client value", got)
	}
	if got := h.Get("Routing-Enable"); got != "1" {
		t.Fatalf("Routing-Enable = %q, want 1", got)
	}
}

func TestApplyClientRoutingHeaderKeepsSharedRoutingWhenClientHasNone(t *testing.T) {
	for _, empty := range []string{"", "   ", "\n"} {
		h := http.Header{}
		h.Set("Routing", "happ://routing/add/c2hhcmVk")
		h.Set("Routing-Enable", "1")

		applyClientRoutingHeader(h, empty)

		if got := h.Get("Routing"); got != "happ://routing/add/c2hhcmVk" {
			t.Fatalf("empty client routing %q changed Routing to %q", empty, got)
		}
	}
}

func TestApplyClientRoutingHeaderWithoutSharedRouting(t *testing.T) {
	h := http.Header{}
	applyClientRoutingHeader(h, "incy://routing/add/e30=")
	if h.Get("Routing") != "incy://routing/add/e30=" || h.Get("Routing-Enable") != "1" {
		t.Fatalf("headers = %v", h)
	}
}
