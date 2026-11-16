package finalmask

import (
	"errors"
	"strings"
	"testing"
)

func tcpFragmentFM() map[string]any {
	return map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
			"packets": "tlshello", "lengths": []any{"100-200"}, "delays": []any{"1-2"},
		}}},
	}
}

func udpSalamanderFM() map[string]any {
	return map[string]any{
		"udp": []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}}},
	}
}

// REALITY wraps the accepted TCP connection itself, so a tcp[] mask makes the
// kernel panic on the first handshake (XTLS/Xray-core#6453, reproduced on
// 26.10.31 with both matching and mismatched client configs).
func TestValidateRealityCombination(t *testing.T) {
	cases := []struct {
		name     string
		security string
		fm       map[string]any
		wantErr  bool
	}{
		{name: "reality+tcp fragment", security: "reality", fm: tcpFragmentFM(), wantErr: true},
		{name: "reality mixed case", security: " REALITY ", fm: tcpFragmentFM(), wantErr: true},
		{name: "reality+udp salamander", security: "reality", fm: udpSalamanderFM()},
		{name: "reality+quicParams only", security: "reality", fm: map[string]any{
			"quicParams": map[string]any{"maxIdleTimeout": 30},
		}},
		{name: "reality empty finalmask", security: "reality", fm: map[string]any{}},
		{name: "reality nil finalmask", security: "reality", fm: nil},
		{name: "none+tcp fragment", security: "none", fm: tcpFragmentFM()},
		{name: "tls+tcp fragment", security: "tls", fm: tcpFragmentFM()},
		{name: "empty security+tcp fragment", security: "", fm: tcpFragmentFM()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateRealityCombination(tc.security, tc.fm)
			if !tc.wantErr {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected reality_tcp_forbidden")
			}
			var re *RealityCombinationError
			if !errors.As(err, &re) {
				t.Fatalf("error must be *RealityCombinationError, got %T", err)
			}
			if re.Code != CodeRealityTCPForbidden {
				t.Fatalf("code = %q, want %q", re.Code, CodeRealityTCPForbidden)
			}
			if !strings.Contains(err.Error(), "XTLS/Xray-core#6453") {
				t.Fatalf("message must reference the kernel issue: %v", err)
			}
			if !strings.Contains(err.Error(), "fragment") {
				t.Fatalf("message must name the offending mask types: %v", err)
			}
		})
	}
}

// udp[] entries are never wrapped around the accepted TCP connection, so the
// combination stays valid even when quicParams are present as well.
func TestValidateRealityCombinationUDPWithQuicParams(t *testing.T) {
	fm := udpSalamanderFM()
	fm["quicParams"] = map[string]any{"maxIdleTimeout": 30}
	if err := ValidateRealityCombination("reality", fm); err != nil {
		t.Fatalf("udp masks + quicParams must stay allowed with REALITY: %v", err)
	}
}
