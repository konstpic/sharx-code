/** Per-node resource history (percent values, oldest first) parsed from the server history endpoints. */
export type NodeLoad = { cpu: number[]; mem: number[]; disk: number[] };

type SeriesRow = {
  key?: string;
  points?: { cpu?: number; mem?: number; disk?: number; v?: number }[];
};

const NODE_KEY = /^node-(\d+)$/;

/** Reads `{ series: [{ key: "node-7", points: [...] }] }` into { 7: [12, 15, ...] } for one metric. */
export function parseSeriesByNode(obj: unknown, metric: "cpu" | "mem" | "disk"): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  const series = (obj as { series?: SeriesRow[] } | null)?.series;
  if (!Array.isArray(series)) return out;
  for (const row of series) {
    const m = NODE_KEY.exec(row.key ?? "");
    if (!m || !Array.isArray(row.points)) continue;
    out[Number(m[1])] = row.points.map((p) => {
      const raw = Number(p[metric] ?? p.v);
      return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    });
  }
  return out;
}

export function mergeNodeLoad(
  cpu: Record<number, number[]>,
  mem: Record<number, number[]>,
  disk: Record<number, number[]>,
): Record<number, NodeLoad> {
  const ids = new Set([...Object.keys(cpu), ...Object.keys(mem), ...Object.keys(disk)].map(Number));
  const out: Record<number, NodeLoad> = {};
  for (const id of ids) out[id] = { cpu: cpu[id] ?? [], mem: mem[id] ?? [], disk: disk[id] ?? [] };
  return out;
}

/** green < 60, amber < 85, red above. */
export function loadTone(pct: number): "ok" | "warn" | "high" {
  return pct >= 85 ? "high" : pct >= 60 ? "warn" : "ok";
}
