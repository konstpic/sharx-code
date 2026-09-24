package service

import (
	"testing"
	"time"
)

func TestTgLoginCodeResendVerifyAndAttempts(t *testing.T) {
	s := &TgLoginCodeStore{entries: map[string]*tgLoginCodeEntry{}}
	now := time.Now()

	code, wait, err := s.Issue("Admin", now)
	if err != nil || len(code) != 6 || wait != 60 {
		t.Fatalf("issue: code=%q wait=%d err=%v", code, wait, err)
	}
	if c2, w2, _ := s.Issue("admin", now.Add(10*time.Second)); c2 != "" || w2 != 50 {
		t.Fatalf("resend must be throttled: code=%q wait=%d", c2, w2)
	}
	c3, _, _ := s.Issue("admin", now.Add(61*time.Second))
	if c3 == "" {
		t.Fatal("resend after 60s must issue a new code")
	}
	if s.Verify("admin", code+"x", now.Add(62*time.Second)) {
		t.Fatal("wrong code accepted")
	}
	if !s.Verify("admin", c3, now.Add(63*time.Second)) {
		t.Fatal("valid code rejected")
	}
	if s.Verify("admin", c3, now.Add(64*time.Second)) {
		t.Fatal("code must be single-use")
	}

	c4, _, _ := s.Issue("admin", now.Add(200*time.Second))
	for i := 0; i < tgLoginCodeMaxAttempts; i++ {
		s.Verify("admin", "000000x", now.Add(201*time.Second))
	}
	if s.Verify("admin", c4, now.Add(202*time.Second)) {
		t.Fatal("code must be invalidated after max attempts")
	}
	c5, _, _ := s.Issue("admin", now.Add(300*time.Second))
	if s.Verify("admin", c5, now.Add(300*time.Second+tgLoginCodeTTL+time.Second)) {
		t.Fatal("expired code accepted")
	}
}
