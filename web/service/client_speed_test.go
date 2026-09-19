package service

import "testing"

func TestClientSpeedTrackerSteadyTraffic(t *testing.T) {
	tr := newClientSpeedTracker()
	// 1 MB every 3s, both directions -> ~2.67 Mbps once the window is full.
	base := int64(1_000_000)
	for i := int64(1); i <= 5; i++ {
		now := base + i*3000
		tr.observe(1, now-3000, now, 1_000_000, 500_000)
	}
	got := tr.snapshot(base + 15000)[1]
	wantUp := int64(1_000_000 * 8 / 3)
	if got.up < wantUp*9/10 || got.up > wantUp*11/10 {
		t.Fatalf("up speed %d, want ~%d", got.up, wantUp)
	}
	if got.down < wantUp/2*9/10 || got.down > wantUp/2*11/10 {
		t.Fatalf("down speed %d, want ~%d", got.down, wantUp/2)
	}
}

func TestClientSpeedTrackerBurstHoldsThenDecays(t *testing.T) {
	tr := newClientSpeedTracker()
	now := int64(2_000_000)
	tr.observe(7, now-3000, now, 300_000, 0)
	// Still reported one and five seconds later (no flicker between bursts)...
	for _, dt := range []int64{1000, 3000, 7000} {
		if s, ok := tr.snapshot(now + dt)[7]; !ok || s.up <= 0 {
			t.Fatalf("speed missing %dms after burst", dt)
		}
	}
	// ...and gone once the window has passed.
	if _, ok := tr.snapshot(now + 11000)[7]; ok {
		t.Fatal("speed should be dropped after the window")
	}
	if len(tr.clients) != 0 {
		t.Fatal("stale history not pruned")
	}
}

func TestClientSpeedTrackerIgnoresZeroDeltas(t *testing.T) {
	tr := newClientSpeedTracker()
	tr.observe(3, 0, 1000, 0, 0)
	if len(tr.snapshot(1000)) != 0 {
		t.Fatal("zero delta must not register a client")
	}
}

func TestClientSpeedTrackerStartTick(t *testing.T) {
	tr := newClientSpeedTracker()
	if from := tr.startTick(10_000); from != 7_000 {
		t.Fatalf("first tick from=%d", from)
	}
	if from := tr.startTick(13_000); from != 10_000 {
		t.Fatalf("second tick from=%d", from)
	}
	if from := tr.startTick(100_000); from != 97_000 {
		t.Fatalf("stale tick from=%d", from)
	}
}
