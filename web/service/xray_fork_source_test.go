package service

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/konstpic/sharx-code/v2/util/xraycore"
)

func withFakeGithub(t *testing.T, h http.Handler) {
	t.Helper()
	srv := httptest.NewServer(h)
	oldBase, oldAPI := xraycore.BaseURL, xraycore.APIURL
	xraycore.BaseURL, xraycore.APIURL = srv.URL, srv.URL
	t.Setenv("SHARX_XRAY_FORK_REPO", "acme/xray-fork")
	t.Cleanup(func() { srv.Close(); xraycore.BaseURL, xraycore.APIURL = oldBase, oldAPI })
}

func TestGetXrayVersionsFromForkListsOnlyForkTags(t *testing.T) {
	var asked string
	withFakeGithub(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.Path
		_, _ = w.Write([]byte(`[{"tag_name":"v26.9.9-sharx.2"},{"tag_name":"v26.9.9-sharx.1"},{"tag_name":"v26.9.9"},{"tag_name":"nightly"}]`))
	}))
	got, err := (&ServerService{}).GetXrayVersions("sharx")
	if err != nil {
		t.Fatal(err)
	}
	if asked != "/repos/acme/xray-fork/releases" {
		t.Errorf("asked %q", asked)
	}
	if len(got) != 2 || got[0] != "v26.9.9-sharx.2" || got[1] != "v26.9.9-sharx.1" {
		t.Errorf("versions = %v", got)
	}
}

func TestGetXrayVersionsOfficialIgnoresForkTags(t *testing.T) {
	withFakeGithub(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/XTLS/Xray-core/releases" {
			t.Errorf("official list hit %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[{"tag_name":"v26.9.9"},{"tag_name":"v26.9.9-sharx.1"}]`))
	}))
	got, err := (&ServerService{}).GetXrayVersions("official")
	if err != nil || len(got) != 1 || got[0] != "v26.9.9" {
		t.Errorf("versions = %v err=%v", got, err)
	}
}

func TestDownloadXRayPicksSourceFromTag(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, _ := zw.Create("xray")
	_, _ = f.Write([]byte("binary"))
	_ = zw.Close()
	var paths []string
	withFakeGithub(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/acme/xray-fork/releases/download/v26.9.9-sharx.1/"+xraycore.AssetName() {
			_, _ = w.Write(buf.Bytes())
			return
		}
		http.NotFound(w, r)
	}))
	dir := t.TempDir()
	wd, _ := os.Getwd()
	_ = os.Chdir(dir)
	defer os.Chdir(wd)

	name, err := (&ServerService{}).downloadXRay("26.9.9-sharx.1")
	if err != nil {
		t.Fatalf("fork download: %v (paths %v)", err, paths)
	}
	if st, err := os.Stat(filepath.Join(dir, name)); err != nil || st.Size() != int64(buf.Len()) {
		t.Errorf("zip not saved: %v", err)
	}
	if _, err := (&ServerService{}).downloadXRay("26.9.9"); err == nil {
		t.Error("official tag must be fetched from the official repo path (404 here), got success")
	}
	if last := paths[len(paths)-1]; last != "/XTLS/Xray-core/releases/download/v26.9.9/"+xraycore.AssetName() {
		t.Errorf("official download path = %q", last)
	}
}
