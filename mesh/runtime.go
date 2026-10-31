// Package mesh runs the native Go controller inside the panel process.
// Only explicitly enrolled worker nodes join the overlay.
package mesh

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Bridge func(context.Context, string, json.RawMessage) (any, error)
type Runtime struct {
	Dir        string
	Gate       func() bool
	Bridge     Bridge
	mu         sync.Mutex
	running    bool
	lastError  string
	restart    bool
	cancel     context.CancelFunc
	done       chan struct{}
	controller *Controller
}

func (r *Runtime) Enabled() bool {
	if r.Gate == nil || !r.Gate() {
		return false
	}
	var s struct {
		Enabled bool `json:"enabled"`
	}
	b, e := os.ReadFile(filepath.Join(r.Dir, "settings.json"))
	return e == nil && json.Unmarshal(b, &s) == nil && s.Enabled
}
func AtomicJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".mesh-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (r *Runtime) Start(ctx context.Context) {
	r.mu.Lock()
	if r.done != nil {
		r.mu.Unlock()
		return
	}
	ctx, r.cancel = context.WithCancel(ctx)
	r.done = make(chan struct{})
	r.mu.Unlock()
	go func() {
		defer close(r.done)
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			r.mu.Lock()
			restart := r.restart
			r.restart = false
			c := r.controller
			r.mu.Unlock()
			if c != nil && (!r.Enabled() || restart) {
				c.Stop()
				r.mu.Lock()
				r.controller = nil
				r.running = false
				r.mu.Unlock()
				c = nil
			}
			if c == nil && r.Enabled() && ctx.Err() == nil {
				next, e := NewController(ctx, r.Dir, r.Bridge)
				r.mu.Lock()
				if e != nil {
					r.lastError = e.Error()
				} else {
					r.controller = next
					r.running = true
					r.lastError = ""
				}
				r.mu.Unlock()
			}
			select {
			case <-ctx.Done():
				r.mu.Lock()
				c = r.controller
				r.running = false
				r.controller = nil
				r.mu.Unlock()
				if c != nil {
					c.Stop()
				}
				return
			case <-tick.C:
			}
		}
	}()
}
func (r *Runtime) State() map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return map[string]any{"running": r.running, "error": r.lastError, "enabled": r.Enabled(), "implementation": "go"}
}
func (r *Runtime) Stop() {
	r.mu.Lock()
	cancel, done := r.cancel, r.done
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}
func (r *Runtime) RequestRestart() { r.mu.Lock(); r.restart = true; r.running = false; r.mu.Unlock() }
func (r *Runtime) Call(ctx context.Context, action string, body any) (json.RawMessage, error) {
	if !r.Enabled() {
		return nil, errors.New("mesh доступен только в режиме multi-node с включённым mesh")
	}
	r.mu.Lock()
	c, on := r.controller, r.running
	r.mu.Unlock()
	if c == nil || !on {
		return nil, errors.New("контроллер mesh запускается или недоступен")
	}
	b, e := json.Marshal(body)
	if e != nil {
		return nil, e
	}
	obj, e := c.Action(ctx, action, b)
	if e != nil {
		return nil, e
	}
	return json.Marshal(obj)
}
