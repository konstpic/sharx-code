package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestNormalizeClientTrafficResetCadence(t *testing.T) {
	cases := []struct {
		name      string
		cadence   string
		day       int
		wantErr   bool
		wantDay   int
		wantValue string
	}{
		{"off, day ignored", "", 15, false, 0, ""},
		{"off is default when unset", "  ", 0, false, 0, ""},
		{"daily clears day", "daily", 20, false, 0, "daily"},
		{"weekly Sunday", "WEEKLY", 0, false, 0, "weekly"},
		{"weekly Saturday", "weekly", 6, false, 6, "weekly"},
		{"weekly out of range low", "weekly", -1, true, 0, ""},
		{"weekly out of range high", "weekly", 7, true, 0, ""},
		{"monthly 1st", "monthly", 1, false, 1, "monthly"},
		{"monthly 31st", "monthly", 31, false, 31, "monthly"},
		{"monthly out of range zero", "monthly", 0, true, 0, ""},
		{"monthly out of range high", "monthly", 32, true, 0, ""},
		{"invalid cadence", "yearly", 1, true, 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &model.ClientEntity{TrafficResetCadence: tc.cadence, TrafficResetDay: tc.day}
			err := normalizeClientTrafficResetCadence(c)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got none (cadence=%q day=%d)", c.TrafficResetCadence, c.TrafficResetDay)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if c.TrafficResetCadence != tc.wantValue {
				t.Errorf("cadence = %q, want %q", c.TrafficResetCadence, tc.wantValue)
			}
			if c.TrafficResetDay != tc.wantDay {
				t.Errorf("day = %d, want %d", c.TrafficResetDay, tc.wantDay)
			}
		})
	}
}
