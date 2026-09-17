package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestGeofileAssetsToPrune_keepsNewestNInactiveRevisions(t *testing.T) {
	// Newest-first order, as PruneGeofileAssetRevisions queries it.
	rows := []model.GeofileAsset{
		{Id: 5, CreatedAt: 500},
		{Id: 4, CreatedAt: 400},
		{Id: 3, CreatedAt: 300},
		{Id: 2, CreatedAt: 200},
		{Id: 1, CreatedAt: 100},
	}
	toDelete := geofileAssetsToPrune(rows, 2)
	if len(toDelete) != 3 {
		t.Fatalf("expected 3 rows pruned (keep=2 of 5), got %d: %+v", len(toDelete), toDelete)
	}
	ids := map[int]bool{}
	for _, r := range toDelete {
		ids[r.Id] = true
	}
	for _, wantDeleted := range []int{1, 2, 3} {
		if !ids[wantDeleted] {
			t.Errorf("expected row id=%d (oldest) to be pruned, wasn't in %+v", wantDeleted, toDelete)
		}
	}
	for _, wantKept := range []int{4, 5} {
		if ids[wantKept] {
			t.Errorf("expected row id=%d (newest) to be kept, but it was pruned", wantKept)
		}
	}
}

func TestGeofileAssetsToPrune_neverPrunesTheActiveRevision(t *testing.T) {
	// The active revision is the oldest one here — it must survive regardless of age/count.
	rows := []model.GeofileAsset{
		{Id: 3, CreatedAt: 300},
		{Id: 2, CreatedAt: 200},
		{Id: 1, CreatedAt: 100, IsActive: true},
	}
	toDelete := geofileAssetsToPrune(rows, 1)
	for _, r := range toDelete {
		if r.Id == 1 {
			t.Fatalf("active revision (id=1) must never be pruned, but it was: %+v", toDelete)
		}
	}
	// keep=1 among the 2 inactive rows (id 2,3) -> the older inactive one (id=2) should be pruned.
	if len(toDelete) != 1 || toDelete[0].Id != 2 {
		t.Fatalf("expected only the older inactive row (id=2) pruned, got %+v", toDelete)
	}
}

func TestGeofileAssetsToPrune_underLimitPrunesNothing(t *testing.T) {
	rows := []model.GeofileAsset{
		{Id: 2, CreatedAt: 200},
		{Id: 1, CreatedAt: 100},
	}
	toDelete := geofileAssetsToPrune(rows, 5)
	if len(toDelete) != 0 {
		t.Fatalf("expected nothing pruned when under the retention limit, got %+v", toDelete)
	}
}
