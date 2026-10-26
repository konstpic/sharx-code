// Package service provides Prometheus metrics export functionality for SharX panel.
package service

import (
	"fmt"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

var (
	metricsMu       sync.RWMutex
	userAgentCounts = make(map[string]int64)
	userAgentMu     sync.RWMutex
)

// Sign-in event counters, exported as xui_login_failures_total / xui_login_bans_total (see controller.loginFailed).
var (
	LoginFailuresTotal atomic.Int64
	LoginBansTotal     atomic.Int64
)

// metricWriter writes Prometheus text blocks (HELP, TYPE, samples).
type metricWriter struct{ b *strings.Builder }

func (w metricWriter) head(name, help, typ string) {
	fmt.Fprintf(w.b, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, typ)
}

func (w metricWriter) sample(name, labels string, v any) {
	if labels != "" {
		labels = "{" + labels + "}"
	}
	fmt.Fprintf(w.b, "%s%s %v\n", name, labels, v)
}

func (w metricWriter) one(name, help, typ string, v any) {
	w.head(name, help, typ)
	w.sample(name, "", v)
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func lbl(k, v string) string { return k + `="` + escapeLabelValue(v) + `"` }

// collectExtraMetrics adds the panel build, runtime, security, client-lifecycle and per-node core metrics.
func collectExtraMetrics(b *strings.Builder, status *Status, nodes []*model.Node) {
	w := metricWriter{b}
	w.head("xui_build_info", "Panel build information", "gauge")
	w.sample("xui_build_info", lbl("version", config.GetVersion()), 1)

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	w.one("xui_go_goroutines", "Number of goroutines of the panel process", "gauge", runtime.NumGoroutine())
	w.one("xui_go_heap_alloc_bytes", "Heap bytes allocated by the panel process", "gauge", ms.HeapAlloc)
	w.one("xui_go_gc_cycles_total", "Completed garbage collection cycles", "counter", ms.NumGC)

	w.one("xui_login_failures_total", "Failed sign-in attempts since the panel started", "counter", LoginFailuresTotal.Load())
	w.one("xui_login_bans_total", "Sign-in bans issued since the panel started", "counter", LoginBansTotal.Load())

	if status != nil {
		w.one("xui_panel_uptime_seconds", "Panel process uptime in seconds", "gauge", status.PanelUptime)
		w.one("xui_users_online", "Clients currently online", "gauge", status.UsersOnline)
		w.head("xui_nodes_xray", "Worker nodes by Xray state", "gauge")
		for state, n := range map[string]int{"running": status.NodesXray.Running, "stopped": status.NodesXray.Stopped, "error": status.NodesXray.Error, "unknown": status.NodesXray.Unknown} {
			w.sample("xui_nodes_xray", lbl("state", state), n)
		}
		w.head("xui_nodes_telemt", "Worker nodes by Telemt state", "gauge")
		for state, n := range map[string]int{"running": status.NodesTelemt.Running, "stopped": status.NodesTelemt.Stopped, "unknown": status.NodesTelemt.Unknown} {
			w.sample("xui_nodes_telemt", lbl("state", state), n)
		}
		w.one("xui_telemt_running", "Local Telemt sidecars running (standalone panel)", "gauge", boolInt(status.Telemt.State == "running"))
	}

	if len(nodes) > 0 {
		w.head("xui_node_enabled", "Node enabled in the panel (1) or paused (0)", "gauge")
		w.head("xui_node_xray_up", "Xray on the node is running (1) or not (0)", "gauge")
		w.head("xui_node_telemt_up", "Telemt on the node is running (1) or not (0)", "gauge")
		w.head("xui_node_amneziawg_up", "AmneziaWG on the node is running (1) or not (0)", "gauge")
		w.head("xui_node_info", "Node core and worker versions", "gauge")
		w.head("xui_node_last_check_timestamp_seconds", "Unix time of the node's last health check", "gauge")
		w.head("xui_node_traffic_limit_bytes", "Node traffic limit in bytes (0 = unlimited)", "gauge")
		for _, n := range nodes {
			id := lbl("node", n.Name) + "," + lbl("node_id", fmt.Sprint(n.Id))
			w.sample("xui_node_enabled", id, boolInt(n.Enable))
			w.sample("xui_node_xray_up", id, boolInt(n.XrayState == "running"))
			w.sample("xui_node_telemt_up", id, boolInt(n.TelemtState == model.NodeTelemtRunning))
			w.sample("xui_node_amneziawg_up", id, boolInt(n.AmneziaWgState == model.NodeAmneziaWgRunning))
			w.sample("xui_node_info", id+","+lbl("xray_version", n.XrayVersion)+","+lbl("telemt_version", n.TelemtVersion)+","+lbl("worker_version", n.WorkerVersion), 1)
			w.sample("xui_node_last_check_timestamp_seconds", id, n.LastCheck)
			w.sample("xui_node_traffic_limit_bytes", id, int64(n.TrafficLimitGB*(1<<30)))
		}
	}

	db := database.GetDB()
	nowMs := time.Now().UnixMilli()
	var expired, exhausted, hwids, groups, orgs int64
	db.Model(&model.ClientEntity{}).Where("expiry_time > 0 AND expiry_time < ?", nowMs).Count(&expired)
	db.Model(&model.ClientEntity{}).Where("total_gb > 0 AND (up + down) >= total_gb * 1073741824").Count(&exhausted)
	db.Model(&model.ClientHWID{}).Count(&hwids)
	db.Model(&model.ClientGroup{}).Count(&groups)
	db.Model(&model.Organization{}).Count(&orgs)
	w.one("xui_clients_expired", "Clients whose expiry time has passed", "gauge", expired)
	w.one("xui_clients_traffic_exhausted", "Clients that used up their traffic limit", "gauge", exhausted)
	w.one("xui_hwid_devices_total", "Registered client devices (HWID)", "gauge", hwids)
	w.one("xui_client_groups_total", "Client groups", "gauge", groups)
	w.one("xui_organizations_total", "Organizations", "gauge", orgs)
}

// InitMetricsExporter initializes the metrics exporter
// Metrics are exposed via /panel/metrics endpoint for Prometheus/Grafana scraping
func InitMetricsExporter() {
	// Metrics are collected on-demand when /panel/metrics endpoint is accessed
	// No initialization needed - just ensure the endpoint is available
}

// RecordUserAgent records a User-Agent request from subscription server
func RecordUserAgent(userAgent string) {
	if userAgent == "" {
		userAgent = "unknown"
	}
	// Normalize User-Agent: take first part before space (e.g., "Happ/1.0.0" -> "Happ")
	parts := strings.Fields(userAgent)
	if len(parts) > 0 {
		// Remove version numbers and keep only the main identifier
		normalized := strings.Split(parts[0], "/")[0]
		if normalized == "" {
			normalized = "unknown"
		}
		userAgent = normalized
	}

	userAgentMu.Lock()
	defer userAgentMu.Unlock()
	userAgentCounts[userAgent]++
}

// CollectMetrics collects all metrics and returns them in Prometheus format
func CollectMetrics() string {
	var builder strings.Builder

	// Get server status
	serverService := &ServerService{}
	status := serverService.GetStatus(nil)
	if status != nil {
		// System metrics
		builder.WriteString(fmt.Sprintf("# HELP xui_cpu_usage CPU usage percentage\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_cpu_usage gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_cpu_usage %.2f\n", status.Cpu))

		builder.WriteString(fmt.Sprintf("# HELP xui_cpu_cores Number of CPU cores\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_cpu_cores gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_cpu_cores %d\n", status.CpuCores))

		builder.WriteString(fmt.Sprintf("# HELP xui_memory_bytes Memory usage in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_memory_bytes gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_memory_bytes{type=\"used\"} %d\n", status.Mem.Current))
		builder.WriteString(fmt.Sprintf("xui_memory_bytes{type=\"total\"} %d\n", status.Mem.Total))

		builder.WriteString(fmt.Sprintf("# HELP xui_swap_bytes Swap usage in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_swap_bytes gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_swap_bytes{type=\"used\"} %d\n", status.Swap.Current))
		builder.WriteString(fmt.Sprintf("xui_swap_bytes{type=\"total\"} %d\n", status.Swap.Total))

		builder.WriteString(fmt.Sprintf("# HELP xui_disk_bytes Disk usage in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_disk_bytes gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_disk_bytes{type=\"used\"} %d\n", status.Disk.Current))
		builder.WriteString(fmt.Sprintf("xui_disk_bytes{type=\"total\"} %d\n", status.Disk.Total))

		builder.WriteString(fmt.Sprintf("# HELP xui_load_average System load average\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_load_average gauge\n"))
		if len(status.Loads) >= 1 {
			builder.WriteString(fmt.Sprintf("xui_load_average{period=\"1m\"} %.2f\n", status.Loads[0]))
		}
		if len(status.Loads) >= 2 {
			builder.WriteString(fmt.Sprintf("xui_load_average{period=\"5m\"} %.2f\n", status.Loads[1]))
		}
		if len(status.Loads) >= 3 {
			builder.WriteString(fmt.Sprintf("xui_load_average{period=\"15m\"} %.2f\n", status.Loads[2]))
		}

		builder.WriteString(fmt.Sprintf("# HELP xui_network_io_bytes Network I/O in bytes per second\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_network_io_bytes gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_network_io_bytes{direction=\"up\"} %d\n", status.NetIO.Up))
		builder.WriteString(fmt.Sprintf("xui_network_io_bytes{direction=\"down\"} %d\n", status.NetIO.Down))

		builder.WriteString(fmt.Sprintf("# HELP xui_network_traffic_bytes Total network traffic in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_network_traffic_bytes counter\n"))
		builder.WriteString(fmt.Sprintf("xui_network_traffic_bytes{direction=\"sent\"} %d\n", status.NetTraffic.Sent))
		builder.WriteString(fmt.Sprintf("xui_network_traffic_bytes{direction=\"recv\"} %d\n", status.NetTraffic.Recv))

		builder.WriteString(fmt.Sprintf("# HELP xui_connections_count Number of connections\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_connections_count gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_connections_count{type=\"tcp\"} %d\n", status.TcpCount))
		builder.WriteString(fmt.Sprintf("xui_connections_count{type=\"udp\"} %d\n", status.UdpCount))

		// Xray metrics
		xrayState := 0
		if status.Xray.State == "running" {
			xrayState = 1
		}
		builder.WriteString(fmt.Sprintf("# HELP xui_xray_state Xray process state (1=running, 0=stopped)\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_xray_state gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_xray_state %d\n", xrayState))

		builder.WriteString(fmt.Sprintf("# HELP xui_xray_version_info Xray version information\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_xray_version_info gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_xray_version_info{version=\"%s\"} 1\n", escapeLabelValue(status.Xray.Version)))

		// Application metrics
		builder.WriteString(fmt.Sprintf("# HELP xui_app_uptime_seconds Application uptime in seconds\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_app_uptime_seconds gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_app_uptime_seconds %d\n", status.AppStats.Uptime))

		builder.WriteString(fmt.Sprintf("# HELP xui_app_threads Number of application threads\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_app_threads gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_app_threads %d\n", status.AppStats.Threads))

		builder.WriteString(fmt.Sprintf("# HELP xui_app_memory_bytes Application memory usage in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_app_memory_bytes gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_app_memory_bytes %d\n", status.AppStats.Mem))

		// Database metrics
		builder.WriteString(fmt.Sprintf("# HELP xui_database_size_bytes Database size in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_database_size_bytes gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_database_size_bytes %d\n", status.Database.Size))

		builder.WriteString(fmt.Sprintf("# HELP xui_database_tables Number of database tables\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_database_tables gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_database_tables %d\n", status.Database.Tables))

		builder.WriteString(fmt.Sprintf("# HELP xui_database_rows_total Total number of rows in database\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_database_rows_total gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_database_rows_total %d\n", status.Database.TotalRows))

		builder.WriteString(fmt.Sprintf("# HELP xui_database_connections Database connection pool statistics\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_database_connections gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_database_connections{state=\"open\"} %d\n", status.Database.OpenConns))
		builder.WriteString(fmt.Sprintf("xui_database_connections{state=\"idle\"} %d\n", status.Database.IdleConns))
		builder.WriteString(fmt.Sprintf("xui_database_connections{state=\"max_open\"} %d\n", status.Database.MaxOpenConns))
		builder.WriteString(fmt.Sprintf("xui_database_connections{state=\"max_idle\"} %d\n", status.Database.MaxIdleConns))

		// Node metrics (multi-node mode)
		builder.WriteString(fmt.Sprintf("# HELP xui_nodes_total Total number of nodes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_nodes_total gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_nodes_total %d\n", status.Nodes.Total))

		builder.WriteString(fmt.Sprintf("# HELP xui_nodes_online Number of online nodes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_nodes_online gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_nodes_online %d\n", status.Nodes.Online))
	}

	// Inbound metrics
	inboundService := &InboundService{}
	inbounds, err := inboundService.GetAllInbounds()
	if err == nil {
		builder.WriteString(fmt.Sprintf("# HELP xui_inbounds_total Total number of inbounds\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_inbounds_total gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_inbounds_total %d\n", len(inbounds)))

		enabledCount := 0
		// Define metrics once outside the loop
		builder.WriteString(fmt.Sprintf("# HELP xui_inbound_traffic_bytes Traffic per inbound in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_inbound_traffic_bytes counter\n"))
		builder.WriteString(fmt.Sprintf("# HELP xui_inbound_state Inbound state (1=enabled, 0=disabled)\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_inbound_state gauge\n"))

		for _, inbound := range inbounds {
			if inbound.Enable {
				enabledCount++
			}

			// Traffic per inbound
			builder.WriteString(fmt.Sprintf("xui_inbound_traffic_bytes{inbound=\"%s\",direction=\"up\"} %d\n",
				escapeLabelValue(inbound.Tag), inbound.Up))
			builder.WriteString(fmt.Sprintf("xui_inbound_traffic_bytes{inbound=\"%s\",direction=\"down\"} %d\n",
				escapeLabelValue(inbound.Tag), inbound.Down))
			builder.WriteString(fmt.Sprintf("xui_inbound_traffic_bytes{inbound=\"%s\",direction=\"total\"} %d\n",
				escapeLabelValue(inbound.Tag), inbound.Total))

			// Inbound state
			inboundState := 0
			if inbound.Enable {
				inboundState = 1
			}
			builder.WriteString(fmt.Sprintf("xui_inbound_state{inbound=\"%s\"} %d\n",
				escapeLabelValue(inbound.Tag), inboundState))
		}

		builder.WriteString(fmt.Sprintf("# HELP xui_inbounds_enabled Number of enabled inbounds\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_inbounds_enabled gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_inbounds_enabled %d\n", enabledCount))
	}

	// Client metrics
	db := database.GetDB()
	var clients []*model.ClientEntity
	err = db.Model(model.ClientEntity{}).Find(&clients).Error
	if err == nil {
		builder.WriteString(fmt.Sprintf("# HELP xui_clients_total Total number of clients\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_clients_total gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_clients_total %d\n", len(clients)))

		enabledClientCount := 0
		// Define metrics once outside the loop
		builder.WriteString(fmt.Sprintf("# HELP xui_client_traffic_bytes Traffic per client in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_client_traffic_bytes counter\n"))
		builder.WriteString(fmt.Sprintf("# HELP xui_client_state Client state (1=enabled, 0=disabled)\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_client_state gauge\n"))

		for _, client := range clients {
			if client.Enable {
				enabledClientCount++
			}

			// Traffic per client
			builder.WriteString(fmt.Sprintf("xui_client_traffic_bytes{client=\"%s\",direction=\"up\"} %d\n",
				escapeLabelValue(client.Name), client.Up))
			builder.WriteString(fmt.Sprintf("xui_client_traffic_bytes{client=\"%s\",direction=\"down\"} %d\n",
				escapeLabelValue(client.Name), client.Down))
			builder.WriteString(fmt.Sprintf("xui_client_traffic_bytes{client=\"%s\",direction=\"total\"} %d\n",
				escapeLabelValue(client.Name), client.AllTime))

			// Client state
			clientState := 0
			if client.Enable {
				clientState = 1
			}
			builder.WriteString(fmt.Sprintf("xui_client_state{client=\"%s\"} %d\n",
				escapeLabelValue(client.Name), clientState))
		}

		builder.WriteString(fmt.Sprintf("# HELP xui_clients_enabled Number of enabled clients\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_clients_enabled gauge\n"))
		builder.WriteString(fmt.Sprintf("xui_clients_enabled %d\n", enabledClientCount))
	}

	// Node traffic metrics (multi-node mode)
	nodeService := &NodeService{}
	nodes, err := nodeService.GetAllNodes()
	if err == nil && len(nodes) > 0 {
		// Define metrics once outside the loop
		builder.WriteString(fmt.Sprintf("# HELP xui_node_traffic_bytes Traffic per node in bytes\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_node_traffic_bytes counter\n"))
		builder.WriteString(fmt.Sprintf("# HELP xui_node_state Node state (1=online, 0=offline)\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_node_state gauge\n"))
		builder.WriteString(fmt.Sprintf("# HELP xui_node_response_time_ms Node response time in milliseconds\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_node_response_time_ms gauge\n"))

		for _, node := range nodes {
			builder.WriteString(fmt.Sprintf("xui_node_traffic_bytes{node=\"%s\",node_id=\"%d\",direction=\"up\"} %d\n",
				escapeLabelValue(node.Name), node.Id, node.Up))
			builder.WriteString(fmt.Sprintf("xui_node_traffic_bytes{node=\"%s\",node_id=\"%d\",direction=\"down\"} %d\n",
				escapeLabelValue(node.Name), node.Id, node.Down))
			builder.WriteString(fmt.Sprintf("xui_node_traffic_bytes{node=\"%s\",node_id=\"%d\",direction=\"total\"} %d\n",
				escapeLabelValue(node.Name), node.Id, node.AllTime))

			// Node state
			nodeState := 0
			if node.Status == "online" {
				nodeState = 1
			}
			builder.WriteString(fmt.Sprintf("xui_node_state{node=\"%s\",node_id=\"%d\"} %d\n",
				escapeLabelValue(node.Name), node.Id, nodeState))

			builder.WriteString(fmt.Sprintf("xui_node_response_time_ms{node=\"%s\",node_id=\"%d\"} %d\n",
				escapeLabelValue(node.Name), node.Id, node.ResponseTime))
		}
	}

	collectExtraMetrics(&builder, status, nodes)

	// User Agent metrics (subscription server)
	userAgentMu.RLock()
	if len(userAgentCounts) > 0 {
		builder.WriteString(fmt.Sprintf("# HELP xui_subscription_user_agent_total Total subscription requests by User-Agent\n"))
		builder.WriteString(fmt.Sprintf("# TYPE xui_subscription_user_agent_total counter\n"))
		for ua, count := range userAgentCounts {
			builder.WriteString(fmt.Sprintf("xui_subscription_user_agent_total{user_agent=\"%s\"} %d\n",
				escapeLabelValue(ua), count))
		}
	}
	userAgentMu.RUnlock()

	return builder.String()
}

// escapeLabelValue escapes special characters in Prometheus label values
func escapeLabelValue(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.ReplaceAll(value, "\n", "\\n")
	return value
}
