package configpull

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// natRecorder records udphopnat.Runner invocations without touching the host.
type natRecorder struct {
	mu    sync.Mutex
	calls []string
	err   error
}

func (r *natRecorder) runner(binary string, args ...string) error {
	r.mu.Lock()
	r.calls = append(r.calls, binary+" "+strings.Join(args, " "))
	r.mu.Unlock()
	return r.err
}

func (r *natRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

// fakeXray satisfies xrayApplier.
type fakeXray struct {
	running bool
	applied int
}

func (f *fakeXray) IsRunning() bool { return f.running }
func (f *fakeXray) ApplyConfig(configJSON []byte) error {
	f.applied++
	return nil
}

func TestApplyUDPHopNatFromEnvelope(t *testing.T) {
	t.Run("absent null and empty fields are no-ops", func(t *testing.T) {
		for _, raw := range []json.RawMessage{nil, {}, []byte("null"), []byte("")} {
			rec := &natRecorder{}
			applyUDPHopNatFromEnvelope(raw, rec.runner)
			if rec.count() != 0 {
				t.Fatalf("raw %q: runner called %d time(s), want 0", raw, rec.count())
			}
		}
	})
	t.Run("invalid JSON is a warning, not a run", func(t *testing.T) {
		rec := &natRecorder{}
		applyUDPHopNatFromEnvelope([]byte("{not json"), rec.runner)
		if rec.count() != 0 {
			t.Fatalf("invalid JSON must not reach the runner, got %d call(s)", rec.count())
		}
	})
	t.Run("valid list delegates to Reconcile", func(t *testing.T) {
		rec := &natRecorder{}
		applyUDPHopNatFromEnvelope(
			[]byte(`[{"fromPortMin":39620,"fromPortMax":39629,"toPort":39615}]`),
			rec.runner,
		)
		if rec.count() == 0 {
			t.Fatal("valid intents must be reconciled")
		}
		joined := strings.Join(rec.snapshot(), "\n")
		if !strings.Contains(joined, "--dport 39620:39629") || !strings.Contains(joined, "--to-ports 39615") {
			t.Fatalf("REDIRECT rule missing from runner calls: %v", rec.snapshot())
		}
	})
}

func (r *natRecorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.calls...)
}

// pullServer returns a panel stand-in answering pull-xray-config with the
// given envelope body.
func pullServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func withNatRunner(t *testing.T, rec *natRecorder) {
	t.Helper()
	old := pullNatRunner
	pullNatRunner = rec.runner
	t.Cleanup(func() { pullNatRunner = old })
}

// TestPullReconcilesNatEvenWhenXrayRuns pins the QA finding: after a container
// restart with a local config cache, the pull must still reconcile the udphop
// NAT rules although the Xray config itself is not reapplied.
func TestPullReconcilesNatEvenWhenXrayRuns(t *testing.T) {
	srv := pullServer(t, `{"config":{"inbounds":[]},"udphopNat":[{"fromPortMin":39620,"fromPortMax":39629,"toPort":39615}],"nodeId":110}`)
	rec := &natRecorder{}
	withNatRunner(t, rec)
	mgr := &fakeXray{running: true}

	out := pullAndApplyOnce(srv.URL, "http://127.0.0.1:8082", [32]byte{}, false, mgr, nil, nil, nil)
	if !out.applied {
		t.Fatalf("pull outcome applied=false, want true")
	}
	if mgr.applied != 0 {
		t.Fatalf("running Xray config was reapplied (%d time(s)), want 0", mgr.applied)
	}
	if rec.count() == 0 {
		t.Fatal("NAT reconcile was skipped although the envelope carried intents")
	}
	if !strings.Contains(strings.Join(rec.snapshot(), "\n"), "--dport 39620:39629") {
		t.Fatalf("REDIRECT rule missing from runner calls: %v", rec.snapshot())
	}
}

func TestPullAppliesConfigWhenXrayDown(t *testing.T) {
	srv := pullServer(t, `{"config":{"inbounds":[]},"udphopNat":[],"nodeId":110}`)
	rec := &natRecorder{}
	withNatRunner(t, rec)
	mgr := &fakeXray{running: false}

	out := pullAndApplyOnce(srv.URL, "http://127.0.0.1:8082", [32]byte{}, false, mgr, nil, nil, nil)
	if !out.applied || mgr.applied != 1 {
		t.Fatalf("applied=%v configApplies=%d, want true/1", out.applied, mgr.applied)
	}
	// Empty intent list still reconciles (rules removal) — the existence probe runs.
	if rec.count() == 0 {
		t.Fatal("empty udphopNat list must still be reconciled (rule removal)")
	}
}
