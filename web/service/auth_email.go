package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"gorm.io/gorm"
)

// E-mail based sign-in: magic links, self-registration with confirmation, password reset. All three are built on one-time
// tokens that are random, stored only as a hash, short-lived, single-use, and rate limited per address and per IP.
// Requests never reveal whether an address has an account: the answer is the same, and the mail is sent in the background
// so the response time does not tell either.

// Token kinds.
const (
	TokMagic  = "magic"
	TokReset  = "reset"
	TokSignup = "signup"
)

var tokenTTL = map[string]time.Duration{TokMagic: 15 * time.Minute, TokReset: time.Hour, TokSignup: 24 * time.Hour}

// ErrToken is returned for any token that cannot be used (unknown, expired, used): the caller says only "invalid or expired".
var ErrToken = errors.New("the link is invalid or has expired")

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func newToken(tx *gorm.DB, kind, email string, userID *int, payload, ip string) (string, error) {
	raw := authn.Random(32)
	now := time.Now().Unix()
	t := model.AuthToken{Kind: kind, TokenHash: hashToken(raw), UserId: userID, Email: strings.ToLower(email), Payload: payload, IP: ip, CreatedAt: now, ExpiresAt: now + int64(tokenTTL[kind].Seconds())}
	if err := tx.Create(&t).Error; err != nil {
		return "", err
	}
	return raw, nil
}

// PeekToken validates a token without using it (so a failed second factor does not burn the link).
func (s *AuthEmailService) PeekToken(kind, raw string) (*model.AuthToken, error) {
	var t model.AuthToken
	err := database.GetDB().Where("token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?", hashToken(raw), kind, time.Now().Unix()).First(&t).Error
	if err != nil {
		return nil, ErrToken
	}
	return &t, nil
}

// consume uses a token atomically: of two simultaneous requests exactly one wins.
func consume(tx *gorm.DB, kind, raw string) (*model.AuthToken, error) {
	var rows []model.AuthToken
	err := tx.Raw(`UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING *`,
		time.Now().Unix(), hashToken(raw), kind, time.Now().Unix()).Scan(&rows).Error
	if err != nil || len(rows) != 1 {
		return nil, ErrToken
	}
	return &rows[0], nil
}

// AuthEmailService implements the e-mail flows.
type AuthEmailService struct{}

// AuthEmail is the shared instance.
var AuthEmail = &AuthEmailService{}

// recentTokens counts what an address or an IP asked for lately (rate limit that survives a restart).
func recentTokens(kind, email, ip string, window time.Duration) (byEmail, byIP int64) {
	since := time.Now().Add(-window).Unix()
	if email != "" {
		database.GetDB().Model(&model.AuthToken{}).Where("kind = ? AND LOWER(email) = LOWER(?) AND created_at > ?", kind, email, since).Count(&byEmail)
	}
	database.GetDB().Model(&model.AuthToken{}).Where("kind = ? AND ip = ? AND created_at > ?", kind, ip, since).Count(&byIP)
	return
}

func cleanEmail(s string) (string, bool) {
	a, err := mail.ParseAddress(strings.TrimSpace(s))
	if err != nil || a.Name != "" || len(a.Address) > 254 || !strings.Contains(a.Address, "@") {
		return "", false
	}
	return strings.ToLower(a.Address), true
}

// findUserByEmail returns the one active account that carries the address. Two accounts with the same address, or none,
// give nil: an ambiguous address must never be used to sign anybody in.
func findUserByEmail(email string) *model.User {
	var users []model.User
	database.GetDB().Where("LOWER(email) = LOWER(?) AND deleted_at IS NULL", email).Limit(2).Find(&users)
	if len(users) != 1 {
		return nil
	}
	return &users[0]
}

func (s *AuthEmailService) send(to, subject, textEN, textRU string) {
	go func() {
		defer func() { _ = recover() }() // a background send must never take the panel down
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		text := textEN + "\r\n\r\n--\r\n\r\n" + textRU
		if err := Mail.Send(ctx, to, subject, text, ""); err != nil {
			logger.Warningf("e-mail to %s could not be sent: %v", to, err)
		}
	}()
}

// ---------- magic link ----------

// RequestMagicLink sends a sign-in link when the address belongs to an account that may sign in. It always returns nil to the
// caller (unless the feature is off) so the answer does not reveal anything. link builds the URL from the raw token.
func (s *AuthEmailService) RequestMagicLink(email, ip string, link func(raw string) string) error {
	if !Methods.Effective().MagicLink {
		return invalid("sign-in links are not enabled")
	}
	addr, ok := cleanEmail(email)
	if !ok {
		return nil
	}
	if e, i := recentTokens(TokMagic, addr, ip, time.Hour); e >= 5 || i >= 20 {
		return nil
	}
	u := findUserByEmail(addr)
	if u == nil || !(&RBACService{}).CanSignIn(u) {
		return nil
	}
	if !SSO.LocalLoginEnabled() {
		if p, _ := (&RBACService{}).GetPrincipal(u.Id); p == nil || !p.Super {
			return nil // password-class sign-in is closed for ordinary users
		}
	}
	uid := u.Id
	raw, err := newToken(database.GetDB(), TokMagic, addr, &uid, "", ip)
	if err != nil {
		return err
	}
	s.send(addr, "Your SharX sign-in link",
		fmt.Sprintf("Open this link to sign in to SharX Panel (valid for 15 minutes, works once):\r\n%s\r\n\r\nIf you did not ask for it, ignore this message.", link(raw)),
		fmt.Sprintf("Откройте ссылку, чтобы войти в SharX Panel (действует 15 минут, одноразовая):\r\n%s\r\n\r\nЕсли вы это не запрашивали, проигнорируйте письмо.", link(raw)))
	return nil
}

// MagicUser checks a magic token and returns the account it signs in, without using the token.
func (s *AuthEmailService) MagicUser(raw string) (*model.User, error) {
	t, err := s.PeekToken(TokMagic, raw)
	if err != nil || t.UserId == nil {
		return nil, ErrToken
	}
	var u model.User
	if err := database.GetDB().Where("id = ? AND deleted_at IS NULL", *t.UserId).First(&u).Error; err != nil {
		return nil, ErrToken
	}
	return &u, nil
}

// UseMagic uses the token. It must be called after every other check has passed.
func (s *AuthEmailService) UseMagic(raw string) error {
	_, err := consume(database.GetDB(), TokMagic, raw)
	return err
}

// ---------- self-registration ----------

type signupPayload struct {
	Email        string `json:"email"`
	PasswordHash string `json:"passwordHash"`
}

// RequestSignup records a pending registration and sends the confirmation link. Nothing is created until the link is opened.
func (s *AuthEmailService) RequestSignup(email, password, ip string, link func(raw string) string) error {
	c := Methods.Effective()
	if !c.Signup {
		return invalid("registration is not open")
	}
	addr, ok := cleanEmail(email)
	if !ok {
		return invalid("the e-mail address is not valid")
	}
	if err := checkPassword(password); err != nil {
		return err
	}
	if len(c.SignupDomains) > 0 {
		at := strings.LastIndex(addr, "@")
		allowed := false
		for _, d := range c.SignupDomains {
			allowed = allowed || strings.EqualFold(d, addr[at+1:])
		}
		if !allowed {
			return invalid("registration is open only for addresses of: %s", strings.Join(c.SignupDomains, ", "))
		}
	}
	if e, i := recentTokens(TokSignup, addr, ip, time.Hour); e >= 3 || i >= 10 {
		return nil
	}
	if findUserByEmail(addr) != nil {
		return nil // an existing account: say nothing, send nothing
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return err
	}
	p, _ := json.Marshal(signupPayload{Email: addr, PasswordHash: hash})
	raw, err := newToken(database.GetDB(), TokSignup, addr, nil, string(p), ip)
	if err != nil {
		return err
	}
	s.send(addr, "Confirm your SharX account",
		fmt.Sprintf("Open this link to confirm your e-mail address and finish creating your SharX Panel account (valid for 24 hours):\r\n%s\r\n\r\nIf you did not register, ignore this message.", link(raw)),
		fmt.Sprintf("Откройте ссылку, чтобы подтвердить e-mail и завершить создание аккаунта SharX Panel (действует 24 часа):\r\n%s\r\n\r\nЕсли вы не регистрировались, проигнорируйте письмо.", link(raw)))
	return nil
}

// ConfirmSignup creates the account from a confirmed registration.
func (s *AuthEmailService) ConfirmSignup(raw, ip string) (*model.User, error) {
	var user model.User
	err := withLock(func(tx *gorm.DB) error {
		t, err := consume(tx, TokSignup, raw)
		if err != nil {
			return err
		}
		var p signupPayload
		if json.Unmarshal([]byte(t.Payload), &p) != nil || p.Email == "" {
			return ErrToken
		}
		c := Methods.cfg()
		if !c.Signup {
			return invalid("registration is not open")
		}
		var role model.Role
		if err := tx.First(&role, c.SignupRoleId).Error; err != nil || roleIsAdmin(role) {
			return invalid("registration is not set up correctly")
		}
		var n int64
		tx.Model(&model.User{}).Where("LOWER(email) = LOWER(?) AND deleted_at IS NULL", p.Email).Count(&n)
		if n > 0 {
			return conflict("an account with this address already exists")
		}
		now := time.Now().Unix()
		rid := role.Id
		user = model.User{Username: SSO.freeUsername(tx, authn.Identity{Email: p.Email}), Password: p.PasswordHash, RoleId: &rid, Enabled: true, CreatedAt: now, UpdatedAt: now,
			Email: p.Email, AuthSource: "local"}
		return tx.Select("Username", "Password", "RoleId", "Enabled", "CreatedAt", "UpdatedAt", "Email", "AuthSource").Create(&user).Error
	})
	if err != nil {
		return nil, err
	}
	InvalidateRBAC()
	Audit.Record(Actor{Principal: &Principal{UserId: user.Id, Username: user.Username}, IP: ip}, "auth.signup", "user", fmt.Sprint(user.Id), user.Username, nil,
		map[string]any{"email": user.Email}, "ok", "self-registration confirmed by e-mail")
	return &user, nil
}

// ---------- password reset ----------

// RequestReset sends a reset link to an address that belongs to an enabled account.
func (s *AuthEmailService) RequestReset(email, ip string, link func(raw string) string) error {
	if !Methods.Effective().PasswordReset {
		return invalid("password reset is not enabled")
	}
	addr, ok := cleanEmail(email)
	if !ok {
		return nil
	}
	if e, i := recentTokens(TokReset, addr, ip, time.Hour); e >= 3 || i >= 10 {
		return nil
	}
	u := findUserByEmail(addr)
	if u == nil || !u.Enabled {
		return nil
	}
	uid := u.Id
	raw, err := newToken(database.GetDB(), TokReset, addr, &uid, "", ip)
	if err != nil {
		return err
	}
	s.send(addr, "Reset your SharX password",
		fmt.Sprintf("Open this link to choose a new password (valid for one hour, works once). Your other sessions will end.\r\n%s\r\n\r\nIf you did not ask for it, ignore this message: your password has not changed.", link(raw)),
		fmt.Sprintf("Откройте ссылку, чтобы задать новый пароль (действует час, одноразовая). Остальные ваши сессии завершатся.\r\n%s\r\n\r\nЕсли вы это не запрашивали, проигнорируйте письмо: пароль не изменён.", link(raw)))
	return nil
}

// ResetPassword sets a new password from a reset token and ends every session and API token of the account.
func (s *AuthEmailService) ResetPassword(raw, password, ip string) error {
	if err := checkPassword(password); err != nil {
		return err
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return err
	}
	var u model.User
	err = database.GetDB().Transaction(func(tx *gorm.DB) error {
		t, err := consume(tx, TokReset, raw)
		if err != nil || t.UserId == nil {
			return ErrToken
		}
		if err := tx.Where("id = ? AND deleted_at IS NULL AND enabled = TRUE", *t.UserId).First(&u).Error; err != nil {
			return ErrToken
		}
		return tx.Model(&model.User{}).Where("id = ?", u.Id).Updates(map[string]any{"password": hash, "updated_at": time.Now().Unix()}).Error
	})
	if err != nil {
		return err
	}
	revokeAccess(u.Id)
	// older reset links of this account are worthless now
	database.GetDB().Model(&model.AuthToken{}).Where("user_id = ? AND kind = ? AND used_at IS NULL", u.Id, TokReset).Update("used_at", time.Now().Unix())
	Audit.Record(Actor{Principal: &Principal{UserId: u.Id, Username: u.Username}, IP: ip}, "auth.password_reset_self", "user", fmt.Sprint(u.Id), u.Username, nil, nil, "ok", "by e-mail link")
	return nil
}

// PurgeExpiredTokens removes tokens that are no longer of any use.
func (s *AuthEmailService) PurgeExpiredTokens() {
	database.GetDB().Where("expires_at < ? OR used_at IS NOT NULL AND used_at < ?", time.Now().Add(-24*time.Hour).Unix(), time.Now().Add(-24*time.Hour).Unix()).Delete(&model.AuthToken{})
}
