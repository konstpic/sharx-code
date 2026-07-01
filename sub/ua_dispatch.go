package sub

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// UAClient identifies the high-level client kind for subscription dispatch.
type UAClient int

const (
	UAUnknown UAClient = iota
	UABrowser
	UAHapp
	UAV2RayTun
	UAINCY
	UAV2RayNG
	UAHiddify
	UAStreisand
	UAShadowrocket
	UAClashMeta
	UAKaring
	UANekobox
	UAThrone
	UASingBox
)

// UAResponseFormat names the subscription response format we prefer for a
// given client. The actual transport (base64 vs. raw, JSON template, etc.) is
// applied downstream.
type UAResponseFormat string

const (
	FormatBase64     UAResponseFormat = "base64"
	FormatPlain      UAResponseFormat = "plain"
	FormatEncrypted  UAResponseFormat = "encrypted"
	FormatSIP008     UAResponseFormat = "sip008"
	FormatClashYAML  UAResponseFormat = "clash-yaml"
	FormatXrayJSON   UAResponseFormat = "xray-json"
	FormatRedirectUI UAResponseFormat = "redirect-ui"
)

// DispatchByUA classifies the User-Agent / Accept and returns both the client
// kind and the preferred response format. The format can be used by callers
// to pick the correct Content-Type and encoding path.
func DispatchByUA(c *gin.Context) (UAClient, UAResponseFormat) {
	ua := strings.ToLower(c.GetHeader("User-Agent"))
	accept := strings.ToLower(c.GetHeader("Accept"))

	if strings.Contains(accept, "text/html") ||
		c.Query("html") == "1" ||
		strings.EqualFold(c.Query("view"), "html") {
		return UABrowser, FormatRedirectUI
	}

	switch {
	case strings.Contains(ua, "happ"):
		return UAHapp, FormatEncrypted
	case strings.Contains(ua, "v2raytun"):
		return UAV2RayTun, FormatEncrypted
	case strings.Contains(ua, "incy") || strings.EqualFold(strings.TrimSpace(c.GetHeader("x-client")), "incy"):
		return UAINCY, FormatBase64
	case strings.Contains(ua, "v2rayng"):
		return UAV2RayNG, FormatBase64
	case strings.Contains(ua, "hiddify"):
		return UAHiddify, FormatBase64
	case strings.Contains(ua, "streisand"):
		return UAStreisand, FormatBase64
	case strings.Contains(ua, "shadowrocket"):
		return UAShadowrocket, FormatBase64
	case strings.Contains(ua, "throne"):
		// Throne UA often includes "Prefer ClashMeta Format"; still return share links
		// (base64 URI list) — Clash YAML skips many Xray transports and WG blocks confuse Throne.
		return UAThrone, FormatBase64
	case strings.Contains(ua, "clash"):
		// Clash / Clash Meta / Mihomo all contain "clash" or "mihomo"
		return UAClashMeta, FormatClashYAML
	case strings.Contains(ua, "mihomo"):
		return UAClashMeta, FormatClashYAML
	case strings.Contains(ua, "karing"):
		return UAKaring, FormatBase64
	case strings.Contains(ua, "nekobox"):
		return UANekobox, FormatBase64
	case strings.Contains(ua, "sing-box") || strings.Contains(ua, "singbox"):
		return UASingBox, FormatXrayJSON
	}
	return UAUnknown, FormatBase64
}

// ContentTypeFor returns the best Content-Type hint for a response format.
func ContentTypeFor(fmtt UAResponseFormat) string {
	return ContentTypeForClient(UAUnknown, fmtt)
}

// ContentTypeForClient returns the Content-Type for a client/format pair.
// Happ only applies subscription meta-headers (Hide-Settings, providerid, etc.)
// when Content-Type is application/json — see happ.su dev-docs/app-management.
func ContentTypeForClient(client UAClient, fmtt UAResponseFormat) string {
	if client == UAHapp {
		return "application/json; charset=utf-8"
	}
	switch fmtt {
	case FormatSIP008, FormatXrayJSON:
		return "application/json; charset=utf-8"
	case FormatClashYAML:
		return "application/x-yaml; charset=utf-8"
	case FormatEncrypted, FormatBase64:
		return "text/plain; charset=utf-8"
	default:
		return "text/plain; charset=utf-8"
	}
}
