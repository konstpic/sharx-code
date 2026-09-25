"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Star } from "lucide-react";
import { SubPageShell } from "@/components/sub/SubPageShell";
import { LayoutRenderer } from "@/components/sub/layout/LayoutRenderer";
import type { PublicSubPayload } from "@/components/sub/types";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { buildCatalogItem, type CatalogItem } from "@/lib/subLayout/catalog";
import type { ItemTag } from "@/lib/subLayout/catalog-meta";
import type { LayoutDoc } from "@/lib/subLayout/types";
import type { Subtree } from "@/lib/subLayout/tree";

export type CatalogView = "large" | "grid" | "list";
export type Hover = { build: () => Subtree; label: string; top: number; left: number } | null;

type Drag = {
  onAdd: (build: () => Subtree) => void;
  onDragStart: (build: () => Subtree, label: string, e: { clientX: number; clientY: number }) => void;
};

/** Click adds, a drag of 5px+ starts a canvas drag (same behaviour as the basic tiles). */
export function usePointerAdd(build: () => Subtree, label: string, { onAdd, onDragStart }: Drag) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (dragged) return;
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      dragged = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onDragStart(build, label, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged) onAdd(build);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

/** A catalog item, or a library element (`direct` yields its subtree with its own texts). */
export type TileItem = CatalogItem & { direct?: () => Subtree };
const buildOf = (item: TileItem): Subtree => (item.direct ? item.direct() : buildCatalogItem(item));

const subCache = new Map<string, Subtree>();
function subOf(item: TileItem): Subtree {
  let s = subCache.get(item.id);
  if (!s) {
    s = buildOf(item);
    subCache.set(item.id, s);
  }
  return s;
}

const THUMB_W = 360;
const HEIGHT: Record<CatalogView, number> = { large: 200, grid: 120, list: 56 };

export function Thumb({ item, view, hot, data, config, lang }: { item: TileItem; view: CatalogView; hot: boolean; data: PublicSubPayload; config: SharxSubpageConfigV2 | null; lang: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => setW(el.clientWidth)) : null;
    ro?.observe(el);
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return () => ro?.disconnect();
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      io.disconnect();
      ro?.disconnect();
    };
  }, []);
  const doc = useMemo<LayoutDoc | null>(() => {
    if (!seen) return null;
    const s = subOf(item);
    return { version: 1, enabled: true, root: s.root, nodes: s.nodes, ...(s.i18n ? { i18n: s.i18n } : {}), vars: { tg: "https://t.me/example", notice: "…" } } as never;
  }, [seen, item]);
  const scale = w > 0 ? w / THUMB_W : 0.5;
  const h = HEIGHT[view];
  return (
    <div ref={ref} aria-hidden className={`relative w-full overflow-hidden rounded-lg bg-[var(--bg)] ${hot ? "" : "thumb-paused"}`} style={{ height: h }}>
      {doc ? (
        <div style={{ width: THUMB_W, height: h / scale, transform: `scale(${scale})`, transformOrigin: "top left" }} className="pointer-events-none">
          <SubPageShell className="!min-h-full h-full" branding={config?.branding} theme={config?.theme} colorPreset={config?.colorPreset}>
            <div className="p-2">
              <LayoutRenderer doc={doc} data={data} config={config} mode="view" interactive={false} device="mobile" lang={lang} />
            </div>
          </SubPageShell>
        </div>
      ) : null}
      {view !== "list" ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--surface)] to-transparent" /> : null}
    </div>
  );
}

type Props = Drag & {
  item: TileItem;
  view: CatalogView;
  L: "en" | "ru";
  lang: string;
  d: (key: string, en: string) => string;
  tags: Set<ItemTag>;
  tagLabels: Record<ItemTag, string>;
  catLabel: string;
  fav: boolean;
  onFav: (id: string) => void;
  data: PublicSubPayload;
  config: SharxSubpageConfigV2 | null;
  onHover?: (h: Hover) => void;
  /** Extra controls next to the star / add buttons (library kebab). */
  menu?: React.ReactNode;
  hideFav?: boolean;
};

function TileImpl({ item, view, L, lang, d, tags, tagLabels, catLabel, fav, onFav, onAdd, onDragStart, data, config, onHover, menu, hideFav }: Props) {
  const [hot, setHot] = useState(false);
  const [title, hint] = item[L];
  const build = () => buildOf(item);
  const down = usePointerAdd(build, title, { onAdd, onDragStart });
  const shownTags = (["animated", "interactive", "data", "setup"] as ItemTag[]).filter((x) => tags.has(x));
  const badges = (
    <div className="flex flex-wrap gap-1">
      <span className="rounded bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">{catLabel}</span>
      {shownTags.map((x) => (
        <span key={x} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">{tagLabels[x]}</span>
      ))}
    </div>
  );
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const actions = (
    <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
      {menu}
      {hideFav ? null : <button type="button" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onFav(item.id); }} aria-pressed={fav} aria-label={d("pal.favorite", "Favorite")} title={d("pal.favorite", "Favorite")} className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface)]/90 text-[var(--fg-muted)] hover:text-[var(--fg)]">
        <Star size={13} className={fav ? "fill-amber-400 text-amber-400" : ""} />
      </button>}
      <button type="button" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onAdd(build); }} aria-label={d("pal.add", "Add")} title={d("pal.add", "Add")} className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent)] text-white">
        <Plus size={14} />
      </button>
    </div>
  );
  const enter = (e: React.MouseEvent<HTMLDivElement>) => {
    setHot(true);
    if (view === "list" && onHover) {
      const r = e.currentTarget.getBoundingClientRect();
      onHover({ build, label: title, top: r.top, left: r.right + 12 });
    }
  };
  const leave = () => {
    setHot(false);
    if (view === "list") onHover?.(null);
  };
  const cls = "relative cursor-grab rounded-xl border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] active:cursor-grabbing";
  const common = {
    role: "button" as const,
    tabIndex: 0,
    title: hint,
    onPointerDown: (e: React.PointerEvent) => { onHover?.(null); down(e); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAdd(build); } },
    onMouseEnter: enter,
    onMouseLeave: leave,
  };
  if (view === "list") {
    return (
      <div {...common} className={`${cls} flex items-start gap-2 p-1.5 pr-24`}>
        <div className="w-[84px] shrink-0"><Thumb item={item} view="list" hot={hot} data={data} config={config} lang={lang} /></div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="[overflow-wrap:anywhere] text-[12px] font-semibold leading-snug text-[var(--fg)]">{title}</div>
          <div className="[overflow-wrap:anywhere] text-[11px] leading-snug text-[var(--fg-subtle)]">{hint}</div>
        </div>
        {actions}
      </div>
    );
  }
  return (
    <div {...common} className={`${cls} flex flex-col gap-1.5 p-1.5`}>
      <Thumb item={item} view={view} hot={hot} data={data} config={config} lang={lang} />
      <div className="space-y-1 px-1 pb-1">
        <div className="[overflow-wrap:anywhere] text-[12.5px] font-semibold leading-snug text-[var(--fg)]">{title}</div>
        <div className="[overflow-wrap:anywhere] text-[11px] leading-snug text-[var(--fg-subtle)]">{hint}</div>
        {view === "large" ? badges : null}
      </div>
      {actions}
    </div>
  );
}

export const CatalogTile = memo(TileImpl);
