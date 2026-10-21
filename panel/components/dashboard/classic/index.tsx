"use client";
/** The classic (v2.6) dashboard widgets as tile bodies: `ClassicWidget` maps a catalog widget id to its component. */
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicBackup } from "./ClassicBackup";
import { ClassicCores } from "./ClassicCores";
import { ClassicDatabase } from "./ClassicDatabase";
import { ClassicLogs } from "./ClassicLogs";
import { ClassicNetwork } from "./ClassicNetwork";
import { ClassicPanelRuntime } from "./ClassicPanelRuntime";
import { ClassicResources } from "./ClassicResources";
import { ClassicUptime } from "./ClassicUptime";
import { ClassicUserAgent } from "./ClassicUserAgent";
import { ClassicUsersOnline } from "./ClassicUsersOnline";

export function ClassicWidget({ widget, env }: { widget: string; env: AtomEnv }) {
  switch (widget) {
    case "classic_resources":
      return <ClassicResources env={env} />;
    case "classic_logs":
      return <ClassicLogs env={env} />;
    case "classic_cores":
      return <ClassicCores env={env} />;
    case "classic_backup":
      return <ClassicBackup env={env} />;
    case "classic_uptime":
      return <ClassicUptime env={env} />;
    case "classic_users_online":
      return <ClassicUsersOnline env={env} />;
    case "classic_user_agent":
      return <ClassicUserAgent env={env} />;
    case "classic_database":
      return <ClassicDatabase env={env} />;
    case "classic_runtime":
      return <ClassicPanelRuntime env={env} />;
    case "classic_network":
      return <ClassicNetwork env={env} />;
    default:
      return null;
  }
}
