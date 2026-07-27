package sub

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

var amneziaWGConfKeys = []string{
	"Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4",
	"H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5",
	"HeaderProtectionKey", "ContentPaddingAddition",
	"RekeyAfterTime", "RekeyTimeout", "RejectAfterTime",
	"KeepaliveTimeout", "MaxHandshakeAttempts",
}

type wgQuickFields struct {
	privateKey   string
	address      string
	mtu          string
	publicKey    string
	endpoint     string
	presharedKey string
}

func parseWgQuickConf(conf string) wgQuickFields {
	var out wgQuickFields
	section := ""
	for _, line := range strings.Split(conf, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			section = strings.ToLower(strings.Trim(trimmed, "[]"))
			continue
		}
		key, val, ok := strings.Cut(trimmed, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch section {
		case "interface":
			switch key {
			case "PrivateKey":
				out.privateKey = val
			case "Address":
				out.address = val
			case "MTU":
				out.mtu = val
			}
		case "peer":
			switch key {
			case "PublicKey":
				out.publicKey = val
			case "Endpoint":
				out.endpoint = val
			case "PresharedKey":
				out.presharedKey = val
			}
		}
	}
	return out
}

func isAmneziaWGConf(conf string) bool {
	for _, line := range strings.Split(conf, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		key, _, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		for _, awgKey := range amneziaWGConfKeys {
			if key == awgKey {
				return true
			}
		}
	}
	return false
}

func splitWgEndpoint(endpoint string) (host string, port int, ok bool) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", 0, false
	}
	host, portStr, err := net.SplitHostPort(endpoint)
	if err != nil {
		return endpoint, 51820, true
	}
	portNum, err := strconv.Atoi(portStr)
	if err != nil || portNum <= 0 {
		return "", 0, false
	}
	return host, portNum, true
}

func amneziawgShareLinkFromConf(conf, remark, serverDescription string) string {
	conf = strings.TrimSpace(conf)
	if conf == "" {
		return ""
	}
	encoded := base64.RawURLEncoding.EncodeToString([]byte(conf))
	frag := FormatShareLinkFragment(remark, serverDescription)
	return fmt.Sprintf("amneziawg://%s#%s", encoded, frag)
}

func wireguardShareLinkFromConf(conf, remark, serverDescription string) string {
	fields := parseWgQuickConf(conf)
	if fields.privateKey == "" || fields.publicKey == "" {
		return ""
	}
	host, port, ok := splitWgEndpoint(fields.endpoint)
	if !ok || host == "" {
		return ""
	}

	u := &url.URL{
		Scheme: "wireguard",
		Host:   net.JoinHostPort(host, strconv.Itoa(port)),
		User:   url.User(fields.privateKey),
	}
	q := u.Query()
	q.Set("publickey", fields.publicKey)
	if fields.address != "" {
		q.Set("address", fields.address)
	}
	if fields.mtu != "" {
		q.Set("mtu", fields.mtu)
	}
	u.RawQuery = q.Encode()
	u.Fragment = FormatShareLinkFragment(remark, serverDescription)
	return u.String()
}

func wireGuardShareLinkFromPanelInfo(panelText string) string {
	conf := strings.TrimSpace(wireguardConfBlockFromPanelInfo(panelText))
	conf = trimWireguardConfBlock(conf)
	if conf == "" {
		return ""
	}
	remark := subscriptionRemarkFromPanelInfo(panelText)
	desc := subscriptionServerDescriptionFromPanelInfo(panelText)
	if isAmneziaWGConf(conf) || strings.Contains(strings.ToLower(panelText), "amneziawg") {
		return amneziawgShareLinkFromConf(conf, remark, desc)
	}
	return wireguardShareLinkFromConf(conf, remark, desc)
}

func isWireGuardShareLink(link string) bool {
	lower := strings.ToLower(strings.TrimSpace(link))
	return strings.HasPrefix(lower, "amneziawg://") ||
		strings.HasPrefix(lower, "awg://") ||
		strings.HasPrefix(lower, "wireguard://") ||
		strings.HasPrefix(lower, "wg://")
}
