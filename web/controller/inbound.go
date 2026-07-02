package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
	"github.com/konstpic/sharx-code/v2/web/websocket"
	"github.com/konstpic/sharx-code/v2/xray"

	"github.com/gin-gonic/gin"
)

// inboundBindBody is model.Inbound with optional `wireguard` form payload; settings JSON for wireguard is built server-side.
type inboundBindBody struct {
	model.Inbound
	Wireguard *service.WireGuardInboundRequest `json:"wireguard" form:"-"`
	Amneziawg *service.AmneziaWGInboundRequest  `json:"amneziawg" form:"-"`
}

func parseInboundNodeBindingsPayload(jsonData map[string]interface{}) ([]service.InboundNodeBindingInput, bool) {
	raw, ok := jsonData["nodeBindings"]
	if !ok || raw == nil {
		return nil, false
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	var out []service.InboundNodeBindingInput
	if err := json.Unmarshal(b, &out); err != nil || len(out) == 0 {
		return nil, false
	}
	return out, true
}

// applyWireGuardPanelForm sets Inbound.Settings from `wireguard` or defaults when the protocol is wireguard.
func applyWireGuardPanelForm(in *model.Inbound, wg *service.WireGuardInboundRequest) error {
	if model.NormalizeProtocol(in.Protocol) != model.WireGuard {
		return nil
	}
	if wg == nil {
		s := strings.TrimSpace(in.Settings)
		if s == "" || s == "{}" {
			built, err := service.BuildWireGuardInboundSettingsJSON(nil)
			if err != nil {
				return err
			}
			in.Settings = built
		}
		return nil
	}
	built, err := service.BuildWireGuardInboundSettingsJSON(wg)
	if err != nil {
		return err
	}
	in.Settings = built
	return nil
}

// applyAmneziaWGPanelForm sets Inbound.Settings from `amneziawg` or defaults when the protocol is amneziawg.
func applyAmneziaWGPanelForm(in *model.Inbound, awg *service.AmneziaWGInboundRequest) error {
	if model.NormalizeProtocol(in.Protocol) != model.AmneziaWG {
		return nil
	}
	if awg == nil {
		s := strings.TrimSpace(in.Settings)
		if s == "" || s == "{}" {
			built, err := service.BuildAmneziaWGInboundSettingsJSON(nil)
			if err != nil {
				return err
			}
			in.Settings = built
		}
		return nil
	}
	built, err := service.BuildAmneziaWGInboundSettingsJSON(awg)
	if err != nil {
		return err
	}
	in.Settings = built
	return nil
}

// applySidecarPanelForms applies wireguard / amneziawg form payloads when present.
func applySidecarPanelForms(in *model.Inbound, wg *service.WireGuardInboundRequest, awg *service.AmneziaWGInboundRequest) error {
	if err := applyWireGuardPanelForm(in, wg); err != nil {
		return err
	}
	if err := applyAmneziaWGPanelForm(in, awg); err != nil {
		return err
	}
	normalizeSidecarInboundFields(in)
	return nil
}

// normalizeSidecarInboundFields clears Xray-only transport fields for Telemt / AmneziaWG inbounds.
func normalizeSidecarInboundFields(in *model.Inbound) {
	if in == nil || !model.IsSidecarProtocol(in.Protocol) {
		return
	}
	in.StreamSettings = "{}"
	in.Sniffing = `{"enabled":false,"destOverride":[],"metadataOnly":false,"routeOnly":false}`
}

// InboundController handles HTTP requests related to Xray inbounds management.
type InboundController struct {
	inboundService service.InboundService
	xrayService    service.XrayService
}

// NewInboundController creates a new InboundController and sets up its routes.
func NewInboundController(g *gin.RouterGroup) *InboundController {
	a := &InboundController{}
	a.initRouter(g)
	return a
}

// syncWorkerAfterInboundMutation schedules multi-node pushes to workers hosting the mutated inbound only.
func (a *InboundController) syncWorkerAfterInboundMutation(needRestart bool, inboundId int, inboundProtocol model.Protocol) {
	if !needRestart || inboundId <= 0 {
		return
	}
	if model.IsSidecarProtocol(inboundProtocol) {
		a.xrayService.SyncWorkerSidecarsAsync()
		return
	}
	a.xrayService.SyncWorkerXrayForInboundsAsync([]int{inboundId})
}

// initRouter initializes the routes for inbound-related operations.
func (a *InboundController) initRouter(g *gin.RouterGroup) {
	// Add logging middleware for all inbound routes
	g.Use(func(c *gin.Context) {
		// #region agent log
		logger.Debugf("[DEBUG-AGENT] InboundController middleware: request, path=%s, method=%s", c.Request.URL.Path, c.Request.Method)
		// #endregion
		c.Next()
		// #region agent log
		logger.Debugf("[DEBUG-AGENT] InboundController middleware: response, path=%s, method=%s, status=%d", c.Request.URL.Path, c.Request.Method, c.Writer.Status())
		// #endregion
	})

	g.GET("/list", a.getInbounds)
	g.GET("/get/:id", a.getInbound)
	g.GET("/getClientTraffics/:email", a.getClientTraffics)
	g.GET("/getClientTrafficsById/:id", a.getClientTrafficsById)

	g.POST("/generateSelfSignedTls", a.generateSelfSignedTls)
	g.POST("/computeTlsPin", a.computeTlsPin)

	g.POST("/add", a.addInbound)
	g.POST("/del/:id", a.delInbound)
	g.POST("/update/:id", a.updateInbound)
	g.POST("/previewXray", a.previewInboundXray)
	g.POST("/previewTelemt", a.previewInboundTelemt)
	g.POST("/previewAmneziaWg", a.previewInboundAmneziaWg)
	g.POST("/clientIps/:email", a.getClientIps)
	g.POST("/clearClientIps/:email", a.clearClientIps)
	g.POST("/addClient", a.addInboundClient)
	g.POST("/:id/delClient/:clientId", a.delInboundClient)
	g.POST("/updateClient/:clientId", a.updateInboundClient)
	g.POST("/:id/resetClientTraffic/:email", a.resetClientTraffic)
	g.POST("/resetAllTraffics", a.resetAllTraffics)
	g.POST("/resetAllClientTraffics/:id", a.resetAllClientTraffics)
	g.POST("/delDepletedClients/:id", a.delDepletedClients)
	g.POST("/import", a.importInbound)
	g.POST("/onlines", a.onlines)
	g.POST("/lastOnline", a.lastOnline)
	g.POST("/updateClientTraffic/:email", a.updateClientTraffic)
	g.POST("/:id/delClientByEmail/:email", a.delInboundClientByEmail)
}

// previewInboundXray returns the Xray core inbound detour (listen, port, tag, settings, streamSettings, sniffing)
// as it would appear in the generated config — not the panel API request body.
func (a *InboundController) previewInboundXray(c *gin.Context) {
	var bindBody inboundBindBody
	if err := c.ShouldBind(&bindBody); err != nil {
		logger.Errorf("previewInboundXray bind: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	inbound := &bindBody.Inbound
	user := session.GetLoginUser(c)
	inbound.UserId = user.Id

	if err := applySidecarPanelForms(inbound, bindBody.Wireguard, bindBody.Amneziawg); err != nil {
		logger.Errorf("previewInboundXray wireguard: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	if inbound.Id > 0 {
		existing, err := a.inboundService.GetInbound(inbound.Id)
		if err != nil {
			jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
			return
		}
		if existing.UserId != user.Id {
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("access denied"))
			return
		}
		inbound.ClientStats = existing.ClientStats
	}

	settingService := service.SettingService{}
	multiMode, _ := settingService.GetMultiNodeMode()
	if _, err := a.inboundService.AssignInboundTag(inbound, multiMode); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	cfg, err := a.xrayService.PreviewInboundCoreConfig(inbound)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, cfg, nil)
}

// previewInboundTelemt returns the Telemt config.toml that would be written on the node or panel (standalone).
func (a *InboundController) previewInboundTelemt(c *gin.Context) {
	var bindBody inboundBindBody
	if err := c.ShouldBind(&bindBody); err != nil {
		logger.Errorf("previewInboundTelemt bind: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	inbound := &bindBody.Inbound
	user := session.GetLoginUser(c)
	inbound.UserId = user.Id

	if err := applySidecarPanelForms(inbound, bindBody.Wireguard, bindBody.Amneziawg); err != nil {
		logger.Errorf("previewInboundTelemt wireguard: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	if model.NormalizeProtocol(inbound.Protocol) != model.Telemt {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("not a telemt inbound"))
		return
	}

	if inbound.Id > 0 {
		existing, err := a.inboundService.GetInbound(inbound.Id)
		if err != nil {
			jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
			return
		}
		if existing.UserId != user.Id {
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("access denied"))
			return
		}
		inbound.ClientStats = existing.ClientStats
	}

	settingService := service.SettingService{}
	multiMode, _ := settingService.GetMultiNodeMode()
	if _, err := a.inboundService.AssignInboundTag(inbound, multiMode); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	tomlStr, err := service.PreviewTelemtToml(inbound)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, gin.H{"toml": tomlStr}, nil)
}

// previewInboundAmneziaWg returns the server .conf that would be applied on the node or panel (standalone).
func (a *InboundController) previewInboundAmneziaWg(c *gin.Context) {
	var bindBody inboundBindBody
	if err := c.ShouldBind(&bindBody); err != nil {
		logger.Errorf("previewInboundAmneziaWg bind: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	inbound := &bindBody.Inbound
	user := session.GetLoginUser(c)
	inbound.UserId = user.Id

	if err := applySidecarPanelForms(inbound, bindBody.Wireguard, bindBody.Amneziawg); err != nil {
		logger.Errorf("previewInboundAmneziaWg sidecar forms: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	if model.NormalizeProtocol(inbound.Protocol) != model.AmneziaWG {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("not an amneziawg inbound"))
		return
	}

	if inbound.Id > 0 {
		existing, err := a.inboundService.GetInbound(inbound.Id)
		if err != nil {
			jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
			return
		}
		if existing.UserId != user.Id {
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("access denied"))
			return
		}
		inbound.ClientStats = existing.ClientStats
	}

	settingService := service.SettingService{}
	multiMode, _ := settingService.GetMultiNodeMode()
	if _, err := a.inboundService.AssignInboundTag(inbound, multiMode); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	confStr, err := service.PreviewAmneziaWgConf(inbound)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, gin.H{"conf": confStr}, nil)
}

// generateSelfSignedTls returns a PEM certificate and key for development / Hysteria testing.
func (a *InboundController) generateSelfSignedTls(c *gin.Context) {
	var body struct {
		CommonName   string   `json:"commonName"`
		DNSNames     []string `json:"dnsNames"`
		IPAddresses  []string `json:"ipAddresses"`
		ValidityDays int      `json:"validityDays"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	out, err := service.GenerateSelfSignedServerTLS(service.SelfSignedTLSParams{
		CommonName:   body.CommonName,
		DNSNames:     body.DNSNames,
		IPAddresses:  body.IPAddresses,
		ValidityDays: body.ValidityDays,
	})
	if err != nil {
		logger.Errorf("generateSelfSignedTls: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.generateSelfSignedSuccess"), out, nil)
}

// computeTlsPin returns pinnedPeerCertSha256 for a PEM block or certificate file on the panel host.
func (a *InboundController) computeTlsPin(c *gin.Context) {
	var body struct {
		CertPEM         string `json:"certPem"`
		CertificateFile string `json:"certificateFile"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	pemData := strings.TrimSpace(body.CertPEM)
	certFile := strings.TrimSpace(body.CertificateFile)
	if pemData == "" && certFile == "" {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.tlsPinNeedSource"), fmt.Errorf("certPem or certificateFile required"))
		return
	}
	var pin string
	var err error
	if pemData != "" {
		pin, err = xray.LeafCertSHA256FromPEM(pemData)
	} else {
		pin, err = xray.LeafCertSHA256FromFile(certFile)
	}
	if err != nil {
		logger.Errorf("computeTlsPin: %v", err)
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.tlsPinFailed"), err)
		return
	}
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.tlsPinSuccess"), gin.H{
		"pinnedPeerCertSha256": pin,
	}, nil)
}

// getInbounds retrieves the list of inbounds for the logged-in user.
func (a *InboundController) getInbounds(c *gin.Context) {
	user := session.GetLoginUser(c)
	inbounds, err := a.inboundService.GetInbounds(user.Id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}
	jsonObj(c, inbounds, nil)
}

// getInbound retrieves a specific inbound by its ID.
func (a *InboundController) getInbound(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, I18nWeb(c, "get"), err)
		return
	}
	inbound, err := a.inboundService.GetInbound(id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}
	jsonObj(c, inbound, nil)
}

// getClientTraffics retrieves client traffic information by email.
func (a *InboundController) getClientTraffics(c *gin.Context) {
	email := c.Param("email")
	clientTraffics, err := a.inboundService.GetClientTrafficByEmail(email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.trafficGetError"), err)
		return
	}
	jsonObj(c, clientTraffics, nil)
}

// getClientTrafficsById retrieves client traffic information by inbound ID.
func (a *InboundController) getClientTrafficsById(c *gin.Context) {
	id := c.Param("id")
	clientTraffics, err := a.inboundService.GetClientTrafficByID(id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.trafficGetError"), err)
		return
	}
	jsonObj(c, clientTraffics, nil)
}

// addInbound creates a new inbound configuration.
func (a *InboundController) addInbound(c *gin.Context) {
	// #region agent log
	logger.Infof("[DEBUG-AGENT] addInbound controller: ENTRY, path=%s, method=%s", c.Request.URL.Path, c.Request.Method)
	// #endregion
	// Try to get nodeIds from JSON body first (if Content-Type is application/json)
	// This must be done BEFORE ShouldBind, which reads the body
	var nodeIdsFromJSON []int
	var nodeIdFromJSON *int
	var hasNodeIdsInJSON, hasNodeIdInJSON bool
	var nodeBindingsFromJSON []service.InboundNodeBindingInput
	var hasNodeBindingsInJSON bool

	if c.ContentType() == "application/json" {
		// Read raw body to extract nodeIds
		bodyBytes, err := c.GetRawData()
		if err == nil && len(bodyBytes) > 0 {
			// Parse JSON to extract nodeIds
			var jsonData map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &jsonData); err == nil {
				// Check for nodeIds array
				if nodeIdsVal, ok := jsonData["nodeIds"]; ok {
					hasNodeIdsInJSON = true
					if nodeIdsArray, ok := nodeIdsVal.([]interface{}); ok {
						for _, val := range nodeIdsArray {
							if num, ok := val.(float64); ok {
								nodeIdsFromJSON = append(nodeIdsFromJSON, int(num))
							} else if num, ok := val.(int); ok {
								nodeIdsFromJSON = append(nodeIdsFromJSON, num)
							}
						}
					} else if num, ok := nodeIdsVal.(float64); ok {
						// Single number instead of array
						nodeIdsFromJSON = append(nodeIdsFromJSON, int(num))
					} else if num, ok := nodeIdsVal.(int); ok {
						nodeIdsFromJSON = append(nodeIdsFromJSON, num)
					}
				}
				// Check for nodeId (backward compatibility)
				if nodeIdVal, ok := jsonData["nodeId"]; ok {
					hasNodeIdInJSON = true
					if num, ok := nodeIdVal.(float64); ok {
						nodeId := int(num)
						nodeIdFromJSON = &nodeId
					} else if num, ok := nodeIdVal.(int); ok {
						nodeIdFromJSON = &num
					}
				}
				if nb, ok := parseInboundNodeBindingsPayload(jsonData); ok {
					nodeBindingsFromJSON = nb
					hasNodeBindingsInJSON = true
				}
			}
			// Restore body for ShouldBind
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}
	}

	var bindBody inboundBindBody
	err := c.ShouldBind(&bindBody)
	if err != nil {
		logger.Errorf("Failed to bind inbound data: %v", err)
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundCreateSuccess"), err)
		return
	}
	inbound := &bindBody.Inbound
	if err = applySidecarPanelForms(inbound, bindBody.Wireguard, bindBody.Amneziawg); err != nil {
		logger.Errorf("wireguard settings: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	user := session.GetLoginUser(c)
	inbound.UserId = user.Id

	settingService := service.SettingService{}
	multiMode, _ := settingService.GetMultiNodeMode()

	nodeService := service.NodeService{}
	if multiMode {
		var preCheckNodeIds []int
		if hasNodeBindingsInJSON {
			for _, b := range nodeBindingsFromJSON {
				if b.NodeId > 0 {
					preCheckNodeIds = append(preCheckNodeIds, b.NodeId)
				}
			}
		} else if hasNodeIdsInJSON {
			preCheckNodeIds = append(preCheckNodeIds, nodeIdsFromJSON...)
		} else if hasNodeIdInJSON && nodeIdFromJSON != nil && *nodeIdFromJSON > 0 {
			preCheckNodeIds = append(preCheckNodeIds, *nodeIdFromJSON)
		} else {
			for _, idStr := range c.PostFormArray("nodeIds") {
				if id, err := strconv.Atoi(idStr); err == nil && id > 0 {
					preCheckNodeIds = append(preCheckNodeIds, id)
				}
			}
			if nodeIdStr := c.PostForm("nodeId"); nodeIdStr != "" && nodeIdStr != "null" {
				if parsedId, err := strconv.Atoi(nodeIdStr); err == nil && parsedId > 0 {
					preCheckNodeIds = append(preCheckNodeIds, parsedId)
				}
			}
		}
		if len(preCheckNodeIds) > 0 {
			if err := nodeService.CheckInboundPortConflictOnNodes(inbound.Port, inbound.Listen, string(inbound.Protocol), preCheckNodeIds, 0); err != nil {
				logger.Errorf("Inbound port conflict on nodes: %v", err)
				jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
				return
			}
		}
	}

	inbound, needRestart, err := a.inboundService.AddInbound(inbound)
	if err != nil {
		logger.Errorf("Failed to add inbound: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	// Handle node assignment in multi-node mode
	rollbackInboundOnAssignError := func(assignErr error) {
		if assignErr == nil || inbound == nil || inbound.Id <= 0 {
			return
		}
		if _, delErr := a.inboundService.DelInbound(inbound.Id); delErr != nil {
			logger.Warningf("Failed to roll back inbound %d after assignment error: %v", inbound.Id, delErr)
		}
	}

	// Get nodeIds from form (for form-encoded requests)
	nodeIdsStr := c.PostFormArray("nodeIds")
	logger.Debugf("Received nodeIds from form: %v", nodeIdsStr)

	// Check if nodeIds array was provided (even if empty)
	nodeIdStr := c.PostForm("nodeId")

	// Determine which source to use: JSON takes precedence over form data
	useJSON := hasNodeIdsInJSON || hasNodeIdInJSON || hasNodeBindingsInJSON
	useForm := (len(nodeIdsStr) > 0 || nodeIdStr != "") && !useJSON

	if hasNodeBindingsInJSON {
		if err := nodeService.AssignInboundToNodesWithBindings(inbound.Id, nodeBindingsFromJSON); err != nil {
			logger.Errorf("Failed to assign inbound %d with node bindings: %v", inbound.Id, err)
			rollbackInboundOnAssignError(err)
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
			return
		}
	} else if useJSON || useForm {
		var nodeIds []int
		var nodeId *int

		if useJSON {
			// Use data from JSON
			nodeIds = nodeIdsFromJSON
			nodeId = nodeIdFromJSON
		} else {
			// Parse nodeIds array from form
			for _, idStr := range nodeIdsStr {
				if idStr != "" {
					if id, err := strconv.Atoi(idStr); err == nil && id > 0 {
						nodeIds = append(nodeIds, id)
					}
				}
			}
			// Parse single nodeId from form
			if nodeIdStr != "" && nodeIdStr != "null" {
				if parsedId, err := strconv.Atoi(nodeIdStr); err == nil && parsedId > 0 {
					nodeId = &parsedId
				}
			}
		}

		if len(nodeIds) > 0 {
			// Assign to multiple nodes
			if err := nodeService.AssignInboundToNodes(inbound.Id, nodeIds); err != nil {
				logger.Errorf("Failed to assign inbound %d to nodes %v: %v", inbound.Id, nodeIds, err)
				rollbackInboundOnAssignError(err)
				jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
				return
			}
		} else if nodeId != nil && *nodeId > 0 {
			// Backward compatibility: single nodeId
			if err := nodeService.AssignInboundToNode(inbound.Id, *nodeId); err != nil {
				logger.Errorf("Failed to assign inbound %d to node %d: %v", inbound.Id, *nodeId, err)
				rollbackInboundOnAssignError(err)
				jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
				return
			}
		}
	}

	// #region agent log
	logger.Infof("[DEBUG-AGENT] addInbound controller: SUCCESS, inboundId=%d, needRestart=%v", inbound.Id, needRestart)
	// #endregion
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundCreateSuccess"), inbound, nil)
	a.syncWorkerAfterInboundMutation(needRestart, inbound.Id, inbound.Protocol)
	// Broadcast inbounds update via WebSocket
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
}

// delInbound deletes an inbound configuration by its ID.
func (a *InboundController) delInbound(c *gin.Context) {
	logger.Infof("[DEBUG-AGENT] delInbound controller: ENTRY, path=%s, method=%s", c.Request.URL.Path, c.Request.Method)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		logger.Infof("[DEBUG-AGENT] delInbound controller: invalid ID, param=%s, error=%v", c.Param("id"), err)
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundDeleteSuccess"), err)
		return
	}
	logger.Infof("[DEBUG-AGENT] delInbound controller: parsed ID=%d", id)
	logger.Infof("[DEBUG-AGENT] delInbound controller: calling DelInbound, id=%d", id)
	var delProto model.Protocol
	var delNodeIDs []int
	if oldIb, _ := a.inboundService.GetInbound(id); oldIb != nil {
		delProto = oldIb.Protocol
		nodeService := service.NodeService{}
		if nodes, nerr := nodeService.GetNodesForInbound(id); nerr == nil {
			for _, n := range nodes {
				if n != nil {
					delNodeIDs = append(delNodeIDs, n.Id)
				}
			}
		}
	}
	needRestart, err := a.inboundService.DelInbound(id)
	if err != nil {
		logger.Infof("[DEBUG-AGENT] delInbound controller: ERROR from DelInbound, id=%d, error=%v, errorType=%T", id, err, err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	logger.Infof("[DEBUG-AGENT] delInbound controller: SUCCESS, id=%d, needRestart=%v", id, needRestart)
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundDeleteSuccess"), id, nil)
	if needRestart {
		if model.IsSidecarProtocol(delProto) {
			a.xrayService.SyncWorkerSidecarsAsync()
		} else if len(delNodeIDs) > 0 {
			a.xrayService.ApplyWorkerConfigToNodeIDsAsync(delNodeIDs)
		} else {
			a.xrayService.RestartXrayAsync(false)
		}
	}
	// Broadcast inbounds update via WebSocket
	user := session.GetLoginUser(c)
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
}

// updateInbound updates an existing inbound configuration.
func (a *InboundController) updateInbound(c *gin.Context) {
	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInbound controller: ENTRY, path=%s, method=%s", c.Request.URL.Path, c.Request.Method)
	// #endregion
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		// #region agent log
		logger.Infof("[DEBUG-AGENT] updateInbound controller: invalid ID, param=%s, error=%v", c.Param("id"), err)
		// #endregion
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}
	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInbound controller: parsed ID=%d", id)
	// #endregion

	// Try to get nodeIds from JSON body first (if Content-Type is application/json)
	var nodeIdsFromJSON []int
	var nodeIdFromJSON *int
	var hasNodeIdsInJSON, hasNodeIdInJSON bool
	var nodeBindingsFromJSON []service.InboundNodeBindingInput
	var hasNodeBindingsInJSON bool

	if c.ContentType() == "application/json" {
		// Read raw body to extract nodeIds
		bodyBytes, err := c.GetRawData()
		if err == nil && len(bodyBytes) > 0 {
			// Parse JSON to extract nodeIds
			var jsonData map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &jsonData); err == nil {
				// Check for nodeIds array
				if nodeIdsVal, ok := jsonData["nodeIds"]; ok {
					hasNodeIdsInJSON = true
					if nodeIdsArray, ok := nodeIdsVal.([]interface{}); ok {
						for _, val := range nodeIdsArray {
							if num, ok := val.(float64); ok {
								nodeIdsFromJSON = append(nodeIdsFromJSON, int(num))
							} else if num, ok := val.(int); ok {
								nodeIdsFromJSON = append(nodeIdsFromJSON, num)
							}
						}
					} else if num, ok := nodeIdsVal.(float64); ok {
						// Single number instead of array
						nodeIdsFromJSON = append(nodeIdsFromJSON, int(num))
					} else if num, ok := nodeIdsVal.(int); ok {
						nodeIdsFromJSON = append(nodeIdsFromJSON, num)
					}
				}
				// Check for nodeId (backward compatibility)
				if nodeIdVal, ok := jsonData["nodeId"]; ok {
					hasNodeIdInJSON = true
					if num, ok := nodeIdVal.(float64); ok {
						nodeId := int(num)
						nodeIdFromJSON = &nodeId
					} else if num, ok := nodeIdVal.(int); ok {
						nodeIdFromJSON = &num
					}
				}
				if nb, ok := parseInboundNodeBindingsPayload(jsonData); ok {
					nodeBindingsFromJSON = nb
					hasNodeBindingsInJSON = true
				}
			}
			// Restore body for ShouldBind
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}
	}

	// Get nodeIds from form (for form-encoded requests)
	nodeIdsStr := c.PostFormArray("nodeIds")
	logger.Debugf("Received nodeIds from form: %v (count: %d)", nodeIdsStr, len(nodeIdsStr))

	// Check if nodeIds array was provided
	nodeIdStr := c.PostForm("nodeId")
	logger.Debugf("Received nodeId from form: %s", nodeIdStr)

	// Check if nodeIds or nodeId was explicitly provided in the form
	_, hasNodeIds := c.GetPostForm("nodeIds")
	_, hasNodeId := c.GetPostForm("nodeId")
	logger.Debugf("Form has nodeIds: %v, has nodeId: %v", hasNodeIds, hasNodeId)
	logger.Debugf("JSON has nodeIds: %v (values: %v), has nodeId: %v (value: %v)", hasNodeIdsInJSON, nodeIdsFromJSON, hasNodeIdInJSON, nodeIdFromJSON)

	var bindBody inboundBindBody
	bindBody.Id = id
	// Bind inbound data (nodeIds will be ignored since we handle it separately)
	err = c.ShouldBind(&bindBody)
	if err != nil {
		logger.Errorf("Failed to bind inbound data: %v", err)
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}
	inbound := &bindBody.Inbound
	inbound.Id = id
	if err = applySidecarPanelForms(inbound, bindBody.Wireguard, bindBody.Amneziawg); err != nil {
		logger.Errorf("wireguard settings: %v", err)
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	inbound, needRestart, err := a.inboundService.UpdateInbound(inbound)
	if err != nil {
		// #region agent log
		logger.Infof("[DEBUG-AGENT] updateInbound controller: ERROR from UpdateInbound, id=%d, error=%v", id, err)
		// #endregion
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	// Handle node assignment in multi-node mode
	nodeService := service.NodeService{}

	// Determine which source to use: JSON takes precedence over form data
	useJSON := hasNodeIdsInJSON || hasNodeIdInJSON || hasNodeBindingsInJSON
	useForm := (hasNodeIds || hasNodeId) && !useJSON

	if hasNodeBindingsInJSON {
		if err := nodeService.AssignInboundToNodesWithBindings(inbound.Id, nodeBindingsFromJSON); err != nil {
			logger.Errorf("Failed to assign inbound %d with node bindings: %v", inbound.Id, err)
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
			return
		}
		logger.Debugf("Successfully assigned inbound %d with nodeBindings count=%d", inbound.Id, len(nodeBindingsFromJSON))
	} else if useJSON || useForm {
		var nodeIds []int
		var nodeId *int
		var hasNodeIdsFlag bool

		if useJSON {
			// Use data from JSON
			nodeIds = nodeIdsFromJSON
			nodeId = nodeIdFromJSON
			hasNodeIdsFlag = hasNodeIdsInJSON
		} else {
			// Use data from form
			hasNodeIdsFlag = hasNodeIds
			// Parse nodeIds array from form
			for _, idStr := range nodeIdsStr {
				if idStr != "" {
					if id, err := strconv.Atoi(idStr); err == nil && id > 0 {
						nodeIds = append(nodeIds, id)
					} else {
						logger.Warningf("Invalid nodeId in array: %s (error: %v)", idStr, err)
					}
				}
			}
			// Parse single nodeId from form
			if nodeIdStr != "" && nodeIdStr != "null" {
				if parsedId, err := strconv.Atoi(nodeIdStr); err == nil && parsedId > 0 {
					nodeId = &parsedId
				}
			}
		}

		logger.Debugf("Parsed nodeIds: %v, nodeId: %v", nodeIds, nodeId)

		if len(nodeIds) > 0 {
			// Assign to multiple nodes
			if err := nodeService.AssignInboundToNodes(inbound.Id, nodeIds); err != nil {
				logger.Errorf("Failed to assign inbound %d to nodes %v: %v", inbound.Id, nodeIds, err)
				jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
				return
			}
			logger.Debugf("Successfully assigned inbound %d to nodes %v", inbound.Id, nodeIds)
		} else if nodeId != nil && *nodeId > 0 {
			// Backward compatibility: single nodeId
			if err := nodeService.AssignInboundToNode(inbound.Id, *nodeId); err != nil {
				logger.Errorf("Failed to assign inbound %d to node %d: %v", inbound.Id, *nodeId, err)
				jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
				return
			}
			logger.Debugf("Successfully assigned inbound %d to node %d", inbound.Id, *nodeId)
		} else if hasNodeIdsFlag {
			// nodeIds was explicitly provided but is empty - unassign all
			if err := nodeService.UnassignInboundFromNode(inbound.Id); err != nil {
				logger.Warningf("Failed to unassign inbound %d from nodes: %v", inbound.Id, err)
			} else {
				logger.Debugf("Successfully unassigned inbound %d from all nodes", inbound.Id)
			}
		}
		// If neither nodeIds nor nodeId was provided, don't change assignments
	}

	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInbound controller: SUCCESS, id=%d, needRestart=%v", id, needRestart)
	// #endregion
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), inbound, nil)
	a.syncWorkerAfterInboundMutation(needRestart, inbound.Id, inbound.Protocol)
	// Broadcast inbounds update via WebSocket
	user := session.GetLoginUser(c)
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
}

// getClientIps retrieves the IP addresses associated with a client by email.
func (a *InboundController) getClientIps(c *gin.Context) {
	email := c.Param("email")

	ips, err := a.inboundService.GetInboundClientIps(email)
	if err != nil || ips == "" {
		jsonObj(c, "No IP Record", nil)
		return
	}

	jsonObj(c, ips, nil)
}

// clearClientIps clears the IP addresses for a client by email.
func (a *InboundController) clearClientIps(c *gin.Context) {
	email := c.Param("email")

	err := a.inboundService.ClearClientIps(email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.updateSuccess"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.logCleanSuccess"), nil)
}

// addInboundClient adds a new client to an existing inbound.
func (a *InboundController) addInboundClient(c *gin.Context) {
	data := &model.Inbound{}
	err := c.ShouldBind(data)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}

	needRestart, err := a.inboundService.AddInboundClient(data)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientAddSuccess"), nil)
	proto := model.Protocol("")
	if ib, ierr := a.inboundService.GetInbound(data.Id); ierr == nil && ib != nil {
		proto = ib.Protocol
	}
	a.syncWorkerAfterInboundMutation(needRestart, data.Id, proto)
	// Broadcast inbounds and clients update via WebSocket
	user := session.GetLoginUser(c)
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
	// Also broadcast clients update
	clientService := service.ClientService{}
	clients, _ := clientService.GetClients(user.Id)
	websocket.BroadcastClients(clients)
}

// delInboundClient deletes a client from an inbound by inbound ID and client ID.
func (a *InboundController) delInboundClient(c *gin.Context) {
	// #region agent log
	logger.Infof("[DEBUG-AGENT] delInboundClient controller: ENTRY, path=%s, method=%s", c.Request.URL.Path, c.Request.Method)
	// #endregion
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		// #region agent log
		logger.Infof("[DEBUG-AGENT] delInboundClient controller: invalid ID, param=%s, error=%v", c.Param("id"), err)
		// #endregion
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}
	clientId := c.Param("clientId")
	// #region agent log
	logger.Infof("[DEBUG-AGENT] delInboundClient controller: parsed ID=%d, clientId=%s", id, clientId)
	// #endregion

	needRestart, err := a.inboundService.DelInboundClient(id, clientId)
	if err != nil {
		// #region agent log
		logger.Infof("[DEBUG-AGENT] delInboundClient controller: ERROR, id=%d, clientId=%s, error=%v", id, clientId, err)
		// #endregion
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	// #region agent log
	logger.Infof("[DEBUG-AGENT] delInboundClient controller: SUCCESS, id=%d, clientId=%s, needRestart=%v", id, clientId, needRestart)
	// #endregion
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientDeleteSuccess"), nil)
	delClProto := model.Protocol("")
	if ib, ierr := a.inboundService.GetInbound(id); ierr == nil && ib != nil {
		delClProto = ib.Protocol
	}
	a.syncWorkerAfterInboundMutation(needRestart, id, delClProto)
	// Broadcast inbounds and clients update via WebSocket
	user := session.GetLoginUser(c)
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
	// Also broadcast clients update
	clientService := service.ClientService{}
	clients, _ := clientService.GetClients(user.Id)
	websocket.BroadcastClients(clients)
}

// updateInboundClient updates a client's configuration in an inbound.
func (a *InboundController) updateInboundClient(c *gin.Context) {
	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInboundClient controller: ENTRY, path=%s, method=%s", c.Request.URL.Path, c.Request.Method)
	// #endregion
	clientId := c.Param("clientId")
	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInboundClient controller: clientId=%s", clientId)
	// #endregion

	inbound := &model.Inbound{}
	err := c.ShouldBind(inbound)
	if err != nil {
		// #region agent log
		logger.Infof("[DEBUG-AGENT] updateInboundClient controller: bind error, clientId=%s, error=%v", clientId, err)
		// #endregion
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}

	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInboundClient controller: calling UpdateInboundClient, inboundId=%d, clientId=%s", inbound.Id, clientId)
	// #endregion
	needRestart, err := a.inboundService.UpdateInboundClient(inbound, clientId)
	if err != nil {
		// #region agent log
		logger.Infof("[DEBUG-AGENT] updateInboundClient controller: ERROR, inboundId=%d, clientId=%s, error=%v", inbound.Id, clientId, err)
		// #endregion
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	// #region agent log
	logger.Infof("[DEBUG-AGENT] updateInboundClient controller: SUCCESS, inboundId=%d, clientId=%s, needRestart=%v", inbound.Id, clientId, needRestart)
	// #endregion
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), nil)
	updClProto := model.Protocol("")
	if ib, ierr := a.inboundService.GetInbound(inbound.Id); ierr == nil && ib != nil {
		updClProto = ib.Protocol
	}
	a.syncWorkerAfterInboundMutation(needRestart, inbound.Id, updClProto)
	// Broadcast inbounds and clients update via WebSocket
	user := session.GetLoginUser(c)
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
	// Also broadcast clients update
	clientService := service.ClientService{}
	clients, _ := clientService.GetClients(user.Id)
	websocket.BroadcastClients(clients)
}

// resetClientTraffic resets the traffic counter for a specific client in an inbound.
func (a *InboundController) resetClientTraffic(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}
	email := c.Param("email")

	needRestart, err := a.inboundService.ResetClientTraffic(id, email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.resetInboundClientTrafficSuccess"), nil)
	rtProto := model.Protocol("")
	if ib, ierr := a.inboundService.GetInbound(id); ierr == nil && ib != nil {
		rtProto = ib.Protocol
	}
	a.syncWorkerAfterInboundMutation(needRestart, id, rtProto)
}

// resetAllTraffics resets all traffic counters across all inbounds.
func (a *InboundController) resetAllTraffics(c *gin.Context) {
	err := a.inboundService.ResetAllTraffics()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	} else {
		a.xrayService.SetToNeedRestart()
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.resetAllTrafficSuccess"), nil)
}

// resetAllClientTraffics resets traffic counters for all clients in a specific inbound.
func (a *InboundController) resetAllClientTraffics(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}

	err = a.inboundService.ResetAllClientTraffics(id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	racProto := model.Protocol("")
	if ib, ierr := a.inboundService.GetInbound(id); ierr == nil && ib != nil {
		racProto = ib.Protocol
	}
	a.syncWorkerAfterInboundMutation(true, id, racProto)
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.resetAllClientTrafficSuccess"), nil)
}

// importInbound imports an inbound configuration from provided data.
func (a *InboundController) importInbound(c *gin.Context) {
	inbound := &model.Inbound{}
	err := json.Unmarshal([]byte(c.PostForm("data")), inbound)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	user := session.GetLoginUser(c)
	inbound.Id = 0
	inbound.UserId = user.Id

	for index := range inbound.ClientStats {
		inbound.ClientStats[index].Id = 0
		inbound.ClientStats[index].Enable = true
	}

	needRestart := false
	inbound, needRestart, err = a.inboundService.AddInbound(inbound)
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundCreateSuccess"), inbound, err)
	if err == nil {
		a.syncWorkerAfterInboundMutation(needRestart, inbound.Id, inbound.Protocol)
	}
}

// delDepletedClients deletes clients in an inbound who have exhausted their traffic limits.
func (a *InboundController) delDepletedClients(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}
	err = a.inboundService.DelDepletedClients(id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.delDepletedClientsSuccess"), nil)
}

// onlines retrieves the list of currently online clients.
func (a *InboundController) onlines(c *gin.Context) {
	clients := a.inboundService.GetOnlineClients()
	jsonObj(c, clients, nil)
}

// lastOnline retrieves the last online timestamps for clients.
func (a *InboundController) lastOnline(c *gin.Context) {
	data, err := a.inboundService.GetClientsLastOnline()
	jsonObj(c, data, err)
}

// updateClientTraffic updates the traffic statistics for a client by email.
func (a *InboundController) updateClientTraffic(c *gin.Context) {
	email := c.Param("email")

	// Define the request structure for traffic update
	type TrafficUpdateRequest struct {
		Upload   int64 `json:"upload"`
		Download int64 `json:"download"`
	}

	var request TrafficUpdateRequest
	err := c.ShouldBindJSON(&request)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundUpdateSuccess"), err)
		return
	}

	err = a.inboundService.UpdateClientTrafficByEmail(email, request.Upload, request.Download)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), nil)
}

// delInboundClientByEmail deletes a client from an inbound by email address.
func (a *InboundController) delInboundClientByEmail(c *gin.Context) {
	inboundId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		jsonMsg(c, "Invalid inbound ID", err)
		return
	}

	email := c.Param("email")
	needRestart, err := a.inboundService.DelInboundClientByEmail(inboundId, email)
	if err != nil {
		jsonMsg(c, "Failed to delete client by email", err)
		return
	}

	jsonMsg(c, "Client deleted successfully", nil)
	byEmailProto := model.Protocol("")
	if ib, ierr := a.inboundService.GetInbound(inboundId); ierr == nil && ib != nil {
		byEmailProto = ib.Protocol
	}
	a.syncWorkerAfterInboundMutation(needRestart, inboundId, byEmailProto)
	// Broadcast inbounds and clients update via WebSocket
	user := session.GetLoginUser(c)
	inbounds, _ := a.inboundService.GetInbounds(user.Id)
	websocket.BroadcastInbounds(inbounds)
	// Also broadcast clients update
	clientService := service.ClientService{}
	clients, _ := clientService.GetClients(user.Id)
	websocket.BroadcastClients(clients)
}
