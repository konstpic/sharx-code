package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func resetHubState() {
	hubBreaker.mu.Lock()
	hubBreaker.fails = 0
	hubBreaker.openUntil = time.Time{}
	hubBreaker.mu.Unlock()
}

func TestHubClientServerErrorsOpenBreakerAndRecover(t *testing.T) {
	resetHubState()
	var healthy atomic.Bool
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if !healthy.Load() {
			http.Error(w, "boom", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	for i := 0; i < hubBreakerThreshold; i++ {
		if _, err := doHubRequest(srv.URL, "k", http.MethodGet, "/v1/templates", nil, nil); !errors.Is(err, ErrHubUnavailable) {
			t.Fatalf("5xx must map to ErrHubUnavailable, got %v", err)
		}
	}
	before := calls.Load()
	if _, err := doHubRequest(srv.URL, "k", http.MethodGet, "/v1/templates", nil, nil); !errors.Is(err, ErrHubUnavailable) {
		t.Fatalf("open breaker must fail: %v", err)
	}
	if calls.Load() != before {
		t.Fatal("open breaker must not call the hub")
	}

	// window elapsed and hub recovered: one probe closes the breaker
	hubBreaker.mu.Lock()
	hubBreaker.openUntil = time.Now().Add(-time.Second)
	hubBreaker.mu.Unlock()
	healthy.Store(true)
	r, err := doHubRequest(srv.URL, "k", http.MethodGet, "/v1/templates", nil, nil)
	if err != nil || r.Status != 200 {
		t.Fatalf("recovery probe failed: %v %v", r, err)
	}
	if _, err := doHubRequest(srv.URL, "k", http.MethodGet, "/v1/templates", nil, nil); err != nil {
		t.Fatalf("breaker must be closed after recovery: %v", err)
	}
}

func TestHubClientClientErrorsAreNotOutages(t *testing.T) {
	resetHubState()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"nope"}`, http.StatusUnprocessableEntity)
	}))
	defer srv.Close()
	for i := 0; i < hubBreakerThreshold+2; i++ {
		r, err := doHubRequest(srv.URL, "k", http.MethodPost, "/v1/templates", nil, map[string]string{"a": "b"})
		if err != nil || r.Status != 422 {
			t.Fatalf("4xx must be passed through, got %v %v", r, err)
		}
	}
}

func TestHubClientReadTimeoutIsShort(t *testing.T) {
	resetHubState()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(hubReadTimeout + 3*time.Second):
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	start := time.Now()
	_, err := doHubRequest(srv.URL, "k", http.MethodGet, "/v1/templates", nil, nil)
	if !errors.Is(err, ErrHubUnavailable) {
		t.Fatalf("timeout must map to ErrHubUnavailable, got %v", err)
	}
	if d := time.Since(start); d > hubReadTimeout+2*time.Second {
		t.Fatalf("read took %v, expected about %v", d, hubReadTimeout)
	}
}

func TestHubClientConnectionRefused(t *testing.T) {
	resetHubState()
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	if _, err := doHubRequest(url, "k", http.MethodGet, "/v1/templates", nil, nil); !errors.Is(err, ErrHubUnavailable) {
		t.Fatalf("refused connection must map to ErrHubUnavailable, got %v", err)
	}
}
