package authn

import (
	"sync"
	"time"
)

// Limiter is a sliding-window counter per key (an IP address), used on the unauthenticated sign-in endpoints.
type Limiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	max    int
	window time.Duration
}

// NewLimiter allows max events per key within window.
func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{hits: map[string][]time.Time{}, max: max, window: window}
}

// Allow records an event and reports whether it is within the limit.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cut := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	if len(l.hits) > 20000 {
		for k, v := range l.hits {
			if len(v) == 0 || v[len(v)-1].Before(cut) {
				delete(l.hits, k)
			}
		}
	}
	return true
}

// Hit records an event without checking the limit (a failure counter).
func (l *Limiter) Hit(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cut := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	l.hits[key] = append(kept, now)
}

// Over reports whether the key has reached the limit within the window, without recording anything.
func (l *Limiter) Over(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cut := time.Now().Add(-l.window)
	n := 0
	for _, t := range l.hits[key] {
		if t.After(cut) {
			n++
		}
	}
	return n >= l.max
}

// SetLimits changes the limit and window (the sign-in policy is a panel setting). Counted hits are kept.
func (l *Limiter) SetLimits(max int, window time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.max, l.window = max, window
}

// Bans holds keys (an address, or an address and account) that are blocked until a given time, whatever the sliding window
// says: the sign-in ban lasts the configured time from the moment the limit was exceeded.
type Bans struct {
	mu    sync.Mutex
	until map[string]time.Time
}

func NewBans() *Bans { return &Bans{until: map[string]time.Time{}} }

// Ban blocks key for d from now, unless it is already blocked longer.
func (b *Bans) Ban(key string, d time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	if t, ok := b.until[key]; ok && t.After(now.Add(d)) {
		return
	}
	b.until[key] = now.Add(d)
	if len(b.until) > 20000 {
		for k, t := range b.until {
			if !t.After(now) {
				delete(b.until, k)
			}
		}
	}
}

// Active reports whether key is blocked now.
func (b *Bans) Active(key string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	t, ok := b.until[key]
	if ok && !t.After(time.Now()) {
		delete(b.until, key)
		return false
	}
	return ok
}

// Clear lifts every ban.
func (b *Bans) Clear() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.until = map[string]time.Time{}
}

// Reset forgets the key's counted hits (a ban starts a fresh count when it ends).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}
