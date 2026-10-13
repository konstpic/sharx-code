package controller

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/web/service"
)

func trafficHistoryParams(c *gin.Context) (int, int, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return 0, 0, fmt.Errorf("invalid ID")
	}
	minutes := 60
	if raw := c.Query("minutes"); raw != "" {
		minutes, err = strconv.Atoi(raw)
	}
	if err != nil || (minutes != 15 && minutes != 60 && minutes != 360 && minutes != 1440 && minutes != 10080 && minutes != 43200 && minutes != 129600) {
		return 0, 0, fmt.Errorf("invalid history range")
	}
	return id, minutes, nil
}
func trafficHistoryAbsolute(c *gin.Context) ([]service.TrafficHistoryRange, error) {
	from, to := c.Query("from"), c.Query("to")
	if from == "" && to == "" {
		return nil, nil
	}
	f, e1 := strconv.ParseInt(from, 10, 64)
	t, e2 := strconv.ParseInt(to, 10, 64)
	if e1 != nil || e2 != nil || f <= 0 || t <= f || t-f > 366*24*60*60*1000 {
		return nil, fmt.Errorf("invalid absolute history range")
	}
	return []service.TrafficHistoryRange{{From: f, To: t}}, nil
}

func (a *ClientController) getTrafficHistory(c *gin.Context) {
	id, minutes, err := trafficHistoryParams(c)
	if err != nil {
		jsonMsg(c, "Invalid traffic history request", err)
		return
	}
	absolute, err := trafficHistoryAbsolute(c)
	if err != nil {
		jsonMsg(c, "Invalid traffic history request", err)
		return
	}
	user := dataUser(c)
	client, err := a.clientService.GetClient(id)
	if err != nil || user == nil || client == nil || client.UserId != user.Id {
		jsonMsg(c, "Client not found or access denied", fmt.Errorf("access denied"))
		return
	}
	obj, err := service.GetTrafficHistory("client", id, minutes, absolute...)
	jsonObj(c, obj, err)
}
func (a *NodeController) getTrafficHistory(c *gin.Context) {
	id, minutes, err := trafficHistoryParams(c)
	if err != nil {
		jsonMsg(c, "Invalid traffic history request", err)
		return
	}
	absolute, err := trafficHistoryAbsolute(c)
	if err != nil {
		jsonMsg(c, "Invalid traffic history request", err)
		return
	}
	if _, err := a.nodeService.GetNode(id); err != nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	obj, err := service.GetTrafficHistory("node", id, minutes, absolute...)
	jsonObj(c, obj, err)
}
