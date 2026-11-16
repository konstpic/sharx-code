package sub

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	service "github.com/konstpic/sharx-code/v2/web/service"
)

// newProfileWebPageContext returns a gin context backed by a recorder so the
// headers written by ApplyCommonHeaders can be inspected.
func newProfileWebPageContext(t *testing.T, subPath string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", subPath, nil)
	return c, w
}

func TestApplyCommonHeadersExpandsProfileWebPageSubID(t *testing.T) {
	// ApplyCommonHeaders reads the providerid setting from the database.
	testdb.New(t)

	const subID = "cli$1-abc"
	cfg := &service.SharxSubpageConfigV2{
		ResponseRules: &service.SharxSubpageResponseRules{
			ProfileWebPageURL:         "https://ex.com/panel/sub/?id={subid}",
			ProfileWebPageURLDelivery: service.ResponseHeaderDeliveryHeader,
		},
	}

	c, w := newProfileWebPageContext(t, "/sub/"+subID)
	(&SUBController{}).ApplyCommonHeaders(c, cfg, "upload=0; download=0; total=0; expire=0", subID, "", "")

	if got, want := w.Header().Get("Profile-Web-Page-Url"), "https://ex.com/panel/sub/?id="+subID; got != want {
		t.Fatalf("Profile-Web-Page-Url = %q, want %q", got, want)
	}
}

func TestApplyCommonHeadersSkipsProfileWebPageHeaderForBodyDelivery(t *testing.T) {
	testdb.New(t)

	cfg := &service.SharxSubpageConfigV2{
		ResponseRules: &service.SharxSubpageResponseRules{
			ProfileWebPageURL:         "https://ex.com/panel/sub/?id={subid}",
			ProfileWebPageURLDelivery: service.ResponseHeaderDeliveryBody,
		},
	}

	c, w := newProfileWebPageContext(t, "/sub/abc123")
	(&SUBController{}).ApplyCommonHeaders(c, cfg, "upload=0; download=0; total=0; expire=0", "abc123", "", "")

	if got := w.Header().Get("Profile-Web-Page-Url"); got != "" {
		t.Fatalf("body delivery must not set the header, got %q", got)
	}
}

// TestApplyCommonHeadersProfileWebPageURLUnchangedWithoutToken guards the
// placeholder-free configuration: the URL is emitted verbatim.
func TestApplyCommonHeadersProfileWebPageURLUnchangedWithoutToken(t *testing.T) {
	testdb.New(t)

	cfg := &service.SharxSubpageConfigV2{
		ResponseRules: &service.SharxSubpageResponseRules{
			ProfileWebPageURL:         "https://ex.com/panel/sub/",
			ProfileWebPageURLDelivery: service.ResponseHeaderDeliveryHeader,
		},
	}

	c, w := newProfileWebPageContext(t, "/sub/abc123")
	(&SUBController{}).ApplyCommonHeaders(c, cfg, "upload=0; download=0; total=0; expire=0", "abc123", "", "")

	if got := w.Header().Get("Profile-Web-Page-Url"); got != "https://ex.com/panel/sub/" {
		t.Fatalf("Profile-Web-Page-Url = %q, want the configured value", got)
	}
	if !strings.Contains(w.Header().Get("X-Subscription-ID"), "abc123") {
		t.Fatalf("X-Subscription-ID = %q", w.Header().Get("X-Subscription-ID"))
	}
}
