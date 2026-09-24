package service

import (
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func mustGenerateTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test host key: %v", err)
	}
	return key
}

func TestBuildNodeDockerComposeYaml_containsExpectedPieces(t *testing.T) {
	yaml := buildNodeDockerComposeYaml("my-secret-key", 0)
	for _, want := range []string{
		"image: " + nodeProvisionDockerImage,
		"container_name: sharx-node",
		"network_mode: host",
		`SECRET_KEY: "my-secret-key"`,
		"XUI_DOCKER_UPDATER_URL: http://127.0.0.1:8081/v1/update",
		"sharx-node-bin:/app/bin",
		"sharx_node_watchtower",
		`"127.0.0.1:8081:8080"`,
	} {
		if !strings.Contains(yaml, want) {
			t.Errorf("expected compose yaml to contain %q, got:\n%s", want, yaml)
		}
	}
}

func TestBuildNodeDockerComposeYaml_quotesSecretKeySafely(t *testing.T) {
	// A secret key containing a double quote must not break the YAML string.
	yaml := buildNodeDockerComposeYaml(`weird"key`, 0)
	if !strings.Contains(yaml, `SECRET_KEY: "weird\"key"`) {
		t.Fatalf("expected escaped quote in SECRET_KEY, got:\n%s", yaml)
	}
}

// TestBuildNodeDockerComposeYaml_customWatchtowerPort is the regression test for a real port
// conflict found while live-testing the automatic install against a shared server that already
// had an unrelated service bound to 127.0.0.1:8081 (the hardcoded default).
func TestBuildNodeDockerComposeYaml_customWatchtowerPort(t *testing.T) {
	yaml := buildNodeDockerComposeYaml("sk", 8089)
	if strings.Contains(yaml, "8081") {
		t.Fatalf("expected no trace of the default port when overridden, got:\n%s", yaml)
	}
	if !strings.Contains(yaml, "http://127.0.0.1:8089/v1/update") {
		t.Errorf("expected XUI_DOCKER_UPDATER_URL on the overridden port, got:\n%s", yaml)
	}
	if !strings.Contains(yaml, `"127.0.0.1:8089:8080"`) {
		t.Errorf("expected watchtower port mapping on the overridden port, got:\n%s", yaml)
	}
}

func TestBuildNodeDockerComposeYaml_zeroPortFallsBackToDefault(t *testing.T) {
	yaml := buildNodeDockerComposeYaml("sk", 0)
	if !strings.Contains(yaml, "http://127.0.0.1:8081/v1/update") {
		t.Fatalf("expected default port 8081 when unset, got:\n%s", yaml)
	}
}

func TestShellQuote_escapesEmbeddedSingleQuotes(t *testing.T) {
	got := shellQuote("/opt/it's-a-dir")
	want := `'/opt/it'\''s-a-dir'`
	if got != want {
		t.Fatalf("shellQuote(%q) = %q, want %q", "/opt/it's-a-dir", got, want)
	}
}

func TestTruncateForError_leavesShortStringsAlone(t *testing.T) {
	if got := truncateForError("  short  "); got != "short" {
		t.Fatalf("expected trimmed short string unchanged, got %q", got)
	}
}

func TestTruncateForError_truncatesLongOutput(t *testing.T) {
	long := strings.Repeat("a", 1000)
	got := truncateForError(long)
	if len(got) > 505 {
		t.Fatalf("expected truncated output, got length %d", len(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("expected truncation marker, got suffix %q", got[len(got)-10:])
	}
}

func TestNewNodeProvisionSteps_allPendingInFixedOrder(t *testing.T) {
	steps := newNodeProvisionSteps()
	if len(steps) != len(nodeProvisionStepOrder) {
		t.Fatalf("expected %d steps, got %d", len(nodeProvisionStepOrder), len(steps))
	}
	for i, want := range nodeProvisionStepOrder {
		if steps[i].Key != string(want) {
			t.Errorf("step %d: expected key %q, got %q", i, want, steps[i].Key)
		}
		if steps[i].Status != "pending" {
			t.Errorf("step %d: expected pending status, got %q", i, steps[i].Status)
		}
	}
}

func TestSetStep_updatesOnlyMatchingStep(t *testing.T) {
	task := &NodeSSHProvisionTask{Steps: newNodeProvisionSteps()}
	task.setStep(NodeProvisionStepWriteCompose, "success", "/opt/sharxnode/docker-compose.yml")
	for _, s := range task.Steps {
		if s.Key == string(NodeProvisionStepWriteCompose) {
			if s.Status != "success" || s.Detail != "/opt/sharxnode/docker-compose.yml" {
				t.Errorf("write_compose step not updated correctly: %+v", s)
			}
		} else if s.Status != "pending" {
			t.Errorf("unrelated step %s was mutated: %+v", s.Key, s)
		}
	}
}

func TestStartNodeSSHProvision_validatesInput(t *testing.T) {
	svc := &NodeService{}
	cases := []struct {
		name string
		req  NodeSSHProvisionRequest
	}{
		{"missing host", NodeSSHProvisionRequest{AuthMethod: "password", Password: "x", SecretKey: "sk"}},
		{"missing auth method", NodeSSHProvisionRequest{Host: "1.2.3.4", SecretKey: "sk"}},
		{"password method without password", NodeSSHProvisionRequest{Host: "1.2.3.4", AuthMethod: "password", SecretKey: "sk"}},
		{"key method without key", NodeSSHProvisionRequest{Host: "1.2.3.4", AuthMethod: "key", SecretKey: "sk"}},
		{"missing secret key", NodeSSHProvisionRequest{Host: "1.2.3.4", AuthMethod: "password", Password: "x"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.StartNodeSSHProvision(tc.req); err == nil {
				t.Fatalf("expected validation error for %s", tc.name)
			}
		})
	}
}

// --- local in-process SSH server, to exercise the real transport code without a remote host ---

// startTestSSHServer starts a minimal SSH server on 127.0.0.1 accepting the given
// username/password and running any exec request as a local shell command. Returns its address.
func startTestSSHServer(t *testing.T, username, password string) string {
	t.Helper()

	hostKey, err := ssh.NewSignerFromKey(mustGenerateTestKey(t))
	if err != nil {
		t.Fatalf("signer: %v", err)
	}

	config := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if conn.User() == username && string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("auth rejected")
		},
	}
	config.AddHostKey(hostKey)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go handleTestSSHConn(t, conn, config)
		}
	}()

	return listener.Addr().String()
}

func handleTestSSHConn(t *testing.T, nConn net.Conn, config *ssh.ServerConfig) {
	sshConn, chans, reqs, err := ssh.NewServerConn(nConn, config)
	if err != nil {
		return
	}
	defer sshConn.Close()
	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			_ = newChannel.Reject(ssh.UnknownChannelType, "unsupported")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			continue
		}
		go func() {
			defer channel.Close()
			for req := range requests {
				if req.Type != "exec" {
					if req.WantReply {
						_ = req.Reply(false, nil)
					}
					continue
				}
				// exec payload: uint32 length-prefixed command string.
				var payload struct{ Cmd string }
				_ = ssh.Unmarshal(req.Payload, &payload)
				if req.WantReply {
					_ = req.Reply(true, nil)
				}
				exitCode := runTestSSHCommand(payload.Cmd, channel)
				_ = channel.CloseWrite()
				_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{uint32(exitCode)}))
				return
			}
		}()
	}
}

// runTestSSHCommand fakes just enough command handling to exercise our provisioning steps
// without needing a real shell/Docker on the test machine.
func runTestSSHCommand(cmd string, w interface{ Write([]byte) (int, error) }) int {
	switch {
	case strings.Contains(cmd, "docker version"):
		return 1 // simulate "docker not found" so install_docker path is exercised elsewhere
	case strings.Contains(cmd, "exit 1"):
		_, _ = w.Write([]byte("boom"))
		return 1
	default:
		_, _ = w.Write([]byte("ok"))
		return 0
	}
}

func TestSSHRunCombined_capturesOutputAndSuccess(t *testing.T) {
	addr := startTestSSHServer(t, "root", "testpass")
	client := dialTestSSHClient(t, addr, "root", "testpass")
	defer client.Close()

	out, err := sshRunCombined(client, 5*time.Second, "echo hi")
	if err != nil {
		t.Fatalf("sshRunCombined: %v", err)
	}
	if out != "ok" {
		t.Fatalf("expected 'ok' output from test server, got %q", out)
	}
}

func TestSSHRunCombined_reportsNonZeroExit(t *testing.T) {
	addr := startTestSSHServer(t, "root", "testpass")
	client := dialTestSSHClient(t, addr, "root", "testpass")
	defer client.Close()

	_, err := sshRunCombined(client, 5*time.Second, "false; exit 1")
	if err == nil {
		t.Fatal("expected an error for a non-zero exit command")
	}
}

func TestSSHCommandOK_falseOnNonZeroExit(t *testing.T) {
	addr := startTestSSHServer(t, "root", "testpass")
	client := dialTestSSHClient(t, addr, "root", "testpass")
	defer client.Close()

	ok, err := sshCommandOK(client, "docker version >/dev/null 2>&1")
	if err != nil {
		t.Fatalf("sshCommandOK: %v", err)
	}
	if ok {
		t.Fatal("expected docker-not-found simulation to report false")
	}
}

func dialTestSSHClient(t *testing.T, addr, user, pass string) *ssh.Client {
	t.Helper()
	client, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.Password(pass)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	})
	if err != nil {
		t.Fatalf("dial test ssh server: %v", err)
	}
	return client
}

func TestSSHHostKeyPinning(t *testing.T) {
	addr := startTestSSHServer(t, "root", "testpass")
	host, portStr, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(portStr)

	fp, kt, err := ProbeSSHHostKey(host, port)
	if err != nil || !strings.HasPrefix(fp, "SHA256:") || kt == "" {
		t.Fatalf("probe: fp=%q type=%q err=%v", fp, kt, err)
	}
	req := NodeSSHProvisionRequest{Host: host, Port: port, Username: "root", AuthMethod: "password", Password: "testpass"}

	if _, err := dialNodeSSH(req); err == nil {
		t.Fatal("empty fingerprint must be refused")
	}
	req.HostKeyFingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if _, err := dialNodeSSH(req); err == nil {
		t.Fatal("mismatching fingerprint must be refused")
	}
	req.HostKeyFingerprint = fp
	c, err := dialNodeSSH(req)
	if err != nil {
		t.Fatalf("matching fingerprint must connect: %v", err)
	}
	_ = c.Close()
}
