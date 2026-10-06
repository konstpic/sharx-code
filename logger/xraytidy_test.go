package logger

import "testing"

func TestTidyXrayMessage(t *testing.T) {
	cases := []struct {
		in, want, conn string
		drop           bool
	}{
		{"2026/10/06 19:35:47.252838 from 127.0.0.1:37190 accepted tcp:127.0.0.1:62789 [api -> api]", "", "", true},
		{"[3063578144] proxy/dokodemo: processing connection from: 127.0.0.1:37190", "", "", true},
		{"[518144434] app/dispatcher: taking detour [api] for [tcp:127.0.0.1:62789]", "", "", true},
		{"2026/10/06 19:35:47 from 1.2.3.4:5555 accepted tcp:example.com:443 [vless-in -> direct] email: alice", "accepted tcp:example.com:443 from=1.2.3.4:5555 route=\"vless-in \u2192 direct\" email=alice", "", false},
		{"[42] proxy/vless/inbound: firstLen = 5", "proxy/vless/inbound: firstLen = 5", "42", false},
		{"Xray 26.9.9 started", "Xray 26.9.9 started", "", false},
	}
	for _, c := range cases {
		got, conn, drop := TidyXrayMessage(c.in)
		if drop != c.drop || got != c.want || conn != c.conn {
			t.Errorf("%q: got (%q,%q,%v) want (%q,%q,%v)", c.in, got, conn, drop, c.want, c.conn, c.drop)
		}
	}
}
