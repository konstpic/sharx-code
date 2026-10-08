package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"gorm.io/gorm"
)

// Keeping the panel in step with the identity provider between sign-ins. Two mechanisms, both optional per provider:
//   - re-sync on a schedule, with the refresh token the provider issued (rotated at every use);
//   - a webhook the provider calls when a person changes or is deactivated.
// Both end in the same place: the same decision as a sign-in (role from the rules, access removed when no rule matches), or
// the person's sessions cut when the provider no longer vouches for them.

// ResyncDue re-checks identities whose turn has come. It does at most limit per call so one slow provider cannot stall it.
func (s *SSOService) ResyncDue(ctx context.Context, limit int) int {
	var ids []int
	database.GetDB().Raw(`SELECT i.id FROM user_identities i JOIN auth_providers p ON p.id = i.provider_id
		WHERE p.enabled = TRUE AND p.resync = TRUE AND i.refresh_token <> ''
		  AND i.refreshed_at < ? - (CASE WHEN p.resync_minutes < 5 THEN 15 ELSE LEAST(p.resync_minutes, 1440) END) * 60
		ORDER BY i.refreshed_at LIMIT ?`, time.Now().Unix(), limit).Scan(&ids)
	done := 0
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		if err := s.ResyncIdentity(ctx, id); err != nil {
			logger.Warningf("sso resync of identity %d: %v", id, err)
		}
		done++
	}
	return done
}

// ResyncIdentity asks the provider about one linked account and applies the answer.
func (s *SSOService) ResyncIdentity(ctx context.Context, identityID int) error {
	var ident model.UserIdentity
	if err := database.GetDB().First(&ident, identityID).Error; err != nil {
		return notFound("identity")
	}
	var p model.AuthProvider
	if err := database.GetDB().First(&p, ident.ProviderId).Error; err != nil || !p.Enabled || !p.Resync {
		return nil
	}
	if ident.RefreshToken == "" {
		return nil
	}
	cl, err := s.Client(&p)
	if err != nil {
		return err
	}
	refresh, err := authn.Open(s.secret(), ident.RefreshToken)
	if err != nil {
		return err
	}
	rctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	id, err := cl.Resync(rctx, refresh, ident.Subject, time.Now())
	now := time.Now().Unix()
	if err != nil {
		if authn.IsGrantRevoked(err) {
			// the provider refuses the saved grant: deactivated, revoked or expired. Nobody keeps a session on its strength.
			database.GetDB().Model(&model.UserIdentity{}).Where("id = ?", ident.Id).
				Updates(map[string]any{"refresh_token": "", "resync_error": "the provider no longer accepts the saved sign-in", "refreshed_at": now})
			s.endSessions(ident.UserId, &p, "auth.resync_revoked", "the provider no longer accepts the saved sign-in")
			return nil
		}
		database.GetDB().Model(&model.UserIdentity{}).Where("id = ?", ident.Id).
			Updates(map[string]any{"resync_error": clipText(err.Error(), 200), "refreshed_at": now})
		return err
	}
	if _, err := s.SignIn(&p, *id, "resync", 0); err != nil {
		var se *SSOError
		if errors.As(err, &se) {
			// no_access already removed the role and ended the sessions; the other refusals end the sessions here
			if se.Code != "no_access" {
				s.endSessions(ident.UserId, &p, "auth.resync_revoked", se.Msg)
			}
			database.GetDB().Model(&model.UserIdentity{}).Where("id = ?", ident.Id).Updates(map[string]any{"resync_error": clipText(se.Msg, 200), "refreshed_at": now})
			return nil
		}
		return err
	}
	database.GetDB().Model(&model.UserIdentity{}).Where("id = ?", ident.Id).Update("refreshed_at", now)
	return nil
}

func clipText(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// endSessions cuts everything a user holds (sessions, API tokens) and records why.
func (s *SSOService) endSessions(userID int, p *model.AuthProvider, action, why string) {
	var u model.User
	database.GetDB().First(&u, userID)
	revokeAccess(userID)
	Audit.Record(Actor{Principal: &Principal{UserId: u.Id, Username: u.Username}, IP: "provider"}, action, "user", fmt.Sprint(u.Id), u.Username,
		nil, map[string]any{"provider": p.Key}, "ok", why)
}

// ---------- webhook ----------

// WebhookEvent is the body the provider's webhook sends. Authentik is set up with a webhook mapping that produces it.
type WebhookEvent struct {
	Event    string `json:"event"` // deactivated | deleted | updated
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Username string `json:"username"`
}

// WebhookResult says what the webhook did, for the answer and the log.
type WebhookResult struct {
	Matched bool   `json:"matched"`
	Action  string `json:"action"`
}

var errWebhook = errors.New("webhook refused")

func webhookAuthorized(secret string, header map[string]string, body []byte, now time.Time) bool {
	if secret == "" {
		return false
	}
	if b := header["authorization"]; b != "" {
		low := strings.ToLower(b)
		switch {
		case strings.HasPrefix(low, "bearer "):
			return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(b[7:])), []byte(secret)) == 1
		case strings.HasPrefix(low, "basic "):
			// a webhook URL of the form https://user:SECRET@host/... (providers that cannot set headers): the password is the secret
			raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b[6:]))
			if err != nil {
				return false
			}
			_, pass, ok := strings.Cut(string(raw), ":")
			return ok && subtle.ConstantTimeCompare([]byte(pass), []byte(secret)) == 1
		}
		return false
	}
	sig, ts := strings.TrimPrefix(header["x-sharx-signature"], "sha256="), header["x-sharx-timestamp"]
	if sig == "" || ts == "" {
		return false
	}
	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return false
	}
	if d := now.Sub(time.Unix(sec, 0)); d > 5*time.Minute || d < -5*time.Minute {
		return false // a captured request cannot be replayed later
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(body)))
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(strings.ToLower(sig)))
}

// HandleWebhook authenticates and applies a provider event. header keys are lower-case.
func (s *SSOService) HandleWebhook(ctx context.Context, p *model.AuthProvider, header map[string]string, body []byte, now time.Time) (*WebhookResult, error) {
	secret, err := authn.Open(s.secret(), p.WebhookSecret)
	if err != nil || !webhookAuthorized(secret, header, body, now) {
		return nil, errWebhook
	}
	var ev WebhookEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return nil, invalid("the body is not valid JSON")
	}
	ev.Event = strings.ToLower(strings.TrimSpace(ev.Event))
	switch ev.Event {
	case "deactivated", "deleted", "updated":
	default:
		return nil, invalid("unknown event %q", ev.Event)
	}
	ident := s.findIdentity(p, ev)
	if ident == nil {
		return &WebhookResult{Matched: false, Action: "ignored: nobody here matches"}, nil
	}
	switch ev.Event {
	case "updated":
		if ident.RefreshToken == "" {
			return &WebhookResult{Matched: true, Action: "nothing to do: no saved sign-in to re-check (the change applies at the next sign-in)"}, nil
		}
		if err := s.ResyncIdentity(ctx, ident.Id); err != nil {
			return &WebhookResult{Matched: true, Action: "re-check failed"}, nil
		}
		return &WebhookResult{Matched: true, Action: "re-checked"}, nil
	default: // deactivated, deleted
		database.GetDB().Model(&model.UserIdentity{}).Where("id = ?", ident.Id).Updates(map[string]any{"refresh_token": "", "resync_error": "deactivated at the provider"})
		var u model.User
		database.GetDB().First(&u, ident.UserId)
		action := "sessions ended"
		if u.RoleManaged && p.RoleMode == "idp" {
			if s.removeManagedRole(&u) {
				action = "role removed, sessions ended"
			}
		}
		s.endSessions(ident.UserId, p, "auth.webhook_revoked", "the provider reported the account as "+ev.Event)
		return &WebhookResult{Matched: true, Action: action}, nil
	}
}

func (s *SSOService) findIdentity(p *model.AuthProvider, ev WebhookEvent) *model.UserIdentity {
	db := database.GetDB()
	var ident model.UserIdentity
	if ev.Sub != "" {
		if db.Where("provider_id = ? AND subject = ?", p.Id, ev.Sub).First(&ident).Error == nil {
			return &ident
		}
		return nil
	}
	var list []model.UserIdentity
	if ev.Email != "" {
		db.Where("provider_id = ? AND LOWER(email) = LOWER(?)", p.Id, ev.Email).Limit(2).Find(&list)
	} else if ev.Username != "" {
		db.Raw(`SELECT i.* FROM user_identities i JOIN users u ON u.id = i.user_id
			WHERE i.provider_id = ? AND LOWER(u.username) = LOWER(?) LIMIT 2`, p.Id, ev.Username).Scan(&list)
	}
	if len(list) == 1 { // an ambiguous match must not cut off the wrong person
		return &list[0]
	}
	return nil
}

// removeManagedRole takes the role away from a provider-managed user, unless that would leave no administrator.
func (s *SSOService) removeManagedRole(u *model.User) bool {
	removed := false
	_ = withLock(func(tx *gorm.DB) error {
		if u.RoleId != nil {
			var r model.Role
			tx.First(&r, *u.RoleId)
			if u.Enabled && roleIsAdmin(r) {
				if n, _ := adminCount(tx, u.Id); n < 1 {
					return nil
				}
			}
		}
		removed = tx.Model(&model.User{}).Where("id = ?", u.Id).Updates(map[string]any{"role_id": nil, "updated_at": time.Now().Unix()}).Error == nil
		return nil
	})
	if removed {
		InvalidateRBAC()
	}
	return removed
}
