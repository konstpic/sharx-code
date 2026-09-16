// Package nodecache persists the last successfully-applied config for a node-side manager
// (Telemt, AmneziaWG, Telemt-WEB vhosts) to local disk, so a worker node can resume serving
// traffic on its own after a process/container restart even when the panel is unreachable at
// that exact moment (e.g. panel outage overlapping a Watchtower image update or host reboot).
// Mirrors the load-on-boot / write-on-apply pattern node/xray.Manager already has for its own
// config.json cache — see LoadConfigFromFile / the post-ApplyConfig write in node/xray/manager.go.
package nodecache

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Save atomically writes v as JSON to path (temp file + rename, so a crash mid-write never
// leaves a corrupt cache). A blank path is a no-op success (manager has no cache configured).
func Save(path string, v any) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Load reads and unmarshals path into v. Returns (false, nil) when path is blank or the file
// doesn't exist yet (both are normal "no cache" states, not errors).
func Load(path string, v any) (bool, error) {
	if path == "" {
		return false, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if len(data) == 0 {
		return false, nil
	}
	if err := json.Unmarshal(data, v); err != nil {
		return false, err
	}
	return true, nil
}
