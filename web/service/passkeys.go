package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn"
)

// Passkeys and hardware security keys (WebAuthn). A credential can sign a person in by itself (passkey login: the
// authenticator proves possession and the person's presence *and* verification, which is why it counts as MFA) or serve as
// the second factor after a password.

// PasskeyService implements registration and the two kinds of assertion.
type PasskeyService struct {
	mu   sync.Mutex
	sess map[string]wsEntry
}

// Passkeys is the shared instance.
var Passkeys = &PasskeyService{sess: map[string]wsEntry{}}

type wsEntry struct {
	data    webauthn.SessionData
	userID  int
	purpose string
	created time.Time
}

const wsTTL = 5 * time.Minute

func (p *PasskeyService) put(e wsEntry) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for k, v := range p.sess {
		if now.Sub(v.created) > wsTTL {
			delete(p.sess, k)
		}
	}
	if len(p.sess) > 5000 {
		p.sess = map[string]wsEntry{}
	}
	e.created = now
	id := authn.Random(24)
	p.sess[id] = e
	return id
}

func (p *PasskeyService) take(id, purpose string) (wsEntry, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.sess[id]
	delete(p.sess, id) // a ceremony is single use
	if !ok || e.purpose != purpose || time.Since(e.created) > wsTTL {
		return wsEntry{}, false
	}
	return e, true
}

// ErrPasskey is returned for any failed ceremony; the caller says only that the key could not be verified.
var ErrPasskey = errors.New("the security key could not be verified")

// handle is the opaque user handle stored in the authenticator: the user id plus a MAC under the panel secret, so a handle
// can be trusted when it comes back and nothing about the person leaks into the device.
func (p *PasskeyService) handle(userID int) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(userID))
	mac := hmac.New(sha256.New, append([]byte("sharx-webauthn-handle\x00"), SSO.secret()...))
	mac.Write(b)
	return append(b, mac.Sum(nil)[:24]...)
}

func (p *PasskeyService) userFromHandle(h []byte) (int, bool) {
	if len(h) != 32 {
		return 0, false
	}
	id := int(binary.BigEndian.Uint64(h[:8]))
	return id, hmac.Equal(h, p.handle(id))
}

type waUser struct {
	svc  *PasskeyService
	id   int
	name string
	cred []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return u.svc.handle(u.id) }
func (u *waUser) WebAuthnName() string                       { return u.name }
func (u *waUser) WebAuthnDisplayName() string                { return u.name }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.cred }

func (p *PasskeyService) loadUser(userID int) (*waUser, []model.UserPasskey, error) {
	var u model.User
	if err := database.GetDB().Where("id = ? AND deleted_at IS NULL", userID).First(&u).Error; err != nil {
		return nil, nil, err
	}
	var rows []model.UserPasskey
	database.GetDB().Where("user_id = ?", userID).Order("id").Find(&rows)
	wu := &waUser{svc: p, id: u.Id, name: u.Username}
	for _, r := range rows {
		var c webauthn.Credential
		if json.Unmarshal([]byte(r.Credential), &c) == nil {
			wu.cred = append(wu.cred, c)
		}
	}
	return wu, rows, nil
}

// RP describes the relying party of one request.
type RP struct {
	ID      string
	Origins []string
}

// WebAuthn builds the relying party. A pinned configuration wins; otherwise it follows the address the panel is reached at.
func (p *PasskeyService) WebAuthn(rp RP) (*webauthn.WebAuthn, error) {
	c := Methods.Config()
	if c.RpId != "" {
		rp.ID = c.RpId
	}
	if len(c.Origins) > 0 {
		rp.Origins = c.Origins
	}
	return webauthn.New(&webauthn.Config{RPID: rp.ID, RPDisplayName: "SharX Panel", RPOrigins: rp.Origins})
}

// HasPasskeys reports whether the user has any registered credential.
func (p *PasskeyService) HasPasskeys(userID int) bool {
	var n int64
	database.GetDB().Model(&model.UserPasskey{}).Where("user_id = ?", userID).Count(&n)
	return n > 0
}

// PasskeyView is a credential as the UI lists it.
type PasskeyView struct {
	Id         int    `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"createdAt"`
	LastUsedAt int64  `json:"lastUsedAt"`
}

// List returns the user's credentials.
func (p *PasskeyService) List(userID int) []PasskeyView {
	var rows []model.UserPasskey
	database.GetDB().Where("user_id = ?", userID).Order("id").Find(&rows)
	out := make([]PasskeyView, 0, len(rows))
	for _, r := range rows {
		out = append(out, PasskeyView{Id: r.Id, Name: r.Name, CreatedAt: r.CreatedAt, LastUsedAt: r.LastUsedAt})
	}
	return out
}

// Delete removes one of the user's own credentials.
func (p *PasskeyService) Delete(userID, id int) error {
	res := database.GetDB().Where("id = ? AND user_id = ?", id, userID).Delete(&model.UserPasskey{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("security key")
	}
	return nil
}

// Rename changes the label of one of the user's own credentials.
func (p *PasskeyService) Rename(userID, id int, name string) error {
	name, err := cleanName(name, 100, "name")
	if err != nil {
		return err
	}
	res := database.GetDB().Model(&model.UserPasskey{}).Where("id = ? AND user_id = ?", id, userID).Update("name", name)
	if res.Error != nil || res.RowsAffected == 0 {
		return notFound("security key")
	}
	return nil
}

// BeginRegistration starts adding a credential to the signed-in user's account.
func (p *PasskeyService) BeginRegistration(wa *webauthn.WebAuthn, userID int) (*protocol.CredentialCreation, string, error) {
	u, rows, err := p.loadUser(userID)
	if err != nil {
		return nil, "", err
	}
	if len(rows) >= 10 {
		return nil, "", conflict("at most 10 security keys per account")
	}
	var exclude []protocol.CredentialDescriptor
	for _, c := range u.cred {
		exclude = append(exclude, c.Descriptor())
	}
	creation, sd, err := wa.BeginRegistration(u,
		webauthn.WithExclusions(exclude),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementPreferred, UserVerification: protocol.VerificationPreferred}),
	)
	if err != nil {
		return nil, "", err
	}
	return creation, p.put(wsEntry{data: *sd, userID: userID, purpose: "register"}), nil
}

// FinishRegistration verifies the authenticator's answer and stores the credential.
func (p *PasskeyService) FinishRegistration(wa *webauthn.WebAuthn, userID int, sessID, name string, body []byte) (*PasskeyView, error) {
	e, ok := p.take(sessID, "register")
	if !ok || e.userID != userID {
		return nil, ErrPasskey
	}
	u, _, err := p.loadUser(userID)
	if err != nil {
		return nil, err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body)
	if err != nil {
		return nil, ErrPasskey
	}
	cred, err := wa.CreateCredential(u, e.data, parsed)
	if err != nil {
		return nil, ErrPasskey
	}
	if strings.TrimSpace(name) == "" {
		name = "Security key"
	}
	name, err = cleanName(name, 100, "name")
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(cred)
	row := model.UserPasskey{UserId: userID, Name: name, CredentialId: fmt.Sprintf("%x", cred.ID), Credential: string(raw), CreatedAt: time.Now().Unix()}
	if err := database.GetDB().Create(&row).Error; err != nil {
		return nil, conflict("this security key is already registered")
	}
	return &PasskeyView{Id: row.Id, Name: row.Name, CreatedAt: row.CreatedAt}, nil
}

// BeginLogin starts a passkey sign-in (the person is not named: the authenticator offers its resident credentials).
func (p *PasskeyService) BeginLogin(wa *webauthn.WebAuthn) (*protocol.CredentialAssertion, string, error) {
	as, sd, err := wa.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return nil, "", err
	}
	return as, p.put(wsEntry{data: *sd, purpose: "login"}), nil
}

// FinishLogin verifies a passkey assertion and returns the account. User verification is required, so a passkey sign-in is a
// complete multi-factor sign-in on its own.
func (p *PasskeyService) FinishLogin(wa *webauthn.WebAuthn, sessID string, body []byte) (*model.User, error) {
	e, ok := p.take(sessID, "login")
	if !ok {
		return nil, ErrPasskey
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body)
	if err != nil {
		return nil, ErrPasskey
	}
	var matched *waUser
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		id, ok := p.userFromHandle(userHandle)
		if !ok {
			return nil, ErrPasskey
		}
		u, _, err := p.loadUser(id)
		if err != nil {
			return nil, ErrPasskey
		}
		matched = u
		return u, nil
	}
	_, cred, err := wa.ValidatePasskeyLogin(handler, e.data, parsed)
	if err != nil || matched == nil {
		return nil, ErrPasskey
	}
	if err := p.afterAssertion(matched.id, cred); err != nil {
		return nil, err
	}
	var user model.User
	if err := database.GetDB().Where("id = ? AND deleted_at IS NULL", matched.id).First(&user).Error; err != nil {
		return nil, ErrPasskey
	}
	return &user, nil
}

// BeginSecondFactor starts an assertion for a person who has just proven their password.
func (p *PasskeyService) BeginSecondFactor(wa *webauthn.WebAuthn, userID int) (*protocol.CredentialAssertion, string, error) {
	u, _, err := p.loadUser(userID)
	if err != nil || len(u.cred) == 0 {
		return nil, "", ErrPasskey
	}
	as, sd, err := wa.BeginLogin(u, webauthn.WithUserVerification(protocol.VerificationPreferred))
	if err != nil {
		return nil, "", err
	}
	return as, p.put(wsEntry{data: *sd, userID: userID, purpose: "second"}), nil
}

// FinishSecondFactor verifies the assertion against that person's own credentials.
func (p *PasskeyService) FinishSecondFactor(wa *webauthn.WebAuthn, userID int, sessID string, body []byte) error {
	e, ok := p.take(sessID, "second")
	if !ok || e.userID != userID {
		return ErrPasskey
	}
	u, _, err := p.loadUser(userID)
	if err != nil {
		return ErrPasskey
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body)
	if err != nil {
		return ErrPasskey
	}
	cred, err := wa.ValidateLogin(u, e.data, parsed)
	if err != nil {
		return ErrPasskey
	}
	return p.afterAssertion(userID, cred)
}

// afterAssertion records the new signature counter and refuses a credential that looks cloned.
func (p *PasskeyService) afterAssertion(userID int, cred *webauthn.Credential) error {
	if cred.Authenticator.CloneWarning {
		Audit.Record(Actor{Principal: &Principal{UserId: userID}}, "auth.passkey_clone", "user", fmt.Sprint(userID), "", nil, nil, "denied", "the authenticator's signature counter went backwards: possible clone")
		return ErrPasskey
	}
	raw, _ := json.Marshal(cred)
	database.GetDB().Model(&model.UserPasskey{}).Where("user_id = ? AND credential_id = ?", userID, fmt.Sprintf("%x", cred.ID)).
		Updates(map[string]any{"credential": string(raw), "last_used_at": time.Now().Unix()})
	return nil
}
