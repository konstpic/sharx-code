package sub

import (
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/util/hysteria"
)

// Hysteria2 carries its client port-hopping range in the URI authority
// ("hysteria2://auth@host:39640-39649/?...", official Port Hopping syntax).
// Go's net/url only accepts a numeric port, so every consumer that runs
// url.Parse on such a link (Clash/YAML conversion, INCY rewrite) has to
// collapse the range to one concrete port first. These helpers do that
// without touching the rest of the URI.

// splitHysteriaAuthority splits a link at its authority:
// prefix is "scheme://[userinfo@]", hostport is "host:port", suffix starts at
// "/", "?" or "#" (empty when absent).
func splitHysteriaAuthority(link string) (prefix, hostport, suffix string, ok bool) {
	idx := strings.Index(link, "://")
	if idx < 0 {
		return "", "", "", false
	}
	prefix = link[:idx+3]
	rest := link[idx+3:]
	end := strings.IndexAny(rest, "/?#")
	if end < 0 {
		end = len(rest)
	}
	authority, suffix := rest[:end], rest[end:]
	at := strings.LastIndex(authority, "@")
	if at >= 0 {
		return prefix + authority[:at+1], authority[at+1:], suffix, true
	}
	return prefix, authority, suffix, true
}

// hysteriaAuthorityPort returns the port token (possibly a "min-max" range) of
// a link's authority.
func hysteriaAuthorityPort(link string) (string, bool) {
	_, hostport, _, ok := splitHysteriaAuthority(link)
	if !ok {
		return "", false
	}
	colon := strings.LastIndex(hostport, ":")
	if colon < 0 || colon == len(hostport)-1 {
		return "", false
	}
	return hostport[colon+1:], true
}

// hysteriaMultiPortAuthority returns the parsed port range of a hysteria link.
func hysteriaMultiPortAuthority(link string) (hysteria.MultiPort, bool) {
	port, ok := hysteriaAuthorityPort(link)
	if !ok {
		return hysteria.MultiPort{}, false
	}
	return hysteria.ParseMultiPort(port)
}

// replaceHysteriaAuthorityPort rebuilds the link with a different authority port
// and keeps userinfo, host and the query/fragment untouched.
func replaceHysteriaAuthorityPort(link, port string) string {
	prefix, hostport, suffix, ok := splitHysteriaAuthority(link)
	if !ok {
		return link
	}
	colon := strings.LastIndex(hostport, ":")
	if colon < 0 {
		return link
	}
	return prefix + hostport[:colon+1] + port + suffix
}

// collapseHysteriaMultiPortLink rewrites a multi-port authority to its first
// port so net/url can parse the link. Any port of the range reaches the same
// inbound listener (the node redirects the whole range), so the collapsed link
// still connects; the hopping itself is lost. Links without a range are
// returned unchanged.
func collapseHysteriaMultiPortLink(link string) string {
	mp, ok := hysteriaMultiPortAuthority(link)
	if !ok {
		return link
	}
	return replaceHysteriaAuthorityPort(link, strconv.Itoa(mp.Min))
}

// hysteriaLinkAuthorityPort returns the authority port for a hysteria link:
// the multi-port range ("min-max") for version 2 with a stored range, the plain
// port for version 1 or an empty range. The range belongs to the URI authority
// (host:min-max); the official scheme has no query parameter for it.
func hysteriaLinkAuthorityPort(version int, stream map[string]interface{}, port int) string {
	if version == 1 {
		return strconv.Itoa(port)
	}
	if mp, ok := hysteria.MultiPortFromStream(stream); ok {
		return mp.String()
	}
	return strconv.Itoa(port)
}
