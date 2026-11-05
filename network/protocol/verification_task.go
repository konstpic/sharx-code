package protocol

import "encoding/json"

// VerificationPolicy is deliberately explicit: probes independently test the
// data path; signed counters remain a claim by the server's operator.
const VerificationPolicy = "sharx/audit-v2:pinned-contract-keys+full-task-binding+counter-continuity+independent-unbilled-inbound-probe;not-proof-of-all-user-bytes"

var VerificationPolicyHash = DigestFromBytes([]byte(VerificationPolicy))
var TransparencyGenesis = DigestFromBytes([]byte("sharx/transparency/genesis/v1"))

type TransparencyEntry struct {
	Seq          int64  `json:"seq"`
	PreviousHash Digest `json:"previous_hash"`
	EntryHash    Digest `json:"entry_hash"`
	Payload      []byte `json:"payload"`
}

type VerificationTask struct {
	CheckpointSeq     int64               `json:"checkpoint_seq"`
	ID                string              `json:"id"`
	Report            UsageReport         `json:"report"`
	PreviousEvidence  *NodeEvidence       `json:"previous_evidence,omitempty"`
	NodePublicKey     []byte              `json:"node_public_key"`
	ProviderPublicKey []byte              `json:"provider_public_key"`
	Link              SessionLink         `json:"link"`
	PolicyHash        Digest              `json:"policy_hash"`
	CheckpointHash    Digest              `json:"checkpoint_hash"`
	Log               []TransparencyEntry `json:"log"`
	CreatedAt         int64               `json:"created_at"`
}

// VerificationTaskDigest binds every security-relevant field. Log pages are
// transport for an already bound checkpoint and do not change the task identity.
func VerificationTaskDigest(task VerificationTask) (Digest, error) {
	task.Log = nil
	payload, err := json.Marshal(task)
	if err != nil {
		return Digest{}, err
	}
	return DigestFromBytes(append([]byte("sharx/verification-task/v2\x00"), payload...)), nil
}
