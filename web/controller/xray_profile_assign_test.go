package controller

import (
	"fmt"
	"sort"
	"testing"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// Adding a node (the node wizard) binds the new node to the profile without unbinding the nodes the profile already has;
// the default call still replaces the whole list.
func TestAssignNodesAddModeKeepsExistingNodes(t *testing.T) {
	e := newHTTPEnv(t)
	db := database.GetDB()
	var admin model.User
	db.Order("id").First(&admin)
	c := e.as(admin.Id)

	p := &model.XrayCoreConfigProfile{UserId: admin.Id, Name: "p", ConfigJson: "{}"}
	if err := db.Create(p).Error; err != nil {
		t.Fatal(err)
	}
	var n [3]int
	for i := range n {
		node := &model.Node{Name: fmt.Sprint("n", i), Address: fmt.Sprint("n", i), ApiKey: fmt.Sprint("k", i)}
		if err := db.Create(node).Error; err != nil {
			t.Fatal(err)
		}
		n[i] = node.Id
	}
	assigned := func() []int {
		var ids []int
		db.Model(&model.ProfileNodeMapping{}).Where("profile_id = ?", p.Id).Pluck("node_id", &ids)
		sort.Ints(ids)
		return ids
	}
	path := fmt.Sprintf("/panel/xray-core-config-profile/assign-nodes/%d", p.Id)

	c.do("POST", path, map[string]any{"nodeIds": []int{n[0], n[1]}})
	if got := assigned(); len(got) != 2 {
		t.Fatalf("replace: %v", got)
	}
	c.do("POST", path, map[string]any{"nodeIds": []int{n[2]}, "mode": "add"})
	if got := assigned(); len(got) != 3 {
		t.Fatalf("add must keep the existing nodes, got %v", got)
	}
	c.do("POST", path, map[string]any{"nodeIds": []int{n[2]}})
	if got := assigned(); len(got) != 1 || got[0] != n[2] {
		t.Fatalf("without mode the list is replaced, got %v", got)
	}
}
