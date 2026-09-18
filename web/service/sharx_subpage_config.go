package service

import (
	"encoding/json"
	"errors"
	"strings"
)

// SharxSubpageConfigV1 is the legacy flat shape of the subscription page config.
type SharxSubpageConfigV1 struct {
	SchemaVersion string `json:"schemaVersion"`
	Branding      struct {
		Title      string `json:"title"`
		LogoURL    string `json:"logoUrl"`
		BrandText  string `json:"brandText"`
		SupportURL string `json:"supportUrl"`
	} `json:"branding"`
	Theme       string   `json:"theme"`
	ShowQrCodes bool     `json:"showQrCodes"`
	Locales     []string `json:"locales"`
}

// SharxSubpageBlock is a generic representation of a v2 block. Validation of
// the discriminated payload is done via Kind + unstructured fields.
type SharxSubpageBlock struct {
	ID      string          `json:"id"`
	Kind    string          `json:"kind"`
	Enabled *bool           `json:"enabled,omitempty"`
	Extra   json.RawMessage `json:"-"`
}

// SharxSubpageResponseRules represents HTTP response rules applied to
// subscription responses (headers, announce, support URL etc.).
type SharxSubpageResponseRules struct {
	ProfileTitle                  string                       `json:"profileTitle"`
	ProfileTitleDelivery          string                       `json:"profileTitleDelivery,omitempty"`
	ProfileUpdateInterval         int                          `json:"profileUpdateInterval"`
	ProfileUpdateIntervalDelivery string                       `json:"profileUpdateIntervalDelivery,omitempty"`
	Announce                      string                       `json:"announce"`
	AnnounceDelivery              string                       `json:"announceDelivery,omitempty"`
	SupportURL                    string                       `json:"supportUrl"`
	SupportURLDelivery            string                       `json:"supportUrlDelivery,omitempty"`
	ProfileWebPageURL             string                       `json:"profileWebPageUrl"`
	ProfileWebPageURLDelivery     string                       `json:"profileWebPageUrlDelivery,omitempty"`
	MtProtoEnabled                *bool                        `json:"mtProtoEnabled,omitempty"`
	ExtraHeaders                  []SharxSubpageResponseHeader `json:"extraHeaders"`
}

// Response header delivery targets (Happ docs: HTTP header and/or body comment).
const (
	ResponseHeaderDeliveryHeader = "header"
	ResponseHeaderDeliveryBody   = "body"
	ResponseHeaderDeliveryBoth   = "both"
	ResponseHeaderDeliveryNone   = "none"
)

// SharxSubpageResponseHeader is an extra subscription meta parameter with an
// optional delivery method (HTTP header, body comment, both, or disabled).
type SharxSubpageResponseHeader struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Delivery string `json:"delivery,omitempty"` // header | body | both | none; empty => header
}

// NormalizeResponseHeaderDelivery returns a canonical delivery value.
func NormalizeResponseHeaderDelivery(delivery string) string {
	switch strings.ToLower(strings.TrimSpace(delivery)) {
	case ResponseHeaderDeliveryBody:
		return ResponseHeaderDeliveryBody
	case ResponseHeaderDeliveryBoth:
		return ResponseHeaderDeliveryBoth
	case ResponseHeaderDeliveryNone:
		return ResponseHeaderDeliveryNone
	default:
		return ResponseHeaderDeliveryHeader
	}
}

// ResponseHeaderDeliversHTTP reports whether the parameter is sent as an HTTP header.
func ResponseHeaderDeliversHTTP(delivery string) bool {
	d := NormalizeResponseHeaderDelivery(delivery)
	return d == ResponseHeaderDeliveryHeader || d == ResponseHeaderDeliveryBoth
}

// ResponseHeaderDeliversBody reports whether the parameter is sent as a subscription body comment.
func ResponseHeaderDeliversBody(delivery string) bool {
	d := NormalizeResponseHeaderDelivery(delivery)
	return d == ResponseHeaderDeliveryBody || d == ResponseHeaderDeliveryBoth
}

// SharxSubpagePresetIcons contains external URLs used by clients that display
// preset quick links (bot / channel / support).
type SharxSubpagePresetIcons struct {
	BotURL     string `json:"botUrl"`
	ChannelURL string `json:"channelUrl"`
	SupportURL string `json:"supportUrl"`
}

// SharxSubpagePerAppHapp holds Happ-specific per-app toggles (parity with
// incy.gitbook.io Happ documentation).
type SharxSubpagePerAppHapp struct {
	Encrypt     bool                     `json:"encrypt"`
	PresetIcons *SharxSubpagePresetIcons `json:"presetIcons,omitempty"`
}

// SharxSubpagePerAppCommon is the generic per-app toggle (visible/enabled).
type SharxSubpagePerAppCommon struct {
	Enabled bool `json:"enabled"`
}

// SharxSubpageAppSettings toggles client app specific subscription behavior.
//
// This is intentionally minimal. Per-app buttons, encryption and link
// templates now live on the Add-to-App block inside the Sharx subpage
// configurator, so they don't need dedicated fields here.
type SharxSubpageAppSettings struct {
	Encrypt      bool                      `json:"encrypt"`
	PresetIcons  *SharxSubpagePresetIcons  `json:"presetIcons,omitempty"`
	Happ         *SharxSubpagePerAppHapp   `json:"happ,omitempty"`
	V2RayTun     *SharxSubpagePerAppCommon `json:"v2raytun,omitempty"`
	Incy         *SharxSubpagePerAppCommon `json:"incy,omitempty"`
	V2RayNG      *SharxSubpagePerAppCommon `json:"v2rayng,omitempty"`
	Hiddify      *SharxSubpagePerAppCommon `json:"hiddify,omitempty"`
	Streisand    *SharxSubpagePerAppCommon `json:"streisand,omitempty"`
	Shadowrocket *SharxSubpagePerAppCommon `json:"shadowrocket,omitempty"`
	ClashMeta    *SharxSubpagePerAppCommon `json:"clashMeta,omitempty"`
	Karing       *SharxSubpagePerAppCommon `json:"karing,omitempty"`
	Nekobox      *SharxSubpagePerAppCommon `json:"nekobox,omitempty"`
}

// SharxSubpageRoutingProfile is an inline or URL-provided routing profile.
type SharxSubpageRoutingProfile struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Source               string `json:"source"` // "inline" | "url"
	Body                 string `json:"body"`
	URL                  string `json:"url"`
	DeepLinkPreset       string `json:"deepLinkPreset,omitempty"`       // happ | incy | sharx | custom
	DeepLinkCustomPrefix string `json:"deepLinkCustomPrefix,omitempty"` // when custom: prefix before Base64 payload
}

// SharxSubpageRouting groups declared routing profiles.
type SharxSubpageRouting struct {
	Profiles []SharxSubpageRoutingProfile `json:"profiles"`
	Delivery string                       `json:"delivery,omitempty"` // header | body | both | none; empty => header
}

// SharxSubpageAutoroutingEntry is a single autoupdated routing profile.
type SharxSubpageAutoroutingEntry struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	TTLSeconds int    `json:"ttlSeconds"`
}

// SharxSubpageAutorouting is the container for autorouting profiles.
type SharxSubpageAutorouting struct {
	Profiles []SharxSubpageAutoroutingEntry `json:"profiles"`
}

// SharxSubpageDeepLinks holds toggles for "Add to app" deep-link buttons.
type SharxSubpageDeepLinks struct {
	EnabledApps []string `json:"enabledApps"`
}

// SharxSubpageJsonTemplates holds Xray JSON subscription body template fragments.
type SharxSubpageJsonTemplates struct {
	Fragment string `json:"fragment"`
	Mux      string `json:"mux"`
	Noises   string `json:"noises"`
	Rules    string `json:"rules"`
}

// SharxSubpageCustomRemarks are short lines embedded into subscription output as
// placeholder proxy remarks (e.g. vless://…#text) when the user is limited,
// disabled, has no inbounds, or hits HWID limits.
type SharxSubpageCustomRemarks struct {
	ExpiredUsers           []string `json:"expiredUsers"`
	LimitedUsers           []string `json:"limitedUsers"`
	DisabledUsers          []string `json:"disabledUsers"`
	EmptyHosts             []string `json:"emptyHosts"`
	HWIDMaxDevicesExceeded []string `json:"HWIDMaxDevicesExceeded"`
	HWIDNotSupported       []string `json:"HWIDNotSupported"`
	BlockedApp             []string `json:"blockedApp"`
	UnknownApp             []string `json:"unknownApp"`
}

// SharxSubpageConfigV2 is the block-based schema.
type SharxSubpageConfigV2 struct {
	SchemaVersion string `json:"schemaVersion"`
	Branding      struct {
		Title              string `json:"title"`
		LogoURL            string `json:"logoUrl"`
		BrandText          string `json:"brandText"`
		SupportURL         string `json:"supportUrl"`
		AccentColor        string `json:"accentColor,omitempty"`
		AccentAmbientColor string `json:"accentAmbientColor,omitempty"`
		BgColor            string `json:"bgColor,omitempty"`
		BgElevatedColor    string `json:"bgElevatedColor,omitempty"`
		FgColor            string `json:"fgColor,omitempty"`
		FgMutedColor       string `json:"fgMutedColor,omitempty"`
		BorderColor        string `json:"borderColor,omitempty"`
		SuccessColor       string `json:"successColor,omitempty"`
		DangerColor        string `json:"dangerColor,omitempty"`
	} `json:"branding"`
	Theme string `json:"theme"`
	// ColorPreset matches panel theme ids (default, midnight, ember, boreal, web). Empty means web.
	ColorPreset   string                     `json:"colorPreset,omitempty"`
	ShowQrCodes   bool                       `json:"showQrCodes"`
	Locales       []string                   `json:"locales"`
	Blocks        []json.RawMessage          `json:"blocks"`
	ResponseRules *SharxSubpageResponseRules `json:"responseRules,omitempty"`
	AppSettings   *SharxSubpageAppSettings   `json:"appSettings,omitempty"`
	JsonTemplates *SharxSubpageJsonTemplates `json:"jsonTemplates,omitempty"`
	Routing       *SharxSubpageRouting       `json:"routing,omitempty"`
	Autorouting   *SharxSubpageAutorouting   `json:"autorouting,omitempty"`
	DeepLinks     *SharxSubpageDeepLinks     `json:"deepLinks,omitempty"`
	// ShowCustomRemarks: nil = enabled (backward compatible). Set to false to
	// always emit real nodes even when the account is limited/disabled/HWID-blocked.
	ShowCustomRemarks *bool                      `json:"showCustomRemarks,omitempty"`
	CustomRemarks     *SharxSubpageCustomRemarks `json:"customRemarks,omitempty"`
}

var supportedBlockKinds = map[string]bool{
	"subscription-info":  true,
	"installation-guide": true,
	"links-list":         true,
	"support-cta":        true,
	"custom-html":        true,
	"metrics":            true,
	"add-to-app":         true,
}

// SupportedSubscriptionApps lists deep-link client IDs supported by the
// "Add to app" block. Kept in sync with the TS schema.
var SupportedSubscriptionApps = map[string]bool{
	"happ":         true,
	"v2raytun":     true,
	"incy":         true,
	"v2rayng":      true,
	"hiddify":      true,
	"streisand":    true,
	"shadowrocket": true,
	"clash-meta":   true,
	"karing":       true,
	"nekobox":      true,
}

// ValidateSharxSubpageConfigJSON ensures config is valid JSON and matches a known schema.
// Accepts both sharx-v1 and sharx-v2. Legacy Remna-style JSON is rejected.
func ValidateSharxSubpageConfigJSON(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return errors.New("config is empty")
	}
	if !json.Valid([]byte(raw)) {
		return errors.New("config must be valid JSON")
	}

	var head struct {
		SchemaVersion string `json:"schemaVersion"`
	}
	if err := json.Unmarshal([]byte(raw), &head); err != nil {
		return err
	}
	switch head.SchemaVersion {
	case "sharx-v1", "":
		return validateV1(raw)
	case "sharx-v2":
		return validateV2(raw)
	default:
		return errors.New("schemaVersion must be \"sharx-v1\" or \"sharx-v2\"")
	}
}

func validateV1(raw string) error {
	var cfg SharxSubpageConfigV1
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return err
	}
	if strings.TrimSpace(cfg.Branding.Title) == "" {
		return errors.New("branding.title is required")
	}
	return nil
}

func validateV2(raw string) error {
	var cfg SharxSubpageConfigV2
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return err
	}
	if strings.TrimSpace(cfg.Branding.Title) == "" {
		return errors.New("branding.title is required")
	}
	seenIDs := map[string]bool{}
	for i, rawBlock := range cfg.Blocks {
		var head struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(rawBlock, &head); err != nil {
			return errors.New("blocks[" + itoa(i) + "]: " + err.Error())
		}
		if strings.TrimSpace(head.ID) == "" {
			return errors.New("blocks[" + itoa(i) + "].id is required")
		}
		if seenIDs[head.ID] {
			return errors.New("blocks[" + itoa(i) + "].id is duplicated")
		}
		seenIDs[head.ID] = true
		if !supportedBlockKinds[head.Kind] {
			return errors.New("blocks[" + itoa(i) + "].kind unsupported: " + head.Kind)
		}
	}
	if cfg.ResponseRules != nil {
		if cfg.ResponseRules.ProfileUpdateInterval < 0 {
			return errors.New("responseRules.profileUpdateInterval must be >= 0")
		}
		for _, pair := range []struct{ path, val string }{
			{"responseRules.profileTitleDelivery", cfg.ResponseRules.ProfileTitleDelivery},
			{"responseRules.profileUpdateIntervalDelivery", cfg.ResponseRules.ProfileUpdateIntervalDelivery},
			{"responseRules.announceDelivery", cfg.ResponseRules.AnnounceDelivery},
			{"responseRules.supportUrlDelivery", cfg.ResponseRules.SupportURLDelivery},
			{"responseRules.profileWebPageUrlDelivery", cfg.ResponseRules.ProfileWebPageURLDelivery},
		} {
			if err := validateResponseHeaderDelivery(pair.path, pair.val); err != nil {
				return err
			}
		}
		seenKeys := map[string]bool{}
		for i, h := range cfg.ResponseRules.ExtraHeaders {
			k := strings.TrimSpace(h.Key)
			if k == "" {
				return errors.New("responseRules.extraHeaders[" + itoa(i) + "].key is required")
			}
			lk := strings.ToLower(k)
			if seenKeys[lk] {
				return errors.New("responseRules.extraHeaders[" + itoa(i) + "].key is duplicated: " + k)
			}
			seenKeys[lk] = true
			if err := validateResponseHeaderDelivery("responseRules.extraHeaders["+itoa(i)+"].delivery", h.Delivery); err != nil {
				return err
			}
		}
	}
	if cfg.Routing != nil {
		if err := validateResponseHeaderDelivery("routing.delivery", cfg.Routing.Delivery); err != nil {
			return err
		}
	}
	if cfg.JsonTemplates != nil {
		if err := validateOptionalJSON("jsonTemplates.fragment", cfg.JsonTemplates.Fragment); err != nil {
			return err
		}
		if err := validateOptionalJSON("jsonTemplates.mux", cfg.JsonTemplates.Mux); err != nil {
			return err
		}
		if err := validateOptionalJSON("jsonTemplates.noises", cfg.JsonTemplates.Noises); err != nil {
			return err
		}
		if err := validateOptionalJSON("jsonTemplates.rules", cfg.JsonTemplates.Rules); err != nil {
			return err
		}
	}
	return nil
}

func validateOptionalJSON(field, raw string) error {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	if !json.Valid([]byte(s)) {
		return errors.New(field + " is not valid JSON")
	}
	return nil
}

// itoa without strconv to avoid importing it twice in this file.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// IsLegacyRemnaStyleConfig returns true if JSON looks like the old Remna-style config (no sharx-v*).
func IsLegacyRemnaStyleConfig(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return false
	}
	var v struct {
		SchemaVersion string `json:"schemaVersion"`
	}
	_ = json.Unmarshal([]byte(raw), &v)
	if v.SchemaVersion == "sharx-v1" || v.SchemaVersion == "sharx-v2" {
		return false
	}
	// Heuristic: Remna embed used "brandingSettings", "uiConfig", "platforms", etc.
	_, hasRemnaBranding := m["brandingSettings"]
	_, hasPlatforms := m["platforms"]
	if hasRemnaBranding || hasPlatforms {
		return true
	}
	return v.SchemaVersion == "" && !hasSharxBranding(m)
}

func hasSharxBranding(m map[string]json.RawMessage) bool {
	_, ok := m["branding"]
	return ok
}

func validateResponseHeaderDelivery(path, delivery string) error {
	raw := strings.ToLower(strings.TrimSpace(delivery))
	if raw == "" ||
		raw == ResponseHeaderDeliveryHeader ||
		raw == ResponseHeaderDeliveryBody ||
		raw == ResponseHeaderDeliveryBoth ||
		raw == ResponseHeaderDeliveryNone {
		return nil
	}
	return errors.New(path + " is invalid: " + delivery)
}
