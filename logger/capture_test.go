package logger

import (
	"os/exec"
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
