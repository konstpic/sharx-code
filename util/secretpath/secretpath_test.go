package secretpath_test

import (
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/util/secretpath"
)

func TestGenerateWebBasePathFormat(t *testing.T) {
	p := secretpath.GenerateWebBasePath()
	if !strings.HasPrefix(p, "/") || !strings.HasSuffix(p, "/") {
		t.Fatalf("path %q must start and end with /", p)
	}
	seg := strings.Trim(p, "/")
	if len(seg) != 24 {
		t.Fatalf("segment len = %d, want 24 hex chars", len(seg))
	}
}

func TestHidesBareRoot(t *testing.T) {
	if !secretpath.HidesBareRoot("/abc/") {
		t.Fatal("expected true for secret prefix")
	}
	if secretpath.HidesBareRoot("/") {
		t.Fatal("expected false for root")
	}
	if secretpath.HidesBareRoot("") {
		t.Fatal("expected false for empty")
	}
}
