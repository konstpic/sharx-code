"use client";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkPlus, Code2, Globe, LayoutDashboard, LayoutGrid, Plus, Search, Text, Trash2, type LucideIcon } from "lucide-react";
import { Button, Input, Modal, useToast } from "@/components/ui";
import { MetricContent, WidgetContent, atomIcon, type AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { METRIC_VIEWS } from "@/components/dashboard/CustomMetricPanel";
import { TilePreview } from "@/components/dashboard/GridTile";
import { ViewThumb } from "@/components/dashboard/ViewPicker";
import {
  CATALOG_CATEGORIES,
  CATALOG_SETS,
  CATALOG_TILES,
  atomBundle,
  metricBundle,
  metricCategory,
  setBundle,
  type CatalogCategory,
  type CatalogSet,
  type CatalogTile,
  type MyEntry,
} from "@/lib/dashboardCatalog";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import type { EntityTemplateContext } from "@/lib/dashboardMetricsTemplates";
import type { TileBundle } from "@/lib/dashboardModel";
import { tileKind } from "@/lib/dashboardGrid";

const COLORS = ["#38bdf8", "#a78bfa", "#22c55e", "#f59e0b"];
const CONTENT_ICONS: Record<string, LucideIcon> = { LayoutGrid, Code2, Globe, Text };
const HEAVY = new Set(["telemt_dc", "telemt_dc_summary", "telemt_dc_dots"]);
/** Classic v2.6 / v2.7.1 cards are whole sections: the catalog shows their icon instead of a (clipped) live miniature. */
const isHeavy = (widget: string) => HEAVY.has(widget) || widget.startsWith("classic_") || widget.startsWith("v271_");
const PREVIEW_W = 250;
const PREVIEW_H = 140;

/** Size a freshly added metric tile gets for a look. */
function sizeForView(view: string): { w: number; h: number } {
  const k = tileKind("custom-x", view, "metric");
  return k === "chart" || k === "table" ? { w: 6, h: 6 } : k === "viz" ? { w: 4, h: 6 } : { w: 3, h: 4 };
}

type Props = {
  open: boolean;
  onClose: () => void;
  metrics: DashboardMetric[];
  env: AtomEnv;
  mine: MyEntry[];
  nodeLists: EntityTemplateContext;
  onAdd: (bundle: TileBundle) => void;
  onContent: (kind: "html" | "embed" | "text" | "design") => void;
  onSaveBoard: (name: string) => void;
  onDeleteMine: (id: string) => void;
};

/** Schematic of a set: its tiles as little boxes in their arrangement. */
function SetSketch({ bundle, color }: { bundle: TileBundle; color: string }) {
  const rows = Math.max(1, ...bundle.rects.map((r) => r.y + r.h));
  return (
    <svg viewBox={`0 0 12 ${rows}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full p-2" aria-hidden>
      {bundle.rects.map((r) => (
        <rect key={r.id} x={r.x + 0.08} y={r.y + 0.08} width={Math.max(0.2, r.w - 0.16)} height={Math.max(0.2, r.h - 0.16)} rx={0.35} fill={color} opacity={0.28} stroke={color} strokeWidth={0.08} />
      ))}
    </svg>
  );
}

export function TileCatalog({ open, onClose, metrics, env, mine, nodeLists, onAdd, onContent, onSaveBoard, onDeleteMine }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [category, setCategory] = useState<CatalogCategory | "all">("all");
  const [type, setType] = useState<"all" | "tile" | "set">("all");
  const [query, setQuery] = useState("");
  const [look, setLook] = useState("stat");
  const [saveName, setSaveName] = useState("");
  const q = query.trim().toLowerCase();
  const match = (...s: string[]) => !q || s.join(" ").toLowerCase().includes(q);

  const tiles = useMemo(
    () =>
      CATALOG_TILES.filter((x) => (category === "all" || x.category === category) && match(t(x.title), t(x.desc))),
    [category, q, t], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sets = useMemo(() => CATALOG_SETS.filter((x) => (category === "all" || x.category === category) && match(t(x.title), t(x.desc))), [category, q, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const metricList = useMemo(
    () => metrics.filter((m) => !m.unavailable && (category === "all" || metricCategory(m.id) === category) && match(m.label, m.group, m.id)),
    [metrics, category, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: CATALOG_TILES.length + CATALOG_SETS.length + metrics.filter((m) => !m.unavailable).length + mine.length, mine: mine.length };
    for (const x of [...CATALOG_TILES, ...CATALOG_SETS]) c[x.category] = (c[x.category] ?? 0) + 1;
    for (const m of metrics) if (!m.unavailable) c[metricCategory(m.id)] = (c[metricCategory(m.id)] ?? 0) + 1;
    return c;
  }, [metrics, mine.length]);

  const add = (bundle: TileBundle | null) => {
    if (!bundle) return;
    onAdd(bundle);
    toast.success(t("pages.builder.tileAdded"));
  };

  const card = (key: string, preview: React.ReactNode, title: string, desc: string, meta: string, onClick: () => void, extra?: React.ReactNode) => (
    <div key={key} className="dash-card group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] transition hover:border-[var(--accent)] hover:shadow-[0_8px_28px_-14px_var(--accent)]">
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="flex min-w-0 flex-1 cursor-pointer flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
        aria-label={`${t("pages.builder.addToBoard")}: ${title}`}
      >
        <span className="pointer-events-none grid h-[148px] place-items-center overflow-hidden bg-[color-mix(in_oklab,var(--fg)_3%,transparent)]" inert>
          {preview}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 border-t border-[var(--border)] px-3 pb-1 pt-2">
          <span className="truncate text-[13px] font-medium" title={title}>{title}</span>
          {desc ? <span className="line-clamp-2 min-h-[2.2em] text-[11px] leading-snug text-[var(--fg-subtle)]">{desc}</span> : null}
        </span>
      </div>
      <span className="flex items-center justify-between gap-2 px-3 pb-2 text-[11px] text-[var(--fg-subtle)]">
        <span className="truncate">{meta}</span>
        <span className="flex items-center gap-1">
          {extra}
          <Plus size={14} className="text-[var(--accent)] opacity-70 transition group-hover:opacity-100" aria-hidden />
        </span>
      </span>
    </div>
  );

  const tileCard = (x: CatalogTile) => {
    const Icon = x.content ? CONTENT_ICONS[x.icon] ?? LayoutGrid : atomIcon(x.icon);
    const bundle = x.atom ? atomBundle(x.atom) : null;
    const panel = bundle?.panels[0];
    const live =
      panel && !isHeavy(panel.widget ?? "") ? (
        <TilePreview width={PREVIEW_W} height={PREVIEW_H} title={t(x.title)}>
          {panel.kind === "metric" ? <MetricContent panel={panel} settings={bundle!.tiles[panel.id]} env={env} preview /> : <WidgetContent widget={panel.widget!} env={env} />}
        </TilePreview>
      ) : (
        <span className="grid size-16 place-items-center rounded-2xl" style={{ color: x.color, background: `color-mix(in oklab, ${x.color} 15%, transparent)` }}>
          <Icon size={30} />
        </span>
      );
    return card(x.id, live, t(x.title), t(x.desc), `${x.w}×${x.h}`, () => (x.content ? onContent(x.content) : add(bundle)));
  };

  const setCard = (s: CatalogSet) => {
    const bundle = setBundle(s, t, nodeLists);
    return card("set:" + s.id, <SetSketch bundle={bundle} color={s.color} />, t(s.title), t(s.desc), `${bundle.panels.length} ${t("pages.builder.tilesCount")}`, () => add(bundle));
  };

  const mineCard = (m: MyEntry) =>
    card(
      "mine:" + m.id,
      m.kind === "set" ? <SetSketch bundle={m.bundle} color="#38bdf8" /> : <LayoutDashboard className="text-[var(--accent)]" size={30} />,
      m.name,
      "",
      m.kind === "set" ? `${m.bundle.panels.length} ${t("pages.builder.tilesCount")}` : t("pages.builder.tileOne"),
      () => add(m.bundle),
      <button
        type="button"
        className="pointer-events-auto grid size-6 place-items-center rounded-md text-[var(--fg-subtle)] hover:text-[var(--danger,#ef4444)]"
        aria-label={t("delete")}
        title={t("delete")}
        onClick={(e) => {
          e.stopPropagation();
          onDeleteMine(m.id);
        }}
      >
        <Trash2 size={13} />
      </button>,
    );

  const metricCard = (m: DashboardMetric) => {
    const view = look;
    const size = sizeForView(view);
    const bundle = metricBundle(m.id, m.label, view, COLORS[0], size.w, size.h, m.max);
    return card(
      "m:" + m.id,
      <TilePreview width={PREVIEW_W} height={PREVIEW_H} title={m.label}>
        <MetricContent panel={bundle.panels[0]} settings={{ ...bundle.tiles[bundle.panels[0].id], view: ["line", "area", "bar"].includes(view) ? "spark" : view }} env={{ ...env, metrics: [m] }} preview />
      </TilePreview>,
      m.label,
      m.group,
      `${size.w}×${size.h}`,
      () => add(bundle),
    );
  };

  const showTiles = type !== "set" && category !== "mine";
  const showSets = type !== "tile" && category !== "mine";
  const showMetrics = type !== "set" && category !== "mine" && category !== "content";
  const showMine = category === "mine" || category === "all";
  const myList = mine.filter((m) => (type === "all" || m.kind === type) && match(m.name));

  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3";
  const heading = (s: string) => <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)] first:mt-0">{s}</h3>;

  return (
    <Modal open={open} onClose={onClose} title={t("pages.builder.catalog")} width={1180}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("pages.builder.searchCatalog")} aria-label={t("pages.builder.searchCatalog")} className="!pl-9" />
        </div>
        <div className="flex gap-1" role="group" aria-label={t("pages.builder.catalogType")}>
          {(["all", "tile", "set"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={type === v}
              onClick={() => setType(v)}
              className={`rounded-full border px-3 py-1 text-xs transition ${type === v ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
            >
              {t(v === "all" ? "pages.builder.allGroups" : v === "tile" ? "pages.builder.typeTiles" : "pages.builder.typeSets", { defaultValue: "All" })}
            </button>
          ))}
        </div>
      </div>
      {showMetrics ? (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t("pages.builder.lookTitle")}>
          {METRIC_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={look === v}
              onClick={() => setLook(v)}
              className={`flex w-[68px] shrink-0 flex-col items-stretch gap-1 rounded-xl border p-1 text-center transition ${look === v ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
            >
              <span className="block h-7">
                <ViewThumb view={v} />
              </span>
              <span className="truncate text-[10px]">{t("pages.builder." + v, { defaultValue: v })}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-col gap-3 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-visible" aria-label={t("pages.builder.catalogCategories")}>
          {[{ id: "all" as const, title: "pages.builder.allGroups" }, ...CATALOG_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              aria-current={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition ${category === c.id ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--fg)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_40%,transparent)]" : "text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)]"}`}
            >
              <span className="truncate">{t(c.title, { defaultValue: "All" })}</span>
              <span className="text-[11px] tabular-nums text-[var(--fg-subtle)]">{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="max-h-[62vh] min-w-0 flex-1 overflow-y-auto pr-1">
          {showMine ? (
            <div>
              {category === "mine" ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-2">
                  <Input value={saveName} maxLength={60} onChange={(e) => setSaveName(e.target.value)} placeholder={t("pages.builder.saveBoardName")} aria-label={t("pages.builder.saveBoardName")} className="!h-9 !w-56 !text-xs" />
                  <Button
                    variant="secondary"
                    className="!h-9 !rounded-xl !text-xs"
                    disabled={!saveName.trim()}
                    onClick={() => {
                      onSaveBoard(saveName);
                      setSaveName("");
                    }}
                  >
                    <BookmarkPlus size={14} />
                    {t("pages.builder.saveBoardAsSet")}
                  </Button>
                </div>
              ) : null}
              {myList.length ? (
                <>
                  {category === "all" ? heading(t("pages.builder.cat_mine")) : null}
                  <div className={grid}>{myList.map(mineCard)}</div>
                </>
              ) : category === "mine" ? (
                <p className="py-8 text-center text-sm text-[var(--fg-muted)]">{t("pages.builder.mineEmpty")}</p>
              ) : null}
            </div>
          ) : null}
          {showSets && sets.length ? (
            <>
              {heading(t("pages.builder.typeSets"))}
              <div className={grid}>{sets.map(setCard)}</div>
            </>
          ) : null}
          {showTiles && tiles.length ? (
            <>
              {heading(t("pages.builder.typeTiles"))}
              <div className={grid}>{tiles.map(tileCard)}</div>
            </>
          ) : null}
          {showMetrics && metricList.length ? (
            <>
              {heading(t("pages.builder.metrics"))}
              <div className={grid}>{metricList.map(metricCard)}</div>
            </>
          ) : null}
          {category !== "mine" && !sets.length && !tiles.length && !metricList.length ? <p className="py-8 text-center text-sm text-[var(--fg-muted)]">{t("noData")}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
