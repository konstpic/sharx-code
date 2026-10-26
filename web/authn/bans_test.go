package authn

import (
	"testing"
	"time"
)

func TestBansLastExactlyTheGivenTime(t *testing.T) {
	b := NewBans()
	if b.Active("a") {
		t.Fatal("nothing banned yet")
	}
	b.Ban("a", 50*time.Millisecond)
	if !b.Active("a") || b.Active("b") {
		t.Fatal("only the banned key is blocked")
	}
	b.Ban("a", time.Millisecond) // a shorter ban never shortens a longer one
	if !b.Active("a") {
		t.Fatal("ban shortened")
	}
	time.Sleep(70 * time.Millisecond)
	if b.Active("a") {
		t.Fatal("the ban must end")
	}
}

func TestLimiterResetAndSetLimits(t *testing.T) {
	l := NewLimiter(5, time.Minute)
	l.SetLimits(2, time.Minute)
	l.Hit("k")
	l.Hit("k")
	if !l.Over("k") {
		t.Fatal("new limit applies")
	}
	l.Reset("k")
	if l.Over("k") {
		t.Fatal("reset forgets the hits")
	}
}
