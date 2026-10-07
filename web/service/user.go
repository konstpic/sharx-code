package service

import (
	"errors"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	ldaputil "github.com/konstpic/sharx-code/v2/util/ldap"
	"gorm.io/gorm"
)

// UserService provides business logic for user management and authentication.
// It handles user creation, login, password management, and 2FA operations.
type UserService struct {
	settingService SettingService
}

// GetFirstUser retrieves the first user from the database.
// This is typically used for initial setup or when there's only one admin user.
func (s *UserService) GetFirstUser() (*model.User, error) {
	db := database.GetDB()

	user := &model.User{}
	err := db.Model(model.User{}).
		Where("deleted_at IS NULL").
		Order("id").
		First(user).
		Error
	if err != nil {
		return nil, err
	}
	return user, nil
}

// VerifyPassword checks username and password (local or LDAP). It does not validate 2FA.
func (s *UserService) VerifyPassword(username string, password string) *model.User {
	db := database.GetDB()

	user := &model.User{}

	err := db.Model(model.User{}).
		Where("username = ?", username).
		First(user).
		Error
	if err == gorm.ErrRecordNotFound {
		return nil
	} else if err != nil {
		logger.Warning("check user err:", err)
		return nil
	}

	// If LDAP enabled and local password check fails, attempt LDAP auth
	if !crypto.CheckPasswordHash(user.Password, password) {
		ldapEnabled, _ := s.settingService.GetLdapEnable()
		if !ldapEnabled {
			return nil
		}

		host, _ := s.settingService.GetLdapHost()
		port, _ := s.settingService.GetLdapPort()
		useTLS, _ := s.settingService.GetLdapUseTLS()
		bindDN, _ := s.settingService.GetLdapBindDN()
		ldapPass, _ := s.settingService.GetLdapPassword()
		baseDN, _ := s.settingService.GetLdapBaseDN()
		userFilter, _ := s.settingService.GetLdapUserFilter()
		userAttr, _ := s.settingService.GetLdapUserAttr()

		cfg := ldaputil.Config{
			Host:       host,
			Port:       port,
			UseTLS:     useTLS,
			BindDN:     bindDN,
			Password:   ldapPass,
			BaseDN:     baseDN,
			UserFilter: userFilter,
			UserAttr:   userAttr,
		}
		ok, err := ldaputil.AuthenticateUser(cfg, username, password)
		if err != nil || !ok {
			return nil
		}
	}

	return user
}

// isAdministrator reports whether the user holds a role with the wildcard permission.
func (s *UserService) isAdministrator(id int) bool {
	var n int64
	database.GetDB().Raw(`SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
		WHERE u.id = ? AND r.permissions LIKE '%"*"%'`, id).Scan(&n)
	return n > 0
}

func (s *UserService) UpdateUser(id int, username string, password string) error {
	db := database.GetDB()
	hashedPassword, err := crypto.HashPasswordAsBcrypt(password)

	if err != nil {
		return err
	}

	return db.Model(model.User{}).
		Where("id = ?", id).
		Updates(map[string]any{"username": username, "password": hashedPassword}).
		Error
}

func (s *UserService) UpdateFirstUser(username string, password string) error {
	if username == "" {
		return errors.New("username can not be empty")
	} else if password == "" {
		return errors.New("password can not be empty")
	}
	hashedPassword, er := crypto.HashPasswordAsBcrypt(password)

	if er != nil {
		return er
	}

	db := database.GetDB()
	user := &model.User{}
	err := db.Model(model.User{}).Where("deleted_at IS NULL").Order("id").First(user).Error
	if database.IsNotFound(err) {
		user.Username = username
		user.Password = hashedPassword
		user.Enabled = true
		user.RoleId = database.AdminRoleID()
		user.CreatedAt = time.Now().Unix()
		return db.Model(model.User{}).Create(user).Error
	} else if err != nil {
		return err
	}
	// This is the command-line recovery path ("x-ui setting -username -password"): whoever runs it on the server must
	// get a working administrator back, even if the account had been disabled or its role changed.
	user.Username = username
	user.Password = hashedPassword
	user.Enabled = true
	user.RoleId = database.AdminRoleID()
	user.UpdatedAt = time.Now().Unix()
	return db.Save(user).Error
}
