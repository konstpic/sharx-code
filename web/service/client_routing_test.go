package service

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestNormalizeClientRouting(t *testing.T) {
	json := `{"Name":"x","GlobalProxy":"false"}`
	b64 := base64.StdEncoding.EncodeToString([]byte(json))

	cases := []struct {
		name    string
		in      string
		want    string
		wantErr bool
	}{
		{"empty clears the override", "", "", false},
		{"blank clears the override", "  \n ", "", false},
		{"raw json is compacted and prefixed", "{\n \"Name\": \"x\",\n \"GlobalProxy\": \"false\"\n}", "happ://routing/add/" + b64, false},
		{"base64 json gets the happ prefix", b64, "happ://routing/add/" + b64, false},
		{"happ deep link is kept", "happ://routing/onadd/" + b64, "happ://routing/onadd/" + b64, false},
		{"incy deep link is kept", " incy://routing/onadd/" + b64 + " ", "incy://routing/onadd/" + b64, false},
		{"subscription-style happ://add/ is fixed", "happ://add/" + b64, "happ://routing/add/" + b64, false},
		{"broken json is rejected", "{not json", "", true},
		{"base64 of non-json is rejected", base64.StdEncoding.EncodeToString([]byte("hello")), "", true},
		{"deep link with a non-json payload is rejected", "happ://routing/add/" + base64.StdEncoding.EncodeToString([]byte("hello")), "", true},
		{"deep link with garbage payload is rejected", "happ://routing/add/!!!", "", true},
		{"plain text is rejected", "route everything", "", true},
		{"scheme with spaces is rejected", "ha pp://routing/add/" + b64, "", true},
		{"too long is rejected", strings.Repeat("a", maxClientRoutingLen+1), "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeClientRouting(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
