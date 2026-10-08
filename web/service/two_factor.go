package service

import (
	"fmt"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"gorm.io/gorm"
)

// Two-factor authentication belongs to a user, not to the panel: each account has its own TOTP secret, so one person
// enabling, resetting or losing 2FA never touches anybody else's sign-in.

// UserTwoFactor returns whether the user has 2FA on and the secret that goes with it.
func UserTwoFactor(userID int) (enabled bool, secret string) {
	var u model.User
	if err := database.GetDB().Select("two_factor_enabled", "two_factor_secret").Where("id = ?", userID).First(&u).Error; err != nil {
		return false, ""
	}
	return u.TwoFactorEnabled && u.TwoFactorSecret != "", u.TwoFactorSecret
}

// EnableUserTwoFactor stores a verified secret and turns 2FA on for the user.
func EnableUserTwoFactor(userID int, secret string) error {
	defer InvalidateRBAC() // the MFA policy looks at whether a second factor exists
	return database.GetDB().Model(&model.User{}).Where("id = ? AND deleted_at IS NULL", userID).
		Updates(map[string]any{"two_factor_enabled": true, "two_factor_secret": secret, "updated_at": time.Now().Unix()}).Error
}

// DisableUserTwoFactor turns 2FA off and forgets the secret.
func DisableUserTwoFactor(userID int) error {
	defer InvalidateRBAC()
	DeleteRecoveryCodes(userID)
	return database.GetDB().Model(&model.User{}).Where("id = ?", userID).
		Updates(map[string]any{"two_factor_enabled": false, "two_factor_secret": "", "updated_at": time.Now().Unix()}).Error
}

// ResetUserTwoFactor is the administrative reset for a user who lost their device. It follows the rules of a password
// reset: the target's role must be covered by the caller, you cannot do it to yourself (use your own settings), and the
// user's sessions end. It is audited.
func (s *RBACService) ResetUserTwoFactor(a Actor, id int) error {
	var target model.User
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&target).Error; err != nil {
			return notFound("user")
		}
		if id == a.Principal.UserId {
			return forbidden("turn off your own two-factor authentication in the account settings")
		}
		var r model.Role
		if target.RoleId != nil {
			r, _ = loadRole(tx, *target.RoleId)
		}
		if !a.Principal.Perms.Covers(rbac.NewSet(parsePerms(r.Permissions))) {
			return forbidden("this user has more permissions than you, so you cannot reset their two-factor authentication")
		}
		DeleteRecoveryCodes(id)
		return tx.Model(&model.User{}).Where("id = ?", id).
			Updates(map[string]any{"two_factor_enabled": false, "two_factor_secret": "", "updated_at": time.Now().Unix()}).Error
	})
	if err != nil {
		Audit.Record(a, "user.two_factor_reset", "user", fmt.Sprint(id), target.Username, nil, nil, "denied", err.Error())
		return err
	}
	InvalidateRBAC()
	revokeAccess(id)
	Audit.Record(a, "user.two_factor_reset", "user", fmt.Sprint(id), target.Username, nil, nil, "ok", "")
	return nil
}
