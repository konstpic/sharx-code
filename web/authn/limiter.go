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
