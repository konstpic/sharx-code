package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"net/http/httptest"
	"testing"
)

func TestTrafficHistoryParams(t *testing.T) {
	for _, tc := range []struct {
		id, query string
		want      int
		valid     bool
	}{
		{"1", "", 60, true}, {"2", "?minutes=15", 15, true}, {"2", "?minutes=360", 360, true}, {"2", "?minutes=1440", 1440, true},
		{"0", "", 0, false}, {"-1", "", 0, false}, {"bad", "", 0, false}, {"1", "?minutes=1", 0, false}, {"1", "?minutes=bad", 0, false},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Params = gin.Params{{Key: "id", Value: tc.id}}
		c.Request = httptest.NewRequest("GET", "/history"+tc.query, nil)
		_, minutes, err := trafficHistoryParams(c)
		if (err == nil) != tc.valid || (tc.valid && minutes != tc.want) {
			t.Fatalf("%+v -> %d %v", tc, minutes, err)
		}
	}
}
func TestTrafficHistoryRequiresReadPermission(t *testing.T) {
	for route, permission := range map[string]string{"/panel/client/traffic-history/:id": rbac.ClientsRead, "/panel/node/traffic-history/:id": rbac.NodesRead} {
		reqs, _ := rbac.Lookup("GET", route)
		if len(reqs) != 1 || reqs[0] != permission {
			t.Fatalf("%s permissions: %v", route, reqs)
		}
	}
}

func TestTrafficHistoryAbsoluteRange(t *testing.T) {
	for _, tc := range []struct {
		query string
		valid bool
	}{
		{"", true}, {"?from=1700000000000&to=1700003600000", true},
		{"?from=1700000000000", false}, {"?from=bad&to=1700003600000", false},
		{"?from=1700003600000&to=1700000000000", false},
		{"?from=1&to=999999999999999", false},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/history"+tc.query, nil)
		r, err := trafficHistoryAbsolute(c)
		if (err == nil) != tc.valid {
			t.Fatalf("%s: %v", tc.query, err)
		}
		if err == nil && len(r) > 0 && (r[0].From != 1700000000000 || r[0].To != 1700003600000) {
			t.Fatal(r)
		}
	}
}
