package service

import (
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"testing"
)

func TestReorderHostsBundlesPersistenceAndScope(t *testing.T) {
	db := testdb.New(t)
	hosts := []model.Host{{UserId: 1, Name: "legacy-a", Kind: model.HostKindLegacy}, {UserId: 1, Name: "legacy-b", Kind: model.HostKindLegacy}, {UserId: 2, Name: "other-owner", Kind: model.HostKindLegacy}, {UserId: 1, Name: "bundle-host", Kind: model.HostKindAddress}}
	if err := db.Create(&hosts).Error; err != nil {
		t.Fatal(err)
	}
	if err := (&HostService{}).ReorderHosts(1, true, []int{hosts[1].Id, hosts[2].Id, hosts[1].Id, 999999}); err != nil {
		t.Fatal(err)
	}
	var saved []model.Host
	if err := db.Order("sort_order ASC,id ASC").Find(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if saved[0].Id != hosts[1].Id || saved[1].Id != hosts[0].Id {
		t.Fatal("manual order did not persist")
	}
	for _, h := range saved {
		if (h.Id == hosts[2].Id || h.Id == hosts[3].Id) && h.SortOrder != 0 {
			t.Fatal("reorder crossed scope")
		}
	}
	// Ordinary edits must not reset the separately stored manual position.
	if err := db.Model(&model.Host{}).Where("id=?", hosts[1].Id).Updates(&model.Host{Name: "renamed", SortOrder: 0}).Error; err != nil {
		t.Fatal(err)
	}
	var edited model.Host
	db.First(&edited, hosts[1].Id)
	if edited.SortOrder != -2 {
		t.Fatal("edit reset order")
	}
	if err := (&HostService{}).ReorderHosts(0, false, []int{hosts[3].Id, hosts[0].Id}); err != nil {
		t.Fatal(err)
	}
	db.First(&edited, hosts[1].Id)
	if edited.SortOrder != -2 {
		t.Fatal("bundle-host reorder affected legacy hosts")
	}
	bundles := []model.Bundle{{UserId: 1, Name: "a", Enable: true}, {UserId: 1, Name: "b", Enable: true}, {UserId: 1, Name: "auto", Enable: true, Auto: true, AutoKey: "order-auto", SortOrder: 1000}}
	if err := db.Create(&bundles).Error; err != nil {
		t.Fatal(err)
	}
	if err := (&BundleService{}).ReorderBundles([]int{bundles[2].Id, bundles[0].Id, bundles[0].Id}); err != nil {
		t.Fatal(err)
	}
	list, err := (&BundleService{}).List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 || list[0].Id != bundles[2].Id || list[1].Id != bundles[0].Id || list[2].Id != bundles[1].Id {
		t.Fatal("bundle order did not persist")
	}
	pref := SettingService{}
	if cold, err := pref.GetUIPreferenceForUser(1, "dashboardLayout"); err != nil || cold != "" {
		t.Fatalf("new account preferences: %q %v", cold, err)
	}
	if err := pref.SetUIPreferenceForUser(1, "dashboardLayout", `{"version":1,"order":["network"]}`); err != nil {
		t.Fatal(err)
	}
	one, err := pref.GetUIPreferenceForUser(1, "dashboardLayout")
	if err != nil {
		t.Fatal(err)
	}
	two, err := pref.GetUIPreferenceForUser(2, "dashboardLayout")
	if err != nil {
		t.Fatal(err)
	}
	if one == "" || two == one {
		t.Fatal("dashboard layout leaked across users")
	}
}
