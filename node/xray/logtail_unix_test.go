//go:build unix

package xray

import (
	"errors"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// An access log that is a pipe (the node's default is /dev/stderr) must be refused at once, not read.
func TestTailLogLinesRefusesPipe(t *testing.T) {
	p := filepath.Join(t.TempDir(), "access.fifo")
	if err := syscall.Mkfifo(p, 0o600); err != nil {
		t.Skipf("mkfifo: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := tailLogLines(p, 10, "")
		done <- err
	}()
	select {
	case err := <-done:
		if !errors.Is(err, errLogNotFile) {
			t.Fatalf("want errLogNotFile, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("reading a pipe blocked")
	}
}
