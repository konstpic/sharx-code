import { Surface } from "@/components/panel";

/** Alternative "stat" / "table" views offered by the built-in tiles; same data, modern look. */
export function metricTileViews(rows: { label: string; value: string }[]) {
  return {
    stat: (
      <Surface className="h-full">
        <div className="grid grid-cols-2 gap-3">
          {rows.map((r) => (
            <div key={r.label} className="dash-card min-w-0 rounded-2xl border border-[var(--border)] p-3.5">
              <p className="truncate text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={r.label}>
                {r.label}
              </p>
              <p className="mt-2 break-words font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums text-[var(--accent)]">{r.value}</p>
            </div>
          ))}
        </div>
      </Surface>
    ),
    table: (
      <Surface className="h-full">
        <div className="divide-y divide-[color-mix(in_oklab,var(--fg)_8%,transparent)] rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,transparent)]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]">{r.label}</span>
              <span className="font-mono font-medium tabular-nums text-[var(--fg)]">{r.value}</span>
            </div>
          ))}
        </div>
      </Surface>
    ),
  };
}
