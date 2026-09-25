package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestValidateTelemtInboundRequiresWebDomain(t *testing.T) {
	mk := func(enable bool, settings string) *model.Inbound {
		return &model.Inbound{Enable: enable, Protocol: model.Telemt, Settings: settings}
	}
	if err := ValidateTelemtInbound(mk(true, `{"telemt":{"web":{"enabled":true,"vhostHost":""}}}`)); err == nil {
		t.Fatal("enabled WEB inbound without a domain must be rejected")
	}
	for name, in := range map[string]*model.Inbound{
		"domain set":    mk(true, `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com"}}}`),
		"web off":       mk(true, `{"telemt":{"web":{"enabled":false,"vhostHost":""}}}`),
		"plain mtproto": mk(true, `{"telemt":{}}`),
		"disabled":      mk(false, `{"telemt":{"web":{"enabled":true,"vhostHost":""}}}`),
		"other proto":   {Enable: true, Protocol: model.VLESS, Settings: "{}"},
	} {
		if err := ValidateTelemtInbound(in); err != nil {
			t.Errorf("%s: unexpected error %v", name, err)
		}
	}
}
