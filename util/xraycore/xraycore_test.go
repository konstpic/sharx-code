package xraycore

import "testing"

func TestSourceAndURL(t *testing.T) {
	if SourceForVersion("v26.9.9") != SourceOfficial || SourceForVersion("26.9.9-sharx.2") != SourceSharx {
		t.Fatal("source detection")
	}
	t.Setenv("SHARX_XRAY_FORK_REPO", "")
	if got := DownloadURL("26.9.9", "X.zip"); got != "https://github.com/XTLS/Xray-core/releases/download/v26.9.9/X.zip" {
		t.Errorf("official url = %s", got)
	}
	if got := DownloadURL("v26.9.9-sharx.1", "X.zip"); got != "https://github.com/konstpic/Xray-core-sharx/releases/download/v26.9.9-sharx.1/X.zip" {
		t.Errorf("fork url = %s", got)
	}
	t.Setenv("SHARX_XRAY_FORK_REPO", "me/fork")
	if got := ReleasesAPIURL("sharx"); got != "https://api.github.com/repos/me/fork/releases" {
		t.Errorf("api = %s", got)
	}
}

func TestNormVersionAndForkTag(t *testing.T) {
	for in, want := range map[string]string{"v26.9.9": "26.9.9", "26.9.9-sharx.3": "26.9.9", " v26.9.9-sharx.1 ": "26.9.9"} {
		if got := NormVersion(in); got != want {
			t.Errorf("NormVersion(%q) = %q, want %q", in, got, want)
		}
	}
	if !IsForkTag("v26.9.9-sharx.1") || IsForkTag("v26.9.9") || IsForkTag("v26.9.9-sharx.x") {
		t.Error("IsForkTag")
	}
}
