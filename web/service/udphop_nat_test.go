package service

import (
	"reflect"
	"sync"
	"testing"
	"time"

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

// TestNodeNatPushLockSerializes pins the ordering guarantee behind the per-node
// udphopNat push lock: pushes for the same node never overlap, and the queued
// pusher reads the state left by the current holder (i.e. the read happens
// inside the lock, so a late goroutine cannot ship an older full list last).
func TestNodeNatPushLockSerializes(t *testing.T) {
	const nodeID = 900001
	// Stand-in for the DB: the "commit" happens outside the push lock, the read
	// inside it (as UDPHopNatIntentsForNode does), so the fake store guards itself.
	var stateMu sync.Mutex
	state := 1
	setState := func(v int) { stateMu.Lock(); state = v; stateMu.Unlock() }
	getState := func() int { stateMu.Lock(); defer stateMu.Unlock(); return state }

	var got []int
	var gotMu sync.Mutex
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = withNodeNatPushLock(nodeID, func() error {
			snap := getState()                // list is read at lock entry
			time.Sleep(50 * time.Millisecond) // hold the lock long enough to queue the next push
			gotMu.Lock()
			got = append(got, snap)
			gotMu.Unlock()
			return nil
		})
	}()
	time.Sleep(10 * time.Millisecond) // let the first pusher take the lock

	wg.Add(1)
	go func() {
		defer wg.Done()
		setState(2) // "DB commit" of the newer change, done while the first push is in flight
		_ = withNodeNatPushLock(nodeID, func() error {
			gotMu.Lock()
			got = append(got, getState()) // queued pusher sees the newer state, never overlaps
			gotMu.Unlock()
			return nil
		})
	}()
	wg.Wait()

	if !reflect.DeepEqual(got, []int{1, 2}) {
		t.Fatalf("push order/observed state = %v, want [1 2]", got)
	}
}

func TestWithNodeNatPushLockNilFn(t *testing.T) {
	if err := withNodeNatPushLock(900002, nil); err != nil {
		t.Fatalf("nil fn must be a no-op, got %v", err)
	}
}

func TestBuildUDPHopNatIntentsForNodeHysteriaMultiPort(t *testing.T) {
	const hy2Stream = `{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39649"}`
	ibs := []*model.Inbound{
		natInbound(true, 443, "hysteria2", hy2Stream),
		// empty range: no intent, but the always-list contract still holds
		natInbound(true, 8443, "hysteria2", `{"network":"hysteria","hysteriaMultiPort":""}`),
		// the key on a non-hysteria protocol is ignored
		natInbound(true, 9443, "vless", `{"network":"kcp","hysteriaMultiPort":"30000-30100"}`),
		// disabled inbound: skipped even though it carries a valid range
		natInbound(false, 4430, "hysteria2", hy2Stream),
	}
	want := []finalmask.UDPHopNatIntent{{FromPortMin: 39640, FromPortMax: 39649, ToPort: 443}}
	got := BuildUDPHopNatIntentsForNode(ibs)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("intents = %v, want %v", got, want)
	}
}

// One range must never capture another inbound's UDP listener on the same node
// (the REDIRECT would silently steal its traffic). The preferred gate is the
// save path; this pins the builder safety net for rows that bypassed it.
func TestBuildUDPHopNatIntentsForNodeDropsRangeCoveringPeer(t *testing.T) {
	ibs := []*model.Inbound{
		natInbound(true, 443, "hysteria2", `{"network":"hysteria","hysteriaMultiPort":"39640-39649"}`),
		natInbound(true, 39645, "vless", `{"network":"kcp"}`),
		natInbound(true, 9443, "hysteria2", `{"network":"hysteria","hysteriaMultiPort":"40000-40010"}`),
	}
	want := []finalmask.UDPHopNatIntent{{FromPortMin: 40000, FromPortMax: 40010, ToPort: 9443}}
	if got := BuildUDPHopNatIntentsForNode(ibs); !reflect.DeepEqual(got, want) {
		t.Fatalf("intents = %v, want %v", got, want)
	}
}

func TestBuildUDPHopNatIntentsForNodeDropsOverlappingRanges(t *testing.T) {
	ibs := []*model.Inbound{
		natInbound(true, 443, "hysteria2", `{"network":"hysteria","hysteriaMultiPort":"39640-39649"}`),
		natInbound(true, 8443, "hysteria2", `{"network":"hysteria","hysteriaMultiPort":"39645-39655"}`),
		natInbound(true, 9443, "hysteria2", `{"network":"hysteria","hysteriaMultiPort":"40000-40010"}`),
	}
	want := []finalmask.UDPHopNatIntent{
		{FromPortMin: 39640, FromPortMax: 39649, ToPort: 443},
		{FromPortMin: 40000, FromPortMax: 40010, ToPort: 9443},
	}
	if got := BuildUDPHopNatIntentsForNode(ibs); !reflect.DeepEqual(got, want) {
		t.Fatalf("intents = %v, want %v", got, want)
	}
}
