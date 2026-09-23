package service

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/web/locale"
	"github.com/konstpic/sharx-code/v2/xray"

	"github.com/mymmrac/telego"
	th "github.com/mymmrac/telego/telegohandler"
	tu "github.com/mymmrac/telego/telegoutil"
	"github.com/valyala/fasthttp"
	"github.com/valyala/fasthttp/fasthttpproxy"
)

var (
	bot *telego.Bot

	botCancel  context.CancelFunc
	tgBotMutex sync.Mutex
	botWG      sync.WaitGroup

	botHandler *th.BotHandler
	adminIds   []int64
	isRunning  bool
	hostname   string
)

const tgAnimatedEmojiSetName = "NEWSEMOJI"

var (
	tgAnimatedEmojiByRune = map[string]string{}
	// Built-in custom emoji ids used for message rendering.
	tgDefaultCustomEmojiByRune = map[string]string{
		"✔️": "5206607081334906820",
		"❌":  "5210952531676504517",
		"🔄":  "5375338737028841420",
		"⚠️": "5447644880824181073",
		"🌐":  "5447410659077661506",
		"💬":  "5443038326535759644",
		"📊":  "5231200819986047254",
		"🚨":  "5395695537687123235",
		"🔥":  "5424972470023104089",
		"🔴":  "5411225014148014586",
		"🆕":  "5382357040008021292",
		"🔗":  "5271604874419647061",
		"✉️": "5253742260054409879",
		"⌛":  "5386367538735104399",
		"🖥":  "5282843764451195532",
		"🗣️": "5460795800101594035",
	}
	clientStateCustomEmojiID = map[string]string{
		"ACTIVE":  "5382357040008021292",
		"DISABLE": "5210952531676504517",
		"LIMITED": "5447644880824181073",
		"EXPIRED": "5411225014148014586",
	}
)

// LoginStatus represents the result of a login attempt.
type LoginStatus byte

// Login status constants
const (
	LoginSuccess        LoginStatus = 1
	LoginFail           LoginStatus = 0
	EmptyTelegramUserID             = int64(0)
)

// Tgbot provides outbound notifications and admin backup for Telegram.
type Tgbot struct {
	settingService SettingService
	serverService  ServerService
}

// NewTgbot creates a new Tgbot instance.
func (t *Tgbot) NewTgbot() *Tgbot {
	return new(Tgbot)
}

// I18nBot retrieves a localized message for the bot interface.
func (t *Tgbot) I18nBot(name string, params ...string) string {
	return locale.I18n(locale.Bot, name, params...)
}

// Start initializes and starts the Telegram bot with the provided translation files.
func (t *Tgbot) Start(i18nFS embed.FS) error {
	err := locale.InitLocalizer(i18nFS, &t.settingService)
	if err != nil {
		return err
	}

	StopBot()

	t.SetHostname()

	tgBotToken, err := t.settingService.GetTgBotToken()
	if err != nil || tgBotToken == "" {
		logger.Warning("Failed to get Telegram bot token:", err)
		return err
	}

	tgBotID, err := t.settingService.GetTgBotChatId()
	if err != nil {
		logger.Warning("Failed to get Telegram bot chat ID:", err)
		return err
	}

	parsedAdminIds := make([]int64, 0)
	if tgBotID != "" {
		for _, adminID := range strings.Split(tgBotID, ",") {
			id, err := strconv.ParseInt(adminID, 10, 64)
			if err != nil {
				logger.Warning("Failed to parse admin ID from Telegram bot chat ID:", err)
				return err
			}
			parsedAdminIds = append(parsedAdminIds, int64(id))
		}
	}
	tgBotMutex.Lock()
	adminIds = parsedAdminIds
	tgBotMutex.Unlock()

	tgBotProxy, err := t.settingService.GetTgBotProxy()
	if err != nil {
		logger.Warning("Failed to get Telegram bot proxy URL:", err)
	}

	tgBotAPIServer, err := t.settingService.GetTgBotAPIServer()
	if err != nil {
		logger.Warning("Failed to get Telegram bot API server URL:", err)
	}

	bot, err = t.NewBot(tgBotToken, tgBotProxy, tgBotAPIServer)
	if err != nil {
		logger.Error("Failed to initialize Telegram bot API:", err)
		return err
	}
	t.initAnimatedEmojiSet()

	if err = bot.SetMyCommands(context.Background(), &telego.SetMyCommandsParams{Commands: []telego.BotCommand{}}); err != nil {
		if err2 := bot.DeleteMyCommands(context.Background(), &telego.DeleteMyCommandsParams{}); err2 != nil {
			logger.Warning("Failed to clear bot commands (Set+Delete):", err, err2)
		} else {
			logger.Info("Cleared bot commands via DeleteMyCommands")
		}
	} else {
		logger.Info("Cleared bot command list in Telegram")
	}

	tgBotMutex.Lock()
	alreadyRunning := isRunning || botCancel != nil
	tgBotMutex.Unlock()
	if !alreadyRunning {
		logger.Info("Telegram bot receiver started")
		go t.OnReceive()
	}

	return nil
}

// NewBot creates a new Telegram bot instance with optional proxy and API server settings.
func (t *Tgbot) NewBot(token string, proxyUrl string, apiServerUrl string) (*telego.Bot, error) {
	proxyForDial, proxyWarn := normalizeTelegramBotProxyForDial(proxyUrl)
	if proxyWarn != "" {
		logger.Warning("Telegram bot proxy: ", proxyWarn)
	}
	if proxyForDial == "" && apiServerUrl == "" {
		return telego.NewBot(token)
	}
	if proxyForDial != "" {
		low := strings.ToLower(proxyForDial)
		if strings.HasPrefix(low, "socks5://") {
			if _, err := url.Parse(proxyForDial); err != nil {
				logger.Warningf("Telegram bot: can't parse SOCKS5 proxy URL, using default: %v", err)
			} else {
				return telego.NewBot(token, telego.WithFastHTTPClient(&fasthttp.Client{
					Dial: fasthttpproxy.FasthttpSocksDialerDualStack(proxyForDial),
				}))
			}
		} else if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
			if _, err := url.Parse(proxyForDial); err != nil {
				logger.Warningf("Telegram bot: can't parse HTTP(S) proxy URL, using default: %v", err)
			} else {
				return telego.NewBot(token, telego.WithFastHTTPClient(&fasthttp.Client{
					Dial: fasthttpproxy.FasthttpHTTPDialerDualStack(proxyForDial),
				}))
			}
		} else {
			logger.Warning("Telegram bot: unsupported proxy URL after normalization, using direct connection to Telegram")
		}
	}
	if !strings.HasPrefix(apiServerUrl, "http") {
		logger.Warning("Invalid http(s) URL, using default")
		return telego.NewBot(token)
	}
	if _, err := url.Parse(apiServerUrl); err != nil {
		logger.Warningf("Can't parse API server URL, using default instance for tgbot: %v", err)
		return telego.NewBot(token)
	}
	return telego.NewBot(token, telego.WithAPIServer(apiServerUrl))
}

func (t *Tgbot) initAnimatedEmojiSet() {
	stickerSet, err := bot.GetStickerSet(context.Background(), &telego.GetStickerSetParams{
		Name: tgAnimatedEmojiSetName,
	})
	if err != nil {
		logger.Warning("[tgbot] failed to load animated emoji set:", err)
		return
	}
	if stickerSet == nil || len(stickerSet.Stickers) == 0 {
		logger.Warning("[tgbot] animated emoji set is empty")
		return
	}

	loaded := make(map[string]string)
	for _, sticker := range stickerSet.Stickers {
		if sticker.CustomEmojiID == "" || sticker.Emoji == "" {
			continue
		}
		if _, exists := loaded[sticker.Emoji]; !exists {
			loaded[sticker.Emoji] = sticker.CustomEmojiID
		}
	}

	if len(loaded) == 0 {
		logger.Warning("[tgbot] no matching animated emoji IDs found in set ", tgAnimatedEmojiSetName)
		return
	}

	tgAnimatedEmojiByRune = loaded
	logger.Info("[tgbot] animated emoji set loaded: ", tgAnimatedEmojiSetName)
}

func renderAnimatedEmojiHTML(msg string) string {
	// Normalize legacy emojis to symbols available in NEWSEMOJI.
	msg = strings.NewReplacer(
		"✅", "✔️",
		"📧", "✉️",
		"⏰", "⌛",
		"⏱️", "⌛",
		"💻", "🖥",
		"👤", "🗣️",
		"⛔", "⛔️",
		"⚡", "⚡️",
		"❗", "❗️",
		"⭐", "⭐️",
		"🗑️", "🗑",
		"🖥️", "🖥",
	).Replace(msg)
	merged := make(map[string]string, len(tgDefaultCustomEmojiByRune)+len(tgAnimatedEmojiByRune))
	for emoji, id := range tgDefaultCustomEmojiByRune {
		merged[emoji] = id
	}
	for emoji, id := range tgAnimatedEmojiByRune {
		merged[emoji] = id
	}
	for emoji, id := range merged {
		if strings.Contains(msg, "<tg-emoji") && strings.Contains(msg, fmt.Sprintf(`>%s</tg-emoji>`, emoji)) {
			continue
		}
		msg = strings.ReplaceAll(msg, emoji, fmt.Sprintf(`<tg-emoji emoji-id="%s">%s</tg-emoji>`, id, emoji))
	}
	return msg
}

func tgEmojiTag(customEmojiID, fallbackEmoji string) string {
	id := strings.TrimSpace(customEmojiID)
	if len(id) < 16 {
		return fallbackEmoji
	}
	for _, r := range id {
		if r < '0' || r > '9' {
			return fallbackEmoji
		}
	}
	return fmt.Sprintf(`<tg-emoji emoji-id="%s">%s</tg-emoji>`, id, fallbackEmoji)
}

// IsRunning checks if the Telegram bot is currently running.
func (t *Tgbot) IsRunning() bool {
	tgBotMutex.Lock()
	defer tgBotMutex.Unlock()
	return isRunning
}

// SetHostname sets the hostname for the bot.
func (t *Tgbot) SetHostname() {
	host, err := os.Hostname()
	if err != nil {
		logger.Error("get hostname error:", err)
		hostname = ""
		return
	}
	hostname = host
}

// Stop safely stops the Telegram bot's long polling.
func (t *Tgbot) Stop() {
	StopBot()
	logger.Info("Stop Telegram receiver ...")
	tgBotMutex.Lock()
	adminIds = nil
	tgBotMutex.Unlock()
}

// StopBot cancels the long-polling context and waits for the handler to exit.
func StopBot() {
	tgBotMutex.Lock()
	cancel := botCancel
	botCancel = nil
	handler := botHandler
	botHandler = nil
	isRunning = false
	tgBotMutex.Unlock()

	if handler != nil {
		handler.Stop()
	}

	if cancel != nil {
		logger.Info("Sending cancellation signal to Telegram bot...")
		cancel()
		botWG.Wait()
		logger.Info("Telegram bot successfully stopped.")
	}
}

// OnReceive starts the minimal update loop: /backup (admins) and callback acknowledgement only.
func (t *Tgbot) OnReceive() {
	params := telego.GetUpdatesParams{Timeout: 30}
	tgBotMutex.Lock()
	if botCancel != nil || isRunning {
		tgBotMutex.Unlock()
		logger.Warning("TgBot OnReceive called while already running; ignoring.")
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	botCancel = cancel
	isRunning = true
	botWG.Add(1)
	tgBotMutex.Unlock()

	updates, _ := bot.UpdatesViaLongPolling(ctx, &params)
	go func() {
		defer botWG.Done()
		h, _ := th.NewBotHandler(bot, updates)
		tgBotMutex.Lock()
		botHandler = h
		tgBotMutex.Unlock()

		notice := t.I18nBot("tgbot.commands.unknown") + "\r\n" +
			"This bot only sends panel notifications. Use /id for your Telegram id; admins: /backup for a database export."
		noticeNoUnknown := "This bot only sends panel notifications. Use /id for your Telegram id; admins: /backup for a database export."

		h.HandleMessage(func(ctx *th.Context, message telego.Message) error {
			go t.handleCommandMessage(&message, notice, noticeNoUnknown)
			return nil
		}, th.AnyCommand())

		h.HandleCallbackQuery(func(ctx *th.Context, query telego.CallbackQuery) error {
			go func() {
				if bot == nil {
					return
				}
				t.sendCallbackAnswerTgBot(query.ID, t.I18nBot("tgbot.commands.unknown"))
			}()
			return nil
		}, th.AnyCallbackQueryWithMessage())

		h.Start()
	}()
}

func (t *Tgbot) handleCommandMessage(message *telego.Message, notice, noticeNoUnknown string) {
	if message == nil {
		return
	}
	chatID := message.Chat.ID
	isAdmin := checkAdmin(message.From.ID)

	cmd, _, _ := tu.ParseCommand(message.Text)
	switch cmd {
	case "backup":
		if isAdmin {
			t.sendBackup(chatID)
		} else {
			t.SendMsgToTgbot(chatID, t.I18nBot("tgbot.noResult"))
		}
	case "id":
		t.SendMsgToTgbot(chatID, t.I18nBot("tgbot.commands.getID", "ID=="+strconv.FormatInt(message.From.ID, 10)))
	case "start", "help", "status":
		t.SendMsgToTgbot(chatID, notice)
	default:
		t.SendMsgToTgbot(chatID, t.I18nBot("tgbot.commands.unknown")+"\r\n"+noticeNoUnknown)
	}
}

// SendMsgToTgbot sends a message to a Telegram chat.
func (t *Tgbot) SendMsgToTgbot(chatId int64, msg string, replyMarkup ...telego.ReplyMarkup) {
	if !isRunning {
		return
	}

	msg = renderAnimatedEmojiHTML(msg)

	if msg == "" {
		logger.Info("[tgbot] message is empty!")
		return
	}

	var allMessages []string
	const limit = 2000
	if len(msg) > limit {
		messages := strings.Split(msg, "\r\n\r\n")
		lastIndex := -1
		for _, m := range messages {
			if (len(allMessages) == 0) || (len(allMessages[lastIndex])+len(m) > limit) {
				allMessages = append(allMessages, m)
				lastIndex++
			} else {
				allMessages[lastIndex] += "\r\n\r\n" + m
			}
		}
		if len(allMessages) > 0 && strings.TrimSpace(allMessages[len(allMessages)-1]) == "" {
			allMessages = allMessages[:len(allMessages)-1]
		}
	} else {
		allMessages = append(allMessages, msg)
	}

	for n, message := range allMessages {
		params := telego.SendMessageParams{
			ChatID:    tu.ID(chatId),
			Text:      message,
			ParseMode: "HTML",
		}
		if len(replyMarkup) > 0 && n == len(allMessages)-1 {
			params.ReplyMarkup = replyMarkup[0]
		}
		_, err := bot.SendMessage(context.Background(), &params)
		if err != nil {
			logger.Warning("Error sending telegram message :", err)
		}
		if n < len(allMessages)-1 {
			time.Sleep(100 * time.Millisecond)
		}
	}
}

// SendMsgToTgbotAdmins sends a text message to all admin Telegram chats.
func (t *Tgbot) SendMsgToTgbotAdmins(msg string, _ ...telego.ReplyMarkup) {
	for _, adminId := range adminIds {
		t.SendMsgToTgbot(adminId, msg)
	}
}

// NotifyPanelAction sends a short HTML audit line to all admin Telegram chats (panel operator actions).
// action is a short title; detail may contain extra <b> lines; clientIP is optional.
func (t *Tgbot) NotifyPanelAction(action, detail, clientIP string) {
	if !t.IsRunning() {
		return
	}
	var b strings.Builder
	b.WriteString("🔗 <b>")
	b.WriteString(action)
	b.WriteString("</b>\n")
	if detail != "" {
		b.WriteString(detail)
		if !strings.HasSuffix(detail, "\n") {
			b.WriteString("\n")
		}
	}
	if clientIP != "" {
		b.WriteString("<b>IP:</b> ")
		b.WriteString(clientIP)
		b.WriteString("\n")
	}
	b.WriteString("<b>Time:</b> ")
	b.WriteString(time.Now().Format("2006-01-02 15:04:05"))
	t.SendMsgToTgbotAdmins(b.String())
}

// sendCallbackAnswerTgBot answers a callback query.
func (t *Tgbot) sendCallbackAnswerTgBot(id string, message string) {
	if bot == nil {
		return
	}
	err := bot.AnswerCallbackQuery(context.Background(), &telego.AnswerCallbackQueryParams{
		CallbackQueryID: id,
		Text:            message,
	})
	if err != nil {
		logger.Warning(err)
	}
}

// NotifyClientCreated sends a notification when a client is created.
func (t *Tgbot) NotifyClientCreated(client *model.ClientEntity) {
	if !t.IsRunning() {
		return
	}

	msg := t.I18nBot("tgbot.messages.clientCreated")
	msg += t.I18nBot("tgbot.messages.email", "Email=="+client.Name)
	msg += t.I18nBot("tgbot.messages.status", "Status=="+client.Status)
	msg += t.I18nBot("tgbot.messages.clientEnabled", "Enabled=="+fmt.Sprintf("%v", client.Enable))
	msg += t.I18nBot("tgbot.messages.trafficLimit", "Limit=="+t.formatTrafficLimitLocalized(client.TotalGB))
	msg += t.I18nBot("tgbot.messages.expiryTime", "Time=="+t.formatExpiryTimeLocalized(client.ExpiryTime))
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if client.Comment != "" {
		msg += t.I18nBot("tgbot.messages.comment", "Comment=="+client.Comment)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyClientUpdated sends a notification when a client is updated.
func (t *Tgbot) NotifyClientUpdated(client *model.ClientEntity, _ *model.ClientEntity) {
	if !t.IsRunning() {
		return
	}

	msg := t.I18nBot("tgbot.messages.clientUpdated")
	msg += t.I18nBot("tgbot.messages.email", "Email=="+client.Name)
	msg += t.I18nBot("tgbot.messages.status", "Status=="+client.Status)
	msg += t.I18nBot("tgbot.messages.clientEnabled", "Enabled=="+fmt.Sprintf("%v", client.Enable))
	msg += t.I18nBot("tgbot.messages.trafficLimit", "Limit=="+t.formatTrafficLimitLocalized(client.TotalGB))
	msg += t.I18nBot("tgbot.messages.expiryTime", "Time=="+t.formatExpiryTimeLocalized(client.ExpiryTime))
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	totalTraffic := client.Up + client.Down
	msg += t.I18nBot("tgbot.messages.trafficInfo",
		"Upload=="+common.FormatTraffic(client.Up),
		"Download=="+common.FormatTraffic(client.Down),
		"Total=="+common.FormatTraffic(totalTraffic))

	if client.HWIDEnabled {
		hwidCount := 0
		if client.HWIDs != nil {
			hwidCount = len(client.HWIDs)
		}
		maxHwidText := "∞"
		if client.MaxHWID > 0 {
			maxHwidText = fmt.Sprintf("%d", client.MaxHWID)
		}
		msg += t.I18nBot("tgbot.messages.hwidEnabled", "Count=="+fmt.Sprintf("%d", hwidCount), "Max=="+maxHwidText)
	} else {
		msg += t.I18nBot("tgbot.messages.hwidDisabled")
	}

	if client.Comment != "" {
		msg += t.I18nBot("tgbot.messages.comment", "Comment=="+client.Comment)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyClientDeleted sends a notification when a client is deleted.
func (t *Tgbot) NotifyClientDeleted(client *model.ClientEntity) {
	if !t.IsRunning() {
		return
	}

	msg := t.I18nBot("tgbot.messages.clientDeleted")
	msg += t.I18nBot("tgbot.messages.email", "Email=="+client.Name)
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if client.Comment != "" {
		msg += t.I18nBot("tgbot.messages.comment", "Comment=="+client.Comment)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyClientDisabled sends a notification when a client is disabled.
func (t *Tgbot) NotifyClientDisabled(client *model.ClientEntity) {
	if !t.IsRunning() {
		return
	}

	msg := t.I18nBot("tgbot.messages.clientDisabled")
	msg += t.I18nBot("tgbot.messages.email", "Email=="+client.Name)
	msg += t.I18nBot("tgbot.messages.status", "Status=="+client.Status)
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if client.Comment != "" {
		msg += t.I18nBot("tgbot.messages.comment", "Comment=="+client.Comment)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyClientFirstConnection sends a notification when a client connects for the first time.
func (t *Tgbot) NotifyClientFirstConnection(client *model.ClientEntity) {
	if !t.IsRunning() {
		return
	}

	msg := t.I18nBot("tgbot.messages.clientFirstConnection")
	msg += t.I18nBot("tgbot.messages.email", "Email=="+client.Name)
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if client.Comment != "" {
		msg += t.I18nBot("tgbot.messages.comment", "Comment=="+client.Comment)
	}

	t.SendMsgToTgbotAdmins(msg)
}

func (t *Tgbot) clientStateForNotifications(client *model.ClientEntity, nowMs int64) string {
	if client == nil {
		return ""
	}
	totalLimit := int64(client.TotalGB * 1024 * 1024 * 1024)
	used := client.Up + client.Down
	trafficExceeded := client.TotalGB > 0 && used >= totalLimit
	timeExpired := client.ExpiryTime > 0 && client.ExpiryTime <= nowMs

	if !client.Enable {
		return "DISABLE"
	}
	if timeExpired {
		return "EXPIRED"
	}
	if trafficExceeded {
		return "LIMITED"
	}
	return "ACTIVE"
}

// NotifyClientStateChanged sends a notification when the derived client state changes.
// Client states: ACTIVE | DISABLE | LIMITED | EXPIRED.
func (t *Tgbot) NotifyClientStateChanged(oldClient *model.ClientEntity, newClient *model.ClientEntity) {
	if !t.IsRunning() || oldClient == nil || newClient == nil {
		return
	}

	nowMs := time.Now().UnixMilli()
	oldState := t.clientStateForNotifications(oldClient, nowMs)
	newState := t.clientStateForNotifications(newClient, nowMs)
	if oldState == "" || newState == "" || oldState == newState {
		return
	}

	stateEmoji := "🔄"
	switch newState {
	case "ACTIVE":
		stateEmoji = "🆕"
	case "DISABLE":
		stateEmoji = "❌"
	case "LIMITED":
		stateEmoji = "⚠️"
	case "EXPIRED":
		stateEmoji = "🔴"
	}
	title := t.I18nBot("tgbot.messages.clientStateChanged")
	if strings.TrimSpace(title) == "" || strings.Contains(title, "tgbot.messages.clientStateChanged") {
		title = "<b>Client State Changed</b>\n"
	}
	msg := tgEmojiTag(clientStateCustomEmojiID[newState], stateEmoji) + " " + title
	msg += t.I18nBot("tgbot.messages.email", "Email=="+newClient.Name)
	msg += t.I18nBot("tgbot.messages.status", "Status=="+newState)
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))
	if newClient.Comment != "" {
		msg += t.I18nBot("tgbot.messages.comment", "Comment=="+newClient.Comment)
	}
	t.SendMsgToTgbotAdmins(msg)
}

// NotifyInboundCreated sends a notification when an inbound is created.
func (t *Tgbot) NotifyInboundCreated(inbound *model.Inbound) {
	if !t.IsRunning() {
		return
	}

	msg := "🆕 " + t.I18nBot("tgbot.messages.inboundCreated")
	msg += t.I18nBot("tgbot.messages.inboundName", "Name=="+inbound.Remark)
	msg += t.I18nBot("tgbot.messages.inboundProtocol", "Protocol=="+string(inbound.Protocol))
	msg += t.I18nBot("tgbot.messages.inboundPort", "Port=="+fmt.Sprintf("%d", inbound.Port))
	msg += t.I18nBot("tgbot.messages.inboundEnabled", "Enabled=="+fmt.Sprintf("%v", inbound.Enable))
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if inbound.Listen != "" && inbound.Listen != "0.0.0.0" {
		msg += t.I18nBot("tgbot.messages.inboundListen", "Listen=="+inbound.Listen)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyInboundUpdated sends a notification when an inbound is updated.
func (t *Tgbot) NotifyInboundUpdated(inbound *model.Inbound, oldInbound *model.Inbound) {
	if !t.IsRunning() {
		return
	}

	msg := "🔄 " + t.I18nBot("tgbot.messages.inboundUpdated")
	msg += t.I18nBot("tgbot.messages.inboundName", "Name=="+inbound.Remark)
	msg += t.I18nBot("tgbot.messages.inboundProtocol", "Protocol=="+string(inbound.Protocol))
	msg += t.I18nBot("tgbot.messages.inboundPort", "Port=="+fmt.Sprintf("%d", inbound.Port))
	msg += t.I18nBot("tgbot.messages.inboundEnabled", "Enabled=="+fmt.Sprintf("%v", inbound.Enable))
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if oldInbound != nil {
		changes := []string{}
		if oldInbound.Remark != inbound.Remark {
			changes = append(changes, t.I18nBot("tgbot.messages.inboundNameChanged", "Old=="+oldInbound.Remark, "New=="+inbound.Remark))
		}
		if oldInbound.Port != inbound.Port {
			changes = append(changes, t.I18nBot("tgbot.messages.inboundPortChanged", "Old=="+fmt.Sprintf("%d", oldInbound.Port), "New=="+fmt.Sprintf("%d", inbound.Port)))
		}
		if oldInbound.Protocol != inbound.Protocol {
			changes = append(changes, t.I18nBot("tgbot.messages.inboundProtocolChanged", "Old=="+string(oldInbound.Protocol), "New=="+string(inbound.Protocol)))
		}
		if oldInbound.Enable != inbound.Enable {
			changes = append(changes, t.I18nBot("tgbot.messages.inboundEnabledChanged", "Old=="+fmt.Sprintf("%v", oldInbound.Enable), "New=="+fmt.Sprintf("%v", inbound.Enable)))
		}
		if len(changes) > 0 {
			msg += "\n\n" + t.I18nBot("tgbot.messages.changes") + "\n" + strings.Join(changes, "\n")
		}
	}

	if inbound.Listen != "" && inbound.Listen != "0.0.0.0" {
		msg += t.I18nBot("tgbot.messages.inboundListen", "Listen=="+inbound.Listen)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyInboundDeleted sends a notification when an inbound is deleted.
func (t *Tgbot) NotifyInboundDeleted(inbound *model.Inbound) {
	if !t.IsRunning() {
		return
	}

	msg := "❌ " + t.I18nBot("tgbot.messages.inboundDeleted")
	msg += t.I18nBot("tgbot.messages.inboundName", "Name=="+inbound.Remark)
	msg += t.I18nBot("tgbot.messages.inboundProtocol", "Protocol=="+string(inbound.Protocol))
	msg += t.I18nBot("tgbot.messages.inboundPort", "Port=="+fmt.Sprintf("%d", inbound.Port))
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	if inbound.Listen != "" && inbound.Listen != "0.0.0.0" {
		msg += t.I18nBot("tgbot.messages.inboundListen", "Listen=="+inbound.Listen)
	}

	t.SendMsgToTgbotAdmins(msg)
}

// NotifyGroupChanged sends a notification when a group's clients are enabled/disabled.
func (t *Tgbot) NotifyGroupChanged(groupName string, enable bool, clients []*model.ClientEntity) {
	if !t.IsRunning() {
		return
	}

	if len(clients) == 0 {
		return
	}

	action := "disabled"
	emoji := "🔴"
	if enable {
		action = "enabled"
		emoji = "🆕"
	}

	msg := emoji + " " + t.I18nBot("tgbot.messages.groupChanged")
	msg += t.I18nBot("tgbot.messages.groupName", "Name=="+groupName)
	msg += t.I18nBot("tgbot.messages.groupAction", "Action=="+action)
	msg += t.I18nBot("tgbot.messages.groupClientsCount", "Count=="+fmt.Sprintf("%d", len(clients)))
	msg += t.I18nBot("tgbot.messages.time", "Time=="+time.Now().Format("2006-01-02 15:04:05"))

	maxClients := 10
	var clientList string
	if len(clients) > maxClients {
		for i := 0; i < maxClients; i++ {
			if clients[i].Comment != "" {
				clientList += fmt.Sprintf("• %s (%s)\n", clients[i].Name, clients[i].Comment)
			} else {
				clientList += fmt.Sprintf("• %s\n", clients[i].Name)
			}
		}
		clientList += t.I18nBot("tgbot.messages.groupClientsMore", "Count=="+fmt.Sprintf("%d", len(clients)-maxClients))
	} else {
		for _, client := range clients {
			if client.Comment != "" {
				clientList += fmt.Sprintf("• %s (%s)\n", client.Name, client.Comment)
			} else {
				clientList += fmt.Sprintf("• %s\n", client.Name)
			}
		}
	}

	if clientList != "" {
		msg += "\n\n" + t.I18nBot("tgbot.messages.groupClients") + "\n" + clientList
	}

	t.SendMsgToTgbotAdmins(msg)
}

func (t *Tgbot) formatTrafficLimitLocalized(totalGB float64) string {
	if totalGB == 0 {
		return t.I18nBot("tgbot.messages.unlimitedTraffic")
	}
	if totalGB < 1 {
		return fmt.Sprintf("%.2f GB", totalGB)
	}
	if totalGB == float64(int64(totalGB)) {
		return fmt.Sprintf("%d GB", int64(totalGB))
	}
	return fmt.Sprintf("%.2f GB", totalGB)
}

func (t *Tgbot) formatExpiryTimeLocalized(expiryTime int64) string {
	if expiryTime == 0 {
		return t.I18nBot("tgbot.messages.noExpiry")
	}
	return time.Unix(expiryTime/1000, 0).Format("2006-01-02 15:04:05")
}

// SendReport is triggered on the configured cron: only database backup to admins (if enabled in settings).
func (t *Tgbot) SendReport() {
	backupEnable, err := t.settingService.GetTgBotBackup()
	if err == nil && backupEnable {
		t.SendBackupToAdmins()
	}
}

// SendBackupToAdmins sends a database backup to each admin chat.
func (t *Tgbot) SendBackupToAdmins() {
	if !t.IsRunning() {
		return
	}
	for _, adminId := range adminIds {
		t.sendBackup(int64(adminId))
	}
}

// UserLoginNotify sends a notification about user login attempts to admins.
func (t *Tgbot) UserLoginNotify(username string, password string, ip string, timeStr string, status LoginStatus) {
	if !t.IsRunning() {
		return
	}

	if username == "" || ip == "" || timeStr == "" {
		logger.Warning("UserLoginNotify failed, invalid info!")
		return
	}

	loginNotifyEnabled, err := t.settingService.GetTgBotLoginNotify()
	if err != nil || !loginNotifyEnabled {
		return
	}

	var msg string
	switch status {
	case LoginSuccess:
		msg += t.I18nBot("tgbot.messages.loginSuccess")
		msg += t.I18nBot("tgbot.messages.hostname", "Hostname=="+hostname)
	case LoginFail:
		msg += t.I18nBot("tgbot.messages.loginFailed")
		msg += t.I18nBot("tgbot.messages.hostname", "Hostname=="+hostname)
		msg += t.I18nBot("tgbot.messages.password", "Password=="+password)
	}
	msg += t.I18nBot("tgbot.messages.username", "Username=="+username)
	msg += t.I18nBot("tgbot.messages.ip", "IP=="+ip)
	msg += t.I18nBot("tgbot.messages.time", "Time=="+timeStr)
	t.SendMsgToTgbotAdmins(msg)
}

// SendTwoFactorLoginCode sends the current TOTP (same as the authenticator app) to admin Telegram chats.
func (t *Tgbot) SendTwoFactorLoginCode(username, ip, code string) {
	if !t.IsRunning() || username == "" || code == "" {
		return
	}
	msg := t.I18nBot("tgbot.messages.twoFactorLoginCode",
		"Username=="+username,
		"IP=="+ip,
		"Code=="+code,
	)
	t.SendMsgToTgbotAdmins(msg)
}

// sendBackup sends a backup of the database and configuration files.
func (t *Tgbot) sendBackup(chatId int64) {
	if !t.IsRunning() {
		return
	}
	output := t.I18nBot("tgbot.messages.backupTime", "Time=="+time.Now().Format("2006-01-02 15:04:05"))
	t.SendMsgToTgbot(chatId, output)

	tempFile, err := os.CreateTemp("", "sharx-db-backup-*.sql")
	if err != nil {
		logger.Error("Error creating temporary backup file: ", err)
		return
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}()

	host := config.GetDBHost()
	port := config.GetDBPort()
	user := config.GetDBUser()
	password := config.GetDBPassword()
	dbname := config.GetDBName()

	env := os.Environ()
	env = append(env, fmt.Sprintf("PGPASSWORD=%s", password))

	cmd := exec.Command("pg_dump",
		"-h", host,
		"-p", strconv.Itoa(port),
		"-U", user,
		"-d", dbname,
		"--format=plain",
		"--no-owner",
		"--no-privileges",
		"--clean",
		"--if-exists",
	)
	cmd.Env = env
	cmd.Stdout = tempFile
	cmd.Stderr = new(bytes.Buffer)

	err = cmd.Run()
	if err != nil {
		logger.Warningf("pg_dump not available for Telegram backup, falling back to GORM-based export: %v", err)
		if _, serr := tempFile.Seek(0, 0); serr == nil {
			_ = tempFile.Truncate(0)
		}
		dbData, fallbackErr := t.serverService.GetDb()
		if fallbackErr != nil {
			logger.Errorf("Error in database backup (both pg_dump and fallback failed): %v", fallbackErr)
			t.SendMsgToTgbot(chatId, t.I18nBot("tgbot.messages.backupError"))
			return
		}
		if _, err = tempFile.Write(dbData); err != nil {
			logger.Error("Error writing fallback backup data to file: ", err)
			return
		}
	}

	if err = tempFile.Close(); err != nil {
		logger.Error("Error closing temporary backup file: ", err)
		return
	}

	fileBytes, err := os.ReadFile(tempPath)
	if err != nil {
		logger.Error("Error reading backup file: ", err)
		return
	}

	document := tu.Document(
		tu.ID(chatId),
		tu.FileFromBytes(fileBytes, "sharx-db-backup.sql"),
	)
	_, err = bot.SendDocument(context.Background(), document)
	if err != nil {
		logger.Error("Error in uploading backup: ", err)
	}

	multiMode, err := t.settingService.GetMultiNodeMode()
	if err == nil && !multiMode {
		file, err := os.Open(xray.GetConfigPath())
		if err == nil {
			defer file.Close()
			document := tu.Document(
				tu.ID(chatId),
				tu.File(file),
			)
			_, err = bot.SendDocument(context.Background(), document)
			if err != nil {
				logger.Error("Error in uploading config.json: ", err)
			}
		} else {
			logger.Error("Error in opening config.json file for backup: ", err)
		}
	} else if err == nil && multiMode {
		logger.Debug("Skipping config.json backup in multi-node mode")
	}
}

func checkAdmin(tgId int64) bool {
	for _, adminId := range adminIds {
		if adminId == tgId {
			return true
		}
	}
	return false
}
