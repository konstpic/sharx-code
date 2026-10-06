package amneziawg

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/logger"
)

func TestAwgLineClassifier(t *testing.T) {
	c := newAwgLineClassifier()
	run := func(line string) (logger.Entry, bool) {
		e := logger.Entry{Msg: line, Level: "info"}
		ok := c(line, &e)
		return e, ok
	}
	e, ok := run("ERROR: (awg19) 2026/10/06 19:19:41 peer(wiYb…jezs) - Failed to send handshake initiation: no known endpoint for peer")
	if !ok || e.Level != "debug" || e.Msg != "Failed to send handshake initiation: no known endpoint for peer peer=wiYb…jezs" {
		t.Fatalf("%+v", e)
	}
	e, _ = run("ERROR: (awg19) 2026/10/06 19:19:41 Failed to bring up device")
	if e.Level != "error" || e.Msg != "Failed to bring up device" {
		t.Fatalf("%+v", e)
	}
	// banner box: one sentence for the first line, the rest dropped
	e, ok = run("┌──────────────────────────────┐")
	if !ok || e.Msg == "" || e.Level != "info" {
		t.Fatalf("%+v", e)
	}
	for _, l := range []string{"│       please visit:        │", "| https://github.com/amnezia-vpn/amneziawg-linux-kernel-module │", "└──────┘"} {
		if _, ok := run(l); ok {
			t.Errorf("banner line must be dropped: %q", l)
		}
	}
}

func TestAwgShowSummary(t *testing.T) {
	out := "interface: awg19\n  public key: x=\n  private key: (hidden)\n  listening port: 10808\n\npeer: a=\n  allowed ips: 10.8.0.2/32\n\npeer: b=\n"
	if got := awgShowSummary(out); got != "listening port=10808 peers=2" {
		t.Fatalf("%q", got)
	}
}
