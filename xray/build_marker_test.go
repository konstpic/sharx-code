package xray

import (
	"os"
	"testing"
	"time"
)

func withFakeBinary(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XUI_BIN_FOLDER", dir)
	if err := os.WriteFile(GetBinaryPath(), []byte("fake xray binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	return GetBinaryPath()
}

func TestInstalledBuildRoundTrip(t *testing.T) {
	withFakeBinary(t)
	if got := ReadInstalledBuild(); got != BundledBuild {
		t.Fatalf("no marker: got %q, want %q", got, BundledBuild)
	}
	if err := WriteInstalledBuild("v26.10.29-sharx.1"); err != nil {
		t.Fatal(err)
	}
	if got := ReadInstalledBuild(); got != "26.10.29-sharx.1" {
		t.Fatalf("got %q, want the tag without the v prefix", got)
	}
}

func TestInstalledBuildIgnoresReplacedBinary(t *testing.T) {
	bin := withFakeBinary(t)
	if err := WriteInstalledBuild("26.10.29-sharx.1"); err != nil {
		t.Fatal(err)
	}
	// An image update or a manual copy puts another binary in place; the old marker must not vouch for it.
	if err := os.WriteFile(bin, []byte("another, longer, binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := ReadInstalledBuild(); got != BundledBuild {
		t.Fatalf("replaced binary: got %q, want %q", got, BundledBuild)
	}

	// Same size but a different modification time is a replaced binary as well.
	if err := WriteInstalledBuild("26.10.29-sharx.1"); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(bin, later, later); err != nil {
		t.Fatal(err)
	}
	if got := ReadInstalledBuild(); got != BundledBuild {
		t.Fatalf("touched binary: got %q, want %q", got, BundledBuild)
	}
}

func TestInstalledBuildCorruptMarker(t *testing.T) {
	withFakeBinary(t)
	if err := os.WriteFile(buildMarkerPath(), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ReadInstalledBuild(); got != BundledBuild {
		t.Fatalf("got %q, want %q", got, BundledBuild)
	}
}

func TestWriteInstalledBuildWithoutBinary(t *testing.T) {
	t.Setenv("XUI_BIN_FOLDER", t.TempDir())
	if err := WriteInstalledBuild("26.10.29"); err == nil {
		t.Fatal("expected an error when there is no binary to tie the marker to")
	}
}
