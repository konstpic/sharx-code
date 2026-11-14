// Package configpull fetches Xray configuration from the panel on worker startup (HMAC pairing).
package configpull

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/amneziawg"
	nodeConfig "github.com/konstpic/sharx-code/v2/node/config"
	"github.com/konstpic/sharx-code/v2/node/telemt"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
	"github.com/konstpic/sharx-code/v2/node/udphopnat"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
	"github.com/konstpic/sharx-code/v2/util/pairing_outbound"
)

// startupPullDelays are waits before retrying pull-xray-config when Xray is not running yet.
var startupPullDelays = []time.Duration{
	0,
	2 * time.Second,
	5 * time.Second,
	10 * time.Second,
	30 * time.Second,
}

type pullOutcome struct {
	applied            bool
	statusCode         int
	retryWithoutNodeID bool
}

// xrayApplier is the slice of *xray.Manager the pull path needs; an interface
// keeps pullAndApplyOnce unit-testable without a real Xray process.
type xrayApplier interface {
	IsRunning() bool
	ApplyConfig(configJSON []byte) error
}

// pullNatRunner, when set, replaces the production netfilter runner in the
// pull path (tests inject a recorder here; nil = udphopnat.ExecRunner).
var pullNatRunner udphopnat.Runner

// TryPullAndApply requests the latest Xray JSON (and optional Telemt payloads) from the panel and applies if Xray is not running.
// Attempt 0 always pulls: xray.NewManager() starts Xray from the local bin/config.json cache
// before this runs, so IsRunning() is already true on a container restart — the pull is still
// required to reconcile the host udphop NAT rules the cache knows nothing about.
// Retries with backoff on transient errors; clears stale nodeId and retries by address after HTTP 401.
func TryPullAndApply(panelURL, nodeAddress string, hmacKey [32]byte, mgr xrayApplier, telemtMgr *telemt.Manager, awgMgr *amneziawg.Manager, telemtWebMgr *telemtweb.Manager) {
	for attempt, delay := range startupPullDelays {
		if attempt > 0 {
			// Retries are pointless once Xray runs: pullAndApplyOnce on a live Xray
			// only reconciles NAT and reports applied=true, but a running process
			// means the startup burst already had its chance.
			if mgr != nil && mgr.IsRunning() {
				return
			}
			time.Sleep(delay)
		}
		out := pullAndApplyOnce(panelURL, nodeAddress, hmacKey, false, mgr, telemtMgr, awgMgr, telemtWebMgr)
		if out.applied {
			return
		}
		if out.retryWithoutNodeID {
			if err := nodeConfig.ClearNodeId(); err != nil {
				logger.Warningf("Config pull: clear stale node id: %v", err)
			} else {
				logger.Warningf("Config pull: cleared stale nodeId, retrying by nodeAddress only")
			}
			out = pullAndApplyOnce(panelURL, nodeAddress, hmacKey, true, mgr, telemtMgr, awgMgr, telemtWebMgr)
			if out.applied {
				return
			}
		}
		if mgr != nil && mgr.IsRunning() {
			// Xray came up while we were pulling (another goroutine/watchdog):
			// stop burning the remaining backoff slots.
			return
		}
		// Permanent client errors: no point retrying in this startup burst.
		if out.statusCode == http.StatusUnauthorized || out.statusCode == http.StatusForbidden {
			break
		}
	}
}

// StartBackgroundPull retries pull-xray-config until Xray is running or the worker stops trying.
// The pull runs BEFORE the IsRunning gate on purpose: a live Xray started from the local cache
// still needs one reconcile pass for the host udphop NAT rules, and pullAndApplyOnce returns
// immediately in that case — so the loop exits after the first tick instead of idling 30 minutes.
func StartBackgroundPull(panelURL, nodeAddress string, hmacKey [32]byte, mgr xrayApplier, telemtMgr *telemt.Manager, awgMgr *amneziawg.Manager, telemtWebMgr *telemtweb.Manager) {
	panelURL = strings.TrimSpace(panelURL)
	nodeAddress = strings.TrimSpace(nodeAddress)
	if panelURL == "" || nodeAddress == "" || mgr == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		const maxTicks = 30 // ~30 minutes
		for i := 0; i < maxTicks; i++ {
			<-ticker.C
			TryPullAndApply(panelURL, nodeAddress, hmacKey, mgr, telemtMgr, awgMgr, telemtWebMgr)
			if mgr.IsRunning() {
				return
			}
			logger.Infof("Config pull: background retry (%d/%d), xray not running", i+1, maxTicks)
		}
	}()
}

func pullAndApplyOnce(
	panelURL, nodeAddress string,
	hmacKey [32]byte,
	omitNodeID bool,
	mgr xrayApplier,
	telemtMgr *telemt.Manager,
	awgMgr *amneziawg.Manager,
	telemtWebMgr *telemtweb.Manager,
) pullOutcome {
	panelURL = strings.TrimSpace(panelURL)
	nodeAddress = strings.TrimSpace(nodeAddress)
	if panelURL == "" || nodeAddress == "" {
		return pullOutcome{}
	}
	if mgr == nil {
		return pullOutcome{}
	}
	// NOTE: no early return on mgr.IsRunning() any more. The node may have
	// started Xray from the local bin/config.json cache while the host
	// netfilter still lost the udphop REDIRECT rules (container restart);
	// the pull response below reconciles them even when the Xray config
	// itself is then left untouched.

	type pullBody struct {
		NodeAddress string `json:"nodeAddress"`
		NodeId      int    `json:"nodeId,omitempty"`
	}
	reqBody := pullBody{NodeAddress: nodeAddress}
	if !omitNodeID {
		if cfg := nodeConfig.GetConfig(); cfg != nil && cfg.NodeId > 0 {
			reqBody.NodeId = cfg.NodeId
		}
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		logger.Warningf("Config pull: marshal request: %v", err)
		return pullOutcome{}
	}

	endpoint := strings.TrimRight(panelURL, "/") + "/panel/api/node/pull-xray-config"
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		logger.Warningf("Config pull: build request: %v", err)
		return pullOutcome{}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sharx-Signature", "v1="+pairing_outbound.SignBody(hmacKey, payload))

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logger.Warningf("Config pull: request failed: %v", err)
		return pullOutcome{}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		logger.Warningf("Config pull: read body: %v", err)
		return pullOutcome{}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyStr := strings.TrimSpace(string(body))
		logger.Warningf("Config pull: panel HTTP %d: %s", resp.StatusCode, bodyStr)
		out := pullOutcome{statusCode: resp.StatusCode}
		if resp.StatusCode == http.StatusUnauthorized && reqBody.NodeId > 0 {
			out.retryWithoutNodeID = true
		}
		return out
	}

	var envelope struct {
		Config    json.RawMessage `json:"config"`
		Telemt    json.RawMessage `json:"telemt"`
		AmneziaWG json.RawMessage `json:"amneziawg"`
		TelemtWeb json.RawMessage `json:"telemtWeb"`
		UdphopNat json.RawMessage `json:"udphopNat"`
		NodeId    int             `json:"nodeId,omitempty"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		logger.Warningf("Config pull: invalid JSON: %v", err)
		return pullOutcome{statusCode: resp.StatusCode}
	}
	if envelope.NodeId > 0 {
		if err := nodeConfig.SetNodeId(envelope.NodeId); err != nil {
			logger.Warningf("Config pull: failed to persist node id: %v", err)
		} else {
			logger.Infof("Config pull: panel assigned nodeId=%d", envelope.NodeId)
		}
	}
	// Reconcile the host udphop NAT rules on every pull, running or not: the
	// rules live outside Xray and survive nothing between container restarts.
	applyUDPHopNatFromEnvelope(envelope.UdphopNat, pullNatRunner)

	if len(envelope.Config) == 0 {
		logger.Warningf("Config pull: empty config in response")
		return pullOutcome{statusCode: resp.StatusCode}
	}

	if mgr.IsRunning() {
		// Xray already runs from the local cache: keep its config untouched
		// (the panel's config equals the cache in the steady state) — only the
		// NAT rules above were reconciled.
		logger.Info("Config pull: Xray already running, config not reapplied (udphop NAT reconciled)")
		return pullOutcome{applied: true, statusCode: resp.StatusCode}
	}

	if err := mgr.ApplyConfig(envelope.Config); err != nil {
		logger.Warningf("Config pull: apply config: %v", err)
		return pullOutcome{statusCode: resp.StatusCode}
	}
	logger.Infof("Config pull: applied Xray configuration from panel (%d bytes)", len(envelope.Config))

	applyTelemtFromEnvelope(telemtMgr, envelope.Telemt)
	applyAmneziaWgFromEnvelope(awgMgr, envelope.AmneziaWG)
	applyTelemtWebFromEnvelope(telemtWebMgr, envelope.TelemtWeb)
	return pullOutcome{applied: true, statusCode: resp.StatusCode}
}

// applyUDPHopNatFromEnvelope reconciles the host udphop REDIRECT rules from the
// pull response (same field and semantics as apply-config). Best-effort like
// everywhere else: warnings only, never block the startup pull. A nil/absent/
// "null" field means the panel sent no desired state and nothing is touched.
// run may be nil (production: udphopnat.ExecRunner).
func applyUDPHopNatFromEnvelope(raw json.RawMessage, run udphopnat.Runner) {
	if len(raw) == 0 || string(raw) == "null" {
		return
	}
	var intents []finalmask.UDPHopNatIntent
	if err := json.Unmarshal(raw, &intents); err != nil {
		logger.Warningf("Config pull: udphopNat parse: %v", err)
		return
	}
	if warnings := udphopnat.Reconcile(run, intents); len(warnings) > 0 {
		logger.Warningf("Config pull: udphop NAT reconcile warnings: %v", warnings)
	}
}

func applyTelemtWebFromEnvelope(telemtWebMgr *telemtweb.Manager, raw json.RawMessage) {
	if telemtWebMgr == nil || len(raw) == 0 || string(raw) == "null" {
		return
	}
	var vhosts []telemtweb.Vhost
	if err := json.Unmarshal(raw, &vhosts); err != nil {
		logger.Warningf("Config pull: telemtweb parse: %v", err)
		return
	}
	if err := telemtWebMgr.Apply(vhosts); err != nil {
		logger.Warningf("Config pull: telemtweb apply: %v", err)
		return
	}
	logger.Infof("Config pull: applied Telemt-WEB vhosts (%d)", len(vhosts))
}

func applyAmneziaWgFromEnvelope(awgMgr *amneziawg.Manager, raw json.RawMessage) {
	if awgMgr == nil || len(raw) == 0 || string(raw) == "null" {
		return
	}
	var payloads []amneziawg.Payload
	if err := json.Unmarshal(raw, &payloads); err != nil {
		logger.Warningf("Config pull: amneziawg parse: %v", err)
		return
	}
	if err := awgMgr.Apply(payloads); err != nil {
		logger.Warningf("Config pull: amneziawg apply: %v", err)
		return
	}
	logger.Infof("Config pull: applied AmneziaWG payloads (%d)", len(payloads))
}

func applyTelemtFromEnvelope(telemtMgr *telemt.Manager, raw json.RawMessage) {
	if telemtMgr == nil || len(raw) == 0 || string(raw) == "null" {
		return
	}
	var payloads []telemt.Payload
	if err := json.Unmarshal(raw, &payloads); err != nil {
		logger.Warningf("Config pull: telemt parse: %v", err)
		return
	}
	if err := telemtMgr.Apply(payloads); err != nil {
		logger.Warningf("Config pull: telemt apply: %v", err)
		return
	}
	logger.Infof("Config pull: applied Telemt payloads (%d)", len(payloads))
}
