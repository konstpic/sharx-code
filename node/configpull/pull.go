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
	nodeConfig "github.com/konstpic/sharx-code/v2/node/config"
	"github.com/konstpic/sharx-code/v2/node/amneziawg"
	"github.com/konstpic/sharx-code/v2/node/telemt"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
	"github.com/konstpic/sharx-code/v2/node/xray"
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
	applied              bool
	statusCode           int
	retryWithoutNodeID   bool
}

// TryPullAndApply requests the latest Xray JSON (and optional Telemt payloads) from the panel and applies if Xray is not running.
// Retries with backoff on transient errors; clears stale nodeId and retries by address after HTTP 401.
func TryPullAndApply(panelURL, nodeAddress string, hmacKey [32]byte, mgr *xray.Manager, telemtMgr *telemt.Manager, awgMgr *amneziawg.Manager, telemtWebMgr *telemtweb.Manager) {
	for attempt, delay := range startupPullDelays {
		if attempt > 0 {
			time.Sleep(delay)
		}
		if mgr != nil && mgr.IsRunning() {
			return
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
			return
		}
		// Permanent client errors: no point retrying in this startup burst.
		if out.statusCode == http.StatusUnauthorized || out.statusCode == http.StatusForbidden {
			break
		}
	}
}

// StartBackgroundPull retries pull-xray-config until Xray is running or the worker stops trying.
func StartBackgroundPull(panelURL, nodeAddress string, hmacKey [32]byte, mgr *xray.Manager, telemtMgr *telemt.Manager, awgMgr *amneziawg.Manager, telemtWebMgr *telemtweb.Manager) {
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
			if mgr.IsRunning() {
				return
			}
			<-ticker.C
			if mgr.IsRunning() {
				return
			}
			logger.Infof("Config pull: background retry (%d/%d), xray not running", i+1, maxTicks)
			TryPullAndApply(panelURL, nodeAddress, hmacKey, mgr, telemtMgr, awgMgr, telemtWebMgr)
		}
	}()
}

func pullAndApplyOnce(
	panelURL, nodeAddress string,
	hmacKey [32]byte,
	omitNodeID bool,
	mgr *xray.Manager,
	telemtMgr *telemt.Manager,
	awgMgr *amneziawg.Manager,
	telemtWebMgr *telemtweb.Manager,
) pullOutcome {
	panelURL = strings.TrimSpace(panelURL)
	nodeAddress = strings.TrimSpace(nodeAddress)
	if panelURL == "" || nodeAddress == "" {
		return pullOutcome{}
	}
	if mgr == nil || mgr.IsRunning() {
		return pullOutcome{applied: mgr != nil && mgr.IsRunning()}
	}

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
	if len(envelope.Config) == 0 {
		logger.Warningf("Config pull: empty config in response")
		return pullOutcome{statusCode: resp.StatusCode}
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
