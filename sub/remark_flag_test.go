package sub

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestLeadingFlag(t *testing.T) {
	cases := map[string]string{
		"🇷🇺 CDN":      "🇷🇺",
		"  🇬🇧 UK-1":   "🇬🇧",
		"CDN 🇷🇺":      "",
		"":            "",
		"🇷":           "", // one regional indicator is not a flag
		"RU CDN":      "",
		"🚀 rocket":    "",
		"🇷🇺🇬🇧 two":    "🇷🇺",
		"🇰🇿Казахстан": "🇰🇿",
	}
	for in, want := range cases {
		if got := leadingFlag(in); got != want {
			t.Errorf("leadingFlag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWithInboundFlag(t *testing.T) {
	cases := []struct {
		name, remark, inbound, want string
	}{
		{"flag is added when the name has none", "Белые списки 1", "🇷🇺 CDN GET", "🇷🇺 Белые списки 1"},
		{"the name's own flag wins", "🇬🇧 Белые списки 1", "🇷🇺 CDN GET", "🇬🇧 Белые списки 1"},
		{"no flag on the inbound", "Белые списки 1", "CDN GET", "Белые списки 1"},
		{"a flag elsewhere in the inbound remark is not a name flag", "Белые списки 1", "CDN 🇷🇺", "Белые списки 1"},
		{"the flag is not repeated when the name already contains it", "user-🇷🇺 CDN", "🇷🇺 CDN", "user-🇷🇺 CDN"},
		{"empty name stays empty", "", "🇷🇺 CDN", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := withInboundFlag(tc.remark, tc.inbound); got != tc.want {
				t.Fatalf("withInboundFlag(%q, %q) = %q, want %q", tc.remark, tc.inbound, got, tc.want)
			}
		})
	}
}

// With the remark model "-o" only the host's own text makes up the name, so the inbound's flag used to be lost.
func TestGenRemarkKeepsInboundFlagWhenModelOmitsInboundRemark(t *testing.T) {
	s := &SubService{remarkModel: "-o"}
	inbound := &model.Inbound{Remark: "🇷🇺 CDN Yandex XHTTP GET (main)", Port: 443}
	tpl := &RemarkTplNode{Name: "UK-1"}

	if got, want := s.genRemark(inbound, "user", "Белые списки 1", tpl), "🇷🇺 Белые списки 1"; got != want {
		t.Fatalf("genRemark = %q, want %q", got, want)
	}
	// The default model already starts with the inbound remark: nothing is duplicated.
	s.remarkModel = "-ieo"
	if got, want := s.genRemark(inbound, "user", "Белые списки 1", tpl), "🇷🇺 CDN Yandex XHTTP GET (main)-user-Белые списки 1"; got != want {
		t.Fatalf("genRemark (-ieo) = %q, want %q", got, want)
	}
}
