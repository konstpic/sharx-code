package service

import (
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/xray"
)

func TestTrafficCommitBoundary(t *testing.T) {
	db := testdb.New(t)
	inbound := seedInbound(t, db, 8443, model.VLESS)
	input := []*xray.Traffic{{IsInbound: true, Tag: inbound.Tag, Up: 7, Down: 13}}
	apply := func() error { err, _ := (&InboundService{}).AddTraffic(input, nil); return err }
	check := func() {
		t.Helper()
		var row model.Inbound
		if err := db.First(&row, inbound.Id).Error; err != nil {
			t.Fatal(err)
		}
		if row.Up != 7 || row.Down != 13 || row.AllTime != 20 {
			t.Fatalf("counters %d/%d/%d", row.Up, row.Down, row.AllTime)
		}
	}
	if err := apply(); err != nil {
		t.Fatal(err)
	}
	check()
	if err := db.Exec(`CREATE FUNCTION reject_test_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejected commit'; END $$`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE CONSTRAINT TRIGGER reject_test_commit AFTER UPDATE ON inbounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_test_commit()`).Error; err != nil {
		t.Fatal(err)
	}
	err := apply()
	check()
	if err == nil || !strings.Contains(err.Error(), "fixture rejected commit") {
		t.Fatalf("expected deferred commit error, got %v", err)
	}
}
