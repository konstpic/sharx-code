package service

import (
	"strings"
	"testing"
)

const staticHead = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>SharX</title><link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16"/><link rel="apple-touch-icon" href="/old.png"/></head><body></body></html>`

func TestInjectPublicPageMeta(t *testing.T) {
	big := "data:image/png;base64," + strings.Repeat("QUJD", 5000)
	out := InjectPublicPageMeta(staticHead, PublicPageMeta{Title: `A <b> & "c"`, Favicon: big, FaviconDark: "https://x.test/dark.png", Apple: big}, "/base/")
	for _, want := range []string{
		`<title>A &lt;b&gt; &amp; &#34;c&#34;</title>`,
		`media="(prefers-color-scheme: light)"`,
		`href="https://x.test/dark.png" type="image/png" media="(prefers-color-scheme: dark)"`,
		`rel="apple-touch-icon" href="/base/panel/api/public/pageIcon?k=apple&amp;v=`,
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in %s", want, out)
		}
	}
	if strings.Contains(out, "SharX</title>") || strings.Contains(out, "/favicon.ico") || strings.Contains(out, "/old.png") {
		t.Fatalf("static title/icons must be replaced: %s", out)
	}
	if strings.Contains(out, "QUJDQUJD") {
		t.Fatal("data: URLs must not be inlined into HTML")
	}
	if got := InjectPublicPageMeta(staticHead, PublicPageMeta{}, "/"); got != staticHead {
		t.Fatal("nothing configured must leave the HTML untouched")
	}
	// only the apple icon: the browser icon stays
	only := InjectPublicPageMeta(staticHead, PublicPageMeta{Apple: "/a.png"}, "/")
	if !strings.Contains(only, `href="/favicon.ico"`) || strings.Contains(only, "/old.png") || !strings.Contains(only, `href="/a.png"`) {
		t.Fatalf("apple-only: %s", only)
	}
}

func TestDecodeIconDataURL(t *testing.T) {
	m, b, ok := DecodeIconDataURL("data:image/png;base64,QUJD")
	if !ok || m != "image/png" || string(b) != "ABC" {
		t.Fatalf("base64: %v %q %q", ok, m, b)
	}
	m, b, ok = DecodeIconDataURL("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E")
	if !ok || m != "image/svg+xml" || string(b) != `<svg a="1"/>` {
		t.Fatalf("percent: %v %q %q", ok, m, b)
	}
	if _, _, ok = DecodeIconDataURL("data:text/html;base64,QUJD"); ok {
		t.Fatal("non-image must be refused")
	}
	if _, _, ok = DecodeIconDataURL("https://x/y.png"); ok {
		t.Fatal("not a data URL")
	}
}

func TestPickByLocaleAndStatus(t *testing.T) {
	m := map[string]string{"ru": "Привет", "pt-BR": "Oi"}
	if pickByLocale(m, "ru") != "Привет" || pickByLocale(m, "ru-RU") != "Привет" || pickByLocale(m, "pt_br") != "Oi" || pickByLocale(m, "de") != "" {
		t.Fatal("locale pick")
	}
}
