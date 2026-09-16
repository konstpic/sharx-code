package nodecache

import (
	"path/filepath"
	"testing"
)

type sample struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "cache.json")
	in := []sample{{Tag: "a", Count: 1}, {Tag: "b", Count: 2}}
	if err := Save(path, in); err != nil {
		t.Fatalf("Save: %v", err)
	}
	var out []sample
	found, err := Load(path, &out)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !found {
		t.Fatal("Load: expected found=true")
	}
	if len(out) != 2 || out[0] != in[0] || out[1] != in[1] {
		t.Fatalf("Load: got %+v, want %+v", out, in)
	}
}

func TestLoadMissingFileIsNotAnError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "does-not-exist.json")
	var out []sample
	found, err := Load(path, &out)
	if err != nil {
		t.Fatalf("Load: unexpected error %v", err)
	}
	if found {
		t.Fatal("Load: expected found=false for a missing file")
	}
}

func TestBlankPathIsNoOp(t *testing.T) {
	if err := Save("", []sample{{Tag: "x", Count: 1}}); err != nil {
		t.Fatalf("Save(blank): %v", err)
	}
	var out []sample
	found, err := Load("", &out)
	if err != nil || found {
		t.Fatalf("Load(blank): found=%v err=%v, want false/nil", found, err)
	}
}

func TestSaveOverwritesPreviousContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cache.json")
	if err := Save(path, []sample{{Tag: "old", Count: 1}}); err != nil {
		t.Fatalf("Save 1: %v", err)
	}
	if err := Save(path, []sample{{Tag: "new", Count: 2}}); err != nil {
		t.Fatalf("Save 2: %v", err)
	}
	var out []sample
	if _, err := Load(path, &out); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(out) != 1 || out[0].Tag != "new" {
		t.Fatalf("expected only the latest write to survive, got %+v", out)
	}
}
