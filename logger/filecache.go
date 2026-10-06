package logger

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
)

// maxCachedEntries bounds the parsed-log cache (about 100 MB at ~250 bytes an entry); the oldest are dropped first.
const maxCachedEntries = 400_000

// liveFile is the incremental reader of the current log file: it remembers how far it parsed, so every request parses
// only the lines written since the previous one instead of the whole file (up to the rotation size).
type liveFile struct {
	mu      sync.Mutex
	path    string
	offset  int64
	entries []Entry
}

var (
	live     liveFile
	archives sync.Map // archive file name -> *archiveEntry
)

type archiveEntry struct {
	mu      sync.Mutex
	modTime time.Time
	entries []Entry
}

// refresh parses what was appended since the last call. A shrunk file means rotation: start over.
func (lf *liveFile) refresh(path string) []Entry {
	lf.mu.Lock()
	defer lf.mu.Unlock()
	if lf.path != path {
		lf.path, lf.offset, lf.entries = path, 0, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil
	}
	if st.Size() < lf.offset {
		lf.offset, lf.entries = 0, nil
	}
	if st.Size() > lf.offset {
		if _, err := f.Seek(lf.offset, io.SeekStart); err == nil {
			lf.offset += lf.parse(f)
		}
	}
	out := make([]Entry, len(lf.entries))
	copy(out, lf.entries)
	return out
}

// parse reads complete lines only (a half-written last line is left for the next call) and returns the bytes consumed.
func (lf *liveFile) parse(r io.Reader) int64 {
	br := bufio.NewReaderSize(r, 1<<20)
	var used int64
	for {
		line, err := br.ReadString('\n')
		if err != nil { // io.EOF with a partial line: not consumed
			break
		}
		used += int64(len(line))
		if e, ok := parseEntryLine(line); ok {
			lf.entries = append(lf.entries, e)
		}
	}
	if over := len(lf.entries) - maxCachedEntries; over > 0 {
		lf.entries = append([]Entry(nil), lf.entries[over:]...)
	}
	return used
}

func parseEntryLine(line string) (Entry, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return Entry{}, false
	}
	var e Entry
	if json.Unmarshal([]byte(line), &e) != nil {
		return Entry{}, false
	}
	if e.TsUnixMs == 0 {
		if t, err := time.ParseInLocation(timeFormat, e.Ts, time.Local); err == nil {
			e.TsUnixMs = t.UnixMilli()
		}
	}
	return e, true
}

// ReadEntries returns the entries of the current log file, oldest first, and, when the window reaches before the first
// of them (sinceMs <= 0 means "everything"), the rotated gzip archives too. Parsed data is cached: the live file
// incrementally, archives once (they never change).
func ReadEntries(sinceMs int64) []Entry {
	dir := config.GetLogFolder()
	cur := live.refresh(filepath.Join(dir, logFileName))
	if sinceMs > 0 && len(cur) > 0 && cur[0].TsUnixMs <= sinceMs {
		return cur
	}
	var older []Entry
	files, _ := filepath.Glob(filepath.Join(dir, "sharx-*.log.gz"))
	sort.Strings(files) // names carry the rotation time, so this is oldest first
	seen := map[string]bool{}
	for _, p := range files {
		name := filepath.Base(p)
		seen[name] = true
		st, err := os.Stat(p)
		if err != nil || (sinceMs > 0 && st.ModTime().UnixMilli() < sinceMs) {
			continue // the archive ends before the window starts
		}
		older = append(older, readArchive(name, p, st.ModTime())...)
	}
	archives.Range(func(k, _ any) bool { // archives deleted by rotation leave the cache
		if !seen[k.(string)] {
			archives.Delete(k)
		}
		return true
	})
	out := append(older, cur...)
	if over := len(out) - maxCachedEntries; over > 0 {
		out = out[over:]
	}
	return out
}

func readArchive(name, path string, mod time.Time) []Entry {
	v, _ := archives.LoadOrStore(name, &archiveEntry{})
	a := v.(*archiveEntry)
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.entries != nil && a.modTime.Equal(mod) {
		return a.entries
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return nil
	}
	defer zr.Close()
	var tmp liveFile
	tmp.parse(zr)
	a.modTime, a.entries = mod, tmp.entries
	if a.entries == nil {
		a.entries = []Entry{}
	}
	return a.entries
}
