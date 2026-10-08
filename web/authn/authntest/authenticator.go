package authntest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

// Authenticator is a software WebAuthn authenticator (an ES256 platform key) that answers registration and assertion
// requests the way a browser would pass them on, so the panel's passkey code runs against real protocol data.
type Authenticator struct {
	T          *testing.T
	Origin     string
	CredID     []byte
	UserHandle []byte
	// UV: the authenticator verified the person (PIN, fingerprint). A passkey sign-in requires it.
	UV      bool
	Counter uint32
	key     *ecdsa.PrivateKey
}

// NewAuthenticator creates an authenticator that will talk to a relying party at origin.
func NewAuthenticator(t *testing.T, origin string) *Authenticator {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := make([]byte, 32)
	rand.Read(id)
	return &Authenticator{T: t, Origin: origin, CredID: id, UV: true, key: k}
}

func unb64(s string) []byte {
	b, _ := base64.RawURLEncoding.DecodeString(s)
	return b
}

func (a *Authenticator) rpIDHash() [32]byte {
	u, _ := url.Parse(a.Origin)
	return sha256.Sum256([]byte(u.Hostname()))
}

func (a *Authenticator) flags(extra byte) byte {
	f := byte(0x01) | extra
	if a.UV {
		f |= 0x04
	}
	return f
}

type optionsEnvelope struct {
	PublicKey struct {
		Challenge string `json:"challenge"`
		User      struct {
			ID string `json:"id"`
		} `json:"user"`
	} `json:"publicKey"`
}

// Register answers a credential creation request ({"publicKey": {...}} as served by the panel).
func (a *Authenticator) Register(options json.RawMessage) []byte {
	a.T.Helper()
	var o optionsEnvelope
	if err := json.Unmarshal(options, &o); err != nil {
		a.T.Fatal(err)
	}
	a.UserHandle = unb64(o.PublicKey.User.ID)
	cd, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": o.PublicKey.Challenge, "origin": a.Origin, "crossOrigin": false})
	rp := a.rpIDHash()
	x, y := a.key.PublicKey.X.FillBytes(make([]byte, 32)), a.key.PublicKey.Y.FillBytes(make([]byte, 32))
	cose, _ := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: x, -3: y})
	auth := append([]byte{}, rp[:]...)
	auth = append(auth, a.flags(0x40))
	auth = binary.BigEndian.AppendUint32(auth, a.Counter)
	auth = append(auth, make([]byte, 16)...) // AAGUID
	auth = binary.BigEndian.AppendUint16(auth, uint16(len(a.CredID)))
	auth = append(auth, a.CredID...)
	auth = append(auth, cose...)
	att, _ := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": auth})
	out, _ := json.Marshal(map[string]any{"id": b64(a.CredID), "rawId": b64(a.CredID), "type": "public-key",
		"response": map[string]any{"clientDataJSON": b64(cd), "attestationObject": b64(att)}})
	return out
}

// Assert answers a credential request.
func (a *Authenticator) Assert(options json.RawMessage) []byte {
	a.T.Helper()
	var o optionsEnvelope
	if err := json.Unmarshal(options, &o); err != nil {
		a.T.Fatal(err)
	}
	cd, _ := json.Marshal(map[string]any{"type": "webauthn.get", "challenge": o.PublicKey.Challenge, "origin": a.Origin, "crossOrigin": false})
	rp := a.rpIDHash()
	a.Counter++
	auth := append([]byte{}, rp[:]...)
	auth = append(auth, a.flags(0))
	auth = binary.BigEndian.AppendUint32(auth, a.Counter)
	h := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, auth...), h[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		a.T.Fatal(err)
	}
	resp := map[string]any{"clientDataJSON": b64(cd), "authenticatorData": b64(auth), "signature": b64(sig)}
	if len(a.UserHandle) > 0 {
		resp["userHandle"] = b64(a.UserHandle)
	}
	out, _ := json.Marshal(map[string]any{"id": b64(a.CredID), "rawId": b64(a.CredID), "type": "public-key", "response": resp})
	return out
}
