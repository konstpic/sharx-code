package xray

import (
	"bytes"
	"errors"
	"io"
	"os"
	"strings"
)

// errLogNotFile means the access log path is not a regular file (for example /dev/stderr, a pipe). Such a path has no end
// to read up to: reading it blocks forever and takes the data away from whoever consumes the pipe.
var errLogNotFile = errors.New("access log is not a regular file")

// Reading a log for the panel must stay cheap: with debug logging the access log grows without bound, and a full scan
// of it (while Xray keeps writing) can run for minutes.
const (
	logTailBytes         = 4 << 20  // look at the last 4 MiB
	logTailBytesFiltered = 32 << 20 // a filter can need a longer stretch to find enough matches
)

// tailLogLines returns the last count lines of the file that pass the filter, oldest first. Empty lines and Xray API
// calls ("api -> api") are skipped. Only a bounded tail of the file is read.
func tailLogLines(path string, count int, filter string) ([]string, error) {
	// Stat does not block on pipes and follows symlinks such as /dev/stderr -> /proc/self/fd/2.
	if st, err := os.Stat(path); err == nil && !st.Mode().IsRegular() {
		return nil, errLogNotFile
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	limit := int64(logTailBytes)
	if filter != "" {
		limit = logTailBytesFiltered
	}
	start := info.Size() - limit
	if start < 0 {
		start = 0
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		return nil, err
	}
	if start > 0 {
		// The first line is cut in the middle: drop it.
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		} else {
			data = nil
		}
	}

	raw := strings.Split(string(data), "\n")
	out := make([]string, 0, count)
	for i := len(raw) - 1; i >= 0 && len(out) < count; i-- {
		line := strings.TrimSpace(raw[i])
		if line == "" || strings.Contains(line, "api -> api") {
			continue
		}
		if filter != "" && !strings.Contains(line, filter) {
			continue
		}
		out = append(out, line)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}
