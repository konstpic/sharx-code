package sub

import (
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/xray"
)

func tlsSettingToAnyMap(tlsSetting map[string]interface{}) map[string]any {
	if tlsSetting == nil {
		return nil
	}
	out := make(map[string]any, len(tlsSetting))
	for k, v := range tlsSetting {
		out[k] = v
	}
	return out
}

func tlsPinFromSettings(tlsSetting map[string]any) string {
	if tlsSetting == nil {
		return ""
	}
	return strings.TrimSpace(xray.PinnedPeerCertSha256FromTLS(tlsSetting))
}

func tlsAllowInsecureFromSettings(tlsSetting map[string]any) bool {
	if tlsSetting == nil {
		return false
	}
	if v, ok := tlsSetting["allowInsecure"].(bool); ok && v {
		return true
	}
	if tlsSettings, ok := searchKey(tlsSetting, "settings"); ok && tlsSettings != nil {
		if insecure, ok := searchKey(tlsSettings, "allowInsecure"); ok {
			if b, ok := insecure.(bool); ok && b {
				return true
			}
		}
	}
	return false
}

// buildCredentialShareURL builds scheme://auth@host:port with proper userinfo escaping.
func buildCredentialShareURL(scheme, auth, host string, port int) *url.URL {
	u := &url.URL{
		Scheme: scheme,
		Host:   net.JoinHostPort(host, strconv.Itoa(port)),
	}
	if auth != "" {
		u.User = url.User(auth)
	}
	return u
}

// applyXrayQueryTLSPin adds pcs to vless:// / trojan:// / ss:// query params.
// Returns true when a pin was applied (allowInsecure must not be used).
func applyXrayQueryTLSPin(tlsSetting map[string]any, params map[string]string) bool {
	pin := tlsPinFromSettings(tlsSetting)
	if pin == "" || params == nil {
		return false
	}
	params["pcs"] = pin
	delete(params, "allowInsecure")
	return true
}

// finalizeTLSQueryParams applies cert pin or legacy allowInsecure=1 to URI query params.
func finalizeTLSQueryParams(tlsSetting map[string]any, params map[string]string) {
	if applyXrayQueryTLSPin(tlsSetting, params) {
		return
	}
	if tlsAllowInsecureFromSettings(tlsSetting) {
		params["allowInsecure"] = "1"
	}
}

// applyVmessTLSPin adds pinnedPeerCertSha256 to vmess:// JSON payload.
func applyVmessTLSPin(tlsSetting map[string]any, baseObj map[string]any) bool {
	pin := tlsPinFromSettings(tlsSetting)
	if pin == "" || baseObj == nil {
		return false
	}
	baseObj["pinnedPeerCertSha256"] = pin
	delete(baseObj, "allowInsecure")
	return true
}

// finalizeVmessTLSBase applies cert pin or legacy allowInsecure to vmess JSON.
func finalizeVmessTLSBase(tlsSetting map[string]any, baseObj map[string]any) {
	if applyVmessTLSPin(tlsSetting, baseObj) {
		return
	}
	if tlsAllowInsecureFromSettings(tlsSetting) {
		baseObj["allowInsecure"] = true
	}
}

// applyHysteriaTLSPinParams copies certificate pinning into hysteria2:// query params (INCY: pinSHA256).
func applyHysteriaTLSPinParams(tlsSetting map[string]interface{}, params map[string]string) {
	pin := tlsPinFromSettings(tlsSettingToAnyMap(tlsSetting))
	if pin == "" || params == nil {
		return
	}
	params["pinSHA256"] = pin
	delete(params, "insecure")
	delete(params, "pcs")
}

// finalizeHysteriaTLSParams applies cert pin or legacy insecure=1 to hysteria2:// query params.
func finalizeHysteriaTLSParams(tlsSetting map[string]interface{}, params map[string]string) {
	applyHysteriaTLSPinParams(tlsSetting, params)
	if params["pinSHA256"] != "" {
		return
	}
	if tlsAllowInsecureFromSettings(tlsSettingToAnyMap(tlsSetting)) {
		params["insecure"] = "1"
	}
}

// tlsQueryKeysStrippedForPlainSecurity are TLS URI/JSON fields omitted when forceTls=none on external proxy.
func tlsQueryKeysStrippedForPlainSecurity(key string) bool {
	switch key {
	case "alpn", "sni", "fp", "allowInsecure", "pcs", "pinnedPeerCertSha256", "insecure", "pinSHA256":
		return true
	default:
		return false
	}
}
