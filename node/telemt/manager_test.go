package telemt

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/node/nodecache"
)

// commitReplaySnapshot writes to the cache path (if set) as a side effect of a successful
// Apply(); it's exercised directly here (same package) since a full Apply() round-trip needs
// a real telemt binary that isn't available in this sandbox.
func TestCommitReplaySnapshot_WritesCacheFile(t *testing.T) {
	m := NewManager()
	cachePath := filepath.Join(t.TempDir(), "telemt.json")
	m.SetCachePath(cachePath)

	payloads := []Payload{{InboundId: 1, Tag: "tm-a", Toml: "# a"}}
	m.commitReplaySnapshot(payloads)

	fresh := NewManager()
	fresh.SetCachePath(cachePath)
	loaded, ok := fresh.ReplaySnapshotForRestart()
	if ok {
		t.Fatalf("fresh manager should have no in-memory replay snapshot yet, got %v", loaded)
	}
	// LoadAndApplyCache would call Apply() (needs a real telemt binary, unavailable here);
	// instead confirm the cache file itself round-trips via the same nodecache helpers Apply
	// uses internally, proving commitReplaySnapshot actually persisted what we expect.
	var onDisk []Payload
	found, err := nodecache.Load(cachePath, &onDisk)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if !found || len(onDisk) != 1 || onDisk[0].Tag != "tm-a" {
		t.Fatalf("expected cache to contain the applied payload, got found=%v %+v", found, onDisk)
	}
}

func TestLoadAndApplyCache_NoCacheFileIsNoOp(t *testing.T) {
	m := NewManager()
	m.SetCachePath(filepath.Join(t.TempDir(), "does-not-exist.json"))
	if err := m.LoadAndApplyCache(); err != nil {
		t.Fatalf("expected no error when no cache file exists yet, got %v", err)
	}
	if m.RunningCount() != 0 {
		t.Fatalf("expected no sidecars started, got %d", m.RunningCount())
	}
}

func TestLoadAndApplyCache_BlankPathIsNoOp(t *testing.T) {
	m := NewManager() // cachePath left unset
	if err := m.LoadAndApplyCache(); err != nil {
		t.Fatalf("expected no error with no cache path configured, got %v", err)
	}
}

// fakeTelemt writes an executable shell script standing in for the telemt binary. It records each
// start, refuses to start while a previous instance is still alive (like a port conflict), fails
// the first `failFirst` runs, and otherwise runs until killed.
func fakeTelemt(t *testing.T, failFirst int) (bin, dir string) {
	t.Helper()
	dir = t.TempDir()
	bin = filepath.Join(dir, "telemt-fake.sh")
	script := `#!/bin/sh
d="` + dir + `"
echo start >> "$d/starts"
if [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; then echo conflict >> "$d/conflicts"; exit 1; fi
n=$(wc -l < "$d/starts")
if [ "$n" -le ` + strconv.Itoa(failFirst) + ` ]; then exit 1; fi
echo $$ > "$d/pid"
exec sleep 300
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin, dir
}

func countLines(path string) int {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	return strings.Count(string(b), "\n")
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestApplyRestartsAfterUnexpectedExit(t *testing.T) {
	bin, dir := fakeTelemt(t, 2)
	t.Setenv("TELEMT_BIN", bin)
	old := restartDelay
	restartDelay = func(int) time.Duration { return 20 * time.Millisecond }
	defer func() { restartDelay = old }()

	m := NewManager()
	m.SetWorkRoot(t.TempDir())
	defer m.Stop()
	if err := m.Apply([]Payload{{InboundId: 1, Tag: "a", Toml: "# v1"}}); err != nil {
		t.Fatal(err)
	}
	// 2 crashes, then the 3rd start stays up.
	waitFor(t, "third start", func() bool { return countLines(filepath.Join(dir, "starts")) >= 3 })
	waitFor(t, "stable pid", func() bool { _, err := os.Stat(filepath.Join(dir, "pid")); return err == nil })
}

func TestApplyWaitsForOldProcessBeforeStartingReplacement(t *testing.T) {
	bin, dir := fakeTelemt(t, 0)
	t.Setenv("TELEMT_BIN", bin)
	m := NewManager()
	m.SetWorkRoot(t.TempDir())
	defer m.Stop()
	if err := m.Apply([]Payload{{InboundId: 1, Tag: "a", Toml: "# v1"}}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "first instance up", func() bool { _, err := os.Stat(filepath.Join(dir, "pid")); return err == nil })
	// Changed config -> replacement, repeatedly. The fake refuses to start while the old pid is
	// alive, so a start before the old process is gone is recorded as a conflict.
	for i := 2; i <= 12; i++ {
		if err := m.Apply([]Payload{{InboundId: 1, Tag: "a", Toml: "# v" + strconv.Itoa(i)}}); err != nil {
			t.Fatal(err)
		}
	}
	waitFor(t, "an instance up", func() bool {
		b, err := os.ReadFile(filepath.Join(dir, "pid"))
		if err != nil {
			return false
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
		p, _ := os.FindProcess(pid)
		return p != nil && p.Signal(syscall.Signal(0)) == nil
	})
	time.Sleep(200 * time.Millisecond)
	if c := countLines(filepath.Join(dir, "conflicts")); c != 0 {
		t.Fatalf("replacement started while the old process was still alive (%d conflicts)", c)
	}
}

// stopProc must not return before the supervised process is fully gone: that is what keeps a
// replacement from racing the old instance for its listening ports.
func TestStopProcBlocksUntilProcessExited(t *testing.T) {
	done := make(chan struct{})
	cancelled := false
	st := &procState{cancel: func() { cancelled = true }, done: done}
	go func() {
		time.Sleep(150 * time.Millisecond)
		close(done)
	}()
	start := time.Now()
	stopProc("a", st)
	if !cancelled {
		t.Fatal("stopProc must cancel the process")
	}
	if el := time.Since(start); el < 140*time.Millisecond {
		t.Fatalf("stopProc returned after %v, before the process exited", el)
	}
}
