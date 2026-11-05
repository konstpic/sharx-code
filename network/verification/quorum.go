// Package verification evaluates independent verifier observations and issues
// quorum certificates. It does not assert that consistent counters are an
// independent measurement of user traffic.
package verification

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"fmt"
	"sort"

	"github.com/konstpic/sharx-code/v2/network/protocol"
)

const RequiredIndependentPasses = 2

type DecisionStatus string

const (
	Pending   DecisionStatus = "pending"
	Certified DecisionStatus = "certified"
	Disputed  DecisionStatus = "disputed"
)

// KeyRegistry resolves the currently recognised verifier set. Implementations
// should provide an immutable snapshot for the duration of one evaluation.
type KeyRegistry interface {
	VerifierPublicKey(verifierID string) (ed25519.PublicKey, bool)
	VerifierOperatorID(verifierID string) (string, bool)
}

type VerifierIdentity struct {
	PublicKey  ed25519.PublicKey
	OperatorID string
}
type Registry map[string]VerifierIdentity

func (r Registry) VerifierPublicKey(id string) (ed25519.PublicKey, bool) {
	v, ok := r[id]
	return v.PublicKey, ok
}
func (r Registry) VerifierOperatorID(id string) (string, bool) {
	v, ok := r[id]
	return v.OperatorID, ok
}

type Decision struct {
	Status      DecisionStatus
	Reason      string
	Certificate *protocol.VerificationCertificate
}

// Evaluate applies the 2-of-3 policy: a certificate needs two distinct
// verifier IDs at two distinct operator IDs. Any valid fail or conflicting
// pass prevents certification; unavailable observations never add a vote.
func Evaluate(observations []protocol.VerifierObservation, keys KeyRegistry) (Decision, error) {
	if keys == nil {
		return Decision{}, errors.New("verifier key registry is nil")
	}
	seen := make(map[string]protocol.Digest, len(observations))
	passes := make([]protocol.VerifierObservation, 0, len(observations))
	publicOwners := map[string]string{}
	for _, observation := range observations {
		operator, known := keys.VerifierOperatorID(observation.VerifierID)
		if !known || operator == "" || operator != observation.OperatorID {
			return Decision{}, errors.New("verifier operator does not match trusted registry")
		}
		public, ok := keys.VerifierPublicKey(observation.VerifierID)
		if !ok {
			return Decision{}, fmt.Errorf("unknown verifier %q", observation.VerifierID)
		}
		if owner, exists := publicOwners[string(public)]; exists && owner != observation.VerifierID {
			return Decision{}, errors.New("one signing key cannot count as independent verifiers")
		}
		publicOwners[string(public)] = observation.VerifierID
		if err := protocol.VerifyVerifierObservation(public, observation); err != nil {
			return Decision{}, fmt.Errorf("verifier %q: %w", observation.VerifierID, err)
		}
		digest, err := observation.Digest()
		if err != nil {
			return Decision{}, err
		}
		if previous, ok := seen[observation.VerifierID]; ok {
			if previous == digest {
				continue
			}
			return Decision{Status: Disputed, Reason: "conflicting observations from one verifier"}, nil
		}
		seen[observation.VerifierID] = digest
		switch observation.Status {
		case protocol.ObservationFail:
			return Decision{Status: Disputed, Reason: "verifier reported fail"}, nil
		case protocol.ObservationUnavailable:
			continue
		case protocol.ObservationPass:
			passes = append(passes, observation)
		}
	}
	if len(passes) == 0 {
		return Decision{Status: Pending, Reason: "no pass observations"}, nil
	}
	commonDigest, err := protocol.VerificationDigest(passes[0])
	if err != nil {
		return Decision{}, err
	}
	verifierIDs := make(map[string]struct{}, len(passes))
	operatorIDs := make(map[string]struct{}, len(passes))
	for _, observation := range passes {
		digest, err := protocol.VerificationDigest(observation)
		if err != nil {
			return Decision{}, err
		}
		if digest != commonDigest {
			return Decision{Status: Disputed, Reason: "conflicting pass digest or approved bytes"}, nil
		}
		verifierIDs[observation.VerifierID] = struct{}{}
		operatorIDs[observation.OperatorID] = struct{}{}
	}
	if len(verifierIDs) < RequiredIndependentPasses || len(operatorIDs) < RequiredIndependentPasses {
		return Decision{Status: Pending, Reason: "fewer than two independent operators passed"}, nil
	}
	sort.Slice(passes, func(i, j int) bool {
		if passes[i].VerifierID == passes[j].VerifierID {
			return passes[i].OperatorID < passes[j].OperatorID
		}
		return passes[i].VerifierID < passes[j].VerifierID
	})
	first := passes[0]
	certificate := &protocol.VerificationCertificate{
		Version: protocol.VerificationVersion, Digest: commonDigest, TaskDigest: first.TaskDigest,
		TaskID: first.TaskID, SessionID: first.SessionID,
		ReportHash: first.ReportHash, EvidenceDigest: first.EvidenceDigest,
		ApprovedUpBytes: first.ApprovedUpBytes, ApprovedDownBytes: first.ApprovedDownBytes,
		PolicyHash: first.PolicyHash, CheckpointHash: first.CheckpointHash,
		Observations: passes,
	}
	return Decision{Status: Certified, Certificate: certificate}, nil
}

// VerifyCertificate re-evaluates the certificate's embedded observations and
// rejects altered amounts, omitted quorum requirements or reordered votes.
func VerifyCertificate(certificate protocol.VerificationCertificate, keys KeyRegistry) error {
	if certificate.Version != protocol.VerificationVersion {
		return errors.New("unsupported verification certificate version")
	}
	decision, err := Evaluate(certificate.Observations, keys)
	if err != nil {
		return err
	}
	if decision.Status != Certified || decision.Certificate == nil {
		return errors.New("certificate has no independent quorum")
	}
	expected := decision.Certificate
	if certificate.TaskDigest != expected.TaskDigest || certificate.Digest != expected.Digest || certificate.TaskID != expected.TaskID ||
		certificate.SessionID != expected.SessionID || certificate.ReportHash != expected.ReportHash ||
		certificate.EvidenceDigest != expected.EvidenceDigest ||
		certificate.ApprovedUpBytes != expected.ApprovedUpBytes ||
		certificate.ApprovedDownBytes != expected.ApprovedDownBytes ||
		certificate.PolicyHash != expected.PolicyHash || certificate.CheckpointHash != expected.CheckpointHash {
		return errors.New("certificate fields do not match verification digest")
	}
	if len(certificate.Observations) != len(expected.Observations) {
		return errors.New("certificate observations are not canonical")
	}
	for i := range certificate.Observations {
		a, b := certificate.Observations[i], expected.Observations[i]
		if a.VerifierID != b.VerifierID || a.OperatorID != b.OperatorID || !bytes.Equal(a.Signature, b.Signature) {
			return errors.New("certificate observations are not sorted")
		}
	}
	return nil
}
