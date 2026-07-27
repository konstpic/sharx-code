package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAWGConfValue_UnmarshalLegacyNumberAndString(t *testing.T) {
	var o AmneziaWGObfuscation
	if err := json.Unmarshal([]byte(`{"h1":12345,"h2":"10-99","h3":"777"}`), &o); err != nil {
		t.Fatal(err)
	}
	if o.H1.String() != "12345" {
		t.Fatalf("H1 = %q", o.H1)
	}
	if o.H2.String() != "10-99" {
		t.Fatalf("H2 = %q", o.H2)
	}
	if o.H3.String() != "777" {
		t.Fatalf("H3 = %q", o.H3)
	}
}

func TestAppendAmneziaWGObfuscationToConf_AWG3AndLegacy(t *testing.T) {
	var b strings.Builder
	AppendAmneziaWGObfuscationToConf(&b, AmneziaWGObfuscation{
		Jc:                     4,
		H1:                     "100-200",
		I1:                     "<b 0xdead>",
		HeaderProtectionKey:    "abcKey=",
		ContentPaddingAddition: "8-32",
		RekeyAfterTime:         "120",
		S1:                     16,
		S2:                     16,
		S3:                     16,
		S4:                     16,
	})
	got := b.String()
	for _, want := range []string{
		"Jc = 4\n",
		"H1 = 100-200\n",
		"I1 = <b 0xdead>\n",
		"HeaderProtectionKey = abcKey=\n",
		"ContentPaddingAddition = 8-32\n",
		"RekeyAfterTime = 120\n",
		"S1 = 16\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
	// Empty AWG 3 fields must not appear.
	var legacy strings.Builder
	AppendAmneziaWGObfuscationToConf(&legacy, AmneziaWGObfuscation{Jc: 4, H1: "1"})
	leg := legacy.String()
	if strings.Contains(leg, "HeaderProtectionKey") || strings.Contains(leg, "I1") {
		t.Fatalf("legacy conf must omit empty AWG3 keys: %s", leg)
	}
}

func TestEnsureAndValidateHeaderProtection(t *testing.T) {
	o := AmneziaWGObfuscation{HeaderProtectionKey: "k=", S1: 2, S2: 0, S3: 0, S4: 0}
	EnsureAmneziaWGHeaderProtectionPadding(&o)
	if o.S1 != 8 || o.S2 != 8 || o.S3 != 8 || o.S4 != 8 {
		t.Fatalf("padding not raised: %+v", o)
	}
	if err := ValidateAmneziaWGObfuscation(o); err != nil {
		t.Fatal(err)
	}
	bad := AmneziaWGObfuscation{HeaderProtectionKey: "k=", S1: 8, S2: 8, S3: 8, S4: 3}
	if err := ValidateAmneziaWGObfuscation(bad); err == nil {
		t.Fatal("expected validation error for S4 < 8")
	}
}

func TestBuildAmneziaWGInboundSettingsJSON_HeaderProtection(t *testing.T) {
	raw, err := BuildAmneziaWGInboundSettingsJSON(&AmneziaWGInboundRequest{
		MTU: 1420,
		Obfuscation: &AmneziaWGObfuscation{
			Jc:                  4,
			HeaderProtectionKey: "hdrKey=",
			S1:                  1,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var st AmneziaWGInboundSettings
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		t.Fatal(err)
	}
	if st.Obfuscation.HeaderProtectionKey != "hdrKey=" {
		t.Fatalf("key = %q", st.Obfuscation.HeaderProtectionKey)
	}
	if st.Obfuscation.S1 < 8 {
		t.Fatalf("S1 should be raised, got %d", st.Obfuscation.S1)
	}
}

func TestParseAmneziaWGInboundSettings_LegacyHInts(t *testing.T) {
	st, err := ParseAmneziaWGInboundSettings(`{"mtu":1420,"secretKey":"x","address":["10.8.0.1/24"],"obfuscation":{"jc":4,"h1":999,"h2":1000}}`)
	if err != nil {
		t.Fatal(err)
	}
	if st.Obfuscation.H1.String() != "999" || st.Obfuscation.H2.String() != "1000" {
		t.Fatalf("legacy H parse: %+v", st.Obfuscation)
	}
}
