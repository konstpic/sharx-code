package database

import "testing"

func TestMigrationVersionsUnique(t *testing.T) {
	migrations, err := NewMigrator(nil).LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[int64]string)
	for _, migration := range migrations {
		if prior, ok := seen[migration.Version]; ok {
			t.Fatalf("migration version %d used by %s and %s", migration.Version, prior, migration.Name)
		}
		seen[migration.Version] = migration.Name
	}
}
