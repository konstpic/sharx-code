package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

// The traffic tick loads clients, adds counters and writes back. An admin edit made in between (HWID limit, comment)
// must survive: only the traffic columns and a status this tick changed may be written.
func TestSaveClientTrafficFieldsKeepsAdminEdits(t *testing.T) {
	db := testdb.New(t)
	c := seedClient(t, db, "hw")
	if err := db.Model(&model.ClientEntity{}).Where("id = ?", c.Id).Updates(map[string]any{"hwid_enabled": true, "max_hwid": 1}).Error; err != nil {
		t.Fatal(err)
	}

	var stale model.ClientEntity
	if err := db.First(&stale, c.Id).Error; err != nil {
		t.Fatal(err)
	}
	statusBefore := map[int]string{stale.Id: stale.Status}

	// Admin saves the form while the tick is running.
	if err := db.Model(&model.ClientEntity{}).Where("id = ?", c.Id).Updates(map[string]any{"max_hwid": 0, "comment": "edited", "status": "active"}).Error; err != nil {
		t.Fatal(err)
	}

	stale.Up, stale.Down, stale.AllTime, stale.LastOnline = 10, 20, 30, 40
	if err := saveClientTrafficFields(db, []*model.ClientEntity{&stale}, statusBefore); err != nil {
		t.Fatal(err)
	}

	var got model.ClientEntity
	if err := db.First(&got, c.Id).Error; err != nil {
		t.Fatal(err)
	}
	if got.MaxHWID != 0 || got.Comment != "edited" || !got.HWIDEnabled {
		t.Fatalf("admin edit lost: maxHwid=%d comment=%q hwid=%v", got.MaxHWID, got.Comment, got.HWIDEnabled)
	}
	if got.Up != 10 || got.Down != 20 || got.AllTime != 30 || got.LastOnline != 40 {
		t.Fatalf("traffic not written: %+v", got)
	}

	// A status the tick changed is written.
	stale.Status = "expired_traffic"
	if err := saveClientTrafficFields(db, []*model.ClientEntity{&stale}, statusBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&got, c.Id).Error; err != nil || got.Status != "expired_traffic" {
		t.Fatalf("status: %q %v", got.Status, err)
	}
}
