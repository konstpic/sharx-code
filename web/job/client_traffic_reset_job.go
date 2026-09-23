package job

import (
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// ClientTrafficResetJob resets individual clients' traffic on their own calendar-aligned
// schedule (daily / weekly on a chosen weekday / monthly on a chosen day of month), independent
// of the inbound-level PeriodicTrafficResetJob which resets every client on an inbound together.
// Runs once a day; each client decides for itself whether today is its reset day.
type ClientTrafficResetJob struct {
	clientService service.ClientService
}

// NewClientTrafficResetJob creates a daily job for per-client calendar traffic reset.
func NewClientTrafficResetJob() *ClientTrafficResetJob {
	return &ClientTrafficResetJob{}
}

// Run resets traffic for every client whose reset cadence matches today.
func (j *ClientTrafficResetJob) Run() {
	now := time.Now()
	weekday := int(now.Weekday()) // 0=Sunday..6=Saturday
	monthDay := now.Day()
	lastDayOfMonth := lastDayOfMonth(now)

	total := 0
	total += j.reset("daily", func() ([]int, error) {
		return j.clientService.GetClientIDsForDailyOrWeeklyTrafficReset("daily", 0)
	})
	total += j.reset("weekly", func() ([]int, error) {
		return j.clientService.GetClientIDsForDailyOrWeeklyTrafficReset("weekly", weekday)
	})
	total += j.reset("monthly", func() ([]int, error) {
		return j.clientService.GetClientIDsForMonthlyTrafficReset(monthDay, lastDayOfMonth)
	})

	if total > 0 {
		logger.Infof("Client traffic reset: %d client(s) reset (weekday=%d, day=%d, lastDayOfMonth=%d)",
			total, weekday, monthDay, lastDayOfMonth)
	}
}

// lastDayOfMonth returns how many days t's calendar month has (28-31). time.Date normalizes
// day 0 of the following month back to the last day of this one, which handles February's
// 28/29 (leap years) correctly along with every other month.
func lastDayOfMonth(t time.Time) int {
	return time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
}

func (j *ClientTrafficResetJob) reset(cadence string, lookup func() ([]int, error)) int {
	ids, err := lookup()
	if err != nil {
		logger.Warningf("Failed to get clients for traffic reset cadence %s: %v", cadence, err)
		return 0
	}
	resetCount := 0
	for _, id := range ids {
		if _, err := j.clientService.ResetClientTrafficSystem(id); err != nil {
			logger.Warningf("Failed to reset traffic for client %d (cadence=%s): %v", id, cadence, err)
			continue
		}
		resetCount++
	}
	return resetCount
}
