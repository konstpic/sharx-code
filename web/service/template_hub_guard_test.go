package service

import (
	"testing"
	"time"
)

func TestHubGuardOpensAfterThresholdAndProbes(t *testing.T) {
	g := &hubGuard{}
	now := time.Now()
	for i := 0; i < hubBreakerThreshold; i++ {
		if !g.allow(now) {
			t.Fatal("closed guard must allow")
		}
		g.record(false, now)
	}
	if g.allow(now.Add(time.Second)) {
		t.Fatal("guard must be open after repeated failures")
	}
	later := now.Add(hubBreakerOpenFor + time.Second)
	if !g.allow(later) {
		t.Fatal("guard must let one probe through after the window")
	}
	if g.allow(later.Add(time.Second)) {
		t.Fatal("second caller must still fail fast during the probe window")
	}
	g.record(true, later)
	if !g.allow(later.Add(2 * time.Second)) {
		t.Fatal("guard must close after a successful probe")
	}
}

func TestHubGuardSuccessResetsFailures(t *testing.T) {
	g := &hubGuard{}
	now := time.Now()
	g.record(false, now)
	g.record(false, now)
	g.record(true, now)
	g.record(false, now)
	if !g.allow(now) {
		t.Fatal("non-consecutive failures must not open the guard")
	}
}

func TestHubListCache(t *testing.T) {
	c := newHubListCache()
	now := time.Now()
	c.put("a", []byte(`{"items":[]}`), now)
	if b, saved, ok := c.get("a", now.Add(time.Hour)); !ok || string(b) != `{"items":[]}` || !saved.Equal(now) {
		t.Fatalf("cache miss or wrong data: %v %v %v", string(b), saved, ok)
	}
	if _, _, ok := c.get("a", now.Add(hubCacheTTL+time.Second)); ok {
		t.Fatal("entry must expire")
	}
	for i := 0; i < hubCacheMaxEntries+5; i++ {
		c.put(string(rune('A'+i%26))+string(rune('a'+i/26)), []byte(`{}`), now.Add(time.Duration(i)*time.Second))
	}
	if len(c.m) > hubCacheMaxEntries {
		t.Fatalf("cache exceeded cap: %d", len(c.m))
	}
}
