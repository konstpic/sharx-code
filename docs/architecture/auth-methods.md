# Sign-in methods: e-mail, passkeys, recovery codes, MFA policy

Companion to [`rbac.md`](rbac.md) (who may do what) and [`sso.md`](sso.md) (sign-in through an identity provider). This file covers
the methods the panel itself provides. All of it is configured in the panel: **Users & roles -> Sign-in methods**.

## What exists

| Method | Needs | Notes |
|---|---|---|
| Password (username) | nothing | always on for administrators; can be closed for everybody else when sign-in is single-sign-on only |
| Password, with the e-mail address as the login | nothing | opt-in; works when the address is set on exactly one account |
| **Magic link** (one-time link by e-mail) | **verified SMTP** + public address | valid 15 min, single use |
| **Self-registration** with e-mail confirmation | **verified SMTP** + public address + a role | account exists only after the link is opened |
| **Password reset** by e-mail | **verified SMTP** + public address | link valid 1 h; ends all sessions and API tokens of the account |
| TOTP (authenticator app) | nothing | per user (stage v2.6.0) |
| **Recovery codes** | TOTP | 10 one-time codes, shown once, replace the authenticator code |
| **Passkeys / hardware security keys** (WebAuthn) | HTTPS | passwordless sign-in, or the second factor after a password |
| Single sign-on (OIDC / OAuth 2.0) | provider | see `sso.md` |
| **MFA policy** | nothing | off / administrators / everybody, plus a flag per role and per user |

## E-mail needs an SMTP server - and the panel says so

The panel sends no mail by itself. The administrator enters the account of a mail server they already have (host, port,
STARTTLS / TLS / none, login, password, sender) under **E-mail (SMTP)** and presses **Send test**. Only a server that accepted a
real test message with exactly these settings counts as *verified*.

* A method that needs e-mail **cannot be switched on** while there is no verified account - the switch is disabled with the reason
  next to it, and the server refuses the request too (409, "needs an SMTP server: set it up and send a test message first").
* Changing the server settings forgets the verification. Methods that were on stay configured but **stop being offered**, and
  the page lists them under a warning ("switched on but not working because e-mail is not verified").
* The account cannot be switched off while a method depends on it.
* The SMTP password is sealed with AES-GCM like provider secrets, never returned, never written to the audit trail.
* The connection: STARTTLS is *required* when chosen (no silent downgrade to plain text); the certificate is verified unless the
  administrator explicitly accepts self-signed ones; the login is never sent over an unencrypted connection to a remote server.
  Header values with line breaks are refused (no header injection).

### Links in e-mail come from a configured address

A reset link built from the request's `Host` header would let anybody make the panel mail a victim a link to the attacker's server
(password-reset poisoning). So links are built **only** from *Public address of the panel* (`https://panel.example.com:2053/secret-path/`),
which is required before any e-mail method can be enabled and must be https (plain http only for loopback).

## One-time tokens

Magic links, registration confirmations and password resets share one mechanism (`auth_tokens`): 32 random bytes, **only the SHA-256
hash is stored**, bound to their purpose (a reset token cannot sign anybody in), short-lived, used up atomically (of two simultaneous
uses exactly one wins). Requests never reveal whether an address has an account: same answer, and the mail is sent in the background
so timing does not tell either. Limits: 5 links per address and hour, 20 per IP; registration 3 per address, 10 per IP; reset 3 / 10.
A magic link for an account with two-factor authentication is **not used up until the second factor has also passed**, so a mistyped
code does not burn it. Disabled accounts, ambiguous addresses (held by two accounts) and - when password-class sign-in is closed -
non-administrators get no link.

Registration stores the password only as a bcrypt hash inside the pending token; nothing is created before confirmation; the role
must not be the administrator role or hold an administrators-only permission (checked when the method is saved **and** again when
the link is opened, in case the role changed meanwhile). Password reset also voids older pending reset links of the account.

## Passkeys and security keys (WebAuthn)

Implemented with `go-webauthn`. The relying party follows the address the panel is opened at unless pinned under *Advanced*.

* **Registration** (Settings -> Security, signed in): the credential is stored as public material only; at most 10 per account;
  already-registered keys are excluded.
* **Passkey sign-in**: the authenticator offers its resident credentials; the panel requires **user verification** (PIN, fingerprint,
  face), which is why a passkey sign-in counts as complete MFA. The user handle is `user id + MAC` under the panel secret, so a
  handle that comes back can be trusted. A signature counter that goes backwards (a cloned key) is refused and audited.
* **As a second factor**: after the correct password, a person who has keys gets a challenge that only their own credentials answer.
* Ceremonies are single use and expire in 5 minutes. An assertion made for another origin (a phishing page) fails.
* Passkey sign-in is a local credential: the "single sign-on only" switch closes it for non-administrators like the password.

## Recovery codes

Ten codes (16 characters in four groups, 80 bits each), generated when TOTP is enabled and on demand (needs a current authenticator code).
Stored only as SHA-256 hashes (with a fixed purpose prefix; the codes themselves carry enough randomness that a per-code salt adds nothing), each usable once (atomic), a new set voids the old one, switching 2FA off or an administrator's
reset deletes them. Use is audited. The login form accepts a recovery code wherever it accepts the authenticator code.

## MFA policy

*Two-factor authentication is required for*: **nobody / administrators / everybody**. A role can require it (*Everybody with this role
must use two-factor authentication*) and so can a single user. A person who is covered and has **no second factor yet** (neither TOTP
nor a security key) can sign in but reaches only the enrolment pages (their own 2FA, security keys, recovery codes, profile); every
other request is answered `403 {"code":"mfa_enrollment_required"}` by the central authorization step, and the UI sends them to
Settings -> Security with a banner. Enrolling lifts the gate immediately. A sign-in through an identity provider counts as two-factor
when *A sign-in through an identity provider counts as two-factor* is on (default); turn it off if the provider does not ask for a
second factor. The Telegram one-time code, when enabled, still applies to every password-class sign-in.

## Brute force

`/login` (and the second-factor step, magic links and passkeys) counts failures: **6 per address and account, 40 per address, 30 per
account** in 15 minutes, and 60 attempts per address per minute. A blocked attempt gets the same answer as a wrong password and a
correct password does not get through while blocked. (The per-account counter lets a stranger slow down sign-ins to one account for up
to 15 minutes; that is the price of making distributed guessing slow.) The e-mail endpoints, token use and passkey endpoints have their own limits.

## Sessions, cookies, CSRF, CORS

Unchanged and relevant here: the session cookie is HttpOnly, SameSite=Lax; SameSite=Lax means the browser does not attach it to cross-site POSTs (the CSRF defence), and no CORS headers are sent, so other
origins cannot call the API with the session. The Apple form-post callback is turned into a GET to the panel's own address, which keeps the binding check.

## API

Public (rate limited): `GET auth/methods`, `POST auth/magic/request|verify`, `POST auth/register`, `POST auth/register/confirm`,
`POST auth/password/forgot|reset`, `POST auth/passkey/login/begin|finish`. Signed-in: `GET auth/passkeys`, `POST auth/passkeys/register/begin|finish`,
`POST auth/passkeys/:id/delete|rename`, `POST setting/recoveryCodes/generate`, `GET setting/recoveryCodes/status`. Administrators (`auth:read` /
`auth:manage`): `GET|POST auth/methods`, `GET|POST auth/mail`, `POST auth/mail/test`.

## Tests

`web/mail` (a fake SMTP server: plain, STARTTLS, implicit TLS, no downgrade, certificate verification, login, header injection, encoding);
`web/service/auth_methods_test.go` (e-mail methods need a verified account and say so, dependent methods blocked/unblocked, password never
leaks, validation, magic link life cycle and limits, registration, reset, recovery codes, e-mail login, MFA policy in the principal,
passkey registration / login / second factor with a software authenticator, wrong origin, missing user verification, replay, clone
detection, ownership); `web/controller/auth_methods_http_test.go` (brute-force throttling, second factor with TOTP and recovery codes,
magic link over HTTP incl. a poisoned Host header and a second factor that must not burn the link, registration and reset over HTTP,
refusals while methods are off, passkeys over HTTP, the MFA enrolment gate, identity-provider sign-ins that count as MFA);
`database/rbac_migration_test.go` (migrations 0067-0068 idempotent, old binary still works).

Rollback: deploy the previous version; the new tables and columns are ignored by it. Optional cleanup is in `0068_auth_methods.sql`.
