package verification

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"github.com/google/uuid"
	"github.com/konstpic/sharx-code/v2/network/protocol"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestRealVLESSDataPathProbe(t *testing.T) {
	binary := os.Getenv("SHARX_TEST_XRAY")
	if binary == "" {
		t.Skip("requires real Linux xray binary")
	}
	echo := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Logf("echo reached, contentLength=%d", r.ContentLength)
		data, readErr := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		t.Logf("echo received %d bytes, error %v", len(data), readErr)
		_, _ = w.Write(data)
	}))
	echo.Listener.Close()
	probeIP := os.Getenv("SHARX_TEST_PROBE_IP")
	if probeIP == "" {
		probeIP = "93.184.216.34"
	}
	echoListener, listenErr := net.Listen("tcp", net.JoinHostPort(probeIP, "0"))
	if listenErr != nil {
		t.Fatal(listenErr)
	}
	echo.Listener = echoListener
	echo.StartTLS()
	defer echo.Close()
	cert := echo.TLS.Certificates[0]
	keyRaw, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]})
	if err := os.WriteFile(certPath, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyRaw}), 0600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	clientID := uuid.NewString()
	ids := []string{clientID}
	clients := []any{map[string]any{"id": clientID}}
	for i := 1; i < 50; i++ {
		id := uuid.NewString()
		ids = append(ids, id)
		clients = append(clients, map[string]any{"id": id})
	}
	cfg := map[string]any{"log": map[string]any{"loglevel": "none"}, "inbounds": []any{map[string]any{"listen": "127.0.0.1", "port": port, "protocol": "vless", "settings": map[string]any{"decryption": "none", "clients": clients}, "streamSettings": map[string]any{"network": "ws", "security": "tls", "tlsSettings": map[string]any{"certificates": []any{map[string]any{"certificateFile": certPath, "keyFile": keyPath}}}, "wsSettings": map[string]any{"path": "/test"}}}}, "outbounds": []any{map[string]any{"protocol": "freedom"}}}
	raw, _ := json.Marshal(cfg)
	path := filepath.Join(dir, "server.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(binary, "run", "-c", path)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	time.Sleep(300 * time.Millisecond)
	// Root is provided locally by the test, never accepted from a verification task.
	t.Setenv("SSL_CERT_FILE", certPath)
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(certPEM)
	probe := DataPathProbe{XrayPath: binary, Target: echo.URL + "/probe", AllowPrivate: true, TLSClientConfig: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: "example.com", MinVersion: tls.VersionTLS12}}}
	link := protocol.SessionLink{EndpointHost: "127.0.0.1", EndpointPort: port, ClientUUID: uuid.NewString(), ProbeUUID: clientID, AccessTemplate: protocol.AccessTemplate{Security: "tls", Transport: "ws", SNI: "example.com", Path: "/test"}}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := probe.Check(ctx, link); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("SHARX_TEST_LOAD") == "50" {
		var wg sync.WaitGroup
		errs := make(chan error, 50)
		started := time.Now()
		for _, id := range ids {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				sessionLink := link
				sessionLink.ClientUUID = uuid.NewString()
				sessionLink.ProbeUUID = id
				loadCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
				defer cancel()
				if err := probe.Check(loadCtx, sessionLink); err != nil {
					errs <- err
				}
			}(id)
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			t.Error(err)
		}
		t.Logf("50 distinct VLESS clients exchanged independent 64 KiB challenges in %s", time.Since(started))
	}
	probe.AllowPrivate = false
	if err := probe.Check(ctx, link); err == nil {
		t.Fatal("private-endpoint SSRF protection bypassed")
	}
}
