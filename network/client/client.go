// Package client is the panel-side mTLS client for the SharX Network coordinator.
// It enforces idempotency keys, replay-protection headers and signed usage reports,
// retries transient failures with backoff and circuit-breaks a failing coordinator.
package client

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/konstpic/sharx-code/v2/network/identity"
	ledger "github.com/konstpic/sharx-code/v2/network/credits"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

// CoordinatorError is a typed API error with a stable code.
type CoordinatorError struct {
	Code    string
	Message string
	Status  int
}

func (e *CoordinatorError) Error() string {
	return fmt.Sprintf("%s: %s (http %d)", e.Code, e.Message, e.Status)
}

// Credentials bundles everything needed to talk to a coordinator.
type Credentials struct {
	URL     string
	CertPEM string
	KeyPEM  string
	CaPEM   string
	Signing *identity.SigningKeys
}

type Client struct {
	cred Credentials
	http *http.Client
}

func New(cred Credentials) (*Client, error) {
	cert, err := tls.X509KeyPair([]byte(cred.CertPEM), []byte(cred.KeyPEM))
	if err != nil {
		return nil, fmt.Errorf("network client: bad certificate: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(cred.CaPEM)) {
		return nil, errors.New("network client: bad CA PEM")
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			RootCAs:      roots,
			MinVersion:   tls.VersionTLS12,
		},
	}
	return &Client{
		cred: cred,
		http: &http.Client{Transport: transport, Timeout: 20 * time.Second},
	}, nil
}

// Enroll runs the invite-based bootstrap without mTLS. Trust is established by
// TOFU consistency: the CA returned in the response must be the issuer of the
// server certificate that presented it, so a man-in-the-middle cannot substitute
// its own CA while relaying the invite.
func Enroll(ctx context.Context, coordinatorURL string, req protocol.EnrollRequest) (*protocol.EnrollResponse, error) {
	body, _ := json.Marshal(req)
	var serverCert *x509.Certificate
	httpClient := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, // verified manually against the response CA below
			VerifyConnection: func(cs tls.ConnectionState) error {
				if len(cs.PeerCertificates) > 0 {
					serverCert = cs.PeerCertificates[0]
				}
				return nil
			},
		}},
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, coordinatorURL+"/v1/enroll", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Sharx-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))
	r.Header.Set("X-Sharx-Nonce", uuid.NewString())
	resp, err := httpClient.Do(r)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp.StatusCode, raw)
	}
	var out protocol.EnrollResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if err := verifyEnrollCA(serverCert, out.CAPEM, r.URL.Hostname()); err != nil {
		return nil, err
	}
	return &out, nil
}

// verifyEnrollCA checks the coordinator CA in the response actually issued the
// server certificate seen on the wire and that the certificate is valid for the requested host.
func verifyEnrollCA(serverCert *x509.Certificate, caPEM, host string) error {
	if serverCert == nil {
		return errors.New("enroll: no server certificate presented")
	}
	if host == "" {
		return errors.New("enroll: coordinator hostname is empty")
	}
	if err := serverCert.VerifyHostname(host); err != nil {
		return fmt.Errorf("enroll: coordinator certificate hostname mismatch: %w", err)
	}
	now := time.Now()
	if now.Before(serverCert.NotBefore) || now.After(serverCert.NotAfter) {
		return errors.New("enroll: coordinator certificate is outside its validity period")
	}
	serverAuth := false
	for _, usage := range serverCert.ExtKeyUsage {
		if usage == x509.ExtKeyUsageServerAuth {
			serverAuth = true
			break
		}
	}
	if !serverAuth {
		return errors.New("enroll: coordinator certificate is not valid for server authentication")
	}
	block, _ := pem.Decode([]byte(caPEM))
	if block == nil {
		return errors.New("enroll: invalid CA in response")
	}
	ca, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return fmt.Errorf("enroll: parse CA: %w", err)
	}
	if err := serverCert.CheckSignatureFrom(ca); err != nil {
		return errors.New("enroll: server certificate is not issued by the response CA (possible MITM)")
	}
	return nil
}

// mutating performs a POST with replay-protection and idempotency headers.
func (c *Client) mutating(ctx context.Context, path string, payload any, idemKey string, out any) error {
	body, _ := json.Marshal(payload)
	if idemKey == "" {
		idemKey = uuid.NewString()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cred.URL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", idemKey)
	req.Header.Set("X-Sharx-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))
	req.Header.Set("X-Sharx-Nonce", uuid.NewString())
	var lastErr error
	backoffs := []time.Duration{0, 500 * time.Millisecond, 2 * time.Second, 8 * time.Second}
	for i, bo := range backoffs {
		if bo > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(bo):
			}
		}
		if breakerOpen(c.cred.URL) {
			return &CoordinatorError{Code: "coordinator_unavailable", Message: "circuit breaker open", Status: 503}
		}
		// Each attempt gets a fresh nonce: the coordinator rejects nonce reuse even
		// when the client is retrying after a lost response.
		attempt := req.Clone(ctx)
		attempt.Header.Set("X-Sharx-Nonce", uuid.NewString())
		attempt.Header.Set("X-Sharx-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))
		resp, err := c.http.Do(attempt)
		if err != nil {
			lastErr = err
			recordFailure(c.cred.URL)
			continue
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		// 503 is semantic here (emergency shutdown / breaker), not transient: don't retry.
		if resp.StatusCode >= 500 && resp.StatusCode != http.StatusServiceUnavailable {
			lastErr = parseError(resp.StatusCode, raw)
			recordFailure(c.cred.URL)
			continue
		}
		recordSuccess(c.cred.URL)
		if resp.StatusCode >= 400 {
			return parseError(resp.StatusCode, raw)
		}
		if out != nil {
			if err := json.Unmarshal(raw, out); err != nil {
				return err
			}
		}
		_ = i
		return nil
	}
	return &CoordinatorError{Code: "coordinator_unavailable", Message: lastErr.Error(), Status: 503}
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	if breakerOpen(c.cred.URL) {
		return &CoordinatorError{Code: "coordinator_unavailable", Message: "circuit breaker open", Status: 503}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cred.URL+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		recordFailure(c.cred.URL)
		return &CoordinatorError{Code: "coordinator_unavailable", Message: err.Error(), Status: 503}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 400 {
		if resp.StatusCode >= 500 {
			recordFailure(c.cred.URL)
		}
		return parseError(resp.StatusCode, raw)
	}
	recordSuccess(c.cred.URL)
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func parseError(status int, raw []byte) error {
	var er protocol.ErrorResponse
	if json.Unmarshal(raw, &er) == nil && er.Code != "" {
		return &CoordinatorError{Code: er.Code, Message: er.Message, Status: status}
	}
	return &CoordinatorError{Code: "http_error", Message: string(raw), Status: status}
}

// --- typed API ---

func (c *Client) RenewCert(ctx context.Context, csrPEM string) (certPEM string, expiresAt int64, err error) {
	var out struct {
		CertificatePEM       string `json:"certificate_pem"`
		CertificateExpiresAt int64  `json:"certificate_expires_at"`
	}
	err = c.mutating(ctx, "/v1/cert/renew", map[string]string{"csr_pem": csrPEM}, uuid.NewString(), &out)
	return out.CertificatePEM, out.CertificateExpiresAt, err
}

func (c *Client) Me(ctx context.Context) (*protocol.MeResponse, error) {
	var out protocol.MeResponse
	if err := c.get(ctx, "/v1/me", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateNode(ctx context.Context, idemKey string, node protocol.SharedNode) (*protocol.SharedNode, error) {
	var out struct {
		Node   protocol.SharedNode `json:"node"`
		Status string              `json:"status"`
	}
	err := c.mutating(ctx, "/v1/nodes", node, idemKey, &out)
	return &out.Node, err
}

func (c *Client) UpdateNode(ctx context.Context, id string, node protocol.SharedNode) (*protocol.SharedNode, error) {
	var out struct {
		Node protocol.SharedNode `json:"node"`
	}
	body := map[string]any{
		"node_ref": node.ID, "label": node.Label, "country": node.Country, "region": node.Region,
		"protocols": node.Protocols, "endpoint_host": node.EndpointHost, "endpoint_port": node.EndpointPort,
		"access_template": node.AccessTemplate, "capacity_mbps": node.CapacityMbps,
		"speed_limit_mbps": node.SpeedLimitMbps, "reserve_mbps": node.ReserveMbps,
		"max_sessions": node.MaxSessions, "traffic_limit_gb": node.TrafficLimitGB,
		"price_credits_per_gb": node.PriceCreditsPerGB, "paused": node.Status == protocol.NodeStatusPaused,
	}
	err := c.doPUT(ctx, "/v1/nodes/"+id, body, &out)
	return &out.Node, err
}

func (c *Client) DeleteNode(ctx context.Context, id string) error {
	return c.doDELETE(ctx, "/v1/nodes/"+id)
}

func (c *Client) doPUT(ctx context.Context, path string, payload, out any) error {
	return c.doMethod(ctx, http.MethodPut, path, payload, out)
}

func (c *Client) doDELETE(ctx context.Context, path string) error {
	return c.doMethod(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) doMethod(ctx context.Context, method, path string, payload, out any) error {
	var body io.Reader
	if payload != nil {
		raw, _ := json.Marshal(payload)
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.cred.URL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sharx-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))
	req.Header.Set("X-Sharx-Nonce", uuid.NewString())
	resp, err := c.http.Do(req)
	if err != nil {
		recordFailure(c.cred.URL)
		return &CoordinatorError{Code: "coordinator_unavailable", Message: err.Error(), Status: 503}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return parseError(resp.StatusCode, raw)
	}
	recordSuccess(c.cred.URL)
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func (c *Client) NodeHeartbeat(ctx context.Context, id string, h protocol.NodeHealth, activeSessions int) error {
	payload := map[string]any{
		"status": h.Status, "rtt_ms": h.RTTMs, "bandwidth_used_mbps": h.Bandwidth,
		"xray_up": h.XrayUp, "ts": time.Now().Unix(),
	}
	return c.mutating(ctx, "/v1/nodes/"+id+"/heartbeat", payload, uuid.NewString(), nil)
}

func (c *Client) ListMyNodes(ctx context.Context) ([]protocol.SharedNode, error) {
	var out struct {
		Nodes []protocol.SharedNode `json:"nodes"`
	}
	if err := c.get(ctx, "/v1/nodes", &out); err != nil {
		return nil, err
	}
	return out.Nodes, nil
}

func (c *Client) Catalog(ctx context.Context, country, proto string, needMbps int) ([]protocol.Candidate, error) {
	path := fmt.Sprintf("/v1/nodes/catalog?need_mbps=%d", needMbps)
	if country != "" {
		path += "&country=" + country
	}
	if proto != "" {
		path += "&protocol=" + proto
	}
	var out struct {
		Candidates []protocol.Candidate `json:"candidates"`
	}
	if err := c.get(ctx, path, &out); err != nil {
		return nil, err
	}
	return out.Candidates, nil
}

func (c *Client) Economy(ctx context.Context) (*protocol.EconomyPolicy, error) {
	var out protocol.EconomyPolicy
	err := c.get(ctx, "/v1/economy", &out)
	return &out, err
}

// OpenSession obtains an explicit current quote for non-interactive API callers.
// Interactive consumers must use OpenSessionAtQuote with the displayed revision/budget.
func (c *Client) OpenSession(ctx context.Context, idemKey, nodeID, clientRef, proto string, quotaGB float64, clientEntityID int64) (*protocol.Session, error) {
	p, err := c.Economy(ctx)
	if err != nil {
		return nil, err
	}
	bytes, err := ledger.QuotaBytes(quotaGB)
	if err != nil {
		return nil, err
	}
	reserve, err := ledger.Cost(bytes, p.RateMicros)
	if err != nil {
		return nil, err
	}
	return c.OpenSessionAtQuote(ctx, idemKey, nodeID, clientRef, proto, quotaGB, clientEntityID, p.Revision, reserve)
}
func (c *Client) OpenSessionAtQuote(ctx context.Context, idemKey, nodeID, clientRef, proto string, quotaGB float64, clientEntityID, revision, maxReserve int64) (*protocol.Session, error) {
	payload := map[string]any{"node_id": nodeID, "client_ref": clientRef, "protocol": proto, "quota_gb": quotaGB, "client_entity_id": clientEntityID, "tariff_revision": revision, "max_reserve_micros": maxReserve}
	var out struct {
		Session protocol.Session `json:"session"`
	}
	err := c.mutating(ctx, "/v1/sessions", payload, idemKey, &out)
	return &out.Session, err
}

func (c *Client) SyncSessions(ctx context.Context, role string, sinceSeq int64) ([]protocol.Session, int64, error) {
	var out struct {
		Sessions  []protocol.Session `json:"sessions"`
		ServerSeq int64              `json:"server_seq"`
	}
	path := fmt.Sprintf("/v1/sessions?role=%s&since_seq=%d", role, sinceSeq)
	if err := c.get(ctx, path, &out); err != nil {
		return nil, 0, err
	}
	return out.Sessions, out.ServerSeq, nil
}

func (c *Client) CloseSession(ctx context.Context, id, reason string) error {
	return c.mutating(ctx, "/v1/sessions/"+id+"/close", map[string]string{"reason": reason}, uuid.NewString(), nil)
}

func (c *Client) MarkProvisioned(ctx context.Context, id string) error {
	return c.mutating(ctx, "/v1/sessions/"+id+"/provisioned", map[string]any{}, uuid.NewString(), nil)
}

func (c *Client) DisputeSession(ctx context.Context, id, reason string, claimedBytes int64) error {
	return c.mutating(ctx, "/v1/sessions/"+id+"/dispute",
		map[string]any{"reason": reason, "claimed_bytes": claimedBytes}, uuid.NewString(), nil)
}

// SignUsageReport fills the ed25519 signature of a usage report.
func (c *Client) SignUsageReport(report *protocol.UsageReport) error {
	if c.cred.Signing == nil {
		return errors.New("signing key not configured")
	}
	canonical, err := protocol.CanonicalReportForSignature(*report)
	if err != nil {
		return err
	}
	sig := ed25519.Sign(c.cred.Signing.Private, canonical)
	report.Signature = base64.StdEncoding.EncodeToString(sig)
	return nil
}

func (c *Client) PushUsageReports(ctx context.Context, reports []protocol.UsageReport) (accepted, duplicates int, err error) {
	var out struct {
		Accepted   int `json:"accepted"`
		Duplicates int `json:"duplicates"`
	}
	err = c.mutating(ctx, "/v1/usage/reports", map[string]any{"reports": reports}, uuid.NewString(), &out)
	return out.Accepted, out.Duplicates, err
}

func (c *Client) PushLiveness(ctx context.Context, items []protocol.LivenessItem) error {
	return c.mutating(ctx, "/v1/usage/liveness", map[string]any{"items": items}, uuid.NewString(), nil)
}

func (c *Client) Ledger(ctx context.Context, cursor int64, limit int) ([]protocol.LedgerEntry, int64, error) {
	var out struct {
		Entries    []protocol.LedgerEntry `json:"entries"`
		NextCursor int64                  `json:"next_cursor"`
	}
	path := fmt.Sprintf("/v1/ledger?cursor=%d&limit=%d", cursor, limit)
	if err := c.get(ctx, path, &out); err != nil {
		return nil, 0, err
	}
	return out.Entries, out.NextCursor, nil
}

// --- circuit breaker (per coordinator host, in-memory) ---

var breaker = struct {
	sync.Mutex
	failures  map[string]int
	openUntil map[string]time.Time
}{failures: map[string]int{}, openUntil: map[string]time.Time{}}

const breakerThreshold = 10

func breakerOpen(url string) bool {
	breaker.Lock()
	defer breaker.Unlock()
	until, ok := breaker.openUntil[url]
	return ok && time.Now().Before(until)
}

func recordFailure(url string) {
	breaker.Lock()
	defer breaker.Unlock()
	breaker.failures[url]++
	if breaker.failures[url] >= breakerThreshold {
		breaker.openUntil[url] = time.Now().Add(5 * time.Minute)
		breaker.failures[url] = 0
	}
}

func recordSuccess(url string) {
	breaker.Lock()
	defer breaker.Unlock()
	delete(breaker.failures, url)
	delete(breaker.openUntil, url) // half-open probe succeeded: close the breaker
}
