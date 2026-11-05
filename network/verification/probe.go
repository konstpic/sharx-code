package verification

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// Serialize port allocation through listener readiness so simultaneous probes
// cannot choose the same temporarily unbound SOCKS port.
var probeStartup = make(chan struct{}, 1)

// DataPathProbe executes a fresh VLESS client and sends unpredictable bytes to
// the verifier operator's configured HTTPS echo origin. No task chooses the target.
// It verifies reachability and payload integrity, not the claimed customer volume.
type DataPathProbe struct {
	XrayPath        string
	Target          string
	AllowPrivate    bool
	TLSClientConfig *http.Transport
	DebugWriter     io.Writer
}

func (p DataPathProbe) Check(ctx context.Context, link protocol.SessionLink) error {
	target, err := url.Parse(p.Target)
	if err != nil || target.Scheme != "https" || target.Host == "" || target.User != nil {
		return errors.New("probe target must be configured HTTPS origin")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, link.EndpointHost)
	if err != nil {
		return err
	}
	if len(addresses) == 0 {
		return errors.New("node address unresolved")
	}
	for _, a := range addresses {
		if !p.AllowPrivate && (a.IP.IsPrivate() || a.IP.IsLoopback() || a.IP.IsLinkLocalUnicast() || a.IP.IsUnspecified() || a.IP.IsMulticast()) {
			return errors.New("private node endpoints disallowed")
		}
	}
	select {
	case probeStartup <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	startupHeld := true
	defer func() {
		if startupHeld {
			<-probeStartup
		}
	}()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	if link.ProbeUUID == "" {
		return errors.New("missing unbilled probe credential")
	}
	template := link.AccessTemplate
	stream := map[string]any{"network": template.Transport, "security": template.Security}
	user := map[string]any{"id": link.ProbeUUID, "encryption": "none"}
	if template.Security == "reality" {
		if len(template.ShortIDs) == 0 {
			return errors.New("missing Reality short id")
		}
		stream["realitySettings"] = map[string]any{"serverName": template.SNI, "publicKey": template.PublicKey, "shortId": template.ShortIDs[0], "fingerprint": template.Fingerprint}
		user["flow"] = "xtls-rprx-vision"
	} else if template.Security == "tls" {
		stream["tlsSettings"] = map[string]any{"serverName": template.SNI}
	} else {
		return errors.New("unsupported probe security")
	}
	if template.Transport == "ws" {
		stream["wsSettings"] = map[string]any{"path": template.Path, "headers": map[string]any{"Host": template.Host}}
	}
	config := map[string]any{"log": map[string]any{"loglevel": "none"}, "inbounds": []any{map[string]any{"listen": "127.0.0.1", "port": port, "protocol": "socks", "settings": map[string]any{"auth": "noauth", "udp": false}}}, "outbounds": []any{map[string]any{"protocol": "vless", "settings": map[string]any{"vnext": []any{map[string]any{"address": addresses[0].IP.String(), "port": link.EndpointPort, "users": []any{user}}}}, "streamSettings": stream}}}
	if p.DebugWriter != nil {
		config["log"] = map[string]any{"loglevel": "debug"}
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "sharx-verifier-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		return err
	}
	binary := p.XrayPath
	if binary == "" {
		binary = "xray"
	}
	cmd := exec.CommandContext(ctx, binary, "run", "-c", path)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if p.DebugWriter != nil {
		cmd.Stdout = p.DebugWriter
		cmd.Stderr = p.DebugWriter
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	ready := false
	for i := 0; i < 100; i++ {
		connection, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", itoa(port)), 100*time.Millisecond)
		if err == nil {
			connection.Close()
			ready = true
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
	if !ready {
		return errors.New("probe VLESS client did not start")
	}
	<-probeStartup
	startupHeld = false
	challenge := make([]byte, 64*1024)
	if _, err := rand.Read(challenge); err != nil {
		return err
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	query := target.Query()
	query.Set("nonce", hex.EncodeToString(nonce))
	target.RawQuery = query.Encode()
	socks, _ := url.Parse("socks5://127.0.0.1:" + itoa(port))
	transport := &http.Transport{}
	if p.TLSClientConfig != nil {
		transport = p.TLSClientConfig.Clone()
	}
	transport.Proxy = http.ProxyURL(socks)
	defer transport.CloseIdleConnections()
	cl := &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("probe redirects disabled") }}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(challenge))
	if err != nil {
		return err
	}
	resp, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	observed, err := io.ReadAll(io.LimitReader(resp.Body, int64(len(challenge)+1)))
	if err != nil {
		return err
	}
	if resp.StatusCode != 200 || !bytes.Equal(challenge, observed) {
		return errors.New("independent probe payload mismatch")
	}
	return nil
}
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	b := make([]byte, 0, 10)
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
