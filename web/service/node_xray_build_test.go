package service

import "testing"

func TestXrayBuildMismatch(t *testing.T) {
	cases := []struct {
		name, pinned, build string
		want                bool
	}{
		{"no pin", "", "26.10.29-sharx.1", false},
		{"worker does not report a build", "26.10.29-sharx.1", "", false},
		{"fork pinned, fork running", "26.10.29-sharx.1", "26.10.29-sharx.1", false},
		{"v prefixes are ignored", "v26.10.29-sharx.1", "26.10.29-sharx.1", false},
		{"fork pinned, bundled stock came back", "26.10.29-sharx.1", "bundled", true},
		{"fork pinned, stock installed", "26.10.29-sharx.1", "26.10.29", true},
		{"stock pinned, fork running", "26.10.29", "26.10.29-sharx.1", true},
		{"stock pinned, bundled", "26.10.29", "bundled", false},
		{"stock pinned, same stock", "26.10.29", "26.10.29", false},
		{"another fork release", "26.10.29-sharx.2", "26.10.29-sharx.1", true},
		{"stock versions differ is the version check's job", "26.10.29", "26.9.9", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := xrayBuildMismatch(tc.pinned, tc.build); got != tc.want {
				t.Fatalf("xrayBuildMismatch(%q, %q) = %v, want %v", tc.pinned, tc.build, got, tc.want)
			}
		})
	}
}
