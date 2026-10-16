package service

import (
	"strings"
	"testing"
)

func TestValidateV2BrowserTabIcons(t *testing.T) {
	mk := func(extra string) string {
		return `{"schemaVersion":"sharx-v2","branding":{"title":"T","logoUrl":"","brandText":"","supportUrl":""` + extra + `},"theme":"system","blocks":[]}`
	}
	ok := []string{
		``,
		`,"pageTitle":"{title} - {username}","pageTitleByLocale":{"ru":"x"}`,
		`,"faviconUrl":"https://a.com/i.png"`,
		`,"faviconUrl":"/fav.svg","faviconDark":"data:image/png;base64,iVBORw0KGgo="`,
		// ~140 KB of base64 (100 KB file) must pass
		`,"faviconUrl":"data:image/png;base64,` + strings.Repeat("QUJD", 35000) + `"`,
	}
	for _, e := range ok {
		if err := validateV2(mk(e)); err != nil {
			t.Fatalf("expected ok for %.60s: %v", e, err)
		}
	}
	bad := []string{
		`,"faviconUrl":"javascript:alert(1)"`,
		`,"faviconDark":"data:text/html;base64,AAAA"`,
		`,"appleTouchIconUrl":"//evil.com/x.png"`,
		`,"faviconUrl":"ftp://a.com/x.png"`,
	}
	for _, e := range bad {
		if err := validateV2(mk(e)); err == nil {
			t.Fatalf("expected error for %s", e)
		}
	}
}
