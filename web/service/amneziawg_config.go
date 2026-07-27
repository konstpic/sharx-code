package service

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// AWGConfValue is an AmneziaWG config scalar that accepts legacy JSON numbers or strings
// (e.g. H1 ranges "123-456", ContentPaddingAddition "8-32").
type AWGConfValue string

func (v AWGConfValue) String() string { return strings.TrimSpace(string(v)) }

func (v AWGConfValue) IsZero() bool { return v.String() == "" }

func (v *AWGConfValue) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || string(data) == "null" {
		*v = ""
		return nil
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*v = AWGConfValue(strings.TrimSpace(s))
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(data, &n); err == nil {
		*v = AWGConfValue(n.String())
		return nil
	}
	var f float64
	if err := json.Unmarshal(data, &f); err != nil {
		return err
	}
	*v = AWGConfValue(strconv.FormatInt(int64(f), 10))
	return nil
}

func (v AWGConfValue) MarshalJSON() ([]byte, error) {
	s := v.String()
	if s == "" {
		return []byte(`""`), nil
	}
	// Pure integers stay numbers for legacy panel / older tools.
	if i, err := strconv.Atoi(s); err == nil && strconv.Itoa(i) == s {
		return []byte(s), nil
	}
	return json.Marshal(s)
}

// AmneziaWGObfuscation holds transport-layer AWG params (Jc/H/S + AWG 3.0 extras).
// Empty / zero fields are omitted from conf for legacy clients and older amneziawg-go.
// See https://github.com/amnezia-vpn/amneziawg-go and https://docs.amnezia.org/documentation/amnezia-wg/
type AmneziaWGObfuscation struct {
	Jc   int `json:"jc,omitempty"`
	Jmin int `json:"jmin,omitempty"`
	Jmax int `json:"jmax,omitempty"`
	S1   int `json:"s1,omitempty"`
	S2   int `json:"s2,omitempty"`
	S3   int `json:"s3,omitempty"`
	S4   int `json:"s4,omitempty"`
	// H1–H4: legacy single uint or AWG 3 range "x-y".
	H1 AWGConfValue `json:"h1,omitempty"`
	H2 AWGConfValue `json:"h2,omitempty"`
	H3 AWGConfValue `json:"h3,omitempty"`
	H4 AWGConfValue `json:"h4,omitempty"`
	// I1–I5: custom signature packets (AWG; typically client-side).
	I1 string `json:"i1,omitempty"`
	I2 string `json:"i2,omitempty"`
	I3 string `json:"i3,omitempty"`
	I4 string `json:"i4,omitempty"`
	I5 string `json:"i5,omitempty"`
	// AWG 3.0+
	HeaderProtectionKey    string `json:"headerProtectionKey,omitempty"`
	ContentPaddingAddition string `json:"contentPaddingAddition,omitempty"` // uint or "min-max"
	RekeyAfterTime         string `json:"rekeyAfterTime,omitempty"`
	RekeyTimeout           string `json:"rekeyTimeout,omitempty"`
	RejectAfterTime        string `json:"rejectAfterTime,omitempty"`
	KeepaliveTimeout       string `json:"keepaliveTimeout,omitempty"`
	MaxHandshakeAttempts   string `json:"maxHandshakeAttempts,omitempty"`
}

// AmneziaWGInboundSettings is panel JSON for protocol `amneziawg` (sidecar, not Xray).
type AmneziaWGInboundSettings struct {
	ListenPort         int                     `json:"listenPort"`
	MTU                int                     `json:"mtu"`
	SecretKey          string                  `json:"secretKey"`
	Address            []string                `json:"address"`
	ClientDNS          []string                `json:"clientDns,omitempty"`
	Obfuscation        AmneziaWGObfuscation    `json:"obfuscation"`
	Peers              []AmneziaWGPeerSettings `json:"peers,omitempty"`
	PanelInactivePeers []AmneziaWGPeerSettings `json:"panelWgInactivePeers,omitempty"`
}

type AmneziaWGPeerSettings struct {
	Name         string   `json:"name,omitempty"`
	PublicKey    string   `json:"publicKey"`
	PrivateKey   string   `json:"privateKey,omitempty"`
	PreSharedKey string   `json:"preSharedKey,omitempty"`
	AllowedIPs   []string `json:"allowedIPs,omitempty"`
	KeepAlive    int      `json:"keepAlive,omitempty"`
}

// RandomAmneziaWGObfuscation returns DPI-oriented defaults (legacy-compatible; no AWG 3 keys).
func RandomAmneziaWGObfuscation() AmneziaWGObfuscation {
	return AmneziaWGObfuscation{
		Jc:   4,
		Jmin: 40,
		Jmax: 70,
		S1:   randomIntRange(50, 120),
		S2:   randomIntRange(0, 40),
		H1:   AWGConfValue(strconv.Itoa(randomUint32())),
		H2:   AWGConfValue(strconv.Itoa(randomUint32())),
		H3:   AWGConfValue(strconv.Itoa(randomUint32())),
		H4:   AWGConfValue(strconv.Itoa(randomUint32())),
	}
}

func randomIntRange(min, max int) int {
	if max <= min {
		return min
	}
	var b [4]byte
	_, _ = rand.Read(b[:])
	return min + int(binary.BigEndian.Uint32(b[:])%uint32(max-min+1))
}

func randomUint32() int {
	var b [4]byte
	_, _ = rand.Read(b[:])
	v := binary.BigEndian.Uint32(b[:])
	if v == 0 {
		return 1286472620
	}
	return int(v)
}

// EnsureAmneziaWGHeaderProtectionPadding raises S1–S4 to at least 8 when HeaderProtectionKey is set.
func EnsureAmneziaWGHeaderProtectionPadding(o *AmneziaWGObfuscation) {
	if o == nil || strings.TrimSpace(o.HeaderProtectionKey) == "" {
		return
	}
	if o.S1 < 8 {
		o.S1 = 8
	}
	if o.S2 < 8 {
		o.S2 = 8
	}
	if o.S3 < 8 {
		o.S3 = 8
	}
	if o.S4 < 8 {
		o.S4 = 8
	}
}

// ValidateAmneziaWGObfuscation checks AWG 3 constraints (HeaderProtectionKey requires S1–S4 ≥ 8).
func ValidateAmneziaWGObfuscation(o AmneziaWGObfuscation) error {
	if strings.TrimSpace(o.HeaderProtectionKey) == "" {
		return nil
	}
	for _, pair := range []struct {
		name string
		v    int
	}{
		{"S1", o.S1}, {"S2", o.S2}, {"S3", o.S3}, {"S4", o.S4},
	} {
		if pair.v < 8 {
			return fmt.Errorf("HeaderProtectionKey requires %s >= 8 (got %d); use awg genkey-compatible key and raise S1–S4", pair.name, pair.v)
		}
	}
	return nil
}

// AppendAmneziaWGObfuscationToConf writes AWG key=value lines into a wg-quick [Interface] section.
// Zero / empty values are skipped so legacy confs stay unchanged when AWG 3 fields are unused.
func AppendAmneziaWGObfuscationToConf(b *strings.Builder, o AmneziaWGObfuscation) {
	writeInt := func(key string, val int) {
		if val != 0 {
			b.WriteString(fmt.Sprintf("%s = %d\n", key, val))
		}
	}
	writeStr := func(key, val string) {
		val = strings.TrimSpace(val)
		if val != "" {
			b.WriteString(fmt.Sprintf("%s = %s\n", key, val))
		}
	}
	writeInt("Jc", o.Jc)
	writeInt("Jmin", o.Jmin)
	writeInt("Jmax", o.Jmax)
	writeInt("S1", o.S1)
	writeInt("S2", o.S2)
	writeInt("S3", o.S3)
	writeInt("S4", o.S4)
	writeStr("H1", o.H1.String())
	writeStr("H2", o.H2.String())
	writeStr("H3", o.H3.String())
	writeStr("H4", o.H4.String())
	writeStr("I1", o.I1)
	writeStr("I2", o.I2)
	writeStr("I3", o.I3)
	writeStr("I4", o.I4)
	writeStr("I5", o.I5)
	writeStr("HeaderProtectionKey", o.HeaderProtectionKey)
	writeStr("ContentPaddingAddition", o.ContentPaddingAddition)
	writeStr("RekeyAfterTime", o.RekeyAfterTime)
	writeStr("RekeyTimeout", o.RekeyTimeout)
	writeStr("RejectAfterTime", o.RejectAfterTime)
	writeStr("KeepaliveTimeout", o.KeepaliveTimeout)
	writeStr("MaxHandshakeAttempts", o.MaxHandshakeAttempts)
}

// ParseAmneziaWGInboundSettings parses inbound settings JSON for protocol amneziawg.
func ParseAmneziaWGInboundSettings(settingsJSON string) (*AmneziaWGInboundSettings, error) {
	settingsJSON = strings.TrimSpace(settingsJSON)
	if settingsJSON == "" {
		return &AmneziaWGInboundSettings{MTU: 1420, Address: []string{"10.8.0.1/24"}}, nil
	}
	var out AmneziaWGInboundSettings
	if err := json.Unmarshal([]byte(settingsJSON), &out); err != nil {
		return nil, err
	}
	if out.MTU <= 0 {
		out.MTU = 1420
	}
	if len(out.Address) == 0 {
		out.Address = []string{"10.8.0.1/24"}
	}
	return &out, nil
}

// AmneziaWGInboundRequest is the panel form payload for protocol amneziawg.
type AmneziaWGInboundRequest struct {
	MTU         int                   `json:"mtu"`
	SecretKey   string                `json:"secretKey"`
	Address     []string              `json:"address"`
	ClientDNS   []string              `json:"clientDns"`
	Obfuscation *AmneziaWGObfuscation `json:"obfuscation,omitempty"`
}

const defaultAmneziaWGMTU = 1420

// BuildAmneziaWGInboundSettingsJSON builds inbound `settings` JSON for protocol amneziawg.
func BuildAmneziaWGInboundSettingsJSON(r *AmneziaWGInboundRequest) (string, error) {
	if r == nil {
		r = &AmneziaWGInboundRequest{}
	}
	mtu := r.MTU
	if mtu <= 0 {
		mtu = defaultAmneziaWGMTU
	}
	sk := strings.TrimSpace(r.SecretKey)
	if sk == "" {
		var err error
		sk, err = RandomWireGuardSecretKeyBase64()
		if err != nil {
			return "", err
		}
	}
	addrs := make([]string, 0, len(r.Address))
	for _, a := range r.Address {
		t := strings.TrimSpace(a)
		if t != "" {
			addrs = append(addrs, t)
		}
	}
	if len(addrs) == 0 {
		addrs = []string{"10.8.0.1/24"}
	}
	dns := normalizeWireGuardClientDNSList(r.ClientDNS)
	obf := AmneziaWGObfuscation{}
	if r.Obfuscation != nil {
		obf = *r.Obfuscation
	}
	EnsureAmneziaWGHeaderProtectionPadding(&obf)
	if err := ValidateAmneziaWGObfuscation(obf); err != nil {
		return "", err
	}
	out := AmneziaWGInboundSettings{
		MTU:         mtu,
		SecretKey:   sk,
		Address:     addrs,
		ClientDNS:   dns,
		Obfuscation: obf,
		Peers:       []AmneziaWGPeerSettings{},
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// AmneziaWGNodePayload is one sidecar instance pushed to workers / applied locally.
type AmneziaWGNodePayload struct {
	InboundId     int    `json:"inboundId"`
	Tag           string `json:"tag"`
	Conf          string `json:"conf"`
	Iface         string `json:"iface"`
	TunnelAddress string            `json:"tunnelAddress,omitempty"`
	TunnelSubnet  string            `json:"tunnelSubnet,omitempty"`
	PeerEmails    map[string]string `json:"peerEmails,omitempty"`
}

func wireguardSubnetFromServerAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "10.8.0.0/24"
	}
	if !strings.Contains(addr, "/") {
		return addr + "/24"
	}
	_, ipnet, err := net.ParseCIDR(addr)
	if err != nil || ipnet == nil {
		return addr
	}
	return ipnet.String()
}

// appendAmneziaWGRoutingHooks adds wg-quick PostUp/PostDown so client traffic is forwarded/NATed on the host.
func appendAmneziaWGRoutingHooks(b *strings.Builder, subnet string) {
	subnet = strings.TrimSpace(subnet)
	if subnet == "" {
		subnet = "10.8.0.0/24"
	}
	b.WriteString(fmt.Sprintf(
		"PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -A FORWARD -i %%i -j ACCEPT; iptables -A FORWARD -o %%i -j ACCEPT; iptables -t nat -A POSTROUTING -s %s -j MASQUERADE\n",
		subnet,
	))
	b.WriteString(fmt.Sprintf(
		"PostDown = iptables -D FORWARD -i %%i -j ACCEPT; iptables -D FORWARD -o %%i -j ACCEPT; iptables -t nat -D POSTROUTING -s %s -j MASQUERADE\n",
		subnet,
	))
}

func amneziaWgIfaceForInbound(inboundId int, tag string) string {
	if inboundId > 0 {
		return fmt.Sprintf("awg%d", inboundId)
	}
	return amneziaWgIfaceForTag(tag)
}

func amneziaWgIfaceForTag(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	var b strings.Builder
	b.WriteString("awg")
	for _, r := range tag {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if len(s) > 14 {
		s = s[:14]
	}
	if s == "awg" {
		return "awg0"
	}
	return s
}

func amneziaWGTunnelFromSettings(st *AmneziaWGInboundSettings) (tunnelAddress, tunnelSubnet string) {
	tunnelAddress = "10.8.0.1/24"
	tunnelSubnet = "10.8.0.0/24"
	if st == nil || len(st.Address) == 0 {
		return tunnelAddress, tunnelSubnet
	}
	addr := strings.TrimSpace(st.Address[0])
	if addr != "" {
		tunnelAddress = addr
		tunnelSubnet = wireguardSubnetFromServerAddress(addr)
	}
	return tunnelAddress, tunnelSubnet
}

func amneziaWGPeerEmailsFromSettings(settings map[string]any) map[string]string {
	out := make(map[string]string)
	peers, _ := settings["peers"].([]any)
	for _, p := range peers {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		pk := strings.TrimSpace(strAny(pm["publicKey"]))
		email := wireGuardPeerAnyEmail(pm)
		if pk != "" && email != "" {
			out[pk] = email
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func appendAmneziaWGServerPeers(b *strings.Builder, settings map[string]any, forSetconf bool) {
	peers, _ := settings["peers"].([]any)
	for _, p := range peers {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		pk, _ := pm["publicKey"].(string)
		pk = strings.TrimSpace(pk)
		if pk == "" {
			continue
		}
		b.WriteString("\n[Peer]\n")
		b.WriteString("PublicKey = " + pk + "\n")
		if aip, ok := pm["allowedIPs"].([]any); ok && len(aip) > 0 {
			parts := make([]string, 0, len(aip))
			for _, x := range aip {
				parts = append(parts, fmt.Sprint(x))
			}
			b.WriteString("AllowedIPs = " + strings.Join(parts, ", ") + "\n")
		} else if aip, ok := pm["allowedIPs"].([]string); ok && len(aip) > 0 {
			b.WriteString("AllowedIPs = " + strings.Join(aip, ", ") + "\n")
		} else {
			continue
		}
		if psk, _ := pm["preSharedKey"].(string); strings.TrimSpace(psk) != "" {
			b.WriteString("PresharedKey = " + strings.TrimSpace(psk) + "\n")
		}
		if ka := anyToInt(pm["keepAlive"]); ka > 0 && !forSetconf {
			b.WriteString(fmt.Sprintf("PersistentKeepalive = %d\n", ka))
		}
	}
}

// BuildAmneziaWGSetconf renders awg/wg setconf server config (no Address/MTU/PostUp — those are wg-quick only).
func BuildAmneziaWGSetconf(inbound *model.Inbound, settings map[string]any, listenPort int) (conf, tunnelAddress, tunnelSubnet string, err error) {
	if settings == nil {
		return "", "", "", fmt.Errorf("empty settings")
	}
	b, _ := json.Marshal(settings)
	st, err := ParseAmneziaWGInboundSettings(string(b))
	if err != nil {
		return "", "", "", err
	}
	if listenPort <= 0 && inbound != nil {
		listenPort = inbound.Port
	}
	sk := strings.TrimSpace(st.SecretKey)
	if sk == "" {
		return "", "", "", fmt.Errorf("missing secretKey")
	}
	if _, err := wireguardPeerPublicKeyFromPrivateB64(sk); err != nil {
		return "", "", "", err
	}
	tunnelAddress, tunnelSubnet = amneziaWGTunnelFromSettings(st)
	var out strings.Builder
	out.WriteString("[Interface]\n")
	out.WriteString("PrivateKey = " + sk + "\n")
	if listenPort > 0 {
		out.WriteString(fmt.Sprintf("ListenPort = %d\n", listenPort))
	}
	AppendAmneziaWGObfuscationToConf(&out, st.Obfuscation)
	appendAmneziaWGServerPeers(&out, settings, true)
	return strings.TrimSpace(out.String()) + "\n", tunnelAddress, tunnelSubnet, nil
}

// BuildAmneziaWGServerConf renders wg-quick server config for panel preview (includes Address/MTU/PostUp).
func BuildAmneziaWGServerConf(inbound *model.Inbound, settings map[string]any, listenPort int) (string, error) {
	if settings == nil {
		return "", fmt.Errorf("empty settings")
	}
	b, _ := json.Marshal(settings)
	st, err := ParseAmneziaWGInboundSettings(string(b))
	if err != nil {
		return "", err
	}
	if listenPort <= 0 && inbound != nil {
		listenPort = inbound.Port
	}
	sk := strings.TrimSpace(st.SecretKey)
	if sk == "" {
		return "", fmt.Errorf("missing secretKey")
	}
	if _, err := wireguardPeerPublicKeyFromPrivateB64(sk); err != nil {
		return "", err
	}
	tunnelAddress, tunnelSubnet := amneziaWGTunnelFromSettings(st)
	var out strings.Builder
	out.WriteString("[Interface]\n")
	out.WriteString("PrivateKey = " + sk + "\n")
	out.WriteString("Address = " + tunnelAddress + "\n")
	if listenPort > 0 {
		out.WriteString(fmt.Sprintf("ListenPort = %d\n", listenPort))
	}
	if st.MTU > 0 {
		out.WriteString(fmt.Sprintf("MTU = %d\n", st.MTU))
	}
	AppendAmneziaWGObfuscationToConf(&out, st.Obfuscation)
	appendAmneziaWGRoutingHooks(&out, tunnelSubnet)
	appendAmneziaWGServerPeers(&out, settings, false)
	return strings.TrimSpace(out.String()) + "\n", nil
}

// BuildAmneziaWgPayloadsStandalone builds sidecar payloads for all enabled amneziawg inbounds (panel host).
func BuildAmneziaWgPayloadsStandalone() ([]AmneziaWGNodePayload, error) {
	db := database.GetDB()
	var inbounds []model.Inbound
	if err := db.Where("enable = ?", true).Find(&inbounds).Error; err != nil {
		return nil, err
	}
	cs := ClientService{}
	out := make([]AmneziaWGNodePayload, 0)
	for i := range inbounds {
		ib := &inbounds[i]
		if model.NormalizeProtocol(ib.Protocol) != model.AmneziaWG {
			continue
		}
		clients, err := cs.GetClientsForInbound(ib.Id)
		if err != nil {
			return nil, err
		}
		is := InboundService{}
		settingsJSON, err := is.BuildSettingsFromClientEntities(ib, clients)
		if err != nil {
			return nil, err
		}
		var settings map[string]any
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			return nil, err
		}
		conf, tunnelAddr, tunnelSubnet, err := BuildAmneziaWGSetconf(ib, settings, ib.Port)
		if err != nil {
			return nil, err
		}
		tag := strings.TrimSpace(ib.Tag)
		if tag == "" {
			continue
		}
		out = append(out, AmneziaWGNodePayload{
			InboundId:     ib.Id,
			Tag:           tag,
			Conf:          conf,
			Iface:         amneziaWgIfaceForInbound(ib.Id, tag),
			TunnelAddress: tunnelAddr,
			TunnelSubnet:  tunnelSubnet,
			PeerEmails:    amneziaWGPeerEmailsFromSettings(settings),
		})
	}
	return out, nil
}

// BuildAmneziaWgPayloadsForNode builds AmneziaWG payloads for inbounds assigned to a worker node.
func BuildAmneziaWgPayloadsForNode(node *model.Node, ibs []*model.Inbound) ([]AmneziaWGNodePayload, error) {
	if node == nil {
		return []AmneziaWGNodePayload{}, nil
	}
	ns := NodeService{}
	cs := ClientService{}
	is := InboundService{}
	out := make([]AmneziaWGNodePayload, 0)
	for _, ib := range ibs {
		if ib == nil || !ib.Enable || model.NormalizeProtocol(ib.Protocol) != model.AmneziaWG {
			continue
		}
		clients, err := cs.GetClientsForInbound(ib.Id)
		if err != nil {
			return nil, err
		}
		settingsJSON, err := is.BuildSettingsFromClientEntities(ib, clients)
		if err != nil {
			return nil, err
		}
		var settings map[string]any
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			return nil, err
		}
		port := ib.Port
		views, err := ns.GetInboundNodeBindingViews(ib.Id)
		if err == nil {
			for _, v := range views {
				if v.NodeId == node.Id && v.PublishedPort > 0 {
					port = v.PublishedPort
					break
				}
			}
		}
		conf, tunnelAddr, tunnelSubnet, err := BuildAmneziaWGSetconf(ib, settings, port)
		if err != nil {
			return nil, err
		}
		tag := strings.TrimSpace(ib.Tag)
		if tag == "" {
			continue
		}
		out = append(out, AmneziaWGNodePayload{
			InboundId:     ib.Id,
			Tag:           tag,
			Conf:          conf,
			Iface:         amneziaWgIfaceForInbound(ib.Id, tag),
			TunnelAddress: tunnelAddr,
			TunnelSubnet:  tunnelSubnet,
			PeerEmails:    amneziaWGPeerEmailsFromSettings(settings),
		})
	}
	return out, nil
}

// PreviewAmneziaWgConf returns server .conf for an inbound draft (inbound add/update preview).
func PreviewAmneziaWgConf(inbound *model.Inbound) (string, error) {
	if inbound == nil || model.NormalizeProtocol(inbound.Protocol) != model.AmneziaWG {
		return "", fmt.Errorf("not an amneziawg inbound")
	}
	var settings map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(inbound.Settings)), &settings); err != nil {
		return "", err
	}
	return BuildAmneziaWGServerConf(inbound, settings, inbound.Port)
}
