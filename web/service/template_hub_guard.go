package service

import (
	"encoding/json"
	"sync"
	"time"
)

const (
	hubBreakerThreshold = 3
	hubBreakerOpenFor   = 60 * time.Second
	hubCacheMaxEntries  = 50
	hubCacheTTL         = 24 * time.Hour
)

// hubGuard is a tiny circuit breaker: after hubBreakerThreshold consecutive failures calls are
// skipped for hubBreakerOpenFor, then a single probe is allowed through.
type hubGuard struct {
	mu        sync.Mutex
	fails     int
	openUntil time.Time
}

func (g *hubGuard) allow(now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.fails < hubBreakerThreshold {
		return true
	}
	if now.Before(g.openUntil) {
		return false
	}
	// half-open: let one probe through and re-arm the window so concurrent callers still fail fast
	g.openUntil = now.Add(hubBreakerOpenFor)
	return true
}

func (g *hubGuard) record(ok bool, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if ok {
		g.fails = 0
		return
	}
	g.fails++
	if g.fails >= hubBreakerThreshold {
		g.openUntil = now.Add(hubBreakerOpenFor)
	}
}

type hubCacheEntry struct {
	body  json.RawMessage
	saved time.Time
}

// hubListCache keeps the last successful gallery pages so a dead hub still shows something.
type hubListCache struct {
	mu sync.Mutex
	m  map[string]hubCacheEntry
}

func newHubListCache() *hubListCache { return &hubListCache{m: map[string]hubCacheEntry{}} }

func (c *hubListCache) put(key string, body json.RawMessage, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) >= hubCacheMaxEntries {
		var oldest string
		var ot time.Time
		for k, e := range c.m {
			if oldest == "" || e.saved.Before(ot) {
				oldest, ot = k, e.saved
			}
		}
		delete(c.m, oldest)
	}
	c.m[key] = hubCacheEntry{body: append(json.RawMessage(nil), body...), saved: now}
}

func (c *hubListCache) get(key string, now time.Time) (json.RawMessage, time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || now.Sub(e.saved) > hubCacheTTL {
		return nil, time.Time{}, false
	}
	return e.body, e.saved, true
}

// HubCachePut stores a successful list reply.
func HubCachePut(key string, body json.RawMessage) { hubCache.put(key, body, time.Now()) }

// HubCacheGet returns a previously stored list reply and when it was saved.
func HubCacheGet(key string) (json.RawMessage, time.Time, bool) { return hubCache.get(key, time.Now()) }
