package database_test

import (
	"fmt"
	"math/rand"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// TestRBACMigrationOnAnExistingDatabase upgrades a database that has the schema of the previous release and a signed-in
// administrator, and checks that this administrator keeps full access. It needs PostgreSQL (SHARX_TEST_DB).
func TestRBACMigrationOnAnExistingDatabase(t *testing.T) {
	admin := os.Getenv("SHARX_TEST_DB")
	if admin == "" {
		t.Skip("SHARX_TEST_DB is not set")
	}
	name := fmt.Sprintf("sharx_m_%d_%d", time.Now().UnixNano()%1e9, rand.Intn(1e6))
	ag, err := gorm.Open(postgres.Open(admin), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := ag.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		sql, _ := ag.DB()
		ag.Exec("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)")
		_ = sql
	}()
	db, err := gorm.Open(postgres.Open(strings.Replace(admin, "dbname=postgres", "dbname="+name, 1)), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	m := database.NewMigrator(db)
	if err := m.EnsureMigrationsTable(); err != nil {
		t.Fatal(err)
	}
	files, err := m.LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	var rbacMig database.MigrationFile
	for _, f := range files {
		if strings.Contains(f.Name, "_rbac") {
			rbacMig = f
			continue
		}
		if f.Version < 64 {
			if err := m.ApplyMigration(f); err != nil {
				t.Fatalf("pre-RBAC migration %s: %v", f.Name, err)
			}
		}
	}
	if rbacMig.Name == "" {
		t.Fatal("RBAC migration not found")
	}
	// the previous release: a single administrator, and a second legacy account
	if err := db.Exec("INSERT INTO users (username, password) VALUES ('legacy-admin', 'hash1'), ('legacy-two', 'hash2')").Error; err != nil {
		t.Fatal(err)
	}

	if err := m.ApplyMigration(rbacMig); err != nil {
		t.Fatalf("RBAC migration: %v", err)
	}

	var rows []struct {
		Username string
		Enabled  bool
		RoleName string
		System   bool
		Perms    string
	}
	if err := db.Raw(`SELECT u.username, u.enabled, r.name AS role_name, r.is_system AS system, r.permissions AS perms
		FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("every existing user must have a role after the migration, got %d", len(rows))
	}
	for _, r := range rows {
		if !r.Enabled || r.RoleName != "Administrator" || !r.System || r.Perms != `["*"]` {
			t.Fatalf("existing user %s must keep full access: %+v", r.Username, r)
		}
	}
	// re-running (a restore, a retried deploy) changes nothing and does not fail
	if err := m.ApplyMigration(rbacMig); err != nil {
		t.Fatalf("the migration must be idempotent: %v", err)
	}
	var n int64
	db.Raw("SELECT COUNT(*) FROM roles").Scan(&n)
	if n != 1 {
		t.Fatalf("exactly one built-in role, got %d", n)
	}
	// the previous binary's statements still work against the migrated schema (rollback compatibility)
	if err := db.Exec("INSERT INTO users (username, password) VALUES ('made-by-old-binary', 'h')").Error; err != nil {
		t.Fatalf("an old binary must still be able to create users: %v", err)
	}
	if err := db.Exec("UPDATE users SET username = 'renamed', password = 'h3' WHERE username = 'legacy-two'").Error; err != nil {
		t.Fatal(err)
	}
}
