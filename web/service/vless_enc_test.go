package service

import (
	"crypto/ecdh"
	"crypto/mlkem"
	"encoding/base64"
	"os/exec"
	"strings"
	"testing"
)

const sampleVlessEncOutput = `Choose one Authentication to use, do not mix them. Ephemeral key exchange is Post-Quantum safe anyway.

Authentication: X25519, not Post-Quantum
"decryption": "mlkem768x25519plus.native.600s.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
"encryption": "mlkem768x25519plus.native.0rtt.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

Authentication: ML-KEM-768, Post-Quantum
"decryption": "mlkem768x25519plus.native.600s.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
"encryption": "mlkem768x25519plus.native.0rtt.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
`

func TestParseVlessEncOutput(t *testing.T) {
	a := parseVlessEncOutput(sampleVlessEncOutput)
	if len(a) != 2 {
		t.Fatalf("want 2 auths, got %d", len(a))
	}
	if a[1]["label"] != "ML-KEM-768, Post-Quantum" || !strings.HasPrefix(a[1]["decryption"], "mlkem768x25519plus.native.600s.") || !strings.HasPrefix(a[1]["encryption"], "mlkem768x25519plus.native.0rtt.") {
		t.Fatalf("bad parse: %v", a[1])
	}
	for _, x := range a {
		if err := validateVlessEncString(x["decryption"], true); err != nil {
			t.Fatal(err)
		}
		if err := validateVlessEncString(x["encryption"], false); err != nil {
			t.Fatal(err)
		}
	}
	if parseVlessEncOutput("garbage") != nil {
		t.Fatal("expected nil")
	}
}

func TestValidateVlessEncString(t *testing.T) {
	key := strings.Repeat("A", 43)
	seed := strings.Repeat("B", 86)
	client := strings.Repeat("C", 1579)
	ok := []struct {
		v      string
		server bool
	}{
		{"none", true}, {"", false},
		{"mlkem768x25519plus.native.600s." + key, true},
		{"mlkem768x25519plus.xorpub.300-600s.100-111-1111.75-0-111." + key, true},
		{"mlkem768x25519plus.random.0s." + key + "." + seed, true},
		{"mlkem768x25519plus.xorpub.300-600s.100-111-1111.75-0-111.50-0-3333." + key, true},
		{"mlkem768x25519plus.native.0rtt." + client, false},
		{"mlkem768x25519plus.native.0rtt." + key, false},
		{"mlkem768x25519plus.random.1rtt.100-111-1111.75-0-111.50-0-3333." + key, false},
	}
	for _, c := range ok {
		if err := validateVlessEncString(c.v, c.server); err != nil {
			t.Errorf("%q: %v", c.v, err)
		}
	}
	bad := []struct {
		v      string
		server bool
	}{
		{"mlkem768x25519plus.native.600s", true},
		{"foo.native.600s." + key, true},
		{"mlkem768x25519plus.weird.600s." + key, true},
		{"mlkem768x25519plus.native.0rtt." + key, true},
		{"mlkem768x25519plus.native.600s." + key, false},
		{"mlkem768x25519plus.native.600s.50-111-1111." + key, true},
		{"mlkem768x25519plus.native.600s." + client, true},
		{"mlkem768x25519plus.native.600s.short", true},
	}
	for _, c := range bad {
		if err := validateVlessEncString(c.v, c.server); err == nil {
			t.Errorf("%q should fail", c.v)
		}
	}
}

func TestValidateVLESSEncryptionSettings(t *testing.T) {
	key := strings.Repeat("A", 43)
	dec := "mlkem768x25519plus.native.600s." + key
	enc := "mlkem768x25519plus.native.0rtt." + key
	if err := ValidateVLESSEncryptionSettings(`{"decryption":"none","encryption":"none"}`); err != nil {
		t.Fatal(err)
	}
	if err := ValidateVLESSEncryptionSettings(`{"decryption":"` + dec + `","encryption":"` + enc + `"}`); err != nil {
		t.Fatal(err)
	}
	if err := ValidateVLESSEncryptionSettings(`{"decryption":"` + dec + `","encryption":"none"}`); err == nil {
		t.Fatal("PQ decryption without encryption must fail")
	}
	if err := ValidateVLESSEncryptionSettings(`{"decryption":"x"}`); err == nil {
		t.Fatal("garbage decryption must fail")
	}
}

// The native fallback must produce exactly what `xray vlessenc` derives (verified against the real binary when present).
func TestGenerateVlessEncNative(t *testing.T) {
	auths, err := generateVlessEncNative()
	if err != nil || len(auths) != 2 {
		t.Fatalf("%v %d", err, len(auths))
	}
	b64 := base64.RawURLEncoding
	check := func(a map[string]string) (dec, enc string) {
		if err := validateVlessEncString(a["decryption"], true); err != nil {
			t.Fatal(err)
		}
		if err := validateVlessEncString(a["encryption"], false); err != nil {
			t.Fatal(err)
		}
		return a["decryption"][strings.LastIndex(a["decryption"], ".")+1:], a["encryption"][strings.LastIndex(a["encryption"], ".")+1:]
	}
	d, e := check(auths[0])
	raw, _ := b64.DecodeString(d)
	priv, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil || b64.EncodeToString(priv.PublicKey().Bytes()) != e {
		t.Fatal("x25519 pair mismatch")
	}
	d, e = check(auths[1])
	seed, _ := b64.DecodeString(d)
	dk, err := mlkem.NewDecapsulationKey768(seed)
	if err != nil || b64.EncodeToString(dk.EncapsulationKey().Bytes()) != e {
		t.Fatal("mlkem pair mismatch")
	}

	bin, lerr := exec.LookPath("xray")
	if lerr != nil {
		t.Skip("xray binary not available for cross-check")
	}
	out, err := exec.Command(bin, "vlessenc").Output()
	if err != nil {
		t.Skip("xray vlessenc failed")
	}
	real := parseVlessEncOutput(string(out))
	if len(real) != 2 {
		t.Fatalf("real xray returned %d auths", len(real))
	}
	d, e = check(real[1])
	seed, _ = b64.DecodeString(d)
	dk, err = mlkem.NewDecapsulationKey768(seed)
	if err != nil || b64.EncodeToString(dk.EncapsulationKey().Bytes()) != e {
		t.Fatal("native derivation differs from real xray mlkem output")
	}
	d, e = check(real[0])
	raw, _ = b64.DecodeString(d)
	priv, err = ecdh.X25519().NewPrivateKey(raw)
	if err != nil || b64.EncodeToString(priv.PublicKey().Bytes()) != e {
		t.Fatal("native derivation differs from real xray x25519 output")
	}
}
