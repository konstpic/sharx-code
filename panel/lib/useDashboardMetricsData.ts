"use client";
// Loads GET /panel/api/server/dashboardMetrics (per-node / per-balancer snapshots, cached ~8 s on the server) and turns it
// into dashboard metrics. Usage in DashboardPage (after the existing `metrics` memo, which is renamed `baseMetrics`):
//   const extra = useDashboardMetricsData(t, layout.panels.flatMap((p) => p.metrics), baseMetrics.map((m) => m.id));
//   const metrics = useMemo(() => [...baseMetrics, ...extra], [baseMetrics, extra]);
import {useEffect, useMemo, useRef, useState} from "react";
import {getJson} from "./api";
import {panel} from "./paths";
import type {DashboardMetric, MetricPoint} from "./dashboardMetrics";
import type {DashboardMetricsPayload} from "./dashboardMetricsNodes";
import {entityMetrics, unavailableMetrics} from "./dashboardMetricsCatalog";

const POLL_MS = 10_000;
const KEEP = 120;

export function useDashboardMetricsData(t: (key: string) => string, referencedIds: string[], availableIds: string[]): DashboardMetric[] {
  const [data, setData] = useState<DashboardMetricsPayload | null>(null);
  const history = useRef<Record<string, MetricPoint[]>>({});
  const [, bump] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await getJson<DashboardMetricsPayload>(panel("api/server/dashboardMetrics"));
        if (stop || !r.success || !r.obj) return;
        const at = r.obj.at || Date.now();
        for (const m of entityMetrics(r.obj, (k) => k)) {
          if (m.value == null) continue;
          const old = history.current[m.id] ?? [];
          if (!old.length || at - old[old.length - 1].ts >= 5000) history.current[m.id] = [...old.slice(-(KEEP - 1)), {ts: at, value: m.value}];
        }
        setData(r.obj);
        bump((n) => n + 1);
      } catch {
        /* old backend, no permission or offline: the panels simply show "no data" */
      }
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const refKey = referencedIds.join("\n");
  const availKey = availableIds.join("\n");
  return useMemo(() => {
    const list = entityMetrics(data, t).map((m) => ({...m, history: "session" as const, points: history.current[m.id] ?? []}));
    const known = [...availKey.split("\n"), ...list.map((m) => m.id)];
    // Placeholders only once the first answer arrived, otherwise every saved node metric would flash as "unavailable" on load.
    const gone = data ? unavailableMetrics(refKey ? refKey.split("\n") : [], known, t) : [];
    return [...list, ...gone];
  }, [data, t, refKey, availKey]);
}
