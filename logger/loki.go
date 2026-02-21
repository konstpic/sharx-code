// Package logger provides Loki integration for sending logs to Grafana Loki.
package logger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	lokiBufferSize         = 100                    // Maximum log entries in buffer before sending
	lokiFlushInterval      = 5 * time.Second        // Flush interval for sending logs
	lokiMaxRetries         = 3                      // Maximum retry attempts
	lokiRetryDelay         = 1 * time.Second        // Delay between retries
	lokiCircuitBreakerFail = 5                      // Number of consecutive failures before circuit breaker opens
	lokiCircuitBreakerReset = 30 * time.Second      // Time to wait before attempting to reset circuit breaker
)

// LokiClient handles sending logs to Loki
type LokiClient struct {
	url        string
	httpClient *http.Client
	buffer     []LokiLogEntry
	bufferMu   sync.Mutex
	flushTicker *time.Ticker
	stopCh     chan struct{}
	component  string // Component name: "x-ui", "xray", "node"
	nodeID     string // Node ID for node logs (empty for panel)
	
	// Circuit breaker state
	circuitBreakerMu    sync.RWMutex
	consecutiveFailures int
	circuitOpen         bool
	circuitOpenTime     time.Time
}

// LokiLogEntry represents a single log entry for Loki
type LokiLogEntry struct {
	Timestamp time.Time
	Level     string
	Message   string
	Component string
	NodeID    string
}

// LokiPushRequest represents the Loki push API format
type LokiPushRequest struct {
	Streams []LokiStream `json:"streams"`
}

// LokiStream represents a stream in Loki
type LokiStream struct {
	Stream map[string]string `json:"stream"`
	Values [][]string        `json:"values"`
}

var (
	lokiClient *LokiClient
	lokiMu     sync.RWMutex
)

// InitLokiClient initializes the Loki client with the given URL
func InitLokiClient(url string, component string, nodeID string) error {
	lokiMu.Lock()
	defer lokiMu.Unlock()

	// Stop existing client if any
	if lokiClient != nil {
		lokiClient.Stop()
	}

	if url == "" {
		lokiClient = nil
		return nil
	}

	// Validate URL format
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return fmt.Errorf("invalid Loki URL: must start with http:// or https://")
	}

	client := &LokiClient{
		url:        url,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		buffer:     make([]LokiLogEntry, 0, lokiBufferSize),
		stopCh:     make(chan struct{}),
		component:  component,
		nodeID:     nodeID,
	}

	client.flushTicker = time.NewTicker(lokiFlushInterval)
	go client.flushLoop()

	lokiClient = client
	return nil
}

// Stop stops the Loki client and flushes remaining logs
func (lc *LokiClient) Stop() {
	if lc == nil {
		return
	}

	close(lc.stopCh)
	if lc.flushTicker != nil {
		lc.flushTicker.Stop()
	}

	// Flush remaining logs
	lc.flush()
}

// AddLog adds a log entry to the buffer with optional component and nodeID override
func (lc *LokiClient) AddLog(level string, message string) {
	lc.AddLogWithComponent(level, message, lc.component, lc.nodeID)
}

// AddLogWithComponent adds a log entry to the buffer with specified component and nodeID
func (lc *LokiClient) AddLogWithComponent(level string, message string, component string, nodeID string) {
	if lc == nil {
		return
	}

	// Check circuit breaker - if open, silently drop logs
	lc.circuitBreakerMu.RLock()
	if lc.circuitOpen {
		// Check if enough time has passed to attempt reset
		if time.Since(lc.circuitOpenTime) > lokiCircuitBreakerReset {
			lc.circuitBreakerMu.RUnlock()
			// Try to reset circuit breaker
			lc.circuitBreakerMu.Lock()
			if lc.circuitOpen && time.Since(lc.circuitOpenTime) > lokiCircuitBreakerReset {
				lc.circuitOpen = false
				lc.consecutiveFailures = 0
			}
			lc.circuitBreakerMu.Unlock()
		} else {
			lc.circuitBreakerMu.RUnlock()
			return // Circuit breaker is open, drop log
		}
	} else {
		lc.circuitBreakerMu.RUnlock()
	}

	lc.bufferMu.Lock()
	defer lc.bufferMu.Unlock()

	entry := LokiLogEntry{
		Timestamp: time.Now(),
		Level:     level,
		Message:   message,
		Component: component,
		NodeID:    nodeID,
	}

	lc.buffer = append(lc.buffer, entry)

	// Flush if buffer is full
	if len(lc.buffer) >= lokiBufferSize {
		go lc.flush()
	}
}

// flushLoop periodically flushes the buffer
func (lc *LokiClient) flushLoop() {
	for {
		select {
		case <-lc.flushTicker.C:
			lc.flush()
		case <-lc.stopCh:
			return
		}
	}
}

// flush sends buffered logs to Loki
func (lc *LokiClient) flush() {
	lc.bufferMu.Lock()
	if len(lc.buffer) == 0 {
		lc.bufferMu.Unlock()
		return
	}

	// Copy buffer and clear it
	logs := make([]LokiLogEntry, len(lc.buffer))
	copy(logs, lc.buffer)
	lc.buffer = lc.buffer[:0]
	lc.bufferMu.Unlock()

	// Group logs by stream (level + component + node_id)
	streams := make(map[string]*LokiStream)

	for _, log := range logs {
		// Create stream key from labels
		streamKey := fmt.Sprintf("%s:%s:%s", log.Level, log.Component, log.NodeID)

		stream, exists := streams[streamKey]
		if !exists {
			stream = &LokiStream{
				Stream: map[string]string{
					"level":     log.Level,
					"component": log.Component,
				},
				Values: make([][]string, 0),
			}
			if log.NodeID != "" {
				stream.Stream["node_id"] = log.NodeID
			}
			streams[streamKey] = stream
		}

		// Convert timestamp to nanoseconds (Loki expects nanoseconds since epoch)
		timestamp := fmt.Sprintf("%d", log.Timestamp.UnixNano())
		stream.Values = append(stream.Values, []string{timestamp, log.Message})
	}

	// Convert streams map to array
	streamArray := make([]LokiStream, 0, len(streams))
	for _, stream := range streams {
		streamArray = append(streamArray, *stream)
	}

	if len(streamArray) == 0 {
		return
	}

	// Create push request
	request := LokiPushRequest{
		Streams: streamArray,
	}

	// Marshal to JSON
	jsonData, err := json.Marshal(request)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to marshal Loki request: %v\n", err)
		return
	}

	// Send to Loki with retry
	lc.sendWithRetry(jsonData)
}

// sendWithRetry sends data to Loki with retry logic and circuit breaker
func (lc *LokiClient) sendWithRetry(jsonData []byte) {
	// Check circuit breaker before attempting
	lc.circuitBreakerMu.RLock()
	if lc.circuitOpen {
		lc.circuitBreakerMu.RUnlock()
		return // Circuit breaker is open, don't attempt
	}
	lc.circuitBreakerMu.RUnlock()

	success := false
	for attempt := 0; attempt < lokiMaxRetries; attempt++ {
		// Create request with timeout context
		req, err := http.NewRequest("POST", lc.url, bytes.NewBuffer(jsonData))
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to create Loki request: %v\n", err)
			lc.recordFailure()
			return
		}

		req.Header.Set("Content-Type", "application/json")

		// Use httpClient with timeout (already set to 10s)
		resp, err := lc.httpClient.Do(req)
		if err != nil {
			if attempt < lokiMaxRetries-1 {
				time.Sleep(lokiRetryDelay)
				continue
			}
			// All retries failed
			lc.recordFailure()
			return
		}

		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			// Success - reset circuit breaker
			lc.recordSuccess()
			success = true
			return
		}

		if attempt < lokiMaxRetries-1 {
			time.Sleep(lokiRetryDelay)
		} else {
			// All retries failed
			lc.recordFailure()
		}
	}

	if !success {
		lc.recordFailure()
	}
}

// recordSuccess resets the circuit breaker failure count
func (lc *LokiClient) recordSuccess() {
	lc.circuitBreakerMu.Lock()
	defer lc.circuitBreakerMu.Unlock()
	lc.consecutiveFailures = 0
	lc.circuitOpen = false
}

// recordFailure increments failure count and opens circuit breaker if threshold reached
func (lc *LokiClient) recordFailure() {
	lc.circuitBreakerMu.Lock()
	defer lc.circuitBreakerMu.Unlock()
	lc.consecutiveFailures++
	if lc.consecutiveFailures >= lokiCircuitBreakerFail {
		lc.circuitOpen = true
		lc.circuitOpenTime = time.Now()
		fmt.Fprintf(os.Stderr, "Loki circuit breaker opened after %d consecutive failures\n", lokiCircuitBreakerFail)
	}
}

// PushLogToLoki pushes a log to Loki if client is initialized
func PushLogToLoki(level string, message string) {
	PushLogToLokiWithComponent(level, message, "x-ui", "")
}

// PushLogToLokiWithComponent pushes a log to Loki with specified component and node ID
// All logs are routed through the main client buffer to avoid blocking
func PushLogToLokiWithComponent(level string, message string, component string, nodeID string) {
	lokiMu.RLock()
	client := lokiClient
	lokiMu.RUnlock()

	if client != nil {
		// Route through main client buffer with component/nodeID override
		// This is non-blocking and uses the existing async flush mechanism
		client.AddLogWithComponent(level, message, component, nodeID)
	}
}

// StopLokiClient stops the Loki client
func StopLokiClient() {
	lokiMu.Lock()
	defer lokiMu.Unlock()

	if lokiClient != nil {
		lokiClient.Stop()
		lokiClient = nil
	}
}
