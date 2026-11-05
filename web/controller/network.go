package controller

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
)

// NetworkController exposes the SharX Network section API to the panel UI.
type NetworkController struct {
	BaseController
	service service.NetworkService
}

func NewNetworkController(g *gin.RouterGroup) *NetworkController {
	a := &NetworkController{}
	a.initRouter(g)
	return a
}

func (a *NetworkController) initRouter(g *gin.RouterGroup) {
	g.GET("/status", a.status)
	g.POST("/enroll", a.enroll)
	g.POST("/enable", a.enable)
	g.POST("/leave", a.leave)
	g.GET("/nodes", a.nodes)
	g.POST("/nodes/publish", a.publishNode)
	g.POST("/nodes/update", a.updateNode)
	g.POST("/nodes/pause", a.pauseNode)
	g.POST("/nodes/unpublish", a.unpublishNode)
	g.GET("/catalog", a.catalog)
	g.GET("/sessions", a.sessions)
	g.POST("/sessions/open", a.openSession)
	g.POST("/sessions/close", a.closeSession)
	g.POST("/sessions/dispute", a.disputeSession)
	g.GET("/resources", a.resources)
	g.POST("/bundles", a.createBundle)
	g.POST("/bundles/assign", a.assignBundle)
	g.GET("/ledger", a.ledger)
	g.GET("/overview", a.overview)
}

func (a *NetworkController) status(c *gin.Context) {
	st, err := a.service.Status()
	if err != nil {
		jsonMsg(c, "Failed to load network status", err)
		return
	}
	jsonObj(c, st, nil)
}

type enrollForm struct {
	CoordinatorURL string `json:"coordinatorUrl" form:"coordinatorUrl"`
	InviteCode     string `json:"inviteCode" form:"inviteCode"`
	Name           string `json:"name" form:"name"`
}

func (a *NetworkController) enroll(c *gin.Context) {
	var form enrollForm
	if err := c.ShouldBind(&form); err != nil {
		jsonMsg(c, "Invalid form", err)
		return
	}
	if err := a.service.Enroll(form.CoordinatorURL, form.InviteCode, form.Name); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.enroll", "")
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) enable(c *gin.Context) {
	enabled := c.PostForm("enabled") == "true" || c.PostForm("enabled") == "1"
	if err := a.service.SetEnabled(enabled); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.enable", strconv.FormatBool(enabled))
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) leave(c *gin.Context) {
	if c.PostForm("confirm") != "LEAVE" {
		jsonMsg(c, "Confirmation required (type LEAVE)", nil)
		return
	}
	if err := a.service.Leave(); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.leave", "")
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) nodes(c *gin.Context) {
	nodes, err := a.service.PublishedNodes()
	if err != nil {
		jsonMsg(c, "Failed to load nodes", err)
		return
	}
	jsonObj(c, gin.H{"nodes": nodes}, nil)
}

func (a *NetworkController) publishParams(c *gin.Context) service.PublishParams {
	country := c.PostForm("country")
	if country == "" {
		country = "UN"
	}
	p := service.PublishParams{
		Label:             strings.TrimSpace(c.PostForm("label")),
		Country:           country,
		Security:          c.PostForm("security"),
		TrafficLimitGB:    atof(c.PostForm("trafficLimitGB")),
		SpeedLimitMbps:    atoi(c.PostForm("speedLimitMbps")),
		ReserveMbps:       atoi(c.PostForm("reserveMbps")),
		MaxSessions:       atoi(c.PostForm("maxSessions")),
		PriceCreditsPerGB: atof(c.PostForm("priceCreditsPerGB")),
		RiskAck:           c.PostForm("riskAck") == "true" || c.PostForm("riskAck") == "1",
	}
	return p
}

func (a *NetworkController) publishNode(c *gin.Context) {
	p := a.publishParams(c)
	p.NodeID = atoi(c.PostForm("nodeId"))
	if p.NodeID <= 0 {
		jsonMsg(c, "nodeId required", nil)
		return
	}
	if err := a.service.PublishNode(p); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.node.publish", strconv.Itoa(p.NodeID))
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) updateNode(c *gin.Context) {
	id := atoi(c.PostForm("id"))
	if id <= 0 {
		jsonMsg(c, "id required", nil)
		return
	}
	p := a.publishParams(c)
	if err := a.service.UpdateNode(id, p); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.node.update", strconv.Itoa(id))
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) pauseNode(c *gin.Context) {
	id := atoi(c.PostForm("id"))
	paused := c.PostForm("paused") == "true" || c.PostForm("paused") == "1"
	if id <= 0 {
		jsonMsg(c, "id required", nil)
		return
	}
	if err := a.service.SetNodePaused(id, paused); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.node.pause", strconv.Itoa(id))
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) unpublishNode(c *gin.Context) {
	id := atoi(c.PostForm("id"))
	if id <= 0 {
		jsonMsg(c, "id required", nil)
		return
	}
	if err := a.service.UnpublishNode(id); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.node.unpublish", strconv.Itoa(id))
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) catalog(c *gin.Context) {
	need := atoi(c.Query("needMbps"))
	candidates, err := a.service.Catalog(strings.ToUpper(strings.TrimSpace(c.Query("country"))), c.Query("protocol"), need)
	if err != nil {
		jsonMsg(c, "Catalog unavailable: "+err.Error(), nil)
		return
	}
	jsonObj(c, gin.H{"candidates": candidates}, nil)
}

func (a *NetworkController) sessions(c *gin.Context) {
	sessions, err := a.service.Sessions(c.Query("role"))
	if err != nil {
		jsonMsg(c, "Failed to load sessions", err)
		return
	}
	jsonObj(c, gin.H{"sessions": sessions}, nil)
}

func (a *NetworkController) openSession(c *gin.Context) {
	var form struct {
		NodeID           string  `json:"nodeId" form:"nodeId"`
		QuotaGB          float64 `json:"quotaGB" form:"quotaGB"`
		TariffRevision   int64   `json:"tariffRevision" form:"tariffRevision"`
		MaxReserveMicros int64   `json:"maxReserveMicros" form:"maxReserveMicros"`
	}
	if err := c.ShouldBind(&form); err != nil {
		jsonMsg(c, "Invalid session form", err)
		return
	}
	form.NodeID = strings.TrimSpace(form.NodeID)
	if form.NodeID == "" {
		jsonMsg(c, "nodeId required", nil)
		return
	}
	sess, err := a.service.OpenSession(form.NodeID, form.QuotaGB, form.TariffRevision, form.MaxReserveMicros)
	if err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.session.open", sess.Id)
	jsonObj(c, gin.H{"session": sess}, nil)
}

func (a *NetworkController) closeSession(c *gin.Context) {
	id := strings.TrimSpace(c.PostForm("id"))
	reason := c.PostForm("reason")
	if reason == "" {
		reason = "admin"
	}
	if err := a.service.CloseSession(id, reason); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.session.close", id)
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) disputeSession(c *gin.Context) {
	id := strings.TrimSpace(c.PostForm("id"))
	reason := strings.TrimSpace(c.PostForm("reason"))
	if id == "" || reason == "" {
		jsonMsg(c, "id and reason required", nil)
		return
	}
	if err := a.service.DisputeSession(id, reason, 0); err != nil {
		jsonMsg(c, err.Error(), nil)
		return
	}
	a.auditNetwork(c, "network.session.dispute", id)
	jsonObj(c, gin.H{"ok": true}, nil)
}

func (a *NetworkController) ledger(c *gin.Context) {
	cursor := int64(atoi(c.Query("cursor")))
	limit := atoi(c.Query("limit"))
	entries, next, err := a.service.Ledger(cursor, limit)
	if err != nil {
		jsonMsg(c, "Failed to load ledger", err)
		return
	}
	jsonObj(c, gin.H{"entries": entries, "nextCursor": next}, nil)
}

func (a *NetworkController) overview(c *gin.Context) {
	ov, err := a.service.Overview()
	if err != nil {
		jsonMsg(c, "Failed to load overview", err)
		return
	}
	jsonObj(c, ov, nil)
}

func (a *NetworkController) auditNetwork(c *gin.Context, action, entityID string) {
	var principal *service.Principal
	if user := session.GetLoginUser(c); user != nil {
		principal = &service.Principal{UserId: user.Id, Username: user.Username}
	}
	service.Audit.Record(service.Actor{Principal: principal, IP: getRemoteIp(c)},
		action, "network", entityID, "", nil, nil, "ok", "")
}

func atoi(v string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(v))
	return n
}

func atof(v string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return f
}
