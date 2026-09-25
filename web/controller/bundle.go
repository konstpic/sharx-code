package controller

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
)

// BundleController exposes bundles and bundle-scheme hosts under /panel/bundle.
type BundleController struct {
	svc     service.BundleService
	clients service.ClientService
	// convert and rollback are provided by main (the conversion needs the subscription assembler, which lives in package sub).
}

var (
	bundleConvertHook  func() (any, error)
	bundleRollbackHook func() error
)

// SetBundleConversionHooks wires the conversion and rollback implementations.
func SetBundleConversionHooks(convert func() (any, error), rollback func() error) {
	bundleConvertHook, bundleRollbackHook = convert, rollback
}

// NewBundleController registers the routes.
func NewBundleController(g *gin.RouterGroup) *BundleController {
	a := &BundleController{}
	g.GET("/list", a.list)
	g.GET("/get/:id", a.get)
	g.POST("/add", a.add)
	g.POST("/update/:id", a.update)
	g.POST("/del/:id", a.del)
	g.POST("/members/add", a.addMembers)
	g.POST("/members/remove", a.removeMembers)
	g.GET("/members/:id", a.members)
	g.POST("/client/:id/set", a.setClientBundles)
	g.GET("/client/:id", a.clientBundles)
	g.GET("/hosts", a.hosts)
	g.POST("/hosts/add", a.addHost)
	g.POST("/hosts/update/:id", a.updateHost)
	g.POST("/hosts/del/:id", a.delHost)
	g.POST("/hosts/reset/:id", a.resetHost)
	g.GET("/state", a.state)
	g.POST("/convert", a.convert)
	g.POST("/rollback", a.rollback)
	return a
}

func idParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		jsonMsg(c, "Invalid id", errors.New("invalid id"))
		return 0, false
	}
	return id, true
}

// push applies access changes to running cores and nodes in the background.
func (a *BundleController) push(diffs []service.AccessDiff) {
	if len(diffs) == 0 {
		return
	}
	go func() {
		for _, d := range diffs {
			changed := append(append([]int(nil), d.Added...), d.Removed...)
			a.clients.PushClientAccessChange(d.ClientId, changed)
		}
	}()
}

func (a *BundleController) list(c *gin.Context) {
	list, err := a.svc.List()
	if err != nil {
		jsonMsg(c, "Failed to load bundles", err)
		return
	}
	jsonObj(c, list, nil)
}

func (a *BundleController) get(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	b, err := a.svc.Get(id)
	if err != nil {
		jsonMsg(c, "Bundle not found", err)
		return
	}
	jsonObj(c, b, nil)
}

type bundleBody struct {
	model.Bundle
	HostRefs *[]service.BundleHostRef `json:"hostRefs"`
}

func (a *BundleController) add(c *gin.Context) {
	var body bundleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	var refs []service.BundleHostRef
	if body.HostRefs != nil {
		refs = *body.HostRefs
	}
	b, err := a.svc.Create(session.GetLoginUser(c).Id, &body.Bundle, refs)
	if err != nil {
		jsonMsg(c, "Failed to create bundle", err)
		return
	}
	jsonObj(c, b, nil)
}

func (a *BundleController) update(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var body bundleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	body.Bundle.Id = id
	diffs, err := a.svc.Update(&body.Bundle, body.HostRefs)
	if err != nil {
		jsonMsg(c, "Failed to update bundle", err)
		return
	}
	a.push(diffs)
	jsonObj(c, gin.H{"changedClients": len(diffs)}, nil)
}

func (a *BundleController) del(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	diffs, err := a.svc.Delete(id)
	if err != nil {
		jsonMsg(c, "Failed to delete bundle", err)
		return
	}
	a.push(diffs)
	jsonObj(c, gin.H{"changedClients": len(diffs)}, nil)
}

type membersBody struct {
	BundleId  int   `json:"bundleId"`
	ClientIds []int `json:"clientIds"`
}

func (a *BundleController) addMembers(c *gin.Context) {
	var b membersBody
	if err := c.ShouldBindJSON(&b); err != nil || b.BundleId <= 0 {
		jsonMsg(c, "Invalid request", errors.New("bundleId and clientIds are required"))
		return
	}
	diffs, err := a.svc.AddClients(b.BundleId, b.ClientIds)
	if err != nil {
		jsonMsg(c, "Failed to add clients", err)
		return
	}
	a.push(diffs)
	jsonObj(c, gin.H{"changedClients": len(diffs)}, nil)
}

func (a *BundleController) removeMembers(c *gin.Context) {
	var b membersBody
	if err := c.ShouldBindJSON(&b); err != nil || b.BundleId <= 0 {
		jsonMsg(c, "Invalid request", errors.New("bundleId and clientIds are required"))
		return
	}
	diffs, err := a.svc.RemoveClients(b.BundleId, b.ClientIds)
	if err != nil {
		jsonMsg(c, "Failed to remove clients", err)
		return
	}
	a.push(diffs)
	jsonObj(c, gin.H{"changedClients": len(diffs)}, nil)
}

func (a *BundleController) members(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	type row struct {
		Id     int    `json:"id"`
		Name   string `json:"name"`
		SubId  string `json:"subId"`
		Enable bool   `json:"enable"`
	}
	var rows []row
	err := database.GetDB().Raw(`SELECT c.id AS id, c.name AS name, c.sub_id AS sub_id, c.enable AS enable
		FROM client_bundles cb JOIN client_entities c ON c.id = cb.client_id WHERE cb.bundle_id = ? ORDER BY c.name`, id).Scan(&rows).Error
	if err != nil {
		jsonMsg(c, "Failed to load members", err)
		return
	}
	jsonObj(c, rows, nil)
}

func (a *BundleController) setClientBundles(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var body struct {
		BundleIds []int `json:"bundleIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	d, err := a.svc.SetClientBundles(id, body.BundleIds)
	if err != nil {
		jsonMsg(c, "Failed to set bundles", err)
		return
	}
	a.push([]service.AccessDiff{d})
	jsonObj(c, gin.H{"inboundIds": d.Order}, nil)
}

func (a *BundleController) clientBundles(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var ids []int
	if err := database.GetDB().Model(&model.ClientBundle{}).Where("client_id = ?", id).Order("sort_order ASC, id ASC").Pluck("bundle_id", &ids).Error; err != nil {
		jsonMsg(c, "Failed to load bundles", err)
		return
	}
	jsonObj(c, ids, nil)
}

func (a *BundleController) hosts(c *gin.Context) {
	list, err := a.svc.ListBundleHosts()
	if err != nil {
		jsonMsg(c, "Failed to load hosts", err)
		return
	}
	jsonObj(c, list, nil)
}

func (a *BundleController) addHost(c *gin.Context) {
	var body struct {
		service.HostInput
		InboundId int `json:"inboundId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	h, err := a.svc.CreateAddressHost(session.GetLoginUser(c).Id, body.InboundId, body.HostInput)
	if err != nil {
		jsonMsg(c, "Failed to create host", err)
		return
	}
	jsonObj(c, h, nil)
}

func (a *BundleController) updateHost(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var in service.HostInput
	if err := c.ShouldBindJSON(&in); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	h, err := a.svc.UpdateBundleHost(id, in)
	if err != nil {
		jsonMsg(c, "Failed to update host", err)
		return
	}
	jsonObj(c, h, nil)
}

func (a *BundleController) delHost(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if err := a.svc.DeleteBundleHost(id); err != nil {
		jsonMsg(c, "Failed to delete host", err)
		return
	}
	jsonMsg(c, "Host deleted", nil)
}

func (a *BundleController) resetHost(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if err := a.svc.ResetBundleHost(id); err != nil {
		jsonMsg(c, "Failed to reset host", err)
		return
	}
	jsonMsg(c, "Host reset", nil)
}

// state reports whether the bundle scheme is active and the outcome of the last conversion.
func (a *BundleController) state(c *gin.Context) {
	ss := service.SettingService{}
	on, _ := ss.GetBundlesEnabled()
	raw, _ := ss.GetBundlesMigration()
	var report any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &report)
	}
	jsonObj(c, gin.H{"enabled": on, "report": report}, nil)
}

func (a *BundleController) convert(c *gin.Context) {
	if bundleConvertHook == nil {
		jsonMsg(c, "Conversion is not available", errors.New("not wired"))
		return
	}
	rep, err := bundleConvertHook()
	if err != nil {
		c.JSON(200, gin.H{"success": false, "msg": err.Error(), "obj": rep})
		return
	}
	jsonObj(c, rep, nil)
}

func (a *BundleController) rollback(c *gin.Context) {
	if bundleRollbackHook == nil {
		jsonMsg(c, "Rollback is not available", errors.New("not wired"))
		return
	}
	if err := bundleRollbackHook(); err != nil {
		jsonMsg(c, "Rollback failed", err)
		return
	}
	jsonMsg(c, "Switched back to the previous scheme", nil)
}
