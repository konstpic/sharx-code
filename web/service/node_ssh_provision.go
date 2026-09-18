// Package service: automatic node installation over SSH.
//
// This is the "automatic" counterpart to the existing manual flow, where the admin copies a
// docker-compose.yml (see panel/components/NodesPage.tsx buildNodeDockerComposeYaml) onto the
// target server themselves. Here the panel does that over SSH instead: connect, make sure Docker
// is available (installing it via the official convenience script if not), write the exact same
// compose file, and bring it up. The compose content below is intentionally kept identical to
// the frontend's buildNodeDockerComposeYaml — if you change one, change the other.
//
// SSH credentials (password / private key) are only ever held in memory for the duration of one
// provisioning run and are never persisted to the database or written to logs.
package service

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"golang.org/x/crypto/ssh"
)

// NodeProvisionStepKey identifies one step of the automatic install for progress reporting.
type NodeProvisionStepKey string

const (
	NodeProvisionStepConnect       NodeProvisionStepKey = "connect"
	NodeProvisionStepCheckDocker   NodeProvisionStepKey = "check_docker"
	NodeProvisionStepInstallDocker NodeProvisionStepKey = "install_docker"
	NodeProvisionStepWriteCompose  NodeProvisionStepKey = "write_compose"
	NodeProvisionStepComposeUp     NodeProvisionStepKey = "compose_up"
)

// nodeProvisionStepOrder is the fixed, displayed order of steps (install_docker is included even
// when it ends up skipped, so the UI's step list doesn't jump around between runs).
var nodeProvisionStepOrder = []NodeProvisionStepKey{
	NodeProvisionStepConnect,
	NodeProvisionStepCheckDocker,
	NodeProvisionStepInstallDocker,
	NodeProvisionStepWriteCompose,
	NodeProvisionStepComposeUp,
}

// NodeProvisionStep is one row of automatic-install progress shown in the panel UI.
type NodeProvisionStep struct {
	Key    string `json:"key"`
	Status string `json:"status"` // pending | running | success | skipped | error
	Detail string `json:"detail,omitempty"`
}

// NodeSSHProvisionTask tracks one automatic SSH install run, polled by the frontend.
type NodeSSHProvisionTask struct {
	ID          string              `json:"id"`
	NodeId      int                 `json:"nodeId"`
	Status      string              `json:"status"` // running | success | error
	Steps       []NodeProvisionStep `json:"steps"`
	Error       string              `json:"error,omitempty"`
	CreatedAtMs int64               `json:"createdAtMs"`
	UpdatedAtMs int64               `json:"updatedAtMs"`
}

// NodeSSHProvisionRequest is the (never-persisted) input for one automatic install run.
type NodeSSHProvisionRequest struct {
	NodeId               int
	Host                 string
	Port                 int
	Username             string
	AuthMethod           string // "password" | "key"
	Password             string
	PrivateKeyPem        string
	PrivateKeyPassphrase string
	SecretKey            string // panel-wide pairing SECRET_KEY to bake into the compose file
	InstallDir           string // remote directory for docker-compose.yml; defaults to /opt/sharxnode
	// WatchtowerPort is the loopback port the node's local Watchtower sidecar publishes to
	// (XUI_DOCKER_UPDATER_URL points at it). Defaults to 8081, but the target server may already
	// have something bound there (observed live: an unrelated nginx on a shared box) — letting
	// the admin override it avoids a predictable docker-compose port conflict on compose_up.
	WatchtowerPort int
}

const nodeSSHProvisionDefaultInstallDir = "/opt/sharxnode"
const nodeSSHProvisionDefaultWatchtowerPort = 8081

const nodeProvisionDockerImage = "harbor.sharxconnect.app/sharx/sharxnode:latest"

// buildNodeDockerComposeYaml mirrors panel/components/NodesPage.tsx's buildNodeDockerComposeYaml
// (same content, modulo Go/TS string interpolation) when watchtowerPort is the default 8081 — the
// manual copy-paste flow always uses that fixed port. The automatic (SSH) flow additionally
// supports overriding it, since a target server can already have something bound to 127.0.0.1:8081
// (observed live: an unrelated nginx on a shared box), which would otherwise fail docker-compose
// up with a generic port-in-use error the admin has no way to work around from the wizard.
func buildNodeDockerComposeYaml(secretKey string, watchtowerPort int) string {
	if watchtowerPort <= 0 {
		watchtowerPort = nodeSSHProvisionDefaultWatchtowerPort
	}
	return fmt.Sprintf(`services:
  node:
    image: %s
    container_name: sharx-node
    restart: unless-stopped
    labels:
      com.centurylinklabs.watchtower.enable: "true"
    cap_add: [NET_ADMIN]
    devices:
      - /dev/net/tun:/dev/net/tun
    network_mode: host
    volumes:
      - sharx-node-bin:/app/bin
      - sharx-node-logs:/app/logs
      - sharx-node-cert:/app/cert
      - sharx-node-data:/app/data
    environment:
      SECRET_KEY: %s
      XUI_DOCKER_UPDATER_URL: http://127.0.0.1:%d/v1/update
      XUI_DOCKER_UPDATER_TOKEN: ${WATCHTOWER_HTTP_API_TOKEN:-local-dev-insecure-watchtower-token}

  watchtower:
    image: beatkind/watchtower:2.3.2
    container_name: sharx_node_watchtower
    restart: unless-stopped
    ports:
      - "127.0.0.1:%d:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command:
      - --http-api-update
    environment:
      WATCHTOWER_HTTP_API_TOKEN: ${WATCHTOWER_HTTP_API_TOKEN:-local-dev-insecure-watchtower-token}
      WATCHTOWER_LABEL_ENABLE: "true"
      WATCHTOWER_CLEANUP: "true"
    labels:
      com.centurylinklabs.watchtower.enable: "false"
    networks:
      - sharx_node_net

networks:
  sharx_node_net:
    driver: bridge

volumes:
  sharx-node-bin:
  sharx-node-logs:
  sharx-node-cert:
  sharx-node-data:
`, nodeProvisionDockerImage, strconv.Quote(secretKey), watchtowerPort, watchtowerPort)
}

// ---- task store (in-memory; mirrors ServerService's geofileTasks pattern) ----

func (s *NodeService) initSSHProvisionTasksIfNeeded() {
	s.sshProvisionMu.Lock()
	defer s.sshProvisionMu.Unlock()
	if s.sshProvisionTasks == nil {
		s.sshProvisionTasks = make(map[string]*NodeSSHProvisionTask)
	}
}

func (s *NodeService) setSSHProvisionTask(task *NodeSSHProvisionTask) {
	s.sshProvisionMu.Lock()
	defer s.sshProvisionMu.Unlock()
	if s.sshProvisionTasks == nil {
		s.sshProvisionTasks = make(map[string]*NodeSSHProvisionTask)
	}
	s.sshProvisionTasks[task.ID] = task
}

// GetSSHProvisionTask returns the current progress of an automatic-install run.
func (s *NodeService) GetSSHProvisionTask(taskID string) *NodeSSHProvisionTask {
	s.sshProvisionMu.Lock()
	defer s.sshProvisionMu.Unlock()
	task := s.sshProvisionTasks[taskID]
	if task == nil {
		return nil
	}
	// Return a shallow copy so callers can't mutate task state through the map.
	cp := *task
	cp.Steps = append([]NodeProvisionStep(nil), task.Steps...)
	return &cp
}

func (s *NodeService) updateSSHProvisionTask(taskID string, fn func(*NodeSSHProvisionTask)) {
	s.sshProvisionMu.Lock()
	defer s.sshProvisionMu.Unlock()
	task := s.sshProvisionTasks[taskID]
	if task == nil {
		return
	}
	fn(task)
	task.UpdatedAtMs = time.Now().UnixMilli()
}

func newNodeProvisionSteps() []NodeProvisionStep {
	steps := make([]NodeProvisionStep, 0, len(nodeProvisionStepOrder))
	for _, k := range nodeProvisionStepOrder {
		steps = append(steps, NodeProvisionStep{Key: string(k), Status: "pending"})
	}
	return steps
}

func (t *NodeSSHProvisionTask) setStep(key NodeProvisionStepKey, status, detail string) {
	for i := range t.Steps {
		if t.Steps[i].Key == string(key) {
			t.Steps[i].Status = status
			t.Steps[i].Detail = detail
			return
		}
	}
}

// StartNodeSSHProvision validates the request, creates a task, and runs the install in the
// background. Returns the task ID immediately for the frontend to poll.
func (s *NodeService) StartNodeSSHProvision(req NodeSSHProvisionRequest) (string, error) {
	s.initSSHProvisionTasksIfNeeded()

	host := strings.TrimSpace(req.Host)
	if host == "" {
		return "", fmt.Errorf("SSH host is required")
	}
	if req.Port <= 0 || req.Port > 65535 {
		req.Port = 22
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		username = "root"
	}
	switch req.AuthMethod {
	case "password":
		if req.Password == "" {
			return "", fmt.Errorf("SSH password is required")
		}
	case "key":
		if strings.TrimSpace(req.PrivateKeyPem) == "" {
			return "", fmt.Errorf("SSH private key is required")
		}
	default:
		return "", fmt.Errorf("invalid SSH auth method: %q", req.AuthMethod)
	}
	if strings.TrimSpace(req.SecretKey) == "" {
		return "", fmt.Errorf("panel pairing secret key is required")
	}
	installDir := strings.TrimSpace(req.InstallDir)
	if installDir == "" {
		installDir = nodeSSHProvisionDefaultInstallDir
	}
	if req.WatchtowerPort <= 0 || req.WatchtowerPort > 65535 {
		req.WatchtowerPort = nodeSSHProvisionDefaultWatchtowerPort
	}
	req.Host = host
	req.Username = username
	req.InstallDir = installDir

	taskID := fmt.Sprintf("nodessh-%d-%d", req.NodeId, time.Now().UnixNano())
	now := time.Now().UnixMilli()
	task := &NodeSSHProvisionTask{
		ID:          taskID,
		NodeId:      req.NodeId,
		Status:      "running",
		Steps:       newNodeProvisionSteps(),
		CreatedAtMs: now,
		UpdatedAtMs: now,
	}
	s.setSSHProvisionTask(task)

	go s.runNodeSSHProvision(taskID, req)

	return taskID, nil
}

func (s *NodeService) runNodeSSHProvision(taskID string, req NodeSSHProvisionRequest) {
	fail := func(step NodeProvisionStepKey, err error) {
		logger.Warningf("SSH node provision %s: step %s failed: %v", taskID, step, err)
		s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) {
			t.setStep(step, "error", err.Error())
			t.Status = "error"
			t.Error = fmt.Sprintf("%s: %v", step, err)
		})
	}

	// --- connect ---
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) { t.setStep(NodeProvisionStepConnect, "running", "") })
	client, err := dialNodeSSH(req)
	if err != nil {
		fail(NodeProvisionStepConnect, err)
		return
	}
	defer client.Close()
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) { t.setStep(NodeProvisionStepConnect, "success", "") })

	// --- check docker ---
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) { t.setStep(NodeProvisionStepCheckDocker, "running", "") })
	hasDocker, err := sshCommandOK(client, "docker version >/dev/null 2>&1 && docker compose version >/dev/null 2>&1")
	if err != nil {
		fail(NodeProvisionStepCheckDocker, err)
		return
	}
	if hasDocker {
		s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) {
			t.setStep(NodeProvisionStepCheckDocker, "success", "Docker already installed")
			t.setStep(NodeProvisionStepInstallDocker, "skipped", "")
		})
	} else {
		s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) {
			t.setStep(NodeProvisionStepCheckDocker, "success", "Docker not found, installing")
			t.setStep(NodeProvisionStepInstallDocker, "running", "")
		})
		out, err := sshRunCombined(client, 10*time.Minute,
			"curl -fsSL https://get.docker.com | sh && systemctl enable --now docker")
		if err != nil {
			fail(NodeProvisionStepInstallDocker, fmt.Errorf("%v: %s", err, truncateForError(out)))
			return
		}
		s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) { t.setStep(NodeProvisionStepInstallDocker, "success", "") })
	}

	// --- write compose ---
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) { t.setStep(NodeProvisionStepWriteCompose, "running", "") })
	compose := buildNodeDockerComposeYaml(req.SecretKey, req.WatchtowerPort)
	encoded := base64.StdEncoding.EncodeToString([]byte(compose))
	writeCmd := fmt.Sprintf(
		"mkdir -p %s && echo %s | base64 -d > %s/docker-compose.yml",
		shellQuote(req.InstallDir), encoded, shellQuote(req.InstallDir),
	)
	if out, err := sshRunCombined(client, 30*time.Second, writeCmd); err != nil {
		fail(NodeProvisionStepWriteCompose, fmt.Errorf("%v: %s", err, truncateForError(out)))
		return
	}
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) {
		t.setStep(NodeProvisionStepWriteCompose, "success", req.InstallDir+"/docker-compose.yml")
	})

	// --- compose up ---
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) { t.setStep(NodeProvisionStepComposeUp, "running", "") })
	upCmd := fmt.Sprintf("cd %s && docker compose pull && docker compose up -d", shellQuote(req.InstallDir))
	out, err := sshRunCombined(client, 5*time.Minute, upCmd)
	if err != nil {
		fail(NodeProvisionStepComposeUp, fmt.Errorf("%v: %s", err, truncateForError(out)))
		return
	}
	s.updateSSHProvisionTask(taskID, func(t *NodeSSHProvisionTask) {
		t.setStep(NodeProvisionStepComposeUp, "success", "")
		t.Status = "success"
	})
}

func dialNodeSSH(req NodeSSHProvisionRequest) (*ssh.Client, error) {
	var authMethods []ssh.AuthMethod
	switch req.AuthMethod {
	case "password":
		authMethods = append(authMethods, ssh.Password(req.Password))
	case "key":
		var signer ssh.Signer
		var err error
		if req.PrivateKeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(req.PrivateKeyPem), []byte(req.PrivateKeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(req.PrivateKeyPem))
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	config := &ssh.ClientConfig{
		User: req.Username,
		Auth: authMethods,
		// The admin is provisioning a server they just identified by IP themselves (no prior
		// panel<->host relationship to pin a host key against) — same trust-on-first-connect
		// model as running `ssh -o StrictHostKeyChecking=no` by hand for a fresh box.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}
	addr := net.JoinHostPort(req.Host, strconv.Itoa(req.Port))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, err
	}
	return client, nil
}

// sshRunCombined runs one command in a fresh session with a hard timeout, returning combined
// stdout+stderr. Each step gets its own session since a ssh.Client supports many sequential ones.
func sshRunCombined(client *ssh.Client, timeout time.Duration, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("open session: %w", err)
	}
	defer session.Close()

	var buf bytes.Buffer
	session.Stdout = &buf
	session.Stderr = &buf

	done := make(chan error, 1)
	go func() { done <- session.Run(cmd) }()

	select {
	case err := <-done:
		return buf.String(), err
	case <-time.After(timeout):
		_ = session.Signal(ssh.SIGKILL)
		return buf.String(), fmt.Errorf("timed out after %s", timeout)
	}
}

// sshCommandOK runs a command and reports only whether it exited 0 (used for presence checks).
func sshCommandOK(client *ssh.Client, cmd string) (bool, error) {
	_, err := sshRunCombined(client, 20*time.Second, cmd)
	if err == nil {
		return true, nil
	}
	if _, ok := err.(*ssh.ExitError); ok {
		return false, nil
	}
	return false, err
}

// shellQuote wraps a path in single quotes for safe use in a remote shell command, escaping any
// embedded single quotes. Paths here come from panel config (InstallDir), not raw client input.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func truncateForError(s string) string {
	s = strings.TrimSpace(s)
	const max = 500
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
