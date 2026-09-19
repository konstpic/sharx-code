package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// isLocalHost reports whether host (an IP or a name) points at this machine: loopback, one of the
// local interface addresses, or a name that resolves to one of them.
func isLocalHost(host string, local []net.IP, lookup func(string) ([]string, error)) bool {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ips := []net.IP{}
	if ip := net.ParseIP(host); ip != nil {
		ips = append(ips, ip)
	} else if lookup != nil {
		addrs, err := lookup(host)
		if err != nil {
			return false
		}
		for _, a := range addrs {
			if ip := net.ParseIP(a); ip != nil {
				ips = append(ips, ip)
			}
		}
	}
	for _, ip := range ips {
		if ip.IsLoopback() {
			return true
		}
		for _, l := range local {
			if l.Equal(ip) {
				return true
			}
		}
	}
	return false
}

func localInterfaceIPs() []net.IP {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var out []net.IP
	for _, a := range addrs {
		switch v := a.(type) {
		case *net.IPNet:
			out = append(out, v.IP)
		case *net.IPAddr:
			out = append(out, v.IP)
		}
	}
	return out
}

func hostOfNode(n *model.Node) string {
	u, err := url.Parse(nodeRequestBaseURL(n))
	if err != nil {
		return ""
	}
	return u.Hostname()
}

type realDockerUpdateEnv struct {
	nodes NodeService
}

func (e *realDockerUpdateEnv) ListNodes() ([]*model.Node, error) { return e.nodes.GetAllNodes() }

func (e *realDockerUpdateEnv) MultiNode() bool {
	multi, err := (&SettingService{}).GetMultiNodeMode()
	return err == nil && multi
}

func (e *realDockerUpdateEnv) IsColocated(n *model.Node) bool {
	lookup := func(h string) ([]string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return net.DefaultResolver.LookupHost(ctx, h)
	}
	return isLocalHost(hostOfNode(n), localInterfaceIPs(), lookup)
}

func (e *realDockerUpdateEnv) TriggerNode(ctx context.Context, n *model.Node) error {
	return e.nodes.TriggerDockerUpdaterOnNode(ctx, n)
}

// ProbeNode reads the node's unauthenticated /health: reachability and the running build version.
func (e *realDockerUpdateEnv) ProbeNode(ctx context.Context, n *model.Node) (dockerNodeProbe, error) {
	cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, nodeRequestBaseURL(n)+"/health", nil)
	if err != nil {
		return dockerNodeProbe{}, err
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return dockerNodeProbe{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		return dockerNodeProbe{}, fmt.Errorf("health: HTTP %d", resp.StatusCode)
	}
	var h map[string]interface{}
	_ = json.Unmarshal(body, &h)
	return dockerNodeProbe{Online: true, Version: extractNodeWorkerVersion(h)}, nil
}

func (e *realDockerUpdateEnv) PanelVersion() string { return strings.TrimSpace(config.GetVersion()) }

func (e *realDockerUpdateEnv) TriggerPanel(ctx context.Context) error {
	return TriggerPanelDockerUpdate(ctx)
}

func (e *realDockerUpdateEnv) PrepWorkers() error { return PrepWorkersForDockerUpdate() }

func (e *realDockerUpdateEnv) FinishWorkers() error { return FinishWorkersForDockerUpdate() }

func (e *realDockerUpdateEnv) Load() (*DockerUpdateJob, error) {
	s := SettingService{}
	setting, err := s.getSetting(dockerUpdateJobSettingKey)
	if database.IsNotFound(err) || (err == nil && strings.TrimSpace(setting.Value) == "") {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var j DockerUpdateJob
	if err := json.Unmarshal([]byte(setting.Value), &j); err != nil {
		return nil, err
	}
	return &j, nil
}

func (e *realDockerUpdateEnv) Save(j *DockerUpdateJob) error {
	v, err := marshalJob(j)
	if err != nil {
		return err
	}
	return (&SettingService{}).saveSetting(dockerUpdateJobSettingKey, v)
}

func (e *realDockerUpdateEnv) Now() time.Time { return time.Now() }

func (e *realDockerUpdateEnv) Sleep(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

var (
	dockerUpdateRunnerMu  sync.Mutex
	dockerUpdateRunnerVal *dockerUpdateRunner
)

func dockerUpdateJobRunner() *dockerUpdateRunner {
	dockerUpdateRunnerMu.Lock()
	defer dockerUpdateRunnerMu.Unlock()
	if dockerUpdateRunnerVal == nil {
		dockerUpdateRunnerVal = newDockerUpdateRunner(&realDockerUpdateEnv{}, defaultDockerUpdateTiming())
	}
	return dockerUpdateRunnerVal
}

// StartDockerUpdateJob starts (or returns the running) panel + workers update job.
func StartDockerUpdateJob() (*DockerUpdateJob, error) { return dockerUpdateJobRunner().Start() }

// GetDockerUpdateJob returns the current or last update job, or nil if there never was one.
func GetDockerUpdateJob() *DockerUpdateJob { return dockerUpdateJobRunner().Snapshot() }

// ResumeDockerUpdateJob continues an update job interrupted by a panel restart. Call once at startup.
func ResumeDockerUpdateJob() { dockerUpdateJobRunner().Resume() }
