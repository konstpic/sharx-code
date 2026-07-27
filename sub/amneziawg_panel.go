package sub

import (
	"fmt"
	"net"
	"strings"

	"github.com/goccy/go-json"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
)

func amneziaWgObfuscationFromSettings(settings map[string]any) service.AmneziaWGObfuscation {
	if settings == nil {
		return service.AmneziaWGObfuscation{}
	}
	raw, ok := settings["obfuscation"]
	if !ok || raw == nil {
		return service.AmneziaWGObfuscation{}
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return service.AmneziaWGObfuscation{}
	}
	var out service.AmneziaWGObfuscation
	_ = json.Unmarshal(b, &out)
	return out
}

// buildAmneziaWgPanelInfo returns subscription text with wg-quick client .conf (AWG obfuscation included).
func (s *SubService) buildAmneziaWgPanelInfo(inbound *model.Inbound, clientEmail string) string {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.AmneziaWG {
		return ""
	}
	var settings map[string]any
	_ = json.Unmarshal([]byte(inbound.Settings), &settings)
	if settings == nil {
		settings = map[string]any{}
	}

	var b strings.Builder
	b.WriteString("AmneziaWG (UDP) — use the .conf block below in the AmneziaWG app (not a v2ray:// link).\n")
	appendWireguardInboundLine(&b, inbound)
	b.WriteString("\n")

	addrs, _ := s.getAddressesForInbound(inbound)
	for _, ap := range addrs {
		if desc := strings.TrimSpace(ap.ServerDescription); desc != "" {
			b.WriteString("Server description: " + desc + "\n")
			break
		}
	}

	var firstEndpoint string
	if len(addrs) == 0 {
		b.WriteString("Endpoint: (set panel Host / node address, or subscription web domain.)\n\n")
	} else {
		for i, ap := range addrs {
			if i > 0 {
				b.WriteString("\n")
			}
			port := ap.Port
			if port <= 0 {
				port = inbound.Port
			}
			h := strings.TrimSpace(ap.Address)
			if h == "" {
				continue
			}
			ep := net.JoinHostPort(h, fmt.Sprintf("%d", port))
			if firstEndpoint == "" {
				firstEndpoint = ep
			}
			b.WriteString(fmt.Sprintf("Endpoint: %s\n", ep))
		}
		b.WriteString("\n")
	}

	if v, ok := settings["mtu"]; ok {
		b.WriteString(fmt.Sprintf("MTU: %v\n", v))
	}
	if arr, ok := settings["address"].([]any); ok && len(arr) > 0 {
		parts := make([]string, 0, len(arr))
		for _, x := range arr {
			parts = append(parts, fmt.Sprint(x))
		}
		b.WriteString("Server tunnel: " + strings.Join(parts, ", ") + "\n")
	}
	if dns := wireguardClientDNSFromSettings(settings); len(dns) > 0 {
		b.WriteString("Client DNS: " + strings.Join(dns, ", ") + "\n")
	}

	secret, _ := settings["secretKey"].(string)
	var serverPub string
	if secret != "" {
		if pub, err := wireguardPublicKeyFromPrivateB64(secret); err == nil {
			serverPub = pub
			b.WriteString("Server public key: " + serverPub + "\n")
		} else {
			b.WriteString("Server public key: (invalid secretKey; must be 32-byte standard base64.)\n")
		}
	} else {
		b.WriteString("Server public key: (missing — set secretKey in the inbound.)\n")
	}

	peers, _ := settings["peers"].([]any)
	inactivePeers, _ := settings[service.PanelWireGuardInactivePeersSettingsKey].([]any)
	clientEmail = strings.TrimSpace(clientEmail)
	peerMatch := findWireguardPeerForClientActiveOrInactive(settings, clientEmail)

	if serverPub != "" {
		appendWgQuickClientConf(&b, settings, clientEmail, firstEndpoint, serverPub, &wgQuickClientConfOpts{
			writeInterfaceExtras: func(b *strings.Builder, settings map[string]any) {
				if mtu, ok := settings["mtu"]; ok {
					b.WriteString(fmt.Sprintf("MTU = %v\n", mtu))
				}
				service.AppendAmneziaWGObfuscationToConf(b, amneziaWgObfuscationFromSettings(settings))
			},
		})
	} else if len(peers) == 0 && len(inactivePeers) == 0 {
		b.WriteString("\nNo peers yet — assign a client to this inbound to auto-create keys.\n")
	} else if clientEmail != "" && peerMatch == nil {
		b.WriteString("\nNo peer row tagged for client: " + clientEmail + "\n")
	}
	return strings.TrimSpace(b.String()) + "\n"
}
