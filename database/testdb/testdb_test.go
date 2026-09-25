package testdb

import "testing"

func TestFreshDatabaseHasCoreTables(t *testing.T) {
	db := New(t)
	for _, table := range []string{"users", "client_entities", "client_inbound_mappings", "hosts", "balancers", "inbound_node_mappings"} {
		var n int64
		if err := db.Raw("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", table).Scan(&n).Error; err != nil || n != 1 {
			t.Errorf("table %s missing (n=%d err=%v)", table, n, err)
		}
	}
}

func TestBundleSchemaExists(t *testing.T) {
	db := New(t)
	for _, table := range []string{"bundles", "bundle_hosts", "client_bundles"} {
		var n int64
		if err := db.Raw("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", table).Scan(&n).Error; err != nil || n != 1 {
			t.Errorf("table %s missing", table)
		}
	}
	var n int64
	if err := db.Raw("SELECT count(*) FROM information_schema.columns WHERE table_name='hosts' AND column_name IN ('kind','inbound_id','node_id','pool_id','source','customized')").Scan(&n).Error; err != nil || n != 6 {
		t.Errorf("hosts columns: %d", n)
	}
}
