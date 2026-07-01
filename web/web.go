// Package web provides the main web server implementation for the SharX panel,
// including HTTP/HTTPS serving, routing, templates, and background job scheduling.
package web

import (
	"context"
	"crypto/tls"
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/secretpath"
	"github.com/konstpic/sharx-code/v2/web/controller"
	"github.com/konstpic/sharx-code/v2/web/job"
	"github.com/konstpic/sharx-code/v2/web/locale"
	"github.com/konstpic/sharx-code/v2/web/logsse"
	"github.com/konstpic/sharx-code/v2/web/middleware"
	"github.com/konstpic/sharx-code/v2/web/network"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/websocket"

	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
)

//go:embed translation/*
var i18nFS embed.FS

//go:embed docs
var docsFS embed.FS

var startTime = time.Now()

// EmbeddedDocs returns the embedded docs filesystem.
func EmbeddedDocs() embed.FS {
	return docsFS
}

// Server represents the main web server for the SharX panel with controllers, services, and scheduled jobs.
type Server struct {
	httpServer *http.Server
	listener   net.Listener

	index *controller.IndexController
	panel *controller.XUIController
	api   *controller.APIController
	ws    *controller.WebSocketController

	xrayService    service.XrayService
	settingService service.SettingService
	tgbotService   service.Tgbot

	wsHub *websocket.Hub

	cron *cron.Cron

	ctx    context.Context
	cancel context.CancelFunc
}

// NewServer creates a new web server instance with a cancellable context.
func NewServer() *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{
		ctx:    ctx,
		cancel: cancel,
	}
}

// initRouter initializes Gin, registers middleware, static assets,
// controllers and returns the configured engine.
func (s *Server) initRouter() (*gin.Engine, error) {
	if config.IsDebug() {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.DefaultWriter = io.Discard
		gin.DefaultErrorWriter = io.Discard
		gin.SetMode(gin.ReleaseMode)
	}

	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())
	// Avoid Gin's trailing-slash / case-fix redirects; they can emit relative Location (e.g. ./) and loops.
	engine.RedirectTrailingSlash = false
	engine.RedirectFixedPath = false
	// Allow multipart uploads up to 256 MiB (geo files for some regions exceed the default 32 MiB).
	engine.MaxMultipartMemory = 256 << 20

	webDomain, err := s.settingService.GetWebDomain()
	if err != nil {
		return nil, err
	}

	if webDomain != "" {
		engine.Use(middleware.DomainValidatorMiddleware(webDomain))
	}

	secret, err := s.settingService.GetSecret()
	if err != nil {
		return nil, err
	}

	basePath, err := s.settingService.GetBasePath()
	if err != nil {
		return nil, err
	}
	engine.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{basePath + "panel/api/"})))

	// Use cookie store for sessions (Redis removed).
	var store sessions.Store
	store = cookie.NewStore(secret)
	logger.Info("Using cookie store for sessions")

	// Configure default session cookie options, including expiration (MaxAge)
	if sessionMaxAge, err := s.settingService.GetSessionMaxAge(); err == nil {
		store.Options(sessions.Options{
			Path:     "/",
			MaxAge:   sessionMaxAge * 60, // minutes -> seconds
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
	}
	engine.Use(sessions.Sessions("sharx", store))
	engine.Use(func(c *gin.Context) {
		c.Set("base_path", basePath)
	})
	engine.Use(func(c *gin.Context) {
		uri := c.Request.RequestURI
		if strings.HasPrefix(uri, basePath+"_next/") || strings.HasPrefix(uri, basePath+"locales/") {
			c.Header("Cache-Control", "max-age=31536000, public, immutable")
		} else if strings.HasPrefix(uri, basePath+"custom.min.css") {
			c.Header("Cache-Control", "max-age=31536000, public, immutable")
		} else if strings.HasPrefix(uri, basePath+"panel/") {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
		}
	})

	err = locale.InitLocalizer(i18nFS, &s.settingService)
	if err != nil {
		return nil, err
	}
	engine.Use(locale.LocalizerMiddleware())

	if err = initPanelFileSystem(); err != nil {
		return nil, err
	}

	// Bare GET/HEAD / returns 404 when the panel uses a secret URL prefix.
	// Login and static assets live under webBasePath; do not redirect / → /secret/.
	if secretpath.HidesBareRoot(basePath) {
		bareRoot404 := func(c *gin.Context) { c.AbortWithStatus(http.StatusNotFound) }
		engine.GET("/", bareRoot404)
		engine.HEAD("/", bareRoot404)
	}

	engine.Use(middleware.RedirectMiddleware(basePath))

	g := engine.Group(basePath)
	if nxt, err := fs.Sub(panelFsys, "_next"); err == nil {
		g.StaticFS("/_next", http.FS(nxt))
	} else {
		logger.Warning("panel: _next not found in static export: ", err)
	}
	if loc, err := fs.Sub(panelFsys, "locales"); err == nil {
		g.StaticFS("/locales", http.FS(loc))
	} else {
		logger.Warning("panel: locales not found: ", err)
	}
	g.GET("/custom.min.css", func(c *gin.Context) {
		c.FileFromFS("custom.min.css", panelRootHTTP)
	})

	// Prometheus metrics endpoint (no auth required for scraping)
	panelMetrics := g.Group("/panel")
	panelMetrics.GET("/metrics", func(c *gin.Context) {
		metrics := service.CollectMetrics()
		c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		c.String(http.StatusOK, metrics)
	})

	s.index = controller.NewIndexController(g, ServePanelLoginPage)
	s.panel = controller.NewXUIController(g, ServePanelReactPage)
	s.api = controller.NewAPIController(g)
	// Set embedded docs filesystem for API controller
	s.api.SetDocsFS(docsFS)

	// Initialize WebSocket hub
	s.wsHub = websocket.NewHub()
	go s.wsHub.Run()

	// Initialize WebSocket controller
	s.ws = controller.NewWebSocketController(s.wsHub)
	// Register WebSocket route with basePath (g already has basePath prefix)
	g.GET("/ws", s.ws.HandleWebSocket)

	// Chrome DevTools endpoint for debugging web apps
	engine.GET("/.well-known/appspecific/com.chrome.devtools.json", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{})
	})

	// SPA deep links: Gin cannot register /panel/*filepath next to /panel/xray, /panel/setting, etc.
	bt := strings.TrimSuffix(basePath, "/")
	panelRoot := bt + "/panel"
	engine.NoRoute(func(c *gin.Context) {
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
			p := c.Request.URL.Path
			if p == panelRoot || p == panelRoot+"/" || strings.HasPrefix(p, panelRoot+"/") {
				s.panel.ServeSPAFallback(c)
				return
			}
		}
		c.AbortWithStatus(http.StatusNotFound)
	})

	if err := (&service.SubscriptionPageConfigService{}).EnsureDefault(); err != nil {
		logger.Warningf("default subscription page config: %v", err)
	}
	if err := (&service.SubscriptionPageConfigService{}).UpgradeDefaultIfLegacy(); err != nil {
		logger.Warningf("subscription page config legacy upgrade: %v", err)
	}

	return engine, nil
}

// startTask schedules background jobs (Xray checks, traffic jobs, cron
// jobs) which the panel relies on for periodic maintenance and monitoring.
func (s *Server) startTask() {
	err := s.xrayService.RestartXray(true)
	if err != nil {
		logger.Warning("start xray failed:", err)
	}
	// Check whether xray is running every second
	s.cron.AddJob("@every 1s", job.NewCheckXrayRunningJob())
	// Removed: duplicate Xray log forwarding. Xray writes access/error to
	// files on disk (see ensureXrayLoggingDefaults). The process stderr is
	// already captured by xray.LogWriter.Write → logger.Emit, which is the
	// single source feeding the in-memory buffer / Loki / SSE stream.
	// Tailing the same files here produced every line twice in the UI.
	// s.cron.AddJob("@every 1s", job.NewXrayLogTailJob())

	// Check if xray needs to be restarted every 30 seconds
	s.cron.AddFunc("@every 30s", func() {
		if s.xrayService.IsNeedRestartAndSetFalse() {
			err := s.xrayService.RestartXray(false)
			if err != nil {
				logger.Error("restart xray failed:", err)
			}
		}
	})

	go func() {
		time.Sleep(time.Second * 5)
		// Statistics every 1 second for real-time traffic updates, start the delay for 5 seconds for the first time, and staggered with the time to restart xray
		s.cron.AddJob("@every 1s", job.NewXrayTrafficJob())
	}()

	// check client ips from log file every 1 second for real-time updates
	// IP limit job disabled - using HWID only
	// s.cron.AddJob("@every 1s", job.NewCheckClientIpJob())

	// Check client HWIDs from log file every 1 second for real-time updates
	s.cron.AddJob("@every 1s", job.NewCheckClientHWIDJob())
	s.cron.AddJob(job.IPLimitJobTickSchedule, job.NewCheckClientIPLimitJob())
	s.cron.AddJob(job.GeofileAutoUpdateJobTickSchedule, job.NewGeofileAutoUpdateJob())

	// check client ips from log file every day
	s.cron.AddJob("@daily", job.NewClearLogsJob())

	// Inbound traffic reset jobs
	// Run once a day, midnight
	s.cron.AddJob("@daily", job.NewPeriodicTrafficResetJob("daily"))
	// Run once a week, midnight between Sat/Sun
	s.cron.AddJob("@weekly", job.NewPeriodicTrafficResetJob("weekly"))
	// Run once a month, midnight, first of month
	s.cron.AddJob("@monthly", job.NewPeriodicTrafficResetJob("monthly"))
	s.cron.AddJob("@daily", job.NewNodeTrafficResetJob())

	// LDAP sync scheduling
	if ldapEnabled, _ := s.settingService.GetLdapEnable(); ldapEnabled {
		runtime, err := s.settingService.GetLdapSyncCron()
		if err != nil || runtime == "" {
			runtime = "@every 1m"
		}
		j := job.NewLdapSyncJob()
		// job has zero-value services with method receivers that read settings on demand
		s.cron.AddJob(runtime, j)
	}

	// Multi-node: jobs tick every second; interval comes from settings (see CheckNodeHealthJob / CollectNodeStatsJob).
	s.cron.AddJob(job.NodeJobTickSchedule, job.NewCheckNodeHealthJob())
	s.cron.AddJob(job.NodeJobTickSchedule, job.NewCollectNodeStatsJob())

	// TG backup / stats notify: always register so the job picks up settings
	// changes (tgBotEnable, tgRunTime, tgBotBackup) without a panel restart.
	// The job itself checks tgBotEnable + tgBotBackup at run time.
	tgRuntime, err := s.settingService.GetTgbotRuntime()
	if err != nil || tgRuntime == "" {
		tgRuntime = "@daily"
	}
	if _, err = s.cron.AddJob(tgRuntime, job.NewStatsNotifyJob()); err != nil {
		logger.Warning("Add NewStatsNotifyJob error", err)
	}
	// CPU alert: always register; job checks threshold at run time.
	if _, err := s.cron.AddJob("@every 15s", job.NewCheckCpuJob()); err != nil {
		logger.Warning("Add CheckCpuJob error", err)
	}
}

// Start initializes and starts the web server with configured settings, routes, and background jobs.
func (s *Server) Start() (err error) {
	// This is an anonymous function, no function name
	defer func() {
		if err != nil {
			s.Stop()
		}
	}()

	loc, err := s.settingService.GetTimeLocation()
	if err != nil {
		return err
	}
	s.cron = cron.New(cron.WithLocation(loc), cron.WithSeconds())
	s.cron.Start()

	engine, err := s.initRouter()
	if err != nil {
		return err
	}

	certFile, err := s.settingService.GetCertFile()
	if err != nil {
		return err
	}
	keyFile, err := s.settingService.GetKeyFile()
	if err != nil {
		return err
	}
	listen, err := s.settingService.GetListen()
	if err != nil {
		return err
	}
	port, err := s.settingService.GetPort()
	if err != nil {
		return err
	}
	listenAddr := net.JoinHostPort(listen, strconv.Itoa(port))
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return err
	}
	if certFile != "" || keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err == nil {
			c := &tls.Config{
				Certificates: []tls.Certificate{cert},
			}
			listener = network.NewAutoHttpsListener(listener)
			listener = tls.NewListener(listener, c)
			logger.Info("Web server running HTTPS on", listener.Addr())
		} else {
			logger.Error("Error loading certificates:", err)
			logger.Info("Web server running HTTP on", listener.Addr())
		}
	} else {
		logger.Info("Web server running HTTP on", listener.Addr())
	}
	s.settingService.LogAccessURLs()
	s.listener = listener

	s.httpServer = &http.Server{
		Handler: engine,
	}

	go func() {
		s.httpServer.Serve(listener)
	}()

	// Forward panel process logs into the SSE log stream.
	// Node-forwarded lines are emitted separately in APIController with node metadata.
	logger.SetLogPusher(func(logLine string) {
		var e logger.Entry
		if err := json.Unmarshal([]byte(logLine), &e); err == nil && strings.TrimSpace(e.Msg) != "" {
			src := strings.ToLower(strings.TrimSpace(e.Source))
			if src == "node" {
				// Node logs are emitted separately in APIController with node metadata.
				return
			}

			e.Source = src
			e.Level = strings.ToLower(strings.TrimSpace(e.Level))
			e.Msg = strings.TrimSpace(e.Msg)
			if e.TsUnixMs == 0 {
				e.TsUnixMs = time.Now().UnixMilli()
				if raw := strings.TrimSpace(e.Ts); raw != "" {
					if t0, err := time.ParseInLocation("2006/01/02 15:04:05", raw, time.Local); err == nil {
						e.TsUnixMs = t0.UnixMilli()
					}
				}
			}
			e.Channel = strings.TrimSpace(e.Channel)
			if e.Channel == "" {
				e.Channel = "service"
			}
			if src == "xray" && e.Channel == "service" {
				e.Channel = "access"
			}

			logsse.Emit(e)
			return
		}
	})

	// Start Telegram before background jobs so outbound alerts see isRunning=true (OnReceive sets it early).
	isTgbotenabled, err := s.settingService.GetTgbotEnabled()
	if (err == nil) && isTgbotenabled {
		tgBot := s.tgbotService.NewTgbot()
		if err := tgBot.Start(i18nFS); err != nil {
			logger.Warning("Telegram bot failed to start (CPU and other alerts may be dropped):", err)
		}
	}

	s.startTask()

	return nil
}

// Stop gracefully shuts down the web server, stops Xray, cron jobs, and Telegram bot.
func (s *Server) Stop() error {
	s.cancel()
	s.xrayService.StopXray()
	if s.cron != nil {
		s.cron.Stop()
	}
	if s.tgbotService.IsRunning() {
		s.tgbotService.Stop()
	}
	// Gracefully stop WebSocket hub
	if s.wsHub != nil {
		s.wsHub.Stop()
	}
	var err1 error
	var err2 error
	if s.httpServer != nil {
		err1 = s.httpServer.Shutdown(s.ctx)
	}
	if s.listener != nil {
		err2 = s.listener.Close()
	}
	return common.Combine(err1, err2)
}

// GetCtx returns the server's context for cancellation and deadline management.
func (s *Server) GetCtx() context.Context {
	return s.ctx
}

// GetCron returns the server's cron scheduler instance.
func (s *Server) GetCron() *cron.Cron {
	return s.cron
}

// GetWSHub returns the WebSocket hub instance.
func (s *Server) GetWSHub() any {
	return s.wsHub
}
