package secretpath

import "testing"

func TestNormalizeWebBasePath(t *testing.T) {
	tests := []struct {
		in   string
		want string
		err  bool
	}{
		{"", "/", false},
		{"/", "/", false},
		{"abc", "", true},
		{"12345678", "/12345678/", false},
		{"/my-secret-path/", "/my-secret-path/", false},
	}
	for _, tc := range tests {
		got, err := NormalizeWebBasePath(tc.in)
		if tc.err {
			if err == nil {
				t.Fatalf("expected error for %q", tc.in)
			}
			continue
		}
		if err != nil {
			t.Fatalf("unexpected error for %q: %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("NormalizeWebBasePath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestNormalizeSubPath(t *testing.T) {
	got, err := NormalizeSubPath("/sub")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/sub/" {
		t.Fatalf("got %q", got)
	}
}
