package xray

import (
	"fmt"
	"strings"

	routerpb "github.com/xtls/xray-core/app/router"
	"github.com/xtls/xray-core/common/geodata"
	"github.com/xtls/xray-core/common/serial"
)

const sessionIPBlockOutboundTag = "blocked"

// BuildSessionIPBlockRouterConfig builds router.Config for RoutingService.AddRule (one session-IP block).
// Uses geodata.ParseIPRules so the CIDR encoding matches JSON routing rules in the panel config.
func BuildSessionIPBlockRouterConfig(ruleTag, email, cidr string) (*routerpb.Config, error) {
	ruleTag = strings.TrimSpace(ruleTag)
	email = strings.TrimSpace(email)
	cidr = strings.TrimSpace(cidr)
	if ruleTag == "" || email == "" || cidr == "" {
		return nil, fmt.Errorf("ruleTag, email, and cidr are required")
	}
	sourceIP, err := geodata.ParseIPRules([]string{cidr})
	if err != nil {
		return nil, err
	}
	rule := &routerpb.RoutingRule{
		RuleTag:   ruleTag,
		UserEmail: []string{email},
		SourceIp:  sourceIP,
		TargetTag: &routerpb.RoutingRule_Tag{Tag: sessionIPBlockOutboundTag},
	}
	return &routerpb.Config{Rule: []*routerpb.RoutingRule{rule}}, nil
}

// SessionIPBlockAddRuleTypedMessage serializes router.Config for RoutingService.AddRule.
func SessionIPBlockAddRuleTypedMessage(ruleTag, email, cidr string) (*serial.TypedMessage, error) {
	cfg, err := BuildSessionIPBlockRouterConfig(ruleTag, email, cidr)
	if err != nil {
		return nil, err
	}
	tmsg := serial.ToTypedMessage(cfg)
	if tmsg == nil {
		return nil, fmt.Errorf("serial.ToTypedMessage returned nil")
	}
	return tmsg, nil
}
