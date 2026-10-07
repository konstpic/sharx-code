// Package database provides database initialization, migration, and management utilities
// for the SharX panel using GORM with PostgreSQL.
package database

import (
	"fmt"
	"slices"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database/model"
	appLogger "github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/crypto"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

var db *gorm.DB

const (
	defaultUsername = "admin"
	defaultPassword = "admin"
	// minRequiredSchemaVersion is the minimum schema version required by this application version
	// Update this when you add new migrations that are required for the app to function
	minRequiredSchemaVersion = 1
)

// initUser creates a default admin user if the users table is empty.
func initUser() error {
	empty, err := isTableEmpty("users")
	if err != nil {
		appLogger.Warningf("DB init: error checking if users table is empty: %v", err)
		return err
	}
	if empty {
		hashedPassword, err := crypto.HashPasswordAsBcrypt(defaultPassword)

		if err != nil {
			appLogger.Warningf("DB init: error hashing default password: %v", err)
			return err
		}

		user := &model.User{
			Username: defaultUsername,
			Password: hashedPassword,
			RoleId:   AdminRoleID(),
			Enabled:  true,
		}
		return db.Create(user).Error
	}
	return nil
}

// runSeeders migrates user passwords to bcrypt and records seeder execution to prevent re-running.
func runSeeders(isUsersEmpty bool) error {
	empty, err := isTableEmpty("history_of_seeders")
	if err != nil {
		appLogger.Warningf("DB seeders: error checking if history_of_seeders is empty: %v", err)
		return err
	}

	if empty && isUsersEmpty {
		hashSeeder := &model.HistoryOfSeeders{
			SeederName: "UserPasswordHash",
		}
		return db.Create(hashSeeder).Error
	} else {
		var seedersHistory []string
		db.Model(&model.HistoryOfSeeders{}).Pluck("seeder_name", &seedersHistory)

		if !slices.Contains(seedersHistory, "UserPasswordHash") && !isUsersEmpty {
			var users []model.User
			db.Find(&users)

			for _, user := range users {
				hashedPassword, err := crypto.HashPasswordAsBcrypt(user.Password)
				if err != nil {
					appLogger.Warningf("DB seeders: error hashing password for user '%s': %v", user.Username, err)
					return err
				}
				db.Model(&user).Update("password", hashedPassword)
			}

			hashSeeder := &model.HistoryOfSeeders{
				SeederName: "UserPasswordHash",
			}
			return db.Create(hashSeeder).Error
		}
	}

	return nil
}

// isTableEmpty returns true if the named table contains zero rows.
func isTableEmpty(tableName string) (bool, error) {
	var count int64
	err := db.Table(tableName).Count(&count).Error
	return count == 0, err
}

// InitDB sets up the database connection, migrates models, and runs seeders.
// dbConnectionString should be a PostgreSQL connection string in the format:
// postgres://user:password@host:port/dbname?sslmode=mode
//
// InitDB performs the following steps in order:
// 1. Establishes database connection
// 2. Configures connection pool
// 3. Runs schema migrations
// 4. Checks schema version compatibility
// 5. Initializes default user (if needed)
// 6. Runs seeders
func InitDB(dbConnectionString string) error {
	// Step 1: Establish database connection
	var gormLog gormLogger.Interface
	if config.IsDebug() {
		gormLog = gormLogger.Default
	} else {
		gormLog = gormLogger.Discard
	}

	c := &gorm.Config{
		Logger: gormLog,
	}

	var err error
	db, err = gorm.Open(postgres.Open(dbConnectionString), c)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	// Step 2: Configure connection pool
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	// Set connection pool settings
	// These values can be overridden via environment variables if needed
	sqlDB.SetMaxOpenConns(25)                  // Maximum number of open connections
	sqlDB.SetMaxIdleConns(5)                   // Maximum number of idle connections
	sqlDB.SetConnMaxLifetime(5 * time.Minute)  // Maximum connection lifetime
	sqlDB.SetConnMaxIdleTime(10 * time.Minute) // Maximum idle time before closing

	// Step 2.5: a database restored from a dump made by the old GORM-based export has no primary
	// keys at all, which makes every later migration that references a table's id fail.
	repairMissingPrimaryKeys()

	// Step 3: Run schema migrations
	migrator := NewMigrator(db)
	if err := migrator.Migrate(); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	// Step 3.5: Clean up invalid group_id references (safety check)
	// This ensures data integrity even if migrations didn't run or were applied before cleanup was added
	// This is idempotent and safe to run multiple times
	if err := db.Exec(`
		UPDATE client_entities
		SET group_id = NULL
		WHERE group_id IS NOT NULL
		  AND group_id NOT IN (SELECT id FROM client_groups)
	`).Error; err != nil {
		// Log warning but don't fail - this is a data cleanup, not critical
		appLogger.Warningf("DB cleanup: failed to cleanup invalid group_id references: %v", err)
	}

	// Step 4: Check schema version compatibility
	if err := migrator.CheckSchemaVersion(minRequiredSchemaVersion); err != nil {
		return fmt.Errorf("schema version check failed: %w", err)
	}

	// Step 5: Initialize default user (if needed)
	isUsersEmpty, err := isTableEmpty("users")
	if err != nil {
		return fmt.Errorf("failed to check if users table is empty: %w", err)
	}

	if err := initUser(); err != nil {
		return fmt.Errorf("failed to initialize default user: %w", err)
	}

	// Step 5.5: access control must never leave the panel without an administrator (restore from an old dump,
	// rollback to a version that did not know roles, a hand-edited database).
	EnsureAdminAccess()

	// Step 6: Run seeders
	if err := runSeeders(isUsersEmpty); err != nil {
		return fmt.Errorf("failed to run seeders: %w", err)
	}

	return nil
}

// repairMissingPrimaryKeys adds a primary key on id to every public table that has an id column but no
// primary key. Healthy databases are untouched. Failures (e.g. duplicate ids) are logged and skipped so
// that startup is never blocked by the repair itself.
func repairMissingPrimaryKeys() {
	var tables []string
	err := db.Raw(`
		SELECT c.relname
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind = 'r'
		  AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped)
		  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary)
		ORDER BY c.relname`).Scan(&tables).Error
	if err != nil {
		appLogger.Warningf("DB repair: cannot list tables without a primary key: %v", err)
		return
	}
	for _, t := range tables {
		if err := db.Exec(fmt.Sprintf(`ALTER TABLE public.%q ADD PRIMARY KEY (id)`, t)).Error; err != nil {
			appLogger.Warningf("DB repair: could not add primary key to %s: %v", t, err)
			continue
		}
		appLogger.Warningf("DB repair: restored missing primary key on %s (database was restored from an incomplete dump)", t)
	}
}

// CloseDB closes the database connection if it exists.
func CloseDB() error {
	if db != nil {
		sqlDB, err := db.DB()
		db = nil // a closed handle must not be reused (tests open and close several databases)
		if err != nil {
			return err
		}
		return sqlDB.Close()
	}
	return nil
}

// GetDB returns the global GORM database instance.
func GetDB() *gorm.DB {
	return db
}

// IsNotFound checks if the given error is a GORM record not found error.
func IsNotFound(err error) bool {
	return err == gorm.ErrRecordNotFound
}

// AdminRoleID returns the id of the built-in Administrator role (nil if migration 0064 has not run).
func AdminRoleID() *int {
	var id int
	if err := db.Raw("SELECT id FROM roles WHERE system_key = 'administrator'").Scan(&id).Error; err != nil || id == 0 {
		return nil
	}
	return &id
}

// EnsureAdminAccess guarantees that at least one enabled, not deleted user holds the Administrator role, and that no
// user is left without a role. Users without a role (created by an older version after the migration ran) become
// Administrators: that is what they were before roles existed. If no administrator can sign in, the first user is
// restored as one. It is idempotent and runs on every start.
func EnsureAdminAccess() {
	admin := AdminRoleID()
	if admin == nil {
		return
	}
	res := db.Exec("UPDATE users SET role_id = ?, updated_at = ? WHERE role_id IS NULL AND deleted_at IS NULL", *admin, time.Now().Unix())
	if res.Error == nil && res.RowsAffected > 0 {
		appLogger.Warningf("RBAC: %d user(s) without a role were made Administrators (as they were before roles existed)", res.RowsAffected)
	}
	var n int64
	db.Raw(`SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
	        WHERE u.enabled = TRUE AND u.deleted_at IS NULL AND r.permissions LIKE '%"*"%'`).Scan(&n)
	if n > 0 {
		return
	}
	var first int
	db.Raw("SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1").Scan(&first)
	if first == 0 {
		return
	}
	if err := db.Exec("UPDATE users SET role_id = ?, enabled = TRUE, updated_at = ? WHERE id = ?", *admin, time.Now().Unix(), first).Error; err == nil {
		appLogger.Warningf("RBAC: no enabled administrator was left, user id %d was restored as Administrator", first)
	}
}
