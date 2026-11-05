package verification

import (
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"github.com/konstpic/sharx-code/v2/node/nodecache"
	"io"
	"net/http"
	"sync"
	"time"
)

type Probe interface {
	Check(context.Context, protocol.SessionLink) error
}

// Service is run by an independent operator with its own key, probe target and
// persistent checkpoint/vote journal. It never accepts an operator id from a task.
type Service struct {
	ID          string
	OperatorID  string
	PrivateKey  ed25519.PrivateKey
	Token       string
	Probe       Probe
	JournalPath string
	mu          sync.Mutex
}
type witnessJournal struct {
	Checkpoints map[int64]protocol.Digest               `json:"checkpoints"`
	Votes       map[string]protocol.VerifierObservation `json:"votes"`
}

func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/probe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
		payload, err := io.ReadAll(r.Body)
		if err != nil || len(payload) != 64*1024 || len(r.URL.Query().Get("nonce")) != 32 {
			http.Error(w, "invalid probe", 400)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(payload)
	})
	mux.HandleFunc("/checkpoint", s.checkpoint)
	mux.HandleFunc("/checkpoints", s.appendCheckpoints)
	mux.HandleFunc("/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		provided := r.Header.Get("Authorization")
		if s.Token == "" || subtle.ConstantTimeCompare([]byte(provided), []byte("Bearer "+s.Token)) != 1 {
			http.Error(w, "unauthorized", 401)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		var task protocol.VerificationTask
		if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
			http.Error(w, "invalid task", 400)
			return
		}
		observation, err := s.Verify(r.Context(), task)
		if err != nil {
			http.Error(w, "verification unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(observation)
	})
	return mux
}
func (s *Service) Verify(ctx context.Context, task protocol.VerificationTask) (protocol.VerifierObservation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.PrivateKey) != ed25519.PrivateKeySize || s.Probe == nil || s.JournalPath == "" {
		return protocol.VerifierObservation{}, errors.New("verifier not configured")
	}
	journal := witnessJournal{Checkpoints: map[int64]protocol.Digest{}, Votes: map[string]protocol.VerifierObservation{}}
	if _, err := nodecache.Load(s.JournalPath, &journal); err != nil {
		return protocol.VerifierObservation{}, err
	}
	if journal.Checkpoints == nil || journal.Votes == nil {
		return protocol.VerifierObservation{}, errors.New("invalid witness journal")
	}
	expected := Observation(task, s.ID, s.OperatorID, protocol.ObservationPass)
	if existing, ok := journal.Votes[task.ID]; ok {
		if existing.TaskDigest != expected.TaskDigest || existing.ReportHash != expected.ReportHash || existing.EvidenceDigest != expected.EvidenceDigest || existing.PolicyHash != expected.PolicyHash || existing.CheckpointHash != expected.CheckpointHash {
			return protocol.VerifierObservation{}, errors.New("task equivocation")
		}
		return existing, nil
	}
	status := protocol.ObservationPass
	if err := ValidateTaskWithCheckpoints(task, time.Now(), journal.Checkpoints); err != nil {
		status = protocol.ObservationFail
	} else {
		for _, entry := range task.Log {
			if known, ok := journal.Checkpoints[entry.Seq]; ok && known != entry.EntryHash {
				return protocol.VerifierObservation{}, errors.New("transparency fork")
			}
			journal.Checkpoints[entry.Seq] = entry.EntryHash
		}
		probeCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		err := s.Probe.Check(probeCtx, task.Link)
		cancel()
		if err != nil {
			status = protocol.ObservationUnavailable
		}
	}
	observation := Observation(task, s.ID, s.OperatorID, status)
	if err := protocol.SignVerifierObservation(s.PrivateKey, &observation); err != nil {
		return observation, err
	}
	// Temporary network failure is retried; positive and negative decisions are immutable.
	if status != protocol.ObservationUnavailable {
		journal.Votes[task.ID] = observation
	}
	if err := nodecache.Save(s.JournalPath, journal); err != nil {
		return observation, err
	}
	return observation, nil
}
