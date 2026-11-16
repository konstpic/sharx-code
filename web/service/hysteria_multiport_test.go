package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/util/hysteria"
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

func TestHysteriaMultiPortConflicts(t *testing.T) {
	own := hysteria.MultiPort{Min: 39640, Max: 39649}
	peers := []multiPortPeer{
		{InboundID: 1, Tag: "udp-peer", Port: 39645, UDP: true},
		{InboundID: 2, Tag: "tcp-peer", Port: 39646, UDP: false},
		{InboundID: 3, Tag: "range-peer", Port: 7000, UDP: true, HasRange: true, Range: hysteria.MultiPort{Min: 39648, Max: 39660}},
		{InboundID: 4, Tag: "listener-thief", Port: 444, UDP: true, HasRange: true, Range: hysteria.MultiPort{Min: 400, Max: 450}},
	}
	problems := hysteriaMultiPortConflicts(own, 443, peers)
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, `"udp-peer"`) {
		t.Fatalf("expected a problem for the covered UDP peer, got: %v", problems)
	}
	if strings.Contains(joined, `"tcp-peer"`) {
		t.Fatalf("a TCP-only peer cannot be captured by the UDP REDIRECT, got: %v", problems)
	}
	if !strings.Contains(joined, `"range-peer"`) {
		t.Fatalf("expected an overlap problem for the other range, got: %v", problems)
	}
	if !strings.Contains(joined, `"listener-thief"`) {
		t.Fatalf("expected a problem for the peer range covering our listener, got: %v", problems)
	}
	if got := hysteriaMultiPortConflicts(own, 443, nil); len(got) != 0 {
		t.Fatalf("no peers must mean no problems, got %v", got)
	}
	// A peer on the range owner's own listener is not a conflict.
	if got := hysteriaMultiPortConflicts(own, 443, []multiPortPeer{{InboundID: 5, Port: 443, UDP: true}}); len(got) != 0 {
		t.Fatalf("own listener must not conflict, got %v", got)
	}
}

func TestValidateHysteriaMultiPortDeployment(t *testing.T) {
	withRange := hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria","hysteriaMultiPort":"39640-39649"}`)
	withoutRange := hy2MultiPortInbound(`{"version":2}`, `{"network":"hysteria"}`)
	tests := []struct {
		name      string
		inbound   *model.Inbound
		multiNode bool
		wantErr   bool
	}{
		{"range in single-node mode rejected", withRange, false, true},
		{"range in multi-node mode accepted", withRange, true, false},
		{"no range in single-node mode accepted", withoutRange, false, false},
		{"nil inbound", nil, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateHysteriaMultiPortDeployment(tt.inbound, tt.multiNode); (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
