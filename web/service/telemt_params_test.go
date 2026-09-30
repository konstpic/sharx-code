package service

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"

	toml "github.com/pelletier/go-toml/v2"

	"github.com/konstpic/sharx-code/v2/database/model"
	telemtinstall "github.com/konstpic/sharx-code/v2/telemt/install"
)

func rawParams(t *testing.T, s string) map[string]json.RawMessage {
	t.Helper()
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestTelemtCatalogCoverage(t *testing.T) {
	cat := TelemtParamCatalog()
	if len(cat) < 400 {
		t.Fatalf("catalog too small: %d", len(cat))
	}
	for _, id := range []string{"general.me_pool_drain_ttl_secs", "censorship.mask_shape_hardening", "server.conntrack_control.profile", "web.timeouts.long_poll_secs", "web.vhosts.base_path", "network.multipath"} {
		if _, ok := telemtCatalogByID[id]; !ok {
			t.Errorf("catalog lacks %s", id)
		}
	}
	for i := range cat {
		if cat[i].Kind == "" {
			t.Errorf("%s has no kind (type %q)", cat[i].ID(), cat[i].Type)
		}
		if cat[i].Kind == "enum" && len(cat[i].Options) == 0 {
			t.Errorf("%s: enum without options (type %q)", cat[i].ID(), cat[i].Type)
		}
	}
}

func TestApplyTelemtExtrasNoopIsByteIdentical(t *testing.T) {
	in := "### hdr\n[general]\nuse_middle_proxy = true\n"
	out, err := ApplyTelemtExtras(in, nil, nil)
	if err != nil || out != in {
		t.Fatalf("expected passthrough, got %q %v", out, err)
	}
}

func TestApplyTelemtExtrasMerge(t *testing.T) {
	base := "### hdr\n[general]\nuse_middle_proxy = true\nlog_level = \"normal\"\n\n[server]\nport = 443\n"
	out, err := ApplyTelemtExtras(base, rawParams(t, `{
		"general.me_pool_drain_ttl_secs": 90,
		"general.me_floor_mode": "adaptive",
		"censorship.mask_shape_hardening": true,
		"network.stun_servers": ["stun.l.google.com:19302"],
		"general.use_middle_proxy": false
	}`), nil)
	if err == nil {
		t.Fatal("managed key general.use_middle_proxy must be rejected")
	}
	out, err = ApplyTelemtExtras(base, rawParams(t, `{
		"general.me_pool_drain_ttl_secs": 90,
		"general.me_floor_mode": "adaptive",
		"censorship.mask_shape_hardening": true,
		"network.stun_servers": ["stun.l.google.com:19302"],
		"dc_overrides": {"203": ["149.154.175.100:443"]}
	}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out, "### hdr\n") {
		t.Errorf("header lost: %q", out)
	}
	var tree map[string]any
	if err := toml.Unmarshal([]byte(out), &tree); err != nil {
		t.Fatalf("output is not TOML: %v\n%s", err, out)
	}
	g := tree["general"].(map[string]any)
	if g["me_pool_drain_ttl_secs"] != int64(90) || g["me_floor_mode"] != "adaptive" || g["use_middle_proxy"] != true {
		t.Errorf("general merged wrong: %v", g)
	}
	if tree["censorship"].(map[string]any)["mask_shape_hardening"] != true {
		t.Errorf("censorship: %v", tree["censorship"])
	}
	if tree["server"].(map[string]any)["port"] != int64(443) {
		t.Errorf("existing keys lost: %v", tree["server"])
	}
	if _, ok := tree["dc_overrides"].(map[string]any)["203"]; !ok {
		t.Errorf("dc_overrides: %v", tree["dc_overrides"])
	}
}

func TestApplyTelemtExtrasRejects(t *testing.T) {
	cases := map[string]string{
		"unknown":       `{"general.nope": 1}`,
		"wrong type":    `{"general.me_pool_drain_ttl_secs": "x"}`,
		"negative":      `{"general.me_pool_drain_ttl_secs": -1}`,
		"u8 overflow":   `{"general.me_adaptive_floor_min_writers_single_endpoint": 300}`,
		"bad enum":      `{"general.me_floor_mode": "sometimes"}`,
		"managed":       `{"server.listeners": []}`,
		"array section": `{"upstreams.weight": 1}`,
		"container":     `{"web.limits": {}}`,
	}
	for name, js := range cases {
		if _, err := ApplyTelemtExtras("[general]\n", rawParams(t, js), nil); err == nil {
			t.Errorf("%s: expected error for %s", name, js)
		}
	}
}

func TestApplyTelemtExtrasWebFansOutAndSkipsWhenOff(t *testing.T) {
	web := "[web]\nenabled = true\n\n[[web.vhosts]]\nhost = \"a.example.com\"\n\n[[web.vhosts.profiles]]\nuser = \"u\"\nsecret_mode = \"dd\"\n"
	p := rawParams(t, `{"web.vhosts.base_path": "telegram/web", "web.vhosts.profiles.max_sessions": 8, "web.timeouts.long_poll_secs": 30}`)
	out, err := ApplyTelemtExtras(web, p, nil)
	if err != nil {
		t.Fatal(err)
	}
	var tree map[string]any
	if err := toml.Unmarshal([]byte(out), &tree); err != nil {
		t.Fatal(err)
	}
	vh := tree["web"].(map[string]any)["vhosts"].([]any)[0].(map[string]any)
	if vh["base_path"] != "telegram/web" {
		t.Errorf("vhost: %v", vh)
	}
	if vh["profiles"].([]any)[0].(map[string]any)["max_sessions"] != int64(8) {
		t.Errorf("profile: %v", vh["profiles"])
	}
	if tree["web"].(map[string]any)["timeouts"].(map[string]any)["long_poll_secs"] != int64(30) {
		t.Errorf("timeouts: %v", tree["web"])
	}
	off, err := ApplyTelemtExtras("[general]\nlog_level = \"normal\"\n", p, nil)
	if err != nil || strings.Contains(off, "web") {
		t.Errorf("web params must be skipped when WEB is off: %q %v", off, err)
	}
}

func TestApplyTelemtUpstreams(t *testing.T) {
	ups := []map[string]json.RawMessage{
		{"type": json.RawMessage(`"socks5"`), "address": json.RawMessage(`"127.0.0.1:9050"`), "weight": json.RawMessage(`3`)},
		{"type": json.RawMessage(`"direct"`)},
	}
	out, err := ApplyTelemtExtras("[general]\n", nil, ups)
	if err != nil {
		t.Fatal(err)
	}
	var tree map[string]any
	if err := toml.Unmarshal([]byte(out), &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree["upstreams"].([]any)) != 2 {
		t.Fatalf("upstreams: %v", tree["upstreams"])
	}
	if _, err := ApplyTelemtExtras("[general]\n", nil, []map[string]json.RawMessage{{"type": json.RawMessage(`"ftp"`)}}); err == nil {
		t.Error("unsupported upstream type must fail")
	}
}

func TestBuildTelemtTomlWithParams(t *testing.T) {
	in := &model.Inbound{Id: 7, Tag: "tm", Port: 8443, Protocol: model.Telemt, Enable: true,
		Settings: `{"telemt":{"params":{"general.middle_proxy_pool_size":2,"server.listen_backlog":2048}}}`}
	out, err := BuildTelemtToml(in, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	var tree map[string]any
	if err := toml.Unmarshal([]byte(out), &tree); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if tree["server"].(map[string]any)["listen_backlog"] != int64(2048) {
		t.Errorf("server: %v", tree["server"])
	}
	if tree["server"].(map[string]any)["port"] != int64(8443) {
		t.Errorf("port lost")
	}
	if err := ValidateTelemtInbound(&model.Inbound{Enable: true, Protocol: model.Telemt, Settings: `{"telemt":{"params":{"bogus":1}}}`}); err == nil {
		t.Error("ValidateTelemtInbound must reject unknown params")
	}
}

// sampleForParam returns a value the catalog says is valid for the parameter.
func sampleForParam(p *TelemtParam) string {
	switch p.Kind {
	case "bool":
		return `true`
	case "int":
		if p.Min != nil && *p.Min > 1 {
			return strconv.FormatFloat(*p.Min, 'f', 0, 64)
		}
		return `1`
	case "float":
		return `0.5`
	case "strlist":
		return `["a"]`
	case "enum":
		o := p.Options[0]
		if o == "true" || o == "false" {
			return o
		}
		if _, err := strconv.Atoi(o); err == nil && !isTelemtStringEnum(p) {
			return o
		}
		return strconv.Quote(o)
	case "object":
		return `{"k":"v"}`
	default:
		return `"x"`
	}
}

// Every catalog key that the panel exposes must round-trip into valid TOML at the right path.
func TestApplyTelemtExtrasEveryCatalogKey(t *testing.T) {
	webBase := "[web]\nenabled = true\n\n[[web.vhosts]]\nhost = \"a.example.com\"\n\n[[web.vhosts.profiles]]\nuser = \"u\"\nsecret_mode = \"dd\"\n"
	n := 0
	for _, p := range TelemtParamCatalog() {
		p := p
		if p.Managed || p.Container || (p.Array && !strings.HasPrefix(p.Section, "web.")) {
			continue
		}
		id := p.ID()
		params := map[string]json.RawMessage{id: json.RawMessage(sampleForParam(&p))}
		out, err := ApplyTelemtExtras(webBase, params, nil)
		if err != nil {
			t.Errorf("%s (%s/%s): %v", id, p.Type, p.Kind, err)
			continue
		}
		var tree map[string]any
		if err := toml.Unmarshal([]byte(out), &tree); err != nil {
			t.Errorf("%s: output is not TOML: %v\n%s", id, err, out)
			continue
		}
		var node any = tree
		path := []string{p.Key}
		if p.Section != "" {
			path = append(strings.Split(p.Section, "."), p.Key)
		}
		for _, seg := range path {
			if arr, ok := node.([]any); ok {
				node = arr[0]
			}
			m, ok := node.(map[string]any)
			if !ok {
				t.Errorf("%s: path broken at %q in\n%s", id, seg, out)
				node = nil
				break
			}
			if node, ok = m[seg]; !ok {
				t.Errorf("%s: %q missing in\n%s", id, seg, out)
				break
			}
		}
		n++
	}
	if n < 300 {
		t.Fatalf("only %d keys exercised", n)
	}
	t.Logf("exercised %d catalog keys", n)
}

func TestCatalogIDsUniqueAndKindsSane(t *testing.T) {
	seen := map[string]string{}
	for _, p := range TelemtParamCatalog() {
		id := p.ID()
		if p.Array {
			id = "[[]]" + id
		}
		if prev, ok := seen[id]; ok {
			t.Errorf("duplicate catalog id %s (%s vs %s)", id, prev, p.Type)
		}
		seen[id] = p.Type
		if p.Kind == "int" && p.Section != "upstreams" && strings.Contains(p.Type, "или") {
			t.Errorf("%s: suspicious int type %q", id, p.Type)
		}
	}
}

func TestTelemtVersionGate(t *testing.T) {
	for _, c := range []struct {
		a, b string
		less bool
	}{
		{"3.5.7", "3.5.9", true}, {"3.5.9", "3.5.9", false}, {"3.6.0", "3.5.9", false},
		{"v3.5.8", "3.5.9", true}, {"3.5.9-rc1", "3.5.9", false}, {"", "3.5.9", false}, {"garbage", "3.5.9", false},
		{"3.10.0", "3.5.9", false},
	} {
		if got := telemtVersionLess(c.a, c.b); got != c.less {
			t.Errorf("less(%q,%q)=%v want %v", c.a, c.b, got, c.less)
		}
	}
	settings := `{"clients":[],"telemt":{"web":{"enabled":true},"params":{"web.vhosts.base_path":"x/y","web.timeouts.long_poll_secs":30}}}`
	got, dropped := stripUnsupportedTelemtParams(settings, "3.5.7")
	if len(dropped) != 1 || dropped[0] != "web.vhosts.base_path" {
		t.Fatalf("dropped=%v", dropped)
	}
	cfg := parseTelemtSettings(got)
	if _, ok := cfg.Params["web.vhosts.base_path"]; ok || len(cfg.Params) != 1 {
		t.Errorf("params after strip: %v", cfg.Params)
	}
	if same, dropped := stripUnsupportedTelemtParams(settings, "3.5.9"); same != settings || dropped != nil {
		t.Errorf("3.5.9 supports base_path; nothing may change")
	}
	if same, dropped := stripUnsupportedTelemtParams(settings, ""); same != settings || dropped != nil {
		t.Errorf("unknown node version must not strip")
	}
	only := `{"telemt":{"params":{"web.debug.sideband":true}}}`
	got, _ = stripUnsupportedTelemtParams(only, "3.5.7")
	if _, has := parseTelemtSettings(got).Params["web.debug.sideband"]; has {
		t.Errorf("sideband must be stripped: %s", got)
	}
}

// Uses the real Telemt binary when one is installed (skipped otherwise, e.g. on dev machines).
func TestValidateTelemtParamsWithBinary(t *testing.T) {
	if st, err := os.Stat(telemtinstall.ResolveBinaryPath()); err != nil || st.IsDir() {
		t.Skip("no telemt binary")
	}
	if err := validateTelemtParamsWithBinary(rawParams(t, `{"general.rpc_proxy_req_every": 5}`), nil); err == nil || !strings.Contains(err.Error(), "rpc_proxy_req_every") {
		t.Errorf("out-of-range value must be rejected by Telemt: %v", err)
	}
	if err := validateTelemtParamsWithBinary(rawParams(t, `{"general.rpc_proxy_req_every": 30, "web.timeouts.long_poll_secs": 30}`), nil); err != nil {
		t.Errorf("valid values must pass: %v", err)
	}
}
