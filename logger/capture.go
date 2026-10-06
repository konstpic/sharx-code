package logger

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
)

// Scoped emits entries with a fixed Component (and optional entity), so a package does not repeat it on every call.
type Scoped struct {
	base Entry
}

// WithComponent returns a Scoped logger that tags entries with the component (xray, amneziawg, telemt, routing, ...).
func WithComponent(component string) *Scoped {
	return &Scoped{base: Entry{Component: component}}
}

// ForEntity returns a copy tagged with the panel entity the entries are about.
func (s *Scoped) ForEntity(entityType, entityID string) *Scoped {
	c := *s
	c.base.EntityType, c.base.EntityID = entityType, entityID
	return &c
}

func (s *Scoped) emit(level, msg string) {
	e := s.base
	e.Level, e.Msg = level, msg
	Emit(e)
}

func (s *Scoped) Debugf(format string, args ...any)   { s.emit("debug", sprintf(format, args)) }
func (s *Scoped) Infof(format string, args ...any)    { s.emit("info", sprintf(format, args)) }
func (s *Scoped) Warningf(format string, args ...any) { s.emit("warn", sprintf(format, args)) }
func (s *Scoped) Errorf(format string, args ...any)   { s.emit("error", sprintf(format, args)) }

// LevelFromLine guesses the severity of a line printed by a child process (amneziawg-go, telemt, haproxy, nginx).
func LevelFromLine(line string) string {
	l := strings.ToLower(line)
	switch {
	case strings.Contains(l, "panic") || strings.Contains(l, "fatal") || strings.Contains(l, "[emerg]") ||
		strings.Contains(l, "[crit]") || strings.Contains(l, "[alert]") || strings.Contains(l, "error") || strings.Contains(l, "[error]"):
		return "error"
	case strings.Contains(l, "warn") || strings.Contains(l, "[warning]") || strings.Contains(l, "failed") || strings.Contains(l, "timeout"):
		return "warn"
	case strings.Contains(l, "debug") || strings.Contains(l, "[debug]"):
		return "debug"
	default:
		return "info"
	}
}

// CaptureOutput makes cmd's stdout and stderr flow into the log as entries built from base, in addition to being
// mirrored to the process's own stderr (so `docker logs` still shows everything). Call before cmd.Start(). The returned
// func must be called after cmd.Wait() (or when Start failed): it flushes the last lines and stops the reader.
func CaptureOutput(cmd *exec.Cmd, base Entry) (finish func()) {
	return CaptureOutputFunc(cmd, base, nil)
}

// CaptureOutputFunc is CaptureOutput with a per-line classifier (see PipeLines).
func CaptureOutputFunc(cmd *exec.Cmd, base Entry, classify func(line string, e *Entry) bool) (finish func()) {
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	done := make(chan struct{})
	go func() {
		defer close(done)
		PipeLines(pr, os.Stderr, base, classify)
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			_ = pw.Close()
			<-done
		})
	}
}

// PipeLines reads lines from r, mirrors them to mirror (when not nil) and emits each as an entry built from base.
// classify may override the entry for a line (set Level, Msg, ConnID, ...); returning false drops the line from the log
// (it is still mirrored).
func PipeLines(r io.Reader, mirror io.Writer, base Entry, classify func(line string, e *Entry) bool) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		raw := strings.TrimRight(sc.Text(), "\r")
		if mirror != nil {
			_, _ = mirror.Write([]byte(raw + "\n"))
		}
		line := StripANSI(raw) // colour codes are for terminals, not for the journal
		if strings.TrimSpace(line) == "" {
			continue
		}
		e := base
		e.Msg = line
		e.Level = LevelFromLine(line)
		if classify != nil && !classify(line, &e) {
			continue
		}
		Emit(e)
	}
}

func sprintf(format string, args []any) string { return fmt.Sprintf(format, args...) }

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// ansiLostEsc matches colour codes whose ESC byte was dropped on the way (JSON transport, terminals): "[2m", "[0m", "[32m".
var ansiLostEsc = regexp.MustCompile(`\[(?:[0-9]{1,3};?)+m`)

// StripANSI removes terminal colour codes, also when the leading ESC byte is already gone.
func StripANSI(s string) string {
	return ansiLostEsc.ReplaceAllString(ansiRe.ReplaceAllString(s, ""), "")
}
