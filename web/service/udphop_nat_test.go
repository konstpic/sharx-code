package service

import (
	"fmt"
	"reflect"
	"strings"
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

func TestBuildUDPHopNatIntentsProtectsProtocolOwnedListeners(t *testing.T) {
	for _, protocol := range []string{"wireguard", "hysteria2", "amneziawg"} {
		for _, stream := range []string{"", "null", "{}", "{broken"} {
			t.Run(protocol+"/"+stream, func(t *testing.T) {
				ibs := []*model.Inbound{
					natInbound(true, 443, "hysteria2", `{"hysteriaMultiPort":"39640-39649"}`),
					natInbound(true, 39645, protocol, stream),
				}
				if got := BuildUDPHopNatIntentsForNode(ibs); len(got) != 0 {
					t.Fatalf("NAT would capture the existing %s listener: %v", protocol, got)
				}
			})
		}
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

// awaitNodePath reads the captured node requests until one with the given path
// arrives. Other traffic (state refreshes triggered by apply-config, which the
// test node answers with a stub body) is skipped.
func awaitNodePath(t *testing.T, ch chan capturedNodeRequest, path string) capturedNodeRequest {
	t.Helper()
	deadline := time.After(20 * time.Second)
	for {
		select {
		case req := <-ch:
			if req.path == path {
				return req
			}
		case <-deadline:
			t.Fatalf("node never received %s", path)
		}
	}
}

// TestUdphopNatFullApplyReReadsIntentsInsideLock is the deterministic regression
// for the confirmed inversion closed by applyConfigToNodeWithFreshUDPHopNat: a
// full apply whose sender already holds a pre-delete inbound/NAT snapshot
// (xray.go sweep, node.go health-recovery goroutine, telemt_session_sync) used to
// ship that stale list and land after the instant remove push — the node
// reconciles last-writer-wins with no epoch, so the deleted inbound's REDIRECT
// stayed forever. The helper must take the per-node push lock AND rebuild the
// intent list inside it, so the late envelope carries the post-delete state.
func TestUdphopNatFullApplyReReadsIntentsInsideLock(t *testing.T) {
	is, ns, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615, 39616)
	drainNodeRequests(t, ch, len(ibs)) // add pushes
	xs := NewXrayService()

	built := make(chan struct{})
	resume := make(chan struct{})
	var resumeOnce sync.Once
	letGo := func() { resumeOnce.Do(func() { close(resume) }) }
	t.Cleanup(letGo) // a failure below must not leave the goroutine blocked on <-resume
	applied := make(chan error, 1)

	go func() { // full-apply goroutine: pre-lock phase, then the fix seam
		defer close(applied)
		ibsSnap, err := xs.InboundsForWorkerNode(n) // sender's own snapshot
		if err != nil {
			applied <- err
			close(built)
			return
		}
		stale := BuildUDPHopNatIntentsForNode(ibsSnap)
		if !natPorts(stale)[39616] {
			applied <- fmt.Errorf("precondition: snapshot before the delete must still hold the victim inbound: %v", stale)
			close(built)
			return
		}
		cfgJSON, coreH, cfgErr := xs.BuildWorkerXrayConfigForNodeWithMeta(n)
		if cfgErr != nil {
			t.Logf("worker config build failed (%v); shipping an empty config, NAT semantics unchanged", cfgErr)
			cfgJSON, coreH = []byte(`{}`), ""
		}
		close(built) // the stale snapshot exists from here on
		<-resume
		applied <- ns.applyConfigToNodeWithFreshUDPHopNat(n, cfgJSON, nil, nil, nil, NewApplyWorkerConfigMeta(cfgJSON, coreH))
	}()

	<-built
	// Instant delete: real production path, its push runs under the same lock
	// and ships the post-delete list.
	if _, err := is.DelInbound(ibs[1].Id); err != nil {
		t.Fatalf("DelInbound: %v", err)
	}
	removed := awaitNodePath(t, ch, "/api/v1/remove-inbound")
	if natPorts(decodeNatIntents(t, removed))[39616] {
		t.Fatalf("instant remove push still contains the deleted inbound: %v", decodeNatIntents(t, removed))
	}

	letGo() // let the stale-snapshot full apply land last
	if err := <-applied; err != nil {
		t.Fatalf("full apply: %v", err)
	}
	req := awaitNodePath(t, ch, "/api/v1/apply-config")
	intents := decodeNatIntents(t, req)
	got := natPorts(intents)
	if got[39616] {
		t.Fatalf("late full apply resurrected the deleted inbound's REDIRECT (stale list shipped): %v", intents)
	}
	if !got[39615] {
		t.Fatalf("late full apply lost the surviving inbound's REDIRECT: %v", intents)
	}
}

// holdNatPushLock takes the node's NAT push lock in a goroutine and releases it
// on test cleanup. It returns the "unlock now" function; the lock is guaranteed
// to be free before the next test starts even if this one fails.
func holdNatPushLock(t *testing.T, nodeID int) func() {
	t.Helper()
	locked := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unlock := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(unlock)
	go func() {
		_ = withNodeNatPushLock(nodeID, func() error {
			close(locked)
			<-release
			return nil
		})
	}()
	<-locked
	return unlock
}

// armPreLockHook installs a one-shot udphopNatPreLockHook and returns a channel
// that is closed when the full-apply seam reaches the lock boundary (before it
// reads the intent list). No sleeps: the test knows exactly when the sender is
// parked at the lock.
func armPreLockHook(t *testing.T) <-chan struct{} {
	t.Helper()
	reached := make(chan struct{})
	var once sync.Once
	udphopNatPreLockHook = func() { once.Do(func() { close(reached) }) }
	t.Cleanup(func() { udphopNatPreLockHook = nil })
	return reached
}

// TestUdphopNatFullApplyWaitsForPushLock pins that the full-apply seam really
// takes the same per-node lock as the instant paths: while an instant push holds
// it, the seam parks before the intent read and no apply-config envelope may
// reach the node; once released, the apply goes out with the freshly read list.
func TestUdphopNatFullApplyWaitsForPushLock(t *testing.T) {
	_, ns, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615, 39616)
	drainNodeRequests(t, ch, len(ibs)) // add pushes
	xs := NewXrayService()
	cfgJSON, coreH, cfgErr := xs.BuildWorkerXrayConfigForNodeWithMeta(n)
	if cfgErr != nil {
		cfgJSON, coreH = []byte(`{}`), ""
	}

	unlock := holdNatPushLock(t, n.Id)
	hookReached := armPreLockHook(t)

	applyErr := make(chan error, 1)
	go func() {
		applyErr <- ns.applyConfigToNodeWithFreshUDPHopNat(n, cfgJSON, nil, nil, nil, NewApplyWorkerConfigMeta(cfgJSON, coreH))
	}()
	<-hookReached // the seam is at the lock boundary; the lock is still ours

	// Nothing may have been sent: the seam cannot pass the hook without the lock
	// we hold. Only an apply-config envelope would prove a bypass.
	select {
	case req := <-ch:
		if req.path == "/api/v1/apply-config" {
			t.Fatalf("apply-config reached the node while the NAT push lock was held")
		}
	default:
	}
	unlock()

	req := awaitNodePath(t, ch, "/api/v1/apply-config")
	if err := <-applyErr; err != nil {
		t.Fatalf("full apply: %v", err)
	}
	if got := natPorts(decodeNatIntents(t, req)); !got[39615] || !got[39616] {
		t.Fatalf("apply-config after the lock shipped an incomplete list: %v", got)
	}
}

// TestUdphopNatFullApplyReadsListInsideLock pins the invariant that distinguishes
// the fix from the tempting wrong shape "read the list, then send under the lock":
// the seam is parked at the lock boundary (udphopNatPreLockHook) while the test
// holds the lock, then the inbound is deleted, then the lock is released. Any
// implementation that read the list before the hook/lock ships the pre-delete
// list and fails; the seam must read only after acquiring the lock.
func TestUdphopNatFullApplyReadsListInsideLock(t *testing.T) {
	is, ns, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615, 39616)
	drainNodeRequests(t, ch, len(ibs)) // add pushes
	xs := NewXrayService()
	cfgJSON, coreH, cfgErr := xs.BuildWorkerXrayConfigForNodeWithMeta(n)
	if cfgErr != nil {
		cfgJSON, coreH = []byte(`{}`), ""
	}

	unlock := holdNatPushLock(t, n.Id)
	hookReached := armPreLockHook(t)

	applyErr := make(chan error, 1)
	go func() {
		applyErr <- ns.applyConfigToNodeWithFreshUDPHopNat(n, cfgJSON, nil, nil, nil, NewApplyWorkerConfigMeta(cfgJSON, coreH))
	}()
	<-hookReached // seam parked before the intent read; the lock is still ours

	// DB delete commits while the sender is blocked behind the lock.
	if _, err := is.DelInbound(ibs[1].Id); err != nil {
		unlock()
		t.Fatalf("DelInbound: %v", err)
	}
	unlock()

	if err := <-applyErr; err != nil {
		t.Fatalf("full apply: %v", err)
	}
	req := awaitNodePath(t, ch, "/api/v1/apply-config")
	intents := decodeNatIntents(t, req)
	got := natPorts(intents)
	if got[39616] {
		t.Fatalf("apply-config carried the list read BEFORE the lock (deleted inbound 39616): %v", intents)
	}
	if !got[39615] {
		t.Fatalf("apply-config lost the surviving inbound's REDIRECT: %v", intents)
	}
}

// TestUDPHopNatIntentsForNodeOKSemantics pins the omit/clear contract source: a
// success is always a non-nil list (an empty one is an explicit "no rules"), a
// failed load must be reported as ok=false so callers can omit the field.
func TestUDPHopNatIntentsForNodeOKSemantics(t *testing.T) {
	_, ns, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615)
	drainNodeRequests(t, ch, len(ibs))

	intents, ok := ns.UDPHopNatIntentsForNode(n)
	if !ok {
		t.Fatalf("reachable DB must report ok=true")
	}
	if intents == nil {
		t.Fatalf("success must return a non-nil slice (empty list = explicit clear)")
	}
	if intents, ok := ns.UDPHopNatIntentsForNode(nil); ok || intents != nil {
		t.Fatalf("nil node must report ok=false/nil, got %v/%v", intents, ok)
	}
}

// TestSendApplyConfigOmitsUDPHopNatWhenUnavailable is the regression for the
// "transient DB error wipes the node's NAT chain" defect: with no list available
// the envelope must NOT carry udphopNat (the node reads an empty list as
// "reconcile to empty" and would delete every REDIRECT).
func TestSendApplyConfigOmitsUDPHopNatWhenUnavailable(t *testing.T) {
	_, ns, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615)
	drainNodeRequests(t, ch, len(ibs))

	cfgJSON := []byte(`{}`)
	if _, err := ns.sendApplyConfigToNode(n, cfgJSON, nil, nil, nil, nil, NewApplyWorkerConfigMeta(cfgJSON, "")); err != nil {
		t.Fatalf("send apply-config: %v", err)
	}
	req := awaitNodePath(t, ch, "/api/v1/apply-config")
	if _, ok := req.body["udphopNat"]; ok {
		t.Fatalf("udphopNat must be omitted when the list is unavailable, body keys: %v", keysOf(req.body))
	}
}

// TestSendApplyConfigSendsEmptyListForExplicitClear pins the other half of the
// pointer contract: a non-nil empty list is an explicit "remove all rules".
func TestSendApplyConfigSendsEmptyListForExplicitClear(t *testing.T) {
	_, ns, n, ibs, ch := seedUdphopNodeAndInbounds(t, 39615)
	drainNodeRequests(t, ch, len(ibs))

	cfgJSON := []byte(`{}`)
	empty := []finalmask.UDPHopNatIntent{}
	if _, err := ns.sendApplyConfigToNode(n, cfgJSON, nil, nil, nil, &empty, NewApplyWorkerConfigMeta(cfgJSON, "")); err != nil {
		t.Fatalf("send apply-config: %v", err)
	}
	req := awaitNodePath(t, ch, "/api/v1/apply-config")
	raw, ok := req.body["udphopNat"]
	if !ok {
		t.Fatalf("explicit clear must ship the udphopNat field, body keys: %v", keysOf(req.body))
	}
	if strings.TrimSpace(string(raw)) != "[]" {
		t.Fatalf("explicit clear must ship [] (node reconciles to empty), got %s", string(raw))
	}
}
