package telemt

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/logger"
)

func TestTelemtLineLevel(t *testing.T) {
	cases := map[string]string{
		"2026-10-06T19:24:58Z  INFO telemt::transport::middle_proxy::handshake: RPC handshake OK":                                                   "debug",
		"2026-10-06T19:24:58Z  INFO telemt::proxy: listening on 0.0.0.0:443":                                                                        "info",
		"2026-10-06T19:24:58Z  WARN telemt::transport::middle_proxy::health::idle_refresh: Idle writer refreshed before upstream idle timeout dc=4": "debug",
		"2026-10-06T19:24:58Z  WARN telemt::proxy: slow upstream":                                                                                   "warn",
		"2026-10-06T19:24:58Z ERROR telemt::proxy: accept failed":                                                                                   "error",
	}
	for line, want := range cases {
		e := logger.Entry{Level: "info"}
		telemtLineLevel(line, &e)
		if e.Level != want {
			t.Errorf("%q: got %s want %s", line, e.Level, want)
		}
	}
}

func TestTelemtLineCleansPrefix(t *testing.T) {
	e := logger.Entry{}
	telemtLineLevel("2026-10-06T19:26:31.980391Z  WARN telemt::transport::middle_proxy::health::idle_refresh: Idle writer refreshed before upstream idle timeout dc=4 family=V4", &e)
	if e.Msg != "health::idle_refresh: Idle writer refreshed before upstream idle timeout dc=4 family=V4" {
		t.Fatalf("%q", e.Msg)
	}
}
