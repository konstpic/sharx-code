package sub

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/web/service"
)

func TestShareLinkOrderAndVisibility(t *testing.T) {
	db := testdb.New(t)
	settings := service.SettingService{}
	if err := settings.SetBundlesEnabled(false); err != nil {
		t.Fatal(err)
	}
	client := model.ClientEntity{UserId: 1, Name: "fixture", UUID: "647a2d92-c013-457f-a1aa-e9b95d6cbaca", Enable: true}
	if err := db.Create(&client).Error; err != nil {
		t.Fatal(err)
	}
	var ids []int
	for _, port := range []int{443, 8443} {
		row := model.Inbound{UserId: 1, Tag: fmt.Sprintf("in-%d", port), Remark: fmt.Sprintf("fixture-%d", port), Protocol: model.VLESS, Port: port, Enable: true, Settings: `{"clients":[]}`, StreamSettings: `{"network":"tcp","security":"none"}`, Sniffing: "{}"}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		ids = append(ids, row.Id)
	}
	svc := NewPanelSubService("links.example")
	order := []int{ids[1], 0, 99999, ids[0], ids[1]}
	got := svc.ClientShareLinks(&client, order)
	if len(got) != 3 {
		t.Fatalf("links: %+v", got)
	}
	for i, id := range []int{ids[1], ids[0], ids[1]} {
		port := []int{8443, 443, 8443}[i]
		want := fmt.Sprintf("vless://%s@links.example:%d?security=none&type=tcp#fixture-%d-fixture", client.UUID, port, port)
		if got[i].InboundId != id || got[i].Link != want {
			t.Fatalf("link: %+v", got[i])
		}
	}
	if got[0] != got[2] {
		t.Fatal("duplicate changed")
	}
	if err := settings.SetBundlesEnabled(true); err != nil {
		t.Fatal(err)
	}
	if links := svc.ClientShareLinks(&client, order); !reflect.DeepEqual(links, got) {
		t.Fatal("admin links without bundle hosts lost the panel-address fallback")
	}
	host := model.Host{UserId: 1, Name: "edge", Kind: model.HostKindAddress, Source: model.HostSourceManual, Address: "edge.example", Enable: true, InboundId: &ids[1]}
	if err := db.Create(&host).Error; err != nil {
		t.Fatal(err)
	}
	bundles := service.BundleService{}
	bundle, err := bundles.Create(1, &model.Bundle{Name: "fixture", Enable: true}, []service.BundleHostRef{{HostId: host.Id}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bundles.AddClients(bundle.Id, []int{client.Id}); err != nil {
		t.Fatal(err)
	}
	links := svc.ClientShareLinks(&client, order)
	if len(links) != 3 || links[0] != links[2] || links[1] != got[1] || !strings.Contains(links[0].Link, "@edge.example:8443") {
		t.Fatalf("bundle links: %+v", links)
	}
}
