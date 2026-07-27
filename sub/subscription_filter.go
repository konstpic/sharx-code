package sub

import (
	"strings"
)

// subscriptionURISchemes lists URI prefixes that must never appear inside a wg-quick block.
var subscriptionURISchemes = []string{
	"vless://", "vmess://", "trojan://", "ss://", "socks://",
	"hysteria://", "hysteria2://", "hy2://", "tuic://", "wireguard://",
	"amneziawg://", "telemt://", "mtproto://",
}

func isSubscriptionURILine(line string) bool {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return false
	}
	lower := strings.ToLower(line)
	for _, scheme := range subscriptionURISchemes {
		if strings.HasPrefix(lower, scheme) {
			return true
		}
	}
	return false
}

// trimWireguardConfBlock keeps only wg-quick / AWG ini lines and stops before a leaked URI profile.
func trimWireguardConfBlock(conf string) string {
	conf = strings.TrimSpace(conf)
	if conf == "" {
		return ""
	}
	var b strings.Builder
	inSection := false
	for _, line := range strings.Split(conf, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if inSection {
				b.WriteByte('\n')
			}
			continue
		}
		if isSubscriptionURILine(trimmed) {
			break
		}
		if strings.HasPrefix(trimmed, "#") {
			b.WriteString(line)
			b.WriteByte('\n')
			continue
		}
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			inSection = true
			b.WriteString(line)
			b.WriteByte('\n')
			continue
		}
		if !inSection {
			continue
		}
		if strings.Contains(trimmed, "=") {
			b.WriteString(line)
			b.WriteByte('\n')
			continue
		}
		break
	}
	return strings.TrimSpace(b.String())
}

// isWireGuardPanelSubscriptionEntry reports wg-quick / AmneziaWG panel blocks that
// URI-list clients (INCY, Throne, etc.) mis-parse as a single WireGuard config.
func isWireGuardPanelSubscriptionEntry(link string) bool {
	link = strings.TrimSpace(link)
	if link == "" {
		return false
	}
	if isWireGuardShareLink(link) {
		return false
	}
	lower := strings.ToLower(link)
	if strings.HasPrefix(lower, "amneziawg") && !strings.HasPrefix(lower, "amneziawg://") {
		return true
	}
	return strings.Contains(link, "[Interface]") && strings.Contains(link, "[Peer]")
}

func uriListBase64SubscriptionClient(client UAClient) bool {
	switch client {
	case UAINCY, UAV2RayNG, UAHiddify, UAKaring, UANekobox, UAStreisand, UAShadowrocket, UAUnknown:
		return true
	default:
		return false
	}
}

func subscriptionRemarkFromPanelInfo(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Inbound:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Inbound:"))
		}
	}
	return ""
}

// normalizeWireGuardSubscriptionEntry converts panel wg-quick blocks to INCY-native share links
// (amneziawg:// / wireguard://) for URI-list clients.
func normalizeWireGuardSubscriptionEntry(link string, _ UAClient) string {
	if shareLink := wireGuardShareLinkFromPanelInfo(link); shareLink != "" {
		return shareLink
	}
	conf := strings.TrimSpace(wireguardConfBlockFromPanelInfo(link))
	conf = trimWireguardConfBlock(conf)
	if conf == "" {
		return strings.TrimSpace(link)
	}
	if remark := subscriptionRemarkFromPanelInfo(link); remark != "" {
		desc := subscriptionServerDescriptionFromPanelInfo(link)
		if isAmneziaWGConf(conf) || strings.Contains(strings.ToLower(link), "amneziawg") {
			if shareLink := amneziawgShareLinkFromConf(conf, remark, desc); shareLink != "" {
				return shareLink
			}
		}
		if shareLink := wireguardShareLinkFromConf(conf, remark, desc); shareLink != "" {
			return shareLink
		}
	}
	return conf
}

// filterSubscriptionLinksForClient drops or normalizes entries the target client cannot use.
func filterSubscriptionLinksForClient(links []string, client UAClient) []string {
	if client == UAThrone {
		out := make([]string, 0, len(links))
		for _, link := range links {
			if isWireGuardPanelSubscriptionEntry(link) {
				continue
			}
			out = append(out, link)
		}
		return out
	}
	if !uriListBase64SubscriptionClient(client) {
		return links
	}
	out := make([]string, 0, len(links))
	for _, link := range links {
		if isWireGuardPanelSubscriptionEntry(link) {
			link = normalizeWireGuardSubscriptionEntry(link, client)
		}
		link = strings.TrimSpace(link)
		if link != "" {
			out = append(out, link)
		}
	}
	return orderSubscriptionLinksForClient(out, client)
}

// orderSubscriptionLinksForClient puts legacy wg-quick panel blocks last for URI-list clients.
func orderSubscriptionLinksForClient(links []string, client UAClient) []string {
	if !uriListBase64SubscriptionClient(client) || len(links) < 2 {
		return links
	}
	var uriEntries, wgEntries []string
	for _, link := range links {
		if isWireGuardPanelSubscriptionEntry(link) {
			wgEntries = append(wgEntries, link)
		} else {
			uriEntries = append(uriEntries, link)
		}
	}
	if len(wgEntries) == 0 || len(uriEntries) == 0 {
		return links
	}
	return append(uriEntries, wgEntries...)
}

// subscriptionEntrySeparator returns the delimiter between logical subscription entries.
func subscriptionEntrySeparator(client UAClient) string {
	if uriListBase64SubscriptionClient(client) {
		return "\n\n"
	}
	return "\n"
}
