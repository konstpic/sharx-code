package service

import (
	"strings"
	"testing"
)

func TestExpandSubscriptionPlaceholders(t *testing.T) {
	tests := []struct {
		name  string
		value string
		subID string
		want  string
	}{
		{"single braces", "https://ex.com/panel/sub/?id={subid}", "abc123", "https://ex.com/panel/sub/?id=abc123"},
		{"double braces", "https://ex.com/panel/sub/?id={{subid}}", "abc123", "https://ex.com/panel/sub/?id=abc123"},
		{"upper case", "https://ex.com/panel/sub/?id={SUBID}", "abc123", "https://ex.com/panel/sub/?id=abc123"},
		{"inner spaces", "https://ex.com/panel/sub/?id={ subid }", "abc123", "https://ex.com/panel/sub/?id=abc123"},
		{"no token", "https://ex.com/panel/sub/", "abc123", "https://ex.com/panel/sub/"},
		{"empty subID removes token", "https://ex.com/panel/sub/?id={subid}", "", "https://ex.com/panel/sub/?id="},
		{"dollar signs stay literal", "https://ex.com/panel/sub/?id={subid}", "cli$1$2", "https://ex.com/panel/sub/?id=cli$1$2"},
		{"two tokens", "https://ex.com/{subid}/sub/?id={{subid}}", "abc123", "https://ex.com/abc123/sub/?id=abc123"},
		{"empty value", "", "abc123", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ExpandSubscriptionPlaceholders(tc.value, tc.subID); got != tc.want {
				t.Fatalf("ExpandSubscriptionPlaceholders(%q, %q) = %q, want %q", tc.value, tc.subID, got, tc.want)
			}
		})
	}
}

func TestExpandSubscriptionPlaceholdersLeavesNonPlaceholderBraces(t *testing.T) {
	const value = "https://ex.com/panel/sub/?id={client}&x={subid}"
	if got, want := ExpandSubscriptionPlaceholders(value, "abc123"), "https://ex.com/panel/sub/?id={client}&x=abc123"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// TestExpandSubscriptionPlaceholdersStripsControlChars guards the body comment
// path: a subId carrying CR/LF must not add new lines to the subscription body.
func TestExpandSubscriptionPlaceholdersStripsControlChars(t *testing.T) {
	got := ExpandSubscriptionPlaceholders("https://ex.com/panel/sub/?id={subid}", "abc\n#announce: x")
	if strings.ContainsAny(got, "\r\n") {
		t.Fatalf("result keeps a line break: %q", got)
	}
	if lines := strings.Count(got, "\n"); lines != 0 {
		t.Fatalf("result has %d extra lines: %q", lines, got)
	}
	if want := "https://ex.com/panel/sub/?id=abc#announce: x"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}

	// Control characters are removed wholesale, including DEL and CR.
	if got := ExpandSubscriptionPlaceholders("x={subid}", "a\x00b\x1fc\r\x7fd"); got != "x=abcd" {
		t.Fatalf("control characters survived: %q", got)
	}
}
