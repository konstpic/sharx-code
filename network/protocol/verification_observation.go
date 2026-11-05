package protocol

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
)

const (
	VerifierObservationVersion = 2
	VerifierObservationDomain  = "sharx-network/verifier-observation/v2"
	VerificationVersion        = 2
	VerificationDomain         = "sharx-network/verification/v2"

	ObservationPass        = "pass"
	ObservationFail        = "fail"
	ObservationUnavailable = "unavailable"
)

// VerifierObservation attests only to the listed task, report, evidence and
// checkpoint. Unavailable is explicitly not a positive vote.
type VerifierObservation struct {
	TaskDigest        Digest `json:"task_digest"`
	Version           int    `json:"version"`
	TaskID            string `json:"task_id"`
	SessionID         string `json:"session_id"`
	ReportHash        Digest `json:"report_hash"`
	EvidenceDigest    Digest `json:"evidence_digest"`
	Status            string `json:"status"`
	ApprovedUpBytes   int64  `json:"approved_up_bytes"`
	ApprovedDownBytes int64  `json:"approved_down_bytes"`
	PolicyHash        Digest `json:"policy_hash"`
	CheckpointHash    Digest `json:"checkpoint_hash"`
	VerifierID        string `json:"verifier_id"`
	OperatorID        string `json:"operator_id"`
	Signature         []byte `json:"signature"`
}

type canonicalVerifierObservation struct {
	TaskDigest        Digest `json:"task_digest"`
	Version           int    `json:"version"`
	TaskID            string `json:"task_id"`
	SessionID         string `json:"session_id"`
	ReportHash        Digest `json:"report_hash"`
	EvidenceDigest    Digest `json:"evidence_digest"`
	Status            string `json:"status"`
	ApprovedUpBytes   int64  `json:"approved_up_bytes"`
	ApprovedDownBytes int64  `json:"approved_down_bytes"`
	PolicyHash        Digest `json:"policy_hash"`
	CheckpointHash    Digest `json:"checkpoint_hash"`
	VerifierID        string `json:"verifier_id"`
	OperatorID        string `json:"operator_id"`
}

func canonicalObservationPayload(o VerifierObservation) canonicalVerifierObservation {
	return canonicalVerifierObservation{
		TaskDigest: o.TaskDigest, Version: o.Version, TaskID: o.TaskID, SessionID: o.SessionID,
		ReportHash: o.ReportHash, EvidenceDigest: o.EvidenceDigest, Status: o.Status,
		ApprovedUpBytes: o.ApprovedUpBytes, ApprovedDownBytes: o.ApprovedDownBytes,
		PolicyHash: o.PolicyHash, CheckpointHash: o.CheckpointHash,
		VerifierID: o.VerifierID, OperatorID: o.OperatorID,
	}
}

func CanonicalVerifierObservation(o VerifierObservation) ([]byte, error) {
	payload, err := json.Marshal(canonicalObservationPayload(o))
	if err != nil {
		return nil, err
	}
	canonical := make([]byte, 0, len(VerifierObservationDomain)+1+len(payload))
	canonical = append(canonical, VerifierObservationDomain...)
	canonical = append(canonical, 0)
	canonical = append(canonical, payload...)
	return canonical, nil
}

func validateVerifierObservation(o VerifierObservation) error {
	if o.Version != VerifierObservationVersion {
		return fmt.Errorf("unsupported verifier observation version %d", o.Version)
	}
	for name, value := range map[string]string{
		"task_id": o.TaskID, "session_id": o.SessionID, "verifier_id": o.VerifierID,
		"operator_id": o.OperatorID,
	} {
		if value == "" {
			return errors.New(name + " is required")
		}
	}
	for name, digest := range map[string]Digest{
		"task_digest": o.TaskDigest, "report_hash": o.ReportHash, "evidence_digest": o.EvidenceDigest,
		"policy_hash": o.PolicyHash, "checkpoint_hash": o.CheckpointHash,
	} {
		if err := validateDigest(name, digest); err != nil {
			return err
		}
	}
	if o.Status != ObservationPass && o.Status != ObservationFail && o.Status != ObservationUnavailable {
		return errors.New("invalid verifier observation status")
	}
	if o.ApprovedUpBytes < 0 || o.ApprovedDownBytes < 0 {
		return errors.New("approved bytes must be non-negative")
	}
	if o.Status != ObservationPass && (o.ApprovedUpBytes != 0 || o.ApprovedDownBytes != 0) {
		return errors.New("non-pass observation cannot approve bytes")
	}
	return nil
}

func SignVerifierObservation(private ed25519.PrivateKey, o *VerifierObservation) error {
	if o == nil {
		return errors.New("verifier observation is nil")
	}
	if len(private) != ed25519.PrivateKeySize {
		return errors.New("invalid Ed25519 private key")
	}
	if err := validateVerifierObservation(*o); err != nil {
		return err
	}
	canonical, err := CanonicalVerifierObservation(*o)
	if err != nil {
		return err
	}
	o.Signature = ed25519.Sign(private, canonical)
	return nil
}

func VerifyVerifierObservation(public ed25519.PublicKey, o VerifierObservation) error {
	if err := validateVerifierObservation(o); err != nil {
		return err
	}
	if len(public) != ed25519.PublicKeySize {
		return errors.New("invalid Ed25519 public key")
	}
	if len(o.Signature) != ed25519.SignatureSize {
		return errors.New("invalid verifier observation signature length")
	}
	canonical, err := CanonicalVerifierObservation(o)
	if err != nil {
		return err
	}
	if !ed25519.Verify(public, canonical, o.Signature) {
		return errors.New("invalid verifier observation signature")
	}
	return nil
}

func (o VerifierObservation) Digest() (Digest, error) {
	canonical, err := CanonicalVerifierObservation(o)
	if err != nil {
		return Digest{}, err
	}
	return sha256.Sum256(canonical), nil
}

// VerificationDigest is the single digest to which all positive quorum votes
// must bind. It includes the approved amount and recognised checkpoint.
func VerificationDigest(o VerifierObservation) (Digest, error) {
	if err := validateVerifierObservation(o); err != nil {
		return Digest{}, err
	}
	common := canonicalObservationPayload(o)
	common.VerifierID = ""
	common.OperatorID = ""
	payload, err := json.Marshal(common)
	if err != nil {
		return Digest{}, err
	}
	return sha256.Sum256(append([]byte(VerificationDomain+"\x00"), payload...)), nil
}

// VerificationCertificate contains sorted pass observations. Digest binds the
// common verified values; each observation carries its own verifier signature.
type VerificationCertificate struct {
	TaskDigest        Digest                `json:"task_digest"`
	Version           int                   `json:"version"`
	Digest            Digest                `json:"digest"`
	TaskID            string                `json:"task_id"`
	SessionID         string                `json:"session_id"`
	ReportHash        Digest                `json:"report_hash"`
	EvidenceDigest    Digest                `json:"evidence_digest"`
	ApprovedUpBytes   int64                 `json:"approved_up_bytes"`
	ApprovedDownBytes int64                 `json:"approved_down_bytes"`
	PolicyHash        Digest                `json:"policy_hash"`
	CheckpointHash    Digest                `json:"checkpoint_hash"`
	Observations      []VerifierObservation `json:"observations"`
}
