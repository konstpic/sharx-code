package client

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/konstpic/sharx-code/v2/network/identity"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

func testCredentials(t *testing.T) Credentials {
	t.Helper()
	// Self-signed server cert is fine: the client pins its own CA; here we just need
	// a TLS server to capture request semantics, so skip server verification.
	signing, err := identity.GenerateSigningKeys()
	if err != nil {
		t.Fatal(err)
	}
	certPEM, keyPEM, caPEM := "x", "x", "x"
	_ = caPEM
	c := Credentials{URL: "https://example.invalid", CertPEM: certPEM, KeyPEM: keyPEM, Signing: signing}
	return c
}

func TestSignUsageReport(t *testing.T) {
	signing, _ := identity.GenerateSigningKeys()
	c := &Client{cred: Credentials{Signing: signing}, http: &http.Client{}}
	report := protocol.UsageReport{
		SessionID: uuid.NewString(), Seq: 3, UpBytes: 100, DownBytes: 200,
		CumUpBytes: 300, CumDownBytes: 600, Ts: time.Now().Unix(),
	}
	if err := c.SignUsageReport(&report); err != nil {
		t.Fatal(err)
	}
	sig, err := base64.StdEncoding.DecodeString(report.Signature)
	if err != nil {
		t.Fatal(err)
	}
	canonical, _ := protocol.CanonicalReportForSignature(report)
	if !ed25519.Verify(signing.Public, canonical, sig) {
		t.Fatal("signature does not verify")
	}
	// Tampering breaks the signature.
	report.DownBytes++
	canonicalTampered, _ := protocol.CanonicalReportForSignature(report)
	if ed25519.Verify(signing.Public, canonicalTampered, sig) {
		t.Fatal("tampered report must not verify against old signature")
	}
}

func TestMutatingHeadersAndRetry(t *testing.T) {
	var calls int32
	var lastIdem, lastNonce, lastTs string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		lastIdem = r.Header.Get("Idempotency-Key")
		lastNonce = r.Header.Get("X-Sharx-Nonce")
		lastTs = r.Header.Get("X-Sharx-Timestamp")
		if n < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	cred := testCredentials(t)
	cred.URL = srv.URL
	c := &Client{cred: cred, http: &http.Client{
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		Timeout:   5 * time.Second,
	}}
	var out map[string]any
	if err := c.mutating(context.Background(), "/v1/x", map[string]string{"a": "b"}, "idem-1", &out); err != nil {
		t.Fatalf("expected success after retries: %v", err)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected 3 calls, got %d", calls)
	}
	if lastIdem != "idem-1" {
		t.Fatalf("idem header lost: %q", lastIdem)
	}
	if _, err := uuid.Parse(lastNonce); err != nil {
		t.Fatalf("nonce must be a uuid: %q", lastNonce)
	}
	if lastTs == "" {
		t.Fatal("timestamp header missing")
	}
	if out["ok"] != true {
		t.Fatalf("bad body: %v", out)
	}
}

func Test4xxNoRetry(t *testing.T) {
	var calls int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"insufficient_balance","message":"no credits"}`))
	}))
	defer srv.Close()
	cred := testCredentials(t)
	cred.URL = srv.URL
	c := &Client{cred: cred, http: &http.Client{
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		Timeout:   5 * time.Second,
	}}
	err := c.mutating(context.Background(), "/v1/x", map[string]string{}, "idem-2", nil)
	var ce *CoordinatorError
	if !errors.As(err, &ce) {
		t.Fatalf("expected CoordinatorError, got %T %v", err, err)
	}
	if ce.Code != "insufficient_balance" {
		t.Fatalf("bad code: %v", ce.Code)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("4xx must not retry, got %d calls", calls)
	}
}

func TestCircuitBreaker(t *testing.T) {
	breaker.Lock()
	breaker.failures = map[string]int{}
	breaker.openUntil = map[string]time.Time{}
	breaker.Unlock()
	url := "https://breaker-test.invalid"
	for i := 0; i < breakerThreshold; i++ {
		recordFailure(url)
	}
	if !breakerOpen(url) {
		t.Fatal("breaker must open after threshold failures")
	}
	recordSuccess(url)
	if breakerOpen(url) {
		t.Fatal("breaker must close after a success")
	}
}

func TestLedgerCursorParsing(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.RawQuery, "cursor=5") {
			t.Errorf("cursor param missing: %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"entries":[],"next_cursor":42}`))
	}))
	defer srv.Close()
	cred := testCredentials(t)
	cred.URL = srv.URL
	c := &Client{cred: cred, http: &http.Client{
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		Timeout:   5 * time.Second,
	}}
	_, next, err := c.Ledger(context.Background(), 5, 100)
	if err != nil {
		t.Fatal(err)
	}
	if next != 42 {
		t.Fatalf("next cursor: %d", next)
	}
}
