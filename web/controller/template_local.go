package controller

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/web/entity"
	"github.com/konstpic/sharx-code/v2/web/service"

	"github.com/gin-gonic/gin"
)

// registerLocalTemplateRoutes adds local (panel-only) template routes under /setting/templates/local.
func (a *SettingController) registerLocalTemplateRoutes(t *gin.RouterGroup) {
	l := t.Group("/local")
	l.POST("/list", a.localList)
	l.POST("/save", a.localSave)
	l.POST("/saveContent", a.localSaveContent)
	l.POST("/get", a.localGet)
	l.POST("/update", a.localUpdate)
	l.POST("/delete", a.localDelete)
	l.POST("/share", a.localShare)
}

func localFail(c *gin.Context, err error) {
	msg := err.Error()
	if errors.Is(err, service.ErrLocalTemplateNotFound) {
		msg = "Template not found"
	}
	c.JSON(http.StatusOK, entity.Msg{Success: false, Msg: msg})
}

type localMeta struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

func (a *SettingController) localList(c *gin.Context) {
	var q struct {
		Kind   string `json:"kind"`
		Q      string `json:"q"`
		Limit  int    `json:"limit"`
		Offset int    `json:"offset"`
	}
	_ = c.ShouldBindJSON(&q)
	items, total, err := a.localTemplates.List(q.Kind, q.Q, q.Limit, q.Offset)
	if err != nil {
		localFail(c, err)
		return
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: gin.H{"items": items, "total": total}})
}

// localSave stores a sanitized copy of an inbound or of the saved Xray template.
func (a *SettingController) localSave(c *gin.Context) {
	var req struct {
		hubSource
		localMeta
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		localFail(c, errors.New("invalid request"))
		return
	}
	doc, _, _, err := a.buildSharedContent(req.hubSource)
	if err != nil {
		localFail(c, err)
		return
	}
	raw, _ := json.Marshal(doc)
	v, err := a.localTemplates.Create(&service.LocalTemplateInput{Kind: req.Kind, Title: req.Title, Description: req.Description, Tags: req.Tags, Content: raw})
	if err != nil {
		localFail(c, err)
		return
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: v})
}

// localSaveContent stores content that came from the cloud gallery (already sanitized by its publisher and the hub).
func (a *SettingController) localSaveContent(c *gin.Context) {
	var req struct {
		Kind          string          `json:"kind"`
		SourceCloudID string          `json:"sourceCloudId"`
		Content       json.RawMessage `json:"content"`
		localMeta
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		localFail(c, errors.New("invalid request"))
		return
	}
	v, err := a.localTemplates.Create(&service.LocalTemplateInput{Kind: req.Kind, Title: req.Title, Description: req.Description,
		Tags: req.Tags, Content: req.Content, SourceCloudID: req.SourceCloudID})
	if err != nil {
		localFail(c, err)
		return
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: v})
}

func (a *SettingController) localGet(c *gin.Context) {
	var req struct {
		ID int `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		localFail(c, errors.New("invalid request"))
		return
	}
	meta, content, err := a.localTemplates.Get(req.ID)
	if err != nil {
		localFail(c, err)
		return
	}
	var obj any
	_ = json.Unmarshal(content, &obj)
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: gin.H{"meta": meta, "content": obj}})
}

func (a *SettingController) localUpdate(c *gin.Context) {
	var req struct {
		ID int `json:"id"`
		localMeta
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		localFail(c, errors.New("invalid request"))
		return
	}
	v, err := a.localTemplates.Update(req.ID, req.Title, req.Description, req.Tags)
	if err != nil {
		localFail(c, err)
		return
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: v})
}

func (a *SettingController) localDelete(c *gin.Context) {
	var req struct {
		ID int `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		localFail(c, errors.New("invalid request"))
		return
	}
	if err := a.localTemplates.Delete(req.ID); err != nil {
		localFail(c, err)
		return
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true})
}

// localShare publishes a stored local template to the cloud gallery.
func (a *SettingController) localShare(c *gin.Context) {
	var req struct {
		ID int `json:"id"`
		localMeta
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		localFail(c, errors.New("invalid request"))
		return
	}
	meta, content, err := a.localTemplates.Get(req.ID)
	if err != nil {
		localFail(c, err)
		return
	}
	title, desc, tags := req.Title, req.Description, req.Tags
	if title == "" {
		title, desc, tags = meta.Title, meta.Description, meta.Tags
	}
	xrayVer := ""
	if v := (&service.XrayService{}).GetXrayVersion(); v != "" && v != "Unknown" {
		xrayVer = v
	}
	r, err := a.templateHub.Do(http.MethodPost, "/v1/templates", nil, gin.H{
		"kind": meta.Kind, "title": title, "description": desc, "tags": tags,
		"panelVersion": config.GetVersion(), "xrayVersion": xrayVer, "content": content,
	})
	if err != nil {
		hubError(c, err)
		return
	}
	hubPass(c, r)
}
