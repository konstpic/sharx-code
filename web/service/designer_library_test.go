package service

import (
	"strings"
	"testing"
)

func TestSetDesignerLibraryRejectsBadInput(t *testing.T) {
	var s SettingService
	cases := map[string]string{
		"not json":      "{oops",
		"wrong version": `{"version":2,"items":[]}`,
		"too large":     `{"version":1,"items":["` + strings.Repeat("x", designerLibraryMaxBytes) + `"]}`,
	}
	for name, v := range cases {
		if err := s.SetDesignerLibrary(v); err == nil {
			t.Fatalf("%s: expected an error", name)
		}
	}
}
