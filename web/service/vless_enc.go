package service

import (
	"crypto/ecdh"
	"crypto/mlkem"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
)

// VLESS Encryption (post-quantum) string format, see https://github.com/XTLS/Xray-core/pull/5067
//
//	decryption: mlkem768x25519plus.<native|xorpub|random>.<600s|300-600s|0s>.[padding...].<key>...
//	encryption: mlkem768x25519plus.<native|xorpub|random>.<0rtt|1rtt>.[padding...].<key>...
//
// Padding segments look like "100-111-1111" (probability-from-to); keys are base64url.

const vlessEncPrefix = "mlkem768x25519plus"

var (
	vlessEncModes     = map[string]bool{"native": true, "xorpub": true, "random": true}
	vlessEncPaddingRe = regexp.MustCompile(`^\d+-\d+-\d+$`)
	vlessEncTicketRe  = regexp.MustCompile(`^\d+(-\d+)?s$`)
)

// validateVlessEncPadding checks padding segments ("probability-from-to"): the first one needs
// probability >= 100 and from/to >= 35 (xray: "first padding length must not be smaller than 35").
func validateVlessEncPadding(segs []string) error {
	for i, sg := range segs {
		if !vlessEncPaddingRe.MatchString(sg) {
			return fmt.Errorf("invalid padding segment %q", sg)
		}
		if i == 0 {
			var p, from, to int
			if _, err := fmt.Sscanf(sg, "%d-%d-%d", &p, &from, &to); err != nil || p < 100 || from < 35 || to < 35 || from > to {
				return fmt.Errorf("first padding segment must be probability>=100 and length >= 35 (from<=to)")
			}
		}
	}
	return nil
}

// vlessEncIsNone reports whether the value means "VLESS encryption disabled".
func vlessEncIsNone(v string) bool {
	v = strings.TrimSpace(v)
	return v == "" || v == "none"
}

// validateVlessEncString validates a decryption (server=true) or encryption (server=false) string.
// "none"/empty is valid. Only structure is checked, key material is not decoded.
func validateVlessEncString(v string, server bool) error {
	v = strings.TrimSpace(v)
	if vlessEncIsNone(v) {
		return nil
	}
	parts := strings.Split(v, ".")
	if len(parts) < 4 {
		return fmt.Errorf("expected %s.<mode>.<ticket>.<key...>", vlessEncPrefix)
	}
	if parts[0] != vlessEncPrefix {
		return fmt.Errorf("unsupported prefix %q (want %s)", parts[0], vlessEncPrefix)
	}
	if !vlessEncModes[parts[1]] {
		return fmt.Errorf("unknown connection method %q (native, xorpub or random)", parts[1])
	}
	if server {
		if !vlessEncTicketRe.MatchString(parts[2]) {
			return fmt.Errorf("invalid ticket lifetime %q (e.g. 600s, 300-600s, 0s)", parts[2])
		}
	} else if parts[2] != "0rtt" && parts[2] != "1rtt" {
		return fmt.Errorf("invalid 0-RTT field %q (0rtt or 1rtt)", parts[2])
	}
	// Same rule as xray's infra/conf: segments shorter than 20 chars are padding, the rest are keys.
	i := 3
	var padding []string
	for i < len(parts) && len(parts[i]) < 20 {
		padding = append(padding, parts[i])
		i++
	}
	if err := validateVlessEncPadding(padding); err != nil {
		return err
	}
	if i >= len(parts) {
		return fmt.Errorf("missing key")
	}
	sizes := [2]int{32, 64} // X25519 private key / ML-KEM-768 seed
	if !server {
		sizes = [2]int{32, 1184} // X25519 password / ML-KEM-768 client
	}
	for ; i < len(parts); i++ {
		b, err := base64.RawURLEncoding.DecodeString(parts[i])
		if err != nil || (len(b) != sizes[0] && len(b) != sizes[1]) {
			return fmt.Errorf("invalid key segment %d", i+1)
		}
	}
	return nil
}

// ValidateVLESSEncryptionSettings checks settings.decryption / settings.encryption of a VLESS
// inbound: both must be well-formed, and a post-quantum decryption requires a client encryption
// value (otherwise subscription links would be unusable).
func ValidateVLESSEncryptionSettings(inboundSettingsJSON string) error {
	inboundSettingsJSON = strings.TrimSpace(inboundSettingsJSON)
	if inboundSettingsJSON == "" {
		return nil
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(inboundSettingsJSON), &root); err != nil || root == nil {
		return nil
	}
	dec, _ := root["decryption"].(string)
	enc, _ := root["encryption"].(string)
	if err := validateVlessEncString(dec, true); err != nil {
		return fmt.Errorf("VLESS decryption: %w", err)
	}
	if err := validateVlessEncString(enc, false); err != nil {
		return fmt.Errorf("VLESS encryption: %w", err)
	}
	if !vlessEncIsNone(dec) && vlessEncIsNone(enc) {
		return fmt.Errorf("VLESS decryption is set but client encryption is empty: subscription links need the matching encryption value")
	}
	return nil
}

func validateVLESSInboundEncryption(inbound *model.Inbound) error {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.VLESS {
		return nil
	}
	return ValidateVLESSEncryptionSettings(inbound.Settings)
}

// parseVlessEncOutput parses `xray vlessenc` stdout into [{label, decryption, encryption}].
func parseVlessEncOutput(out string) []map[string]string {
	var auths []map[string]string
	var current map[string]string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Authentication:"):
			if current != nil {
				auths = append(auths, current)
			}
			current = map[string]string{"label": strings.TrimSpace(strings.TrimPrefix(line, "Authentication:"))}
		case strings.HasPrefix(line, `"decryption"`) || strings.HasPrefix(line, `"encryption"`):
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 && current != nil {
				current[strings.Trim(parts[0], `" `)] = strings.Trim(strings.TrimSpace(parts[1]), `", `)
			}
		}
	}
	if current != nil {
		auths = append(auths, current)
	}
	return auths
}

// generateVlessEncNative builds the same pairs as `xray vlessenc` without the xray binary
// (used only when the binary is not present on the panel host).
func generateVlessEncNative() ([]map[string]string, error) {
	b64 := base64.RawURLEncoding
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	dk, err := mlkem.GenerateKey768()
	if err != nil {
		return nil, err
	}
	x25519Dec := b64.EncodeToString(priv.Bytes())
	x25519Enc := b64.EncodeToString(priv.PublicKey().Bytes())
	mlDec := b64.EncodeToString(dk.Bytes())
	mlEnc := b64.EncodeToString(dk.EncapsulationKey().Bytes())
	mk := func(label, d, e string) map[string]string {
		return map[string]string{
			"label":      label,
			"decryption": vlessEncPrefix + ".native.600s." + d,
			"encryption": vlessEncPrefix + ".native.0rtt." + e,
		}
	}
	return []map[string]string{
		mk("X25519, not Post-Quantum", x25519Dec, x25519Enc),
		mk("ML-KEM-768, Post-Quantum", mlDec, mlEnc),
	}, nil
}

func vlessEncBinaryMissing(path string) bool {
	_, err := os.Stat(path)
	return err != nil
}
