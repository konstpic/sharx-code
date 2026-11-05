package protocol

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
)

// Digest is a SHA-256 digest. Its JSON representation is lowercase hexadecimal.
type Digest [sha256.Size]byte

func DigestFromBytes(b []byte) Digest {
	return sha256.Sum256(b)
}

func ParseDigest(s string) (Digest, error) {
	var d Digest
	raw, err := hex.DecodeString(s)
	if err != nil {
		return d, err
	}
	if len(raw) != sha256.Size {
		return d, fmt.Errorf("digest length %d, want %d", len(raw), sha256.Size)
	}
	copy(d[:], raw)
	return d, nil
}

func (d Digest) String() string { return hex.EncodeToString(d[:]) }

func (d Digest) IsZero() bool { return d == Digest{} }

func (d Digest) MarshalText() ([]byte, error) { return []byte(d.String()), nil }

func (d *Digest) UnmarshalText(text []byte) error {
	parsed, err := ParseDigest(string(text))
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}

func validateDigest(name string, d Digest) error {
	if d.IsZero() {
		return errors.New(name + " is required")
	}
	return nil
}
