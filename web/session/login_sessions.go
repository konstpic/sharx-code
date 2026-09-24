package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

const (
	sessionIDKey       = "SESSION_ID"
	sessionTouchEvery  = 60 * time.Second
	sessionCheckCache  = 3 * time.Second
	sessionKeepRevoked = 24 * time.Hour
)

type sessionCheck struct {
	ok      bool
	checked time.Time
}

var (
	sessionMu      sync.Mutex
	sessionChecks  = map[string]sessionCheck{}
	sessionTouched = map[string]time.Time{}
)

func newSessionID() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func currentSessionID(c *gin.Context) string {
	v, _ := sessions.Default(c).Get(sessionIDKey).(string)
	return v
}

// CurrentSessionID returns the registered id of this browser session ("" for API-token requests or unregistered sessions).
func CurrentSessionID(c *gin.Context) string {
	if _, api := c.Get(requestAPILoginUserKey); api {
		return ""
	}
	return currentSessionID(c)
}

func isAPIRequest(c *gin.Context) bool {
	_, api := c.Get(requestAPILoginUserKey)
	return api
}

// RegisterLoginSession records the current login and stores its id in the session cookie.
// The caller must save the session afterwards.
func RegisterLoginSession(c *gin.Context, userID int, maxAgeSeconds int, ip string) error {
	id, err := newSessionID()
	if err != nil {
		return err
	}
	now := time.Now()
	ua := c.Request.UserAgent()
	if len(ua) > 512 {
		ua = ua[:512]
	}
	row := &model.LoginSession{
		Id:         id,
		UserId:     userID,
		IP:         ip,
		UserAgent:  ua,
		CreatedAt:  now.Unix(),
		LastSeenAt: now.Unix(),
		ExpiresAt:  now.Add(time.Duration(maxAgeSeconds) * time.Second).Unix(),
	}
	if err := database.GetDB().Create(row).Error; err != nil {
		return err
	}
	sessions.Default(c).Set(sessionIDKey, id)
	go resolveSessionLocation(id, ip)
	return nil
}

// EnsureRegistered registers sessions that predate the registry (no id in the cookie) so they become visible and revocable.
func EnsureRegistered(c *gin.Context, userID int, maxAgeSeconds int, ip string) {
	if isAPIRequest(c) || currentSessionID(c) != "" {
		return
	}
	if err := RegisterLoginSession(c, userID, maxAgeSeconds, ip); err != nil {
		logger.Warning("login session: register existing session:", err)
		return
	}
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("login session: save session:", err)
	}
}

// sessionRecordValid reports whether the cookie's session id is still active (unknown legacy sessions without an id pass).
func sessionRecordValid(c *gin.Context) bool {
	id := currentSessionID(c)
	if id == "" {
		return true
	}
	now := time.Now()
	sessionMu.Lock()
	if cached, ok := sessionChecks[id]; ok && now.Sub(cached.checked) < sessionCheckCache {
		sessionMu.Unlock()
		return cached.ok
	}
	sessionMu.Unlock()

	var row model.LoginSession
	err := database.GetDB().Where("id = ?", id).First(&row).Error
	ok := err == nil && row.RevokedAt == nil && row.ExpiresAt > now.Unix()

	sessionMu.Lock()
	sessionChecks[id] = sessionCheck{ok: ok, checked: now}
	touch := ok && now.Sub(sessionTouched[id]) >= sessionTouchEvery
	if touch {
		sessionTouched[id] = now
	}
	sessionMu.Unlock()
	if touch {
		database.GetDB().Model(&model.LoginSession{}).Where("id = ?", id).Update("last_seen_at", now.Unix())
	}
	return ok
}

func forgetSessionCache(id string) {
	sessionMu.Lock()
	delete(sessionChecks, id)
	delete(sessionTouched, id)
	sessionMu.Unlock()
}

// EndCurrentLoginSession marks the current session revoked (logout).
func EndCurrentLoginSession(c *gin.Context) {
	id := currentSessionID(c)
	if id == "" {
		return
	}
	now := time.Now().Unix()
	database.GetDB().Model(&model.LoginSession{}).Where("id = ? AND revoked_at IS NULL", id).Update("revoked_at", now)
	forgetSessionCache(id)
}

// LoginSessionView is the API representation of one active session.
type LoginSessionView struct {
	ID         string `json:"id"`
	IP         string `json:"ip"`
	UserAgent  string `json:"userAgent"`
	Device     string `json:"device"`
	Location   string `json:"location"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	ExpiresAt  int64  `json:"expiresAt"`
	Current    bool   `json:"current"`
}

// ListLoginSessions returns the user's active sessions, newest activity first.
func ListLoginSessions(c *gin.Context, userID int) ([]LoginSessionView, error) {
	db := database.GetDB()
	now := time.Now()
	db.Where("expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", now.Unix(), now.Add(-sessionKeepRevoked).Unix()).
		Delete(&model.LoginSession{})
	var rows []model.LoginSession
	if err := db.Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, now.Unix()).
		Order("last_seen_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	cur := CurrentSessionID(c)
	out := make([]LoginSessionView, 0, len(rows))
	for _, r := range rows {
		out = append(out, LoginSessionView{
			ID: r.Id, IP: r.IP, UserAgent: r.UserAgent, Device: DescribeUserAgent(r.UserAgent), Location: r.Location,
			CreatedAt: r.CreatedAt, LastSeenAt: r.LastSeenAt, ExpiresAt: r.ExpiresAt, Current: r.Id == cur,
		})
	}
	return out, nil
}

// RevokeLoginSession ends one of the user's sessions. It returns false when nothing matched.
func RevokeLoginSession(userID int, id string) bool {
	res := database.GetDB().Model(&model.LoginSession{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", id, userID).Update("revoked_at", time.Now().Unix())
	forgetSessionCache(id)
	return res.Error == nil && res.RowsAffected > 0
}

// RevokeOtherLoginSessions ends every session of the user except keepID and returns how many were ended.
func RevokeOtherLoginSessions(userID int, keepID string) int64 {
	db := database.GetDB()
	var ids []string
	db.Model(&model.LoginSession{}).Where("user_id = ? AND revoked_at IS NULL AND id <> ?", userID, keepID).Pluck("id", &ids)
	if len(ids) == 0 {
		return 0
	}
	res := db.Model(&model.LoginSession{}).Where("id IN ?", ids).Update("revoked_at", time.Now().Unix())
	for _, id := range ids {
		forgetSessionCache(id)
	}
	return res.RowsAffected
}

// DescribeUserAgent returns a short "Browser on OS" label for a User-Agent string.
func DescribeUserAgent(ua string) string {
	if ua == "" {
		return "Unknown"
	}
	l := strings.ToLower(ua)
	browser := "Browser"
	switch {
	case strings.Contains(l, "edg/") || strings.Contains(l, "edge/"):
		browser = "Edge"
	case strings.Contains(l, "opr/") || strings.Contains(l, "opera"):
		browser = "Opera"
	case strings.Contains(l, "firefox/") || strings.Contains(l, "fxios"):
		browser = "Firefox"
	case strings.Contains(l, "chrome/") || strings.Contains(l, "crios"):
		browser = "Chrome"
	case strings.Contains(l, "safari/"):
		browser = "Safari"
	case strings.Contains(l, "curl/"):
		browser = "curl"
	}
	osName := ""
	switch {
	case strings.Contains(l, "iphone") || strings.Contains(l, "ipad"):
		osName = "iOS"
	case strings.Contains(l, "android"):
		osName = "Android"
	case strings.Contains(l, "windows"):
		osName = "Windows"
	case strings.Contains(l, "mac os x") || strings.Contains(l, "macintosh"):
		osName = "macOS"
	case strings.Contains(l, "linux") || strings.Contains(l, "x11"):
		osName = "Linux"
	}
	if osName == "" {
		return browser
	}
	return browser + " on " + osName
}

func resolveSessionLocation(id, ip string) {
	loc := lookupLocation(ip)
	if loc == "" {
		return
	}
	database.GetDB().Model(&model.LoginSession{}).Where("id = ?", id).Update("location", loc)
}

// lookupLocation returns "City, Country" for a public IP using ipwho.is (best effort, empty on failure).
func lookupLocation(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsLinkLocalUnicast() || parsed.IsUnspecified() {
		return ""
	}
	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get("https://ipwho.is/" + parsed.String() + "?fields=success,country,city")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var data struct {
		Success bool   `json:"success"`
		Country string `json:"country"`
		City    string `json:"city"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&data) != nil || !data.Success {
		return ""
	}
	switch {
	case data.City != "" && data.Country != "":
		return data.City + ", " + data.Country
	default:
		return data.Country + data.City
	}
}
