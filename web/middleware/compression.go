package middleware

import (
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// ResponseCompression compresses panel responses, excluding WebSocket upgrades
// and the existing API paths. Connection header tokens are case-insensitive;
// gzip must never finalize a response after a WebSocket has hijacked it.
func ResponseCompression(basePath string) gin.HandlerFunc {
	compress := gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{basePath + "panel/api/"}))
	return func(c *gin.Context) {
		if websocket.IsWebSocketUpgrade(c.Request) {
			c.Next()
			return
		}
		compress(c)
	}
}
