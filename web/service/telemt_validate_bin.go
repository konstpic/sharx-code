package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	telemtinstall "github.com/konstpic/sharx-code/v2/telemt/install"
)

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// telemtValidateBase is a minimal valid Telemt config the operator's extra parameters are merged
// into for validation. WEB pieces are only added when a web.* key is being set.
const telemtValidateBase = `[general]
use_middle_proxy = false

[server]
port = %d

[access.users]
validate = "0123456789abcdef0123456789abcdef"
`

const telemtValidateWeb = `
[[server.listeners]]
ip = "127.0.0.1"
port = %d
proxy_protocol = false
transport = "web"
web_trusted_proxy_cidrs = ["127.0.0.1/32"]

[web]
enabled = true

[[web.vhosts]]
host = "validate.example.com"
public_addr = "203.0.113.10:443"

[web.vhosts.decoy]
mode = "http_upstream"
upstream = "http://127.0.0.1:80"

[[web.vhosts.profiles]]
user = "validate"
secret_mode = "dd"
`

// validateTelemtParamsWithBinary runs the operator's extra parameters through the real Telemt
// binary's config loader, so a bad value (out of range, wrong relation between two limits, ...)
// is rejected with Telemt's own message when the inbound is saved instead of leaving the process
// unable to start on the node. Only "Config error" results are treated as failures; the binary is
// killed right after startup, and a missing binary (or any non-config failure) is not an error.
func validateTelemtParamsWithBinary(params map[string]json.RawMessage, upstreams []map[string]json.RawMessage) error {
	if len(params) == 0 && len(upstreams) == 0 {
		return nil
	}
	bin := telemtinstall.ResolveBinaryPath()
	if st, err := os.Stat(bin); err != nil || st.IsDir() {
		return nil
	}
	port := 41000 + rand.Intn(20000)
	base := fmt.Sprintf(telemtValidateBase, port)
	for id := range params {
		if strings.HasPrefix(id, "web.") {
			base += fmt.Sprintf(telemtValidateWeb, port+1)
			break
		}
	}
	merged, err := ApplyTelemtExtras(base, params, upstreams)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "telemt-validate-")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(dir)
	cfgPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(cfgPath, []byte(merged), 0o600); err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--data-path", dir, "run", cfgPath)
	out, _ := cmd.CombinedOutput() // killed by the context after startup; exit status is irrelevant
	text := ansiRe.ReplaceAllString(string(out), "")
	for _, line := range strings.Split(text, "\n") {
		if i := strings.Index(line, "Config error:"); i >= 0 {
			msg := strings.TrimSpace(line[i+len("Config error:"):])
			logger.Debugf("telemt validate: %s", msg)
			return fmt.Errorf("telemt config rejected by Telemt: %s", msg)
		}
	}
	return nil
}
