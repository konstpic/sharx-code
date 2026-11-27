package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
	"github.com/konstpic/sharx-code/v2/node/xray"
)

// Keep one immutable response until the panel acknowledges its committed ID.
// An unanswered request and a retry after a worker restart see the same bytes.
type statsDelivery struct {
	mu      sync.Mutex
	pending *xray.NodeStats
	saved   bool
}

func (d *statsDelivery) next(ack string, collect func() (*xray.NodeStats, error)) (*xray.NodeStats, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	dir := os.Getenv("SHARX_NODE_DATA_DIR")
	if dir == "" {
		dir = "/app/data"
	}
	path := filepath.Join(dir, "pending-stats.json")
	if d.pending == nil {
		b, err := os.ReadFile(path)
		if err == nil {
			var previous xray.NodeStats
			if err = json.Unmarshal(b, &previous); err != nil {
				return nil, err
			}
			if previous.BatchID == "" {
				return nil, fmt.Errorf("pending stats missing batch ID")
			}
			d.pending = &previous
			d.saved = true
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	if d.saved && d.pending.BatchID != ack {
		return d.pending, nil
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(dir, ".pending-stats-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if d.pending == nil || d.saved {
		next, err := collect()
		if err != nil {
			return nil, err
		}
		next.BatchID = uuid.NewString()
		d.pending = next
		d.saved = false
	}
	if err = json.NewEncoder(f).Encode(d.pending); err != nil {
		return nil, err
	}
	if err = f.Sync(); err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return nil, err
	}
	parent, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	if err = parent.Sync(); err != nil {
		return nil, err
	}
	d.saved = true
	return d.pending, nil
}
