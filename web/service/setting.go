package service

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/secretpath"
	"github.com/konstpic/sharx-code/v2/util/random"
	"github.com/konstpic/sharx-code/v2/util/reflect_util"
	"github.com/konstpic/sharx-code/v2/web/entity"
	"github.com/konstpic/sharx-code/v2/xray"

	"github.com/op/go-logging"
)

//go:embed config.json
var defaultXrayTemplateConfig string

//go:embed grafana-dashboard.json
var grafanaDashboardJSON string

var defaultValueMap = map[string]string{
	// Default Xray template configuration. At runtime, the real source of truth
	// is always the "xrayTemplateConfig" record in the settings table; this
	// value is only used as an initial/default template when there is no valid
	// value in the database.
	"xrayTemplateConfig":          defaultXrayTemplateConfig,
	"webListen":                   "",
	"webDomain":                   "",
	"webPort":                     "2053",
	"webCertFile":                 "",
	"webKeyFile":                  "",
	"secret":                      random.Seq(32),
	"webBasePath":                 "/",
	"sessionMaxAge":               "360",
	"pageSize":                    "25",
	"expireDiff":                  "0",
	"trafficDiff":                 "0",
	"remarkModel":                 "-ieo",
	"timeLocation":                "Local",
	"tgBotEnable":                 "false",
	"tgBotToken":                  "",
	"tgBotProxy":                  "",
	"tgBotAPIServer":              "",
	"tgBotChatId":                 "",
	"tgRunTime":                   "@daily",
	"tgBotBackup":                 "false",
	"tgBotLoginNotify":            "true",
	"tgCpu":                       "80",
	"tgLang":                      "en-US",
	"twoFactorEnable":             "false",
	"twoFactorToken":              "",
	"twoFactorTelegram":           "false",
	"subEnable":                   "true",
	"subJsonEnable":               "false",
	"subTitle":                    "",
	"subListen":                   "",
	"subPort":                     "2096",
	"subPath":                     "/sub/",
	"subDomain":                   "",
	"subCertFile":                 "",
	"subKeyFile":                  "",
	"subUpdates":                  "12",
	"subEncrypt":                  "true",
	"subShowInfo":                 "true",
	"subURI":                      "",
	"subPageURI":                  "",
	"subJsonPath":                 "/json/",
	"subJsonURI":                  "",
	"subJsonFragment":             "",
	"subJsonNoises":               "",
	"subJsonMux":                  "",
	"subJsonRules":                "",
	"subHeaders":                  "{}",  // JSON string for subscription headers
	"subProviderID":               "",    // Provider ID for Happ extended headers
	"subProviderIDMethod":         "url", // Method to send Provider ID: "url" (query parameter), "header" (HTTP header), "none" (disabled)
	"subPageTheme":                "",    // Subscription page theme: "rainbow", "coffee", "banana", "sunset"
	"subPageLogoUrl":              "",    // Logo URL for subscription page
	"subPageBrandText":            "",    // Brand text for subscription page
	"subPageBackgroundUrl":        "",    // Background image URL for subscription card
	"datepicker":                  "gregorian",
	"warp":                        "",
	"externalTrafficInformEnable": "false",
	"externalTrafficInformURI":    "",
	// LDAP defaults
	"ldapEnable":            "false",
	"ldapHost":              "",
	"ldapPort":              "389",
	"ldapUseTLS":            "false",
	"ldapBindDN":            "",
	"ldapPassword":          "",
	"ldapBaseDN":            "",
	"ldapUserFilter":        "(objectClass=person)",
	"ldapUserAttr":          "mail",
	"ldapVlessField":        "vless_enabled",
	"ldapSyncCron":          "@every 1m",
	"ldapFlagField":         "",
	"ldapTruthyValues":      "true,1,yes,on",
	"ldapInvertFlag":        "false",
	"ldapInboundTags":       "",
	"ldapAutoCreate":        "false",
	"ldapAutoDelete":        "false",
	"ldapDefaultTotalGB":    "0",
	"ldapDefaultExpiryDays": "0",
	"ldapDefaultLimitIP":    "0",
	// Multi-node mode
	"multiNodeMode": "false", // "true" for multi-mode, "false" for single-mode
	// Dashboard public IPv6 detection
	"enableIPv6":                         "false",
	"nodeStatsCollectionIntervalSec":     "3",
	"nodeHealthCheckIntervalSec":         "15",
	"nodeHealthCheckDegradedIntervalSec": "5",
	// HWID tracking mode
	"hwidMode": "client_header", // "off" = disabled, "client_header" = use x-hwid header (default), "legacy_fingerprint" = deprecated fingerprint-based (deprecated)
	// Client IP limit (panel job for clients with ip_limit_enabled)
	"ipLimitGlobalEnable":     "true",
	"ipLimitCheckIntervalSec": "30",
	"ipLimitBanDurationSec":   "3600",
	"ipLimitEnforcement":      "drop_and_block",
	"ipLimitExcessPolicy":     "newest",
	// Grafana integration
	"grafanaLokiUrl":            "",
	"grafanaVictoriaMetricsUrl": "",
	"grafanaEnable":             "false",
	// Panel log level (overrides XUI_LOG_LEVEL env var)
	"panelLogLevel": "info", // Valid values: "debug", "info", "notice", "warning", "error"
	"logRotateMaxSizeMB":  "50",
	"logRotateMaxAgeDays": "14",
	"logRotateMaxBackups": "5",
	"logRotateCompress":   "true",
	// Geofile library auto-update (active assets with source URL)
	"geofileAutoUpdateEnable":        "false",
	"geofileAutoUpdateIntervalHours": "24",
	// Panel UI preferences persisted in DB (instead of browser localStorage)
	"panelTheme":        "web",
	"panelLang":         "en",
	"dashboardWidgets":  `["resources","xray","quick_actions","uptime","users_online","user_agent","database","network","panel_runtime"]`,
	"hideSecAlert":      "false",
	"clientsTablePrefs": "",
}

var allowedUIPreferenceKeys = map[string]bool{
	"panelTheme":        true,
	"panelLang":         true,
	"dashboardWidgets":  true,
	"hideSecAlert":      true,
	"clientsTablePrefs": true,
}

// userScopedUIPreferenceKeys are stored per panel user (settings key suffix :user:{id}).
var userScopedUIPreferenceKeys = map[string]bool{
	"clientsTablePrefs": true,
}

func uiPreferenceStorageKey(logicalKey string, userId int) string {
	if userScopedUIPreferenceKeys[logicalKey] && userId > 0 {
		return fmt.Sprintf("%s:user:%d", logicalKey, userId)
	}
	return logicalKey
}

// SettingService provides business logic for application settings management.
// It handles configuration storage, retrieval, and validation for all system settings.
type SettingService struct{}

// EnsureXrayTemplateConfigValid ensures that xrayTemplateConfig in the database is valid.
// If it's missing or invalid, it updates it from the default template.
// This is critical when updating only the panel image without updating the database,
// as the old config structure might be incompatible with the new code.
// All configuration is now stored in database, not in embedded files.
func (s *SettingService) EnsureXrayTemplateConfigValid() error {
	db := database.GetDB()

	current := &model.Setting{}
	err := db.Model(&model.Setting{}).Where("key = ?", "xrayTemplateConfig").First(current).Error
	if database.IsNotFound(err) {
		// No record: initialize from default template
		logger.Infof("xrayTemplateConfig not found in DB, initializing with default template")
		return s.saveSetting("xrayTemplateConfig", defaultXrayTemplateConfig)
	}
	if err != nil {
		return err
	}

	value := strings.TrimSpace(current.Value)
	if value == "" || value == "{}" {
		logger.Warning("xrayTemplateConfig in DB is empty or placeholder, resetting to default template")
		return s.saveSetting("xrayTemplateConfig", defaultXrayTemplateConfig)
	}

	// Validate JSON by unmarshalling into xray.Config; if invalid, reset to default
	cfg := &xray.Config{}
	if err := json.Unmarshal([]byte(value), cfg); err != nil {
		logger.Warningf("Invalid xrayTemplateConfig in DB, resetting to default template: %v", err)
		return s.saveSetting("xrayTemplateConfig", defaultXrayTemplateConfig)
	}

	// Persist template patches when missing: RoutingService + outbound "api" (routing rule targets it).
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(value), &raw); err == nil {
		needsSave := false

		hasRoutingSvc := false
		if api, ok := raw["api"].(map[string]interface{}); ok {
			svcs, _ := api["services"].([]interface{})
			for _, x := range svcs {
				if str, ok := x.(string); ok && str == "RoutingService" {
					hasRoutingSvc = true
					break
				}
			}
		}
		if !hasRoutingSvc {
			needsSave = true
		}

		hasAPIOutbound := false
		if obs, ok := raw["outbounds"].([]interface{}); ok {
			for _, x := range obs {
				m, ok := x.(map[string]interface{})
				if !ok {
					continue
				}
				if tag, _ := m["tag"].(string); tag == "api" {
					hasAPIOutbound = true
					break
				}
			}
		}
		if !hasAPIOutbound {
			needsSave = true
		}

		if needsSave {
			xray.EnsureAPIServicesRoutingService(cfg)
			xray.EnsureAPIRoutingOutbound(cfg)
			updated, mErr := json.Marshal(cfg)
			if mErr != nil {
				logger.Warningf("xrayTemplateConfig: marshal after template patches: %v", mErr)
				return nil
			}
			logger.Info("xrayTemplateConfig: saved API template patches (RoutingService and/or outbound api)")
			return s.saveSetting("xrayTemplateConfig", string(updated))
		}
	}

	return nil
}

// ResetXrayTemplateConfigToDefault resets the xrayTemplateConfig setting to the
// built-in default template. Intended to be called from admin UI / API.
func (s *SettingService) ResetXrayTemplateConfigToDefault() error {
	logger.Info("Resetting xrayTemplateConfig to default template")
	return s.saveSetting("xrayTemplateConfig", defaultXrayTemplateConfig)
}

func (s *SettingService) GetDefaultJsonConfig() (any, error) {
	var jsonData any
	err := json.Unmarshal([]byte(defaultXrayTemplateConfig), &jsonData)
	if err != nil {
		return nil, err
	}
	return jsonData, nil
}

func (s *SettingService) GetAllSetting() (*entity.AllSetting, error) {
	db := database.GetDB()
	settings := make([]*model.Setting, 0)
	err := db.Model(model.Setting{}).Not("key = ?", "xrayTemplateConfig").Find(&settings).Error
	if err != nil {
		return nil, err
	}
	result := &entity.AllSetting{}
	t := reflect.TypeOf(result).Elem()
	v := reflect.ValueOf(result).Elem()
	fields := reflect_util.GetFields(t)

	setSetting := func(key, value string) (err error) {
		defer func() {
			panicErr := recover()
			if panicErr != nil {
				err = errors.New(fmt.Sprint(panicErr))
			}
		}()

		var found bool
		var field reflect.StructField
		for _, f := range fields {
			if f.Tag.Get("json") == key {
				field = f
				found = true
				break
			}
		}

		if !found {
			// Some settings are automatically generated, no need to return to the front end to modify the user
			return nil
		}

		fieldV := v.FieldByName(field.Name)
		switch t := fieldV.Interface().(type) {
		case int:
			n, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return err
			}
			fieldV.SetInt(n)
		case string:
			fieldV.SetString(value)
		case bool:
			fieldV.SetBool(value == "true")
		default:
			return common.NewErrorf("unknown field %v type %v", key, t)
		}
		return
	}

	keyMap := map[string]bool{}
	for _, setting := range settings {
		err := setSetting(setting.Key, setting.Value)
		if err != nil {
			return nil, err
		}
		keyMap[setting.Key] = true
	}

	for key, value := range defaultValueMap {
		if keyMap[key] {
			continue
		}
		err := setSetting(key, value)
		if err != nil {
			return nil, err
		}
	}

	s.applyEffectiveRuntimePaths(result)
	return result, nil
}

// applyEffectiveRuntimePaths overlays env-backed path settings for the settings UI.
func (s *SettingService) applyEffectiveRuntimePaths(result *entity.AllSetting) {
	if result == nil {
		return
	}
	if bp, err := s.GetBasePath(); err == nil {
		result.WebBasePath = bp
	}
	if sp, err := s.GetSubPath(); err == nil {
		result.SubPath = sp
	}
}

func (s *SettingService) SetSubPath(subPath string) error {
	if !strings.HasPrefix(subPath, "/") {
		subPath = "/" + subPath
	}
	if !strings.HasSuffix(subPath, "/") {
		subPath += "/"
	}
	return s.setString("subPath", subPath)
}

func (s *SettingService) EnvOverridesWebBasePath() bool {
	return strings.TrimSpace(os.Getenv("XUI_WEB_BASE_PATH")) != ""
}

func (s *SettingService) EnvOverridesSubPath() bool {
	return strings.TrimSpace(os.Getenv("XUI_SUB_PATH")) != ""
}

// GenerateSecretPaths assigns random webBasePath and subPath (404 on bare :port when active).
func (s *SettingService) GenerateSecretPaths() (webPath, subPath string, err error) {
	if s.EnvOverridesWebBasePath() {
		return "", "", common.NewError("XUI_WEB_BASE_PATH is set in the environment")
	}
	if s.EnvOverridesSubPath() {
		return "", "", common.NewError("XUI_SUB_PATH is set in the environment")
	}
	webPath = secretpath.GenerateWebBasePath()
	subPath = secretpath.GenerateSubPath()
	if err := s.SetBasePath(webPath); err != nil {
		return "", "", err
	}
	if err := s.SetSubPath(subPath); err != nil {
		return "", "", err
	}
	return webPath, subPath, nil
}

func (s *SettingService) ResetSettings() error {
	db := database.GetDB()
	err := db.Where("1 = 1").Delete(model.Setting{}).Error
	if err != nil {
		return err
	}
	return db.Model(model.User{}).
		Where("1 = 1").Error
}

func (s *SettingService) getSetting(key string) (*model.Setting, error) {
	db := database.GetDB()
	setting := &model.Setting{}
	err := db.Model(model.Setting{}).Where("key = ?", key).First(setting).Error
	return setting, err
}

func (s *SettingService) saveSetting(key string, value string) error {
	setting, err := s.getSetting(key)
	db := database.GetDB()
	if database.IsNotFound(err) {
		err = db.Create(&model.Setting{
			Key:   key,
			Value: value,
		}).Error
	} else if err != nil {
		return err
	} else {
		setting.Key = key
		setting.Value = value
		err = db.Save(setting).Error
	}

	return err
}

func (s *SettingService) getString(key string) (string, error) {
	setting, err := s.getSetting(key)
	if database.IsNotFound(err) {
		value, ok := defaultValueMap[key]
		if !ok {
			return "", common.NewErrorf("key <%v> not in defaultValueMap", key)
		}
		return value, nil
	} else if err != nil {
		return "", err
	}
	return setting.Value, nil
}

func (s *SettingService) setString(key string, value string) error {
	return s.saveSetting(key, value)
}

func (s *SettingService) GetUIPreference(key string) (string, error) {
	return s.GetUIPreferenceForUser(0, key)
}

func (s *SettingService) GetUIPreferenceForUser(userId int, key string) (string, error) {
	if !allowedUIPreferenceKeys[key] {
		return "", common.NewErrorf("unsupported UI preference key: %s", key)
	}
	storageKey := uiPreferenceStorageKey(key, userId)
	v, err := s.getString(storageKey)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(v) == "" && userId > 0 && userScopedUIPreferenceKeys[key] {
		legacy, err := s.getString(key)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(legacy) != "" {
			_ = s.setString(storageKey, legacy)
			return legacy, nil
		}
	}
	return v, nil
}

func (s *SettingService) SetUIPreference(key string, value string) error {
	return s.SetUIPreferenceForUser(0, key, value)
}

func (s *SettingService) SetUIPreferenceForUser(userId int, key string, value string) error {
	if !allowedUIPreferenceKeys[key] {
		return common.NewErrorf("unsupported UI preference key: %s", key)
	}
	return s.setString(uiPreferenceStorageKey(key, userId), value)
}

func (s *SettingService) getBool(key string) (bool, error) {
	str, err := s.getString(key)
	if err != nil {
		return false, err
	}
	// If the string is empty, treat it as missing and use default value
	if str == "" {
		defaultValue, ok := defaultValueMap[key]
		if !ok {
			return false, common.NewErrorf("key <%v> not in defaultValueMap", key)
		}
		return strconv.ParseBool(defaultValue)
	}
	return strconv.ParseBool(str)
}

func (s *SettingService) setBool(key string, value bool) error {
	return s.setString(key, strconv.FormatBool(value))
}

func (s *SettingService) getInt(key string) (int, error) {
	str, err := s.getString(key)
	if err != nil {
		return 0, err
	}
	// If the string is empty, treat it as missing and use default value
	if str == "" {
		defaultValue, ok := defaultValueMap[key]
		if !ok {
			return 0, common.NewErrorf("key <%v> not in defaultValueMap", key)
		}
		return strconv.Atoi(defaultValue)
	}
	return strconv.Atoi(str)
}

func (s *SettingService) setInt(key string, value int) error {
	return s.setString(key, strconv.Itoa(value))
}

func (s *SettingService) GetXrayConfigTemplate() (string, error) {
	return s.getString("xrayTemplateConfig")
}

func (s *SettingService) GetListen() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_WEB_LISTEN"); envValue != "" {
		return envValue, nil
	}
	return s.getString("webListen")
}

func (s *SettingService) SetListen(ip string) error {
	return s.setString("webListen", ip)
}

func (s *SettingService) GetWebDomain() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_WEB_DOMAIN"); envValue != "" {
		return envValue, nil
	}
	return s.getString("webDomain")
}

func (s *SettingService) GetTgBotToken() (string, error) {
	return s.getString("tgBotToken")
}

func (s *SettingService) SetTgBotToken(token string) error {
	return s.setString("tgBotToken", token)
}

func (s *SettingService) GetTgBotProxy() (string, error) {
	return s.getString("tgBotProxy")
}

func (s *SettingService) SetTgBotProxy(token string) error {
	return s.setString("tgBotProxy", token)
}

func (s *SettingService) GetTgBotAPIServer() (string, error) {
	return s.getString("tgBotAPIServer")
}

func (s *SettingService) SetTgBotAPIServer(token string) error {
	return s.setString("tgBotAPIServer", token)
}

func (s *SettingService) GetTgBotChatId() (string, error) {
	return s.getString("tgBotChatId")
}

func (s *SettingService) SetTgBotChatId(chatIds string) error {
	return s.setString("tgBotChatId", chatIds)
}

func (s *SettingService) GetTgbotEnabled() (bool, error) {
	return s.getBool("tgBotEnable")
}

func (s *SettingService) SetTgbotEnabled(value bool) error {
	return s.setBool("tgBotEnable", value)
}

func (s *SettingService) GetTgbotRuntime() (string, error) {
	return s.getString("tgRunTime")
}

func (s *SettingService) SetTgbotRuntime(time string) error {
	return s.setString("tgRunTime", time)
}

func (s *SettingService) GetTgBotBackup() (bool, error) {
	return s.getBool("tgBotBackup")
}

func (s *SettingService) GetTgBotLoginNotify() (bool, error) {
	return s.getBool("tgBotLoginNotify")
}

func (s *SettingService) GetTgCpu() (int, error) {
	return s.getInt("tgCpu")
}

func (s *SettingService) GetTgLang() (string, error) {
	return s.getString("tgLang")
}

func (s *SettingService) GetTwoFactorEnable() (bool, error) {
	return s.getBool("twoFactorEnable")
}

func (s *SettingService) SetTwoFactorEnable(value bool) error {
	return s.setBool("twoFactorEnable", value)
}

func (s *SettingService) GetTwoFactorToken() (string, error) {
	return s.getString("twoFactorToken")
}

func (s *SettingService) SetTwoFactorToken(value string) error {
	return s.setString("twoFactorToken", value)
}

func (s *SettingService) GetTwoFactorTelegram() (bool, error) {
	return s.getBool("twoFactorTelegram")
}

func (s *SettingService) SetTwoFactorTelegram(value bool) error {
	return s.setBool("twoFactorTelegram", value)
}

func (s *SettingService) GetPort() (int, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_WEB_PORT"); envValue != "" {
		port, err := strconv.Atoi(envValue)
		if err != nil {
			return 0, common.NewErrorf("invalid XUI_WEB_PORT value: %v", envValue)
		}
		return port, nil
	}
	return s.getInt("webPort")
}

func (s *SettingService) SetPort(port int) error {
	return s.setInt("webPort", port)
}

func (s *SettingService) SetCertFile(webCertFile string) error {
	return s.setString("webCertFile", webCertFile)
}

func (s *SettingService) GetCertFile() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_WEB_CERT_FILE"); envValue != "" {
		return envValue, nil
	}
	return s.getString("webCertFile")
}

func (s *SettingService) SetKeyFile(webKeyFile string) error {
	return s.setString("webKeyFile", webKeyFile)
}

func (s *SettingService) GetKeyFile() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_WEB_KEY_FILE"); envValue != "" {
		return envValue, nil
	}
	return s.getString("webKeyFile")
}

func (s *SettingService) GetExpireDiff() (int, error) {
	return s.getInt("expireDiff")
}

func (s *SettingService) GetTrafficDiff() (int, error) {
	return s.getInt("trafficDiff")
}

func (s *SettingService) GetSessionMaxAge() (int, error) {
	return s.getInt("sessionMaxAge")
}

func (s *SettingService) GetRemarkModel() (string, error) {
	return s.getString("remarkModel")
}

func (s *SettingService) GetSecret() ([]byte, error) {
	secret, err := s.getString("secret")
	if secret == defaultValueMap["secret"] {
		err := s.saveSetting("secret", secret)
		if err != nil {
			logger.Warning("save secret failed:", err)
		}
	}
	return []byte(secret), err
}

func (s *SettingService) SetBasePath(basePath string) error {
	if !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath += "/"
	}
	return s.setString("webBasePath", basePath)
}

func (s *SettingService) GetBasePath() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_WEB_BASE_PATH"); envValue != "" {
		basePath := envValue
		if !strings.HasPrefix(basePath, "/") {
			basePath = "/" + basePath
		}
		if !strings.HasSuffix(basePath, "/") {
			basePath += "/"
		}
		return basePath, nil
	}
	basePath, err := s.getString("webBasePath")
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath += "/"
	}
	return basePath, nil
}

func (s *SettingService) GetTimeLocation() (*time.Location, error) {
	l, err := s.getString("timeLocation")
	if err != nil {
		return nil, err
	}
	location, err := time.LoadLocation(l)
	if err != nil {
		defaultLocation := defaultValueMap["timeLocation"]
		logger.Errorf("location <%v> not exist, using default location: %v", l, defaultLocation)
		return time.LoadLocation(defaultLocation)
	}
	return location, nil
}

func (s *SettingService) GetSubEnable() (bool, error) {
	return s.getBool("subEnable")
}

func (s *SettingService) GetSubJsonEnable() (bool, error) {
	return s.getBool("subJsonEnable")
}

func (s *SettingService) GetSubTitle() (string, error) {
	return s.getString("subTitle")
}

func (s *SettingService) GetSubListen() (string, error) {
	return s.getString("subListen")
}

func (s *SettingService) GetSubPort() (int, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_SUB_PORT"); envValue != "" {
		port, err := strconv.Atoi(envValue)
		if err != nil {
			return 0, common.NewErrorf("invalid XUI_SUB_PORT value: %v", envValue)
		}
		return port, nil
	}
	return s.getInt("subPort")
}

func (s *SettingService) GetSubPath() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_SUB_PATH"); envValue != "" {
		return envValue, nil
	}
	return s.getString("subPath")
}

func (s *SettingService) GetSubJsonPath() (string, error) {
	return s.getString("subJsonPath")
}

func (s *SettingService) GetSubDomain() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_SUB_DOMAIN"); envValue != "" {
		return envValue, nil
	}
	return s.getString("subDomain")
}

func (s *SettingService) SetSubCertFile(subCertFile string) error {
	return s.setString("subCertFile", subCertFile)
}

func (s *SettingService) GetSubCertFile() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_SUB_CERT_FILE"); envValue != "" {
		return envValue, nil
	}
	return s.getString("subCertFile")
}

func (s *SettingService) SetSubKeyFile(subKeyFile string) error {
	return s.setString("subKeyFile", subKeyFile)
}

func (s *SettingService) GetSubKeyFile() (string, error) {
	// Check environment variable first
	if envValue := os.Getenv("XUI_SUB_KEY_FILE"); envValue != "" {
		return envValue, nil
	}
	return s.getString("subKeyFile")
}

func (s *SettingService) GetSubUpdates() (string, error) {
	return s.getString("subUpdates")
}

func (s *SettingService) GetSubEncrypt() (bool, error) {
	return s.getBool("subEncrypt")
}

func (s *SettingService) GetSubShowInfo() (bool, error) {
	return s.getBool("subShowInfo")
}

func (s *SettingService) GetPageSize() (int, error) {
	return s.getInt("pageSize")
}

func (s *SettingService) GetSubURI() (string, error) {
	return s.getString("subURI")
}

func (s *SettingService) GetSubPageURI() (string, error) {
	return s.getString("subPageURI")
}

func (s *SettingService) GetSubJsonURI() (string, error) {
	return s.getString("subJsonURI")
}

func (s *SettingService) GetSubJsonFragment() (string, error) {
	return s.getString("subJsonFragment")
}

func (s *SettingService) GetSubJsonNoises() (string, error) {
	return s.getString("subJsonNoises")
}

func (s *SettingService) GetSubJsonMux() (string, error) {
	return s.getString("subJsonMux")
}

func (s *SettingService) GetSubJsonRules() (string, error) {
	return s.getString("subJsonRules")
}

func (s *SettingService) GetSubProviderID() (string, error) {
	return s.getString("subProviderID")
}

func (s *SettingService) GetSubProviderIDMethod() (string, error) {
	method, err := s.getString("subProviderIDMethod")
	if err != nil {
		return "url", nil // Default to "url" for backward compatibility
	}
	if method == "" {
		return "url", nil // Default to "url" if empty
	}
	return method, nil
}

func (s *SettingService) SetSubProviderIDMethod(value string) error {
	validMethods := map[string]bool{
		"url":    true,
		"header": true,
		"body":   true,
		"none":   true,
	}
	if !validMethods[value] {
		return common.NewErrorf("invalid subProviderIDMethod: %s (must be one of: url, header, body, none)", value)
	}
	return s.setString("subProviderIDMethod", value)
}

func (s *SettingService) GetSubPageTheme() (string, error) {
	return s.getString("subPageTheme")
}

func (s *SettingService) SetSubPageTheme(theme string) error {
	return s.setString("subPageTheme", theme)
}

func (s *SettingService) GetSubPageLogoUrl() (string, error) {
	return s.getString("subPageLogoUrl")
}

func (s *SettingService) SetSubPageLogoUrl(url string) error {
	return s.setString("subPageLogoUrl", url)
}

func (s *SettingService) GetSubPageBrandText() (string, error) {
	return s.getString("subPageBrandText")
}

func (s *SettingService) SetSubPageBrandText(text string) error {
	return s.setString("subPageBrandText", text)
}

func (s *SettingService) GetSubPageBackgroundUrl() (string, error) {
	return s.getString("subPageBackgroundUrl")
}

func (s *SettingService) SetSubPageBackgroundUrl(url string) error {
	return s.setString("subPageBackgroundUrl", url)
}

// GetSubHeaders retrieves subscription headers configuration as JSON string
func (s *SettingService) GetSubHeaders() (string, error) {
	return s.getString("subHeaders")
}

// SetSubHeaders saves subscription headers configuration as JSON string
func (s *SettingService) SetSubHeaders(headersJSON string) error {
	return s.setString("subHeaders", headersJSON)
}

// GetSubHeadersParsed retrieves and parses subscription headers configuration
func (s *SettingService) GetSubHeadersParsed() (*entity.SubscriptionHeaders, error) {
	headersJSON, err := s.GetSubHeaders()
	if err != nil {
		return nil, err
	}

	// If empty or "{}", return empty headers
	if headersJSON == "" || headersJSON == "{}" {
		return &entity.SubscriptionHeaders{}, nil
	}

	var headers entity.SubscriptionHeaders
	if err := json.Unmarshal([]byte(headersJSON), &headers); err != nil {
		// If parsing fails, return empty headers instead of error
		// This allows the system to continue working even with invalid JSON
		return &entity.SubscriptionHeaders{}, nil
	}

	return &headers, nil
}

// SetSubHeadersParsed saves subscription headers configuration from struct
func (s *SettingService) SetSubHeadersParsed(headers *entity.SubscriptionHeaders) error {
	if headers == nil {
		return s.SetSubHeaders("{}")
	}

	headersJSON, err := json.Marshal(headers)
	if err != nil {
		return fmt.Errorf("failed to marshal subscription headers: %w", err)
	}

	return s.SetSubHeaders(string(headersJSON))
}

func (s *SettingService) GetDatepicker() (string, error) {
	return s.getString("datepicker")
}

func (s *SettingService) GetWarp() (string, error) {
	return s.getString("warp")
}

func (s *SettingService) SetWarp(data string) error {
	return s.setString("warp", data)
}

func (s *SettingService) GetExternalTrafficInformEnable() (bool, error) {
	return s.getBool("externalTrafficInformEnable")
}

func (s *SettingService) SetExternalTrafficInformEnable(value bool) error {
	return s.setBool("externalTrafficInformEnable", value)
}

func (s *SettingService) GetExternalTrafficInformURI() (string, error) {
	return s.getString("externalTrafficInformURI")
}

func (s *SettingService) SetExternalTrafficInformURI(InformURI string) error {
	return s.setString("externalTrafficInformURI", InformURI)
}

// LDAP exported getters
func (s *SettingService) GetLdapEnable() (bool, error) {
	return s.getBool("ldapEnable")
}

func (s *SettingService) GetLdapHost() (string, error) {
	return s.getString("ldapHost")
}

func (s *SettingService) GetLdapPort() (int, error) {
	return s.getInt("ldapPort")
}

func (s *SettingService) GetLdapUseTLS() (bool, error) {
	return s.getBool("ldapUseTLS")
}

func (s *SettingService) GetLdapBindDN() (string, error) {
	return s.getString("ldapBindDN")
}

func (s *SettingService) GetLdapPassword() (string, error) {
	return s.getString("ldapPassword")
}

func (s *SettingService) GetLdapBaseDN() (string, error) {
	return s.getString("ldapBaseDN")
}

func (s *SettingService) GetLdapUserFilter() (string, error) {
	return s.getString("ldapUserFilter")
}

func (s *SettingService) GetLdapUserAttr() (string, error) {
	return s.getString("ldapUserAttr")
}

func (s *SettingService) GetLdapVlessField() (string, error) {
	return s.getString("ldapVlessField")
}

func (s *SettingService) GetLdapSyncCron() (string, error) {
	return s.getString("ldapSyncCron")
}

func (s *SettingService) GetLdapFlagField() (string, error) {
	return s.getString("ldapFlagField")
}

func (s *SettingService) GetLdapTruthyValues() (string, error) {
	return s.getString("ldapTruthyValues")
}

func (s *SettingService) GetLdapInvertFlag() (bool, error) {
	return s.getBool("ldapInvertFlag")
}

func (s *SettingService) GetLdapInboundTags() (string, error) {
	return s.getString("ldapInboundTags")
}

func (s *SettingService) GetLdapAutoCreate() (bool, error) {
	return s.getBool("ldapAutoCreate")
}

func (s *SettingService) GetLdapAutoDelete() (bool, error) {
	return s.getBool("ldapAutoDelete")
}

func (s *SettingService) GetLdapDefaultTotalGB() (int, error) {
	return s.getInt("ldapDefaultTotalGB")
}

func (s *SettingService) GetLdapDefaultExpiryDays() (int, error) {
	return s.getInt("ldapDefaultExpiryDays")
}

func (s *SettingService) GetLdapDefaultLimitIP() (int, error) {
	return s.getInt("ldapDefaultLimitIP")
}

// GetMultiNodeMode returns whether multi-node mode is enabled.
func (s *SettingService) GetMultiNodeMode() (bool, error) {
	return s.getBool("multiNodeMode")
}

// SetMultiNodeMode sets the multi-node mode setting.
func (s *SettingService) SetMultiNodeMode(enabled bool) error {
	return s.setBool("multiNodeMode", enabled)
}

// GetEnableIPv6 returns whether public IPv6 detection is enabled for dashboard status.
func (s *SettingService) GetEnableIPv6() (bool, error) {
	return s.getBool("enableIPv6")
}

const (
	nodePollSecMin = 1
	nodePollSecMax = 600
)

func clampNodePollSec(n int) int {
	if n < nodePollSecMin {
		return nodePollSecMin
	}
	if n > nodePollSecMax {
		return nodePollSecMax
	}
	return n
}

// GetNodeStatsCollectionIntervalSec returns how often CollectNodeStats runs against workers (multi-node).
func (s *SettingService) GetNodeStatsCollectionIntervalSec() (int, error) {
	n, err := s.getInt("nodeStatsCollectionIntervalSec")
	if err != nil {
		return 3, err
	}
	return clampNodePollSec(n), nil
}

// GetNodeHealthCheckIntervalSec returns liveness interval when the node status is online.
func (s *SettingService) GetNodeHealthCheckIntervalSec() (int, error) {
	n, err := s.getInt("nodeHealthCheckIntervalSec")
	if err != nil {
		return 15, err
	}
	return clampNodePollSec(n), nil
}

// GetNodeHealthCheckDegradedIntervalSec returns liveness interval when the node is not online (error/offline/unknown).
func (s *SettingService) GetNodeHealthCheckDegradedIntervalSec() (int, error) {
	n, err := s.getInt("nodeHealthCheckDegradedIntervalSec")
	if err != nil {
		return 5, err
	}
	return clampNodePollSec(n), nil
}

// GetHwidMode returns the HWID tracking mode.
// Returns: "off", "client_header", or "legacy_fingerprint"
func (s *SettingService) GetHwidMode() (string, error) {
	mode, err := s.getString("hwidMode")
	if err != nil {
		return "client_header", err // Default to client_header on error
	}
	// Validate mode
	validModes := map[string]bool{
		"off":                true,
		"client_header":      true,
		"legacy_fingerprint": true,
	}
	if !validModes[mode] {
		// Invalid mode, return default
		return "client_header", nil
	}
	return mode, nil
}

// SetHwidMode sets the HWID tracking mode.
// Valid values: "off", "client_header", "legacy_fingerprint"
func (s *SettingService) SetHwidMode(mode string) error {
	validModes := map[string]bool{
		"off":                true,
		"client_header":      true,
		"legacy_fingerprint": true,
	}
	if !validModes[mode] {
		return common.NewErrorf("invalid hwidMode: %s (must be one of: off, client_header, legacy_fingerprint)", mode)
	}
	return s.setString("hwidMode", mode)
}

func (s *SettingService) UpdateAllSetting(allSetting *entity.AllSetting) error {
	if err := allSetting.CheckValid(); err != nil {
		return err
	}

	if !allSetting.TwoFactorEnable {
		allSetting.TwoFactorToken = ""
	}

	// Settings that should only be configured via environment variables
	// These are ignored when saving from web UI
	envOnlySettings := map[string]bool{
		"webPort":     true,
		"webListen":   true,
		"webDomain":   true,
		"webBasePath": true,
		"webCertFile": true,
		"webKeyFile":  true,
		"subPort":     true,
		"subPath":     true,
		"subDomain":   true,
		"subCertFile": true,
		"subKeyFile":  true,
	}

	v := reflect.ValueOf(allSetting).Elem()
	t := reflect.TypeOf(allSetting).Elem()
	fields := reflect_util.GetFields(t)
	errs := make([]error, 0)
	for _, field := range fields {
		key := field.Tag.Get("json")

		// Skip settings that should only be configured via environment variables
		if envOnlySettings[key] {
			continue
		}

		fieldV := v.FieldByName(field.Name)

		// Handle boolean fields explicitly to ensure correct string representation
		var value string
		switch fieldV.Kind() {
		case reflect.Bool:
			value = strconv.FormatBool(fieldV.Bool())
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			value = strconv.FormatInt(fieldV.Int(), 10)
		case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
			value = strconv.FormatUint(fieldV.Uint(), 10)
		case reflect.String:
			value = fieldV.String()
		default:
			value = fmt.Sprint(fieldV.Interface())
		}

		err := s.saveSetting(key, value)
		if err != nil {
			errs = append(errs, err)
		}
	}

	// Reinitialize logger and metrics exporter if Grafana settings changed
	if allSetting.GrafanaEnable && allSetting.GrafanaLokiUrl != "" {
		// Validate Loki URL format before initializing
		if _, err := url.Parse(allSetting.GrafanaLokiUrl); err != nil {
			logger.Errorf("Invalid Grafana Loki URL format: %v", err)
			// Continue without Loki rather than failing completely
		} else {
			// Reinitialize with Loki - use DEBUG level when Grafana is enabled for full logging
			// InitLoggerWithLoki handles errors internally and falls back gracefully
			logger.InitLoggerWithLoki(logging.DEBUG, allSetting.GrafanaLokiUrl, true, "")
			// Grafana mode = full fidelity to Loki; let everything through
			// the Emit gate so Loki receives all levels.
			logger.SetMinEmitLevel("debug")
		}
	} else {
		// Reinitialize without Loki
		// Use panel log level if set, otherwise fall back to env var
		var logLevel logging.Level
		var emitLevel string
		panelLogLevel, err := s.getString("panelLogLevel")
		if err != nil || panelLogLevel == "" {
			// Fall back to env var
			switch config.GetLogLevel() {
			case config.Debug:
				logLevel, emitLevel = logging.DEBUG, "debug"
			case config.Info:
				logLevel, emitLevel = logging.INFO, "info"
			case config.Notice:
				logLevel, emitLevel = logging.NOTICE, "info"
			case config.Warning:
				logLevel, emitLevel = logging.WARNING, "warn"
			case config.Error:
				logLevel, emitLevel = logging.ERROR, "error"
			default:
				logLevel, emitLevel = logging.INFO, "info"
			}
		} else {
			// Use panel log level setting
			switch strings.ToLower(panelLogLevel) {
			case "debug":
				logLevel, emitLevel = logging.DEBUG, "debug"
			case "info":
				logLevel, emitLevel = logging.INFO, "info"
			case "notice":
				logLevel, emitLevel = logging.NOTICE, "info"
			case "warning":
				logLevel, emitLevel = logging.WARNING, "warn"
			case "error":
				logLevel, emitLevel = logging.ERROR, "error"
			default:
				logLevel, emitLevel = logging.INFO, "info"
			}
		}
		logger.InitLogger(logLevel)
		// Gate the in-memory UI buffer / Loki / node→panel pusher to the same
		// level. Without this, debug noise from Xray and node logs floods the
		// dashboard regardless of the operator's choice.
		logger.SetMinEmitLevel(emitLevel)
	}

	ApplyLogRotateFromSettings(allSetting)

	// Initialize metrics exporter (metrics are exposed via /panel/metrics endpoint)
	InitMetricsExporter()

	// Capture-everything mode for Xray logs:
	// keep debug verbosity and force access/error file outputs so history is always readable.
	if err := s.ensureXrayLoggingDefaults(); err != nil {
		logger.Warningf("ensure xray logging defaults: %v", err)
	}

	return common.Combine(errs...)
}

func (s *SettingService) ensureXrayLoggingDefaults() error {
	accessPath := config.GetLogFolder() + "/xray-access.log"
	errorPath := config.GetLogFolder() + "/xray-error.log"
	raw, err := s.getString("xrayTemplateConfig")
	if err != nil || strings.TrimSpace(raw) == "" {
		return err
	}

	var cfg map[string]any
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return err
	}

	logObj, _ := cfg["log"].(map[string]any)
	if logObj == nil {
		logObj = map[string]any{}
	}
	changed := false

	// Loglevel: respect operator-set values. Only normalize when the field
	// is missing or contains an unknown token. Use panelLogLevel as the
	// fallback so the dashboard knob actually steers Xray verbosity.
	current := strings.ToLower(strings.TrimSpace(asString(logObj["loglevel"])))
	if !isValidXrayLogLevel(current) {
		target := s.resolveXrayLogLevelFromPanel()
		if current != target {
			logObj["loglevel"] = target
			changed = true
		}
	}

	accessCurrent, _ := logObj["access"].(string)
	if strings.TrimSpace(accessCurrent) != accessPath {
		logObj["access"] = accessPath
		changed = true
	}

	errorCurrent, _ := logObj["error"].(string)
	if strings.TrimSpace(errorCurrent) != errorPath {
		logObj["error"] = errorPath
		changed = true
	}

	if !changed {
		return nil
	}

	cfg["log"] = logObj
	updated, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := s.saveSetting("xrayTemplateConfig", string(updated)); err != nil {
		return err
	}

	xrayService := NewXrayService()
	xrayService.RestartXrayAsync(false)
	return nil
}

// isValidXrayLogLevel reports whether v is one of the values Xray accepts in
// its `log.loglevel` field. Used by ensureXrayLoggingDefaults to decide
// whether the operator-supplied value should be left intact.
func isValidXrayLogLevel(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "debug", "info", "warning", "error", "none":
		return true
	}
	return false
}

// resolveXrayLogLevelFromPanel maps panelLogLevel to a valid Xray loglevel.
// "warn" is renamed to "warning" because Xray rejects the short form.
// Unknown / empty values fall back to "warning" — the safe default that
// keeps logs useful without producing the firehose that "debug" generates.
func (s *SettingService) resolveXrayLogLevelFromPanel() string {
	panelLogLevel, _ := s.getString("panelLogLevel")
	switch strings.ToLower(strings.TrimSpace(panelLogLevel)) {
	case "debug":
		return "debug"
	case "info":
		return "info"
	case "notice":
		// Xray has no "notice"; closest semantic is info.
		return "info"
	case "warn", "warning":
		return "warning"
	case "error":
		return "error"
	default:
		return "warning"
	}
}

// asString returns v as a trimmed string when v is a string, otherwise "".
// Used to safely read map[string]any fields that may be nil/typed.
func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// EnsureXrayLoggingDefaults ensures xrayTemplateConfig has persistent access/error paths and debug level.
func (s *SettingService) EnsureXrayLoggingDefaults() error {
	return s.ensureXrayLoggingDefaults()
}

func (s *SettingService) GetDefaultXrayConfig() (any, error) {
	var jsonData any
	err := json.Unmarshal([]byte(defaultXrayTemplateConfig), &jsonData)
	if err != nil {
		return nil, err
	}
	return jsonData, nil
}

func (s *SettingService) GetDefaultSettings(host string) (any, error) {
	type settingFunc func() (any, error)
	settings := map[string]settingFunc{
		"expireDiff":    func() (any, error) { return s.GetExpireDiff() },
		"trafficDiff":   func() (any, error) { return s.GetTrafficDiff() },
		"pageSize":      func() (any, error) { return s.GetPageSize() },
		"defaultCert":   func() (any, error) { return s.GetCertFile() },
		"defaultKey":    func() (any, error) { return s.GetKeyFile() },
		"tgBotEnable":   func() (any, error) { return s.GetTgbotEnabled() },
		"subEnable":     func() (any, error) { return s.GetSubEnable() },
		"subJsonEnable": func() (any, error) { return s.GetSubJsonEnable() },
		"subTitle":      func() (any, error) { return s.GetSubTitle() },
		"subURI":        func() (any, error) { return s.GetSubURI() },
		"subJsonURI":    func() (any, error) { return s.GetSubJsonURI() },
		"remarkModel":   func() (any, error) { return s.GetRemarkModel() },
		"datepicker":    func() (any, error) { return s.GetDatepicker() },
	}

	result := make(map[string]any)
	for key, fn := range settings {
		value, err := fn()
		if err != nil {
			return nil, err
		}
		result[key] = value
	}

	subEnable := result["subEnable"].(bool)
	subJsonEnable := false
	if v, ok := result["subJsonEnable"]; ok {
		if b, ok2 := v.(bool); ok2 {
			subJsonEnable = b
		}
	}
	if (subEnable && result["subURI"].(string) == "") || (subJsonEnable && result["subJsonURI"].(string) == "") {
		subURI := ""
		subTitle, _ := s.GetSubTitle()
		subPort, _ := s.GetSubPort()
		subPath, _ := s.GetSubPath()
		subJsonPath, _ := s.GetSubJsonPath()
		subDomain, _ := s.GetSubDomain()
		subKeyFile, _ := s.GetSubKeyFile()
		subCertFile, _ := s.GetSubCertFile()
		subTLS := false
		if subKeyFile != "" && subCertFile != "" {
			subTLS = true
		}
		if subDomain == "" {
			subDomain = strings.Split(host, ":")[0]
		}
		if subTLS {
			subURI = "https://"
		} else {
			subURI = "http://"
		}
		if (subPort == 443 && subTLS) || (subPort == 80 && !subTLS) {
			subURI += subDomain
		} else {
			subURI += fmt.Sprintf("%s:%d", subDomain, subPort)
		}
		if subEnable && result["subURI"].(string) == "" {
			result["subURI"] = subURI + subPath
		}
		if result["subTitle"].(string) == "" {
			result["subTitle"] = subTitle
		}
		if subJsonEnable && result["subJsonURI"].(string) == "" {
			result["subJsonURI"] = subURI + subJsonPath
		}
	}

	return result, nil
}

// GetGrafanaDashboard returns the Grafana dashboard JSON content
func (s *SettingService) GetGrafanaDashboard() (string, error) {
	if grafanaDashboardJSON == "" {
		return "", errors.New("Grafana dashboard not found")
	}
	return grafanaDashboardJSON, nil
}
