package service

import (
	"fmt"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"gorm.io/gorm"
)

// Seeding helpers for database-backed tests (see database/testdb).

func seedInbound(t *testing.T, db *gorm.DB, port int, proto model.Protocol) *model.Inbound {
	t.Helper()
	ib := &model.Inbound{
		UserId: 1, Enable: true, Port: port, Protocol: proto, Remark: fmt.Sprintf("ib-%d", port),
		Tag: fmt.Sprintf("inbound-%d", port), Settings: "{}", StreamSettings: `{"network":"tcp","security":"none"}`, Sniffing: "{}",
	}
	if err := db.Create(ib).Error; err != nil {
		t.Fatalf("seed inbound: %v", err)
	}
	return ib
}

func seedClient(t *testing.T, db *gorm.DB, name string) *model.ClientEntity {
	t.Helper()
	c := &model.ClientEntity{UserId: 1, Name: name, UUID: "uuid-" + name, Enable: true, Status: "active", SubID: "sub-" + name}
	if err := db.Create(c).Error; err != nil {
		t.Fatalf("seed client: %v", err)
	}
	return c
}

func seedNode(t *testing.T, db *gorm.DB, name, addr string) *model.Node {
	t.Helper()
	n := &model.Node{Name: name, Address: addr, Enable: true, Status: "online"}
	if err := db.Create(n).Error; err != nil {
		t.Fatalf("seed node: %v", err)
	}
	return n
}

// seedHost creates an address host bound to one inbound.
func seedHost(t *testing.T, db *gorm.DB, name, addr string, inboundId int) *model.Host {
	t.Helper()
	id := inboundId
	h := &model.Host{UserId: 1, Name: name, Address: addr, Enable: true, Kind: model.HostKindAddress, Source: model.HostSourceManual, InboundId: &id}
	if err := db.Create(h).Error; err != nil {
		t.Fatalf("seed host: %v", err)
	}
	return h
}

func mappingRows(t *testing.T, db *gorm.DB, clientId int) []model.ClientInboundMapping {
	t.Helper()
	var rows []model.ClientInboundMapping
	if err := db.Where("client_id = ?", clientId).Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func mappingInbounds(rows []model.ClientInboundMapping) []int {
	out := make([]int, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.InboundId)
	}
	return out
}
