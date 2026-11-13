// Package finalmask implements validation and normalization of the Xray-core
// streamSettings.finalmask block (transport masquerade layers).
//
// The same rules are used in two places:
//   - the panel, when an inbound is saved or an Xray inbound config is built;
//   - subscription emitters, which serialize the client-side view into the
//     `fm=<compact JSON>` share-link parameter (3x-ui compatible).
//
// Facts about the kernel behaviour this file relies on (Xray-core 26.10.31):
//   - TCP types: header-custom, fragment, sudoku, xmc
//   - UDP types: header-custom, mkcp-legacy, noise, salamander, sudoku, xdns,
//     xicmp, realm, udphop
//   - unknown type => "unknown config id: <type>" (config rejected)
//   - `type` is case-insensitive; settings keys unknown to the kernel are ignored
//   - the JSON array is applied in reverse order (first element = outermost layer)
//   - socket-replacing masks (xicmp, udphop) must be the last udp[] entry,
//     otherwise the kernel reports "incorrect index"
package finalmask

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
)

// Severity classifies a validation Issue.
type Severity string

const (
	// SeverityError issues make the configuration unusable (inbound save must fail).
	SeverityError Severity = "error"
	// SeverityWarning issues are tolerated, but worth surfacing to the operator.
	SeverityWarning Severity = "warning"
)

// Issue is a single finalmask validation finding.
type Issue struct {
	Code     string   `json:"code"`
	Path     string   `json:"path"`
	Severity Severity `json:"severity"`
	Message  string   `json:"message"`
}

func (i Issue) String() string {
	return fmt.Sprintf("%s: %s", i.Path, i.Message)
}

var tcpTypes = map[string]struct{}{
	"header-custom": {},
	"fragment":      {},
	"sudoku":        {},
	"xmc":           {},
}

var udpTypes = map[string]struct{}{
	"header-custom": {},
	"mkcp-legacy":   {},
	"noise":         {},
	"salamander":    {},
	"sudoku":        {},
	"xdns":          {},
	"xicmp":         {},
	"realm":         {},
	"udphop":        {},
}

// Link whitelist mirrors 3x-ui: masks that make sense in a client share link.
var linkTCPWhitelist = map[string]struct{}{
	"header-custom": {},
	"fragment":      {},
	"sudoku":        {},
	"xmc":           {},
}

var linkUDPWhitelist = map[string]struct{}{
	"salamander":    {},
	"udphop":        {},
	"sudoku":        {},
	"realm":         {},
	"header-custom": {},
}

// socketReplacingMasks must be the last udp[] entry in a valid config.
var socketReplacingMasks = map[string]struct{}{
	"xicmp":  {},
	"udphop": {},
}

// serverOnlyMasks lists masks that exist on the server side only and must not
// be emitted to clients. Xray-core 2026-10-31 does not ship any such mask yet
// (`filter` is not part of the upstream pinned core, see package docs).
var serverOnlyMasks = map[string]struct{}{}

// quicBoolKeys are the boolean quicParams fields known to the kernel. Any other
// boolean value is dropped during sanitizing.
var quicBoolKeys = map[string]struct{}{
	"debug":                         {},
	"brutalDisableLossCompensation": {},
	"disableChromeParrot":           {},
	"disableGSO":                    {},
	"disableStatelessReset":         {},
	"disablePathMTUDiscovery":       {},
}

// quicNumberRule describes the accepted integer range of a quicParams field.
// A value of 0 means "kernel default" and is always accepted.
type quicNumberRule struct {
	min int64
	max int64 // 0 = unbounded
}

var quicNumberRules = map[string]quicNumberRule{
	"maxIdleTimeout":              {min: 4, max: 120},
	"keepAlivePeriod":             {min: 2, max: 60},
	"initStreamReceiveWindow":     {min: 16384},
	"maxStreamReceiveWindow":      {min: 16384},
	"initConnectionReceiveWindow": {min: 16384},
	"maxConnectionReceiveWindow":  {min: 16384},
	"maxIncomingStreams":          {min: 8},
	"brutalUp":                    {min: 65536},
	"brutalDown":                  {min: 65536},
}

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_]{3,16}$`)

// IsKnownType reports whether typ is a finalmask type known to the kernel for
// the given transport ("tcp" or "udp").
func IsKnownType(transport, typ string) bool {
	t := strings.ToLower(strings.TrimSpace(typ))
	switch transport {
	case "tcp":
		_, ok := tcpTypes[t]
		return ok
	case "udp":
		_, ok := udpTypes[t]
		return ok
	default:
		return false
	}
}

// HasContent reports whether the finalmask object carries at least one mask or
// a non-empty quicParams block.
func HasContent(fm map[string]any) bool {
	if fm == nil {
		return false
	}
	for _, tr := range []string{"tcp", "udp"} {
		if arr, ok := fm[tr].([]any); ok && len(arr) > 0 {
			return true
		}
	}
	if qp, ok := fm["quicParams"].(map[string]any); ok && len(qp) > 0 {
		return true
	}
	return false
}

func hasErrorIssues(issues []Issue) bool {
	for _, is := range issues {
		if is.Severity == SeverityError {
			return true
		}
	}
	return false
}

func issue(code, path string, sev Severity, format string, args ...any) Issue {
	return Issue{Code: code, Path: path, Severity: sev, Message: fmt.Sprintf(format, args...)}
}

// Validate checks a streamSettings map's finalmask block. An absent or nil
// finalmask yields no issues. protocol is the inbound protocol id (used for
// protocol-specific warnings only).
func Validate(stream map[string]any, protocol string) []Issue {
	if stream == nil {
		return nil
	}
	raw, ok := stream["finalmask"]
	if !ok || raw == nil {
		return nil
	}
	fm, ok := raw.(map[string]any)
	if !ok {
		return []Issue{issue("finalmask_shape", "streamSettings.finalmask", SeverityError, "finalmask must be an object")}
	}

	var issues []Issue
	for k := range fm {
		switch k {
		case "tcp", "udp", "quicParams":
		default:
			issues = append(issues, issue("unknown_root_key", "streamSettings.finalmask."+k, SeverityWarning,
				"unknown finalmask key %q is ignored by the panel", k))
		}
	}

	for _, transport := range []string{"tcp", "udp"} {
		rawArr, exists := fm[transport]
		if !exists || rawArr == nil {
			continue
		}
		arr, ok := rawArr.([]any)
		if !ok {
			issues = append(issues, issue("finalmask_shape", "streamSettings.finalmask."+transport, SeverityError,
				"%s must be an array of {type, settings} objects", transport))
			continue
		}
		for i, item := range arr {
			issues = append(issues, validateElement(transport, i, item)...)
		}
		issues = append(issues, validateOrdering(transport, arr)...)
	}

	if rawQP, exists := fm["quicParams"]; exists && rawQP != nil {
		issues = append(issues, validateQuicParams(rawQP)...)
	}

	// Obfuscation masks (salamander) are hysteria obfuscation in practice; warn
	// instead of rejecting so that future kernel support is not blocked.
	if _, isHy := protocolIsHysteria(protocol); !isHy {
		if arr, ok := fm["udp"].([]any); ok {
			for i, item := range arr {
				el, ok := item.(map[string]any)
				if !ok {
					continue
				}
				if typeOf(el) == "salamander" {
					issues = append(issues, issue("salamander_non_hysteria",
						fmt.Sprintf("streamSettings.finalmask.udp[%d].type", i), SeverityWarning,
						"salamander is hysteria obfuscation; verify it is honoured by protocol %q", protocol))
				}
			}
		}
	}

	return issues
}

func protocolIsHysteria(p string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "hysteria", "hysteria2":
		return strings.ToLower(strings.TrimSpace(p)), true
	}
	return "", false
}

func validateElement(transport string, idx int, item any) []Issue {
	path := fmt.Sprintf("streamSettings.finalmask.%s[%d]", transport, idx)
	el, ok := item.(map[string]any)
	if !ok {
		return []Issue{issue("element_shape", path, SeverityError, "entry must be an object with type and settings")}
	}
	typ := typeOf(el)
	if typ == "" {
		return []Issue{issue("type_required", path+".type", SeverityError, "type is required")}
	}
	if !IsKnownType(transport, typ) {
		return []Issue{issue("unknown_type", path+".type", SeverityError,
			"unknown %s finalmask type %q (kernel rejects it as \"unknown config id\")", transport, typ)}
	}

	if rawSettings, exists := el["settings"]; exists && rawSettings != nil {
		if _, ok := rawSettings.(map[string]any); !ok {
			return []Issue{issue("settings_shape", path+".settings", SeverityError, "settings must be an object")}
		}
	}
	st := settingsOf(el)

	switch typ {
	case "fragment":
		return validateFragment(path, st)
	case "xmc":
		return validateXMC(path, st)
	case "salamander":
		return validateSalamander(path, el, st)
	case "xdns":
		return validateXDNS(path, st)
	case "realm":
		return validateRealm(path, st)
	case "udphop":
		return validateUDPHop(path, el, st, transport)
	case "header-custom":
		if transport == "tcp" {
			return validateHeaderCustomTCP(path, st)
		}
		return validateHeaderCustomUDP(path, st)
	case "mkcp-legacy":
		return validateMKCPLegacy(path, el, st)
	case "noise":
		return validateNoise(path, el, st)
	case "sudoku":
		return validateSudoku(path, el, st)
	case "xicmp":
		return nil
	}
	return nil
}

func validateOrdering(transport string, arr []any) []Issue {
	if transport != "udp" {
		return nil
	}
	var issues []Issue
	var socketIdx []int
	for i, item := range arr {
		el, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if _, isSocket := socketReplacingMasks[typeOf(el)]; isSocket {
			socketIdx = append(socketIdx, i)
		}
	}
	if len(socketIdx) > 1 {
		issues = append(issues, issue("multiple_socket_masks", "streamSettings.finalmask.udp", SeverityError,
			"only one socket-replacing mask (xicmp/udphop) is allowed, found %d", len(socketIdx)))
	}
	for _, i := range socketIdx {
		if i != len(arr)-1 {
			issues = append(issues, issue("socket_mask_order", fmt.Sprintf("streamSettings.finalmask.udp[%d]", i), SeverityError,
				"socket-replacing mask must be the last udp entry, otherwise the kernel reports \"incorrect index\""))
		}
	}
	return issues
}

func validateFragment(path string, st map[string]any) []Issue {
	var issues []Issue
	lengthsRaw, hasLengths := st["lengths"]
	if hasLengths && lengthsRaw != nil {
		// The kernel expects []Int32Range; a bare string ("100-200") is rejected.
		if _, ok := lengthsRaw.([]any); !ok {
			issues = append(issues, issue("fragment_lengths_type", path+".settings.lengths", SeverityError,
				"lengths must be an array of ranges/numbers, not a string"))
			return issues
		}
	}
	if delaysRaw, ok := st["delays"]; ok && delaysRaw != nil {
		if _, ok := delaysRaw.([]any); !ok {
			issues = append(issues, issue("fragment_delays_type", path+".settings.delays", SeverityError,
				"delays must be an array of ranges/numbers, not a string"))
			return issues
		}
	}
	minLen, hasLen := minNumber(st["lengths"])
	if !hasLen {
		minLen, hasLen = minNumber(st["length"])
	}
	if !hasLen {
		issues = append(issues, issue("fragment_lengths_required", path+".settings.lengths", SeverityError,
			"fragment requires lengths (or legacy length), e.g. [\"100-200\"]"))
	} else if minLen <= 0 {
		issues = append(issues, issue("fragment_lengths_min", path+".settings.lengths", SeverityError,
			"fragment lengths min must be greater than 0 (kernel: \"last lengths entry min can't be 0\")"))
	}
	if hasDelays, ok := minNumberExists(st["delays"]); ok {
		if hasDelays < 0 {
			issues = append(issues, issue("fragment_delays_min", path+".settings.delays", SeverityError,
				"fragment delays must not be negative"))
		}
	} else if d, ok := minNumberExists(st["delay"]); ok && d < 0 {
		issues = append(issues, issue("fragment_delays_min", path+".settings.delay", SeverityError,
			"fragment delay must not be negative"))
	}
	return issues
}

func validateXMC(path string, st map[string]any) []Issue {
	var issues []Issue
	if strings.TrimSpace(strValue(st["hostname"])) == "" {
		issues = append(issues, issue("xmc_hostname_required", path+".settings.hostname", SeverityError,
			"xmc requires hostname"))
	}
	if strings.TrimSpace(strValue(st["password"])) == "" {
		issues = append(issues, issue("xmc_password_required", path+".settings.password", SeverityError,
			"xmc requires password"))
	}
	profiles, ok := st["profiles"].([]any)
	if !ok || len(profiles) == 0 {
		issues = append(issues, issue("xmc_profiles_required", path+".settings.profiles", SeverityError,
			"xmc requires at least one profile (kernel: \"minecraft profiles are required\")"))
		return issues
	}
	for i, p := range profiles {
		pm, ok := p.(map[string]any)
		ppath := fmt.Sprintf("%s.settings.profiles[%d]", path, i)
		if !ok {
			issues = append(issues, issue("xmc_profile_shape", ppath, SeverityError, "profile must be an object"))
			continue
		}
		user := strings.TrimSpace(strValue(pm["username"]))
		if !usernameRe.MatchString(user) {
			issues = append(issues, issue("xmc_profile_username", ppath+".username", SeverityError,
				"username must be 3-16 characters of [A-Za-z0-9_]"))
		}
		if strings.TrimSpace(strValue(pm["uuid"])) == "" {
			issues = append(issues, issue("xmc_profile_uuid", ppath+".uuid", SeverityError, "uuid is required"))
		}
	}
	return issues
}

func validateSalamander(path string, el, st map[string]any) []Issue {
	pwd := strings.TrimSpace(strValue(st["password"]))
	if pwd == "" {
		pwd = strings.TrimSpace(strValue(el["password"]))
	}
	if len([]byte(pwd)) < 4 {
		return []Issue{issue("salamander_password", path+".settings.password", SeverityError,
			"salamander requires a PSK of at least 4 bytes")}
	}
	return nil
}

func validateXDNS(path string, st map[string]any) []Issue {
	domains, ok := st["domains"].([]any)
	if !ok || len(domains) == 0 {
		return []Issue{issue("xdns_domains_required", path+".settings.domains", SeverityError,
			"xdns requires at least one domain entry")}
	}
	var issues []Issue
	for i, d := range domains {
		dm, ok := d.(map[string]any)
		dpath := fmt.Sprintf("%s.settings.domains[%d]", path, i)
		if !ok {
			issues = append(issues, issue("xdns_domain_shape", dpath, SeverityError, "domain entry must be an object"))
			continue
		}
		names, ok := dm["names"].([]any)
		if !ok || len(names) == 0 {
			issues = append(issues, issue("xdns_names_required", dpath+".names", SeverityError,
				"names must be a non-empty array of domain names"))
			continue
		}
		valid := false
		for _, n := range names {
			if strings.TrimSpace(strValue(n)) != "" {
				valid = true
				break
			}
		}
		if !valid {
			issues = append(issues, issue("xdns_names_required", dpath+".names", SeverityError,
				"names must contain at least one non-empty domain name"))
		}
	}
	return issues
}

func validateRealm(path string, st map[string]any) []Issue {
	var issues []Issue
	u := strings.ToLower(strings.TrimSpace(strValue(st["url"])))
	if u == "" {
		issues = append(issues, issue("realm_url_required", path+".settings.url", SeverityError,
			"realm requires url (realm:// or realm+http:// scheme)"))
	} else if !strings.HasPrefix(u, "realm://") && !strings.HasPrefix(u, "realm+http://") {
		issues = append(issues, issue("realm_url_scheme", path+".settings.url", SeverityError,
			"realm url must use the realm:// or realm+http:// scheme"))
	}
	stun, ok := st["stunServers"].([]any)
	if !ok || len(stun) == 0 {
		issues = append(issues, issue("realm_stun_required", path+".settings.stunServers", SeverityError,
			"realm requires stunServers"))
	}
	return issues
}

func validateUDPHop(path string, el, st map[string]any, transport string) []Issue {
	var issues []Issue
	if transport != "udp" {
		// Already reported as an unknown type for tcp.
		return nil
	}
	issues = append(issues, issue("udphop_client_only", path+".type", SeverityError,
		"udphop is a client-only mask and cannot be used in an inbound"))
	if interval, ok := numberValue(firstNonNil(st["interval"], el["interval"])); ok {
		if interval < 5 {
			issues = append(issues, issue("udphop_interval", path+".settings.interval", SeverityError,
				"udphop interval must be at least 5 seconds"))
		}
	} else {
		issues = append(issues, issue("udphop_interval", path+".settings.interval", SeverityError,
			"udphop requires interval (>= 5 seconds)"))
	}
	if !hasNonEmptyList(firstNonNil(st["remoteIPs"], el["remoteIPs"])) {
		issues = append(issues, issue("udphop_remote_ips", path+".settings.remoteIPs", SeverityError,
			"udphop requires a non-empty remoteIPs list"))
	}
	if !hasNonEmptyList(firstNonNil(st["remotePorts"], el["remotePorts"])) {
		issues = append(issues, issue("udphop_remote_ports", path+".settings.remotePorts", SeverityError,
			"udphop requires a non-empty remotePorts list"))
	}
	return issues
}

// headerCustomItemMechanisms are the per-item mechanisms of header-custom.
var headerCustomItemMechanisms = []string{"packet", "rand", "reuse", "transform"}

// headerCustomItemTypes are the kernel-accepted TCPItem type values.
var headerCustomItemTypes = map[string]struct{}{
	"":       {},
	"str":    {},
	"hex":    {},
	"base64": {},
}

// validateHeaderCustomTCP mirrors the kernel schema:
// settings = {clients: [][]TCPItem, servers: [][]TCPItem, errors: [][]TCPItem}.
func validateHeaderCustomTCP(path string, st map[string]any) []Issue {
	var issues []Issue
	nonEmpty := false
	for _, stream := range []string{"clients", "servers"} {
		v, exists := st[stream]
		if !exists || v == nil {
			continue
		}
		groups, ok := v.([]any)
		if !ok {
			issues = append(issues, issue("header_custom_tcp_schema", path+".settings."+stream, SeverityError,
				"%s must be an array of item arrays", stream))
			continue
		}
		if len(groups) > 0 {
			nonEmpty = true
		}
		for gi, group := range groups {
			items, ok := group.([]any)
			gpath := fmt.Sprintf("%s.settings.%s[%d]", path, stream, gi)
			if !ok {
				issues = append(issues, issue("header_custom_tcp_schema", gpath, SeverityError,
					"each %s entry must be an array of items", stream))
				continue
			}
			for ii, item := range items {
				ipath := fmt.Sprintf("%s[%d]", gpath, ii)
				im, ok := item.(map[string]any)
				if !ok {
					issues = append(issues, issue("header_custom_tcp_item", ipath, SeverityError,
						"header-custom item must be an object"))
					continue
				}
				if !hasAnyHeaderCustomMechanism(im) {
					issues = append(issues, issue("header_custom_tcp_item", ipath, SeverityError,
						"header-custom item requires at least one of packet/rand/reuse/transform"))
				}
				if typ, exists := im["type"]; exists {
					if _, ok := headerCustomItemTypes[strings.ToLower(strings.TrimSpace(strValue(typ)))]; !ok {
						issues = append(issues, issue("header_custom_tcp_item_type", ipath+".type", SeverityError,
							"item type must be one of \"\", str, hex, base64"))
					}
				}
			}
		}
	}
	if len(issues) == 0 && !nonEmpty {
		issues = append(issues, issue("header_custom_tcp_schema", path+".settings", SeverityError,
			"tcp header-custom requires at least one clients/servers item"))
	}
	return issues
}

func hasAnyHeaderCustomMechanism(im map[string]any) bool {
	for _, key := range headerCustomItemMechanisms {
		if nonEmptyValue(im[key]) {
			return true
		}
	}
	return false
}

// validateHeaderCustomUDP mirrors the kernel schema:
// settings = {mode: ""|prefix|standalone, client: [UDPItem], server: [UDPItem]}.
func validateHeaderCustomUDP(path string, st map[string]any) []Issue {
	var issues []Issue
	mode := strings.ToLower(strings.TrimSpace(strValue(st["mode"])))
	switch mode {
	case "", "prefix", "standalone":
	default:
		issues = append(issues, issue("header_custom_udp_mode", path+".settings.mode", SeverityError,
			"udp header-custom mode must be one of \"\", prefix, standalone"))
	}
	for _, key := range []string{"client", "server"} {
		v, exists := st[key]
		if !exists || v == nil {
			continue
		}
		items, ok := v.([]any)
		if !ok {
			issues = append(issues, issue("header_custom_udp_schema", path+".settings."+key, SeverityError,
				"%s must be an array of items", key))
			continue
		}
		for i, item := range items {
			ipath := fmt.Sprintf("%s.settings.%s[%d]", path, key, i)
			if _, ok := item.(map[string]any); !ok {
				issues = append(issues, issue("header_custom_udp_item", ipath, SeverityError,
					"header-custom item must be an object"))
			}
		}
	}
	return issues
}

func validateMKCPLegacy(path string, el, st map[string]any) []Issue {
	header := strings.ToLower(strings.TrimSpace(strValue(firstNonNil(st["header"], el["header"]))))
	value := strings.ToLower(strings.TrimSpace(strValue(firstNonNil(st["value"], el["value"]))))
	if header == "" && value == "" {
		// Kernel default (aes128gcm-default) needs neither header nor value.
		return nil
	}
	switch header {
	case "dns", "dtls", "srtp", "utp", "wechat", "wireguard":
		return nil
	}
	return []Issue{issue("mkcp_legacy_header", path+".settings.header", SeverityError,
		"mkcp-legacy header must be empty (aes128gcm-default) or one of dns, dtls, srtp, utp, wechat, wireguard")}
}

func validateNoise(path string, el, st map[string]any) []Issue {
	raw := firstNonNil(st["noise"], el["noise"])
	list, ok := raw.([]any)
	if !ok || len(list) == 0 {
		return []Issue{issue("noise_list_required", path+".settings.noise", SeverityError,
			"noise requires a non-empty noise[] list")}
	}
	var issues []Issue
	for i, item := range list {
		npath := fmt.Sprintf("%s.settings.noise[%d]", path, i)
		im, ok := item.(map[string]any)
		if !ok {
			issues = append(issues, issue("noise_item_shape", npath, SeverityError, "noise item must be an object"))
			continue
		}
		typ := strings.ToLower(strings.TrimSpace(strValue(im["type"])))
		switch typ {
		case "", "str", "hex", "base64", "exp":
		default:
			issues = append(issues, issue("noise_item_type", npath+".type", SeverityError,
				"noise item type must be one of \"\", str, hex, base64, exp"))
			continue
		}
		packet := strings.TrimSpace(strValue(im["packet"]))
		if packet == "" {
			// rand/randRange generate the packet at runtime; only a fully empty
			// item is invalid.
			if nonEmptyValue(im["rand"]) || nonEmptyValue(im["randRange"]) {
				continue
			}
			issues = append(issues, issue("noise_item_packet", npath+".packet", SeverityError,
				"noise item requires packet, rand or randRange"))
			continue
		}
		if typ == "exp" && !noiseExpPacketRe.MatchString(packet) {
			issues = append(issues, issue("noise_exp_packet", npath+".packet", SeverityWarning,
				"exp packet does not match the \"<...>\" syntax and may be rejected by the kernel"))
		}
	}
	return issues
}

// noiseExpPacketRe matches the kernel noise "exp" packet syntax: an expression
// wrapped in angle brackets, e.g. "<t:2s,rand:8-16>".
var noiseExpPacketRe = regexp.MustCompile(`^<[^<>]+>$`)

func validateSudoku(path string, el, st map[string]any) []Issue {
	pwd := strings.TrimSpace(strValue(firstNonNil(st["password"], el["password"])))
	if pwd == "" {
		return []Issue{issue("sudoku_password_required", path+".settings.password", SeverityError,
			"sudoku requires password")}
	}
	return nil
}

func validateQuicParams(raw any) []Issue {
	qp, ok := raw.(map[string]any)
	if !ok {
		return []Issue{issue("quic_params_shape", "streamSettings.finalmask.quicParams", SeverityError,
			"quicParams must be an object")}
	}
	var issues []Issue
	const qpPath = "streamSettings.finalmask.quicParams"
	if v, exists := qp["congestion"]; exists {
		s := strings.ToLower(strings.TrimSpace(strValue(v)))
		switch s {
		case "", "reno", "bbr", "brutal", "force-brutal":
		default:
			issues = append(issues, issue("quic_congestion", qpPath+".congestion", SeverityError,
				"congestion must be one of reno, bbr, brutal, force-brutal"))
		}
	}
	if v, exists := qp["bbrProfile"]; exists {
		s := strings.ToLower(strings.TrimSpace(strValue(v)))
		switch s {
		case "", "conservative", "standard", "aggressive":
		default:
			issues = append(issues, issue("quic_bbr_profile", qpPath+".bbrProfile", SeverityError,
				"bbrProfile must be one of conservative, standard, aggressive"))
		}
	}
	for k, rule := range quicNumberRules {
		v, exists := qp[k]
		if !exists || v == nil {
			continue
		}
		n, ok := numberValue(v)
		if !ok {
			issues = append(issues, issue("quic_number_type", qpPath+"."+k, SeverityError,
				"%s must be a number", k))
			continue
		}
		if n != math.Trunc(n) {
			issues = append(issues, issue("quic_number_integer", qpPath+"."+k, SeverityError,
				"%s must be an integer", k))
			continue
		}
		iv := int64(n)
		if iv == 0 {
			// 0 means "kernel default" for every numeric quicParams field.
			continue
		}
		if iv < rule.min || (rule.max != 0 && iv > rule.max) {
			if rule.max != 0 {
				issues = append(issues, issue("quic_number_range", qpPath+"."+k, SeverityError,
					"%s must be 0 or between %d and %d", k, rule.min, rule.max))
			} else {
				issues = append(issues, issue("quic_number_range", qpPath+"."+k, SeverityError,
					"%s must be 0 or at least %d", k, rule.min))
			}
		}
	}
	for k := range quicBoolKeys {
		v, exists := qp[k]
		if !exists || v == nil {
			continue
		}
		if _, ok := v.(bool); !ok {
			issues = append(issues, issue("quic_bool_type", qpPath+"."+k, SeverityError,
				"%s must be a boolean", k))
		}
	}
	if s := strings.ToLower(strings.TrimSpace(strValue(qp["congestion"]))); s == "force-brutal" {
		up, _ := numberValue(qp["brutalUp"])
		if up <= 0 {
			issues = append(issues, issue("quic_brutal_up_required", qpPath+".brutalUp", SeverityError,
				"congestion force-brutal requires brutalUp"))
		}
	}
	return issues
}

// Normalize returns a new streamSettings map where finalmask is normalized:
// types are lowercased, legacy fragment ranges are duplicated into
// length/delay, udphop ordering/uniqueness is enforced, quicParams are
// sanitized and (client side only) server-only masks are dropped. The input
// map and its nested values are never mutated. An empty finalmask is removed.
func Normalize(stream map[string]any, serverSide bool) map[string]any {
	if stream == nil {
		return nil
	}
	out := make(map[string]any, len(stream))
	for k, v := range stream {
		out[k] = v
	}
	raw, ok := stream["finalmask"]
	if !ok || raw == nil {
		return out
	}
	fm, ok := raw.(map[string]any)
	if !ok {
		return out
	}
	norm := NormalizeFinalmask(fm, serverSide)
	if !HasContent(norm) {
		delete(out, "finalmask")
		return out
	}
	out["finalmask"] = norm
	return out
}

// NormalizeFinalmask normalizes a finalmask object and returns a new map.
func NormalizeFinalmask(fm map[string]any, serverSide bool) map[string]any {
	if fm == nil {
		return nil
	}
	cp, ok := deepCopyMap(fm)
	if !ok {
		return nil
	}
	cp = withLegacyFragmentRangesInto(cp)
	cp = migrateLegacyPassword(cp)
	cp = NormalizeUDPHop(cp)
	if !serverSide {
		cp = DropServerOnly(cp)
	}
	cp = SanitizeQuicParams(cp)
	return cp
}

// LegacyFragmentRanges duplicates the last lengths[]/delays[] entry into the
// legacy length/delay fields (3x-ui withLegacyFragmentRanges behaviour).
// The input map is not mutated.
func LegacyFragmentRanges(fm map[string]any) map[string]any {
	cp, ok := deepCopyMap(fm)
	if !ok {
		return nil
	}
	return withLegacyFragmentRangesInto(cp)
}

func withLegacyFragmentRangesInto(fm map[string]any) map[string]any {
	if fm == nil {
		return fm
	}
	for _, transport := range []string{"tcp", "udp"} {
		arr, ok := fm[transport].([]any)
		if !ok {
			continue
		}
		for _, item := range arr {
			el, ok := item.(map[string]any)
			if !ok {
				continue
			}
			typ := strings.ToLower(strings.TrimSpace(strValue(el["type"])))
			el["type"] = typ
			if typ != "fragment" {
				continue
			}
			st, ok := el["settings"].(map[string]any)
			if !ok {
				continue
			}
			if _, has := st["length"]; !has {
				if last, ok := lastElement(st["lengths"]); ok {
					st["length"] = last
				}
			}
			if _, has := st["delay"]; !has {
				if last, ok := lastElement(st["delays"]); ok {
					st["delay"] = last
				}
			}
		}
	}
	return fm
}

// migrateLegacyPassword lifts an element-level legacy `password` into
// settings.password (salamander, xmc, sudoku, ...) so the emitted mask actually
// works. It mutates and returns fm (callers pass a copy).
func migrateLegacyPassword(fm map[string]any) map[string]any {
	for _, transport := range []string{"tcp", "udp"} {
		arr, ok := fm[transport].([]any)
		if !ok {
			continue
		}
		for _, item := range arr {
			el, ok := item.(map[string]any)
			if !ok {
				continue
			}
			legacy := strings.TrimSpace(strValue(el["password"]))
			if legacy == "" {
				continue
			}
			st, ok := el["settings"].(map[string]any)
			if !ok {
				st = map[string]any{}
				el["settings"] = st
			}
			if strings.TrimSpace(strValue(st["password"])) == "" {
				st["password"] = legacy
			}
			// settings.password is the kernel schema; drop the legacy duplicate.
			delete(el, "password")
		}
	}
	return fm
}

// NormalizeUDPHop ensures at most one socket-replacing mask exists and that it
// is the last udp[] entry. It mutates and returns fm (callers pass a copy).
func NormalizeUDPHop(fm map[string]any) map[string]any {
	if fm == nil {
		return nil
	}
	arr, ok := fm["udp"].([]any)
	if !ok || len(arr) == 0 {
		return fm
	}
	lastSocket := -1
	for i, item := range arr {
		el, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if _, isSocket := socketReplacingMasks[typeOf(el)]; isSocket {
			lastSocket = i
		}
	}
	if lastSocket < 0 {
		return fm
	}
	kept := arr[lastSocket]
	out := make([]any, 0, len(arr))
	for i, item := range arr {
		el, ok := item.(map[string]any)
		if ok {
			if _, isSocket := socketReplacingMasks[typeOf(el)]; isSocket && i != lastSocket {
				continue
			}
		}
		if i == lastSocket {
			continue
		}
		out = append(out, item)
	}
	out = append(out, kept)
	fm["udp"] = out
	return fm
}

// SanitizeQuicParams normalizes quicParams for emission: integral numbers are
// converted to int64, fractional/negative numbers, unknown booleans and unknown
// strings are dropped (0 is a valid "kernel default"), and the block is removed
// when nothing is left. It mutates and returns fm (callers pass a copy).
func SanitizeQuicParams(fm map[string]any) map[string]any {
	if fm == nil {
		return nil
	}
	qp, ok := fm["quicParams"].(map[string]any)
	if !ok {
		return fm
	}
	for k, v := range qp {
		switch n := v.(type) {
		case float64:
			if n < 0 || n != math.Trunc(n) {
				delete(qp, k)
				continue
			}
			qp[k] = int64(n)
		case float32:
			f := float64(n)
			if f < 0 || f != math.Trunc(f) {
				delete(qp, k)
				continue
			}
			qp[k] = int64(f)
		case int:
			if n < 0 {
				delete(qp, k)
			}
		case int64:
			if n < 0 {
				delete(qp, k)
			}
		case bool:
			if _, allowed := quicBoolKeys[k]; !allowed {
				delete(qp, k)
			}
		case string:
			s := strings.ToLower(strings.TrimSpace(n))
			switch k {
			case "congestion", "bbrProfile":
				if s == "" {
					delete(qp, k)
				} else {
					qp[k] = strings.TrimSpace(n)
				}
			default:
				delete(qp, k)
			}
		case nil:
			delete(qp, k)
		default:
			delete(qp, k)
		}
	}
	if len(qp) == 0 {
		delete(fm, "quicParams")
	}
	return fm
}

// DropServerOnly removes masks listed in serverOnlyMasks from both transports.
// The list is currently empty (no server-only type in the pinned kernel), so it
// is a no-op kept for the 3x-ui compatibility chain.
// It mutates and returns fm (callers pass a copy).
func DropServerOnly(fm map[string]any) map[string]any {
	if fm == nil {
		return nil
	}
	for _, transport := range []string{"tcp", "udp"} {
		arr, ok := fm[transport].([]any)
		if !ok {
			continue
		}
		out := make([]any, 0, len(arr))
		for _, item := range arr {
			el, ok := item.(map[string]any)
			if ok {
				if _, serverOnly := serverOnlyMasks[typeOf(el)]; serverOnly {
					continue
				}
			}
			out = append(out, item)
		}
		if len(out) == 0 {
			delete(fm, transport)
		} else {
			fm[transport] = out
		}
	}
	return fm
}

// Marshal serializes the client-side view of a finalmask object into the
// compact JSON carried by share-link `fm=` parameters (3x-ui compatible).
// It returns false when nothing of the whitelist survives.
func Marshal(fm map[string]any) (string, bool) {
	if fm == nil {
		return "", false
	}
	cp, ok := deepCopyMap(fm)
	if !ok {
		return "", false
	}
	cp = withLegacyFragmentRangesInto(cp)
	cp = migrateLegacyPassword(cp)
	cp = NormalizeUDPHop(cp)
	cp = DropServerOnly(cp)
	cp = SanitizeQuicParams(cp)
	cp = linkWhitelist(cp)
	if !HasContent(cp) {
		return "", false
	}
	b, err := json.Marshal(cp)
	if err != nil {
		return "", false
	}
	return string(b), true
}

func linkWhitelist(fm map[string]any) map[string]any {
	for k := range fm {
		switch k {
		case "tcp", "udp", "quicParams":
		default:
			delete(fm, k)
		}
	}
	for transport, allow := range map[string]map[string]struct{}{"tcp": linkTCPWhitelist, "udp": linkUDPWhitelist} {
		arr, ok := fm[transport].([]any)
		if !ok {
			continue
		}
		out := make([]any, 0, len(arr))
		for _, item := range arr {
			el, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if _, allowed := allow[typeOf(el)]; allowed {
				out = append(out, item)
			}
		}
		if len(out) == 0 {
			delete(fm, transport)
		} else {
			fm[transport] = out
		}
	}
	return fm
}

// DropInvalidElements removes tcp/udp entries that fail validation for the
// given protocol. It is a safety net for configs stored before validation
// existed; the input map is not mutated. Returns the new stream map and the
// number of dropped entries.
func DropInvalidElements(stream map[string]any, protocol string) (map[string]any, int) {
	if stream == nil {
		return nil, 0
	}
	out := make(map[string]any, len(stream))
	for k, v := range stream {
		out[k] = v
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok || fm == nil {
		return out, 0
	}
	cp, ok := deepCopyMap(fm)
	if !ok {
		return out, 0
	}
	dropped := 0
	for _, transport := range []string{"tcp", "udp"} {
		arr, ok := cp[transport].([]any)
		if !ok {
			continue
		}
		kept := make([]any, 0, len(arr))
		for _, item := range arr {
			probe := map[string]any{"finalmask": map[string]any{transport: []any{item}}}
			if hasErrorIssues(Validate(probe, protocol)) {
				dropped++
				continue
			}
			kept = append(kept, item)
		}
		if len(kept) == 0 {
			delete(cp, transport)
		} else {
			cp[transport] = kept
		}
	}
	if !HasContent(cp) {
		delete(out, "finalmask")
	} else {
		out["finalmask"] = cp
	}
	return out, dropped
}

// ---- helpers ----

func typeOf(el map[string]any) string {
	s, _ := el["type"].(string)
	return strings.ToLower(strings.TrimSpace(s))
}

func settingsOf(el map[string]any) map[string]any {
	if st, ok := el["settings"].(map[string]any); ok {
		return st
	}
	return map[string]any{}
}

func firstNonNil(values ...any) any {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

func strValue(v any) string {
	s, _ := v.(string)
	return s
}

func nonEmptyValue(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(t) != ""
	case bool:
		return t
	case map[string]any:
		return len(t) > 0
	case []any:
		return len(t) > 0
	case float64:
		return true
	case int:
		return true
	case int64:
		return true
	default:
		return false
	}
}

func hasNonEmptyList(v any) bool {
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			if strings.TrimSpace(strValue(item)) != "" || numberOrString(item) != "" {
				return true
			}
		}
		return false
	case string:
		return strings.TrimSpace(t) != ""
	default:
		return false
	}
}

func numberOrString(v any) string {
	if n, ok := numberValue(v); ok {
		return fmt.Sprintf("%v", n)
	}
	return ""
}

func numberValue(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// minNumber parses a fragment lengths/delays value: a number, a numeric
// string, a "min-max" range, a comma separated list of such items, or an
// array of them. It returns the smallest value found.
func minNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case []any:
		var min float64
		found := false
		for _, item := range t {
			n, ok := minNumber(item)
			if !ok {
				continue
			}
			if !found || n < min {
				min, found = n, true
			}
		}
		return min, found
	case string:
		return minFromString(t)
	default:
		if n, ok := numberValue(v); ok {
			return n, true
		}
		return 0, false
	}
}

func minNumberExists(v any) (float64, bool) {
	if v == nil {
		return 0, false
	}
	return minNumber(v)
}

func minFromString(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	found := false
	var min float64
	for _, part := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ';' }) {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		bounds := strings.SplitN(part, "-", 2)
		for _, b := range bounds {
			b = strings.TrimSpace(b)
			if b == "" {
				continue
			}
			var n float64
			if _, err := fmt.Sscanf(b, "%f", &n); err != nil {
				continue
			}
			if !found || n < min {
				min, found = n, true
			}
		}
	}
	return min, found
}

func lastElement(v any) (any, bool) {
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 {
		return nil, false
	}
	return arr[len(arr)-1], true
}

func deepCopyMap(m map[string]any) (map[string]any, bool) {
	b, err := json.Marshal(m)
	if err != nil {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, false
	}
	return out, true
}
