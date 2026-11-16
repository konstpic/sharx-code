package service

import (
	_ "embed"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/entity"

	"gorm.io/gorm"
)

//go:embed default_sharx_subpage_config.json
var defaultSharxSubpageConfigJSON string

const defaultSubpageConfigUUID = "00000000-0000-0000-0000-000000000000"

// SubscriptionPageConfigService manages first-party subscription page configs (Sharx schema).
type SubscriptionPageConfigService struct{}

// EnsureDefault inserts the default config row if the table is empty.
func (SubscriptionPageConfigService) EnsureDefault() error {
	var n int64
	if err := database.GetDB().Model(&model.SubscriptionPageConfig{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	cfg := strings.TrimSpace(defaultSharxSubpageConfigJSON)
	if cfg == "" {
		return errors.New("embedded default Sharx subpage config is empty")
	}
	row := &model.SubscriptionPageConfig{
		UUID:         defaultSubpageConfigUUID,
		ViewPosition: 0,
		Name:         "Default",
		ConfigJSON:   cfg,
	}
	if err := database.GetDB().Create(row).Error; err != nil {
		return err
	}
	logger.Infof("Seeded default subscription page config (uuid=%s)", defaultSubpageConfigUUID)
	return nil
}

// UpgradeDefaultIfLegacy replaces Remna-style JSON on the default row with Sharx v1.
func (SubscriptionPageConfigService) UpgradeDefaultIfLegacy() error {
	var row model.SubscriptionPageConfig
	err := database.GetDB().Where("uuid = ?", defaultSubpageConfigUUID).First(&row).Error
	if err != nil {
		return nil
	}
	if !IsLegacyRemnaStyleConfig(row.ConfigJSON) {
		return nil
	}
	cfg := strings.TrimSpace(defaultSharxSubpageConfigJSON)
	if err := ValidateSharxSubpageConfigJSON(cfg); err != nil {
		return err
	}
	err = database.GetDB().Model(&model.SubscriptionPageConfig{}).Where("uuid = ?", defaultSubpageConfigUUID).Updates(map[string]interface{}{
		"config_json": cfg,
	}).Error
	if err == nil {
		logger.Infof("Migrated default subscription page config from legacy format to sharx-v1")
	}
	return err
}

// ListAll returns all configs ordered by view_position.
func (SubscriptionPageConfigService) ListAll() ([]model.SubscriptionPageConfig, error) {
	var rows []model.SubscriptionPageConfig
	err := database.GetDB().Order("view_position ASC, uuid ASC").Find(&rows).Error
	return rows, err
}

// GetByUUID loads one config including JSON body.
func (SubscriptionPageConfigService) GetByUUID(uuid string) (*model.SubscriptionPageConfig, error) {
	var row model.SubscriptionPageConfig
	err := database.GetDB().Where("uuid = ?", uuid).First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// DefaultUUID returns the well-known default config id.
func (SubscriptionPageConfigService) DefaultUUID() string {
	return defaultSubpageConfigUUID
}

// Save upserts name + config JSON for an existing uuid, or creates a new row.
func (SubscriptionPageConfigService) Save(uuid, name string, configJSON string) error {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return errors.New("uuid is required")
	}
	if err := ValidateSharxSubpageConfigJSON(configJSON); err != nil {
		return err
	}
	var existing model.SubscriptionPageConfig
	err := database.GetDB().Where("uuid = ?", uuid).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row := &model.SubscriptionPageConfig{
			UUID:         uuid,
			ViewPosition: 0,
			Name:         name,
			ConfigJSON:   configJSON,
		}
		return database.GetDB().Create(row).Error
	}
	if err != nil {
		return err
	}
	return database.GetDB().Model(&model.SubscriptionPageConfig{}).Where("uuid = ?", uuid).Updates(map[string]interface{}{
		"name":        name,
		"config_json": configJSON,
	}).Error
}

// GetActiveV2Config returns the first config parsed as sharx-v2, filling in
// missing ResponseRules / AppSettings / JsonTemplates / Branding from the
// legacy flat settings keys so callers always get a complete view.
//
// Nothing is written back: this is pure read-side enrichment. The first save
// from SubscriptionBuilder persists the full v2 document.
func (s SubscriptionPageConfigService) GetActiveV2Config() (*SharxSubpageConfigV2, error) {
	uuid, err := s.FirstConfigUUID()
	if err != nil {
		return nil, err
	}
	row, err := s.GetByUUID(uuid)
	if err != nil {
		return nil, err
	}
	cfg, err := parseAsV2WithMigration(row.ConfigJSON)
	if err != nil {
		return nil, err
	}
	enrichV2FromLegacySettings(cfg)
	return cfg, nil
}

// parseAsV2WithMigration accepts sharx-v1 or sharx-v2 JSON and returns a v2 view.
func parseAsV2WithMigration(raw string) (*SharxSubpageConfigV2, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("config is empty")
	}
	var head struct {
		SchemaVersion string `json:"schemaVersion"`
	}
	if err := json.Unmarshal([]byte(raw), &head); err != nil {
		return nil, err
	}
	if head.SchemaVersion == "sharx-v2" {
		var v2 SharxSubpageConfigV2
		if err := json.Unmarshal([]byte(raw), &v2); err != nil {
			return nil, err
		}
		return &v2, nil
	}
	// Treat v1 (and unknown/empty) as v1: promote branding, drop blocks.
	var v1 SharxSubpageConfigV1
	if err := json.Unmarshal([]byte(raw), &v1); err != nil {
		return nil, err
	}
	out := &SharxSubpageConfigV2{SchemaVersion: "sharx-v2"}
	out.Branding.Title = v1.Branding.Title
	out.Branding.LogoURL = v1.Branding.LogoURL
	out.Branding.BrandText = v1.Branding.BrandText
	out.Branding.SupportURL = v1.Branding.SupportURL
	out.Theme = v1.Theme
	out.ColorPreset = "web"
	out.ShowQrCodes = v1.ShowQrCodes
	out.Locales = v1.Locales
	return out, nil
}

// enrichV2FromLegacySettings fills in ResponseRules/AppSettings/JsonTemplates/Branding
// from the flat settings table when the v2 document omits them.
func enrichV2FromLegacySettings(cfg *SharxSubpageConfigV2) {
	ss := SettingService{}

	if cfg.Branding.Title == "" {
		if v, err := ss.GetSubTitle(); err == nil && strings.TrimSpace(v) != "" {
			cfg.Branding.Title = v
		}
	}
	if cfg.Branding.LogoURL == "" {
		if v, err := ss.GetSubPageLogoUrl(); err == nil {
			cfg.Branding.LogoURL = v
		}
	}
	if cfg.Branding.BrandText == "" {
		if v, err := ss.GetSubPageBrandText(); err == nil {
			cfg.Branding.BrandText = v
		}
	}
	if cfg.Theme == "" {
		if v, err := ss.GetSubPageTheme(); err == nil {
			cfg.Theme = v
		}
	}
	if strings.TrimSpace(cfg.ColorPreset) == "" {
		cfg.ColorPreset = "web"
	}

	if cfg.ResponseRules == nil {
		rr := &SharxSubpageResponseRules{}
		if headers, err := ss.GetSubHeadersParsed(); err == nil && headers != nil {
			rr.ProfileTitle = headers.ProfileTitle
			rr.Announce = headers.Announce
			rr.SupportURL = headers.SupportUrl
			rr.ProfileWebPageURL = headers.ProfileWebPageUrl
			rr.ExtraHeaders = extraHeadersFromLegacy(headers)
		}
		if interval, err := ss.GetSubUpdates(); err == nil {
			if n, perr := strconv.Atoi(strings.TrimSpace(interval)); perr == nil {
				rr.ProfileUpdateInterval = n
			}
		}
		cfg.ResponseRules = rr
	}

	if cfg.AppSettings == nil {
		as := &SharxSubpageAppSettings{}
		as.Encrypt, _ = ss.GetSubEncrypt()
		cfg.AppSettings = as
	}

	if cfg.JsonTemplates == nil {
		jt := &SharxSubpageJsonTemplates{}
		jt.Fragment, _ = ss.GetSubJsonFragment()
		jt.Mux, _ = ss.GetSubJsonMux()
		jt.Noises, _ = ss.GetSubJsonNoises()
		jt.Rules, _ = ss.GetSubJsonRules()
		jt.FinalMask, _ = ss.GetSubJsonFinalMask()
		cfg.JsonTemplates = jt
	}
}

// extraHeadersFromLegacy converts non-canonical SubscriptionHeaders fields
// into a generic key/value list keyed by HTTP header names (e.g. NewUrl -> "New-Url").
func extraHeadersFromLegacy(h *entity.SubscriptionHeaders) []SharxSubpageResponseHeader {
	if h == nil {
		return nil
	}
	reserved := map[string]bool{
		"ProfileTitle":          true,
		"ProfileUpdateInterval": true,
		"SupportUrl":            true,
		"ProfileWebPageUrl":     true,
		"Announce":              true,
		"SubscriptionUserinfo":  true,
	}
	out := make([]SharxSubpageResponseHeader, 0)
	v := reflect.ValueOf(h).Elem()
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		fv := v.Field(i)
		if fv.Kind() != reflect.String {
			continue
		}
		s := fv.String()
		if s == "" {
			continue
		}
		name := t.Field(i).Name
		if reserved[name] {
			continue
		}
		out = append(out, SharxSubpageResponseHeader{
			Key:   fieldNameToHeaderName(name),
			Value: s,
		})
	}
	return out
}

// fieldNameToHeaderName converts CamelCase struct field name into a
// kebab-case HTTP header name (e.g. "ChangeUserAgent" -> "Change-User-Agent").
func fieldNameToHeaderName(fieldName string) string {
	var b strings.Builder
	for i, r := range fieldName {
		if i > 0 && r >= 'A' && r <= 'Z' {
			b.WriteByte('-')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// FirstConfigUUID returns the default uuid if that row exists, otherwise the first by view order.
func (SubscriptionPageConfigService) FirstConfigUUID() (string, error) {
	var row model.SubscriptionPageConfig
	err := database.GetDB().Where("uuid = ?", defaultSubpageConfigUUID).First(&row).Error
	if err == nil {
		return defaultSubpageConfigUUID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	err = database.GetDB().Order("view_position ASC, uuid ASC").First(&row).Error
	if err != nil {
		return "", err
	}
	return row.UUID, nil
}
