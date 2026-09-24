package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/web/entity"
	"github.com/konstpic/sharx-code/v2/web/service"

	"github.com/gin-gonic/gin"
)

var hubUUIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// registerTemplateHubRoutes adds the shared-templates routes to the settings group (session-protected).
func (a *SettingController) registerTemplateHubRoutes(g *gin.RouterGroup) {
	t := g.Group("/templates")
	t.POST("/list", a.hubList)
	t.POST("/preview", a.hubPreview)
	t.POST("/publish", a.hubPublish)
	t.POST("/get", a.hubGet)
	t.POST("/rate", a.hubRate)
	t.POST("/report", a.hubReport)
	t.POST("/delete", a.hubDelete)
	t.POST("/profile/get", a.hubProfileGet)
	t.POST("/profile/set", a.hubProfileSet)
	a.registerLocalTemplateRoutes(t)
}

type hubSource struct {
	Kind      string `json:"kind"`
	InboundID int    `json:"inboundId"`
}

func hubFail(c *gin.Context, msg string) {
	c.JSON(http.StatusOK, entity.Msg{Success: false, Msg: msg})
}

// hubError reports a failed hub call; an unreachable hub gets a stable code the UI can localize.
func hubError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrHubUnavailable) {
		c.JSON(http.StatusOK, entity.Msg{Success: false, Msg: "Templates service is temporarily unavailable", Obj: gin.H{"code": "hub_unavailable"}})
		return
	}
	hubFail(c, err.Error())
}

func hubPass(c *gin.Context, r *service.HubResponse) {
	if r.Status < 200 || r.Status >= 300 {
		hubFail(c, service.HubErrorMessage(r))
		return
	}
	var obj any
	if len(r.Body) > 0 {
		_ = json.Unmarshal(r.Body, &obj)
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: obj})
}

// buildSharedContent prepares the sanitized document and a suggested title for the requested source.
func (a *SettingController) buildSharedContent(src hubSource) (map[string]any, []string, string, error) {
	switch src.Kind {
	case "inbound":
		ib, err := a.inboundService.GetInbound(src.InboundID)
		if err != nil {
			return nil, nil, "", errors.New("inbound not found")
		}
		doc, warns, err := service.SharedInboundContent(string(ib.Protocol), ib.Port, ib.Settings, ib.StreamSettings, ib.Sniffing, string(ib.TrafficReset))
		return doc, warns, ib.Remark, err
	case "xray_config":
		tpl, err := a.settingService.GetXrayConfigTemplate()
		if err != nil {
			return nil, nil, "", err
		}
		doc, warns, err := service.SanitizeXrayTemplate(tpl)
		return doc, warns, "", err
	}
	return nil, nil, "", errors.New("kind must be inbound or xray_config")
}

func (a *SettingController) hubPreview(c *gin.Context) {
	var src hubSource
	if err := c.ShouldBindJSON(&src); err != nil {
		hubFail(c, "invalid request")
		return
	}
	doc, warns, title, err := a.buildSharedContent(src)
	if err != nil {
		hubFail(c, err.Error())
		return
	}
	if warns == nil {
		warns = []string{}
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: gin.H{"content": doc, "warnings": warns, "suggestedTitle": title}})
}

func (a *SettingController) hubPublish(c *gin.Context) {
	var req struct {
		hubSource
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		hubFail(c, "invalid request")
		return
	}
	doc, _, _, err := a.buildSharedContent(req.hubSource)
	if err != nil {
		hubFail(c, err.Error())
		return
	}
	xrayVer := ""
	if v := (&service.XrayService{}).GetXrayVersion(); v != "" && v != "Unknown" {
		xrayVer = v
	}
	r, err := a.templateHub.Do(http.MethodPost, "/v1/templates", nil, gin.H{
		"kind": req.Kind, "title": req.Title, "description": req.Description, "tags": req.Tags,
		"panelVersion": config.GetVersion(), "xrayVersion": xrayVer, "content": doc,
	})
	if err != nil {
		hubError(c, err)
		return
	}
	hubPass(c, r)
}

func (a *SettingController) hubList(c *gin.Context) {
	var q struct {
		Kind   string `json:"kind"`
		Sort   string `json:"sort"`
		Q      string `json:"q"`
		Tag    string `json:"tag"`
		Mine   bool   `json:"mine"`
		Limit  int    `json:"limit"`
		Offset int    `json:"offset"`
	}
	_ = c.ShouldBindJSON(&q)
	v := url.Values{}
	if q.Kind != "" {
		v.Set("kind", q.Kind)
	}
	if q.Sort != "" {
		v.Set("sort", q.Sort)
	}
	if s := strings.TrimSpace(q.Q); s != "" {
		v.Set("q", s)
	}
	if q.Tag != "" {
		v.Set("tag", q.Tag)
	}
	if q.Mine {
		v.Set("mine", "1")
	}
	if q.Limit > 0 {
		v.Set("limit", strconv.Itoa(q.Limit))
	}
	if q.Offset > 0 {
		v.Set("offset", strconv.Itoa(q.Offset))
	}
	cacheKey := v.Encode()
	r, err := a.templateHub.Do(http.MethodGet, "/v1/templates", v, nil)
	if err != nil {
		if errors.Is(err, service.ErrHubUnavailable) {
			if body, saved, ok := service.HubCacheGet(cacheKey); ok {
				var obj map[string]any
				if json.Unmarshal(body, &obj) == nil {
					obj["stale"] = true
					obj["staleAt"] = saved.Unix()
					c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: obj})
					return
				}
			}
		}
		hubError(c, err)
		return
	}
	if r.Status >= 200 && r.Status < 300 {
		service.HubCachePut(cacheKey, r.Body)
	}
	hubPass(c, r)
}

type hubIDRequest struct {
	ID       string `json:"id"`
	Stars    int    `json:"stars"`
	Category string `json:"category"`
	Reason   string `json:"reason"`
}

func bindHubID(c *gin.Context) (*hubIDRequest, bool) {
	var req hubIDRequest
	if err := c.ShouldBindJSON(&req); err != nil || !hubUUIDRe.MatchString(req.ID) {
		hubFail(c, "invalid template id")
		return nil, false
	}
	return &req, true
}

func (a *SettingController) hubGet(c *gin.Context) {
	req, ok := bindHubID(c)
	if !ok {
		return
	}
	meta, err := a.templateHub.Do(http.MethodGet, "/v1/templates/"+req.ID, nil, nil)
	if err != nil {
		hubError(c, err)
		return
	}
	if meta.Status < 200 || meta.Status >= 300 {
		hubFail(c, service.HubErrorMessage(meta))
		return
	}
	dl, err := a.templateHub.Do(http.MethodGet, "/v1/templates/"+req.ID+"/download", nil, nil)
	if err != nil {
		hubError(c, err)
		return
	}
	if dl.Status < 200 || dl.Status >= 300 {
		hubFail(c, service.HubErrorMessage(dl))
		return
	}
	var m, content any
	_ = json.Unmarshal(meta.Body, &m)
	_ = json.Unmarshal(dl.Body, &content)
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: gin.H{"meta": m, "content": content}})
}

func (a *SettingController) hubRate(c *gin.Context) {
	req, ok := bindHubID(c)
	if !ok {
		return
	}
	r, err := a.templateHub.Do(http.MethodPost, "/v1/templates/"+req.ID+"/rating", nil, gin.H{"stars": req.Stars})
	if err != nil {
		hubError(c, err)
		return
	}
	hubPass(c, r)
}

func (a *SettingController) hubReport(c *gin.Context) {
	req, ok := bindHubID(c)
	if !ok {
		return
	}
	r, err := a.templateHub.Do(http.MethodPost, "/v1/templates/"+req.ID+"/report", nil, gin.H{"category": req.Category, "reason": req.Reason})
	if err != nil {
		hubError(c, err)
		return
	}
	hubPass(c, r)
}

func (a *SettingController) hubDelete(c *gin.Context) {
	req, ok := bindHubID(c)
	if !ok {
		return
	}
	r, err := a.templateHub.Do(http.MethodDelete, "/v1/templates/"+req.ID, nil, nil)
	if err != nil {
		hubError(c, err)
		return
	}
	if r.Status == http.StatusNoContent {
		c.JSON(http.StatusOK, entity.Msg{Success: true})
		return
	}
	hubPass(c, r)
}

func (a *SettingController) hubProfileGet(c *gin.Context) {
	r, err := a.templateHub.Do(http.MethodGet, "/v1/panel/profile", nil, nil)
	if err != nil {
		hubError(c, err)
		return
	}
	hubPass(c, r)
}

func (a *SettingController) hubProfileSet(c *gin.Context) {
	var req struct {
		DisplayName string `json:"displayName"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		hubFail(c, "invalid request")
		return
	}
	r, err := a.templateHub.Do(http.MethodPut, "/v1/panel/profile", nil, gin.H{"displayName": req.DisplayName})
	if err != nil {
		hubError(c, err)
		return
	}
	hubPass(c, r)
}
