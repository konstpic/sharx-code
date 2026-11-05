package api

import (
	"fmt"
	"github.com/gin-gonic/gin"
	nodeConfig "github.com/konstpic/sharx-code/v2/node/config"
	"github.com/konstpic/sharx-code/v2/node/qos"
	"net/http"
	"os"
	"strings"
)

func networkStateDir() string {
	if dir := os.Getenv("SHARX_NODE_DATA_DIR"); dir != "" {
		return dir
	}
	return "/app/data"
}
func (s *Server) applyNetworkQoS(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var spec qos.Spec
	if err := c.ShouldBindJSON(&spec); err != nil {
		c.JSON(400, gin.H{"error": "invalid QoS configuration"})
		return
	}
	if s.networkQoS == nil {
		c.JSON(503, gin.H{"error": "QoS unavailable"})
		return
	}
	if err := s.networkQoS.Apply(c.Request.Context(), spec); err != nil {
		c.JSON(503, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, s.networkQoS.Status())
}
func (s *Server) networkQoSStatus(c *gin.Context) {
	if s.networkQoS == nil {
		c.JSON(503, gin.H{"error": "QoS unavailable"})
		return
	}
	c.JSON(200, s.networkQoS.Status())
}

func (s *Server) revokeNetworkUser(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var req struct {
		Tag   string `json:"inbound_tag"`
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Tag != fmt.Sprintf("sharxnet-%d", nodeConfig.GetConfig().NodeId) || !strings.HasPrefix(req.Email, "sn-") {
		c.JSON(400, gin.H{"error": "invalid network user"})
		return
	}
	port, err := s.xrayManager.NetworkInboundPort(req.Tag)
	if err != nil {
		c.JSON(404, gin.H{"error": "network inbound unavailable"})
		return
	}
	if err := s.xrayManager.RemoveUser(req.Tag, req.Email); err != nil {
		c.JSON(503, gin.H{"error": "network user removal failed"})
		return
	}
	if err := qos.RevokeConnections(c.Request.Context(), port); err != nil {
		c.JSON(503, gin.H{"error": "network connection removal failed"})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}
