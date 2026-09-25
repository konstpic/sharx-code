package xray

import (
	"testing"

	routerpb "github.com/xtls/xray-core/app/router"
)

func TestBuildSessionIPBlockRouterConfig_roundTripTypedMessage(t *testing.T) {
	t.Parallel()
	tag := SessionIPBlockRuleTag(42, "203.0.113.10")
	tmsg, err := SessionIPBlockAddRuleTypedMessage(tag, "user@example.com", "203.0.113.10/32")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := tmsg.GetInstance()
	if err != nil {
		t.Fatalf("GetInstance: %v", err)
	}
	cfg, ok := msg.(*routerpb.Config)
	if !ok {
		t.Fatalf("want *router.Config, got %T", msg)
	}
	if len(cfg.Rule) != 1 {
		t.Fatalf("rules: %d", len(cfg.Rule))
	}
	rule := cfg.Rule[0]
	if rule.GetRuleTag() != tag {
		t.Fatalf("ruleTag: %q", rule.GetRuleTag())
	}
	if len(rule.GetUserEmail()) != 1 || rule.GetUserEmail()[0] != "user@example.com" {
		t.Fatalf("user email: %v", rule.GetUserEmail())
	}
	if rule.GetTag() != "blocked" {
		t.Fatalf("outbound tag: %q", rule.GetTag())
	}
	if len(rule.GetSourceIp()) == 0 || rule.GetSourceIp()[0].GetCustom().GetCidr() == nil {
		t.Fatal("expected a source ip rule with a cidr")
	}
}
