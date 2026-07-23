package sub

import "strings"

// isWireGuardPanelSubscriptionEntry reports wg-quick / AmneziaWG panel blocks that
// URI-list clients (INCY, Throne, etc.) mis-parse as a single WireGuard config.
func isWireGuardPanelSubscriptionEntry(link string) bool {
	link = strings.TrimSpace(link)
	if link == "" {
		return false
	}
	lower := strings.ToLower(link)
	if strings.HasPrefix(lower, "amneziawg") || strings.HasPrefix(lower, "wireguard") {
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

// normalizeWireGuardSubscriptionEntry keeps only the wg-quick block for URI-list clients.
// Multi-line panel boilerplate breaks INCY and similar parsers that expect one URI per line.
func normalizeWireGuardSubscriptionEntry(link string) string {
	conf := strings.TrimSpace(wireguardConfBlockFromPanelInfo(link))
	if conf == "" {
		return strings.TrimSpace(link)
	}
	if remark := subscriptionRemarkFromPanelInfo(link); remark != "" {
		return "# " + remark + "\n" + conf
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
			link = normalizeWireGuardSubscriptionEntry(link)
		}
		link = strings.TrimSpace(link)
		if link != "" {
			out = append(out, link)
		}
	}
	return out
}

// subscriptionEntrySeparator returns the delimiter between logical subscription entries.
func subscriptionEntrySeparator(client UAClient) string {
	if uriListBase64SubscriptionClient(client) {
		return "\n\n"
	}
	return "\n"
}
