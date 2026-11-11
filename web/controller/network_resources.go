package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/web/session"
)

func networkOperatorID(c *gin.Context) int {
	if user := session.GetLoginUser(c); user != nil {
		return user.Id
	}
	return 0
}

func (a *NetworkController) resources(c *gin.Context) {
	resources, err := a.service.Sessions("consumer")
	if err != nil {
		jsonMsg(c, "Failed to load rented resources", err)
		return
	}
	jsonObj(c, gin.H{"resources": resources}, nil)
}

type networkBundleForm struct {
	Name       string   `json:"name" form:"name"`
	SessionIDs []string `json:"sessionIds" form:"sessionIds"`
}

func (a *NetworkController) createBundle(c *gin.Context) {
	var form networkBundleForm
	if err := c.ShouldBind(&form); err != nil {
		jsonMsg(c, "Invalid bundle form", err)
		return
	}
	bundle, err := a.service.CreateBundle(networkOperatorID(c), form.Name, form.SessionIDs)
	if err != nil {
		pureJsonMsg(c, http.StatusOK, false, err.Error())
		return
	}
	a.auditNetwork(c, "network.bundle.create", strconv.Itoa(bundle.Id))
	jsonObj(c, gin.H{"bundle": bundle}, nil)
}

type networkBundleAssignForm struct {
	BundleID  int   `json:"bundleId" form:"bundleId"`
	ClientIDs []int `json:"clientIds" form:"clientIds"`
}

func (a *NetworkController) assignBundle(c *gin.Context) {
	var form networkBundleAssignForm
	if err := c.ShouldBind(&form); err != nil {
		jsonMsg(c, "Invalid bundle assignment", err)
		return
	}
	if err := a.service.AssignBundle(networkOperatorID(c), form.BundleID, form.ClientIDs); err != nil {
		pureJsonMsg(c, http.StatusOK, false, err.Error())
		return
	}
	a.auditNetwork(c, "network.bundle.assign", strconv.Itoa(form.BundleID))
	jsonObj(c, gin.H{"ok": true}, nil)
}
