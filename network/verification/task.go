package verification

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"math"
	"time"
)

func ValidateTask(task protocol.VerificationTask, now time.Time) error {
	return ValidateTaskWithCheckpoints(task, now, nil)
}
func ValidateTaskWithCheckpoints(task protocol.VerificationTask, now time.Time, known map[int64]protocol.Digest) error {
	if task.ID == "" || task.PolicyHash != protocol.VerificationPolicyHash || task.Report.Evidence == nil {
		return errors.New("unsupported verification task")
	}
	if task.CreatedAt > now.Unix()+30 || task.CreatedAt < now.Unix()-600 {
		return errors.New("verification task expired")
	}
	report := task.Report
	e := report.Evidence
	if report.Ts < task.CreatedAt-300 || report.Ts > task.CreatedAt+30 || e.ObservedAt < report.Ts-300 || e.ObservedAt > report.Ts+30 {
		return errors.New("report or evidence timestamp outside verification window")
	}
	if len(e.Nonce) < 16 || len(e.Nonce) > 128 {
		return errors.New("invalid evidence nonce length")
	}
	raw, err := protocol.CanonicalReportForSignature(report)
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(report.Signature)
	if err != nil || len(task.ProviderPublicKey) != ed25519.PublicKeySize || !ed25519.Verify(task.ProviderPublicKey, raw, sig) {
		return errors.New("invalid provider report signature")
	}
	if err := protocol.VerifyNodeEvidence(ed25519.PublicKey(task.NodePublicKey), *e); err != nil {
		return err
	}
	if e.SessionID != report.SessionID || e.ClientEmail != task.Link.ClientEmail || e.EvidenceSeq != uint64(report.Seq) || e.CumUpBytes != report.CumUpBytes || e.CumDownBytes != report.CumDownBytes {
		return errors.New("report does not match node evidence")
	}
	if report.UpBytes < 0 || report.DownBytes < 0 || report.CumUpBytes < report.UpBytes || report.CumDownBytes < report.DownBytes || report.CumUpBytes > math.MaxInt64-report.CumDownBytes {
		return errors.New("invalid counters")
	}
	var up, down int64
	if previous := task.PreviousEvidence; previous != nil {
		if err := protocol.VerifyNodeEvidence(task.NodePublicKey, *previous); err != nil {
			return err
		}
		if err := protocol.CheckEvidenceLink(*previous, *e); err != nil {
			return err
		}
		up = previous.CumUpBytes
		down = previous.CumDownBytes
	} else if e.EvidenceSeq != 1 || !e.PreviousEvidenceHash.IsZero() {
		return errors.New("evidence chain does not start at one")
	}
	if report.CumUpBytes-up != report.UpBytes || report.CumDownBytes-down != report.DownBytes {
		return errors.New("report delta does not match signed evidence")
	}
	checkpoint := protocol.TransparencyGenesis
	seq := int64(0)
	if len(task.Log) > 0 {
		seq = task.Log[0].Seq - 1
		if seq > 0 {
			var ok bool
			checkpoint, ok = known[seq]
			if !ok {
				return errors.New("unknown checkpoint anchor")
			}
		}
		for _, entry := range task.Log {
			if entry.Seq != seq+1 || entry.PreviousHash != checkpoint || entry.EntryHash != TransparencyHash(checkpoint, entry.Payload) {
				return fmt.Errorf("invalid transparency chain at %d", entry.Seq)
			}
			checkpoint = entry.EntryHash
			seq = entry.Seq
		}
	}
	if len(task.Log) == 0 && task.CheckpointSeq > 0 {
		var ok bool
		checkpoint, ok = known[task.CheckpointSeq]
		if !ok {
			return errors.New("unknown transparency checkpoint")
		}
		seq = task.CheckpointSeq
	}
	if checkpoint != task.CheckpointHash || seq != task.CheckpointSeq {
		return errors.New("unrecognised transparency checkpoint")
	}

	return nil
}
func TransparencyHash(previous protocol.Digest, payload []byte) protocol.Digest {
	data := append([]byte("sharx/transparency/entry/v1\x00"), previous[:]...)
	data = append(data, payload...)
	return protocol.DigestFromBytes(data)
}
func Observation(task protocol.VerificationTask, id, operator, status string) protocol.VerifierObservation {
	raw, _ := protocol.CanonicalReportForSignature(task.Report)
	evidenceDigest := protocol.DigestFromBytes([]byte("missing"))
	if task.Report.Evidence != nil {
		evidenceDigest, _ = task.Report.Evidence.Digest()
	}
	o := protocol.VerifierObservation{Version: protocol.VerifierObservationVersion, TaskID: task.ID, SessionID: task.Report.SessionID, ReportHash: protocol.DigestFromBytes(raw), EvidenceDigest: evidenceDigest, Status: status, PolicyHash: task.PolicyHash, CheckpointHash: task.CheckpointHash, VerifierID: id, OperatorID: operator}
	o.TaskDigest, _ = protocol.VerificationTaskDigest(task)
	if status == protocol.ObservationPass {
		o.ApprovedUpBytes = task.Report.UpBytes
		o.ApprovedDownBytes = task.Report.DownBytes
	}
	return o
}
