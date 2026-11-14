package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func hy2MultiPortInbound(settings, stream string) *model.Inbound {
	return &model.Inbound{
		Protocol:       model.Hysteria2,
		Id:             77,
		Tag:            "hy2-multiport",
		Port:           443,
		Settings:       settings,
		StreamSettings: stream,
	}
}

func TestApplyHysteriaMultiPortOnSave(t *testing.T) {
	tests := []struct {
		name    string
		inbound *model.Inbound
		wantErr bool
		// wantKey is the expected stored hysteriaMultiPort value; "" means absent.
		wantKey string
	}{
		{
			name:    "valid range normalized",
			inbound: hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","security":"tls","hysteriaMultiPort":" 39640 - 39649 "}`),
			wantKey: "39640-39649",
		},
		{
			name:    "absent stays absent",
			inbound: hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","security":"tls"}`),
			wantKey: "",
		},
		{
			name:    "empty string removed",
			inbound: hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","hysteriaMultiPort":"   "}`),
			wantKey: "",
		},
		{
			name:    "range touching listener rejected",
			inbound: hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","hysteriaMultiPort":"400-450"}`),
			wantErr: true,
		},
		{
			name:    "reversed range rejected",
			inbound: hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","hysteriaMultiPort":"500-400"}`),
			wantErr: true,
		},
		{
			name:    "too many ports rejected",
			inbound: hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","hysteriaMultiPort":"1000-2000"}`),
			wantErr: true,
		},
		{
			name:    "hysteria v1 drops the key",
			inbound: hy2MultiPortInbound(`{"version":1}`, `{"network":"hysteria","hysteriaMultiPort":"39640-39649"}`),
			wantKey: "",
		},
		{
			name: "other protocol drops the key",
			inbound: &model.Inbound{
				Protocol:       model.VLESS,
				Port:           443,
				Settings:       `{}`,
				StreamSettings: `{"network":"tcp","hysteriaMultiPort":"39640-39649"}`,
			},
			wantKey: "",
		},
		{
			name: "malformed stream settings untouched",
			inbound: &model.Inbound{
				Protocol:       model.Hysteria2,
				Port:           443,
				Settings:       `{"version":2}`,
				StreamSettings: `{"network":`,
			},
			wantKey: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := tt.inbound.StreamSettings
			err := ApplyHysteriaMultiPortOnSave(tt.inbound)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				if tt.inbound.StreamSettings != before {
					t.Fatal("rejected save must not rewrite streamSettings")
				}
				return
			}
			var stream map[string]any
			if strings.HasPrefix(tt.inbound.StreamSettings, "{") {
				_ = json.Unmarshal([]byte(tt.inbound.StreamSettings), &stream)
			}
			got, _ := stream["hysteriaMultiPort"].(string)
			if got != tt.wantKey {
				t.Fatalf("stored hysteriaMultiPort = %q, want %q (stream: %s)", got, tt.wantKey, tt.inbound.StreamSettings)
			}
		})
	}
}

// The node / local core must never see the panel-only range, while the stored
// row keeps it for the share link and the NAT intents.
func TestBuildInboundXrayConfigStripsHysteriaMultiPort(t *testing.T) {
	const raw = `{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39649",` +
		`"tlsSettings":{"alpn":["h3"]},"hysteriaSettings":{"version":2,"auth":""}}`
	ib := hy2MultiPortInbound(`{"version":2}`, raw)

	cfg := BuildInboundXrayConfig(ib, "", "")
	if cfg == nil {
		t.Fatal("expected a config")
	}
	if strings.Contains(string(cfg.StreamSettings), "hysteriaMultiPort") {
		t.Fatalf("panel-only key leaked into the Xray config: %s", cfg.StreamSettings)
	}
	var stream map[string]any
	if err := json.Unmarshal(cfg.StreamSettings, &stream); err != nil {
		t.Fatalf("stream settings are not JSON: %v", err)
	}
	if net, _ := stream["network"].(string); net != "hysteria" {
		t.Fatalf("network lost: %v", stream["network"])
	}
	if _, ok := stream["tlsSettings"].(map[string]any); !ok {
		t.Fatalf("tlsSettings lost: %s", cfg.StreamSettings)
	}
	if cfg.Port != 443 {
		t.Fatalf("port = %d, want 443", cfg.Port)
	}
	if ib.StreamSettings != raw {
		t.Fatal("BuildInboundXrayConfig must not mutate the stored inbound")
	}
}

func TestIsHysteriaVersion2(t *testing.T) {
	tests := []struct {
		name     string
		protocol model.Protocol
		settings string
		want     bool
	}{
		{"hysteria2 literal", model.Hysteria2, `{"version":2}`, true},
		{"hysteria v2 by version", model.Hysteria, `{"version":2}`, true},
		{"hysteria without version defaults to v2", model.Hysteria, `{}`, true},
		{"hysteria v1", model.Hysteria, `{"version":1}`, false},
		{"vless", model.VLESS, `{"version":2}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ib := &model.Inbound{Protocol: tt.protocol, Settings: tt.settings}
			if got := IsHysteriaVersion2(ib); got != tt.want {
				t.Fatalf("IsHysteriaVersion2 = %v, want %v", got, tt.want)
			}
		})
	}
	if IsHysteriaVersion2(nil) {
		t.Fatal("nil inbound must not be v2")
	}
}
