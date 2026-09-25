package xray

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeLog(t *testing.T, lines []string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "access.log")
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTailLogLines(t *testing.T) {
	var lines []string
	for i := 1; i <= 50; i++ {
		lines = append(lines, fmt.Sprintf("line-%d", i))
		if i%10 == 0 {
			lines = append(lines, "", "x api -> api y")
		}
	}
	p := writeLog(t, lines)

	got, err := tailLogLines(p, 3, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "line-48,line-49,line-50" {
		t.Fatalf("last lines oldest first, empty and api lines skipped: %v", got)
	}
	got, _ = tailLogLines(p, 100, "line-4")
	if len(got) != 11 || got[0] != "line-4" || got[len(got)-1] != "line-49" {
		t.Fatalf("filter: %v", got)
	}
	got, _ = tailLogLines(p, 1000, "")
	if len(got) != 50 {
		t.Fatalf("all lines: %d", len(got))
	}
}

// A log far bigger than the window must be read in bounded time and memory, from its tail.
func TestTailLogLinesBigFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "big.log")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	row := strings.Repeat("x", 200) + "\n"
	for i := 0; i < (logTailBytes/len(row))*3; i++ { // about three windows
		f.WriteString(row)
	}
	f.WriteString("the-last-line\n")
	f.Close()

	got, err := tailLogLines(p, 5, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 || got[4] != "the-last-line" {
		t.Fatalf("tail of a big file: %d lines, last %q", len(got), got[len(got)-1])
	}
}

func TestTailLogLinesMissingFile(t *testing.T) {
	if _, err := tailLogLines(filepath.Join(t.TempDir(), "nope.log"), 5, ""); !os.IsNotExist(err) {
		t.Fatalf("want not-exist, got %v", err)
	}
}
