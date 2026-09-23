package job

import (
	"testing"
	"time"
)

func TestLastDayOfMonth(t *testing.T) {
	cases := []struct {
		name string
		date time.Time
		want int
	}{
		{"January", time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC), 31},
		{"February non-leap", time.Date(2026, time.February, 1, 0, 0, 0, 0, time.UTC), 28},
		{"February leap", time.Date(2028, time.February, 1, 0, 0, 0, 0, time.UTC), 29},
		{"April (30 days)", time.Date(2026, time.April, 30, 0, 0, 0, 0, time.UTC), 30},
		{"December", time.Date(2026, time.December, 25, 0, 0, 0, 0, time.UTC), 31},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lastDayOfMonth(tc.date); got != tc.want {
				t.Errorf("lastDayOfMonth(%s) = %d, want %d", tc.date.Format("2006-01-02"), got, tc.want)
			}
		})
	}
}

// clampMonthlyMatch mirrors the WHERE clause in ClientService.GetClientIDsForMonthlyTrafficReset
// (traffic_reset_day = monthDay OR (monthDay = lastDayOfMonth AND traffic_reset_day > monthDay))
// so the clamp-not-skip rule can be exercised without a database.
func clampMonthlyMatch(trafficResetDay, monthDay, lastDayOfMonth int) bool {
	return trafficResetDay == monthDay || (monthDay == lastDayOfMonth && trafficResetDay > monthDay)
}

func TestMonthlyResetClampsShortMonthsInsteadOfSkipping(t *testing.T) {
	cases := []struct {
		name            string
		trafficResetDay int
		monthDay        int
		lastDayOfMonth  int
		want            bool
	}{
		{"exact day match", 15, 15, 30, true},
		{"day 31 on Apr 30 (clamped)", 31, 30, 30, true},
		{"day 31 on Feb 28 (clamped, non-leap)", 31, 28, 28, true},
		{"day 31 on Feb 29 (clamped, leap)", 31, 29, 29, true},
		{"day 30 on Feb 28 (clamped)", 30, 28, 28, true},
		{"day 31 mid-April, not yet last day", 31, 15, 30, false},
		{"day 5 does not fire on day 28", 5, 28, 28, false},
		{"day equals lastDayOfMonth in a 31-day month", 31, 31, 31, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := clampMonthlyMatch(tc.trafficResetDay, tc.monthDay, tc.lastDayOfMonth)
			if got != tc.want {
				t.Errorf("clampMonthlyMatch(resetDay=%d, monthDay=%d, lastDay=%d) = %v, want %v",
					tc.trafficResetDay, tc.monthDay, tc.lastDayOfMonth, got, tc.want)
			}
		})
	}
}
