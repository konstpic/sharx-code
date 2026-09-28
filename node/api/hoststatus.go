package api

import (
	"github.com/konstpic/sharx-code/v2/util/sys"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
)

// hostMetricsForStatusJSON returns host CPU (0–100) and memory usage for merging into GET /api/v1/status.
func hostMetricsForStatusJSON() map[string]interface{} {
	out := make(map[string]interface{})
	cpuPct := 0.0
	if p, err := sys.CPUPercentRaw(); err == nil {
		cpuPct = p
		if cpuPct < 0 {
			cpuPct = 0
		}
		if cpuPct > 100 {
			cpuPct = 100
		}
	}
	out["hostCpu"] = cpuPct
	vm, err := mem.VirtualMemory()
	if err != nil || vm == nil {
		out["hostMem"] = map[string]interface{}{"current": uint64(0), "total": uint64(0)}
		return out
	}
	out["hostMem"] = map[string]interface{}{
		"current": vm.Used,
		"total":   vm.Total,
	}
	if du, err := disk.Usage("/"); err == nil && du != nil {
		out["hostDisk"] = map[string]interface{}{
			"current": du.Used,
			"total":   du.Total,
		}
	} else {
		out["hostDisk"] = map[string]interface{}{"current": uint64(0), "total": uint64(0)}
	}
	bps, iface := netLoad.snapshot()
	out["hostNetBps"] = bps
	out["hostNetIface"] = iface
	return out
}
