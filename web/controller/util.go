package controller

import (
	"net/http"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/entity"

	"github.com/gin-gonic/gin"
)

// getRemoteIp returns the client IP. Forwarding headers are honoured only when the request came from a
// trusted reverse proxy (see the engine's trusted proxies), otherwise the socket address is used.
func getRemoteIp(c *gin.Context) string {
	return c.ClientIP()
}

// jsonMsg sends a JSON response with a message and error status.
func jsonMsg(c *gin.Context, msg string, err error) {
	jsonMsgObj(c, msg, nil, err)
}

// jsonObj sends a JSON response with an object and error status.
func jsonObj(c *gin.Context, obj any, err error) {
	jsonMsgObj(c, "", obj, err)
}

// jsonMsgObj sends a JSON response with a message, object, and error status.
func jsonMsgObj(c *gin.Context, msg string, obj any, err error) {
	m := entity.Msg{
		Obj: obj,
	}
	if err == nil {
		m.Success = true
		if msg != "" {
			m.Msg = msg
		}
	} else {
		m.Success = false
		m.Msg = msg + " (" + err.Error() + ")"
		logger.Infof("[DEBUG-AGENT] jsonMsgObj: ERROR response, path=%s, msg=%s, error=%v, errorType=%T", c.Request.URL.Path, msg, err, err)
		logger.Warning(msg+" "+I18nWeb(c, "fail")+": ", err)
	}
	c.JSON(http.StatusOK, m)
}

// pureJsonMsg sends a pure JSON message response with custom status code.
func pureJsonMsg(c *gin.Context, statusCode int, success bool, msg string) {
	c.JSON(statusCode, entity.Msg{
		Success: success,
		Msg:     msg,
	})
}

// isAjax checks if the request is an AJAX request.
func isAjax(c *gin.Context) bool {
	return c.GetHeader("X-Requested-With") == "XMLHttpRequest"
}
