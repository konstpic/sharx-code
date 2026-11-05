package qos

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// RevokeConnections destroys only sockets on the dedicated shared inbound.
// Other shared sessions on that port reconnect; own-client inbounds are untouched.
func RevokeConnections(ctx context.Context, port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("invalid network port")
	}
	output, err := exec.CommandContext(ctx, "ss", "-K", "state", "established", "sport", "=", ":"+strconv.Itoa(port)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("destroy network sockets: %w: %s", err, output)
	}
	remaining, checkErr := exec.CommandContext(ctx, "ss", "-Hnt", "state", "established", "sport", "=", ":"+strconv.Itoa(port)).CombinedOutput()
	if checkErr != nil || len(strings.TrimSpace(string(remaining))) != 0 {
		return fmt.Errorf("kernel did not confirm network socket destruction (CONFIG_INET_DIAG_DESTROY and NET_ADMIN required)")
	}
	return nil
}
