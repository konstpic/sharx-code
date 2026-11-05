package verification

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"github.com/konstpic/sharx-code/v2/node/nodecache"
	"net/http"
)

type Checkpoint struct {
	Seq  int64           `json:"seq"`
	Hash protocol.Digest `json:"hash"`
}

func (s *Service) authenticated(r *http.Request) bool {
	return s.Token != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.Token)) == 1
}
func (s *Service) loadJournal() (witnessJournal, error) {
	j := witnessJournal{Checkpoints: map[int64]protocol.Digest{}, Votes: map[string]protocol.VerifierObservation{}}
	_, err := nodecache.Load(s.JournalPath, &j)
	if err != nil {
		return j, err
	}
	if j.Checkpoints == nil || j.Votes == nil {
		return j, errors.New("invalid journal")
	}
	return j, nil
}
func tip(j witnessJournal) Checkpoint {
	result := Checkpoint{Hash: protocol.TransparencyGenesis}
	for seq, hash := range j.Checkpoints {
		if seq > result.Seq {
			result = Checkpoint{Seq: seq, Hash: hash}
		}
	}
	return result
}
func (s *Service) checkpoint(w http.ResponseWriter, r *http.Request) {
	if !s.authenticated(r) {
		http.Error(w, "unauthorized", 401)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", 405)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.loadJournal()
	if err != nil {
		http.Error(w, "journal unavailable", 503)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(tip(j))
}
func (s *Service) appendCheckpoints(w http.ResponseWriter, r *http.Request) {
	if !s.authenticated(r) {
		http.Error(w, "unauthorized", 401)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", 405)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var entries []protocol.TransparencyEntry
	if err := json.NewDecoder(r.Body).Decode(&entries); err != nil || len(entries) > 500 {
		http.Error(w, "invalid proof page", 400)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.loadJournal()
	if err != nil {
		http.Error(w, "journal unavailable", 503)
		return
	}
	checkpoint := tip(j)
	for _, entry := range entries {
		if existing, ok := j.Checkpoints[entry.Seq]; ok {
			if existing != entry.EntryHash {
				http.Error(w, "transparency fork", 409)
				return
			}
			continue
		}
		if entry.Seq != checkpoint.Seq+1 || entry.PreviousHash != checkpoint.Hash || entry.EntryHash != TransparencyHash(checkpoint.Hash, entry.Payload) {
			http.Error(w, "invalid consistency proof", 409)
			return
		}
		j.Checkpoints[entry.Seq] = entry.EntryHash
		checkpoint = Checkpoint{Seq: entry.Seq, Hash: entry.EntryHash}
	}
	if err := nodecache.Save(s.JournalPath, j); err != nil {
		http.Error(w, "journal persistence failed", 503)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(checkpoint)
}
