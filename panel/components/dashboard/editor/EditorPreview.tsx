"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TileSettings } from "@/lib/dashboardBuilder";
import { TilePreview } from "../GridTile";
import { useElementBox } from "../useTileBox";

const MAX_H = 300;

/** Size of the tile on the board in px: measured from the live tile, else derived from the grid (12 columns, 40 px rows, 16 px gaps). */
function tileSize(id: string, w: number, h: number): { w: number; h: number } {
  if (typeof document === "undefined") return { w: 400, h: 200 };
  const el = document.querySelector<HTMLElement>(`[data-dashboard-tile="${id.replace(/["\\]/g, "")}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 40 && r.height > 40) return { w: Math.round(r.width), h: Math.round(r.height) };
  }
  const board = document.querySelector<HTMLElement>(".dashboard-grid");
  const total = Math.max(480, board?.clientWidth ?? 1100);
  const col = (total - 16 * 11) / 12;
  return { w: Math.round(w * col + (w - 1) * 16), h: h * 40 + (h - 1) * 16 };
}

/**
 * Live preview at the tile's real size (scaled down to fit the drawer, container queries see the real size).
 * Every change of the draft re-renders it immediately.
 */
export function EditorPreview({ tileId, title, settings, children }: { tileId: string; title: string; settings: TileSettings; children: ReactNode }) {
  const { t } = useTranslation();
  const { ref, width: avail } = useElementBox();
  const [size, setSize] = useState({ w: 480, h: 220 });
  useEffect(() => {
    // The tile on the board is the source of truth for an existing tile; a new tile uses its chosen initial size.
    setSize(tileSize(tileId, settings.width, settings.height));
  }, [tileId, settings.width, settings.height]);
  const scale = avail > 0 ? Math.min(1, (avail - 2) / size.w, MAX_H / size.h) : 1;
  return (
    <div className="sticky top-0 z-20 -mx-5 -mt-4 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-5 pb-3 pt-4" role="group" aria-label={t("pages.builder.preview")}>
      <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
        <span>{t("pages.builder.preview")}</span>
        <span className="font-mono normal-case tabular-nums text-[var(--fg-subtle)]">
          {size.w}×{size.h}px{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ""}
        </span>
      </p>
      <div ref={ref} className="flex justify-center overflow-hidden" style={{ height: size.h * scale }}>
        <div style={{ width: size.w * scale, height: size.h * scale }}>
          <div style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <TilePreview width={size.w} height={size.h} title={title} frame={{ style: settings.style, color: settings.color }}>
              {children}
            </TilePreview>
          </div>
        </div>
      </div>
    </div>
  );
}
