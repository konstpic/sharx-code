package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"github.com/konstpic/sharx-code/v2/node/nodecache"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type evidenceState struct {
	Key  []byte                           `json:"key"`
	Last map[string]protocol.NodeEvidence `json:"last"`
}

var evidenceMu sync.Mutex

func loadEvidenceState() (evidenceState, error) {
	var state evidenceState
	found, err := nodecache.Load(filepath.Join(networkStateDir(), "network-evidence.json"), &state)
	if err != nil {
		return state, err
	}
	if !found {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return state, err
		}
		state = evidenceState{Key: key, Last: map[string]protocol.NodeEvidence{}}
		err = nodecache.Save(filepath.Join(networkStateDir(), "network-evidence.json"), state)
		if err != nil {
			return state, err
		}
	}
	if len(state.Key) != ed25519.PrivateKeySize || state.Last == nil {
		return state, errors.New("invalid evidence state")
	}
	return state, nil
}
func (s *Server) networkEvidenceKey(c *gin.Context) {
	evidenceMu.Lock()
	defer evidenceMu.Unlock()
	state, err := loadEvidenceState()
	if err != nil {
		c.JSON(503, gin.H{"error": "evidence key unavailable"})
		return
	}
	c.JSON(200, gin.H{"public_key": base64.StdEncoding.EncodeToString(ed25519.PrivateKey(state.Key).Public().(ed25519.PublicKey))})
}
func (s *Server) networkEvidence(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var req struct {
		NodeID     string `json:"node_id"`
		ProviderID string `json:"provider_id"`
		SessionID  string `json:"session_id"`
		Email      string `json:"email"`
		Seq        uint64 `json:"seq"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Seq == 0 || !strings.HasPrefix(req.Email, "sn-") {
		c.JSON(400, gin.H{"error": "invalid evidence request"})
		return
	}
	evidenceMu.Lock()
	defer evidenceMu.Unlock()
	state, err := loadEvidenceState()
	if err != nil {
		c.JSON(503, gin.H{"error": "evidence unavailable"})
		return
	}
	previous, found := state.Last[req.SessionID]
	if found && previous.EvidenceSeq == req.Seq {
		if previous.ClientEmail != req.Email || previous.NodeID != req.NodeID || previous.ProviderParticipantID != req.ProviderID {
			c.JSON(409, gin.H{"error": "evidence identity conflict"})
			return
		}
		c.JSON(200, previous)
		return
	}
	if (!found && req.Seq != 1) || (found && req.Seq != previous.EvidenceSeq+1) {
		c.JSON(409, gin.H{"error": "evidence sequence gap"})
		return
	}
	stats, err := s.xrayManager.GetStats(false)
	if err != nil {
		c.JSON(503, gin.H{"error": "worker counters unavailable"})
		return
	}
	counters := stats.NetworkCounters[req.Email]
	if (!found && counters[0] == 0 && counters[1] == 0) || (found && counters[0] == previous.CumUpBytes && counters[1] == previous.CumDownBytes) {
		c.Status(204)
		return
	}
	evidence := protocol.NodeEvidence{Version: 1, NodeID: req.NodeID, ProviderParticipantID: req.ProviderID, SessionID: req.SessionID, ClientEmail: req.Email, EvidenceSeq: req.Seq, BootID: "persistent-counters-v1", ObservedAt: time.Now().Unix(), Nonce: []byte(uuid.NewString()), CumUpBytes: counters[0], CumDownBytes: counters[1], XrayBuild: config.GetVersion(), ConfigGeneration: "network-v1"}
	if found {
		evidence.PreviousEvidenceHash, _ = previous.Digest()
		if err := protocol.CheckEvidenceLink(previous, evidence); err != nil {
			c.JSON(409, gin.H{"error": "counter continuity failure"})
			return
		}
	}
	if err := protocol.SignNodeEvidence(ed25519.PrivateKey(state.Key), &evidence); err != nil {
		c.JSON(500, gin.H{"error": "evidence signing failed"})
		return
	}
	state.Last[req.SessionID] = evidence
	if err := nodecache.Save(filepath.Join(networkStateDir(), "network-evidence.json"), state); err != nil {
		c.JSON(503, gin.H{"error": "evidence persistence failed"})
		return
	}
	c.JSON(200, evidence)
}
