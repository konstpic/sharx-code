package controller

import (
	"github.com/gin-gonic/gin"
)

// XUIController is the main controller for the X-UI panel, managing sub-controllers.
type XUIController struct {
	BaseController

	settingController     *SettingController
	xraySettingController *XraySettingController
	nodeController        *NodeController

	servePanelPage func(c *gin.Context)
}

// NewXUIController creates a new XUIController and initializes its routes.
// servePanelPage serves the Next.js static export for authenticated /panel/* routes.
func NewXUIController(g *gin.RouterGroup, servePanelPage func(c *gin.Context)) *XUIController {
	a := &XUIController{servePanelPage: servePanelPage}
	a.initRouter(g)
	return a
}

// initRouter sets up the main panel routes and initializes sub-controllers.
func (a *XUIController) initRouter(g *gin.RouterGroup) {
	g = g.Group("/panel")
	g.Use(a.checkLogin)

	a.settingController = NewSettingController(g)
	a.xraySettingController = NewXraySettingController(g)
	a.nodeController = NewNodeController(g.Group("/node"))

	NewBalancerController(g.Group("/balancer"))
	NewClientController(g.Group("/client"))
	NewHostController(g.Group("/host"))
	NewClientHWIDController(g.Group("/client"))
	NewClientGroupController(g.Group("/group"))
	NewOutboundController(g.Group("/outbound"))
	NewXrayCoreConfigProfileController(g.Group("/xray-core-config-profile"))
	NewDbInspectorController(g)

	g.HEAD("/", a.panelIndex)
	g.GET("/", a.panelIndex)
	// Do not register /*filepath here: Gin forbids a catch-all alongside static segments like /xray, /setting.
	// Deep links are served via engine.NoRoute + ServeSPAFallback in web.Server.
}

func (a *XUIController) panelIndex(c *gin.Context) {
	if a.servePanelPage != nil {
		a.servePanelPage(c)
	}
}

// ServeSPAFallback serves the React shell for client-side routes (GET /panel/... with no API match).
func (a *XUIController) ServeSPAFallback(c *gin.Context) {
	a.checkLogin(c)
	if c.IsAborted() {
		return
	}
	if a.servePanelPage != nil {
		a.servePanelPage(c)
	}
}
