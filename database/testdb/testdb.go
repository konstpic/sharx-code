// Package testdb gives integration tests a fresh, fully migrated PostgreSQL database.
//
// Set SHARX_TEST_DB to an admin DSN, e.g. "host=127.0.0.1 port=55432 user=pgtest password=pgtest dbname=postgres sslmode=disable".
// Without it the tests that call New are skipped, so plain `go test ./...` stays database-free.
package testdb

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

// New creates an empty database, runs every migration on it, points the global database handle at it and drops it
// at the end of the test. The test is skipped when SHARX_TEST_DB is not set.
func New(t *testing.T) *gorm.DB {
	t.Helper()
	admin := os.Getenv("SHARX_TEST_DB")
	if admin == "" {
		t.Skip("SHARX_TEST_DB is not set")
	}
	name := fmt.Sprintf("sharx_t_%d_%d", time.Now().UnixNano()%1e9, rand.Intn(1e6))
	ag, err := gorm.Open(postgres.Open(admin), &gorm.Config{})
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	if err := ag.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatalf("create database: %v", err)
	}
	dsn := strings.Replace(admin, "dbname=postgres", "dbname="+name, 1)
	if err := database.InitDB(dsn); err != nil {
		t.Fatalf("init db: %v", err)
	}
	t.Cleanup(func() {
		_ = database.CloseDB()
		_ = ag.Exec("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)").Error
		if sqlDB, err := ag.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return database.GetDB()
}
