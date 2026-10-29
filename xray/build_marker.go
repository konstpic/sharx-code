package xray

import (
	"encoding/json"
	"os"
	"strings"
)

// BundledBuild is what a node reports when the Xray binary on disk was not installed through the panel
// (it is the one the node image bundles, or the marker no longer matches the binary).
const BundledBuild = "bundled"

// buildMarkerPath is the sidecar file that records which release the panel installed. It sits next to the
// binary, so it disappears together with it when the bin volume is recreated.
func buildMarkerPath() string { return GetBinaryPath() + ".build" }

type buildMarker struct {
	Build   string `json:"build"`
	Size    int64  `json:"size"`
	ModUnix int64  `json:"modUnix"`
}

// WriteInstalledBuild records the release tag (for example "26.10.29" or "26.10.29-sharx.1") of the binary
// that was just installed. The size and modification time tie the marker to that exact file.
func WriteInstalledBuild(build string) error {
	build = strings.TrimPrefix(strings.TrimSpace(build), "v")
	st, err := os.Stat(GetBinaryPath())
	if err != nil {
		return err
	}
	data, err := json.Marshal(buildMarker{Build: build, Size: st.Size(), ModUnix: st.ModTime().Unix()})
	if err != nil {
		return err
	}
	return os.WriteFile(buildMarkerPath(), data, 0o644)
}

// ReadInstalledBuild returns the release the panel installed, or BundledBuild when there is no marker or the
// binary was replaced after it was written (an image update, a manual copy).
func ReadInstalledBuild() string {
	data, err := os.ReadFile(buildMarkerPath())
	if err != nil {
		return BundledBuild
	}
	var m buildMarker
	if json.Unmarshal(data, &m) != nil || m.Build == "" {
		return BundledBuild
	}
	st, err := os.Stat(GetBinaryPath())
	if err != nil || st.Size() != m.Size || st.ModTime().Unix() != m.ModUnix {
		return BundledBuild
	}
	return m.Build
}
