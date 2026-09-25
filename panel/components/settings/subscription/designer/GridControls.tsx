"use client";

import { Grid3x3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { D } from "./i18n";
import { SmallBtn } from "./ui";

export type GridSettings = { enabled: boolean; snap: boolean; step: number };

export const GRID_DEFAULT: GridSettings = { enabled: false, snap: true, step: 8 };
export const GRID_STEPS = [4, 8, 10, 16, 24, 32];
const KEY = "sharx.designer.grid";

export function clampStep(n: number): number {
  return Number.isFinite(n) ? Math.max(2, Math.min(100, Math.round(n))) : GRID_DEFAULT.step;
}

/** Snaps a value to the nearest multiple of the step. */
export function snapTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Grid settings persisted in localStorage (enabled, snap, step). */
export function useGridSettings(): [GridSettings, (patch: Partial<GridSettings>) => void, () => void] {
  const [g, setG] = useState<GridSettings>(GRID_DEFAULT);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as Partial<GridSettings>;
      setG({ enabled: j.enabled === true, snap: j.snap !== false, step: clampStep(Number(j.step ?? GRID_DEFAULT.step)) });
    } catch {
      /* storage unavailable */
    }
  }, []);
  const save = (next: GridSettings) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const update = useCallback((patch: Partial<GridSettings>) => {
    setG((cur) => {
      const next = { ...cur, ...patch, step: clampStep(patch.step ?? cur.step) };
      save(next);
      return next;
    });
  }, []);
  const toggle = useCallback(() => {
    setG((cur) => {
      const next = { ...cur, enabled: !cur.enabled };
      save(next);
      return next;
    });
  }, []);
  return [g, update, toggle];
}

/** Grid lines drawn over the page (below selection overlays); pointer-events none. */
export function GridOverlay({ step, lines, zoom, flash }: { step: number; lines: boolean; zoom: number; flash?: { v: number[]; h: number[] } | null }) {
  const line = "rgba(120,140,255,.22)";
  const major = "rgba(120,140,255,.32)";
  const lw = 1 / Math.max(zoom, 0.25);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {lines ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to right, ${line} ${lw}px, transparent ${lw}px), linear-gradient(to bottom, ${line} ${lw}px, transparent ${lw}px)`,
            backgroundSize: `${step}px ${step}px`,
          }}
        />
      ) : null}
      {lines && step < 16 ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to right, ${major} ${lw}px, transparent ${lw}px), linear-gradient(to bottom, ${major} ${lw}px, transparent ${lw}px)`,
            backgroundSize: `${step * 4}px ${step * 4}px`,
          }}
        />
      ) : null}
      {flash?.v.map((x, i) => <div key={`fv${i}`} className="absolute top-0 h-full bg-[#22d3ee]" style={{ left: x, width: lw * 1.5 }} />)}
      {flash?.h.map((y, i) => <div key={`fh${i}`} className="absolute left-0 w-full bg-[#22d3ee]" style={{ top: y, height: lw * 1.5 }} />)}
    </div>
  );
}

/** Toolbar control: popover with grid toggle, snap toggle and step. */
export function GridControls({ grid, onChange, d }: { grid: GridSettings; onChange: (p: Partial<GridSettings>) => void; d: D }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open]);
  const cb = "flex cursor-pointer items-center gap-2 text-xs";
  return (
    <div ref={ref} className="relative" data-tour="grid-button">
      <SmallBtn title={d("grid.tip", "Grid and snapping (G)")} active={grid.enabled || open} onClick={() => setOpen((o) => !o)}>
        <Grid3x3 size={15} />
      </SmallBtn>
      {open ? (
        <div className="absolute left-0 top-9 z-[450] w-56 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-2xl">
          <label className={cb}>
            <input type="checkbox" checked={grid.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
            {d("grid.show", "Show grid")} <span className="text-[var(--fg-subtle)]">G</span>
          </label>
          <label className={`${cb} mt-2`} title={d("grid.snapHint", "Hold Alt while dragging to snap temporarily off")}>
            <input type="checkbox" checked={grid.snap} onChange={(e) => onChange({ snap: e.target.checked })} />
            {d("grid.snap", "Snap to grid")}
          </label>
          <div className="mt-3 text-[11px] text-[var(--fg-muted)]">{d("grid.step", "Step, px")}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {GRID_STEPS.map((s) => (
              <button key={s} type="button" onClick={() => onChange({ step: s })} className={`h-7 min-w-8 rounded-md border px-1.5 text-xs tabular-nums ${grid.step === s ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)]" : "border-[var(--border)] text-[var(--fg-muted)]"}`}>
                {s}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={2}
            max={100}
            value={grid.step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 2 && n <= 100) onChange({ step: n });
            }}
            aria-label={d("grid.custom", "Custom step")}
            className="mt-2 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">{d("grid.nudgeHint", "Arrows nudge by one step, Shift by ten. Alt disables snapping while dragging.")}</p>
        </div>
      ) : null}
    </div>
  );
}
