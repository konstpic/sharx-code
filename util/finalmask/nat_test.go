package finalmask

import (
	"reflect"
	"testing"
)

func udphopStream(settings map[string]any) map[string]any {
	return map[string]any{
		"network": "kcp",
		"finalmask": map[string]any{
			"udp": []any{map[string]any{"type": "udphop", "settings": settings}},
		},
	}
}

func errorCodes(issues []Issue) []string {
	var out []string
	for _, is := range issues {
		if is.Severity == SeverityError {
			out = append(out, is.Code)
		}
	}
	return out
}

func TestValidateUDPHopRemoteFieldsConditional(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]any
		wantErrs []string
	}{
		{
			name:     "intervallocal without remote fields is valid",
			settings: map[string]any{"mode": "intervallocal", "interval": 30},
		},
		{
			name: "intervallocal with remote fields is valid (round-trip)",
			settings: map[string]any{
				"mode": "intervallocal", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "20000-30000",
			},
		},
		{
			name:     "intervalremote requires remoteIPs and remotePorts",
			settings: map[string]any{"mode": "intervalremote", "interval": 30},
			wantErrs: []string{"udphop_remote_ips", "udphop_remote_ports"},
		},
		{
			name:     "perconnremote requires remoteIPs and remotePorts",
			settings: map[string]any{"mode": "perconnremote", "interval": 30},
			wantErrs: []string{"udphop_remote_ips", "udphop_remote_ports"},
		},
		{
			name: "remote mode with both fields is valid",
			settings: map[string]any{
				"mode": "intervalremote", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "443,8443",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := errorCodes(Validate(udphopStream(tc.settings), "vless"))
			if len(got) != len(tc.wantErrs) {
				t.Fatalf("errors = %v, want %v", got, tc.wantErrs)
			}
			for i := range got {
				if got[i] != tc.wantErrs[i] {
					t.Fatalf("errors = %v, want %v", got, tc.wantErrs)
				}
			}
		})
	}
}

func TestUDPHopRemoteModes(t *testing.T) {
	for mode, want := range map[string]bool{
		"intervalremote":               true,
		"perconnremote":                true,
		"intervalremote,intervallocal": true,
		"intervallocal":                false,
		"":                             false,
		"bogus":                        false,
	} {
		if got := UDPHopRemoteModes(mode); got != want {
			t.Errorf("UDPHopRemoteModes(%q) = %v, want %v", mode, got, want)
		}
	}
}

func TestUDPHopNatIntentsForStream(t *testing.T) {
	cases := []struct {
		name     string
		protocol string
		stream   map[string]any
		port     int
		want     []UDPHopNatIntent
	}{
		{
			name:     "range and single ports become separate intents",
			protocol: "vless",
			port:     39612,
			stream: udphopStream(map[string]any{
				"mode": "intervalremote", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "20000-30000,443",
			}),
			want: []UDPHopNatIntent{
				{FromPortMin: 443, FromPortMax: 443, ToPort: 39612},
				{FromPortMin: 20000, FromPortMax: 30000, ToPort: 39612},
			},
		},
		{
			name:     "legacy array remotePorts",
			protocol: "vless",
			port:     5000,
			stream: udphopStream(map[string]any{
				"mode": "perconnremote", "interval": 10,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443", "9000-9010"},
			}),
			want: []UDPHopNatIntent{
				{FromPortMin: 443, FromPortMax: 443, ToPort: 5000},
				{FromPortMin: 9000, FromPortMax: 9010, ToPort: 5000},
			},
		},
		{
			name:     "intervallocal yields no intents",
			protocol: "vless",
			port:     5000,
			stream: udphopStream(map[string]any{
				"mode": "intervallocal", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "20000-30000",
			}),
			want: nil,
		},
		{
			name:     "tcp transport carries no UDP side",
			protocol: "vless",
			port:     5000,
			stream: map[string]any{
				"network": "tcp",
				"finalmask": map[string]any{
					"udp": []any{map[string]any{"type": "udphop", "settings": map[string]any{
						"mode": "intervalremote", "interval": 30,
						"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "20000-30000",
					}}},
				},
			},
			want: nil,
		},
		{
			name:     "hysteria2 keeps the UDP side",
			protocol: "hysteria2",
			port:     39614,
			stream: udphopStream(map[string]any{
				"mode": "intervalremote", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "443",
			}),
			want: []UDPHopNatIntent{{FromPortMin: 443, FromPortMax: 443, ToPort: 39614}},
		},
		{
			name:     "invalid port tokens are skipped",
			protocol: "vless",
			port:     5000,
			stream: udphopStream(map[string]any{
				"mode": "intervalremote", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "70000,abc,100-50,443",
			}),
			want: []UDPHopNatIntent{{FromPortMin: 443, FromPortMax: 443, ToPort: 5000}},
		},
		{
			name:     "bad inbound port yields nothing",
			protocol: "vless",
			port:     0,
			stream: udphopStream(map[string]any{
				"mode": "intervalremote", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": "443",
			}),
			want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := UDPHopNatIntentsForStream(tc.protocol, tc.stream, tc.port)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("intents = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSortAndDedupIntents(t *testing.T) {
	in := []UDPHopNatIntent{
		{FromPortMin: 20000, FromPortMax: 30000, ToPort: 1},
		{FromPortMin: 443, FromPortMax: 443, ToPort: 2},
		{FromPortMin: 443, FromPortMax: 443, ToPort: 2},
		{FromPortMin: 1000, FromPortMax: 2000, ToPort: 3},
	}
	want := []UDPHopNatIntent{
		{FromPortMin: 443, FromPortMax: 443, ToPort: 2},
		{FromPortMin: 1000, FromPortMax: 2000, ToPort: 3},
		{FromPortMin: 20000, FromPortMax: 30000, ToPort: 1},
	}
	if got := SortAndDedupIntents(in); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got := SortAndDedupIntents(nil); got != nil {
		t.Fatalf("nil input must stay nil, got %v", got)
	}
}

func TestUDPHopNatIntentValid(t *testing.T) {
	for _, tc := range []struct {
		intent UDPHopNatIntent
		want   bool
	}{
		{UDPHopNatIntent{443, 443, 9000}, true},
		{UDPHopNatIntent{20000, 30000, 9000}, true},
		{UDPHopNatIntent{0, 443, 9000}, false},
		{UDPHopNatIntent{443, 70000, 9000}, false},
		{UDPHopNatIntent{500, 100, 9000}, false},
		{UDPHopNatIntent{443, 443, 0}, false},
	} {
		if got := tc.intent.Valid(); got != tc.want {
			t.Errorf("%+v.Valid() = %v, want %v", tc.intent, got, tc.want)
		}
	}
}

func hy2MultiPortStream(rangeValue string) map[string]any {
	return map[string]any{
		"network":           "hysteria",
		"hysteriaMultiPort": rangeValue,
	}
}

func TestUDPHopNatIntentsForStreamHysteriaMultiPort(t *testing.T) {
	tests := []struct {
		name     string
		protocol string
		stream   map[string]any
		port     int
		want     []UDPHopNatIntent
	}{
		{
			name:     "hysteria2 range",
			protocol: "hysteria2",
			stream:   hy2MultiPortStream("39640-39649"),
			port:     443,
			want:     []UDPHopNatIntent{{FromPortMin: 39640, FromPortMax: 39649, ToPort: 443}},
		},
		{
			name:     "hysteria v2 stored under legacy protocol id",
			protocol: "hysteria",
			stream:   hy2MultiPortStream("39640-39649"),
			port:     8443,
			want:     []UDPHopNatIntent{{FromPortMin: 39640, FromPortMax: 39649, ToPort: 8443}},
		},
		{
			name:     "empty range",
			protocol: "hysteria2",
			stream:   hy2MultiPortStream(""),
			port:     443,
			want:     nil,
		},
		{
			name:     "invalid range token",
			protocol: "hysteria2",
			stream:   hy2MultiPortStream("39649-39640"),
			port:     443,
			want:     nil,
		},
		{
			name:     "non-hysteria protocol ignores the key",
			protocol: "vless",
			stream:   map[string]any{"network": "kcp", "hysteriaMultiPort": "39640-39649"},
			port:     443,
			want:     nil,
		},
		{
			name:     "invalid listener port",
			protocol: "hysteria2",
			stream:   hy2MultiPortStream("39640-39649"),
			port:     0,
			want:     nil,
		},
		{
			name:     "range plus udphop dedupes overlap",
			protocol: "hysteria2",
			stream: map[string]any{
				"network":           "hysteria",
				"hysteriaMultiPort": "39640-39649",
				"finalmask": map[string]any{"udp": []any{map[string]any{
					"type":     "udphop",
					"settings": map[string]any{"mode": "intervalremote", "remotePorts": "39640-39649,40000"},
				}}},
			},
			port: 443,
			want: []UDPHopNatIntent{
				{FromPortMin: 39640, FromPortMax: 39649, ToPort: 443},
				{FromPortMin: 40000, FromPortMax: 40000, ToPort: 443},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := UDPHopNatIntentsForStream(tt.protocol, tt.stream, tt.port)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("intents = %v, want %v", got, tt.want)
			}
		})
	}
}
