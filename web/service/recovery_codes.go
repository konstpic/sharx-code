package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// Recovery codes stand in for a second factor when the device is lost. They are one-time, shown once, stored only as hashes,
// and a new set replaces the old one.

const recoveryCodeCount = 10

func normalizeRecovery(s string) string {
	return strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(s)))
}

func hashRecovery(code string) string {
	h := sha256.Sum256([]byte("sharx-recovery\x00" + normalizeRecovery(code)))
	return hex.EncodeToString(h[:])
}

// LooksLikeRecoveryCode tells a recovery code from a six-digit TOTP code.
func LooksLikeRecoveryCode(s string) bool {
	n := normalizeRecovery(s)
	if len(n) != 16 {
		return false
	}
	for _, r := range n {
		if !(r >= 'a' && r <= 'z' || r >= '2' && r <= '7') {
			return false
		}
	}
	return true
}

// GenerateRecoveryCodes replaces the user's codes with a fresh set and returns them (the only time they are visible).
// Format: four groups of four letters/digits, 80 bits of randomness each.
func GenerateRecoveryCodes(userID int) ([]string, error) {
	codes := make([]string, 0, recoveryCodeCount)
	rows := make([]model.UserRecoveryCode, 0, recoveryCodeCount)
	now := time.Now().Unix()
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	for i := 0; i < recoveryCodeCount; i++ {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		raw := strings.ToLower(enc.EncodeToString(b)) // 16 characters
		code := fmt.Sprintf("%s-%s-%s-%s", raw[0:4], raw[4:8], raw[8:12], raw[12:16])
		codes = append(codes, code)
		rows = append(rows, model.UserRecoveryCode{UserId: userID, CodeHash: hashRecovery(code), CreatedAt: now})
	}
	tx := database.GetDB().Begin()
	if err := tx.Where("user_id = ?", userID).Delete(&model.UserRecoveryCode{}).Error; err != nil {
		tx.Rollback()
		return nil, err
	}
	if err := tx.Create(&rows).Error; err != nil {
		tx.Rollback()
		return nil, err
	}
	return codes, tx.Commit().Error
}

// RemainingRecoveryCodes counts the unused codes.
func RemainingRecoveryCodes(userID int) int {
	var n int64
	database.GetDB().Model(&model.UserRecoveryCode{}).Where("user_id = ? AND used_at IS NULL", userID).Count(&n)
	return int(n)
}

// UseRecoveryCode redeems a code. Of two simultaneous attempts with the same code exactly one succeeds.
func UseRecoveryCode(userID int, code string) bool {
	res := database.GetDB().Exec(`UPDATE user_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
		time.Now().Unix(), userID, hashRecovery(code))
	return res.Error == nil && res.RowsAffected == 1
}

// DeleteRecoveryCodes forgets all codes (2FA was switched off or reset).
func DeleteRecoveryCodes(userID int) {
	database.GetDB().Where("user_id = ?", userID).Delete(&model.UserRecoveryCode{})
}
