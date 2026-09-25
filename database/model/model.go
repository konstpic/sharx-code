// Package model defines the database models and data structures used by the SharX panel.
package model

import (
	"encoding/json"
	"strings"

	"github.com/konstpic/sharx-code/v2/util/json_util"
	"github.com/konstpic/sharx-code/v2/xray"
)

// Protocol represents the protocol type for Xray inbounds.
type Protocol string

// Protocol constants for different Xray inbound protocols
const (
	VMESS       Protocol = "vmess"
	VLESS       Protocol = "vless"
	Tunnel      Protocol = "tunnel"
	HTTP        Protocol = "http"
	Trojan      Protocol = "trojan"
	Shadowsocks Protocol = "shadowsocks"
	Mixed       Protocol = "mixed"
	WireGuard   Protocol = "wireguard"
	// Hysteria is the Xray/panel protocol name; v1 vs v2 is stored in settings.version.
	Hysteria  Protocol = "hysteria"
	Hysteria2 Protocol = "hysteria2"
	// Telemt is an MTProto proxy (external binary), not an Xray inbound protocol.
	Telemt Protocol = "telemt"
	// AmneziaWG is AmneziaWG-go userspace (external binary), not an Xray inbound protocol.
	AmneziaWG Protocol = "amneziawg"
)

// IsSidecarProtocol reports inbounds supervised outside Xray-core (Telemt, AmneziaWG-go, …).
func IsSidecarProtocol(p Protocol) bool {
	switch NormalizeProtocol(p) {
	case Telemt, AmneziaWG:
		return true
	default:
		return false
	}
}

// IsXrayInboundProtocol reports whether the panel should emit this inbound into Xray JSON.
func IsXrayInboundProtocol(p Protocol) bool {
	return !IsSidecarProtocol(p)
}

// IsHysteria returns true for both "hysteria" and "hysteria2" (imports may use the v2 literal).
func IsHysteria(p Protocol) bool {
	return p == Hysteria || p == Hysteria2
}

// NormalizeProtocol returns the canonical lowercase protocol id (DB/API may use mixed case).
func NormalizeProtocol(p Protocol) Protocol {
	return Protocol(strings.ToLower(strings.TrimSpace(string(p))))
}

// User represents a user account in the SharX panel.
type User struct {
	Id       int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// APIToken stores metadata for a long-lived API JWT (jti) used with Authorization: Bearer.
type APIToken struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId     int    `json:"userId" gorm:"column:user_id;index"`
	Jti        string `json:"jti" gorm:"column:jti;type:varchar(64);uniqueIndex"`
	Name       string `json:"name" gorm:"column:name;type:varchar(255)"`
	CreatedAt  int64  `json:"createdAt" gorm:"column:created_at"`
	LastUsedAt *int64 `json:"lastUsedAt,omitempty" gorm:"column:last_used_at"`
	RevokedAt  *int64 `json:"revokedAt,omitempty" gorm:"column:revoked_at"`
}

// TableName names the api_tokens table for GORM.
func (APIToken) TableName() string { return "api_tokens" }

// LoginSession is one panel login (browser session) tracked server-side so it can be listed and revoked.
type LoginSession struct {
	Id         string `json:"id" gorm:"primaryKey;column:id;type:varchar(64)"`
	UserId     int    `json:"userId" gorm:"column:user_id;index"`
	IP         string `json:"ip" gorm:"column:ip;type:varchar(64)"`
	UserAgent  string `json:"userAgent" gorm:"column:user_agent"`
	Location   string `json:"location" gorm:"column:location;type:varchar(255)"`
	CreatedAt  int64  `json:"createdAt" gorm:"column:created_at"`
	LastSeenAt int64  `json:"lastSeenAt" gorm:"column:last_seen_at"`
	ExpiresAt  int64  `json:"expiresAt" gorm:"column:expires_at"`
	RevokedAt  *int64 `json:"revokedAt,omitempty" gorm:"column:revoked_at"`
}

// TableName names the login_sessions table for GORM.
func (LoginSession) TableName() string { return "login_sessions" }

// LocalTemplate is a template kept in this panel only (kind: inbound | xray_config); Content is sanitized JSON.
type LocalTemplate struct {
	Id            int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Kind          string `json:"kind" gorm:"column:kind;type:varchar(32);index"`
	Title         string `json:"title" gorm:"column:title;type:varchar(255)"`
	Description   string `json:"description" gorm:"column:description"`
	Tags          string `json:"-" gorm:"column:tags"`
	Content       string `json:"-" gorm:"column:content"`
	SizeBytes     int    `json:"sizeBytes" gorm:"column:size_bytes"`
	SourceCloudID string `json:"sourceCloudId" gorm:"column:source_cloud_id;type:varchar(64)"`
	CreatedAt     int64  `json:"createdAt" gorm:"column:created_at"`
	UpdatedAt     int64  `json:"updatedAt" gorm:"column:updated_at"`
}

// TableName names the local_templates table for GORM.
func (LocalTemplate) TableName() string { return "local_templates" }

// Inbound represents an Xray inbound configuration with traffic statistics and settings.
type Inbound struct {
	Id int `json:"id" form:"id" gorm:"primaryKey;autoIncrement"` // Unique identifier
	// SortOrder is the manual position in the panel lists. It is read-only for GORM (the DB trigger appends new
	// rows and reordering uses dedicated statements), so saving a partially filled struct can never reset it.
	SortOrder            int                  `json:"sortOrder" gorm:"column:sort_order;->"`
	UserId               int                  `json:"-"`                                                                                               // Associated user ID
	Up                   int64                `json:"up" form:"up"`                                                                                    // Upload traffic in bytes
	Down                 int64                `json:"down" form:"down"`                                                                                // Download traffic in bytes
	Total                int64                `json:"total" form:"total"`                                                                              // Total traffic limit in bytes
	AllTime              int64                `json:"allTime" form:"allTime" gorm:"default:0"`                                                         // All-time traffic usage
	Remark               string               `json:"remark" form:"remark"`                                                                            // Human-readable remark
	Enable               bool                 `json:"enable" form:"enable" gorm:"index:idx_enable_traffic_reset,priority:1"`                           // Whether the inbound is enabled
	ExpiryTime           int64                `json:"expiryTime" form:"expiryTime"`                                                                    // Expiration timestamp
	TrafficReset         string               `json:"trafficReset" form:"trafficReset" gorm:"default:never;index:idx_enable_traffic_reset,priority:2"` // Traffic reset schedule
	LastTrafficResetTime int64                `json:"lastTrafficResetTime" form:"lastTrafficResetTime" gorm:"default:0"`                               // Last traffic reset timestamp
	ClientStats          []xray.ClientTraffic `gorm:"foreignKey:InboundId;references:Id" json:"clientStats" form:"clientStats"`                        // Client traffic statistics

	// Xray configuration fields
	Listen         string                   `json:"listen" form:"listen"`
	Port           int                      `json:"port" form:"port"`
	Protocol       Protocol                 `json:"protocol" form:"protocol"`
	Settings       string                   `json:"settings" form:"settings"`
	StreamSettings string                   `json:"streamSettings" form:"streamSettings"`
	Tag            string                   `json:"tag" form:"tag" gorm:"unique"`
	Sniffing       string                   `json:"sniffing" form:"sniffing"`
	NodeId         *int                     `json:"nodeId,omitempty" form:"-" gorm:"-"`       // Node ID (not stored in Inbound table, from mapping) - DEPRECATED: kept only for backward compatibility with old clients, use NodeIds instead
	NodeIds        []int                    `json:"nodeIds,omitempty" form:"-" gorm:"-"`      // Node IDs array (not stored in Inbound table, from mapping) - use this for multi-node support
	NodeBindings   []InboundNodeBindingView `json:"nodeBindings,omitempty" form:"-" gorm:"-"` // Subscription-facing node rows (panel only)
}

// OutboundTraffics tracks traffic statistics for Xray outbound connections.
type OutboundTraffics struct {
	Id    int    `json:"id" form:"id" gorm:"primaryKey;autoIncrement"`
	Tag   string `json:"tag" form:"tag" gorm:"unique"`
	Up    int64  `json:"up" form:"up" gorm:"default:0"`
	Down  int64  `json:"down" form:"down" gorm:"default:0"`
	Total int64  `json:"total" form:"total" gorm:"default:0"`
}

// InboundClientIps stores IP addresses associated with inbound clients for access control.
type InboundClientIps struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ClientName string `json:"clientName" form:"clientName" gorm:"column:client_name;unique"`
	Ips        string `json:"ips" form:"ips"`
}

// HistoryOfSeeders tracks which database seeders have been executed to prevent re-running.
type HistoryOfSeeders struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	SeederName string `json:"seederName"`
}

// GenXrayInboundConfig generates an Xray inbound configuration from the Inbound model.
func (i *Inbound) GenXrayInboundConfig() *xray.InboundConfig {
	// Empty listen becomes JSON null via RawMessage; Xray QUIC/Hysteria inbounds need a real bind address.
	listenAddr := strings.TrimSpace(i.Listen)
	if listenAddr == "" {
		listenAddr = "0.0.0.0"
	}
	listenJSON, err := json.Marshal(listenAddr)
	if err != nil {
		listenJSON = []byte(`"0.0.0.0"`)
	}
	protocol := string(i.Protocol)
	// Xray expects "hysteria" as protocol id; v1/v2 is controlled by settings.version.
	if i.Protocol == Hysteria2 {
		protocol = string(Hysteria)
	}
	return &xray.InboundConfig{
		Listen:         json_util.RawMessage(listenJSON),
		Port:           i.Port,
		Protocol:       protocol,
		Settings:       json_util.RawMessage(i.Settings),
		StreamSettings: json_util.RawMessage(i.StreamSettings),
		Tag:            i.Tag,
		Sniffing:       json_util.RawMessage(i.Sniffing),
	}
}

// Setting stores key-value configuration settings for the SharX panel.
type Setting struct {
	Id    int    `json:"id" form:"id" gorm:"primaryKey;autoIncrement"`
	Key   string `json:"key" form:"key"`
	Value string `json:"value" form:"value"`
}

// Client represents a client configuration for Xray inbounds with traffic limits and settings.
// This is a legacy struct used for JSON parsing from inbound Settings.
// For database operations, use ClientEntity instead.
type Client struct {
	ID          string `json:"id"`                                       // Unique client identifier
	Security    string `json:"security"`                                 // Security method (e.g., "auto", "aes-128-gcm")
	Password    string `json:"password"`                                 // Client password
	Auth        string `json:"auth,omitempty"`                           // Hysteria / Hysteria2 auth (also stored in Password via UI)
	Flow        string `json:"flow"`                                     // Flow control (XTLS)
	Email       string `json:"email"`                                    // Client email identifier
	TotalGB     int64  `json:"totalGB" form:"totalGB"`                   // Total traffic limit in GB
	ExpiryTime  int64  `json:"expiryTime" form:"expiryTime"`             // Expiration timestamp
	Enable      bool   `json:"enable" form:"enable"`                     // Whether the client is enabled
	TgID        int64  `json:"tgId" form:"tgId"`                         // Telegram user ID for notifications
	SubID       string `json:"subId" form:"subId"`                       // Subscription identifier
	Comment     string `json:"comment" form:"comment"`                   // Client comment
	Reset       int    `json:"reset" form:"reset"`                       // Reset period in days
	HWIDEnabled bool   `json:"hwidEnabled,omitempty" form:"hwidEnabled"` // Whether HWID restriction is enabled
	MaxHWID     int    `json:"maxHwid,omitempty" form:"maxHwid"`         // Maximum number of allowed HWID devices (0 = unlimited)
	CreatedAt   int64  `json:"created_at,omitempty"`                     // Creation timestamp
	UpdatedAt   int64  `json:"updated_at,omitempty"`                     // Last update timestamp
}

// ClientEntity represents a client as a separate database entity.
// Clients can be assigned to multiple inbounds.
type ClientEntity struct {
	Id         int     `json:"id" gorm:"primaryKey;autoIncrement"`                // Unique identifier
	UserId     int     `json:"userId" gorm:"index"`                               // Associated user ID
	Name       string  `json:"name" form:"name" gorm:"uniqueIndex:idx_user_name"` // Client name identifier (unique per user, immutable)
	UUID       string  `json:"uuid" form:"uuid"`                                  // UUID/ID for VMESS/VLESS
	Security   string  `json:"security" form:"security"`                          // Security method (e.g., "auto", "aes-128-gcm")
	Password   string  `json:"password" form:"password"`                          // Client password (for Trojan/Shadowsocks)
	Flow       string  `json:"flow" form:"flow"`                                  // Flow control (XTLS)
	TotalGB    float64 `json:"totalGB" form:"totalGB"`                            // Total traffic limit in GB (supports decimal values like 0.01 for MB)
	ExpiryTime int64   `json:"expiryTime" form:"expiryTime"`                      // Expiration timestamp
	Enable     bool    `json:"enable" form:"enable"`                              // Whether the client is enabled
	Status     string  `json:"status" form:"status" gorm:"default:active"`        // Client status: active, expired_traffic, expired_time
	TgID       int64   `json:"tgId" form:"tgId"`                                  // Telegram user ID for notifications
	SubID      string  `json:"subId" form:"subId" gorm:"index"`                   // Subscription identifier
	Comment    string  `json:"comment" form:"comment"`                            // Client comment
	Reset      int     `json:"reset" form:"reset"`                                // Reset period in days (legacy relative period; unused by the calendar-aligned reset below)
	// TrafficResetCadence is the automatic, calendar-aligned traffic reset schedule for this
	// client: "" (off, default) | "daily" | "weekly" | "monthly". Mirrors the inbound-level
	// TrafficReset field but scoped to one client instead of every client on an inbound.
	TrafficResetCadence string `json:"trafficResetCadence" form:"trafficResetCadence" gorm:"column:traffic_reset_cadence;default:''"`
	// TrafficResetDay is the cadence's calendar anchor: ignored for "daily"; day of week
	// 0-6 (Sunday=0) for "weekly"; day of month 1-31 for "monthly". A month shorter than
	// the chosen day (e.g. 31 in April, or 29-31 in February) resets on that month's last
	// day instead — clamped, not skipped, so the client never gets an extra period for free.
	TrafficResetDay      int   `json:"trafficResetDay" form:"trafficResetDay" gorm:"column:traffic_reset_day;default:0"`
	LastTrafficResetTime int64 `json:"lastTrafficResetTime" form:"-" gorm:"column:last_traffic_reset_time;default:0"` // ms epoch of the last automatic reset
	CreatedAt            int64 `json:"createdAt" gorm:"autoCreateTime"`                                               // Creation timestamp
	UpdatedAt            int64 `json:"updatedAt" gorm:"autoUpdateTime"`                                               // Last update timestamp

	// Relations (not stored in DB, loaded via joins)
	InboundIds []int `json:"inboundIds,omitempty" form:"-" gorm:"-"` // Inbound IDs this client is assigned to
	// Per-inbound Telemt ad tags (inboundId string -> 32 hex); stored on client_inbound_mappings.telemt_ad_tag.
	TelemtAdTags map[string]string `json:"telemtAdTags,omitempty" form:"-" gorm:"-"`

	// Group assignment
	GroupId *int `json:"groupId,omitempty" form:"groupId" gorm:"column:group_id;index"` // Group ID (nullable, client can belong to one group)

	// Traffic statistics (stored directly in ClientEntity table)
	Up      int64 `json:"up" form:"-" gorm:"default:0"`      // Upload traffic in bytes
	Down    int64 `json:"down" form:"-" gorm:"default:0"`    // Download traffic in bytes
	AllTime int64 `json:"allTime" form:"-" gorm:"default:0"` // All-time traffic usage

	// Speed statistics (calculated on backend, not stored in DB)
	UpSpeed    int64 `json:"upSpeed" form:"-" gorm:"-"`            // Upload speed in bits per second (calculated)
	DownSpeed  int64 `json:"downSpeed" form:"-" gorm:"-"`          // Download speed in bits per second (calculated)
	LastOnline int64 `json:"lastOnline" form:"-" gorm:"default:0"` // Last online timestamp
	// Multi-node live hint: last node where this client was observed online.
	// Not persisted in DB; refreshed from node stats collector.
	LastConnectedNode string `json:"lastConnectedNode,omitempty" form:"-" gorm:"-"`

	// HWID (Hardware ID) restrictions
	HWIDEnabled bool          `json:"hwidEnabled" form:"hwidEnabled" gorm:"column:hwid_enabled;default:false"` // Whether HWID restriction is enabled for this client
	MaxHWID     int           `json:"maxHwid" form:"maxHwid" gorm:"column:max_hwid;default:1"`                 // Maximum number of allowed HWID devices (0 = unlimited)
	HWIDs       []*ClientHWID `json:"hwids,omitempty" form:"-" gorm:"-"`                                       // Registered HWIDs for this client (loaded from client_hwids table, not stored in ClientEntity table)

	// Concurrent unique source IP limit (separate from HWID)
	IPLimitEnabled bool `json:"ipLimitEnabled" form:"ipLimitEnabled" gorm:"column:ip_limit_enabled;default:false"`
	MaxIPs         int  `json:"maxIPs" form:"maxIPs" gorm:"column:max_ips;default:1"`

	// Subscription customization
	Announce string `json:"announce,omitempty" form:"announce" gorm:"column:announce"` // Custom announcement text for this client (overrides subscription header, max 200 chars, supports base64)
}

// ClientCardInboundBrief is inbound metadata attached to panel client cards.
type ClientCardInboundBrief struct {
	Id       int    `json:"id"`
	Remark   string `json:"remark"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Tag      string `json:"tag"`
}

// ClientInboundShareLink is one share link for a client on a specific inbound.
type ClientInboundShareLink struct {
	InboundId int    `json:"inboundId"`
	Remark    string `json:"remark"`
	Protocol  string `json:"protocol"`
	Link      string `json:"link"`
	// WgConf is wg-quick [Interface]/[Peer] only (WireGuard / AmneziaWG QR and .conf import).
	WgConf string `json:"wgConf,omitempty"`
}

// ClientCardView is the unified API model for client list and detail in the panel.
type ClientCardView struct {
	ClientEntity
	ActiveHwidCount     int                      `json:"activeHwidCount"`
	Inbounds            []ClientCardInboundBrief `json:"inbounds"`
	SubscriptionURL     string                   `json:"subscriptionUrl,omitempty"`
	SubscriptionJsonURL string                   `json:"subscriptionJsonUrl,omitempty"`
	// SubscriptionPageURL is the first-party HTML subscription page (/panel/sub/) when configured; omit if same as SubscriptionURL.
	SubscriptionPageURL string `json:"subscriptionPageUrl,omitempty"`
	// IsOnline is true when this client's email is in the current Xray online set (local + multi-node sync).
	IsOnline bool `json:"isOnline"`
}

// Node XrayState values: worker core lifecycle as reported by the node API or panel actions.
const (
	NodeXrayRunning = "running"
	NodeXrayStopped = "stopped"
	NodeXrayError   = "error"
	NodeXrayUnknown = "unknown"
)

// Node TelemtState values: worker Telemt sidecars as reported by the node API.
const (
	NodeTelemtRunning = "running"
	NodeTelemtStopped = "stopped"
	NodeTelemtUnknown = "unknown"
)

// Node AmneziaWgState values: worker AmneziaWG sidecars as reported by the node API.
const (
	NodeAmneziaWgRunning = "running"
	NodeAmneziaWgStopped = "stopped"
	NodeAmneziaWgUnknown = "unknown"
)

// Node represents a worker node in multi-node architecture.
type Node struct {
	// SortOrder is the manual position in the panel lists (read-only for GORM, see Inbound.SortOrder).
	SortOrder      int    `json:"sortOrder" gorm:"column:sort_order;->"`
	Id             int    `json:"id" gorm:"primaryKey;autoIncrement"`                                      // Unique identifier
	Name           string `json:"name" form:"name"`                                                        // Node name/identifier
	Address        string `json:"address" form:"address"`                                                  // Node API address (e.g., "http://192.168.1.100:8080" or "https://...")
	ApiKey         string `json:"apiKey" form:"apiKey"`                                                    // API key for authentication
	Status         string `json:"status" gorm:"default:unknown"`                                           // Status: online, offline, unknown
	LastCheck      int64  `json:"lastCheck" gorm:"default:0"`                                              // Last health check timestamp
	ResponseTime   int64  `json:"responseTime" gorm:"default:0"`                                           // Response time in milliseconds (0 = not measured or error)
	UseTLS         bool   `json:"useTls" form:"useTls" gorm:"column:use_tls;default:false"`                // Whether to use TLS/HTTPS for API calls
	CertPath       string `json:"certPath" form:"certPath" gorm:"column:cert_path"`                        // Path to certificate file (optional, for custom CA)
	KeyPath        string `json:"keyPath" form:"keyPath" gorm:"column:key_path"`                           // Path to private key file (optional, for custom CA)
	InsecureTLS    bool   `json:"insecureTls" form:"insecureTls" gorm:"column:insecure_tls;default:false"` // Skip certificate verification (not recommended)
	CreatedAt      int64  `json:"createdAt" gorm:"autoCreateTime"`                                         // Creation timestamp
	UpdatedAt      int64  `json:"updatedAt" gorm:"autoUpdateTime"`                                         // Last update timestamp
	Enable         bool   `json:"enable" form:"enable" gorm:"column:enable;default:true"`                  // When false, panel skips health checks, stats collection, and config push
	XrayState      string `json:"xrayState" gorm:"column:xray_state;default:unknown"`                      // running | stopped | error | unknown (worker Xray)
	XrayVersion    string `json:"xrayVersion" gorm:"column:xray_version;default:''"`                       // cached Xray version from worker (e.g. "26.5.3"), empty when unknown
	WorkerVersion  string `json:"workerVersion" gorm:"column:worker_version;default:''"`                   // cached SharX worker build/version from node API (sharxVersion)
	TelemtState    string `json:"telemtState" gorm:"column:telemt_state;default:unknown"`                  // running | stopped | unknown (worker Telemt sidecars)
	TelemtVersion  string `json:"telemtVersion" gorm:"column:telemt_version;default:''"`                   // cached Telemt version from worker (e.g. "3.4.13"), empty when unknown
	AmneziaWgState string `json:"amneziawgState" gorm:"column:amneziawg_state;default:unknown"`            // running | stopped | unknown (worker AmneziaWG sidecars)

	// Admin-selected core versions (empty = not pinned, worker keeps whatever it already has).
	// Set when the admin explicitly installs a version via the panel; re-asserted on health
	// check if the worker ever reports a different version (e.g. after losing its bin volume).
	XrayPinnedVersion   string `json:"xrayPinnedVersion" gorm:"column:xray_pinned_version;default:''"`
	TelemtPinnedVersion string `json:"telemtPinnedVersion" gorm:"column:telemt_pinned_version;default:''"`

	// Pairing (auth_mode=pairing): panel stores JWT key and mTLS client cert; worker uses SECRET_KEY. Legacy values accepted; see IsPairingMode.
	AuthMode           string `json:"authMode" gorm:"column:auth_mode;default:legacy"` // legacy | pairing
	JwtPrivateKeyPem   string `json:"-" gorm:"column:jwt_private_key_pem;type:text"`
	PanelClientCertPem string `json:"-" gorm:"column:panel_client_cert_pem;type:text"`
	PanelClientKeyPem  string `json:"-" gorm:"column:panel_client_key_pem;type:text"`
	CaCertPem          string `json:"-" gorm:"column:ca_cert_pem;type:text"` // CA: trust node server cert + issue client certs

	// Traffic statistics
	Up              int64   `json:"up" gorm:"default:0"`                                                              // Upload traffic in bytes
	Down            int64   `json:"down" gorm:"default:0"`                                                            // Download traffic in bytes
	AllTime         int64   `json:"allTime" gorm:"default:0"`                                                         // All-time traffic usage in bytes
	TrafficLimitGB  float64 `json:"trafficLimitGB" form:"trafficLimitGB" gorm:"column:traffic_limit_gb;default:0"`    // Traffic limit in GB (0 = unlimited)
	TrafficResetDay int     `json:"trafficResetDay" form:"trafficResetDay" gorm:"column:traffic_reset_day;default:0"` // Day of month to reset counters (0 = off, 1-31)

	// Egress IP geolocation (map); optional, updated on node startup / push-geo.
	GeoLat       *float64 `json:"geoLat,omitempty" gorm:"column:geo_lat"`
	GeoLng       *float64 `json:"geoLng,omitempty" gorm:"column:geo_lng"`
	GeoUpdatedAt int64    `json:"geoUpdatedAt" gorm:"column:geo_updated_at;default:0"`
	GeoSource    string   `json:"geoSource,omitempty" gorm:"column:geo_source"`
}

// legacyNodeAuthModePairing is the auth_mode token stored before the pairing rename migration; treated as pairing.
const legacyNodeAuthModePairing = "remna"

// IsPairingMode reports SECRET_KEY + JWT + mTLS auth (pairing and legacy pre-rename value).
func (n *Node) IsPairingMode() bool {
	if n == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(n.AuthMode)) {
	case "pairing", legacyNodeAuthModePairing:
		return true
	default:
		return false
	}
}

// PanelPairing holds the panel-wide material used to pair with SharX nodes.
// The same SECRET_KEY is shared by every node; nodes receive it via the SECRET_KEY env var.
// Only id=1 is stored — it is a singleton.
type PanelPairing struct {
	Id                 int    `json:"id" gorm:"primaryKey"`
	SecretKey          string `json:"-" gorm:"column:secret_key;type:text;not null"`
	CaCertPem          string `json:"-" gorm:"column:ca_cert_pem;type:text;not null"`
	CaKeyPem           string `json:"-" gorm:"column:ca_key_pem;type:text;not null"`
	NodeCertPem        string `json:"-" gorm:"column:node_cert_pem;type:text;not null"`
	NodeKeyPem         string `json:"-" gorm:"column:node_key_pem;type:text;not null"`
	PanelClientCertPem string `json:"-" gorm:"column:panel_client_cert_pem;type:text;not null"`
	PanelClientKeyPem  string `json:"-" gorm:"column:panel_client_key_pem;type:text;not null"`
	JwtPrivateKeyPem   string `json:"-" gorm:"column:jwt_private_key_pem;type:text;not null"`
	JwtPublicKeyPem    string `json:"-" gorm:"column:jwt_public_key_pem;type:text;not null"`
	AuthSecret         string `json:"-" gorm:"column:auth_secret;type:text;not null"`
	CreatedAt          int64  `json:"createdAt" gorm:"column:created_at"`
	UpdatedAt          int64  `json:"updatedAt" gorm:"column:updated_at"`
}

// TableName returns the DB table name for PanelPairing.
func (PanelPairing) TableName() string { return "panel_pairing" }

// Host subscription apply modes (addresses shown in client subscription links).
const (
	HostSubscriptionApplyReplace = "replace"
	HostSubscriptionApplyPrepend = "prepend"
	HostSubscriptionApplyAppend  = "append"
)

// NormalizeHostSubscriptionApplyMode returns a supported subscription apply mode.
func NormalizeHostSubscriptionApplyMode(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case HostSubscriptionApplyPrepend:
		return HostSubscriptionApplyPrepend
	case HostSubscriptionApplyAppend:
		return HostSubscriptionApplyAppend
	default:
		return HostSubscriptionApplyReplace
	}
}

// InboundNodeMapping maps inbounds to nodes in multi-node mode.
type InboundNodeMapping struct {
	Id        int `json:"id" gorm:"primaryKey;autoIncrement"`                             // Unique identifier
	InboundId int `json:"inboundId" form:"inboundId" gorm:"uniqueIndex:idx_inbound_node"` // Inbound ID
	NodeId    int `json:"nodeId" form:"nodeId" gorm:"uniqueIndex:idx_inbound_node"`       // Node ID
	SortOrder int `json:"sortOrder" gorm:"column:sort_order;default:0"`                   // Order in subscription / UI

	// Subscription link overrides (worker connection still uses node.Address).
	PublishedAddress         string `json:"publishedAddress" gorm:"column:published_address"`
	PublishedPort            int    `json:"publishedPort" gorm:"column:published_port"` // 0 = use inbound port
	IncludeInSubscription    bool   `json:"includeInSubscription" gorm:"column:include_in_subscription;default:true"`
	SubscriptionRemarkSuffix string `json:"subscriptionRemarkSuffix" gorm:"column:subscription_remark_suffix"`
	ServerDescription        string `json:"serverDescription" gorm:"column:server_description"`
}

// InboundNodeBindingView is returned to the panel for editing subscription-facing node rows.
type InboundNodeBindingView struct {
	NodeId                   int    `json:"nodeId"`
	NodeName                 string `json:"nodeName,omitempty"`
	SortOrder                int    `json:"sortOrder"`
	PublishedAddress         string `json:"publishedAddress"`
	PublishedPort            int    `json:"publishedPort"`
	IncludeInSubscription    bool   `json:"includeInSubscription"`
	SubscriptionRemarkSuffix string `json:"subscriptionRemarkSuffix"`
	ServerDescription        string `json:"serverDescription"`
}

// Outbound represents an Xray outbound configuration.
// Outbounds can be assigned to specific nodes in multi-node mode.
type Outbound struct {
	Id             int    `json:"id" form:"id" gorm:"primaryKey;autoIncrement"` // Unique identifier
	UserId         int    `json:"userId" gorm:"index"`                          // Associated user ID
	Remark         string `json:"remark" form:"remark"`                         // Human-readable remark
	Enable         bool   `json:"enable" form:"enable" gorm:"default:true"`     // Whether the outbound is enabled
	Protocol       string `json:"protocol" form:"protocol"`                     // Outbound protocol (freedom, blackhole, socks, http, vmess, vless, trojan, shadowsocks, wireguard, etc.)
	Settings       string `json:"settings" form:"settings"`                     // Protocol-specific settings (JSON)
	StreamSettings string `json:"streamSettings" form:"streamSettings"`         // Stream settings (JSON, optional)
	Tag            string `json:"tag" form:"tag" gorm:"unique"`                 // Outbound tag (must be unique)
	ProxySettings  string `json:"proxySettings" form:"proxySettings"`           // Proxy settings for chaining (JSON, optional)
	SendThrough    string `json:"sendThrough" form:"sendThrough"`               // Send through address (optional)
	Mux            string `json:"mux" form:"mux"`                               // Mux settings (JSON, optional)
	CreatedAt      int64  `json:"createdAt" gorm:"autoCreateTime"`              // Creation timestamp
	UpdatedAt      int64  `json:"updatedAt" gorm:"autoUpdateTime"`              // Last update timestamp

	// Relations (not stored in DB, loaded via queries)
	NodeIds []int `json:"nodeIds,omitempty" form:"-" gorm:"-"` // Node IDs array (not stored in Outbound table, from mapping) - use this for multi-node support

	// Core config profile relation
	CoreConfigProfileId *int `json:"coreConfigProfileId,omitempty" form:"coreConfigProfileId" gorm:"index"` // Xray core config profile ID (optional)
}

// OutboundNodeMapping maps outbounds to nodes in multi-node mode.
type OutboundNodeMapping struct {
	Id         int `json:"id" gorm:"primaryKey;autoIncrement"`                                // Unique identifier
	OutboundId int `json:"outboundId" form:"outboundId" gorm:"uniqueIndex:idx_outbound_node"` // Outbound ID
	NodeId     int `json:"nodeId" form:"nodeId" gorm:"uniqueIndex:idx_outbound_node"`         // Node ID
}

// XrayCoreConfigProfile represents an Xray core configuration profile for multi-node mode.
// Each profile contains a complete Xray configuration (routing, dns, log, policy, stats, inbounds, outbounds)
// that can be assigned to nodes.
type XrayCoreConfigProfile struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`              // Unique identifier
	UserId      int    `json:"userId" form:"userId" gorm:"index"`               // Associated user ID
	Name        string `json:"name" form:"name"`                                // Profile name
	Description string `json:"description" form:"description"`                  // Profile description
	ConfigJson  string `json:"configJson" form:"configJson" gorm:"type:text"`   // Full Xray JSON config
	IsDefault   bool   `json:"isDefault" form:"isDefault" gorm:"default:false"` // Whether this is the default profile
	CreatedAt   int64  `json:"createdAt" gorm:"autoCreateTime"`                 // Creation timestamp
	UpdatedAt   int64  `json:"updatedAt" gorm:"autoUpdateTime"`                 // Last update timestamp

	// Relations (not stored in DB, loaded via queries)
	NodeIds []int `json:"nodeIds,omitempty" form:"-" gorm:"-"` // Node IDs array (not stored in Profile table, from mapping) - use this for multi-node support
	// ConfigHash is SHA-256 (hex) of ConfigJson as stored; for change tracking and client sync.
	ConfigHash string `json:"configHash,omitempty" form:"-" gorm:"-"`
}

// ProfileNodeMapping maps profiles to nodes in multi-node mode.
type ProfileNodeMapping struct {
	Id        int `json:"id" gorm:"primaryKey;autoIncrement"`                             // Unique identifier
	ProfileId int `json:"profileId" form:"profileId" gorm:"uniqueIndex:idx_profile_node"` // Profile ID
	NodeId    int `json:"nodeId" form:"nodeId" gorm:"uniqueIndex:idx_profile_node"`       // Node ID
}

// ClientInboundMapping maps clients to inbounds (many-to-many relationship).
type ClientInboundMapping struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`                               // Unique identifier
	ClientId     int    `json:"clientId" form:"clientId" gorm:"uniqueIndex:idx_client_inbound"`   // Client ID
	InboundId    int    `json:"inboundId" form:"inboundId" gorm:"uniqueIndex:idx_client_inbound"` // Inbound ID
	SortOrder    int    `json:"sortOrder" gorm:"column:sort_order;default:0"`                     // Order in subscription output
	TelemtSecret string `json:"telemtSecret,omitempty" gorm:"column:telemt_secret"`               // 32 hex; Telemt [access.users] secret for this mapping
	TelemtAdTag  string `json:"telemtAdTag,omitempty" gorm:"column:telemt_ad_tag"`                // 32 hex; Telemt [access.user_ad_tags] for this mapping
}

// ClientNodeTraffic stores cumulative per-node client traffic (multi-node).
// Values follow Xray user>>> traffic stats (uplink/downlink); same orientation as node /stats JSON.
type ClientNodeTraffic struct {
	Id        int   `json:"id" gorm:"primaryKey;autoIncrement"`
	ClientId  int   `json:"clientId" gorm:"uniqueIndex:uq_client_node_traffics_pair;not null;index"`
	NodeId    int   `json:"nodeId" gorm:"uniqueIndex:uq_client_node_traffics_pair;not null;index"`
	Up        int64 `json:"up" gorm:"default:0"`
	Down      int64 `json:"down" gorm:"default:0"`
	UpdatedAt int64 `json:"updatedAt" gorm:"default:0"`
}

func (ClientNodeTraffic) TableName() string { return "client_node_traffics" }

// Host represents a proxy/balancer host configuration for multi-node mode.
// Hosts can override the node address when generating subscription links.
type Host struct {
	Id       int    `json:"id" gorm:"primaryKey;autoIncrement"` // Unique identifier
	UserId   int    `json:"userId" gorm:"index"`                // Associated user ID
	Name     string `json:"name" form:"name"`                   // Host name/identifier
	Address  string `json:"address" form:"address"`             // Host address (IP or domain)
	Port     int    `json:"port" form:"port"`                   // Host port (0 means use inbound port)
	Protocol string `json:"protocol" form:"protocol"`           // Protocol override (optional)
	Remark   string `json:"remark" form:"remark"`               // Host remark/description
	Enable   bool   `json:"enable" form:"enable"`               // Whether the host is enabled
	// SubscriptionApplyMode: replace (default) | prepend | append — how Host combines with multi-node addresses in subscription links.
	SubscriptionApplyMode string `json:"subscriptionApplyMode" gorm:"column:subscription_apply_mode;default:replace"`
	// Subscription link overrides (optional); empty string = inherit from inbound stream settings.
	SubscriptionSNI           string `json:"subscriptionSni" gorm:"column:subscription_sni"`
	SubscriptionHttpHost      string `json:"subscriptionHttpHost" gorm:"column:subscription_http_host"`
	SubscriptionPath          string `json:"subscriptionPath" gorm:"column:subscription_path"`
	SubscriptionAlpn          string `json:"subscriptionAlpn" gorm:"column:subscription_alpn"`
	SubscriptionFingerprint   string `json:"subscriptionFingerprint" gorm:"column:subscription_fp"`
	SubscriptionAllowInsecure *bool  `json:"subscriptionAllowInsecure,omitempty" gorm:"column:subscription_allow_insecure"` // nil = inherit from inbound
	// SubscriptionSecurity overrides the security/tls field in share links:
	//   "" (default) — inherit from inbound stream settings,
	//   "tls"        — force security=tls (e.g. when a TLS terminator fronts Xray),
	//   "none"       — force security=none (e.g. when Xray serves plain TCP).
	SubscriptionSecurity string `json:"subscriptionSecurity" gorm:"column:subscription_security;default:''"`

	// Bundle scheme (docs/architecture/bundles.md). Kind "legacy" is a pre-bundle Host (many inbounds, apply mode);
	// the other kinds are bound to exactly one inbound.
	Kind              string `json:"kind" gorm:"column:kind;default:legacy"`             // legacy | address | placement | pool
	InboundId         *int   `json:"inboundId,omitempty" gorm:"column:inbound_id"`       // the one inbound this host delivers
	NodeId            *int   `json:"nodeId,omitempty" gorm:"column:node_id"`             // placement hosts
	PoolId            *int   `json:"poolId,omitempty" gorm:"column:pool_id"`             // pool hosts
	Source            string `json:"source" gorm:"column:source;default:manual"`         // manual | placement | pool | legacy
	Customized        bool   `json:"customized" gorm:"column:customized"`                // edited by an operator: the sync stops overwriting it
	RemarkSuffix      string `json:"remarkSuffix" gorm:"column:remark_suffix"`           // placement hosts: suffix added to the server name
	ServerDescription string `json:"serverDescription" gorm:"column:server_description"` // placement hosts: server description
	SortOrder         int    `json:"sortOrder" gorm:"column:sort_order"`                 // default position in lists
	CreatedAt         int64  `json:"createdAt" gorm:"autoCreateTime"`                    // Creation timestamp
	UpdatedAt         int64  `json:"updatedAt" gorm:"autoUpdateTime"`                    // Last update timestamp

	// Relations (not stored in DB, loaded via joins)
	InboundIds []int `json:"inboundIds,omitempty" form:"-" gorm:"-"` // Inbound IDs this host applies to
}

// Host kinds and sources.
const (
	HostKindLegacy    = "legacy"
	HostKindAddress   = "address"
	HostKindPlacement = "placement"
	HostKindPool      = "pool"

	HostSourceManual    = "manual"
	HostSourcePlacement = "placement"
	HostSourcePool      = "pool"
	HostSourceLegacy    = "legacy"
)

// Bundle is an ordered set of hosts. A client in a bundle gets its hosts in the subscription and access to their inbounds.
type Bundle struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId           int    `json:"userId" gorm:"column:user_id"`
	Name             string `json:"name" form:"name"`
	Description      string `json:"description" form:"description"`
	Enable           bool   `json:"enable" gorm:"column:enable"`
	Auto             bool   `json:"auto" gorm:"column:auto"` // created by the API compatibility layer or the conversion
	AutoKey          string `json:"autoKey,omitempty" gorm:"column:auto_key"`
	FollowPlacements bool   `json:"followPlacements" gorm:"column:follow_placements"`
	SortOrder        int    `json:"sortOrder" gorm:"column:sort_order"`
	CreatedAt        int64  `json:"createdAt" gorm:"column:created_at"`
	UpdatedAt        int64  `json:"updatedAt" gorm:"column:updated_at"`

	Hosts       []BundleHost `json:"hosts,omitempty" gorm:"-"`
	ClientCount int          `json:"clientCount" gorm:"-"`
}

func (Bundle) TableName() string { return "bundles" }

// BundleHost places a host in a bundle. Hidden hosts are not listed in the subscription but still grant access.
type BundleHost struct {
	Id        int  `json:"id" gorm:"primaryKey;autoIncrement"`
	BundleId  int  `json:"bundleId" gorm:"column:bundle_id"`
	HostId    int  `json:"hostId" gorm:"column:host_id"`
	SortOrder int  `json:"sortOrder" gorm:"column:sort_order"`
	Hidden    bool `json:"hidden" gorm:"column:hidden"`

	Host *Host `json:"host,omitempty" gorm:"-"`
}

func (BundleHost) TableName() string { return "bundle_hosts" }

// ClientBundle is a client's membership of a bundle.
type ClientBundle struct {
	Id        int   `json:"id" gorm:"primaryKey;autoIncrement"`
	ClientId  int   `json:"clientId" gorm:"column:client_id"`
	BundleId  int   `json:"bundleId" gorm:"column:bundle_id"`
	SortOrder int   `json:"sortOrder" gorm:"column:sort_order"`
	CreatedAt int64 `json:"createdAt" gorm:"column:created_at"`
}

func (ClientBundle) TableName() string { return "client_bundles" }

// HostInboundMapping maps hosts to inbounds (many-to-many relationship).
type HostInboundMapping struct {
	Id        int `json:"id" gorm:"primaryKey;autoIncrement"`                             // Unique identifier
	HostId    int `json:"hostId" form:"hostId" gorm:"uniqueIndex:idx_host_inbound"`       // Host ID
	InboundId int `json:"inboundId" form:"inboundId" gorm:"uniqueIndex:idx_host_inbound"` // Inbound ID
}

// ClientHWID represents a hardware ID (HWID) associated with a client.
// HWID is provided explicitly by client applications via HTTP headers (x-hwid).
// Server MUST NOT generate or derive HWID from IP, User-Agent, or access logs.
type ClientHWID struct {
	// TableName specifies the table name for GORM
	// GORM by default would use "client_hwids" but the actual table is "client_hw_ids"
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`                                     // Unique identifier
	ClientId    int    `json:"clientId" form:"clientId" gorm:"column:client_id;index:idx_client_hwid"` // Client ID
	HWID        string `json:"hwid" form:"hwid" gorm:"column:hwid;index:idx_client_hwid"`              // Hardware ID (unique per client, provided by client via x-hwid header)
	DeviceName  string `json:"deviceName" form:"deviceName" gorm:"column:device_name"`                 // Optional device name/description (deprecated, use DeviceModel instead)
	DeviceOS    string `json:"deviceOs" form:"deviceOs" gorm:"column:device_os"`                       // Device operating system (from x-device-os header)
	DeviceModel string `json:"deviceModel" form:"deviceModel" gorm:"column:device_model"`              // Device model (from x-device-model header)
	OSVersion   string `json:"osVersion" form:"osVersion" gorm:"column:os_version"`                    // OS version (from x-ver-os header)
	FirstSeenAt int64  `json:"firstSeenAt" gorm:"column:first_seen_at"`                                // First time this HWID was seen (timestamp)
	LastSeenAt  int64  `json:"lastSeenAt" gorm:"column:last_seen_at"`                                  // Last time this HWID was used (timestamp)
	FirstSeenIP string `json:"firstSeenIp" form:"firstSeenIp" gorm:"column:first_seen_ip"`             // IP address when first seen
	IsActive    bool   `json:"isActive" form:"isActive" gorm:"column:is_active;default:true"`          // Whether this HWID is currently active
	IPAddress   string `json:"ipAddress" form:"ipAddress" gorm:"column:ip_address"`                    // Last known IP address for this HWID
	UserAgent   string `json:"userAgent" form:"userAgent" gorm:"column:user_agent"`                    // User agent or client identifier (if available)
	BlockedAt   *int64 `json:"blockedAt,omitempty" form:"blockedAt" gorm:"column:blocked_at"`          // Timestamp when HWID was blocked (null if not blocked)
	BlockReason string `json:"blockReason,omitempty" form:"blockReason" gorm:"column:block_reason"`    // Reason for blocking (e.g., "HWID limit exceeded")
	// Blocked is true when BlockedAt is set (panel UX); not a DB column.
	Blocked bool `json:"blocked" form:"blocked" gorm:"-"`

	// Legacy fields (deprecated, kept for backward compatibility)
	FirstSeen int64 `json:"firstSeen,omitempty" gorm:"-"` // Deprecated: use FirstSeenAt
	LastSeen  int64 `json:"lastSeen,omitempty" gorm:"-"`  // Deprecated: use LastSeenAt
}

// TableName specifies the table name for ClientHWID.
// GORM by default would use "client_hwids" but the actual table is "client_hw_ids"
func (ClientHWID) TableName() string {
	return "client_hw_ids"
}

// ClientBlockedSessionIP is a client-scoped block on subscription traffic from a source IP (session).
type ClientBlockedSessionIP struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ClientId  int    `json:"clientId" gorm:"column:client_id;index"`
	IP        string `json:"ip" gorm:"column:ip"`
	CreatedAt int64  `json:"createdAt" gorm:"column:created_at"`
	ExpiresAt int64  `json:"expiresAt" gorm:"column:expires_at;default:0"` // 0 = no expiry (manual / permanent)
}

func (ClientBlockedSessionIP) TableName() string {
	return "client_blocked_session_ips"
}

// ClientGroup represents a group of clients for organization and bulk operations.
type ClientGroup struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"` // Unique identifier
	UserId      int    `json:"userId" gorm:"index"`                // Associated user ID
	Name        string `json:"name" form:"name"`                   // Group name
	Description string `json:"description" form:"description"`     // Group description
	CreatedAt   int64  `json:"createdAt" gorm:"autoCreateTime"`    // Creation timestamp
	UpdatedAt   int64  `json:"updatedAt" gorm:"autoUpdateTime"`    // Last update timestamp

	// Relations (not stored in DB, loaded via queries)
	ClientCount int `json:"clientCount,omitempty" form:"-" gorm:"-"` // Number of clients in this group (computed)
}

// GeofileAsset is a stored geofile in the panel library.
type GeofileAsset struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId      int    `json:"userId" gorm:"column:user_id;index"`
	FileType    string `json:"fileType" gorm:"column:file_type;index"` // geoip | geosite
	DisplayName string `json:"displayName" gorm:"column:display_name"`
	SourceURL   string `json:"sourceUrl" gorm:"column:source_url"`
	FilePath    string `json:"filePath" gorm:"column:file_path;uniqueIndex"`
	SizeBytes   int64  `json:"sizeBytes" gorm:"column:size_bytes"`
	Sha256      string `json:"sha256" gorm:"column:sha256;type:varchar(64)"`
	IsActive    bool   `json:"isActive" gorm:"column:is_active;default:false;index"`
	CreatedAt   int64  `json:"createdAt" gorm:"column:created_at;index"`
}

func (GeofileAsset) TableName() string {
	return "geofile_assets"
}

// Balancer engines and pool options. See docs/architecture/balancer.md.
const (
	BalancerEngineHAProxy = "haproxy"
	BalancerEngineNginx   = "nginx"

	BalancerAlgoRoundRobin = "roundrobin"
	BalancerAlgoLeastConn  = "leastconn"
	BalancerAlgoSource     = "source"

	BalancerSubReplace = "replace"
	BalancerSubPrepend = "prepend"
	BalancerSubAppend  = "append"
)

// Balancer is a separate server running an L4 proxy (HAProxy or nginx stream) in front of nodes.
// It is managed like a node (agent API with the panel JWT) but never runs Xray.
type Balancer struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Name       string `json:"name" form:"name"`
	Address    string `json:"address" form:"address"`                                 // public host clients connect to
	ApiAddress string `json:"apiAddress" form:"apiAddress" gorm:"column:api_address"` // agent API base URL, e.g. http://1.2.3.4:8080
	Remark     string `json:"remark" form:"remark"`
	Engine     string `json:"engine" form:"engine"`
	Enable     bool   `json:"enable" form:"enable" gorm:"column:enable;default:true"`

	Status        string `json:"status" gorm:"default:unknown"`
	LastCheck     int64  `json:"lastCheck" gorm:"column:last_check"`
	ResponseTime  int64  `json:"responseTime" gorm:"column:response_time"`
	AgentVersion  string `json:"agentVersion" gorm:"column:agent_version"`
	EngineVersion string `json:"engineVersion" gorm:"column:engine_version"`
	ConfigHash    string `json:"configHash" gorm:"column:config_hash"`
	AppliedHash   string `json:"appliedHash" gorm:"column:applied_hash"`
	LastAppliedAt int64  `json:"lastAppliedAt" gorm:"column:last_applied_at"`
	LastError     string `json:"lastError" gorm:"column:last_error"`

	// SortOrder is the manual position in the panel list (read-only for GORM, see Inbound.SortOrder).
	SortOrder int   `json:"sortOrder" gorm:"column:sort_order;->"`
	CreatedAt int64 `json:"createdAt" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updatedAt" gorm:"autoUpdateTime"`

	Pools []BalancerPool `json:"pools,omitempty" gorm:"-"`
}

func (Balancer) TableName() string { return "balancers" }

// BalancerPool puts one inbound behind one balancer.
type BalancerPool struct {
	Id            int    `json:"id" gorm:"primaryKey;autoIncrement"`
	BalancerId    int    `json:"balancerId" gorm:"column:balancer_id"`
	InboundId     int    `json:"inboundId" gorm:"column:inbound_id"`
	ListenPort    int    `json:"listenPort" gorm:"column:listen_port"` // 0 = inbound port
	Algorithm     string `json:"algorithm"`
	ProxyProtocol bool   `json:"proxyProtocol" gorm:"column:proxy_protocol"`
	HealthCheck   bool   `json:"healthCheck" gorm:"column:health_check"`
	SubEnabled    bool   `json:"subEnabled" gorm:"column:sub_enabled"`
	SubMode       string `json:"subMode" gorm:"column:sub_mode"`
	AutoMembers   bool   `json:"autoMembers" gorm:"column:auto_members"`
	Enable        bool   `json:"enable" gorm:"column:enable"`
	SortOrder     int    `json:"sortOrder" gorm:"column:sort_order"`
	CreatedAt     int64  `json:"createdAt" gorm:"column:created_at"`
	UpdatedAt     int64  `json:"updatedAt" gorm:"column:updated_at"`

	// Read-only extras for the panel.
	InboundRemark   string               `json:"inboundRemark,omitempty" gorm:"-"`
	InboundProtocol string               `json:"inboundProtocol,omitempty" gorm:"-"`
	InboundPort     int                  `json:"inboundPort,omitempty" gorm:"-"`
	Transport       string               `json:"transport,omitempty" gorm:"-"` // tcp | udp
	Members         []BalancerPoolMember `json:"members,omitempty" gorm:"-"`
}

func (BalancerPool) TableName() string { return "balancer_pools" }

// BalancerPoolMember is one node (backend) of a pool.
type BalancerPoolMember struct {
	Id              int    `json:"id" gorm:"primaryKey;autoIncrement"`
	PoolId          int    `json:"poolId" gorm:"column:pool_id"`
	NodeId          int    `json:"nodeId" gorm:"column:node_id"`
	Weight          int    `json:"weight"`
	Backup          bool   `json:"backup"`
	Enable          bool   `json:"enable" gorm:"column:enable"`
	AddressOverride string `json:"addressOverride" gorm:"column:address_override"`
	PortOverride    int    `json:"portOverride" gorm:"column:port_override"`

	NodeName   string `json:"nodeName,omitempty" gorm:"-"`
	NodeAddr   string `json:"nodeAddr,omitempty" gorm:"-"`
	NodeStatus string `json:"nodeStatus,omitempty" gorm:"-"`
}

func (BalancerPoolMember) TableName() string { return "balancer_pool_members" }

// NormalizeBalancerSubMode returns replace, prepend or append (default prepend).
func NormalizeBalancerSubMode(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case BalancerSubReplace:
		return BalancerSubReplace
	case BalancerSubAppend:
		return BalancerSubAppend
	default:
		return BalancerSubPrepend
	}
}
