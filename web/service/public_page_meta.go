package service

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"html"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// Browser tab of the public subscription page, resolved on the server so that the very first HTML byte already
// carries the title and the icons: no "SharX" flash, and link previews / the iOS home-screen crawler (which do not run
// the page's JavaScript) see the same thing as the browser. The client hook (usePublicPageMeta) stays as a fallback
// for language switches and for pages served from a static export.

// PublicPageIconPath is the public endpoint (relative to the base path) that serves icons stored as data: URLs.
const PublicPageIconPath = "panel/api/public/pageIcon"

// PublicClientUserStatus is the status the public page shows for a client (ACTIVE / DISABLED / EXPIRED / LIMITED).
func PublicClientUserStatus(client model.ClientEntity, nowMs int64) string {
	totalLimit := int64(client.TotalGB * 1024 * 1024 * 1024)
	trafficExceeded := client.TotalGB > 0 && client.Up+client.Down >= totalLimit
	timeExpired := client.ExpiryTime > 0 && client.ExpiryTime <= nowMs
	switch {
	case !client.Enable:
		return "DISABLED"
	case timeExpired:
		return "EXPIRED"
	case trafficExceeded:
		return "LIMITED"
	}
	return "ACTIVE"
}

// PublicPageMeta is the resolved tab: Title is empty when nothing is configured (keep the static one).
type PublicPageMeta struct {
	Title string
	// Raw icon values from the config: http(s) URL, same-origin path or a data: URL.
	Favicon, FaviconDark, Apple string
}

func pickByLocale(m map[string]string, lang string) string {
	lang = strings.TrimSpace(lang)
	cands := []string{lang, strings.ReplaceAll(lang, "_", "-")}
	if parts := strings.FieldsFunc(lang, func(r rune) bool { return r == '-' || r == '_' }); len(parts) > 0 {
		cands = append(cands, parts[0])
	}
	for _, c := range cands {
		if c == "" {
			continue
		}
		for k, v := range m {
			if strings.EqualFold(k, c) && strings.TrimSpace(v) != "" {
				return v
			}
		}
	}
	return ""
}

var spaceRe = regexp.MustCompile(`\s+`)

// ResolvePublicPageMeta reads the active page config. lang is the panel language code, subID (optional) fills
// {username} and {status}. ok is false when the config cannot be read.
func ResolvePublicPageMeta(lang, subID string) (PublicPageMeta, bool) {
	cfg, err := SubscriptionPageConfigService{}.GetActiveV2Config()
	if err != nil || cfg == nil {
		return PublicPageMeta{}, false
	}
	b := cfg.Branding
	meta := PublicPageMeta{Favicon: strings.TrimSpace(b.FaviconURL), FaviconDark: strings.TrimSpace(b.FaviconDark), Apple: strings.TrimSpace(b.AppleTouchIconURL)}
	tpl := pickByLocale(b.PageTitleByLocale, lang)
	if tpl == "" {
		tpl = strings.TrimSpace(b.PageTitle)
	}
	if tpl == "" {
		return meta, true
	}
	username, status := "", ""
	if subID != "" {
		var client model.ClientEntity
		if database.GetDB().Where("sub_id = ?", subID).First(&client).Error == nil {
			username = client.Name
			status = PublicClientUserStatus(client, time.Now().UnixMilli())
		}
	}
	r := strings.NewReplacer("{title}", strings.TrimSpace(b.Title), "{username}", username, "{status}", status)
	meta.Title = strings.TrimSpace(spaceRe.ReplaceAllString(r.Replace(tpl), " "))
	return meta, true
}

// DecodeIconDataURL turns a data:image/...  URL into its MIME type and bytes.
func DecodeIconDataURL(v string) (mime string, body []byte, ok bool) {
	v = strings.TrimSpace(v)
	if len(v) < 11 || !strings.EqualFold(v[:11], "data:image/") {
		return "", nil, false
	}
	comma := strings.IndexByte(v, ',')
	if comma < 0 {
		return "", nil, false
	}
	head, data := v[5:comma], v[comma+1:]
	parts := strings.Split(head, ";")
	mime = strings.ToLower(parts[0])
	if mime == "image/vnd.microsoft.icon" {
		mime = "image/x-icon"
	}
	if strings.EqualFold(parts[len(parts)-1], "base64") {
		b, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return "", nil, false
		}
		return mime, b, true
	}
	s, err := url.PathUnescape(data)
	if err != nil {
		s = data
	}
	return mime, []byte(s), true
}

// PublicPageIcon returns the bytes and MIME type of one configured icon (kind: favicon, dark, apple).
func PublicPageIcon(kind string) (mime string, body []byte, ok bool) {
	meta, ok := ResolvePublicPageMeta("", "")
	if !ok {
		return "", nil, false
	}
	raw := map[string]string{"favicon": meta.Favicon, "dark": meta.FaviconDark, "apple": meta.Apple}[kind]
	return DecodeIconDataURL(raw)
}

func iconTypeFor(href string) string {
	h := strings.ToLower(strings.SplitN(strings.SplitN(href, "#", 2)[0], "?", 2)[0])
	switch {
	case strings.HasSuffix(h, ".png"):
		return "image/png"
	case strings.HasSuffix(h, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(h, ".ico"):
		return "image/x-icon"
	case strings.HasSuffix(h, ".webp"):
		return "image/webp"
	case strings.HasSuffix(h, ".jpg"), strings.HasSuffix(h, ".jpeg"):
		return "image/jpeg"
	}
	return ""
}

var (
	titleRe    = regexp.MustCompile(`(?is)<title\b[^>]*>.*?</title>`)
	iconLinkRe = regexp.MustCompile(`(?is)<link\b[^>]*\brel\s*=\s*["']?(?:shortcut\s+icon|icon|apple-touch-icon(?:-precomposed)?)["']?[^>]*>`)
)

// iconHref returns the URL a <link> should use: data: URLs are served by PublicPageIconPath (small HTML, real
// Content-Type, cacheable, and the only form every crawler and iOS accept), everything else is used as is.
func iconHref(raw, kind, basePath string) string {
	if raw == "" {
		return ""
	}
	if len(raw) >= 5 && strings.EqualFold(raw[:5], "data:") {
		sum := sha256.Sum256([]byte(raw))
		return basePath + PublicPageIconPath + "?k=" + kind + "&v=" + hex.EncodeToString(sum[:4])
	}
	return raw
}

// InjectPublicPageMeta rewrites <title> and the icon <link>s of the static public-page HTML. basePath is the web base
// path ending with "/". Returns the input unchanged when nothing is configured.
func InjectPublicPageMeta(doc string, meta PublicPageMeta, basePath string) string {
	if meta.Title != "" {
		tag := "<title>" + html.EscapeString(meta.Title) + "</title>"
		if titleRe.MatchString(doc) {
			doc = titleRe.ReplaceAllLiteralString(doc, tag)
		} else if i := strings.Index(doc, "</head>"); i >= 0 {
			doc = doc[:i] + tag + doc[i:]
		}
	}
	light, dark, apple := iconHref(meta.Favicon, "favicon", basePath), iconHref(meta.FaviconDark, "dark", basePath), iconHref(meta.Apple, "apple", basePath)
	if light == "" && dark == "" && apple == "" {
		return doc
	}
	link := func(rel, href, media string) string {
		s := `<link rel="` + rel + `" href="` + html.EscapeString(href) + `"`
		if t := iconTypeFor(href); t != "" && rel != "apple-touch-icon" {
			s += ` type="` + t + `"`
		}
		if media != "" {
			s += ` media="` + media + `"`
		}
		return s + ` data-sharx-page-meta="1">`
	}
	replaceIcons := light != "" || dark != ""
	doc = iconLinkRe.ReplaceAllStringFunc(doc, func(m string) string {
		isApple := strings.Contains(strings.ToLower(m), "apple-touch")
		if isApple && apple != "" || !isApple && replaceIcons {
			return ""
		}
		return m
	})
	var b strings.Builder
	if replaceIcons {
		if light == "" {
			light = basePath + "favicon.ico"
		}
		if dark != "" {
			b.WriteString(link("icon", light, "(prefers-color-scheme: light)"))
			b.WriteString(link("icon", dark, "(prefers-color-scheme: dark)"))
		} else {
			b.WriteString(link("icon", light, ""))
		}
	}
	if apple != "" {
		b.WriteString(link("apple-touch-icon", apple, ""))
	}
	if i := strings.Index(doc, "</head>"); i >= 0 {
		doc = doc[:i] + b.String() + doc[i:]
	}
	return doc
}
