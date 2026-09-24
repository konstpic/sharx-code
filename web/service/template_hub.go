package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
)

// TemplateHubService talks to the shared templates hub (sharx-panel-shared). The panel identifies itself with a
// random key kept in the settings table; the hub only stores its sha256 and never sees who runs the panel.
type TemplateHubService struct {
	settingService SettingService
}

var hubKeyMu sync.Mutex

// Reads fail fast so a dead hub never freezes the UI; writes get more time.
const (
	hubReadTimeout  = 5 * time.Second
	hubWriteTimeout = 15 * time.Second
)

// ErrHubUnavailable means the hub cannot be used right now (network error, 5xx or open circuit).
var ErrHubUnavailable = errors.New("templates hub is unavailable")

var hubHTTPClient = &http.Client{}

var hubBreaker = &hubGuard{}
var hubCache = newHubListCache()

// HubResponse is a decoded hub reply.
type HubResponse struct {
	Status int
	Body   json.RawMessage
}

func (s *TemplateHubService) baseURL() (string, error) {
	u, err := s.settingService.getString("templateHubUrl")
	if err != nil {
		return "", err
	}
	u = strings.TrimRight(strings.TrimSpace(u), "/")
	if !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
		return "", errors.New("templateHubUrl is not a valid URL")
	}
	return u, nil
}

// PanelKey returns the panel's hub key, creating it on first use.
func (s *TemplateHubService) PanelKey() (string, error) {
	hubKeyMu.Lock()
	defer hubKeyMu.Unlock()
	k, err := s.settingService.getString("templateHubKey")
	if err != nil {
		return "", err
	}
	if len(k) >= 32 {
		return k, nil
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	k = base64.RawURLEncoding.EncodeToString(b)
	if err := s.settingService.setString("templateHubKey", k); err != nil {
		return "", err
	}
	return k, nil
}

// Do calls the hub; body may be nil. Non-2xx statuses are returned, not turned into errors.
func (s *TemplateHubService) Do(method, path string, query url.Values, body any) (*HubResponse, error) {
	base, err := s.baseURL()
	if err != nil {
		return nil, err
	}
	key, err := s.PanelKey()
	if err != nil {
		return nil, err
	}
	return doHubRequest(base, key, method, path, query, body)
}

func doHubRequest(base, key, method, path string, query url.Values, body any) (*HubResponse, error) {
	full := base + path
	if len(query) > 0 {
		full += "?" + query.Encode()
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	if !hubBreaker.allow(time.Now()) {
		return nil, ErrHubUnavailable
	}
	timeout := hubWriteTimeout
	if method == http.MethodGet {
		timeout = hubReadTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, full, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("User-Agent", "sharx-panel/"+config.GetVersion())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := hubHTTPClient.Do(req)
	if err != nil {
		hubBreaker.record(false, time.Now())
		return nil, ErrHubUnavailable
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		hubBreaker.record(false, time.Now())
		return nil, ErrHubUnavailable
	}
	if resp.StatusCode >= 500 {
		hubBreaker.record(false, time.Now())
		return nil, ErrHubUnavailable
	}
	hubBreaker.record(true, time.Now())
	return &HubResponse{Status: resp.StatusCode, Body: raw}, nil
}

// HubErrorMessage extracts {"error": "..."} from a failed hub reply.
func HubErrorMessage(r *HubResponse) string {
	var e struct {
		Error  string `json:"error"`
		Fields []struct {
			Field string `json:"field"`
			Msg   string `json:"msg"`
		} `json:"fields"`
	}
	if json.Unmarshal(r.Body, &e) == nil && e.Error != "" {
		msg := e.Error
		for _, f := range e.Fields {
			msg += "; " + f.Field + ": " + f.Msg
		}
		return msg
	}
	return fmt.Sprintf("templates hub returned HTTP %d", r.Status)
}
