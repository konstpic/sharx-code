package service

import (
	"reflect"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

func natInbound(enable bool, port int, protocol, stream string) *model.Inbound {
	return &model.Inbound{Enable: enable, Port: port, Protocol: model.Protocol(protocol), StreamSettings: stream}
}

const natUdphopRemoteStream = `{"network":"kcp","finalmask":{"udp":[{"type":"udphop","settings":{
	"mode":"intervalremote","interval":30,
	"remoteIPs":["1.2.3.4"],"remotePorts":"20000-30000,443"}}]}}`

func TestBuildUDPHopNatIntentsForNode(t *testing.T) {
	ibs := []*model.Inbound{
		natInbound(true, 39612, "vless", natUdphopRemoteStream),
		// same ranges on another inbound port: keep both targets
		natInbound(true, 39613, "vless", `{"network":"kcp","finalmask":{"udp":[{"type":"udphop","settings":{
			"mode":"perconnremote","interval":10,"remoteIPs":["1.2.3.4"],"remotePorts":"443"}}]}}`),
		// exact duplicate of inbound 1: deduplicated
		natInbound(true, 39612, "vless", natUdphopRemoteStream),
		// intervallocal: nothing to redirect on the node
		natInbound(true, 39614, "vless", `{"network":"kcp","finalmask":{"udp":[{"type":"udphop","settings":{
			"mode":"intervallocal","interval":30,"remoteIPs":["1.2.3.4"],"remotePorts":"20000-30000"}}]}}`),
		// disabled inbound: skipped even though the mask wants rules
		natInbound(false, 39615, "vless", natUdphopRemoteStream),
		// non-UDP transport: udphop cannot ride it
		natInbound(true, 39616, "vless", `{"network":"tcp","finalmask":{"udp":[{"type":"udphop","settings":{
			"mode":"intervalremote","interval":30,"remoteIPs":["1.2.3.4"],"remotePorts":"443"}}]}}`),
		// broken JSON: skipped, not fatal
		natInbound(true, 39617, "vless", `{"network":`),
		// no finalmask at all
		natInbound(true, 39618, "vless", `{"network":"kcp"}`),
	}
	want := []finalmask.UDPHopNatIntent{
		{FromPortMin: 443, FromPortMax: 443, ToPort: 39612},
		{FromPortMin: 443, FromPortMax: 443, ToPort: 39613},
		{FromPortMin: 20000, FromPortMax: 30000, ToPort: 39612},
	}
	got := BuildUDPHopNatIntentsForNode(ibs)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("intents = %v, want %v", got, want)
	}
}

func TestBuildUDPHopNatIntentsForNodeAlwaysList(t *testing.T) {
	// Zero intents must be an empty non-nil slice: apply-config then ships `[]`
	// and the node removes stale rules instead of leaving them untouched.
	got := BuildUDPHopNatIntentsForNode(nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("want non-nil empty slice, got %#v", got)
	}
	got = BuildUDPHopNatIntentsForNode([]*model.Inbound{natInbound(true, 1, "vless", "")})
	if got == nil || len(got) != 0 {
		t.Fatalf("want non-nil empty slice, got %#v", got)
	}
}
