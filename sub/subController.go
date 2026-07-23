package sub

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	service "github.com/konstpic/sharx-code/v2/web/service"

	"github.com/gin-gonic/gin"
)

// SUBController handles HTTP requests for subscription links and JSON configurations.
type SUBController struct {
	subPath     string
	subJsonPath string
	jsonEnabled bool

	subService     *SubService
	subJsonService *SubJsonService
}

// NewSUBController creates a new subscription controller with the given configuration.
// Runtime behavior (encryption / show-info / JSON templates / response headers)
// is read from SubscriptionPageConfigService.GetActiveV2Config on every request
// so edits in the panel builder apply without restarting.
func NewSUBController(
	g *gin.RouterGroup,
	subPath string,
	jsonPath string,
	jsonEnabled bool,
	rModel string,
) *SUBController {
	sub := NewSubService(false, rModel)
	sub.nodeService = service.NodeService{}
	sub.hostService = service.HostService{}
	sub.clientService = service.ClientService{}
	a := &SUBController{
		subPath:        subPath,
		subJsonPath:    jsonPath,
		jsonEnabled:    jsonEnabled,
		subService:     sub,
		subJsonService: NewSubJsonService("", "", "", "", sub),
	}
	a.initRouter(g)
	return a
}

// activeV2Config returns the active v2 config with legacy fallbacks, or nil on error.
func (a *SUBController) activeV2Config() *service.SharxSubpageConfigV2 {
	cfg, err := (service.SubscriptionPageConfigService{}).GetActiveV2Config()
	if err != nil || cfg == nil {
		logger.Warningf("sub: failed to load active subscription page config: %v", err)
		return nil
	}
	return cfg
}

func (a *SUBController) refreshRemarkModel() {
	settingService := service.SettingService{}
	remarkModel, err := settingService.GetRemarkModel()
	if err != nil {
		a.subService.remarkModel = "-ieo"
		return
	}
	remarkModel = strings.TrimSpace(remarkModel)
	if remarkModel == "" {
		remarkModel = "-ieo"
	}
	a.subService.remarkModel = remarkModel
}

// initRouter registers HTTP routes for subscription links and JSON endpoints
// on the provided router group.
func (a *SUBController) initRouter(g *gin.RouterGroup) {
	gLink := g.Group(a.subPath)
	gLink.GET(":subid", a.subs)
	if a.jsonEnabled {
		gJson := g.Group(a.subJsonPath)
		gJson.GET(":subid", a.subJsons)
	}
}

// isAllowedUserAgent checks if the User-Agent is allowed when encryption is enabled.
// Allows: Happ, v2raytun, INCY, or browser (detected by Accept header).
// For Happ/v2raytun/INCY, also requires all HWID fields to be present.
func (a *SUBController) isAllowedUserAgent(c *gin.Context) bool {
	userAgent := strings.ToLower(c.GetHeader("User-Agent"))
	accept := strings.ToLower(c.GetHeader("Accept"))

	// Check for browser (by Accept header containing text/html)
	if strings.Contains(accept, "text/html") {
		return true
	}

	// Check if explicitly requesting HTML view
	if c.Query("html") == "1" || strings.EqualFold(c.Query("view"), "html") {
		return true
	}

	isHapp := strings.Contains(userAgent, "happ")
	isV2RayTun := strings.Contains(userAgent, "v2raytun")
	isIncy := strings.Contains(userAgent, "incy") ||
		strings.EqualFold(strings.TrimSpace(c.GetHeader("x-client")), "incy")

	if isHapp || isV2RayTun || isIncy {
		// Check for all required HWID fields
		hwid := c.GetHeader("x-hwid")
		if hwid == "" {
			hwid = c.GetHeader("X-HWID")
		}

		deviceOS := c.GetHeader("x-device-os")
		if deviceOS == "" {
			deviceOS = c.GetHeader("X-Device-OS")
		}

		deviceModel := c.GetHeader("x-device-model")
		if deviceModel == "" {
			deviceModel = c.GetHeader("X-Device-Model")
		}

		osVersion := c.GetHeader("x-ver-os")
		if osVersion == "" {
			osVersion = c.GetHeader("X-Ver-OS")
		}

		// All HWID fields must be present
		if hwid != "" && deviceOS != "" && deviceModel != "" && osVersion != "" {
			return true
		}

		// Missing HWID fields - not allowed
		return false
	}

	return false
}

// subs handles HTTP requests for subscription links, returning either an HTML
// redirect to the first-party React page or base64-encoded subscription data.
func (a *SUBController) subs(c *gin.Context) {
	subId := c.Param("subid")
	a.refreshRemarkModel()

	userAgent := c.GetHeader("User-Agent")
	service.RecordUserAgent(userAgent)

	cfg := a.activeV2Config()
	subEncrypt := false
	if cfg != nil && cfg.AppSettings != nil {
		subEncrypt = cfg.AppSettings.Encrypt
	}

	// Route by User-Agent first so the response format/Content-Type matches
	// the client's expectations (browser → UI redirect, Happ/v2rayTun →
	// encrypted base64, other known apps → base64 / YAML / JSON).
	uaClient, uaFormat := DispatchByUA(c)

	// ?format= query parameter overrides UA-based detection.
	// Supported values: clash, clash-meta, mihomo → FormatClashYAML.
	if fmtParam := strings.ToLower(strings.TrimSpace(c.Query("format"))); fmtParam != "" {
		switch fmtParam {
		case "clash", "clash-meta", "mihomo":
			uaFormat = FormatClashYAML
		}
	}

	if uaFormat == FormatRedirectUI || uaClient == UABrowser {
		ss := service.SettingService{}
		tls := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
		if target := service.FirstPartySubPageURL(ss, subId, c.Request.Host, tls); target != "" {
			c.Redirect(http.StatusFound, target)
			return
		}
		c.String(http.StatusNotFound, "Not found")
		return
	}

	if subEncrypt {
		if !a.isAllowedUserAgent(c) {
			logger.Warningf("Subscription request blocked: encryption enabled but User-Agent not allowed (subId: %s, User-Agent: %s)",
				subId, userAgent)
			c.String(403, "Forbidden")
			return
		}
	}

	_, host, _, _ := a.subService.ResolveRequest(c)
	subs, _, traffic, err := a.subService.GetSubs(subId, host, c)
	if err != nil || len(subs) == 0 {
		a.writeSubscriptionFailure(c, "GetSubs", subId, err, len(subs) == 0)
		return
	}
	subs = filterSubscriptionLinksForClient(subs, uaClient)
	if len(subs) == 0 {
		a.writeSubscriptionFailure(c, "GetSubs", subId, nil, true)
		return
	}

	result := ""

	settingService := service.SettingService{}
	providerID, err := settingService.GetSubProviderID()
	if err == nil && providerID != "" {
		providerMethod, err := settingService.GetSubProviderIDMethod()
		if err == nil && providerMethod == "body" {
			result += fmt.Sprintf("#providerid %s\n", providerID)
		}
	}

	for i, sub := range subs {
		if i > 0 {
			result += subscriptionEntrySeparator(uaClient)
		}
		result += sub
	}

	header := fmt.Sprintf("upload=%d; download=%d; total=%d; expire=%d", traffic.Up, traffic.Down, traffic.Total, traffic.ExpiryTime/1000)

	clientAnnounce := ""
	db := database.GetDB()
	var clientEntity *model.ClientEntity
	err = db.Where("sub_id = ? AND enable = ?", subId, true).First(&clientEntity).Error
	if err == nil && clientEntity != nil && clientEntity.Announce != "" {
		clientAnnounce = clientEntity.Announce
	}

	result = prependSubscriptionBodyMetaComments(result, uaClient, cfg, clientAnnounce)

	a.ApplyCommonHeaders(c, cfg, header, subId, clientAnnounce)
	c.Writer.Header().Set("Content-Type", ContentTypeForClient(uaClient, uaFormat))

	// Dispatch the body encoding based on both the UA-derived format and the
	// global encryption flag. Encrypted-aware clients (Happ/v2rayTun) get
	// the existing base64 payload; other known clients get base64 too (most
	// subscription readers accept it). A Clash-YAML / SIP008 body can be
	// introduced later; we currently send base64 with a hint header.
	if subEncrypt || uaFormat == FormatEncrypted {
		c.String(200, base64.StdEncoding.EncodeToString([]byte(result)))
		return
	}
	switch uaFormat {
	case FormatBase64:
		c.String(200, base64.StdEncoding.EncodeToString([]byte(result)))
	case FormatClashYAML:
		// Convert subscription links to Clash YAML; send raw (no base64).
		yamlBody, err := LinksToClashYAML(subs)
		if err != nil {
			logger.Warningf("Clash YAML conversion failed for subId %s: %v", subId, err)
			c.String(500, "internal error")
			return
		}
		c.Writer.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		c.String(200, yamlBody)
	case FormatSIP008, FormatXrayJSON:
		// Fallback: send base64; advertise intended format for debugging.
		c.Writer.Header().Set("X-Subscription-Preferred-Format", string(uaFormat))
		c.String(200, base64.StdEncoding.EncodeToString([]byte(result)))
	default:
		c.String(200, result)
	}
}

// subJsons handles HTTP requests for JSON subscription configurations.
func (a *SUBController) subJsons(c *gin.Context) {
	subId := c.Param("subid")
	a.refreshRemarkModel()

	userAgent := c.GetHeader("User-Agent")
	service.RecordUserAgent(userAgent)

	cfg := a.activeV2Config()
	subEncrypt := false
	if cfg != nil && cfg.AppSettings != nil {
		subEncrypt = cfg.AppSettings.Encrypt
	}
	if cfg != nil && cfg.JsonTemplates != nil {
		a.subJsonService.applyTemplates(cfg.JsonTemplates.Fragment, cfg.JsonTemplates.Noises, cfg.JsonTemplates.Mux, cfg.JsonTemplates.Rules)
	}

	if subEncrypt {
		if !a.isAllowedUserAgent(c) {
			logger.Warningf("JSON subscription request blocked: encryption enabled but User-Agent not allowed (subId: %s, User-Agent: %s)",
				subId, userAgent)
			c.String(403, "Forbidden")
			return
		}
	}

	_, host, _, _ := a.subService.ResolveRequest(c)
	jsonSub, header, err := a.subJsonService.GetJson(subId, host, c)
	if err != nil || len(jsonSub) == 0 {
		a.writeSubscriptionFailure(c, "GetJson", subId, err, len(jsonSub) == 0)
		return
	}

	clientAnnounce := ""
	db := database.GetDB()
	var clientEntity *model.ClientEntity
	err = db.Where("sub_id = ? AND enable = ?", subId, true).First(&clientEntity).Error
	if err == nil && clientEntity != nil && clientEntity.Announce != "" {
		clientAnnounce = clientEntity.Announce
	}

	a.ApplyCommonHeaders(c, cfg, header, subId, clientAnnounce)
	c.Writer.Header().Set("Content-Type", "application/json; charset=utf-8")

	c.String(200, jsonSub)
}

// ApplyCommonHeaders sets HTTP headers for subscription responses from the
// active sharx-v2 config: ResponseRules (profile title, update interval, announce,
// support URL, profile web page URL, extra headers), and inline client routing
// (Routing = happ://routing/add/{base64} or other scheme from profile preset; Routing-Enable)
// when routing.profiles contains a valid inline JSON body.
// Canonical headers (Subscription-Userinfo, X-Subscription-ID, Profile-Update-Interval)
// are always emitted. Extra headers override auto Routing when the same key is set.
// clientAnnounce (if present on the client row) overrides ResponseRules.Announce.
func (a *SUBController) ApplyCommonHeaders(c *gin.Context, cfg *service.SharxSubpageConfigV2, header, subId, clientAnnounce string) {
	c.Writer.Header().Set("Subscription-Userinfo", header)
	c.Writer.Header().Set("X-Subscription-ID", subId)

	var rr *service.SharxSubpageResponseRules
	if cfg != nil {
		rr = cfg.ResponseRules
	}

	sendInterval := rr == nil || service.ResponseHeaderDeliversHTTP(rr.ProfileUpdateIntervalDelivery)
	if sendInterval {
		c.Writer.Header().Set("Profile-Update-Interval", strconv.Itoa(service.ProfileUpdateIntervalValue(rr)))
	}

	if rr != nil && service.ResponseHeaderDeliversHTTP(rr.ProfileTitleDelivery) {
		if title := service.ProfileTitleHTTPValue(rr.ProfileTitle); title != "" {
			c.Writer.Header().Set("Profile-Title", title)
		}
	}

	if rr != nil && service.ResponseHeaderDeliversHTTP(rr.SupportURLDelivery) {
		if v := strings.TrimSpace(rr.SupportURL); v != "" {
			c.Writer.Header().Set("Support-Url", v)
		}
	}
	if rr != nil && service.ResponseHeaderDeliversHTTP(rr.ProfileWebPageURLDelivery) {
		if v := strings.TrimSpace(rr.ProfileWebPageURL); v != "" {
			c.Writer.Header().Set("Profile-Web-Page-Url", v)
		}
	}

	if rr != nil && service.ResponseHeaderDeliversHTTP(rr.AnnounceDelivery) {
		if v := service.AnnounceHTTPValue(service.EffectiveAnnounce(clientAnnounce, rr.Announce)); v != "" {
			c.Writer.Header().Set("Announce", v)
		}
	}

	settingService := service.SettingService{}
	if providerID, err := settingService.GetSubProviderID(); err == nil && providerID != "" {
		if providerMethod, err := settingService.GetSubProviderIDMethod(); err == nil && providerMethod == "header" {
			c.Writer.Header().Set("providerid", providerID)
		}
	}

	// Client routing (Happ-style JSON) from subscription page config: first inline profile.
	// Value is a full deeplink happ://routing/add/{base64} (or incy/sharx/custom prefix) per Happ docs.
	// ExtraHeaders below can override Routing / Routing-Enable if set manually.
	routingDelivery := service.ResponseHeaderDeliveryHeader
	if cfg != nil && cfg.Routing != nil {
		routingDelivery = cfg.Routing.Delivery
	}
	if routingVal, ok := service.RoutingHeaderValueForSubscription(cfg); ok &&
		service.ResponseHeaderDeliversHTTP(routingDelivery) {
		c.Writer.Header().Set("Routing", routingVal)
		c.Writer.Header().Set("Routing-Enable", "1")
	}

	if rr != nil {
		for _, h := range rr.ExtraHeaders {
			key := strings.TrimSpace(h.Key)
			if key == "" || !service.ResponseHeaderDeliversHTTP(h.Delivery) {
				continue
			}
			c.Writer.Header().Set(key, h.Value)
		}
	}

	// Legacy / manual "Routing" may be raw Base64 or happ://add/…; clients expect happ://routing/add/…
	if rh := strings.TrimSpace(c.Writer.Header().Get("Routing")); rh != "" {
		c.Writer.Header().Set("Routing", service.NormalizeSubscriptionRoutingHeaderValue(rh))
	}
}

// writeSubscriptionFailure logs the failure reason and sends a non-revealing response body.
func (a *SUBController) writeSubscriptionFailure(c *gin.Context, op, subId string, err error, empty bool) {
	status, public := subscriptionFailureStatus(err, empty)
	if err != nil {
		if status == http.StatusInternalServerError {
			logger.Errorf("sub: %s subId=%s: %v", op, subId, err)
		} else {
			logger.Warningf("sub: %s subId=%s: %v", op, subId, err)
		}
	} else if empty {
		logger.Warningf("sub: %s empty result subId=%s", op, subId)
	}
	c.String(status, public)
}

func subscriptionFailureStatus(err error, empty bool) (int, string) {
	if err != nil {
		if errors.Is(err, service.ErrSessionIPBlocked) {
			return http.StatusForbidden, "Forbidden"
		}
		msg := err.Error()
		if strings.Contains(msg, "HWID limit exceeded") {
			return http.StatusForbidden, "Forbidden"
		}
		if strings.Contains(msg, "No inbounds found") {
			return http.StatusNotFound, "Not found"
		}
		return http.StatusInternalServerError, "Error!"
	}
	if empty {
		return http.StatusNotFound, "Not found"
	}
	return http.StatusInternalServerError, "Error!"
}
