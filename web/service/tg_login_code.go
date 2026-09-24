package service

import (
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

const (
	tgLoginCodeTTL         = 5 * time.Minute
	tgLoginCodeResendAfter = 60 * time.Second
	tgLoginCodeMaxAttempts = 5
)

type tgLoginCodeEntry struct {
	code     string
	sentAt   time.Time
	expires  time.Time
	attempts int
}

// TgLoginCodeStore keeps one-time Telegram login codes in memory (one per username).
// Codes are lost on panel restart, which only forces the user to request a new one.
type TgLoginCodeStore struct {
	mu      sync.Mutex
	entries map[string]*tgLoginCodeEntry
}

var tgLoginCodes = &TgLoginCodeStore{entries: map[string]*tgLoginCodeEntry{}}

// TgLoginCodes returns the process-wide store.
func TgLoginCodes() *TgLoginCodeStore { return tgLoginCodes }

func tgLoginCodeKey(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

// Issue creates a fresh code unless a valid one was sent less than 60 seconds ago.
// It returns the new code (empty when throttled) and the seconds left until a resend is allowed.
func (s *TgLoginCodeStore) Issue(username string, now time.Time) (code string, waitSeconds int, err error) {
	key := tgLoginCodeKey(username)
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.entries[key]; ok && now.Before(e.expires) {
		if left := e.sentAt.Add(tgLoginCodeResendAfter).Sub(now); left > 0 {
			return "", int((left + time.Second - 1) / time.Second), nil
		}
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", 0, err
	}
	code = fmt.Sprintf("%06d", n.Int64())
	s.entries[key] = &tgLoginCodeEntry{code: code, sentAt: now, expires: now.Add(tgLoginCodeTTL)}
	return code, int(tgLoginCodeResendAfter / time.Second), nil
}

// Verify checks a submitted code; a correct code is consumed, and too many wrong attempts invalidate it.
func (s *TgLoginCodeStore) Verify(username, submitted string, now time.Time) bool {
	key := tgLoginCodeKey(username)
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[key]
	if !ok || !now.Before(e.expires) {
		delete(s.entries, key)
		return false
	}
	e.attempts++
	if subtle.ConstantTimeCompare([]byte(e.code), []byte(strings.TrimSpace(submitted))) == 1 {
		delete(s.entries, key)
		return true
	}
	if e.attempts >= tgLoginCodeMaxAttempts {
		delete(s.entries, key)
	}
	return false
}

// Clear drops any pending code for the user.
func (s *TgLoginCodeStore) Clear(username string) {
	s.mu.Lock()
	delete(s.entries, tgLoginCodeKey(username))
	s.mu.Unlock()
}
