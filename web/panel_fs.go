// Package web provides the panel static filesystem and helpers for the Next.js export.
package web

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/util/secretpath"
)

//go:embed all:panel
var panelContent embed.FS

// panelRootHTTP is the http.FileSystem for the static export root.
var panelRootHTTP http.FileSystem

// panelFsys is the read-only fs.FS for the same tree (for fs.Sub: _next, locales).
var panelFsys fs.FS

func initPanelFileSystem() error {
	if config.IsDebug() {
		wd, _ := os.Getwd()
		d := path.Join(wd, "web", "panel")
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			panelFsys = os.DirFS(d)
			panelRootHTTP = http.FS(panelFsys)
			return nil
		}
	}
	sub, err := fs.Sub(panelContent, "panel")
	if err != nil {
		return err
	}
	panelFsys = sub
	panelRootHTTP = http.FS(sub)
	return nil
}

// rewritePanelAssetURLs prefixes root-absolute static asset URLs for secret-path mode.
func rewritePanelAssetURLs(content, basePath string) string {
	if !secretpath.HidesBareRoot(basePath) {
		return content
	}
	prefix := strings.TrimSuffix(basePath, "/")
	repl := []struct{ from, to string }{
		{`href="/_next/`, `href="` + prefix + `/_next/`},
		{`src="/_next/`, `src="` + prefix + `/_next/`},
		{`href="/favicon.ico"`, `href="` + prefix + `/favicon.ico"`},
		{`href="/locales/`, `href="` + prefix + `/locales/`},
		{`"/_next/`, `"` + prefix + `/_next/`},
		{`:HL["/_next/`, `:HL["` + prefix + `/_next/`},
	}
	for _, r := range repl {
		content = strings.ReplaceAll(content, r.from, r.to)
	}
	return content
}

// rewritePanelHTML injects runtime base path and rewrites root-absolute asset URLs for secret-path mode.
func rewritePanelHTML(html, basePath string) string {
	if !secretpath.HidesBareRoot(basePath) {
		return html
	}
	inject := `<script>window.__SHARX_BASE_PATH__="` + basePath + `";</script>`
	if idx := strings.Index(html, "<head>"); idx >= 0 {
		html = html[:idx+6] + inject + html[idx+6:]
	}
	return rewritePanelAssetURLs(html, basePath)
}

// servePanelFile streams a file from panelRootHTTP using http.ServeContent.
// HTML responses are rewritten when webBasePath is a secret prefix (runtime, no rebuild).
func servePanelFile(c *gin.Context, name string) bool {
	f, err := panelRootHTTP.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		return false
	}
	basePath := normalizeWebBase(c)
	lower := strings.ToLower(name)
	if secretpath.HidesBareRoot(basePath) && (strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".txt")) {
		data, err := io.ReadAll(f)
		if err != nil {
			return false
		}
		out := string(data)
		if strings.HasSuffix(lower, ".html") {
			out = rewritePanelHTML(out, basePath)
			c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(out))
		} else {
			out = rewritePanelAssetURLs(out, basePath)
			c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(out))
		}
		return true
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	http.ServeContent(c.Writer, c.Request, path.Base(name), st.ModTime(), rs)
	return true
}

// ServePanelLoginPage serves the root index.html of the static export (login).
func ServePanelLoginPage(c *gin.Context) {
	if !servePanelFile(c, "index.html") {
		c.String(http.StatusNotFound, "not found")
	}
}

// panelURLSubpath returns the path under /panel/ (e.g. "inbounds" for /panel/inbounds/).
// Uses the *filepath param when present; otherwise parses the request path (NoRoute / SPA fallback).
func normalizeWebBase(c *gin.Context) string {
	b := c.GetString("base_path")
	if b == "" {
		return "/"
	}
	if !strings.HasPrefix(b, "/") {
		b = "/" + b
	}
	if !strings.HasSuffix(b, "/") {
		b += "/"
	}
	return b
}

func panelURLSubpath(c *gin.Context) string {
	if fp := strings.Trim(c.Param("filepath"), "/"); fp != "" {
		return fp
	}
	base := normalizeWebBase(c)
	path := c.Request.URL.Path
	bt := strings.TrimSuffix(base, "/")
	panelRoot := bt + "/panel"
	if path == panelRoot || path == panelRoot+"/" {
		return ""
	}
	if strings.HasPrefix(path, panelRoot+"/") {
		return strings.Trim(strings.TrimPrefix(path, panelRoot+"/"), "/")
	}
	return ""
}

// ServePanelReactPage serves panel/* HTML from the Next static export.
func ServePanelReactPage(c *gin.Context) {
	p := panelURLSubpath(c)
	p = strings.Trim(p, "/")
	if p == "" {
		if !servePanelFile(c, "panel/index.html") {
			c.String(http.StatusNotFound, "not found")
		}
		return
	}
	rel := path.Clean("panel/" + p)
	// Next.js 15+ with output: "export" performs client navigation by fetching the RSC
	// flight at paths like /panel/nodes/index.txt (or sibling.path.txt; see
	// next/dist/client/components/router-reducer/fetch-server-response.js). If we do not
	// serve the real .txt file, we fall through to panel/index.html and the client
	// cannot parse the response — it falls back to a full document navigation.
	if strings.HasSuffix(rel, ".txt") {
		if servePanelFile(c, rel) {
			return
		}
	}
	candidates := []string{rel + "/index.html", rel + ".html"}
	for _, name := range candidates {
		if servePanelFile(c, name) {
			return
		}
	}
	if !servePanelFile(c, "panel/index.html") {
		c.String(http.StatusNotFound, "not found")
	}
}
