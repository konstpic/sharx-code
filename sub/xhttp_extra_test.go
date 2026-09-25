package sub

import (
	"encoding/json"
	"testing"
)

func TestApplyXhttpPaddingParamsCarriesUplinkMethod(t *testing.T) {
	xh := map[string]any{
		"uplinkHTTPMethod": "GET", "xPaddingBytes": "100-1000", "xPaddingObfsMode": true,
		"xPaddingKey": "_dc", "xPaddingHeader": "X-Cache", "xPaddingPlacement": "queryInHeader", "xPaddingMethod": "tokenish",
		"sessionPlacement": "path", "uplinkChunkSize": float64(4096),
	}
	params := map[string]string{}
	applyXhttpPaddingParams(xh, params)
	var extra map[string]any
	if err := json.Unmarshal([]byte(params["extra"]), &extra); err != nil {
		t.Fatalf("extra: %v (%q)", err, params["extra"])
	}
	for k, want := range map[string]any{"uplinkHTTPMethod": "GET", "xPaddingHeader": "X-Cache", "xPaddingMethod": "tokenish", "sessionPlacement": "path", "uplinkChunkSize": float64(4096)} {
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
