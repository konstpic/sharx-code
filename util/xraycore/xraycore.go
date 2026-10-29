// Package xraycore knows where Xray core builds are downloaded from: the official XTLS release or the SharX
// fork (extra XHTTP features such as OPTIONS as the uplink method). The source is derived from the release tag,
// so an installed/pinned version string is enough to know where to fetch it again.
package xraycore

import (
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strings"
)

const (
	SourceOfficial = "official"
	SourceSharx    = "sharx"

	officialRepo = "XTLS/Xray-core"
	defaultFork  = "konstpic/Xray-core-sharx"
	// ForkTagMarker is part of every fork release tag, e.g. v26.9.9-sharx.1 (the binary still reports 26.9.9).
	ForkTagMarker = "-sharx."
)

// BaseURL and APIURL are variables so tests can point them at a local server.
var (
	BaseURL = "https://github.com"
	APIURL  = "https://api.github.com"
)

var forkTagRe = regexp.MustCompile(`^v?\d+\.\d+\.\d+-sharx\.\d+$`)

// ForkRepo is the owner/name of the fork; SHARX_XRAY_FORK_REPO overrides it.
func ForkRepo() string {
	if v := strings.TrimSpace(os.Getenv("SHARX_XRAY_FORK_REPO")); v != "" {
		return v
	}
	return defaultFork
}

// NormalizeSource maps anything but "sharx" to the official source.
func NormalizeSource(s string) string {
	if strings.EqualFold(strings.TrimSpace(s), SourceSharx) {
		return SourceSharx
	}
	return SourceOfficial
}

// SourceForVersion tells which source a release tag belongs to.
func SourceForVersion(version string) string {
	if strings.Contains(version, ForkTagMarker) {
		return SourceSharx
	}
	return SourceOfficial
}

// IsForkTag reports whether tag looks like a SharX fork release tag.
func IsForkTag(tag string) bool { return forkTagRe.MatchString(strings.TrimSpace(tag)) }

func repoFor(source string) string {
	if NormalizeSource(source) == SourceSharx {
		return ForkRepo()
	}
	return officialRepo
}

// ReleasesAPIURL is the GitHub API URL listing the releases of the source.
func ReleasesAPIURL(source string) string {
	return fmt.Sprintf("%s/repos/%s/releases", APIURL, repoFor(source))
}

// AssetName is the release zip name for this OS/arch (same naming as the official releases).
func AssetName() string {
	osName := runtime.GOOS
	arch := runtime.GOARCH
	if osName == "darwin" {
		osName = "macos"
	}
	switch arch {
	case "amd64":
		arch = "64"
	case "arm64":
		arch = "arm64-v8a"
	case "armv7":
		arch = "arm32-v7a"
	case "armv6":
		arch = "arm32-v6"
	case "armv5":
		arch = "arm32-v5"
	case "386":
		arch = "32"
	}
	return fmt.Sprintf("Xray-%s-%s.zip", osName, arch)
}

// DownloadURL is where the zip of the given release tag lives; the source follows from the tag.
func DownloadURL(version, fileName string) string {
	tag := strings.TrimSpace(version)
	if !strings.HasPrefix(tag, "v") {
		tag = "v" + tag
	}
	return fmt.Sprintf("%s/%s/releases/download/%s/%s", BaseURL, repoFor(SourceForVersion(tag)), tag, fileName)
}

// NormVersion reduces a tag or a reported version to what the binary prints (no "v", no fork suffix).
func NormVersion(v string) string {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.Index(v, ForkTagMarker); i >= 0 {
		v = v[:i]
	}
	return v
}
