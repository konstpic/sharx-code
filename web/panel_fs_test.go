package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInitPanelFileSystem(t *testing.T) {
	if err := initPanelFileSystem(); err != nil {
		t.Fatalf("initPanelFileSystem: %v", err)
	}
}

// TestServePanelReactPageRscTxt ensures Next.js static-export RSC requests (…/index.txt)
// return the flight payload, not the panel HTML shell fallback.
func TestServePanelReactPageRscTxt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	if err := initPanelFileSystem(); err != nil {
		t.Fatalf("initPanelFileSystem: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/panel/nodes/index.txt", nil)
	c.Set("base_path", "/")

	ServePanelReactPage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status: %d body: %s", w.Code, w.Body.String())
	}
	ct := w.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("Content-Type = %q, want text/plain… (RSC flight for static export)", ct)
	}
	body := w.Body.String()
	if !strings.HasPrefix(strings.TrimSpace(body), "1:") {
		t.Fatalf("body does not look like RSC flight (expected line like 1:\"$S…\"): %q", body[:min(80, len(body))])
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func TestRewritePanelHTMLSecretBase(t *testing.T) {
	in := `<html><head></head><body><link href="/_next/static/css/x.css"/><script src="/_next/static/chunks/a.js"></script></body></html>`
	out := rewritePanelHTML(in, "/s3cr3t/")
	if !strings.Contains(out, `window.__SHARX_BASE_PATH__="/s3cr3t/"`) {
		t.Fatal("missing runtime base injection")
	}
	if !strings.Contains(out, `href="/s3cr3t/_next/static/css/x.css"`) {
		t.Fatalf("href not rewritten: %s", out)
	}
	if !strings.Contains(out, `src="/s3cr3t/_next/static/chunks/a.js"`) {
		t.Fatalf("src not rewritten: %s", out)
	}
}

func TestRewritePanelHTMLRootBaseUnchanged(t *testing.T) {
	in := `<html><head></head><body><link href="/_next/static/css/x.css"/></body></html>`
	out := rewritePanelHTML(in, "/")
	if out != in {
		t.Fatalf("expected unchanged, got %s", out)
	}
}

func TestServePanelReactPageRscTxtWithSubpathBase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	if err := initPanelFileSystem(); err != nil {
		t.Fatalf("initPanelFileSystem: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/app/panel/nodes/index.txt", nil)
	c.Set("base_path", "/app/")

	ServePanelReactPage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status: %d", w.Code)
	}
	if !strings.HasPrefix(w.Body.String(), "1:") {
		t.Fatal("expected RSC flight body")
	}
}
