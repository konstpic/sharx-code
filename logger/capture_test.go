package logger

import (
	"compress/gzip"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCaptureOutputFlowsIntoJournal(t *testing.T) {
	SetMinEmitLevel("debug")
	cmd := exec.Command("sh", "-c", `echo "starting up"; echo "ERROR: handshake failed" >&2; echo "warn: slow peer"`)
	finish := CaptureOutput(cmd, Entry{Source: "node", Component: "capturetest", EntityType: "node", EntityID: "42"})
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	finish()
	got := GetEntries(0, "debug", func(e Entry) bool { return e.Component == "capturetest" })
	if len(got) != 3 {
		t.Fatalf("want 3 captured lines, got %+v", got)
	}
	levels := map[string]string{}
	for _, e := range got {
		if e.EntityType != "node" || e.EntityID != "42" || e.Source != "node" {
			t.Fatalf("entity tags lost: %+v", e)
		}
		levels[e.Msg] = e.Level
	}
	if levels["starting up"] != "info" || levels["ERROR: handshake failed"] != "error" || levels["warn: slow peer"] != "warn" {
		t.Fatalf("levels: %v", levels)
	}
}

func TestPipeLinesClassifierCanDrop(t *testing.T) {
	SetMinEmitLevel("debug")
	in := strings.NewReader("keep me\ndrop me\n\n")
	PipeLines(in, nil, Entry{Component: "pipetest"}, func(line string, e *Entry) bool { return line != "drop me" })
	got := GetEntries(0, "debug", func(e Entry) bool { return e.Component == "pipetest" })
	if len(got) != 1 || got[0].Msg != "keep me" {
		t.Fatalf("%+v", got)
	}
}

func TestScopedLoggerCarriesEntity(t *testing.T) {
	SetMinEmitLevel("debug")
	WithComponent("scopedtest").ForEntity("balancer", "9").Warningf("backend %s down", "n1")
	got := GetEntries(0, "debug", func(e Entry) bool { return e.Component == "scopedtest" })
	if len(got) != 1 || got[0].EntityType != "balancer" || got[0].EntityID != "9" || got[0].Level != "warn" || got[0].Msg != "backend n1 down" {
		t.Fatalf("%+v", got)
	}
}

func TestPipeLinesStripsANSI(t *testing.T) {
	SetMinEmitLevel("debug")
	PipeLines(strings.NewReader("\x1b[2m2026-10-06T19:24:58Z\x1b[0m \x1b[32m INFO\x1b[0m telemt::x: hello\n"), nil, Entry{Component: "ansitest"}, nil)
	got := GetEntries(0, "debug", func(e Entry) bool { return e.Component == "ansitest" })
	if len(got) != 1 || strings.Contains(got[0].Msg, "\x1b") || !strings.Contains(got[0].Msg, "telemt::x: hello") {
		t.Fatalf("%+v", got)
	}
}

func writeLines(t *testing.T, path string, from, to int, appendMode bool) {
	t.Helper()
	flag := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if appendMode {
		flag = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	f, err := os.OpenFile(path, flag, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for i := from; i < to; i++ {
		fmt.Fprintf(f, `{"ts":"2026/10/06 10:00:00","tsUnixMs":%d,"level":"info","source":"panel","msg":"line %d"}`+"\n", 1000+i, i)
	}
}

func TestReadEntriesIsIncrementalAndSurvivesRotation(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XUI_LOG_FOLDER", dir)
	live = liveFile{} // fresh cache for the test
	path := filepath.Join(dir, "sharx.log")

	writeLines(t, path, 0, 1000, false)
	if got := ReadEntries(1000 + 500); len(got) != 1000 || got[0].Msg != "line 0" || got[999].Msg != "line 999" {
		t.Fatalf("whole file, oldest first: %d", len(got))
	}
	// only the appended lines are parsed next time; a half-written last line waits for its newline
	writeLines(t, path, 1000, 1010, true)
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString(`{"ts":"2026/10/06 10:00:00","tsUnixMs":99999,"level":"info","source":"panel","ms`)
	f.Close()
	if got := ReadEntries(1000 + 5); len(got) != 1010 {
		t.Fatalf("append: %d", len(got))
	}
	f, _ = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString("g\":\"late\"}\n")
	f.Close()
	if got := ReadEntries(1000 + 5); len(got) != 1011 || got[1010].Msg != "late" {
		t.Fatalf("completed line: %d", len(got))
	}
	// rotation: the file starts over (shorter than what was read), the old lines move to a gzip archive
	gz := filepath.Join(dir, "sharx-2026-10-06T12-00-00.000.log.gz")
	old, _ := os.ReadFile(path)
	zf, _ := os.Create(gz)
	zw := gzip.NewWriter(zf)
	zw.Write(old)
	zw.Close()
	zf.Close()
	writeLines(t, path, 2000, 2005, false)
	if got := ReadEntries(1000 + 2000); len(got) != 5 || got[0].Msg != "line 2000" {
		t.Fatalf("after rotation the live file alone covers a recent window: %d", len(got))
	}
	all := ReadEntries(0) // "all time" reaches into the archive
	if len(all) != 1011+5 || all[0].Msg != "line 0" || all[len(all)-1].Msg != "line 2004" {
		t.Fatalf("all time = archive + live: %d first=%s", len(all), all[0].Msg)
	}
}
