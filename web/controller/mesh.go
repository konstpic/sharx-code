package controller

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// Mesh routes inherit session/API-token authentication and RBAC from XUIController.
// The mode guard is separate: possessing a permission must not enable mesh in standalone mode.
func NewMeshController(g *gin.RouterGroup) {
	g.Use(func(c *gin.Context) {
		on, e := (&service.SettingService{}).GetMultiNodeMode()
		if e != nil || !on {
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"success": false, "msg": "Mesh доступен только в multi-node режиме"})
			return
		}
		u := dataUser(c)
		if u == nil || u.OrgId != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "msg": "Mesh относится к общей инфраструктуре панели"})
			return
		}
		c.Next()
	})
	g.GET("/status", func(c *gin.Context) {
		out, e := service.MeshAction(c.Request.Context(), "status", nil)
		jsonObj(c, out, e)
	})
	g.POST("/settings", func(c *gin.Context) {
		var settings service.MeshSettings
		if e := c.ShouldBindJSON(&settings); e != nil {
			jsonMsg(c, "Неверные настройки mesh", e)
			return
		}
		e := service.SaveMeshConfig(settings)
		jsonObj(c, settings, e)
	})
	g.POST("/ssh-hostkey", func(c *gin.Context) {
		var q struct {
			NodeID int `json:"nodeId"`
			Port   int `json:"port"`
		}
		if e := c.ShouldBindJSON(&q); e != nil {
			jsonMsg(c, "Неверный запрос", e)
			return
		}
		n, e := (&service.NodeService{}).GetNode(q.NodeID)
		if e != nil {
			jsonMsg(c, "Нода не найдена", e)
			return
		}
		host := service.MeshNodeHost(n.Address)
		fp, kt, e := service.ProbeSSHHostKey(host, q.Port)
		jsonObj(c, gin.H{"fingerprint": fp, "keyType": kt, "host": host}, e)
	})
	g.POST("/action/:action", func(c *gin.Context) {
		action := c.Param("action")
		allowed := map[string]bool{"enroll": true, "bootstrap": true, "remove": true, "etcd": true, "flags": true, "relay": true, "probe": true, "pin": true}
		if !allowed[action] {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		var body json.RawMessage
		if e := c.ShouldBindJSON(&body); e != nil {
			jsonMsg(c, "Неверный запрос mesh", e)
			return
		}
		out, e := service.MeshAction(c.Request.Context(), action, body)
		jsonObj(c, out, e)
	})
}
