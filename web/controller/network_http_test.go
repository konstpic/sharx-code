package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

func networkRequest(t *testing.T, g *gin.Engine, path, kind, body string) struct {
	Success bool            `json:"success"`
	Msg     string          `json:"msg"`
	Obj     json.RawMessage `json:"obj"`
} {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	r.Header.Set("Content-Type", kind)
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	var out struct {
		Success bool            `json:"success"`
		Msg     string          `json:"msg"`
		Obj     json.RawMessage `json:"obj"`
	}
	if w.Code != 200 {
		t.Fatalf("HTTP %d: %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func networkRouter() *gin.Engine {
	g := gin.New()
	g.Use(sessions.Sessions("network-http-tests", cookie.NewStore([]byte("test-only-session-key-32-bytes!!!"))))
	NewNetworkController(g.Group("/network"))
	return g
}

func TestNetworkEnrollmentRejectionIsNotSuccess(t *testing.T) {
	coordinator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		w.Write([]byte(`{"code":"invite_invalid","message":"invite rejected"}`))
	}))
	defer coordinator.Close()
	body, _ := json.Marshal(map[string]string{"coordinatorUrl": coordinator.URL, "inviteCode": "invalid", "name": "test"})
	r := networkRequest(t, networkRouter(), "/network/enroll", "application/json", string(body))
	if r.Success || !strings.Contains(r.Msg, "invite rejected") {
		t.Fatalf("coordinator rejection was hidden: %+v", r)
	}
}

func TestNetworkPublishingAcceptsJSONAndForms(t *testing.T) {
	for _, input := range []struct{ kind, body string }{
		{"application/json", `{"nodeId":7,"label":"test","country":"DE","security":"reality","riskAck":true,"trafficLimitGB":0}`},
		{"application/x-www-form-urlencoded", "nodeId=7&label=test&country=DE&security=reality&riskAck=true&trafficLimitGB=0"},
	} {
		r := networkRequest(t, networkRouter(), "/network/nodes/publish", input.kind, input.body)
		if r.Success || !strings.Contains(r.Msg, "traffic limit out of range") {
			t.Fatalf("typed publication fields not decoded for %s: %+v", input.kind, r)
		}
	}
}

func TestNetworkValidationNeverReturnsSuccess(t *testing.T) {
	for _, path := range []string{"/network/leave", "/network/nodes/publish", "/network/nodes/update", "/network/nodes/pause", "/network/nodes/unpublish", "/network/sessions/open", "/network/sessions/close", "/network/sessions/dispute", "/network/enable"} {
		r := networkRequest(t, networkRouter(), path, "application/json", `{}`)
		if r.Success || r.Msg == "" {
			t.Fatalf("%s returned fake success: %+v", path, r)
		}
	}
	r := networkRequest(t, networkRouter(), "/network/nodes/publish", "application/json", `{"nodeId":"not-an-integer"}`)
	if r.Success {
		t.Fatal("malformed JSON types accepted")
	}
}

func TestNetworkEnableAndLeaveJSON(t *testing.T) {
	db := testdb.New(t)
	p := model.SnParticipant{Id: 1, ParticipantID: "participant-test", Status: "active", Enabled: false}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	g := networkRouter()
	r := networkRequest(t, g, "/network/enable", "application/json", `{"enabled":true}`)
	if !r.Success {
		t.Fatalf("enable failed: %s", r.Msg)
	}
	if err := db.First(&p, 1).Error; err != nil || !p.Enabled {
		t.Fatalf("JSON true did not enable participation: %+v %v", p, err)
	}
	r = networkRequest(t, g, "/network/leave", "application/json", `{"confirm":"NO"}`)
	if r.Success {
		t.Fatal("leave accepted without explicit confirmation")
	}
	r = networkRequest(t, g, "/network/leave", "application/json", `{"confirm":"LEAVE"}`)
	if !r.Success {
		t.Fatalf("JSON confirmation was ignored: %s", r.Msg)
	}
	p = model.SnParticipant{}
	if err := db.First(&p, 1).Error; err != nil || p.Enabled || p.ParticipantID != "" {
		t.Fatalf("JSON confirmed leave did not clear membership: %+v %v", p, err)
	}
}
