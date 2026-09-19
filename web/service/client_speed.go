package service

import (
	"sync"
	"time"
)

// Live speed is derived from a sliding window of per-tick byte deltas rather than from
// a single tick. Node counters (AmneziaWG handshakes, Telemt, batched xray stats) arrive in
// bursts every few seconds, so a per-tick rate flickers between a spike and "no speed".
// Averaging over a window shows a stable value that decays to zero once traffic stops.
const (
	clientSpeedWindow  = 10 * time.Second
	clientSpeedMinSpan = 2 * time.Second
)

type clientSpeedSample struct {
	from int64 // unix millis: start of the interval the bytes were collected over
	at   int64 // unix millis: end of that interval
	up   int64 // client upload bytes since previous sample
	down int64 // client download bytes since previous sample
}

type clientSpeedHistory struct {
	samples []clientSpeedSample
}

type clientSpeedTracker struct {
	mu       sync.Mutex
	clients  map[int]*clientSpeedHistory
	lastTick int64
}

func newClientSpeedTracker() *clientSpeedTracker {
	return &clientSpeedTracker{clients: make(map[int]*clientSpeedHistory)}
}

var liveSpeedTracker = newClientSpeedTracker()

// startTick marks a collection tick at nowMs and returns the start of the interval it covers
// (the previous tick, or one default period back when there was none recently).
func (t *clientSpeedTracker) startTick(nowMs int64) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	from := t.lastTick
	if from == 0 || nowMs-from > clientSpeedWindow.Milliseconds() || from > nowMs {
		from = nowMs - 3000
	}
	t.lastTick = nowMs
	return from
}

// observe registers bytes a client transferred over [fromMs, nowMs]. Zero deltas are ignored:
// they carry no information beyond the passage of time, which snapshot accounts for.
func (t *clientSpeedTracker) observe(clientID int, fromMs, nowMs, upBytes, downBytes int64) {
	if upBytes <= 0 && downBytes <= 0 {
		return
	}
	if upBytes < 0 {
		upBytes = 0
	}
	if downBytes < 0 {
		downBytes = 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	h := t.clients[clientID]
	if h == nil {
		h = &clientSpeedHistory{}
		t.clients[clientID] = h
	}
	h.samples = append(h.samples, clientSpeedSample{from: fromMs, at: nowMs, up: upBytes, down: downBytes})
}

// snapshot returns bits per second for every client that moved bytes within the window and
// drops the ones that went quiet. Only samples whose whole interval lies inside the window
// are kept, so the byte sum and the divisor always describe the same period. The divisor is the time covered by the retained samples
// (at most the window), floored at clientSpeedMinSpan so that a lone burst does not read as a spike.
func (t *clientSpeedTracker) snapshot(nowMs int64) map[int]bpsPair {
	windowMs := clientSpeedWindow.Milliseconds()
	minSpanMs := clientSpeedMinSpan.Milliseconds()
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make(map[int]bpsPair, len(t.clients))
	for id, h := range t.clients {
		cut := 0
		for cut < len(h.samples) && nowMs-h.samples[cut].from > windowMs {
			cut++
		}
		if cut > 0 {
			h.samples = h.samples[cut:]
		}
		if len(h.samples) == 0 {
			delete(t.clients, id)
			continue
		}
		var up, down int64
		for _, s := range h.samples {
			up += s.up
			down += s.down
		}
		span := nowMs - h.samples[0].from
		if span < minSpanMs {
			span = minSpanMs
		}
		sec := float64(span) / 1000
		out[id] = bpsPair{
			up:   int64(float64(up) / sec * 8),
			down: int64(float64(down) / sec * 8),
		}
	}
	return out
}
