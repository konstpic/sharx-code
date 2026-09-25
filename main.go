// Package main is the entry point for the SharX web panel application.
// It initializes the database, web server, and handles command-line operations for managing the panel.
package main

import (
	"flag"
	"os"
	"os/signal"
	"syscall"
	_ "unsafe"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/sub"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	"github.com/konstpic/sharx-code/v2/web"
	"github.com/konstpic/sharx-code/v2/web/controller"
	"github.com/konstpic/sharx-code/v2/web/global"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/xray"

	"github.com/joho/godotenv"
	"github.com/op/go-logging"
)

func registerClientShareLinksBuilder() {
	controller.SetBundleConversionHooks(func() (any, error) {
		return sub.ConvertToBundles(sub.ConvertOptions{Host: "conversion.local"})
	}, sub.RollbackBundles)
	controller.SetClientShareLinksBuilder(func(client *model.ClientEntity, host string) []model.ClientInboundShareLink {
		s := sub.NewPanelSubService(host)
		return s.ClientShareLinks(client, client.InboundIds)
	})
	controller.RegisterSubscriptionSubsHook(func(subID, host string) ([]string, int64, xray.ClientTraffic, error) {
		ss := service.SettingService{}
		showInfo, _ := ss.GetSubShowInfo()
		remark, _ := ss.GetRemarkModel()
		if remark == "" {
			remark = "-ieo"
		}
		s := sub.NewCompatSubService(showInfo, remark)
		return s.GetSubs(subID, host, nil)
	})
	controller.RegisterPublicSubMtProtoHook(func(subID, host string) []string {
		ss := service.SettingService{}
		showInfo, _ := ss.GetSubShowInfo()
		remark, _ := ss.GetRemarkModel()
		if remark == "" {
			remark = "-ieo"
		}
		s := sub.NewCompatSubService(showInfo, remark)
		return s.TelemtTgProxyLinesForSubscription(subID, host)
	})
}

// runWebServer initializes and starts the web server for the SharX panel.
func runWebServer() {
	logger.Infof("Starting %v %v", config.GetName(), config.GetVersion())

	switch config.GetLogLevel() {
	case config.Debug:
		logger.InitLogger(logging.DEBUG)
	case config.Info:
		logger.InitLogger(logging.INFO)
	case config.Notice:
		logger.InitLogger(logging.NOTICE)
	case config.Warning:
		logger.InitLogger(logging.WARNING)
	case config.Error:
		logger.InitLogger(logging.ERROR)
	default:
		logger.Errorf("Unknown log level: %v", config.GetLogLevel())
		os.Exit(1)
	}
	logger.SetSource("panel")

	godotenv.Load()

	err := database.InitDB(config.GetDBConnectionString())
	if err != nil {
		logger.Errorf("Error initializing database: %v", err)
		os.Exit(1)
	}

	// Ensure xrayTemplateConfig is present and valid in the database.
	// This is critical when the panel image is updated without applying DB migrations.
	settingService := service.SettingService{}
	if err := settingService.EnsureXrayTemplateConfigValid(); err != nil {
		logger.Warningf("Failed to ensure xrayTemplateConfig is valid: %v", err)
		// Do not abort startup; Xray-related operations may still try to recover later.
	}
	if err := settingService.EnsureXrayLoggingDefaults(); err != nil {
		logger.Warningf("Failed to ensure xray logging defaults: %v", err)
	}
	if allSetting, err := settingService.GetAllSetting(); err == nil {
		service.ApplyLogRotateFromSettings(allSetting)
	}

	// Generate (once) and cache the panel-wide node pairing bundle so every node
	// shares the same SECRET_KEY in its docker-compose.yml.
	pairingService := &service.PanelPairingService{}
	if err := pairingService.Ensure(); err != nil {
		logger.Warningf("Failed to ensure panel pairing bundle: %v", err)
	}

	service.StartPanelGeographyRefresh()

	// Pre-generate Xray configuration file from database at startup.
	// This ensures the config file is ready before Xray starts.
	xrayService := service.NewXrayService()
	if err := xrayService.EnsureXrayConfigFile(); err != nil {
		logger.Warningf("Failed to pre-generate Xray config file: %v", err)
		// Don't fail startup - Xray will attempt to generate config when it starts.
	}

	var server *web.Server
	server = web.NewServer()
	registerClientShareLinksBuilder()
	global.SetWebServer(server)
	err = server.Start()
	if err != nil {
		logger.Errorf("Error starting web server: %v", err)
		os.Exit(1)
		return
	}

	var subServer *sub.Server
	subServer = sub.NewServer()
	global.SetSubServer(subServer)
	err = subServer.Start()
	if err != nil {
		logger.Errorf("Error starting sub server: %v", err)
		os.Exit(1)
		return
	}

	// One-time, verified conversion to the bundle scheme (see docs/architecture/bundles.md). Background, never blocks startup.
	go sub.AutoConvertOnStartup()

	sigCh := make(chan os.Signal, 1)
	// Trap shutdown signals
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM)
	for {
		sig := <-sigCh

		switch sig {
		case syscall.SIGHUP:
			logger.Info("Received SIGHUP signal. Restarting servers...")

			// --- FIX FOR TELEGRAM BOT CONFLICT (409): Stop bot before restart ---
			service.StopBot()
			// --

			err := server.Stop()
			if err != nil {
				logger.Debug("Error stopping web server:", err)
			}
			err = subServer.Stop()
			if err != nil {
				logger.Debug("Error stopping sub server:", err)
			}

			server = web.NewServer()
			registerClientShareLinksBuilder()
			global.SetWebServer(server)
			err = server.Start()
			if err != nil {
				logger.Errorf("Error restarting web server: %v", err)
				os.Exit(1)
				return
			}
			logger.Info("Web server restarted successfully.")

			subServer = sub.NewServer()
			global.SetSubServer(subServer)
			err = subServer.Start()
			if err != nil {
				logger.Errorf("Error restarting sub server: %v", err)
				os.Exit(1)
				return
			}
			logger.Info("Sub server restarted successfully.")

		default:
			// --- FIX FOR TELEGRAM BOT CONFLICT (409) on full shutdown ---
			service.StopBot()
			// ------------------------------------------------------------

			server.Stop()
			subServer.Stop()
			logger.Info("Shutting down servers.")
			return
		}
	}
}

// resetSetting resets all panel settings to their default values.
func resetSetting() {
	err := database.InitDB(config.GetDBConnectionString())
	if err != nil {
		logger.Error("Failed to initialize database:", err)
		return
	}

	settingService := service.SettingService{}
	err = settingService.ResetSettings()
	if err != nil {
		logger.Error("Failed to reset settings:", err)
	} else {
		logger.Info("Settings successfully reset.")
	}
}

// showSetting displays the current panel settings if show is true.
func showSetting(show bool) {
	if show {
		settingService := service.SettingService{}
		port, err := settingService.GetPort()
		if err != nil {
			logger.Warning("get current port failed, error info:", err)
		}

		webBasePath, err := settingService.GetBasePath()
		if err != nil {
			logger.Warning("get webBasePath failed, error info:", err)
		}

		certFile, err := settingService.GetCertFile()
		if err != nil {
			logger.Warning("get cert file failed, error info:", err)
		}
		keyFile, err := settingService.GetKeyFile()
		if err != nil {
			logger.Warning("get key file failed, error info:", err)
		}

		userService := service.UserService{}
		userModel, err := userService.GetFirstUser()
		if err != nil {
			logger.Warning("get current user info failed, error info:", err)
		}

		if userModel.Username == "" || userModel.Password == "" {
			logger.Warning("current username or password is empty")
		}

		logger.Info("current panel settings as follows:")
		if certFile == "" || keyFile == "" {
			logger.Warning("Warning: Panel is not secure with SSL")
		} else {
			logger.Info("Panel is secure with SSL")
		}

		hasDefaultCredential := func() bool {
			return userModel.Username == "admin" && crypto.CheckPasswordHash(userModel.Password, "admin")
		}()

		logger.Infof("hasDefaultCredential: %v", hasDefaultCredential)
		logger.Infof("port: %v", port)
		logger.Infof("webBasePath: %v", webBasePath)
	}
}

// updateTgbotEnableSts enables or disables the Telegram bot notifications based on the status parameter.
func updateTgbotEnableSts(status bool) {
	settingService := service.SettingService{}
	currentTgSts, err := settingService.GetTgbotEnabled()
	if err != nil {
		logger.Error(err)
		return
	}
	logger.Infof("current enabletgbot status[%v],need update to status[%v]", currentTgSts, status)
	if currentTgSts != status {
		err := settingService.SetTgbotEnabled(status)
		if err != nil {
			logger.Error(err)
			return
		} else {
			logger.Infof("SetTgbotEnabled[%v] success", status)
		}
	}
}

// updateTgbotSetting updates Telegram bot settings including token, chat ID, and runtime schedule.
func updateTgbotSetting(tgBotToken string, tgBotChatid string, tgBotRuntime string) {
	err := database.InitDB(config.GetDBConnectionString())
	if err != nil {
		logger.Error("Error initializing database:", err)
		return
	}

	settingService := service.SettingService{}

	if tgBotToken != "" {
		err := settingService.SetTgBotToken(tgBotToken)
		if err != nil {
			logger.Errorf("Error setting Telegram bot token: %v", err)
			return
		}
		logger.Info("Successfully updated Telegram bot token.")
	}

	if tgBotRuntime != "" {
		err := settingService.SetTgbotRuntime(tgBotRuntime)
		if err != nil {
			logger.Errorf("Error setting Telegram bot runtime: %v", err)
			return
		}
		logger.Infof("Successfully updated Telegram bot runtime to [%s].", tgBotRuntime)
	}

	if tgBotChatid != "" {
		err := settingService.SetTgBotChatId(tgBotChatid)
		if err != nil {
			logger.Errorf("Error setting Telegram bot chat ID: %v", err)
			return
		}
		logger.Info("Successfully updated Telegram bot chat ID.")
	}
}

// updateSetting updates various panel settings including port, credentials, base path, listen IP, and two-factor authentication.
func updateSetting(port int, username string, password string, webBasePath string, listenIP string, resetTwoFactor bool) {
	err := database.InitDB(config.GetDBConnectionString())
	if err != nil {
		logger.Error("Database initialization failed:", err)
		return
	}

	settingService := service.SettingService{}
	userService := service.UserService{}

	if port > 0 {
		err := settingService.SetPort(port)
		if err != nil {
			logger.Error("Failed to set port:", err)
		} else {
			logger.Infof("Port set successfully: %v", port)
		}
	}

	if username != "" || password != "" {
		err := userService.UpdateFirstUser(username, password)
		if err != nil {
			logger.Error("Failed to update username and password:", err)
		} else {
			logger.Info("Username and password updated successfully")
		}
	}

	if webBasePath != "" {
		err := settingService.SetBasePath(webBasePath)
		if err != nil {
			logger.Error("Failed to set base URI path:", err)
		} else {
			logger.Info("Base URI path set successfully")
		}
	}

	if resetTwoFactor {
		err := settingService.SetTwoFactorEnable(false)

		if err != nil {
			logger.Error("Failed to reset two-factor authentication:", err)
		} else {
			settingService.SetTwoFactorToken("")
			logger.Info("Two-factor authentication reset successfully")
		}
	}

	if listenIP != "" {
		err := settingService.SetListen(listenIP)
		if err != nil {
			logger.Error("Failed to set listen IP:", err)
		} else {
			logger.Infof("listen %v set successfully", listenIP)
		}
	}
}

// updateCert updates the SSL certificate files for the panel.
func updateCert(publicKey string, privateKey string) {
	err := database.InitDB(config.GetDBConnectionString())
	if err != nil {
		logger.Error(err)
		return
	}

	if (privateKey != "" && publicKey != "") || (privateKey == "" && publicKey == "") {
		settingService := service.SettingService{}
		err = settingService.SetCertFile(publicKey)
		if err != nil {
			logger.Error("set certificate public key failed:", err)
		} else {
			logger.Info("set certificate public key success")
		}

		err = settingService.SetKeyFile(privateKey)
		if err != nil {
			logger.Error("set certificate private key failed:", err)
		} else {
			logger.Info("set certificate private key success")
		}

		err = settingService.SetSubCertFile(publicKey)
		if err != nil {
			logger.Error("set certificate for subscription public key failed:", err)
		} else {
			logger.Info("set certificate for subscription public key success")
		}

		err = settingService.SetSubKeyFile(privateKey)
		if err != nil {
			logger.Error("set certificate for subscription private key failed:", err)
		} else {
			logger.Info("set certificate for subscription private key success")
		}
	} else {
		logger.Warning("both public and private key should be entered.")
	}
}

// GetCertificate displays the current SSL certificate settings if getCert is true.
func GetCertificate(getCert bool) {
	if getCert {
		settingService := service.SettingService{}
		certFile, err := settingService.GetCertFile()
		if err != nil {
			logger.Warning("get cert file failed, error info:", err)
		}
		keyFile, err := settingService.GetKeyFile()
		if err != nil {
			logger.Warning("get key file failed, error info:", err)
		}

		logger.Infof("cert: %v", certFile)
		logger.Infof("key: %v", keyFile)
	}
}

// GetListenIP displays the current panel listen IP address if getListen is true.
func GetListenIP(getListen bool) {
	if getListen {

		settingService := service.SettingService{}
		ListenIP, err := settingService.GetListen()
		if err != nil {
			logger.Warningf("Failed to retrieve listen IP: %v", err)
			return
		}

		logger.Infof("listenIP: %v", ListenIP)
	}
}

// migrateDb performs database migration operations for the SharX panel.
func migrateDb() {
	inboundService := service.InboundService{}

	err := database.InitDB(config.GetDBConnectionString())
	if err != nil {
		logger.Errorf("migrate: init db: %v", err)
		os.Exit(1)
	}
	logger.Info("Start migrating database...")
	inboundService.MigrateDB()
	logger.Info("Migration done!")
}

// main is the entry point of the SharX application.
// It parses command-line arguments to run the web server, migrate database, or update settings.
func main() {
	if len(os.Args) < 2 {
		runWebServer()
		return
	}

	// Ensure JSON logger is available for CLI subcommands too.
	logger.InitLogger(logging.INFO)
	logger.SetSource("panel")

	var showVersion bool
	flag.BoolVar(&showVersion, "v", false, "show version")

	runCmd := flag.NewFlagSet("run", flag.ExitOnError)

	settingCmd := flag.NewFlagSet("setting", flag.ExitOnError)
	var port int
	var username string
	var password string
	var webBasePath string
	var listenIP string
	var getListen bool
	var webCertFile string
	var webKeyFile string
	var tgbottoken string
	var tgbotchatid string
	var enabletgbot bool
	var tgbotRuntime string
	var reset bool
	var show bool
	var getCert bool
	var resetTwoFactor bool
	settingCmd.BoolVar(&reset, "reset", false, "Reset all settings")
	settingCmd.BoolVar(&show, "show", false, "Display current settings")
	settingCmd.IntVar(&port, "port", 0, "Set panel port number")
	settingCmd.StringVar(&username, "username", "", "Set login username")
	settingCmd.StringVar(&password, "password", "", "Set login password")
	settingCmd.StringVar(&webBasePath, "webBasePath", "", "Set base path for Panel")
	settingCmd.StringVar(&listenIP, "listenIP", "", "set panel listenIP IP")
	settingCmd.BoolVar(&resetTwoFactor, "resetTwoFactor", false, "Reset two-factor authentication settings")
	settingCmd.BoolVar(&getListen, "getListen", false, "Display current panel listenIP IP")
	settingCmd.BoolVar(&getCert, "getCert", false, "Display current certificate settings")
	settingCmd.StringVar(&webCertFile, "webCert", "", "Set path to public key file for panel")
	settingCmd.StringVar(&webKeyFile, "webCertKey", "", "Set path to private key file for panel")
	settingCmd.StringVar(&tgbottoken, "tgbottoken", "", "Set token for Telegram bot")
	settingCmd.StringVar(&tgbotRuntime, "tgbotRuntime", "", "Set cron time for Telegram bot notifications")
	settingCmd.StringVar(&tgbotchatid, "tgbotchatid", "", "Set chat ID for Telegram bot notifications")
	settingCmd.BoolVar(&enabletgbot, "enabletgbot", false, "Enable notifications via Telegram bot")

	oldUsage := flag.Usage
	flag.Usage = func() {
		oldUsage()
		logger.Info("")
		logger.Info("Commands:")
		logger.Info("    run            run web panel")
		logger.Info("    migrate        migrate form other/old x-ui")
		logger.Info("    setting        set settings")
	}

	flag.Parse()
	if showVersion {
		logger.Info(config.GetVersion())
		return
	}

	switch os.Args[1] {
	case "run":
		err := runCmd.Parse(os.Args[2:])
		if err != nil {
			logger.Error(err)
			return
		}
		runWebServer()
	case "migrate":
		migrateDb()
	case "setting":
		err := settingCmd.Parse(os.Args[2:])
		if err != nil {
			logger.Error(err)
			return
		}
		if reset {
			resetSetting()
		} else {
			updateSetting(port, username, password, webBasePath, listenIP, resetTwoFactor)
		}
		if show {
			showSetting(show)
		}
		if getListen {
			GetListenIP(getListen)
		}
		if getCert {
			GetCertificate(getCert)
		}
		if (tgbottoken != "") || (tgbotchatid != "") || (tgbotRuntime != "") {
			updateTgbotSetting(tgbottoken, tgbotchatid, tgbotRuntime)
		}
		if enabletgbot {
			updateTgbotEnableSts(enabletgbot)
		}
	case "cert":
		err := settingCmd.Parse(os.Args[2:])
		if err != nil {
			logger.Error(err)
			return
		}
		if reset {
			updateCert("", "")
		} else {
			updateCert(webCertFile, webKeyFile)
		}
	default:
		logger.Warning("Invalid subcommands")
		logger.Info("")
		runCmd.Usage()
		logger.Info("")
		settingCmd.Usage()
	}
}
