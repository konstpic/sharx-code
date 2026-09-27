package xray

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
)

const (
	xrayStopGracePeriod = 15 * time.Second
	xrayStopKillWait    = 5 * time.Second
	xrayStopPoll        = 50 * time.Millisecond
)

// GetBinaryName returns the Xray binary filename for the current OS and architecture.
func GetBinaryName() string {
	return fmt.Sprintf("xray-%s-%s", runtime.GOOS, runtime.GOARCH)
}

// GetBinaryPath returns the full path to the Xray binary executable.
func GetBinaryPath() string {
	return config.GetBinFolderPath() + "/" + GetBinaryName()
}

// GetConfigPath returns the path to the Xray configuration file in the binary folder.
func GetConfigPath() string {
	return config.GetBinFolderPath() + "/config.json"
}

// GetGeositePath returns the path to the geosite data file used by Xray.
func GetGeositePath() string {
	// Try data folder first, fallback to bin folder for compatibility
	dataPath := config.GetDataFolderPath() + "/geosite.dat"
	if _, err := os.Stat(dataPath); err == nil {
		return dataPath
	}
	return config.GetBinFolderPath() + "/geosite.dat"
}

// GetGeoipPath returns the path to the geoip data file used by Xray.
func GetGeoipPath() string {
	// Try data folder first, fallback to bin folder for compatibility
	dataPath := config.GetDataFolderPath() + "/geoip.dat"
	if _, err := os.Stat(dataPath); err == nil {
		return dataPath
	}
	return config.GetBinFolderPath() + "/geoip.dat"
}

// GetIPLimitLogPath returns the path to the IP limit log file.
func GetIPLimitLogPath() string {
	return config.GetLogFolder() + "/3xipl.log"
}

// GetIPLimitBannedLogPath returns the path to the banned IP log file.
func GetIPLimitBannedLogPath() string {
	return config.GetLogFolder() + "/3xipl-banned.log"
}

// GetIPLimitBannedPrevLogPath returns the path to the previous banned IP log file.
func GetIPLimitBannedPrevLogPath() string {
	return config.GetLogFolder() + "/3xipl-banned.prev.log"
}

// GetAccessPersistentLogPath returns the path to the persistent access log file.
func GetAccessPersistentLogPath() string {
	return config.GetLogFolder() + "/3xipl-ap.log"
}

// GetAccessPersistentPrevLogPath returns the path to the previous persistent access log file.
func GetAccessPersistentPrevLogPath() string {
	return config.GetLogFolder() + "/3xipl-ap.prev.log"
}

// GetAccessLogPath reads the Xray config and returns the access log file path.
// Returns an error if the config file doesn't exist (e.g., in multi-node mode).
func GetAccessLogPath() (string, error) {
	configPath := GetConfigPath()
	config, err := os.ReadFile(configPath)
	if err != nil {
		// Don't log warning if file doesn't exist - this is normal in multi-node mode
		if os.IsNotExist(err) {
			return "", err
		}
		logger.Warningf("Failed to read configuration file: %s", err)
		return "", err
	}

	jsonConfig := map[string]any{}
	err = json.Unmarshal([]byte(config), &jsonConfig)
	if err != nil {
		logger.Warningf("Failed to parse JSON configuration: %s", err)
		return "", err
	}

	if jsonConfig["log"] != nil {
		jsonLog := jsonConfig["log"].(map[string]any)
		if jsonLog["access"] != nil {
			accessLogPath := jsonLog["access"].(string)
			return accessLogPath, nil
		}
	}
	return "", err
}

// stopProcess calls Stop on the given Process instance.
func stopProcess(p *Process) {
	p.Stop()
}

// Process wraps an Xray process instance and provides management methods.
type Process struct {
	*process
}

// NewProcess creates a new Xray process and sets up cleanup on garbage collection.
func NewProcess(xrayConfig *Config) *Process {
	p := &Process{newProcess(xrayConfig)}
	runtime.SetFinalizer(p, stopProcess)
	return p
}

type process struct {
	cmd *exec.Cmd

	version string
	apiPort int

	onlineClients []string

	config    *Config
	logWriter *LogWriter
	exitErr   error
	startTime time.Time
}

// newProcess creates a new internal process struct for Xray.
func newProcess(config *Config) *process {
	return &process{
		version:   "Unknown",
		config:    config,
		logWriter: NewLogWriter(),
		startTime: time.Now(),
	}
}

// IsRunning returns true if the Xray process is currently running.
func (p *process) IsRunning() bool {
	if p.cmd == nil || p.cmd.Process == nil {
		return false
	}
	if p.cmd.ProcessState == nil {
		return true
	}
	return false
}

// GetErr returns the last error encountered by the Xray process.
func (p *process) GetErr() error {
	return p.exitErr
}

// GetResult returns the last log line or error from the Xray process.
func (p *process) GetResult() string {
	if len(p.logWriter.lastLine) == 0 && p.exitErr != nil {
		return p.exitErr.Error()
	}
	return p.logWriter.lastLine
}

// GetVersion returns the version string of the Xray process.
func (p *process) GetVersion() string {
	return p.version
}

// GetAPIPort returns the API port used by the Xray process.
func (p *Process) GetAPIPort() int {
	return p.apiPort
}

// GetConfig returns the configuration used by the Xray process.
func (p *Process) GetConfig() *Config {
	return p.config
}

// GetOnlineClients returns the list of online clients for the Xray process.
func (p *Process) GetOnlineClients() []string {
	return p.onlineClients
}

// SetOnlineClients sets the list of online clients for the Xray process.
func (p *Process) SetOnlineClients(users []string) {
	p.onlineClients = users
}

// GetUptime returns the uptime of the Xray process in seconds.
func (p *Process) GetUptime() uint64 {
	return uint64(time.Since(p.startTime).Seconds())
}

// refreshAPIPort updates the API port from the inbound configs.
func (p *process) refreshAPIPort() {
	for _, inbound := range p.config.InboundConfigs {
		if inbound.Tag == "api" {
			p.apiPort = inbound.Port
			break
		}
	}
}

// refreshVersion updates the version string by running the Xray binary with -version.
func (p *process) refreshVersion() {
	if v := GetInstalledVersion(); v != "" {
		p.version = v
	} else {
		p.version = "Unknown"
	}
}

// GetInstalledVersion reports the version of the on-disk Xray binary by running it with
// -version, independent of whether an xray process is currently running. Returns "" if the
// binary is missing or doesn't run. Used to detect drift between the binary an admin pinned
// (see SettingService.GetXrayPinnedVersion) and whatever ended up on disk, e.g. after an image
// update replaced it with the bundled default.
func GetInstalledVersion() string {
	cmd := exec.Command(GetBinaryPath(), "-version")
	data, err := cmd.Output()
	if err != nil {
		return ""
	}
	datas := bytes.Split(data, []byte(" "))
	if len(datas) <= 1 {
		return ""
	}
	return string(datas[1])
}

// Start launches the Xray process with the current configuration.
func (p *process) Start() (err error) {
	if p.IsRunning() {
		return errors.New("xray is already running")
	}

	defer func() {
		if err != nil {
			logger.Error("Failure in running xray-core process: ", err)
			p.exitErr = err
		}
	}()

	err = os.MkdirAll(config.GetLogFolder(), 0o770)
	if err != nil {
		logger.Warningf("Failed to create log folder: %s", err)
	}

	configPath, err := WriteConfigFile(p.config)
	if err != nil {
		return err
	}

	binPath := GetBinaryPath()
	if st, statErr := os.Stat(binPath); statErr != nil || st.IsDir() {
		if statErr == nil {
			statErr = errors.New("path is not a regular file")
		}
		return fmt.Errorf("xray binary not found at %s (expected name %s for this build): %w", binPath, GetBinaryName(), statErr)
	}

	cmd := exec.Command(binPath, "-c", configPath)
	cmd.Stdout = p.logWriter
	cmd.Stderr = p.logWriter

	if err = cmd.Start(); err != nil {
		return fmt.Errorf("failed to start xray: %w", err)
	}
	p.cmd = cmd

	go func() {
		werr := cmd.Wait()
		if werr == nil {
			return
		}
		if runtime.GOOS == "windows" {
			errStr := strings.ToLower(werr.Error())
			if strings.Contains(errStr, "exit status 1") {
				p.exitErr = werr
				return
			}
		}
		logger.Error("Failure in running xray-core:", werr)
		p.exitErr = werr
	}()

	p.refreshVersion()
	p.refreshAPIPort()

	return nil
}

// WriteConfigFile writes the Xray configuration to a file.
// This is used both for starting Xray and for pre-generating config at startup.
// It returns the path to the written config file.
func WriteConfigFile(xrayConfig *Config) (string, error) {
	data, err := json.MarshalIndent(xrayConfig, "", "  ")
	if err != nil {
		return "", common.NewErrorf("Failed to generate XRAY configuration files: %v", err)
	}

	configPath := GetConfigPath()
	// Check if configPath exists and is a directory (can happen with Docker volume mounts)
	// If it's a directory, we can't remove it (it's mounted), so use an alternative path
	if stat, err := os.Stat(configPath); err == nil && stat.IsDir() {
		logger.Warningf("Config path %s is a directory (likely a Docker volume mount), using alternative path", configPath)
		// Try alternative paths in order of preference
		alternativePaths := []string{
			config.GetBinFolderPath() + "/xray-config.json",
			"/app/config/config.json",
			"/tmp/xray-config.json",
		}
		foundAlternative := false
		for _, altPath := range alternativePaths {
			// Check if this path is available (doesn't exist or is a file, not a directory)
			if stat, err := os.Stat(altPath); err != nil {
				// Path doesn't exist, we can use it
				configPath = altPath
				foundAlternative = true
				break
			} else if !stat.IsDir() {
				// Path exists and is a file, we can use it
				configPath = altPath
				foundAlternative = true
				break
			}
		}
		if !foundAlternative {
			return "", common.NewErrorf("Failed to find alternative config path: all paths are directories")
		}
		logger.Infof("Using alternative config path: %s", configPath)
	}
	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(configPath), 0o770); err != nil {
		return "", common.NewErrorf("Failed to create config directory: %v", err)
	}
	if err := os.WriteFile(configPath, data, fs.ModePerm); err != nil {
		return "", common.NewErrorf("Failed to write configuration file: %v", err)
	}
	return configPath, nil
}

// Stop terminates the running Xray process: SIGTERM (Unix) or Kill (Windows), wait for exit,
// then SIGKILL on Unix if still running. Merely signaling without waiting left Xray listening
// while the API already returned success.
func (p *process) Stop() error {
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	if !p.IsRunning() {
		return nil
	}

	proc := p.cmd.Process

	if runtime.GOOS == "windows" {
		if err := proc.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
	} else {
		if err := proc.Signal(syscall.SIGTERM); err != nil {
			if errors.Is(err, os.ErrProcessDone) || !p.IsRunning() {
				return nil
			}
			return err
		}
	}

	deadline := time.Now().Add(xrayStopGracePeriod)
	for p.IsRunning() && time.Now().Before(deadline) {
		time.Sleep(xrayStopPoll)
	}
	if !p.IsRunning() {
		return nil
	}

	if runtime.GOOS != "windows" {
		logger.Warningf("xray did not exit after SIGTERM (pid %d), sending SIGKILL", proc.Pid)
		if err := proc.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
		deadline = time.Now().Add(xrayStopKillWait)
		for p.IsRunning() && time.Now().Before(deadline) {
			time.Sleep(xrayStopPoll)
		}
	}

	if p.IsRunning() {
		return fmt.Errorf("xray process %d still running after stop", proc.Pid)
	}
	return nil
}

// writeCrashReport writes a crash report to the binary folder with a timestamped filename.
func writeCrashReport(m []byte) error {
	crashReportPath := config.GetBinFolderPath() + "/core_crash_" + time.Now().Format("20060102_150405") + ".log"
	return os.WriteFile(crashReportPath, m, os.ModePerm)
}
