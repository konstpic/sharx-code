package hysteria

import "testing"

func TestParseMultiPort(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantOK  bool
		wantMin int
		wantMax int
	}{
		{"range", "39640-39649", true, 39640, 39649},
		{"surrounding spaces", "  39640 - 39649 ", true, 39640, 39649},
		{"min boundary", "1-2", true, 1, 2},
		{"max boundary", "65534-65535", true, 65534, 65535},
		{"empty", "", false, 0, 0},
		{"blank", "   ", false, 0, 0},
		{"single port", "443", false, 0, 0},
		{"list", "443,8443", false, 0, 0},
		{"zero min", "0-10", false, 0, 0},
		{"reversed", "39649-39640", false, 0, 0},
		{"equal", "443-443", false, 0, 0},
		{"port too big", "65000-70000", false, 0, 0},
		{"garbage", "abc-def", false, 0, 0},
		{"three parts", "1-2-3", false, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseMultiPort(tt.raw)
			if ok != tt.wantOK {
				t.Fatalf("ParseMultiPort(%q) ok = %v, want %v", tt.raw, ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if got.Min != tt.wantMin || got.Max != tt.wantMax {
				t.Fatalf("ParseMultiPort(%q) = %d-%d, want %d-%d", tt.raw, got.Min, got.Max, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestValidateMultiPort(t *testing.T) {
	tests := []struct {
		name         string
		raw          string
		listenerPort int
		wantPresent  bool
		wantErr      bool
		wantString   string
	}{
		{"absent", "", 443, false, false, ""},
		{"blank is absent", "  ", 443, false, false, ""},
		{"valid", "39640-39649", 443, true, false, "39640-39649"},
		{"normalized", " 39640 - 39649 ", 443, true, false, "39640-39649"},
		{"exactly 1000 ports", "1000-1999", 443, true, false, "1000-1999"},
		{"1001 ports", "1000-2000", 443, false, true, ""},
		{"contains listener", "400-500", 443, false, true, ""},
		{"touches listener at max", "400-443", 443, false, true, ""},
		{"touches listener at min", "443-500", 443, false, true, ""},
		{"below listener", "100-200", 443, true, false, "100-200"},
		{"above listener", "500-600", 443, true, false, "500-600"},
		{"bad range", "500-400", 443, false, true, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, present, err := ValidateMultiPort(tt.raw, tt.listenerPort)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidateMultiPort(%q) err = %v, wantErr %v", tt.raw, err, tt.wantErr)
			}
			if present != tt.wantPresent {
				t.Fatalf("ValidateMultiPort(%q) present = %v, want %v", tt.raw, present, tt.wantPresent)
			}
			if present && got.String() != tt.wantString {
				t.Fatalf("ValidateMultiPort(%q) = %q, want %q", tt.raw, got.String(), tt.wantString)
			}
		})
	}
}

func TestMultiPortCountAndContains(t *testing.T) {
	r := MultiPort{Min: 39640, Max: 39649}
	if got := r.Count(); got != 10 {
		t.Fatalf("Count = %d, want 10", got)
	}
	if !r.Contains(39645) || r.Contains(39639) || r.Contains(39650) {
		t.Fatal("Contains boundaries are wrong")
	}
	if (MultiPort{Min: 5, Max: 5}).Valid() {
		t.Fatal("min == max must not be valid")
	}
}

func TestMultiPortFromStream(t *testing.T) {
	tests := []struct {
		name   string
		stream map[string]any
		wantOK bool
		want   string
	}{
		{"nil stream", nil, false, ""},
		{"absent", map[string]any{"network": "hysteria"}, false, ""},
		{"valid", map[string]any{MultiPortKey: "39640-39649"}, true, "39640-39649"},
		{"wrong type", map[string]any{MultiPortKey: float64(39640)}, false, ""},
		{"empty", map[string]any{MultiPortKey: ""}, false, ""},
		{"invalid", map[string]any{MultiPortKey: "443"}, false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := MultiPortFromStream(tt.stream)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && got.String() != tt.want {
				t.Fatalf("range = %q, want %q", got.String(), tt.want)
			}
		})
	}
}

func TestIsMultiPort(t *testing.T) {
	for _, p := range []string{"hysteria", "hysteria2", "HYSTERIA2", " hysteria "} {
		if !IsMultiPort(p) {
			t.Fatalf("%q must be a multi-port protocol", p)
		}
	}
	for _, p := range []string{"vless", "trojan", "", "wireguard"} {
		if IsMultiPort(p) {
			t.Fatalf("%q must not be a multi-port protocol", p)
		}
	}
}

func TestUsableForListener(t *testing.T) {
	tests := []struct {
		name     string
		r        MultiPort
		listener int
		want     bool
	}{
		{"valid disjoint", MultiPort{Min: 39640, Max: 39649}, 443, true},
		{"contains listener", MultiPort{Min: 400, Max: 500}, 443, false},
		{"too large", MultiPort{Min: 1000, Max: 3000}, 443, false},
		{"invalid range", MultiPort{Min: 500, Max: 400}, 443, false},
		{"invalid listener still usable", MultiPort{Min: 39640, Max: 39649}, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := UsableForListener(tt.r, tt.listener); got != tt.want {
				t.Fatalf("UsableForListener(%v, %d) = %v, want %v", tt.r, tt.listener, got, tt.want)
			}
		})
	}
}

func TestMultiPortIntersects(t *testing.T) {
	a := MultiPort{Min: 39640, Max: 39649}
	for _, tc := range []struct {
		name string
		b    MultiPort
		want bool
	}{
		{"overlap", MultiPort{Min: 39645, Max: 39655}, true},
		{"touch at edge", MultiPort{Min: 39649, Max: 39660}, true},
		{"disjoint", MultiPort{Min: 39650, Max: 39660}, false},
		{"inside", MultiPort{Min: 39641, Max: 39642}, true},
		{"invalid other", MultiPort{Min: 0, Max: 5}, false},
	} {
		if got := a.Intersects(tc.b); got != tc.want {
			t.Fatalf("%s: Intersects = %v, want %v", tc.name, got, tc.want)
		}
	}
}
