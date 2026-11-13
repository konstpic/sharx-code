package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func fmStream(fm map[string]any) map[string]any {
	return map[string]any{"finalmask": fm}
}

func hasIssueCode(issues []Issue, code string) bool {
	for _, is := range issues {
		if is.Code == code {
			return true
		}
	}
	return false
}

func errorIssues(issues []Issue) []Issue {
	var out []Issue
	for _, is := range issues {
		if is.Severity == FinalmaskSeverityError {
			out = append(out, is)
		}
	}
	return out
}

func TestValidateFinalmaskTable(t *testing.T) {
	validXMC := map[string]any{
		"hostname": "mc.example.com",
		"password": "secret",
		"profiles": []any{
			map[string]any{"username": "steve_1", "uuid": "8f1e2d3c-0000-0000-0000-000000000000"},
		},
	}
	tests := []struct {
		name      string
		fm        map[string]any
		protocol  string
		wantErrIn string // expected error issue code, "" = no errors
	}{
		{
			name: "tcp header-custom packet",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "header-custom", "settings": map[string]any{"packet": map[string]any{"x": 1}}},
			}},
		},
		{
			name: "tcp fragment",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "fragment", "settings": map[string]any{
					"lengths": []any{"100-200", "150-250"}, "delays": []any{"1-2"},
				}},
			}},
		},
		{
			name: "tcp sudoku",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "sudoku", "settings": map[string]any{"password": "pw"}},
			}},
		},
		{
			name: "tcp xmc",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "xmc", "settings": validXMC},
			}},
		},
		{
			name: "tcp filter (server side)",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "filter", "settings": map[string]any{}},
			}},
		},
		{
			name: "udp salamander",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
			}},
			protocol: "hysteria2",
		},
		{
			name: "udp mkcp-legacy",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "dtls"}},
			}},
		},
		{
			name: "udp noise",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "noise", "settings": map[string]any{"noise": []any{
					map[string]any{"type": "str", "packet": "hello"},
					map[string]any{"type": "exp", "packet": "exp:1,2"},
				}}},
			}},
		},
		{
			name: "udp xdns",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "xdns", "settings": map[string]any{"domains": []any{
					map[string]any{"names": []any{"example.com"}},
				}}},
			}},
		},
		{
			name: "udp realm",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "realm", "settings": map[string]any{
					"url": "realm://example.com", "stunServers": []any{"stun.example.com:3478"},
				}},
			}},
		},
		{
			name: "udp xicmp last",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
				map[string]any{"type": "xicmp"},
			}},
			protocol: "hysteria2",
		},
		{
			name: "unknown type",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "lua", "settings": map[string]any{}},
			}},
			wantErrIn: "unknown_type",
		},
		{
			name: "type required",
			fm: map[string]any{"tcp": []any{
				map[string]any{"settings": map[string]any{}},
			}},
			wantErrIn: "type_required",
		},
		{
			name: "element shape",
			fm: map[string]any{"tcp": []any{
				"fragment",
			}},
			wantErrIn: "element_shape",
		},
		{
			name: "fragment empty settings",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "fragment", "settings": map[string]any{}},
			}},
			wantErrIn: "fragment_lengths_required",
		},
		{
			name: "fragment zero min",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"0-100"}}},
			}},
			wantErrIn: "fragment_lengths_min",
		},
		{
			name: "xmc missing hostname",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "xmc", "settings": map[string]any{"password": "x", "profiles": validXMC["profiles"]}},
			}},
			wantErrIn: "xmc_hostname_required",
		},
		{
			name: "xmc bad username",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "xmc", "settings": map[string]any{
					"hostname": "mc.example.com", "password": "x",
					"profiles": []any{map[string]any{"username": "bad name!", "uuid": "u"}},
				}},
			}},
			wantErrIn: "xmc_profile_username",
		},
		{
			name: "xmc missing profiles",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "xmc", "settings": map[string]any{"hostname": "h", "password": "p"}},
			}},
			wantErrIn: "xmc_profiles_required",
		},
		{
			name: "salamander short psk",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "salamander", "settings": map[string]any{"password": "abc"}},
			}},
			wantErrIn: "salamander_password",
		},
		{
			name: "xdns empty names",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "xdns", "settings": map[string]any{"domains": []any{
					map[string]any{"names": []any{}},
				}}},
			}},
			wantErrIn: "xdns_names_required",
		},
		{
			name: "realm bad scheme",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "realm", "settings": map[string]any{
					"url": "https://example.com", "stunServers": []any{"s:3478"},
				}},
			}},
			wantErrIn: "realm_url_scheme",
		},
		{
			name: "realm missing stun",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "realm", "settings": map[string]any{"url": "realm://example.com"}},
			}},
			wantErrIn: "realm_stun_required",
		},
		{
			name: "udphop on inbound",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "udphop", "settings": map[string]any{
					"interval": 30, "remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443"},
				}},
			}},
			wantErrIn: "udphop_client_only",
		},
		{
			name: "udphop short interval",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "udphop", "settings": map[string]any{
					"interval": 3, "remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443"},
				}},
			}},
			wantErrIn: "udphop_interval",
		},
		{
			name: "header-custom tcp no mode",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "header-custom", "settings": map[string]any{}},
			}},
			wantErrIn: "header_custom_tcp_mode",
		},
		{
			name: "header-custom tcp two modes",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "header-custom", "settings": map[string]any{
					"packet": map[string]any{"a": 1}, "rand": map[string]any{"b": 2},
				}},
			}},
			wantErrIn: "header_custom_tcp_mode",
		},
		{
			name: "header-custom udp bad mode",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "header-custom", "settings": map[string]any{"mode": "weird"}},
			}},
			wantErrIn: "header_custom_udp_mode",
		},
		{
			name: "udp header-custom standalone",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "header-custom", "settings": map[string]any{"mode": "standalone"}},
			}},
		},
		{
			name: "mkcp-legacy bad header",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "nope"}},
			}},
			wantErrIn: "mkcp_legacy_header",
		},
		{
			name: "noise bad item type",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "noise", "settings": map[string]any{"noise": []any{
					map[string]any{"type": "raw", "packet": "x"},
				}}},
			}},
			wantErrIn: "noise_item_type",
		},
		{
			name: "noise empty packet",
			fm: map[string]any{"udp": []any{
				map[string]any{"type": "noise", "settings": map[string]any{"noise": []any{
					map[string]any{"type": "str", "packet": ""},
				}}},
			}},
			wantErrIn: "noise_item_packet",
		},
		{
			name: "sudoku no password",
			fm: map[string]any{"tcp": []any{
				map[string]any{"type": "sudoku", "settings": map[string]any{}},
			}},
			wantErrIn: "sudoku_password_required",
		},
		{
			name: "quic congestion enum",
			fm: map[string]any{"quicParams": map[string]any{
				"congestion": "cubic",
			}},
			wantErrIn: "quic_congestion",
		},
		{
			name: "quic bbr profile enum",
			fm: map[string]any{"quicParams": map[string]any{
				"congestion": "bbr", "bbrProfile": "insane",
			}},
			wantErrIn: "quic_bbr_profile",
		},
		{
			name: "quic non-positive number",
			fm: map[string]any{"quicParams": map[string]any{
				"maxIdleTimeout": 0,
			}},
			wantErrIn: "quic_number_positive",
		},
		{
			name: "quic valid",
			fm: map[string]any{"quicParams": map[string]any{
				"congestion": "brutal", "bbrProfile": "aggressive", "maxIdleTimeout": 30,
			}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			protocol := tc.protocol
			if protocol == "" {
				protocol = "vless"
			}
			issues := ValidateFinalmask(fmStream(tc.fm), protocol)
			errs := errorIssues(issues)
			if tc.wantErrIn == "" {
				if len(errs) != 0 {
					t.Fatalf("unexpected errors: %v", errs)
				}
				return
			}
			if !hasIssueCode(errs, tc.wantErrIn) {
				t.Fatalf("expected error %q, got %v", tc.wantErrIn, errs)
			}
		})
	}
}

func TestValidateFinalmaskOrdering(t *testing.T) {
	socketNotLast := map[string]any{"finalmask": map[string]any{"udp": []any{
		map[string]any{"type": "xicmp"},
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
	}}}
	if !hasIssueCode(ValidateFinalmask(socketNotLast, "hysteria2"), "socket_mask_order") {
		t.Fatal("expected socket_mask_order for xicmp not last")
	}

	socketLast := map[string]any{"finalmask": map[string]any{"udp": []any{
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
		map[string]any{"type": "xicmp"},
	}}}
	if errs := errorIssues(ValidateFinalmask(socketLast, "hysteria2")); len(errs) != 0 {
		t.Fatalf("xicmp last must be valid, got %v", errs)
	}

	both := map[string]any{"finalmask": map[string]any{"udp": []any{
		map[string]any{"type": "xicmp"},
		map[string]any{"type": "udphop", "settings": map[string]any{
			"interval": 30, "remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443"},
		}},
	}}}
	if !hasIssueCode(ValidateFinalmask(both, "hysteria2"), "multiple_socket_masks") {
		t.Fatal("expected multiple_socket_masks")
	}
}

func TestValidateFinalmaskUnknownTypeDoesNotPanicOnLowercase(t *testing.T) {
	stream := fmStream(map[string]any{"tcp": []any{
		map[string]any{"type": "SUDOKU", "settings": map[string]any{"password": "pw"}},
	}})
	if errs := errorIssues(ValidateFinalmask(stream, "vless")); len(errs) != 0 {
		t.Fatalf("uppercase type must be normalized, got %v", errs)
	}
}

func TestValidateFinalmaskRootKeyWarning(t *testing.T) {
	stream := fmStream(map[string]any{
		"tcp":     []any{map[string]any{"type": "sudoku", "settings": map[string]any{"password": "pw"}}},
		"bogus":   1,
		"enabled": true,
	})
	issues := ValidateFinalmask(stream, "vless")
	if len(errorIssues(issues)) != 0 {
		t.Fatalf("root keys must only warn, got %v", issues)
	}
	warned := false
	for _, is := range issues {
		if is.Code == "unknown_root_key" && is.Severity == FinalmaskSeverityWarning {
			warned = true
		}
	}
	if !warned {
		t.Fatalf("expected unknown_root_key warning, got %v", issues)
	}
}

func TestNormalizeFinalmaskLegacyFragmentRanges(t *testing.T) {
	original := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
			"lengths": []any{"100-200", "150-250"},
			"delays":  []any{"1-2", "3-4"},
		}}},
	}
	stream := map[string]any{"network": "tcp", "finalmask": original}
	before, _ := json.Marshal(original)

	normalized := NormalizeFinalmask(stream, true)
	fm, ok := normalized["finalmask"].(map[string]any)
	if !ok {
		t.Fatal("finalmask missing after normalization")
	}
	el := fm["tcp"].([]any)[0].(map[string]any)
	st := el["settings"].(map[string]any)
	if st["length"] != "150-250" {
		t.Fatalf("length = %v, want last lengths entry", st["length"])
	}
	if st["delay"] != "3-4" {
		t.Fatalf("delay = %v, want last delays entry", st["delay"])
	}

	after, _ := json.Marshal(original)
	if string(before) != string(after) {
		t.Fatalf("input finalmask mutated:\n before=%s\n after=%s", before, after)
	}
	if _, had := stream["finalmask"].(map[string]any)["tcp"].([]any)[0].(map[string]any)["settings"].(map[string]any)["length"]; had {
		t.Fatal("input stream finalmask mutated with length")
	}
}

func TestNormalizeFinalmaskUDPHopOrdering(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{"udp": []any{
		map[string]any{"type": "udphop", "settings": map[string]any{
			"interval": 30, "remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443"},
		}},
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
	}}}
	normalized := NormalizeFinalmask(stream, false)
	udp := normalized["finalmask"].(map[string]any)["udp"].([]any)
	if len(udp) != 2 {
		t.Fatalf("want 2 udp entries, got %d", len(udp))
	}
	if udp[0].(map[string]any)["type"] != "salamander" || udp[1].(map[string]any)["type"] != "udphop" {
		t.Fatalf("udphop must be last, got %v", udp)
	}

	dup := map[string]any{"finalmask": map[string]any{"udp": []any{
		map[string]any{"type": "udphop", "settings": map[string]any{"interval": 10}},
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
		map[string]any{"type": "udphop", "settings": map[string]any{"interval": 30}},
	}}}
	normDup := NormalizeFinalmask(dup, false)
	udpDup := normDup["finalmask"].(map[string]any)["udp"].([]any)
	if len(udpDup) != 2 {
		t.Fatalf("duplicate udphop must be collapsed, got %v", udpDup)
	}
	if udpDup[1].(map[string]any)["type"] != "udphop" {
		t.Fatalf("kept udphop must be last, got %v", udpDup)
	}
}

func TestNormalizeFinalmaskDropServerOnly(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{
		"tcp": []any{
			map[string]any{"type": "filter", "settings": map[string]any{}},
			map[string]any{"type": "sudoku", "settings": map[string]any{"password": "pw"}},
		},
	}}
	clientSide := NormalizeFinalmask(stream, false)
	tcp := clientSide["finalmask"].(map[string]any)["tcp"].([]any)
	if len(tcp) != 1 || tcp[0].(map[string]any)["type"] != "sudoku" {
		t.Fatalf("filter must be dropped on client side, got %v", tcp)
	}
	serverSide := NormalizeFinalmask(stream, true)
	tcpServer := serverSide["finalmask"].(map[string]any)["tcp"].([]any)
	if len(tcpServer) != 2 {
		t.Fatalf("filter must be kept on server side, got %v", tcpServer)
	}
}

func TestNormalizeFinalmaskSanitizeQuicParams(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{"quicParams": map[string]any{
		"congestion":              "bbr",
		"maxIdleTimeout":          10.9,
		"keepAlivePeriod":         -5,
		"empty":                   "",
		"disablePathMTUDiscovery": true,
		"bogusBool":               true,
	}}}
	fm := NormalizeFinalmask(stream, true)["finalmask"].(map[string]any)
	qp := fm["quicParams"].(map[string]any)
	if qp["maxIdleTimeout"] != int64(10) {
		t.Fatalf("maxIdleTimeout = %#v, want truncated int", qp["maxIdleTimeout"])
	}
	if _, ok := qp["keepAlivePeriod"]; ok {
		t.Fatal("non-positive number must be removed")
	}
	if _, ok := qp["empty"]; ok {
		t.Fatal("empty string must be removed")
	}
	if _, ok := qp["bogusBool"]; ok {
		t.Fatal("unknown bool must be removed")
	}
	if qp["disablePathMTUDiscovery"] != true {
		t.Fatal("disablePathMTUDiscovery must be kept")
	}
	if qp["congestion"] != "bbr" {
		t.Fatal("congestion must be kept")
	}
}

func TestNormalizeFinalmaskEmptyRemovedAndTypeLowercased(t *testing.T) {
	empty := map[string]any{"network": "tcp", "finalmask": map[string]any{}}
	out := NormalizeFinalmask(empty, true)
	if _, ok := out["finalmask"]; ok {
		t.Fatal("empty finalmask must be removed")
	}

	stream := map[string]any{"finalmask": map[string]any{"udp": []any{
		map[string]any{"type": "  SALAMANDER ", "settings": map[string]any{"password": "strongpsk"}},
	}}}
	fm := NormalizeFinalmask(stream, true)["finalmask"].(map[string]any)
	if fm["udp"].([]any)[0].(map[string]any)["type"] != "salamander" {
		t.Fatalf("type must be lowercased/trimmed, got %v", fm["udp"])
	}
}

func inboundWithStream(stream string) *model.Inbound {
	return &model.Inbound{Protocol: model.VLESS, StreamSettings: stream}
}

func TestApplyFinalmaskOnSaveRejectsUnknownType(t *testing.T) {
	ib := inboundWithStream(`{"network":"tcp","finalmask":{"tcp":[{"type":"lua"}]}}`)
	err := ApplyFinalmaskOnSave(ib)
	if err == nil {
		t.Fatal("expected validation error")
	}
	if !strings.Contains(err.Error(), "unknown tcp finalmask type") {
		t.Fatalf("unexpected error: %v", err)
	}
	if ib.StreamSettings != `{"network":"tcp","finalmask":{"tcp":[{"type":"lua"}]}}` {
		t.Fatal("rejected stream settings must stay untouched")
	}
}

func TestApplyFinalmaskOnSaveNormalizes(t *testing.T) {
	ib := inboundWithStream(`{"network":"tcp","finalmask":{"tcp":[{"type":"fragment","settings":{"lengths":["100-200"]}}]}}`)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var stream map[string]any
	if err := json.Unmarshal([]byte(ib.StreamSettings), &stream); err != nil {
		t.Fatalf("normalized stream is not JSON: %v", err)
	}
	st := stream["finalmask"].(map[string]any)["tcp"].([]any)[0].(map[string]any)["settings"].(map[string]any)
	if st["length"] != "100-200" {
		t.Fatalf("legacy length not materialized: %v", st)
	}
}
