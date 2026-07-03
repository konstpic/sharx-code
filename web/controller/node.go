// Package controller provides HTTP handlers for node management in multi-node mode.
package controller

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
	"github.com/konstpic/sharx-code/v2/web/websocket"

	"github.com/gin-gonic/gin"
)

// isNodeReregistrationError checks if the error indicates that node needs re-registration.
func isNodeReregistrationError(err error) bool {
	_, ok := err.(*service.ErrNodeNeedsReregistration)
	return ok
}

// NodeController handles HTTP requests related to node management.
type NodeController struct {
	nodeService service.NodeService
}

// NewNodeController creates a new NodeController and sets up its routes.
func NewNodeController(g *gin.RouterGroup) *NodeController {
	a := &NodeController{
		nodeService: service.NodeService{},
	}
	a.initRouter(g)
	return a
}

// initRouter initializes the routes for node-related operations.
func (a *NodeController) initRouter(g *gin.RouterGroup) {
	g.GET("/list", a.getNodes)
	g.GET("/get/:id", a.getNode)
	g.POST("/add", a.addNode)
	g.POST("/update/:id", a.updateNode)
	g.POST("/del/:id", a.deleteNode)
	g.POST("/check/:id", a.checkNode)
	g.POST("/checkAll", a.checkAllNodes)
	g.POST("/reload/:id", a.reloadNode)
	g.POST("/reloadAll", a.reloadAllNodes)
	g.GET("/status/:id", a.getNodeStatus)
	g.POST("/logs/:id", a.getNodeLogs)
	g.POST("/check-connection", a.checkNodeConnection) // Check node connection without API key
	g.POST("/resetTraffic/:id", a.resetNodeTraffic)    // Reset node traffic
	g.POST("/stopTelemt/:id", a.stopTelemtOnNode)
	g.POST("/stopAmneziaWg/:id", a.stopAmneziaWgOnNode)
	g.POST("/stopXray/:id", a.stopXrayOnNode)
	g.POST("/restartXray/:id", a.restartXrayOnNode)
	g.POST("/restartTelemt/:id", a.restartTelemtOnNode)
	g.POST("/restartAmneziaWg/:id", a.restartAmneziaWgOnNode)
	g.GET("/secret", a.getPairingSecret) // Panel-wide SECRET_KEY for node docker-compose
	g.GET("/geography", a.getNodesGeography)
	g.GET("/client-traffic-per-node", a.getClientTrafficPerNode)
	// push-logs endpoint moved to APIController to bypass session auth
}

// getClientTrafficPerNode returns live per-user per-node traffic (and a Local column in single-node mode).
func (a *NodeController) getClientTrafficPerNode(c *gin.Context) {
	user := session.GetLoginUser(c)
	if user == nil {
		jsonMsg(c, "Unauthorized", nil)
		return
	}
	out, err := a.nodeService.GetClientTrafficPerNodeMatrix(user.Id)
	if err != nil {
		jsonMsg(c, "Failed to load client traffic per node", err)
		return
	}
	jsonObj(c, out, nil)
}

// getPairingSecret returns the shared plain SECRET_KEY for node docker-compose (128 chars).
func (a *NodeController) getPairingSecret(c *gin.Context) {
	pairing := &service.PanelPairingService{}
	secret, err := pairing.GetSecretKey()
	if err != nil {
		jsonMsg(c, "Failed to load pairing secret", err)
		return
	}
	jsonObj(c, map[string]string{"secretKey": secret}, nil)
}

// getNodes retrieves the list of all nodes.
func (a *NodeController) getNodes(c *gin.Context) {
	nodes, err := a.nodeService.GetAllNodes()
	if err != nil {
		jsonMsg(c, "Failed to get nodes", err)
		return
	}

	// Enrich nodes with assigned inbounds and profiles information
	type NodeWithInbounds struct {
		*model.Node
		Inbounds    []*model.Inbound               `json:"inbounds,omitempty"`
		Profiles    []*model.XrayCoreConfigProfile `json:"profiles,omitempty"`
		XrayVersion string                         `json:"xrayVersion,omitempty"`
	}

	profileService := service.XrayCoreConfigProfileService{}
	result := make([]NodeWithInbounds, 0, len(nodes))
	for _, node := range nodes {
		inbounds, _ := a.nodeService.GetInboundsForNode(node.Id)
		profiles, _ := profileService.GetProfilesForNode(node.Id)
		result = append(result, NodeWithInbounds{
			Node:        node,
			Inbounds:    inbounds,
			Profiles:    profiles,
			XrayVersion: node.XrayVersion,
		})
	}

	jsonObj(c, result, nil)
}

// getNode retrieves a specific node by its ID.
func (a *NodeController) getNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	node, err := a.nodeService.GetNode(id)
	if err != nil {
		jsonMsg(c, "Failed to get node", err)
		return
	}
	jsonObj(c, node, nil)
}

// addNode creates a new node (pairing: JWT + mTLS; worker uses panel SECRET_KEY).
func (a *NodeController) addNode(c *gin.Context) {
	var body struct {
		model.Node
	}
	err := c.ShouldBind(&body)
	if err != nil {
		jsonMsg(c, "Invalid node data", err)
		return
	}
	node := &body.Node
	node.JwtPrivateKeyPem = ""
	node.PanelClientCertPem = ""
	node.PanelClientKeyPem = ""
	node.CaCertPem = ""
	node.AuthMode = ""
	node.Enable = true

	logger.Debugf("[Node: %s] Adding node: address=%s", node.Name, node.Address)

	secretKey, prepErr := a.nodeService.PrepareNodePairing(node)
	if prepErr != nil {
		jsonMsg(c, "Failed to prepare node pairing: "+prepErr.Error(), prepErr)
		return
	}

	if node.Status == "" {
		node.Status = "unknown"
	}

	err = a.nodeService.AddNode(node)
	if err != nil {
		jsonMsg(c, "Failed to add node to database", err)
		return
	}

	if err := a.nodeService.CheckNodeHealth(node); err != nil {
		_ = a.nodeService.DeleteNode(node.Id)
		jsonMsg(c, "Node health check failed ("+err.Error()+"). The node was not kept in the database.", err)
		return
	}

	a.broadcastNodesUpdate()

	settingService := service.SettingService{}
	multiMode, err := settingService.GetMultiNodeMode()
	if err == nil && multiMode {
		tgbotService := service.Tgbot{}
		if tgbotService.IsRunning() {
			msg := fmt.Sprintf("✅ <b>Node Registered Successfully</b>\n\n"+
				"<b>Name:</b> %s\n"+
				"<b>Address:</b> %s\n"+
				"<b>Status:</b> %s\n"+
				"<b>Time:</b> %s",
				node.Name,
				node.Address,
				node.Status,
				time.Now().Format("2006-01-02 15:04:05"))
			tgbotService.SendMsgToTgbotAdmins(msg)
		}
	}

	logger.Infof("[Node: %s] Node added successfully", node.Name)
	resp := struct {
		*model.Node
		SecretKey string `json:"secretKey,omitempty"`
	}{Node: node, SecretKey: secretKey}
	jsonMsgObj(c, "Node added successfully", resp, nil)
}

// updateNode updates an existing node.
func (a *NodeController) updateNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	// Create node with only provided fields
	node := &model.Node{Id: id}
	var jsonEnable *bool

	// Try to parse as JSON first (for API calls)
	contentType := c.GetHeader("Content-Type")
	if contentType == "application/json" {
		var jsonData map[string]interface{}
		if err := c.ShouldBindJSON(&jsonData); err == nil {
			// Only set fields that are provided in JSON
			if nameVal, ok := jsonData["name"].(string); ok && nameVal != "" {
				node.Name = nameVal
			}
			if addressVal, ok := jsonData["address"].(string); ok && addressVal != "" {
				node.Address = addressVal
			}
			// TLS settings
			if useTlsVal, ok := jsonData["useTls"].(bool); ok {
				node.UseTLS = useTlsVal
			}
			if certPathVal, ok := jsonData["certPath"].(string); ok {
				node.CertPath = certPathVal
			}
			if keyPathVal, ok := jsonData["keyPath"].(string); ok {
				node.KeyPath = keyPathVal
			}
			if insecureTlsVal, ok := jsonData["insecureTls"].(bool); ok {
				node.InsecureTLS = insecureTlsVal
			}
			// Traffic limit
			if trafficLimitGBVal, ok := jsonData["trafficLimitGB"].(float64); ok {
				node.TrafficLimitGB = trafficLimitGBVal
			}
			if trafficResetDayVal, ok := jsonData["trafficResetDay"].(float64); ok {
				node.TrafficResetDay = int(trafficResetDayVal)
			}
			if enableVal, ok := jsonData["enable"].(bool); ok {
				jsonEnable = &enableVal
			}
		}
	} else {
		// Parse as form data (default for web UI)
		// Only extract fields that are actually provided
		if name := c.PostForm("name"); name != "" {
			node.Name = name
		}
		if address := c.PostForm("address"); address != "" {
			node.Address = address
		}
		// TLS settings
		node.UseTLS = c.PostForm("useTls") == "true" || c.PostForm("useTls") == "on"
		if certPath := c.PostForm("certPath"); certPath != "" {
			node.CertPath = certPath
		}
		if keyPath := c.PostForm("keyPath"); keyPath != "" {
			node.KeyPath = keyPath
		}
		node.InsecureTLS = c.PostForm("insecureTls") == "true" || c.PostForm("insecureTls") == "on"
		// Traffic limit
		if trafficLimitGBStr := c.PostForm("trafficLimitGB"); trafficLimitGBStr != "" {
			if trafficLimitGB, err := strconv.ParseFloat(trafficLimitGBStr, 64); err == nil {
				node.TrafficLimitGB = trafficLimitGB
			}
		}
		if enableStr := c.PostForm("enable"); enableStr != "" {
			v := enableStr == "true" || enableStr == "on"
			jsonEnable = &v
		}
	}

	err = a.nodeService.UpdateNode(node)
	if err != nil {
		jsonMsg(c, "Failed to update node", err)
		return
	}
	if jsonEnable != nil {
		if err := a.nodeService.SetNodeEnabled(id, *jsonEnable); err != nil {
			jsonMsg(c, "Failed to update node enabled state", err)
			return
		}
		if !*jsonEnable {
			go func(nodeID int) {
				n, err := a.nodeService.GetNode(nodeID)
				if err != nil || n == nil {
					return
				}
				// Telemt is not stopped by stop-xray on the worker; shut it down explicitly when the node is disabled in the panel.
				if terr := a.nodeService.StopTelemtOnNode(n); terr != nil {
					logger.Warningf("[Node: %s] stop Telemt on worker while disabling node: %v", n.Name, terr)
				}
				if aerr := a.nodeService.StopAmneziaWgOnNode(n); aerr != nil {
					logger.Warningf("[Node: %s] stop AmneziaWG on worker while disabling node: %v", n.Name, aerr)
				}
				if err := a.nodeService.StopXrayOnNode(n); err != nil {
					logger.Warningf("[Node: %s] stop Xray on worker: %v", n.Name, err)
					_ = a.nodeService.SetNodeXrayState(n.Id, model.NodeXrayError)
				} else {
					logger.Infof("[Node: %s] Xray stopped on worker (node disabled in panel)", n.Name)
				}
				time.Sleep(100 * time.Millisecond)
				a.broadcastNodesUpdate()
			}(id)
		} else {
			go func(nodeID int) {
				xs := service.XrayService{}
				xs.RestartXrayAsync(false)
				time.Sleep(3 * time.Second)
				n, err := a.nodeService.GetNode(nodeID)
				if err == nil && n != nil && n.Enable {
					_ = a.nodeService.RefreshNodeXrayStateFromWorker(n)
					_ = a.nodeService.RefreshNodeTelemtStateFromWorker(n)
					_ = a.nodeService.RefreshNodeAmneziaWgStateFromWorker(n)
				}
				a.broadcastNodesUpdate()
			}(id)
		}
	}

	// Broadcast nodes update via WebSocket
	a.broadcastNodesUpdate()

	out, gerr := a.nodeService.GetNode(id)
	if gerr != nil {
		jsonMsg(c, "Node updated but failed to reload", gerr)
		return
	}
	jsonMsgObj(c, "Node updated successfully", out, nil)
}

// stopTelemtOnNode stops Telemt sidecars on a worker (Xray keeps running).
func (a *NodeController) stopTelemtOnNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	n, err := a.nodeService.GetNode(id)
	if err != nil || n == nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	if !n.Enable {
		jsonMsg(c, "Node is disabled", nil)
		return
	}
	if err := a.nodeService.StopTelemtOnNode(n); err != nil {
		jsonMsg(c, "Failed to stop Telemt on node", err)
		return
	}
	a.broadcastNodesUpdate()
	jsonMsg(c, "Telemt stopped on node", nil)
}

// stopXrayOnNode stops the Xray core on a worker only; Telemt is left running unless stopped via stopTelemt.
func (a *NodeController) stopXrayOnNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	n, err := a.nodeService.GetNode(id)
	if err != nil || n == nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	if !n.Enable {
		jsonMsg(c, "Node is disabled", nil)
		return
	}
	if err := a.nodeService.StopXrayOnNode(n); err != nil {
		jsonMsg(c, "Failed to stop Xray on node", err)
		return
	}
	a.broadcastNodesUpdate()
	jsonMsg(c, "Xray stopped on node", nil)
}

// restartXrayOnNode force-reloads Xray on a worker.
func (a *NodeController) restartXrayOnNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	n, err := a.nodeService.GetNode(id)
	if err != nil || n == nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	if !n.Enable {
		jsonMsg(c, "Node is disabled", nil)
		return
	}
	if err := a.nodeService.RestartXrayOnNode(n); err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Failed to restart Xray on node", err)
		}
		return
	}
	a.broadcastNodesUpdate()
	jsonMsg(c, "Xray restarted on node", nil)
}

// restartTelemtOnNode restarts Telemt sidecars on a worker.
func (a *NodeController) restartTelemtOnNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	n, err := a.nodeService.GetNode(id)
	if err != nil || n == nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	if !n.Enable {
		jsonMsg(c, "Node is disabled", nil)
		return
	}
	if err := a.nodeService.RestartTelemtOnNode(n); err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Failed to restart Telemt on node", err)
		}
		return
	}
	a.broadcastNodesUpdate()
	jsonMsg(c, "Telemt restarted on node", nil)
}

// stopAmneziaWgOnNode stops AmneziaWG sidecars on a worker (Xray keeps running).
func (a *NodeController) stopAmneziaWgOnNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	n, err := a.nodeService.GetNode(id)
	if err != nil || n == nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	if !n.Enable {
		jsonMsg(c, "Node is disabled", nil)
		return
	}
	if err := a.nodeService.StopAmneziaWgOnNode(n); err != nil {
		jsonMsg(c, "Failed to stop AmneziaWG on node", err)
		return
	}
	a.broadcastNodesUpdate()
	jsonMsg(c, "AmneziaWG stopped on node", nil)
}

// restartAmneziaWgOnNode restarts AmneziaWG sidecars on a worker.
func (a *NodeController) restartAmneziaWgOnNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}
	n, err := a.nodeService.GetNode(id)
	if err != nil || n == nil {
		jsonMsg(c, "Node not found", err)
		return
	}
	if !n.Enable {
		jsonMsg(c, "Node is disabled", nil)
		return
	}
	if err := a.nodeService.RestartAmneziaWgOnNode(n); err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Failed to restart AmneziaWG on node", err)
		}
		return
	}
	a.broadcastNodesUpdate()
	jsonMsg(c, "AmneziaWG restarted on node", nil)
}

// deleteNode deletes a node by its ID.
func (a *NodeController) deleteNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	n, _ := a.nodeService.GetNode(id)
	err = a.nodeService.DeleteNode(id)
	if err != nil {
		jsonMsg(c, "Failed to delete node", err)
		return
	}

	if n != nil {
		tgbot := service.Tgbot{}
		if tgbot.IsRunning() {
			detail := fmt.Sprintf("<b>Name:</b> %s\n<b>Address:</b> %s\n<b>ID:</b> %d\n", n.Name, n.Address, n.Id)
			tgbot.NotifyPanelAction("Node removed in panel", detail, getRemoteIp(c))
		}
	}

	// Broadcast nodes update via WebSocket
	a.broadcastNodesUpdate()

	jsonMsg(c, "Node deleted successfully", nil)
}

// checkNode checks the health of a specific node.
func (a *NodeController) checkNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	node, err := a.nodeService.GetNode(id)
	if err != nil {
		jsonMsg(c, "Failed to get node", err)
		return
	}

	err = a.nodeService.CheckNodeHealth(node)
	if err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Node health check failed", err)
		}
		return
	}

	// Broadcast nodes update via WebSocket (to update status and response time)
	a.broadcastNodesUpdate()

	jsonMsgObj(c, "Node health check completed", node, nil)
}

// checkAllNodes checks the health of all nodes.
func (a *NodeController) checkAllNodes(c *gin.Context) {
	a.nodeService.CheckAllNodesHealth()
	// Broadcast nodes update after health check (with delay to allow all checks to complete)
	go func() {
		time.Sleep(3 * time.Second) // Wait for health checks to complete
		a.broadcastNodesUpdate()
	}()
	jsonMsg(c, "Health check initiated for all nodes", nil)
}

// getNodeStatus retrieves the detailed status of a node.
func (a *NodeController) getNodeStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	node, err := a.nodeService.GetNode(id)
	if err != nil {
		jsonMsg(c, "Failed to get node", err)
		return
	}

	status, err := a.nodeService.GetNodeStatus(node)
	if err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Failed to get node status", err)
		}
		return
	}

	jsonObj(c, status, nil)
}

// reloadNode reloads XRAY on a specific node.
func (a *NodeController) reloadNode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	node, err := a.nodeService.GetNode(id)
	if err != nil {
		jsonMsg(c, "Failed to get node", err)
		return
	}

	// Use force reload to handle hung nodes
	err = a.nodeService.ForceReloadNode(node)
	if err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Failed to reload node", err)
		}
		return
	}

	jsonMsg(c, "Node reloaded successfully", nil)
}

// reloadAllNodes reloads XRAY on all nodes.
func (a *NodeController) reloadAllNodes(c *gin.Context) {
	err := a.nodeService.ReloadAllNodes()
	if err != nil {
		jsonMsg(c, "Failed to reload some nodes", err)
		return
	}

	jsonMsg(c, "All nodes reloaded successfully", nil)
}

// getNodeLogs retrieves XRAY logs from a specific node.
func (a *NodeController) getNodeLogs(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	node, err := a.nodeService.GetNode(id)
	if err != nil {
		jsonMsg(c, "Failed to get node", err)
		return
	}

	count := c.DefaultPostForm("count", "100")
	filter := c.PostForm("filter")
	showDirect := c.DefaultPostForm("showDirect", "true")
	showBlocked := c.DefaultPostForm("showBlocked", "true")
	showProxy := c.DefaultPostForm("showProxy", "true")

	countInt, _ := strconv.Atoi(count)

	// Get raw logs from node
	rawLogs, err := a.nodeService.GetNodeLogs(node, countInt, filter)
	if err != nil {
		if isNodeReregistrationError(err) {
			jsonMsg(c, "Node was recreated and needs to be re-registered. Please delete this node and add it again, or contact administrator to re-register it.", err)
		} else {
			jsonMsg(c, "Failed to get logs from node", err)
		}
		return
	}

	// Parse logs into LogEntry format (similar to ServerService.GetXrayLogs)
	type LogEntry struct {
		DateTime    time.Time `json:"DateTime"`
		FromAddress string    `json:"FromAddress"`
		ToAddress   string    `json:"ToAddress"`
		Inbound     string    `json:"Inbound"`
		Outbound    string    `json:"Outbound"`
		Email       string    `json:"Email"`
		Event       int       `json:"Event"`
	}

	const (
		Direct = iota
		Blocked
		Proxied
	)

	var freedoms []string
	var blackholes []string

	// Get tags for freedom and blackhole outbounds from default config
	settingService := service.SettingService{}
	config, err := settingService.GetDefaultXrayConfig()
	if err == nil && config != nil {
		if cfgMap, ok := config.(map[string]any); ok {
			if outbounds, ok := cfgMap["outbounds"].([]any); ok {
				for _, outbound := range outbounds {
					if obMap, ok := outbound.(map[string]any); ok {
						switch obMap["protocol"] {
						case "freedom":
							if tag, ok := obMap["tag"].(string); ok {
								freedoms = append(freedoms, tag)
							}
						case "blackhole":
							if tag, ok := obMap["tag"].(string); ok {
								blackholes = append(blackholes, tag)
							}
						}
					}
				}
			}
		}
	}

	if len(freedoms) == 0 {
		freedoms = []string{"direct"}
	}
	if len(blackholes) == 0 {
		blackholes = []string{"blocked"}
	}

	var entries []LogEntry
	for _, line := range rawLogs {
		var entry LogEntry
		parts := strings.Fields(line)

		for i, part := range parts {
			if i == 0 && len(parts) > 1 {
				dateTime, err := time.ParseInLocation("2006/01/02 15:04:05.999999", parts[0]+" "+parts[1], time.Local)
				if err == nil {
					entry.DateTime = dateTime.UTC()
				}
			}

			if part == "from" && i+1 < len(parts) {
				entry.FromAddress = strings.TrimLeft(parts[i+1], "/")
			} else if part == "accepted" && i+1 < len(parts) {
				entry.ToAddress = strings.TrimLeft(parts[i+1], "/")
			} else if strings.HasPrefix(part, "[") {
				entry.Inbound = part[1:]
			} else if strings.HasSuffix(part, "]") {
				entry.Outbound = part[:len(part)-1]
			} else if part == "email:" && i+1 < len(parts) {
				entry.Email = parts[i+1]
			}
		}

		// Determine event type
		logEntryContains := func(line string, suffixes []string) bool {
			for _, sfx := range suffixes {
				if strings.Contains(line, sfx+"]") {
					return true
				}
			}
			return false
		}

		if logEntryContains(line, freedoms) {
			if showDirect == "false" {
				continue
			}
			entry.Event = Direct
		} else if logEntryContains(line, blackholes) {
			if showBlocked == "false" {
				continue
			}
			entry.Event = Blocked
		} else {
			if showProxy == "false" {
				continue
			}
			entry.Event = Proxied
		}

		entries = append(entries, entry)
	}

	jsonObj(c, entries, nil)
}

// checkNodeConnection checks if a node is reachable (health check without API key).
// This is used during node registration to verify connectivity before registration.
func (a *NodeController) checkNodeConnection(c *gin.Context) {
	type CheckConnectionRequest struct {
		Address string `json:"address" form:"address" binding:"required"`
	}

	var req CheckConnectionRequest
	// HttpUtil.post sends data as form-urlencoded (see axios-init.js)
	// So we use ShouldBind which handles both form and JSON
	if err := c.ShouldBind(&req); err != nil {
		jsonMsg(c, "Invalid request: "+err.Error(), err)
		return
	}

	if req.Address == "" {
		jsonMsg(c, "Address is required", nil)
		return
	}

	// Temporary node for probe: assume SECRET_KEY pairing (mTLS + HTTPS), same as registration.
	tempNode := &model.Node{
		Address:  req.Address,
		AuthMode: "pairing",
		UseTLS:   true,
	}

	// Check node health (this only uses /health endpoint, no API key required)
	status, responseTime, err := a.nodeService.CheckNodeStatus(tempNode)
	if err != nil {
		jsonMsg(c, "Node is not reachable: "+err.Error(), err)
		return
	}

	if status != "online" {
		jsonMsg(c, "Node is not online (status: "+status+")", nil)
		return
	}

	// Return response time along with success message
	jsonMsgObj(c, fmt.Sprintf("Node is reachable (response time: %d ms)", responseTime), map[string]interface{}{
		"responseTime": responseTime,
	}, nil)
}

// getNodesGeography returns panel and node coordinates for the world map (multi-node UI).
func (a *NodeController) getNodesGeography(c *gin.Context) {
	type nodeGeoRow struct {
		Id           int      `json:"id"`
		Name         string   `json:"name"`
		Status       string   `json:"status"`
		GeoLat       *float64 `json:"geoLat,omitempty"`
		GeoLng       *float64 `json:"geoLng,omitempty"`
		GeoUpdatedAt int64    `json:"geoUpdatedAt"`
		GeoSource    string   `json:"geoSource,omitempty"`
	}
	settingSvc := service.SettingService{}
	panelGeo, err := settingSvc.GetPanelGeography()
	if err != nil {
		jsonMsg(c, "Failed to load panel geography", err)
		return
	}
	nodes, err := a.nodeService.GetAllNodes()
	if err != nil {
		jsonMsg(c, "Failed to get nodes", err)
		return
	}
	rows := make([]nodeGeoRow, 0, len(nodes))
	for _, n := range nodes {
		rows = append(rows, nodeGeoRow{
			Id:           n.Id,
			Name:         n.Name,
			Status:       n.Status,
			GeoLat:       n.GeoLat,
			GeoLng:       n.GeoLng,
			GeoUpdatedAt: n.GeoUpdatedAt,
			GeoSource:    n.GeoSource,
		})
	}
	jsonObj(c, gin.H{
		"panel": panelGeo,
		"nodes": rows,
	}, nil)
}

// broadcastNodesUpdate broadcasts the current nodes list to all WebSocket clients
func (a *NodeController) broadcastNodesUpdate() {
	// Get all nodes with their inbounds and profiles
	nodes, err := a.nodeService.GetAllNodes()
	if err != nil {
		logger.Warningf("Failed to get nodes for WebSocket broadcast: %v", err)
		return
	}

	// Enrich nodes with assigned inbounds and profiles information
	type NodeWithInbounds struct {
		*model.Node
		Inbounds    []*model.Inbound               `json:"inbounds,omitempty"`
		Profiles    []*model.XrayCoreConfigProfile `json:"profiles,omitempty"`
		XrayVersion string                         `json:"xrayVersion,omitempty"`
	}

	profileService := service.XrayCoreConfigProfileService{}
	result := make([]NodeWithInbounds, 0, len(nodes))
	for _, node := range nodes {
		inbounds, _ := a.nodeService.GetInboundsForNode(node.Id)
		profiles, _ := profileService.GetProfilesForNode(node.Id)
		result = append(result, NodeWithInbounds{
			Node:        node,
			Inbounds:    inbounds,
			Profiles:    profiles,
			XrayVersion: node.XrayVersion,
		})
	}

	// Broadcast via WebSocket
	websocket.BroadcastNodes(result)
}

// resetNodeTraffic resets traffic statistics for a specific node.
func (a *NodeController) resetNodeTraffic(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid node ID", err)
		return
	}

	err = a.nodeService.ResetNodeTraffic(id)
	if err != nil {
		jsonMsg(c, "Failed to reset node traffic", err)
		return
	}

	// Broadcast nodes update via WebSocket
	a.broadcastNodesUpdate()

	jsonMsg(c, "Node traffic reset successfully", nil)
}
