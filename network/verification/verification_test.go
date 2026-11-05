package verification

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"path/filepath"
	"testing"
	"time"
)

func signedTask(t *testing.T) (protocol.VerificationTask, ed25519.PrivateKey) {
	t.Helper()
	nodePub, nodeKey, _ := ed25519.GenerateKey(rand.Reader)
	providerPub, providerKey, _ := ed25519.GenerateKey(rand.Reader)
	e := protocol.NodeEvidence{Version: 1, NodeID: "node", ProviderParticipantID: "provider", SessionID: "session", ClientEmail: "sn-user", EvidenceSeq: 1, BootID: "boot", ObservedAt: time.Now().Unix(), Nonce: []byte("test-nonce-with-at-least-16-bytes"), CumUpBytes: 100, CumDownBytes: 200, XrayBuild: "test", ConfigGeneration: "test"}
	if err := protocol.SignNodeEvidence(nodeKey, &e); err != nil {
		t.Fatal(err)
	}
	r := protocol.UsageReport{SessionID: "session", Seq: 1, UpBytes: 100, DownBytes: 200, CumUpBytes: 100, CumDownBytes: 200, Ts: time.Now().Unix(), Evidence: &e}
	raw, _ := protocol.CanonicalReportForSignature(r)
	r.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(providerKey, raw))
	return protocol.VerificationTask{ID: "task", Report: r, NodePublicKey: nodePub, ProviderPublicKey: providerPub, Link: protocol.SessionLink{ClientEmail: "sn-user"}, PolicyHash: protocol.VerificationPolicyHash, CheckpointHash: protocol.TransparencyGenesis, CreatedAt: time.Now().Unix()}, nodeKey
}

type probeFunc func(context.Context, protocol.SessionLink) error

func (f probeFunc) Check(ctx context.Context, link protocol.SessionLink) error { return f(ctx, link) }
func TestIndependentQuorumAndForgery(t *testing.T) {
	task, _ := signedTask(t)
	registry := Registry{}
	var observations []protocol.VerifierObservation
	for _, id := range []string{"a", "b", "c"} {
		pub, key, _ := ed25519.GenerateKey(rand.Reader)
		registry[id] = VerifierIdentity{PublicKey: pub, OperatorID: "operator-" + id}
		o := Observation(task, id, "operator-"+id, protocol.ObservationPass)
		if err := protocol.SignVerifierObservation(key, &o); err != nil {
			t.Fatal(err)
		}
		observations = append(observations, o)
	}
	one, err := Evaluate(observations[:1], registry)
	if err != nil || one.Status != Pending {
		t.Fatal("one operator certified", one, err)
	}
	two, err := Evaluate(observations[:2], registry)
	if err != nil || two.Status != Certified {
		t.Fatal("two independent operators cannot certify", two, err)
	}
	if err := VerifyCertificate(*two.Certificate, registry); err != nil {
		t.Fatal(err)
	}
	forged := append([]protocol.VerifierObservation(nil), observations[:2]...)
	forged[1].OperatorID = "operator-a"
	if _, err := Evaluate(forged, registry); err == nil {
		t.Fatal("operator forgery accepted")
	}
	altered := *two.Certificate
	altered.ApprovedDownBytes++
	if err := VerifyCertificate(altered, registry); err == nil {
		t.Fatal("altered certificate accepted")
	}
	task.Report.Evidence.CumDownBytes++
	if err := ValidateTask(task, time.Now()); err == nil {
		t.Fatal("tampered node evidence accepted")
	}
}
func TestWitnessPersistsVotesAndRejectsForks(t *testing.T) {
	task, _ := signedTask(t)
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	count := 0
	probe := probeFunc(func(context.Context, protocol.SessionLink) error { count++; return nil })
	service := &Service{ID: "a", OperatorID: "operator-a", PrivateKey: key, Probe: probe, JournalPath: filepath.Join(t.TempDir(), "journal.json")}
	first, err := service.Verify(context.Background(), task)
	if err != nil {
		t.Fatal(err)
	}
	service2 := &Service{ID: "a", OperatorID: "operator-a", PrivateKey: key, Probe: probe, JournalPath: service.JournalPath}
	second, err := service2.Verify(context.Background(), task)
	if err != nil || string(first.Signature) != string(second.Signature) || count != 1 {
		t.Fatal("retry not durable", err, count)
	}
	task.Report.DownBytes++
	if _, err := service2.Verify(context.Background(), task); err == nil {
		t.Fatal("task equivocation accepted")
	}
}

func TestOneKeyCannotMasqueradeAsIndependentOperators(t *testing.T) {
	task, _ := signedTask(t)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	registry := Registry{"a": {PublicKey: pub, OperatorID: "one"}, "b": {PublicKey: pub, OperatorID: "two"}}
	var votes []protocol.VerifierObservation
	for _, id := range []string{"a", "b"} {
		operator, _ := registry.VerifierOperatorID(id)
		vote := Observation(task, id, operator, protocol.ObservationPass)
		if err := protocol.SignVerifierObservation(key, &vote); err != nil {
			t.Fatal(err)
		}
		votes = append(votes, vote)
	}
	if _, err := Evaluate(votes, registry); err == nil {
		t.Fatal("one key supplied a two-party quorum")
	}
}
func TestWitnessCachedVoteCannotAuthorizeAlteredPathOrKeys(t *testing.T) {
	task, _ := signedTask(t)
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	service := &Service{ID: "one", OperatorID: "operator-one", PrivateKey: key, Probe: probeFunc(func(context.Context, protocol.SessionLink) error { return nil }), JournalPath: filepath.Join(t.TempDir(), "journal.json")}
	if _, err := service.Verify(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*protocol.VerificationTask){
		func(v *protocol.VerificationTask) { v.Link.EndpointHost = "changed.example" },
		func(v *protocol.VerificationTask) { v.NodePublicKey = []byte("different key") },
		func(v *protocol.VerificationTask) { v.ProviderPublicKey = []byte("different provider") },
		func(v *protocol.VerificationTask) { v.CreatedAt++ },
		func(v *protocol.VerificationTask) { v.Link.ProbeUUID = "new probe credential" },
	} {
		altered := task
		change(&altered)
		if _, err := service.Verify(context.Background(), altered); err == nil {
			t.Fatal("cached pass accepted a different task")
		}
	}
}

// A passing probe does not observe customer bytes. This counterexample is a
// deliberate guard against ever advertising audit-v2 as a proof of real volume.
func TestDirectAuditDoesNotProveThatSignedCustomerBytesActuallyFlowed(t *testing.T) {
	task, _ := signedTask(t)
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	service := &Service{ID: "one", OperatorID: "operator-one", PrivateKey: key, Probe: probeFunc(func(context.Context, protocol.SessionLink) error { return nil }), JournalPath: filepath.Join(t.TempDir(), "journal.json")}
	vote, err := service.Verify(context.Background(), task)
	if err != nil || vote.Status != protocol.ObservationPass {
		t.Fatal(err, vote.Status)
	}
	// No customer transport was run by this fixture. A signer can claim bytes;
	// reachability and signatures alone cannot establish the claim's truth.
	if vote.ApprovedDownBytes != task.Report.DownBytes {
		t.Fatal("audit policy semantics changed; review trust model")
	}
}
