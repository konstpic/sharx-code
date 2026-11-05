package protocol

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
)

const (
	NodeEvidenceVersion = 1
	NodeEvidenceDomain  = "sharx-network/node-evidence/v1"
)

var (
	ErrEvidenceEquivocation = errors.New("node evidence equivocation")
	ErrEvidenceNonceReplay  = errors.New("node evidence nonce replay")
	ErrEvidenceCounterReset = errors.New("node evidence counter reset without epoch change")
)

// NodeEvidence is a node-signed cumulative counter snapshot. Signature is
// Ed25519 over CanonicalNodeEvidence; all other fields are signed.
type NodeEvidence struct {
	Version               int    `json:"version"`
	NodeID                string `json:"node_id"`
	ProviderParticipantID string `json:"provider_participant_id"`
	KeyEpoch              uint64 `json:"key_epoch"`
	SessionID             string `json:"session_id"`
	ClientEmail           string `json:"client_email"`
	EvidenceSeq           uint64 `json:"evidence_seq"`
	PreviousEvidenceHash  Digest `json:"previous_evidence_hash"`
	BootID                string `json:"boot_id"`
	CounterEpoch          uint64 `json:"counter_epoch"`
	ObservedAt            int64  `json:"observed_at"`
	Nonce                 []byte `json:"nonce"`
	CumUpBytes            int64  `json:"cum_up_bytes"`
	CumDownBytes          int64  `json:"cum_down_bytes"`
	XrayBuild             string `json:"xray_build"`
	ConfigGeneration      string `json:"config_generation"`
	Signature             []byte `json:"signature"`
}

type canonicalNodeEvidence struct {
	Version               int    `json:"version"`
	NodeID                string `json:"node_id"`
	ProviderParticipantID string `json:"provider_participant_id"`
	KeyEpoch              uint64 `json:"key_epoch"`
	SessionID             string `json:"session_id"`
	ClientEmail           string `json:"client_email"`
	EvidenceSeq           uint64 `json:"evidence_seq"`
	PreviousEvidenceHash  Digest `json:"previous_evidence_hash"`
	BootID                string `json:"boot_id"`
	CounterEpoch          uint64 `json:"counter_epoch"`
	ObservedAt            int64  `json:"observed_at"`
	Nonce                 []byte `json:"nonce"`
	CumUpBytes            int64  `json:"cum_up_bytes"`
	CumDownBytes          int64  `json:"cum_down_bytes"`
	XrayBuild             string `json:"xray_build"`
	ConfigGeneration      string `json:"config_generation"`
}

func canonicalNodePayload(e NodeEvidence) canonicalNodeEvidence {
	return canonicalNodeEvidence{
		Version: e.Version, NodeID: e.NodeID, ProviderParticipantID: e.ProviderParticipantID,
		KeyEpoch: e.KeyEpoch, SessionID: e.SessionID, ClientEmail: e.ClientEmail,
		EvidenceSeq: e.EvidenceSeq, PreviousEvidenceHash: e.PreviousEvidenceHash,
		BootID: e.BootID, CounterEpoch: e.CounterEpoch, ObservedAt: e.ObservedAt,
		Nonce: e.Nonce, CumUpBytes: e.CumUpBytes, CumDownBytes: e.CumDownBytes,
		XrayBuild: e.XrayBuild, ConfigGeneration: e.ConfigGeneration,
	}
}

// CanonicalNodeEvidence returns domain || NUL || deterministic JSON. The
// signature field is deliberately excluded.
func CanonicalNodeEvidence(e NodeEvidence) ([]byte, error) {
	payload, err := json.Marshal(canonicalNodePayload(e))
	if err != nil {
		return nil, err
	}
	canonical := make([]byte, 0, len(NodeEvidenceDomain)+1+len(payload))
	canonical = append(canonical, NodeEvidenceDomain...)
	canonical = append(canonical, 0)
	canonical = append(canonical, payload...)
	return canonical, nil
}

func validateNodeEvidence(e NodeEvidence) error {
	if e.Version != NodeEvidenceVersion {
		return fmt.Errorf("unsupported node evidence version %d", e.Version)
	}
	for name, value := range map[string]string{
		"node_id": e.NodeID, "provider_participant_id": e.ProviderParticipantID,
		"session_id": e.SessionID, "client_email": e.ClientEmail, "boot_id": e.BootID,
		"xray_build": e.XrayBuild, "config_generation": e.ConfigGeneration,
	} {
		if value == "" {
			return errors.New(name + " is required")
		}
	}
	if e.EvidenceSeq == 0 {
		return errors.New("evidence_seq must be positive")
	}
	if e.ObservedAt <= 0 {
		return errors.New("observed_at must be positive")
	}
	if len(e.Nonce) == 0 {
		return errors.New("nonce is required")
	}
	if e.CumUpBytes < 0 || e.CumDownBytes < 0 {
		return errors.New("cumulative counters must be non-negative")
	}
	return nil
}

func SignNodeEvidence(private ed25519.PrivateKey, e *NodeEvidence) error {
	if e == nil {
		return errors.New("node evidence is nil")
	}
	if len(private) != ed25519.PrivateKeySize {
		return errors.New("invalid Ed25519 private key")
	}
	if err := validateNodeEvidence(*e); err != nil {
		return err
	}
	canonical, err := CanonicalNodeEvidence(*e)
	if err != nil {
		return err
	}
	e.Signature = ed25519.Sign(private, canonical)
	return nil
}

func VerifyNodeEvidence(public ed25519.PublicKey, e NodeEvidence) error {
	if err := validateNodeEvidence(e); err != nil {
		return err
	}
	if len(public) != ed25519.PublicKeySize {
		return errors.New("invalid Ed25519 public key")
	}
	if len(e.Signature) != ed25519.SignatureSize {
		return errors.New("invalid node evidence signature length")
	}
	canonical, err := CanonicalNodeEvidence(e)
	if err != nil {
		return err
	}
	if !ed25519.Verify(public, canonical, e.Signature) {
		return errors.New("invalid node evidence signature")
	}
	return nil
}

// Digest identifies the signed evidence content, excluding the signature.
func (e NodeEvidence) Digest() (Digest, error) {
	canonical, err := CanonicalNodeEvidence(e)
	if err != nil {
		return Digest{}, err
	}
	return sha256.Sum256(canonical), nil
}

// EvidenceEquivocation reports two different signed payloads for one sequence
// number in the same node/session/key-epoch history.
func EvidenceEquivocation(a, b NodeEvidence) (bool, error) {
	if a.NodeID != b.NodeID || a.SessionID != b.SessionID ||
		a.KeyEpoch != b.KeyEpoch || a.EvidenceSeq != b.EvidenceSeq {
		return false, nil
	}
	aDigest, err := a.Digest()
	if err != nil {
		return false, err
	}
	bDigest, err := b.Digest()
	if err != nil {
		return false, err
	}
	return aDigest != bDigest, nil
}

// CheckEvidenceLink validates sequence, hash chaining, nonce freshness and
// counter monotonicity. Lower counters require exactly the next counter epoch
// and a new boot ID.
func CheckEvidenceLink(previous, next NodeEvidence) error {
	if previous.NodeID != next.NodeID || previous.ProviderParticipantID != next.ProviderParticipantID ||
		previous.SessionID != next.SessionID || previous.ClientEmail != next.ClientEmail ||
		previous.KeyEpoch != next.KeyEpoch {
		return errors.New("evidence identity changed within chain")
	}
	if next.ObservedAt < previous.ObservedAt {
		return errors.New("evidence observation time moved backwards")
	}
	if previous.EvidenceSeq == ^uint64(0) || next.EvidenceSeq != previous.EvidenceSeq+1 {
		return errors.New("evidence sequence is not contiguous")
	}
	previousDigest, err := previous.Digest()
	if err != nil {
		return err
	}
	if next.PreviousEvidenceHash != previousDigest {
		return errors.New("previous evidence hash mismatch")
	}
	if bytes.Equal(previous.Nonce, next.Nonce) {
		return ErrEvidenceNonceReplay
	}
	if next.CounterEpoch != previous.CounterEpoch && next.CounterEpoch != previous.CounterEpoch+1 {
		return errors.New("counter epoch must be unchanged or increment by one")
	}
	if next.CounterEpoch == previous.CounterEpoch {
		if next.CumUpBytes < previous.CumUpBytes || next.CumDownBytes < previous.CumDownBytes {
			return ErrEvidenceCounterReset
		}
	} else if next.BootID == previous.BootID {
		return errors.New("counter epoch change requires a new boot ID")
	}
	return nil
}

// VerifyEvidenceChain verifies a complete history and rejects duplicate nonces,
// gaps, equivocation-shaped sequence reuse and unannounced counter resets.
func VerifyEvidenceChain(public ed25519.PublicKey, evidence []NodeEvidence) error {
	if len(evidence) == 0 {
		return errors.New("empty evidence chain")
	}
	nonces := make(map[string]struct{}, len(evidence))
	sequences := make(map[uint64]Digest, len(evidence))
	for i, current := range evidence {
		if err := VerifyNodeEvidence(public, current); err != nil {
			return fmt.Errorf("evidence %d: %w", i, err)
		}
		digest, err := current.Digest()
		if err != nil {
			return err
		}
		if previousDigest, ok := sequences[current.EvidenceSeq]; ok && previousDigest != digest {
			return ErrEvidenceEquivocation
		}
		sequences[current.EvidenceSeq] = digest
		nonce := string(current.Nonce)
		if _, ok := nonces[nonce]; ok {
			return ErrEvidenceNonceReplay
		}
		nonces[nonce] = struct{}{}
		if i == 0 {
			if current.EvidenceSeq != 1 || !current.PreviousEvidenceHash.IsZero() {
				return errors.New("first evidence must start sequence 1 with zero previous hash")
			}
			continue
		}
		if err := CheckEvidenceLink(evidence[i-1], current); err != nil {
			return fmt.Errorf("evidence %d: %w", i, err)
		}
	}
	return nil
}

// UsageReportEvidence binds a panel usage report to node evidence without
// replacing the existing panel-signed UsageReport wire type.
type UsageReportEvidence struct {
	SessionID        string   `json:"session_id"`
	ReportSeq        int64    `json:"report_seq"`
	ReportHash       Digest   `json:"report_hash"`
	FirstEvidenceSeq uint64   `json:"first_evidence_seq"`
	LastEvidenceSeq  uint64   `json:"last_evidence_seq"`
	EvidenceHashes   []Digest `json:"evidence_hashes"`
}

func (r UsageReportEvidence) Validate() error {
	if r.SessionID == "" || r.ReportSeq < 0 || r.FirstEvidenceSeq == 0 {
		return errors.New("invalid usage report evidence reference")
	}
	if err := validateDigest("report_hash", r.ReportHash); err != nil {
		return err
	}
	if r.LastEvidenceSeq < r.FirstEvidenceSeq {
		return errors.New("invalid evidence sequence range")
	}
	if uint64(len(r.EvidenceHashes)) != r.LastEvidenceSeq-r.FirstEvidenceSeq+1 {
		return errors.New("evidence hashes do not match sequence range")
	}
	for _, digest := range r.EvidenceHashes {
		if err := validateDigest("evidence hash", digest); err != nil {
			return err
		}
	}
	return nil
}

// EvidenceSetDigest is a domain-separated digest of an ordered evidence list.
func EvidenceSetDigest(hashes []Digest) (Digest, error) {
	if len(hashes) == 0 {
		return Digest{}, errors.New("empty evidence set")
	}
	payload, err := json.Marshal(hashes)
	if err != nil {
		return Digest{}, err
	}
	for _, digest := range hashes {
		if digest.IsZero() {
			return Digest{}, errors.New("zero evidence hash")
		}
	}
	return sha256.Sum256(append([]byte("sharx-network/evidence-set/v1\x00"), payload...)), nil
}
