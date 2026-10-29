package sub

import (
	"encoding/json"
	"testing"
)

func TestApplyXhttpPaddingParamsCarriesUplinkMethod(t *testing.T) {
	xh := map[string]any{
		"uplinkHTTPMethod": "GET", "xPaddingBytes": "100-1000", "xPaddingObfsMode": true,
		"xPaddingKey": "_dc", "xPaddingHeader": "X-Cache", "xPaddingPlacement": "queryInHeader", "xPaddingMethod": "tokenish",
		"sessionPlacement": "header", "uplinkChunkSize": float64(4096),
	}
	params := map[string]string{}
	applyXhttpPaddingParams(xh, params)
	var extra map[string]any
	if err := json.Unmarshal([]byte(params["extra"]), &extra); err != nil {
		t.Fatalf("extra: %v (%q)", err, params["extra"])
	}
	for k, want := range map[string]any{"uplinkHTTPMethod": "GET", "xPaddingHeader": "X-Cache", "xPaddingMethod": "tokenish", "sessionIDPlacement": "header", "uplinkChunkSize": float64(4096)} {
		if extra[k] != want {
			t.Errorf("extra[%s] = %v, want %v", k, extra[k], want)
		}
	}
}

func TestApplyXhttpPaddingParamsUnchangedWithoutNewFields(t *testing.T) {
	params := map[string]string{}
	applyXhttpPaddingParams(map[string]any{"xPaddingBytes": "100-1000", "uplinkHTTPMethod": "", "uplinkChunkSize": float64(0)}, params)
	if params["extra"] != `{"xPaddingBytes":"100-1000"}` {
		t.Errorf("extra = %q", params["extra"])
	}
}

func TestApplyXhttpPaddingParamsCarriesXmuxAndMinInterval(t *testing.T) {
	xh := map[string]any{
		"scMinPostsIntervalMs": "10-50", "serverMaxHeaderBytes": float64(16384),
		"xmux": map[string]any{"maxConcurrency": "16-32", "hKeepAlivePeriod": float64(30)},
	}
	params := map[string]string{}
	applyXhttpPaddingParams(xh, params)
	var extra map[string]any
	if err := json.Unmarshal([]byte(params["extra"]), &extra); err != nil {
		t.Fatalf("extra: %v", err)
	}
	if extra["scMinPostsIntervalMs"] != "10-50" {
		t.Errorf("scMinPostsIntervalMs = %v", extra["scMinPostsIntervalMs"])
	}
	if _, leaked := extra["serverMaxHeaderBytes"]; leaked {
		t.Error("serverMaxHeaderBytes is server-only and must not reach client links")
	}
	xm, _ := extra["xmux"].(map[string]any)
	if xm["maxConcurrency"] != "16-32" || xm["hKeepAlivePeriod"] != float64(30) {
		t.Errorf("xmux = %v", xm)
	}
}
