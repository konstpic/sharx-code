package sub

import "strings"

// leadingFlag returns the country flag emoji (a pair of regional indicator symbols) a text starts with, or "".
func leadingFlag(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) >= 2 && isRegionalIndicator(r[0]) && isRegionalIndicator(r[1]) {
		return string(r[:2])
	}
	return ""
}

func isRegionalIndicator(r rune) bool { return r >= 0x1F1E6 && r <= 0x1F1FF }

// withInboundFlag keeps the flag an admin set on the inbound (the name-flag selector in the inbound form) in the
// subscription name. The remark model decides which parts make up the name; a model without the inbound remark, or
// a host that replaces it, would otherwise drop the flag, and clients such as Happ show the flag of a link from its
// name. A name that already carries that flag, or has a flag of its own, is left alone.
func withInboundFlag(remark, inboundRemark string) string {
	flag := leadingFlag(inboundRemark)
	if flag == "" || remark == "" || strings.Contains(remark, flag) || leadingFlag(remark) != "" {
		return remark
	}
	return flag + " " + remark
}
