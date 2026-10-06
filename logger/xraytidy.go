package logger

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	xrayAccessRe = regexp.MustCompile(`^(?:\d{4}/\d\d/\d\d \d\d:\d\d:\d\d(?:\.\d+)? )?from (\S+) (accepted|rejected) (\S+) \[([^\]]+)\](?:\s+email:\s*(\S+))?`)
	xrayModuleRe = regexp.MustCompile(`^\[(\d+)\]\s+(.*)$`)
)

// TidyXrayMessage turns an xray log line into a readable journal message. It returns the message, the connection id when
// xray prints one ("[1234] module: text"), and drop=true for lines produced by the panel's own stats polling through
// the internal api inbound, which say nothing about user traffic.
func TidyXrayMessage(msg string) (clean, connID string, drop bool) {
	msg = strings.TrimSpace(msg)
	if m := xrayAccessRe.FindStringSubmatch(msg); m != nil {
		from, verdict, dest, route, email := m[1], m[2], m[3], m[4], m[5]
		if strings.HasPrefix(route, "api ") || strings.HasPrefix(route, "api->") {
			return "", "", true
		}
		out := fmt.Sprintf("%s %s from=%s route=%q", verdict, dest, from, strings.ReplaceAll(route, "->", "\u2192"))
		if email != "" {
			out += " email=" + email
		}
		return out, "", false
	}
	if m := xrayModuleRe.FindStringSubmatch(msg); m != nil {
		connID, msg = m[1], m[2]
	}
	// load balancer / monitoring probes open a TCP connection and close it at once; xray logs one line per probe (every 3 s
	// per balancer member) and nothing in it concerns a user
	if strings.Contains(msg, "likely health check connection") {
		return "", "", true
	}
	if strings.Contains(msg, "[api]") || strings.Contains(msg, "api -> api") ||
		(strings.Contains(msg, "proxy/dokodemo") && strings.Contains(msg, "127.0.0.1")) {
		return "", "", true
	}
	return msg, connID, false
}
