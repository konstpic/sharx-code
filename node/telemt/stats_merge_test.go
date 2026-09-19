package telemt

import (
	"strings"
	"testing"
)

func TestParsePromUserOctets_telemt357TotalSuffix(t *testing.T) {
	// Real output of Telemt 3.5.7.
	const body = `# TYPE telemt_user_octets_from_client_total counter
telemt_user_octets_from_client_total{user="sosiny"} 22287
telemt_user_octets_to_client_total{user="sosiny"} 718681
telemt_user_octets_from_client_total{user="igor"} 29321
telemt_user_octets_to_client_total{user="igor"} 1181200
telemt_stats_user_entries 2
`
	got, err := parsePromUserOctets(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 users, got %d: %+v", len(got), got)
	}
	if u := got["igor"]; u.FromClient != 29321 || u.ToClient != 1181200 {
		t.Fatalf("igor = %+v", u)
	}
	if u := got["sosiny"]; u.FromClient != 22287 || u.ToClient != 718681 {
		t.Fatalf("sosiny = %+v", u)
	}
}

func TestParsePromUserOctets_legacyNamesWithoutSuffix(t *testing.T) {
	const body = `telemt_user_octets_from_client{user="a"} 5
telemt_user_octets_to_client{user="a"} 7
`
	got, err := parsePromUserOctets(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if u := got["a"]; u.FromClient != 5 || u.ToClient != 7 {
		t.Fatalf("a = %+v", u)
	}
}

func TestParsePromUserOctets_ignoresUnrelatedAndMalformedLines(t *testing.T) {
	const body = `telemt_user_octets_from_client_total_extra{user="x"} 9
telemt_user_octets_from_client_total{user=""} 9
telemt_user_octets_from_client_total{user="bad"} notanumber
telemt_user_octets_from_client_total 3
telemt_me_d2c_payload_bytes_total 12
`
	got, err := parsePromUserOctets(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected nothing parsed, got %+v", got)
	}
}
