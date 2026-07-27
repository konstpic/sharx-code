package sub

import (
	"encoding/base64"
	"fmt"
	"net"
	"strings"

	"github.com/goccy/go-json"
	"golang.org/x/crypto/curve25519"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// wireguardPublicKeyFromPrivateB64 decodes a standard WireGuard base64 private key and returns base64-encoded public key.
func wireguardPublicKeyFromPrivateB64(b64 string) (string, error) {
	b64 = strings.TrimSpace(b64)
	if b64 == "" {
		return "", fmt.Errorf("empty key")
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(b64)
		if err != nil {
			return "", err
		}
	}
	if len(raw) != 32 {
		return "", fmt.Errorf("key length %d, want 32", len(raw))
	}
	var sk [32]byte
	copy(sk[:], raw)
	sk[0] &= 248
	sk[31] = (sk[31] & 127) | 64
	var pk [32]byte
	curve25519.ScalarBaseMult(&pk, &sk)
	return base64.StdEncoding.EncodeToString(pk[:]), nil
}

func anyInt64(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int32:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	default:
		return 0
	}
}

// wireguardClientDNSFromSettings returns DNS entries for the user [Interface] (from `clientDns` in inbound settings).
func wireguardClientDNSFromSettings(settings map[string]any) []string {
	if settings == nil {
		return nil
	}
	raw, ok := settings["clientDns"]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			s, ok := x.(string)
			if !ok {
				continue
			}
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		out := make([]string, 0, len(v))
		for _, s := range v {
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func findWireguardPeerForClient(peers []any, clientEmail string) map[string]any {
	el := strings.ToLower(strings.TrimSpace(clientEmail))
	if el == "" {
		return nil
	}
	for _, p := range peers {
		m, ok := p.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{"name", "clientName", "panelName", "email", "clientEmail", "panelEmail"} {
			if s, _ := m[key].(string); strings.ToLower(strings.TrimSpace(s)) == el {
				return m
			}
		}
	}
	return nil
}

// findWireguardPeerForClientActiveOrInactive looks in Xray `peers` first, then panel-only inactive vault.
func findWireguardPeerForClientActiveOrInactive(settings map[string]any, clientName string) map[string]any {
	if settings == nil {
		return nil
	}
	peers, _ := settings["peers"].([]any)
	if m := findWireguardPeerForClient(peers, clientName); m != nil {
		return m
	}
	inactive, _ := settings[service.PanelWireGuardInactivePeersSettingsKey].([]any)
	return findWireguardPeerForClient(inactive, clientName)
}

// wireguardInboundLabel is the inbound remark used for .conf export labels (subscription + panel).
func wireguardInboundLabel(inbound *model.Inbound) string {
	if inbound == nil {
		return "wireguard"
	}
	if r := strings.TrimSpace(inbound.Remark); r != "" {
		return r
	}
	if inbound.Id > 0 {
		return fmt.Sprintf("inbound-%d", inbound.Id)
	}
	return "wireguard"
}

func appendWireguardInboundLine(b *strings.Builder, inbound *model.Inbound) {
	b.WriteString("Inbound: " + wireguardInboundLabel(inbound) + "\n")
}

// buildWireguardPanelInfo returns text for the panel "View connection keys" modal (not a v2ray:// URL).
// clientName matches a server peer with "name" / "clientName" / "email" / "clientEmail" in settings JSON.
func (s *SubService) buildWireguardPanelInfo(inbound *model.Inbound, clientEmail string) string {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.WireGuard {
		return ""
	}
	var settings map[string]any
	_ = json.Unmarshal([]byte(inbound.Settings), &settings)
	if settings == nil {
		settings = map[string]any{}
	}

	var b strings.Builder
	b.WriteString("WireGuard (UDP) — this is not a v2ray:// link; use the data below in a WireGuard app.\n")
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
		b.WriteString("Endpoint: (set panel Host / node address, or subscription web domain, so a host:port appears here.)\n\n")
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
	if v, ok := settings["noKernelTun"]; ok {
		b.WriteString(fmt.Sprintf("noKernelTun: %v\n", v))
	}
	if w, ok := settings["workers"]; ok {
		b.WriteString(fmt.Sprintf("workers: %v\n", w))
	}
	if arr, ok := settings["address"].([]any); ok && len(arr) > 0 {
		parts := make([]string, 0, len(arr))
		for _, x := range arr {
			parts = append(parts, fmt.Sprint(x))
		}
		b.WriteString("Server tunnel: ")
		b.WriteString(strings.Join(parts, ", "))
		b.WriteString("\n")
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
	b.WriteString("\n---\n")
	b.WriteString("Peers on the server (Xray `settings.peers`)\n")
	if len(peers) == 0 && len(inactivePeers) == 0 {
		b.WriteString("No peers in settings yet. Assign a client to this inbound in “Clients” to auto-create a peer, or add peers manually in Inbounds → WireGuard.\n")
	} else {
		b.WriteString(fmt.Sprintf("Configured: %d active + %d inactive (panel vault) peer(s).\n", len(peers), len(inactivePeers)))
		if m := findWireguardPeerForClientActiveOrInactive(settings, clientEmail); m != nil {
			b.WriteString("\nRow linked to this client (matched by email on the peer)\n")
			if pk, _ := m["publicKey"].(string); strings.TrimSpace(pk) != "" {
				b.WriteString("Device public key (must be this key on the server peer row): " + strings.TrimSpace(pk) + "\n")
			}
			if aip, ok := m["allowedIPs"].([]any); ok && len(aip) > 0 {
				parts := make([]string, 0, len(aip))
				for _, x := range aip {
					parts = append(parts, fmt.Sprint(x))
				}
				b.WriteString("AllowedIPs: " + strings.Join(parts, ", ") + "\n")
			}
			if psk, _ := m["preSharedKey"].(string); strings.TrimSpace(psk) != "" {
				b.WriteString("Pre-shared key: " + strings.TrimSpace(psk) + "\n")
			}
			if ka := anyInt64(m["keepAlive"]); ka > 0 {
				b.WriteString(fmt.Sprintf("PersistentKeepalive: %d\n", ka))
			}
			if priv, _ := m["privateKey"].(string); strings.TrimSpace(priv) != "" {
				b.WriteString("Client private key (Interface): " + strings.TrimSpace(priv) + "\n")
			}
		} else if clientEmail != "" {
			b.WriteString("\nNo peer row is tagged for this client. Add \"email\" (or clientEmail) on a peer, equal to: " + clientEmail + "\n")
		} else {
			b.WriteString("\n(Assign an email to this client in the panel to match a peer by email.)\n")
		}
	}

	if serverPub != "" {
		appendWgQuickClientConf(&b, settings, clientEmail, firstEndpoint, serverPub, nil)
	}
	return strings.TrimSpace(b.String()) + "\n"
}

type wgQuickClientConfOpts struct {
	writeInterfaceExtras func(b *strings.Builder, settings map[string]any)
}

func appendWgQuickClientConf(b *strings.Builder, settings map[string]any, clientEmail, firstEndpoint, serverPub string, opts *wgQuickClientConfOpts) {
	peerMatch := findWireguardPeerForClientActiveOrInactive(settings, clientEmail)

	b.WriteString("\n[Interface]\n")
	if peerMatch != nil {
		if priv, _ := peerMatch["privateKey"].(string); strings.TrimSpace(priv) != "" {
			b.WriteString("PrivateKey = " + strings.TrimSpace(priv) + "\n")
		}
		if aip, ok := peerMatch["allowedIPs"].([]any); ok && len(aip) > 0 {
			first := strings.TrimSpace(fmt.Sprint(aip[0]))
			if first != "" {
				if !strings.Contains(first, "/") {
					first += "/32"
				}
				b.WriteString("Address = " + first + "\n")
			}
		}
		if dns := wireguardClientDNSFromSettings(settings); len(dns) > 0 {
			b.WriteString("DNS = " + strings.Join(dns, ", ") + "\n")
		}
	} else if dns := wireguardClientDNSFromSettings(settings); len(dns) > 0 {
		b.WriteString("DNS = " + strings.Join(dns, ", ") + "\n")
	}
	if opts != nil && opts.writeInterfaceExtras != nil {
		opts.writeInterfaceExtras(b, settings)
	}

	b.WriteString("\n[Peer]\n")
	b.WriteString("PublicKey = " + serverPub + "\n")
	if firstEndpoint != "" {
		b.WriteString("Endpoint = " + firstEndpoint + "\n")
	}
	if peerMatch != nil {
		if psk, _ := peerMatch["preSharedKey"].(string); strings.TrimSpace(psk) != "" {
			b.WriteString("PresharedKey = " + strings.TrimSpace(psk) + "\n")
		}
		if ka := anyInt64(peerMatch["keepAlive"]); ka > 0 {
			b.WriteString(fmt.Sprintf("PersistentKeepalive = %d\n", ka))
		}
	}
	b.WriteString("AllowedIPs = 0.0.0.0/0, ::/0\n")
}

// wireguardConfBlockFromPanelInfo extracts the wg-quick [Interface]/[Peer] section from panel info text.
// Ignores descriptive lines that mention [Interface] mid-line (e.g. old "Client DNS (for [Interface]):" hints).
func wireguardConfBlockFromPanelInfo(text string) string {
	const header = "\n[Interface]\n"
	if i := strings.Index(text, header); i >= 0 {
		return trimWireguardConfBlock(strings.TrimSpace(text[i+1:]))
	}
	if strings.HasPrefix(text, "[Interface]\n") {
		return trimWireguardConfBlock(strings.TrimSpace(text))
	}
	return ""
}
