package authn

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"sync"
	"time"
)

// Flow is everything the callback needs to finish a sign-in that the browser started. It lives on the server only; the
// browser holds nothing but the opaque state value (and a binding cookie value that ties the flow to that browser).
type Flow struct {
	Provider    string
	Nonce       string
	Verifier    string // PKCE code_verifier
	RedirectURI string // exactly what was sent in the authorization request
	Binding     string // random value also stored in the browser session: defeats login CSRF / session fixation
	LinkUserID  int    // non-zero: the flow links a new identity to this signed-in user instead of signing in
	Next        string
	Created     time.Time

	// filled in by the callback, not at the start: what some providers add to the redirect
	State    string // the state value itself (VK wants it back in the token request)
	DeviceID string // VK ID
	UserHint string // Sign in with Apple: the "user" form field with the name, sent on the first sign-in only
}

// Flows is an in-memory one-time store with a short lifetime.
type Flows struct {
	mu  sync.Mutex
	m   map[string]Flow
	ttl time.Duration
}

// NewFlows returns a store whose entries expire after ttl.
func NewFlows(ttl time.Duration) *Flows { return &Flows{m: map[string]Flow{}, ttl: ttl} }

// Random returns n random bytes, base64url encoded.
func Random(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("authn: no entropy: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Put stores the flow and returns its state value.
func (f *Flows) Put(fl Flow) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	for k, v := range f.m {
		if now.Sub(v.Created) > f.ttl {
			delete(f.m, k)
		}
	}
	if len(f.m) > 10000 { // an unauthenticated endpoint feeds this: bound it
		f.m = map[string]Flow{}
	}
	fl.Created = now
	state := Random(24)
	f.m[state] = fl
	return state
}

// Take returns and removes the flow for state; a state can be used exactly once and only within the lifetime.
func (f *Flows) Take(state string) (Flow, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fl, ok := f.m[state]
	if !ok {
		return Flow{}, false
	}
	delete(f.m, state)
	if time.Since(fl.Created) > f.ttl {
		return Flow{}, false
	}
	return fl, true
}

// ChallengeS256 is the PKCE code_challenge for a verifier.
func ChallengeS256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// SameBinding compares two binding values in constant time.
func SameBinding(a, b string) bool {
	return a != "" && len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
