package controller

import (
	"net/http"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/web/rbac"
)

// /panel/metrics (Prometheus) used to be public. It must now need a session (or API token) that may read the dashboard.
func TestPrometheusMetricsRequireAuthentication(t *testing.T) {
	e := newHTTPEnv(t)
	get := func(c *client) int {
		req, _ := http.NewRequest("GET", e.srv.URL+"/panel/metrics", nil)
		resp, err := c.c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := get(e.anonymous()); code != 404 {
		t.Fatalf("an anonymous scraper must not read the metrics, got %d", code)
	}
	reader := e.user("metrics-reader", e.role(rbac.DashboardRead).Id)
	if code := get(e.as(reader)); code != 200 {
		t.Fatalf("an account with dashboard:read reads the metrics, got %d", code)
	}
	other := e.user("no-dashboard", e.role(rbac.ClientsRead).Id)
	if code := get(e.as(other)); code != 403 {
		t.Fatalf("an account without dashboard:read is refused, got %d", code)
	}
}

func TestMetricsIncludeTheNewSeries(t *testing.T) {
	e := newHTTPEnv(t)
	reader := e.user("metrics-reader2", e.role(rbac.DashboardRead).Id)
	c := e.as(reader)
	req, _ := http.NewRequest("GET", e.srv.URL+"/panel/metrics", nil)
	resp, err := c.c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := make([]byte, 1<<20)
	n, _ := resp.Body.Read(buf)
	body := string(buf[:n])
	for _, name := range []string{"xui_build_info", "xui_go_goroutines", "xui_login_failures_total", "xui_login_bans_total", "xui_clients_expired",
		"xui_clients_traffic_exhausted", "xui_hwid_devices_total", "xui_client_groups_total", "xui_organizations_total"} {
		if !strings.Contains(body, name) {
			t.Errorf("metric %s missing", name)
		}
	}
}
