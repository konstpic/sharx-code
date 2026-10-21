"use client";
/** The v2.7.1 dashboard tiles: `V271Widget` maps a catalog widget id (`v271_*`) to its component. */
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { V271CpuHistory, V271MemoryHistory, V271NetSockets, V271NetSpeed, V271NetTraffic, V271ServerIp } from "./V271Network";
import { V271Resources } from "./V271Resources";
import { V271Backup, V271CoreVersions, V271Database, V271Logs, V271PanelRuntime, V271UserAgent, V271Uptime, V271UsersOnline } from "./V271Tiles";

export function V271Widget({ widget, env }: { widget: string; env: AtomEnv }) {
  switch (widget) {
    case "v271_resources":
      return <V271Resources env={env} />;
    case "v271_logs":
      return <V271Logs env={env} />;
    case "v271_core_versions":
      return <V271CoreVersions env={env} />;
    case "v271_backup":
      return <V271Backup env={env} />;
    case "v271_uptime":
      return <V271Uptime env={env} />;
    case "v271_users_online":
      return <V271UsersOnline env={env} />;
    case "v271_user_agent":
      return <V271UserAgent env={env} />;
    case "v271_database":
      return <V271Database env={env} />;
    case "v271_net_speed":
      return <V271NetSpeed env={env} />;
    case "v271_net_traffic":
      return <V271NetTraffic env={env} />;
    case "v271_net_sockets":
      return <V271NetSockets env={env} />;
    case "v271_server_ip":
      return <V271ServerIp env={env} />;
    case "v271_panel_runtime":
      return <V271PanelRuntime env={env} />;
    case "v271_cpu_history":
      return <V271CpuHistory env={env} />;
    case "v271_memory_history":
      return <V271MemoryHistory env={env} />;
    default:
      return null;
  }
}
