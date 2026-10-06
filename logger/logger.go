// Package logger provides logging functionality for the SharX panel with
// dual-backend logging (console/syslog and file) and buffered log storage for web UI.
package logger

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/op/go-logging"
	"gopkg.in/natefinch/lumberjack.v2"
)

const (
	maxLogBufferSize = 10240                 // Maximum log entries kept in memory
	logFileName      = "sharx.log"           // Log file name
	timeFormat       = "2006/01/02 15:04:05" // Log timestamp format
)

var (
	logger *logging.Logger

	// defaultSource is emitted in every log entry unless overridden.
	// Values: panel|node|xray
	defaultSource = "panel"

	// logBuffer maintains recent log entries in memory for web UI retrieval.
	// It stores structured entries; GetLogs serializes them as NDJSON.
	logBuffer []Entry
	// logBufMu guards logBuffer: entries come from many goroutines (child-process capture, health loops, HTTP handlers).
	logBufMu sync.RWMutex

	// minEmitLevel gates Emit() so debug entries are not forwarded to the
	// in-memory buffer, Loki and the node→panel pusher when the operator
	// configured a higher level. The console/file backends still have their
	// own level (set in InitLogger), this is the user-facing knob.
	minEmitLevel   = levelRank("debug")
	minEmitLevelMu sync.RWMutex
)

// SetMinEmitLevel sets the minimum severity that reaches the in-memory log
// buffer (UI), Loki and the node→panel push pipeline. Anything below this
// level is dropped before any of those sinks see it. Call this from
// settings reload (panel) and from node startup. Empty / unknown levels
// fall back to "info".
func SetMinEmitLevel(level string) {
	level = strings.TrimSpace(strings.ToLower(level))
	if level == "" {
		level = "info"
	}
	minEmitLevelMu.Lock()
	minEmitLevel = levelRank(level)
	minEmitLevelMu.Unlock()
}

// getMinEmitLevel returns the current Emit threshold (read-locked).
func getMinEmitLevel() int {
	minEmitLevelMu.RLock()
	defer minEmitLevelMu.RUnlock()
	return minEmitLevel
}

// Entry is the single-source-of-truth structured log record (NDJSON on disk/wire).
// One Entry must serialize to exactly one JSON object per line.
type Entry struct {
	Ts        string `json:"ts"`
	TsUnixMs  int64  `json:"tsUnixMs,omitempty"`
	Level     string `json:"level"`  // debug|info|warn|error
	Source    string `json:"source"` // panel|node|xray
	Msg       string `json:"msg"`
	NodeID    string `json:"nodeId,omitempty"`
	NodeName  string `json:"nodeName,omitempty"`
	Channel   string `json:"channel,omitempty"`
	Component string `json:"component,omitempty"`
	// EntityType / EntityID tie an entry to the panel object it is about (node, balancer) so the panel can show a
	// per-entity journal. ConnID correlates the lifecycle events of one connection or session.
	EntityType string `json:"entityType,omitempty"`
	EntityID   string `json:"entityId,omitempty"`
	ConnID     string `json:"connId,omitempty"`
}

// SetSource sets the default `source` field for subsequent logs from this process.
// Expected values: panel|node|xray. Unknown values are accepted but discouraged.
func SetSource(source string) {
	source = strings.TrimSpace(strings.ToLower(source))
	if source == "" {
		return
	}
	defaultSource = source
}

// InitLogger initializes dual logging backends: console/syslog and file.
// Console logging uses the specified level, file logging always uses DEBUG level.
// If lokiURL is provided and grafanaEnabled is true, Loki backend will be used instead of file/console.
func InitLogger(level logging.Level) {
	InitLoggerWithLoki(level, "", false, "")
}

// InitLoggerWithLoki initializes logging with optional Loki backend.
// If grafanaEnabled is true and lokiURL is provided, file and console logging will be disabled
// and all logs will be sent to Loki with DEBUG level enabled.
func InitLoggerWithLoki(level logging.Level, lokiURL string, grafanaEnabled bool, nodeID string) {
	newLogger := logging.MustGetLogger("x-ui")
	backends := make([]logging.Backend, 0, 2)

	// Initialize Loki if enabled
	if grafanaEnabled && lokiURL != "" {
		err := InitLokiClient(lokiURL, "x-ui", nodeID)
		if err != nil {
			writeDirect(Entry{
				Level:     "error",
				Source:    defaultSource,
				Msg:       fmt.Sprintf("logger: failed to initialize Loki client: %v", err),
				Component: "loki",
			})
		} else {
			// When Grafana is enabled, disable file and console logging
			// Only use minimal console for critical errors
			if consoleBackend := initDefaultBackend(); consoleBackend != nil {
				leveledBackend := logging.AddModuleLevel(consoleBackend)
				leveledBackend.SetLevel(logging.ERROR, "x-ui") // Only errors to console
				backends = append(backends, leveledBackend)
			}
			// File backend is disabled when Grafana is enabled
		}
	} else {
		// Normal mode: use console and file backends
		// Console/syslog backend with configurable level
		if consoleBackend := initDefaultBackend(); consoleBackend != nil {
			leveledBackend := logging.AddModuleLevel(consoleBackend)
			leveledBackend.SetLevel(level, "x-ui")
			backends = append(backends, leveledBackend)
		}

		// File backend with DEBUG level for comprehensive logging
		if fileBackend := initFileBackend(); fileBackend != nil {
			leveledBackend := logging.AddModuleLevel(fileBackend)
			leveledBackend.SetLevel(logging.DEBUG, "x-ui")
			backends = append(backends, leveledBackend)
		}

		// Stop Loki if it was previously enabled
		StopLokiClient()
	}

	multiBackend := logging.MultiLogger(backends...)
	newLogger.SetBackend(multiBackend)
	logger = newLogger
}

// initDefaultBackend creates the console logging backend.
// We intentionally avoid syslog to keep log lines as machine-parseable NDJSON.
func initDefaultBackend() logging.Backend {
	backend := logging.NewLogBackend(os.Stderr, "", 0)
	return logging.NewBackendFormatter(backend, newFormatter(false))
}

// initFileBackend creates the file logging backend with lumberjack rotation.
func initFileBackend() logging.Backend {
	logDir := config.GetLogFolder()
	if err := os.MkdirAll(logDir, 0o750); err != nil {
		writeDirect(Entry{
			Level:     "error",
			Source:    defaultSource,
			Msg:       fmt.Sprintf("logger: failed to create log folder %s: %v", logDir, err),
			Component: "logger",
		})
		return nil
	}

	logPath := filepath.Join(logDir, logFileName)
	// Read config before acquiring the write lock to avoid a deadlock:
	// newFileRotator calls getRotateConfig which acquires rotateMu.RLock,
	// but we already hold rotateMu.Lock (write), causing reentrant deadlock.
	cfg := getRotateConfig()
	rotateMu.Lock()
	if fileRotator != nil {
		_ = fileRotator.Close()
	}
	fileRotator = &lumberjack.Logger{
		Filename:   logPath,
		MaxSize:    cfg.MaxSizeMB,
		MaxAge:     cfg.MaxAgeDays,
		MaxBackups: cfg.MaxBackups,
		Compress:   cfg.Compress,
	}
	writer := fileRotator
	rotateMu.Unlock()

	backend := logging.NewLogBackend(writer, "", 0)
	return logging.NewBackendFormatter(backend, newFormatter(true))
}

// newFormatter creates a log formatter with optional timestamp.
func newFormatter(withTime bool) logging.Formatter {
	// We emit structured JSON as the log message, so the formatter must not prepend
	// its own timestamp/level, otherwise the log stops being machine-parseable NDJSON.
	//
	// Some backends (e.g. syslog) may add their own metadata regardless; that's fine.
	_ = withTime
	return logging.MustStringFormatter(`%{message}`)
}

// CloseLogger closes the log file and cleans up resources.
// Should be called during application shutdown.
func CloseLogger() {
	rotateMu.Lock()
	defer rotateMu.Unlock()
	if fileRotator != nil {
		_ = fileRotator.Close()
		fileRotator = nil
	}
}

func ensureLogger() {
	if logger != nil {
		return
	}
	// Safe fallback: stderr backend, debug level.
	newLogger := logging.MustGetLogger("x-ui")
	if consoleBackend := initDefaultBackend(); consoleBackend != nil {
		leveledBackend := logging.AddModuleLevel(consoleBackend)
		leveledBackend.SetLevel(logging.DEBUG, "x-ui")
		newLogger.SetBackend(leveledBackend)
	}
	logger = newLogger
}

func normalizeLevel(level string) string {
	l := strings.TrimSpace(strings.ToLower(level))
	switch l {
	case "debug":
		return "debug"
	case "info":
		return "info"
	case "warn", "warning":
		return "warn"
	case "error":
		return "error"
	case "notice":
		return "info"
	default:
		// Best-effort: map unknown to info to avoid dropping logs.
		return "info"
	}
}

func levelRank(level string) int {
	switch normalizeLevel(level) {
	case "debug":
		return 10
	case "info":
		return 20
	case "warn":
		return 30
	case "error":
		return 40
	default:
		return 20
	}
}

func encodeEntry(e Entry) (string, error) {
	b, err := json.Marshal(e)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func writeDirect(e Entry) {
	// Direct JSON write for early init / recursion-sensitive paths.
	if strings.TrimSpace(e.Ts) == "" {
		e.Ts = time.Now().Format(timeFormat)
	}
	if e.TsUnixMs == 0 {
		e.TsUnixMs = time.Now().UnixMilli()
	}
	e.Level = normalizeLevel(e.Level)
	if strings.TrimSpace(e.Source) == "" {
		e.Source = defaultSource
	}
	if b, err := json.Marshal(e); err == nil {
		_, _ = os.Stderr.Write(append(b, '\n'))
		return
	}
	_, _ = os.Stderr.Write([]byte(`{"level":"error","source":"logger","msg":"logger: failed to marshal direct log entry"}` + "\n"))
}

// Emit writes a structured log Entry as one JSON line and adds it to the buffer.
// Level/source are normalized; Ts is set if missing.
//
// Entries below the configured minimum emit level (see SetMinEmitLevel) are
// dropped before any sink (in-memory buffer / Loki / node→panel push).
// Console and file backends use their own level set in InitLogger.
func Emit(e Entry) {
	ensureLogger()

	if strings.TrimSpace(e.Ts) == "" {
		e.Ts = time.Now().Format(timeFormat)
	}
	if e.TsUnixMs == 0 {
		e.TsUnixMs = time.Now().UnixMilli()
	}
	e.Level = normalizeLevel(e.Level)
	if strings.TrimSpace(e.Source) == "" {
		e.Source = defaultSource
	}
	e.Source = strings.ToLower(strings.TrimSpace(e.Source))
	if e.Source == "" {
		e.Source = "panel"
	}

	// User-facing level gate: keeps debug noise out of UI buffer / Loki /
	// node→panel push when the operator picked info/warn/error in settings.
	if levelRank(e.Level) < getMinEmitLevel() {
		return
	}

	line, err := encodeEntry(e)
	if err != nil {
		// Last-resort: log the marshal error as plain text (still a JSON entry).
		fallback := Entry{
			Ts:     time.Now().Format(timeFormat),
			Level:  "error",
			Source: defaultSource,
			Msg:    fmt.Sprintf("logger: failed to marshal entry: %v", err),
		}
		if fb, fbErr := encodeEntry(fallback); fbErr == nil {
			logger.Error(fb)
		} else {
			logger.Error(fallback.Msg)
		}
		return
	}

	switch e.Level {
	case "debug":
		logger.Debug(line)
	case "info":
		logger.Info(line)
	case "warn":
		logger.Warning(line)
	case "error":
		logger.Error(line)
	default:
		logger.Info(line)
	}

	addToBufferEntry(e, line)
}

func addToBufferEntry(e Entry, line string) {
	logBufMu.Lock()
	if len(logBuffer) >= maxLogBufferSize {
		// copy instead of re-slicing the head: a re-slice keeps the dropped entries reachable until the next growth
		copy(logBuffer, logBuffer[1:])
		logBuffer = logBuffer[:len(logBuffer)-1]
	}
	logBuffer = append(logBuffer, e)
	logBufMu.Unlock()

	// Push to Loki if enabled (keep the exact JSON line for consistency).
	PushLogToLokiWithComponent(e.Level, line, e.ComponentOrDefault(), e.NodeID)

	// If running on node, push log to panel in real-time.
	// pushLogToPanel is set by node package if log pusher is initialized.
	pushLogToPanel(line)
}

func (e Entry) ComponentOrDefault() string {
	if strings.TrimSpace(e.Component) != "" {
		return e.Component
	}
	// Preserve previous behavior: panel component is "x-ui".
	// For xray/node, callers should set Component explicitly when needed.
	return "x-ui"
}

// Debug logs a debug message and adds it to the log buffer.
func Debug(args ...any) {
	Emit(Entry{Level: "debug", Msg: fmt.Sprint(args...)})
}

// Debugf logs a formatted debug message and adds it to the log buffer.
func Debugf(format string, args ...any) {
	Emit(Entry{Level: "debug", Msg: fmt.Sprintf(format, args...)})
}

// Info logs an info message and adds it to the log buffer.
func Info(args ...any) {
	Emit(Entry{Level: "info", Msg: fmt.Sprint(args...)})
}

// Infof logs a formatted info message and adds it to the log buffer.
func Infof(format string, args ...any) {
	Emit(Entry{Level: "info", Msg: fmt.Sprintf(format, args...)})
}

// Notice logs a notice message and adds it to the log buffer.
func Notice(args ...any) {
	Emit(Entry{Level: "notice", Msg: fmt.Sprint(args...)})
}

// Noticef logs a formatted notice message and adds it to the log buffer.
func Noticef(format string, args ...any) {
	Emit(Entry{Level: "notice", Msg: fmt.Sprintf(format, args...)})
}

// Warning logs a warning message and adds it to the log buffer.
func Warning(args ...any) {
	Emit(Entry{Level: "warn", Msg: fmt.Sprint(args...)})
}

// Warningf logs a formatted warning message and adds it to the log buffer.
func Warningf(format string, args ...any) {
	Emit(Entry{Level: "warn", Msg: fmt.Sprintf(format, args...)})
}

// Error logs an error message and adds it to the log buffer.
func Error(args ...any) {
	Emit(Entry{Level: "error", Msg: fmt.Sprint(args...)})
}

// Errorf logs a formatted error message and adds it to the log buffer.
func Errorf(format string, args ...any) {
	Emit(Entry{Level: "error", Msg: fmt.Sprintf(format, args...)})
}

// pushLogToPanel pushes a log line to the panel (called from node mode only).
// This function will be implemented in node package to avoid circular dependency.
var pushLogToPanel = func(logLine string) {
	// Default: no-op, will be overridden by node package if available
}

// SetLogPusher sets the function to push logs to panel (called from node package).
func SetLogPusher(pusher func(string)) {
	pushLogToPanel = pusher
}

// GetLogs retrieves up to c log entries from the buffer that are at or below the specified level.
func GetLogs(c int, level string) []string {
	var output []string
	minRank := levelRank(level)

	logBufMu.RLock()
	defer logBufMu.RUnlock()
	for i := len(logBuffer) - 1; i >= 0; i-- {
		if c > 0 && len(output) >= c {
			break
		}
		if levelRank(logBuffer[i].Level) >= minRank {
			if line, err := encodeEntry(logBuffer[i]); err == nil {
				output = append(output, line)
			}
		}
	}
	return output
}

// GetLogsFromFile reads structured NDJSON logs from disk and returns newest-first lines.
// If c <= 0, all matched lines are returned.
func GetLogsFromFile(c int, level string) []string {
	minRank := levelRank(level)
	logPath := filepath.Join(config.GetLogFolder(), logFileName)
	data, err := os.ReadFile(logPath)
	if err != nil || len(data) == 0 {
		return []string{}
	}

	lines := strings.Split(string(data), "\n")
	out := make([]string, 0, len(lines))
	for i := len(lines) - 1; i >= 0; i-- {
		if c > 0 && len(out) >= c {
			break
		}
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}
		if levelRank(e.Level) < minRank {
			continue
		}
		out = append(out, line)
	}
	return out
}

// GetEntries returns up to c buffered entries at or above level that match keep (nil keeps all), oldest first.
// c <= 0 means no limit. It reads the in-memory buffer only (the recent history), copying under the lock.
func GetEntries(c int, level string, keep func(Entry) bool) []Entry {
	minRank := levelRank(level)
	logBufMu.RLock()
	defer logBufMu.RUnlock()
	var out []Entry
	for i := len(logBuffer) - 1; i >= 0; i-- {
		e := logBuffer[i]
		if levelRank(e.Level) < minRank || (keep != nil && !keep(e)) {
			continue
		}
		out = append(out, e)
		if c > 0 && len(out) >= c {
			break
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}
