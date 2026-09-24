package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateLocalTemplate(t *testing.T) {
	ok := &LocalTemplateInput{Kind: "inbound", Title: "  My Reality  ", Tags: []string{"Reality", "vless", "reality"}, Content: json.RawMessage(`{ "protocol": "vless" }`)}
	c, tags, err := ValidateLocalTemplate(ok)
	if err != nil || string(c) != `{"protocol":"vless"}` || len(tags) != 2 || ok.Title != "My Reality" {
		t.Fatalf("valid input rejected or not normalized: %s %v %v", c, tags, err)
	}
	bad := []*LocalTemplateInput{
		{Kind: "nope", Title: "x", Content: json.RawMessage(`{}`)},
		{Kind: "inbound", Title: "", Content: json.RawMessage(`{}`)},
		{Kind: "inbound", Title: "x", Content: json.RawMessage(`[1]`)},
		{Kind: "inbound", Title: "x", Content: json.RawMessage(`nope`)},
		{Kind: "inbound", Title: "x", Content: json.RawMessage(``)},
		{Kind: "inbound", Title: "x", Tags: []string{"bad tag!"}, Content: json.RawMessage(`{}`)},
		{Kind: "inbound", Title: "x", Tags: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"}, Content: json.RawMessage(`{}`)},
		{Kind: "inbound", Title: "x", Content: json.RawMessage(`{"a":"` + strings.Repeat("x", localTemplateMaxBytes) + `"}`)},
	}
	for i, in := range bad {
		if _, _, err := ValidateLocalTemplate(in); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}
