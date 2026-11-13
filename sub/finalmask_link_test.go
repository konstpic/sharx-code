package sub

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func decodeFM(t *testing.T, raw string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("fm is not valid JSON: %v (%s)", err, raw)
	}
	return out
}

func udpTypesOf(fm map[string]any) []string {
	var out []string
	arr, _ := fm["udp"].([]any)
	for _, item := range arr {
		el, ok := item.(map[string]any)
		if !ok {
			continue
		}
		typ, _ := el["type"].(string)
		out = append(out, typ)
	}
	return out
}

func TestApplyFinalMaskParamsVlessTrojanSS(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
			"lengths": []any{"100-200", "150-250"},
		}}},
		"udp": []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}}},
	}}
	for _, protocol := range []model.Protocol{model.VLESS, model.Trojan, model.Shadowsocks} {
		params := map[string]string{"type": "tcp"}
		applyFinalMaskParams(stream, protocol, params)
		raw, ok := params["fm"]
		if !ok || raw == "" {
			t.Fatalf("%s: fm parameter missing", protocol)
		}
		fm := decodeFM(t, raw)
		if _, ok := fm["tcp"]; !ok {
			t.Fatalf("%s: tcp masks missing from fm: %s", protocol, raw)
		}
		if got := udpTypesOf(fm); len(got) != 1 || got[0] != "salamander" {
			t.Fatalf("%s: udp masks = %v", protocol, got)
		}
	}
}

func TestApplyFinalMaskParamsHysteria2NoFM(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{
		"udp": []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}}},
	}}
	for _, protocol := range []model.Protocol{model.Hysteria, model.Hysteria2} {
		params := map[string]string{}
		applyFinalMaskParams(stream, protocol, params)
		if _, ok := params["fm"]; ok {
			t.Fatalf("%s must not emit fm (mihomo breakage)", protocol)
		}
	}
}

func TestApplyFinalMaskObjVmessRoundTrip(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{
		"tcp": []any{map[string]any{"type": "sudoku", "settings": map[string]any{"password": "pw"}}},
	}}
	obj := map[string]any{"v": "2", "add": "example.com", "port": 443}
	applyFinalMaskObj(stream, model.VMESS, obj)

	raw, ok := obj["fm"].(string)
	if !ok || raw == "" {
		t.Fatal("vmess base object must carry fm")
	}
	fm := decodeFM(t, raw)
	if _, ok := fm["tcp"]; !ok {
		t.Fatalf("tcp mask missing: %s", raw)
	}

	// Round-trip through the vmess base64 envelope.
	jsonStr, err := json.Marshal(obj)
	if err != nil {
		t.Fatalf("marshal vmess object: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(base64.StdEncoding.EncodeToString(jsonStr))
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(decoded, &back); err != nil {
		t.Fatalf("decode vmess json: %v", err)
	}
	if back["fm"] != raw {
		t.Fatalf("fm changed in vmess round-trip: %v != %v", back["fm"], raw)
	}
}

func TestMarshalFinalMaskWhitelistDropsXDNS(t *testing.T) {
	fm := map[string]any{
		"udp": []any{
			map[string]any{"type": "xdns", "settings": map[string]any{"domains": []any{
				map[string]any{"names": []any{"example.com"}},
			}}},
			map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
		},
	}
	raw, ok := marshalFinalMask(fm)
	if !ok {
		t.Fatal("salamander must survive the whitelist")
	}
	got := udpTypesOf(decodeFM(t, raw))
	if len(got) != 1 || got[0] != "salamander" {
		t.Fatalf("xdns must be filtered out, got %v", got)
	}

	onlyXDNS := map[string]any{"udp": []any{
		map[string]any{"type": "xdns", "settings": map[string]any{"domains": []any{
			map[string]any{"names": []any{"example.com"}},
		}}},
	}}
	if _, ok := marshalFinalMask(onlyXDNS); ok {
		t.Fatal("fm must be omitted when only non-whitelisted masks remain")
	}
}

func TestMarshalFinalMaskDropsFilterByWhitelist(t *testing.T) {
	fm := map[string]any{"tcp": []any{
		map[string]any{"type": "filter", "settings": map[string]any{}},
		map[string]any{"type": "sudoku", "settings": map[string]any{"password": "pw"}},
	}}
	raw, ok := marshalFinalMask(fm)
	if !ok {
		t.Fatal("sudoku must survive")
	}
	decoded := decodeFM(t, raw)
	arr, _ := decoded["tcp"].([]any)
	if len(arr) != 1 || arr[0].(map[string]any)["type"] != "sudoku" {
		t.Fatalf("server-only filter must be dropped, got %v", arr)
	}
}

func TestMarshalFinalMaskLegacyFragmentRanges(t *testing.T) {
	fm := map[string]any{"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
		"lengths": []any{"100-200", "150-250"},
		"delays":  []any{"1-2"},
	}}}}
	raw, ok := marshalFinalMask(fm)
	if !ok {
		t.Fatal("fragment must be emitted")
	}
	el := decodeFM(t, raw)["tcp"].([]any)[0].(map[string]any)
	st := el["settings"].(map[string]any)
	if st["length"] != "150-250" {
		t.Fatalf("legacy length not materialized: %v", st)
	}
	if st["delay"] != "1-2" {
		t.Fatalf("legacy delay not materialized: %v", st)
	}
	if _, mutated := fm["tcp"].([]any)[0].(map[string]any)["settings"].(map[string]any)["length"]; mutated {
		t.Fatal("withLegacyFragmentRanges must not mutate its input")
	}
}

func TestMarshalFinalMaskUDPHopLast(t *testing.T) {
	fm := map[string]any{"udp": []any{
		map[string]any{"type": "udphop", "settings": map[string]any{
			"interval": 30, "remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"27000-27100"},
		}},
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
	}}
	raw, ok := marshalFinalMask(fm)
	if !ok {
		t.Fatal("expected fm")
	}
	got := udpTypesOf(decodeFM(t, raw))
	if len(got) != 2 || got[0] != "salamander" || got[1] != "udphop" {
		t.Fatalf("udphop must be last, got %v", got)
	}
}

func TestApplyFinalMaskParamsEmptyFinalmask(t *testing.T) {
	for _, stream := range []map[string]any{
		{},
		{"finalmask": map[string]any{}},
		{"finalmask": map[string]any{"udp": []any{}}},
	} {
		params := map[string]string{}
		applyFinalMaskParams(stream, model.VLESS, params)
		if _, ok := params["fm"]; ok {
			t.Fatalf("no fm expected for empty finalmask: %v", stream)
		}
	}
}

func TestFinalMaskLinkQueryRoundTrip(t *testing.T) {
	stream := map[string]any{"finalmask": map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
			"lengths": []any{"100-200"},
		}}},
	}}
	params := map[string]string{"type": "tcp", "security": "tls"}
	applyFinalMaskParams(stream, model.VLESS, params)

	base, err := url.Parse("vless://uuid@example.com:443")
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	q := base.Query()
	for k, v := range params {
		q.Add(k, v)
	}
	base.RawQuery = q.Encode()

	link := base.String()
	if !strings.Contains(link, "fm=") {
		t.Fatalf("fm parameter missing from link: %s", link)
	}
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	fmRaw := parsed.Query().Get("fm")
	if fmRaw == "" {
		t.Fatal("fm lost in query encoding")
	}
	fm := decodeFM(t, fmRaw)
	tcp, _ := fm["tcp"].([]any)
	if len(tcp) != 1 || tcp[0].(map[string]any)["type"] != "fragment" {
		t.Fatalf("decoded fm = %v", fm)
	}
}

func TestFinalMaskLinkHelpers(t *testing.T) {
	fm := map[string]any{"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
		"lengths": []any{"100-200"},
	}}}}
	if !hasFinalMaskContent(fm) {
		t.Fatal("expected content")
	}
	if hasFinalMaskContent(map[string]any{}) {
		t.Fatal("empty finalmask must have no content")
	}
	if out := withLegacyFragmentRanges(fm); out["tcp"].([]any)[0].(map[string]any)["settings"].(map[string]any)["length"] != "100-200" {
		t.Fatal("withLegacyFragmentRanges did not expand ranges")
	}
	if out := dropServerOnly(map[string]any{"tcp": []any{map[string]any{"type": "filter"}}}); len(out["tcp"].([]any)) != 1 {
		t.Fatal("dropServerOnly must be a no-op for the pinned kernel")
	}
	if out := normalizeUDPHop(map[string]any{"udp": []any{
		map[string]any{"type": "xicmp"},
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "x"}},
	}}); out["udp"].([]any)[1].(map[string]any)["type"] != "xicmp" {
		t.Fatal("normalizeUDPHop must move socket mask last")
	}
	qp := sanitizeQuicParams(map[string]any{"quicParams": map[string]any{
		"maxIdleTimeout": 30.0,
		"debug":          true,
	}})
	qpm := qp["quicParams"].(map[string]any)
	if qpm["maxIdleTimeout"] != int64(30) || qpm["debug"] != true {
		t.Fatalf("sanitizeQuicParams must keep integral numbers and known bools, got %v", qpm)
	}
	frac := sanitizeQuicParams(map[string]any{"quicParams": map[string]any{"maxIdleTimeout": 30.7}})
	if _, keep := frac["quicParams"]; keep {
		t.Fatal("sanitizeQuicParams must drop fractional numbers")
	}
}

func TestMarshalFinalMaskMigratesLegacyPassword(t *testing.T) {
	fm := map[string]any{"udp": []any{
		map[string]any{"type": "salamander", "password": "legacypw"},
	}}
	raw, ok := marshalFinalMask(fm)
	if !ok {
		t.Fatal("expected salamander in fm")
	}
	el := decodeFM(t, raw)["udp"].([]any)[0].(map[string]any)
	st, _ := el["settings"].(map[string]any)
	if st["password"] != "legacypw" {
		t.Fatal("fm must carry the legacy password inside settings")
	}
	if _, still := el["password"]; still {
		t.Fatal("legacy element-level password must not be emitted twice")
	}
	if _, mutated := fm["udp"].([]any)[0].(map[string]any)["settings"]; mutated {
		t.Fatal("marshalFinalMask must not mutate its input")
	}
}
