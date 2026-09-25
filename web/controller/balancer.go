package controller

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// BalancerController exposes balancer management under /panel/balancer.
type BalancerController struct {
	svc service.BalancerService
}

// NewBalancerController registers the routes.
func NewBalancerController(g *gin.RouterGroup) *BalancerController {
	a := &BalancerController{}
	g.GET("/list", a.list)
	g.POST("/add", a.add)
	g.POST("/update/:id", a.update)
	g.POST("/del/:id", a.del)
	g.POST("/enable/:id", a.enable)
	g.POST("/reorder", a.reorder)
	g.POST("/pool/save", a.savePool)
	g.POST("/pool/del/:id", a.delPool)
	g.POST("/apply/:id", a.apply)
	g.POST("/refresh/:id", a.refresh)
	g.GET("/metrics/:id", a.metrics)
	return a
}

type balancerView struct {
	*model.Balancer
	Live *service.AgentStatus `json:"live,omitempty"`
}

func (a *BalancerController) view(b *model.Balancer) balancerView {
	return balancerView{Balancer: b, Live: a.svc.LiveStatus(b.Id)}
}

func balancerID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		jsonMsg(c, "Invalid id", errors.New("invalid id"))
		return 0, false
	}
	return id, true
}

func (a *BalancerController) list(c *gin.Context) {
	list, err := a.svc.List()
	if err != nil {
		jsonMsg(c, "Failed to load balancers", err)
		return
	}
	out := make([]balancerView, 0, len(list))
	for _, b := range list {
		out = append(out, a.view(b))
	}
	jsonObj(c, out, nil)
}

func (a *BalancerController) add(c *gin.Context) {
	var b model.Balancer
	if err := c.ShouldBindJSON(&b); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	if err := a.svc.Add(&b); err != nil {
		jsonMsg(c, "Failed to add balancer", err)
		return
	}
	jsonObj(c, a.view(&b), nil)
}

func (a *BalancerController) update(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	var b model.Balancer
	if err := c.ShouldBindJSON(&b); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	b.Id = id
	if err := a.svc.Update(&b); err != nil {
		jsonMsg(c, "Failed to update balancer", err)
		return
	}
	go func() { _ = a.svc.Apply(id) }()
	jsonMsg(c, "Balancer updated", nil)
}

func (a *BalancerController) del(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	if err := a.svc.Delete(id); err != nil {
		jsonMsg(c, "Failed to delete balancer", err)
		return
	}
	jsonMsg(c, "Balancer deleted", nil)
}

func (a *BalancerController) enable(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	var body struct {
		Enable bool `json:"enable"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	if err := a.svc.SetEnabled(id, body.Enable); err != nil {
		jsonMsg(c, "Failed to update balancer", err)
		return
	}
	jsonMsg(c, "Balancer updated", nil)
}

func (a *BalancerController) reorder(c *gin.Context) {
	var form reorderForm
	if err := c.ShouldBindJSON(&form); err != nil || len(form.IDs) == 0 {
		jsonMsg(c, "Failed to reorder balancers", errors.New("ids are required"))
		return
	}
	if err := a.svc.Reorder(form.IDs); err != nil {
		jsonMsg(c, "Failed to reorder balancers", err)
		return
	}
	jsonMsg(c, "Balancers reordered", nil)
}

type savePoolBody struct {
	model.BalancerPool
	Members []model.BalancerPoolMember `json:"members"`
}

func (a *BalancerController) savePool(c *gin.Context) {
	var body savePoolBody
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, "Invalid request", err)
		return
	}
	pool, err := a.svc.SavePool(&body.BalancerPool, body.Members)
	if err != nil {
		jsonMsg(c, "Failed to save pool", err)
		return
	}
	jsonObj(c, pool, nil)
}

func (a *BalancerController) delPool(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	if err := a.svc.DeletePool(id); err != nil {
		jsonMsg(c, "Failed to delete pool", err)
		return
	}
	jsonMsg(c, "Pool deleted", nil)
}

func (a *BalancerController) apply(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	if err := a.svc.Apply(id); err != nil {
		jsonMsg(c, "Failed to apply configuration", err)
		return
	}
	b, err := a.svc.Get(id)
	if err != nil {
		jsonMsg(c, "Failed to load balancer", err)
		return
	}
	jsonObj(c, a.view(b), nil)
}

func (a *BalancerController) metrics(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(c.Query("since"), 10, 64)
	raw, err := a.svc.Metrics(id, since)
	if err != nil {
		jsonMsg(c, "Failed to load traffic", err)
		return
	}
	c.JSON(200, gin.H{"success": true, "msg": "", "obj": json.RawMessage(raw)})
}

func (a *BalancerController) refresh(c *gin.Context) {
	id, ok := balancerID(c)
	if !ok {
		return
	}
	_, refreshErr := a.svc.Refresh(id)
	b, err := a.svc.Get(id)
	if err != nil {
		jsonMsg(c, "Failed to load balancer", err)
		return
	}
	v := a.view(b)
	if refreshErr != nil {
		c.JSON(200, gin.H{"success": true, "msg": refreshErr.Error(), "obj": v})
		return
	}
	jsonObj(c, v, nil)
}
