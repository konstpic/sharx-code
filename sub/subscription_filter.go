package sub

import "strings"

// isWireGuardPanelSubscriptionEntry reports wg-quick / AmneziaWG panel blocks that
// Throne and other Xray URI clients mis-parse as WireGuard configs.
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

// filterSubscriptionLinksForClient drops entries that the target client cannot use.
func filterSubscriptionLinksForClient(links []string, client UAClient) []string {
	if client != UAThrone {
		return links
	}
	out := make([]string, 0, len(links))
	for _, link := range links {
		if isWireGuardPanelSubscriptionEntry(link) {
			continue
		}
		out = append(out, link)
	}
	return out
}
