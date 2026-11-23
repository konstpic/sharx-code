package service

import (
	"slices"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

func TestMonthlyTrafficResetSelection(t *testing.T) {
	db := testdb.New(t)
	clients := []model.ClientEntity{
		{Name: "monthly-24", TrafficResetCadence: "monthly", TrafficResetDay: 24},
		{Name: "monthly-28", TrafficResetCadence: "monthly", TrafficResetDay: 28},
		{Name: "monthly-30", TrafficResetCadence: "monthly", TrafficResetDay: 30},
		{Name: "monthly-31", TrafficResetCadence: "monthly", TrafficResetDay: 31},
		{Name: "off-31", TrafficResetDay: 31},
	}
	if err := db.Create(&clients).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name      string
		day, last int
		want      []int
	}{
		{"ordinary day", 24, 30, []int{clients[0].Id}},
		{"February", 28, 28, []int{clients[1].Id, clients[2].Id, clients[3].Id}},
		{"November", 30, 30, []int{clients[2].Id, clients[3].Id}},
		{"full month", 31, 31, []int{clients[3].Id}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := (&ClientService{}).GetClientIDsForMonthlyTrafficReset(tc.day, tc.last)
			if err != nil {
				t.Fatal(err)
			}
			slices.Sort(got)
			slices.Sort(tc.want)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("got client IDs %v, want %v", got, tc.want)
			}
		})
	}
}
