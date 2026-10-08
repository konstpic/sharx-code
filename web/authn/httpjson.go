package authn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxBody = 1 << 20

// HTTPError is a non-2xx answer from a provider.
type HTTPError struct {
	Host   string
	Status int
	Body   string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("%s returned %d: %s", e.Host, e.Status, e.Body)
}

// IsGrantRevoked reports that the provider refused a refresh token for good: the grant was revoked, expired, or the user
// was deactivated (OAuth 2.0 "invalid_grant", or 400/401 on the token endpoint).
func IsGrantRevoked(err error) bool {
	var he *HTTPError
	if !errors.As(err, &he) {
		return false
	}
	return he.Status == 400 || he.Status == 401 || strings.Contains(he.Body, "invalid_grant")
}

// HTTPClient is used for every call to an identity provider: bounded time, no automatic redirects to other hosts' schemes,
// bounded response size. Replaceable in tests.
var HTTPClient = &http.Client{
	Timeout: 12 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" && via[0].URL.Scheme == "https" {
			return errors.New("redirect from https to http refused")
		}
		return nil
	},
}

func readLimited(r io.Reader) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, maxBody+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxBody {
		return nil, errors.New("response too large")
	}
	return b, nil
}

func getJSON(ctx context.Context, u, bearer string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	req.Header.Set("User-Agent", "SharX-Panel")
	return doJSON(req, out)
}

func doJSON(req *http.Request, out any) error {
	resp, err := HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := readLimited(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		// the body may name the error; it never contains our secrets, but keep it short
		msg := strings.TrimSpace(string(body))
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return &HTTPError{Host: req.URL.Host, Status: resp.StatusCode, Body: msg}
	}
	return json.Unmarshal(body, out)
}

func postForm(ctx context.Context, u string, form url.Values, basicUser, basicPass string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "SharX-Panel")
	if basicUser != "" {
		req.SetBasicAuth(url.QueryEscape(basicUser), url.QueryEscape(basicPass))
	}
	return doJSON(req, out)
}
