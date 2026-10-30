package middleware

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func TestResponseCompressionWebSocketDoesNotWriteAfterHijack(t *testing.T) {
	for _, connection := range []string{"upgrade", "Upgrade", "keep-alive, UpGrAdE"} {
		t.Run(connection, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.Use(ResponseCompression("/"))
			router.GET("/ws", func(c *gin.Context) {
				conn, err := (&websocket.Upgrader{}).Upgrade(c.Writer, c.Request, nil)
				if err != nil {
					t.Errorf("upgrade: %v", err)
					return
				}
				defer conn.Close()
			})
			var serverLog bytes.Buffer
			done := make(chan struct{})
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				router.ServeHTTP(w, r)
				close(done)
			}))
			server.Config.ErrorLog = log.New(&serverLog, "", 0)
			server.Start()
			defer server.Close()
			conn, err := net.DialTimeout("tcp", server.Listener.Addr().String(), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
			_, err = fmt.Fprintf(conn, "GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: %s\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nAccept-Encoding: gzip, deflate\r\n\r\n", connection)
			if err != nil {
				t.Fatal(err)
			}
			response, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodGet})
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusSwitchingProtocols {
				t.Fatalf("status %d", response.StatusCode)
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("handler did not return")
			}
			if text := serverLog.String(); text != "" {
				t.Fatalf("unexpected server error: %s", text)
			}
		})
	}
}

func TestResponseCompressionOrdinaryHTTPStillCompresses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(ResponseCompression("/"))
	body := strings.Repeat("panel response ", 100)
	router.GET("/", func(c *gin.Context) { c.String(http.StatusOK, body) })
	for _, acceptsGzip := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		if acceptsGzip {
			request.Header.Set("Accept-Encoding", "gzip")
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status %d", response.Code)
		}
		var reader io.Reader = response.Body
		if acceptsGzip {
			if response.Header().Get("Content-Encoding") != "gzip" {
				t.Fatal("missing gzip")
			}
			compressed, err := gzip.NewReader(reader)
			if err != nil {
				t.Fatal(err)
			}
			defer compressed.Close()
			reader = compressed
		} else if response.Header().Get("Content-Encoding") != "" {
			t.Fatal("unexpected compression")
		}
		data, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != body {
			t.Fatal("body changed")
		}
	}
}

func TestResponseCompressionPreservesAPIExclusion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(ResponseCompression("/secret/"))
	router.GET("/secret/panel/api/data", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	request := httptest.NewRequest(http.MethodGet, "/secret/panel/api/data", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Encoding") != "" {
		t.Fatal("API compression exclusion changed")
	}
	if !strings.Contains(response.Body.String(), "true") {
		t.Fatal("API body changed")
	}
}
