"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import type { PublicSubPayload } from "@/components/sub/types";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { CATALOG, CATALOG_CATEGORIES, type CatalogCategory } from "@/lib/subLayout/catalog";
import { itemSearchText, itemTags, type ItemTag } from "@/lib/subLayout/catalog-meta";
import type { Subtree } from "@/lib/subLayout/tree";
import type { D } from "./i18n";
import { CatalogTile, type CatalogView, type Hover } from "./CatalogTile";
import { LibraryElements, useLibraryCtx } from "./LibraryUI";

const FAV_KEY = "sharx.designer.favorites";
const RECENT_KEY = "sharx.designer.recent";
const VIEW_KEY = "sharx.designer.catalogView";

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeList(key: string, v: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

type Filter = ItemTag | "fav" | "recent";
type Sort = "default" | "az" | "new";

type Props = {
  d: D;
  lang: string;
  L: "en" | "ru";
  onAdd: (build: () => Subtree) => void;
  onDragStart: (build: () => Subtree, label: string, e: { clientX: number; clientY: number }) => void;
  data: PublicSubPayload;
  config: SharxSubpageConfigV2 | null;
  onHover: (h: Hover) => void;
};

export function CatalogBrowser({ d, lang, L, onAdd, onDragStart, data, config, onHover }: Props) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CatalogCategory | "all" | "mine">("all");
  const libCtx = useLibraryCtx();
  const mine = cat === "mine";
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [sort, setSort] = useState<Sort>("default");
  const [view, setView] = useState<CatalogView>("grid");
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setFavs(readList(FAV_KEY));
    setRecent(readList(RECENT_KEY));
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "large" || v === "grid" || v === "list") setView(v);
    } catch {
      /* ignore */
    }
  }, []);

  const changeView = (v: CatalogView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const toggleFav = useCallback((id: string) => {
    setFavs((f) => {
      const n = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      writeList(FAV_KEY, n);
      return n;
    });
  }, []);
  const add = useCallback((id: string, build: () => Subtree) => {
    setRecent((r) => {
      const n = [id, ...r.filter((x) => x !== id)].slice(0, 12);
      writeList(RECENT_KEY, n);
      return n;
    });
    onAdd(build);
  }, [onAdd]);

  const catLabel: Record<CatalogCategory, string> = {
    steps: d("cat.steps", "Step guides"),
    scenes: d("cat.scenes", "Scenes"),
    motion: d("cat.motion", "Animated"),
    hero: d("cat.hero", "Profile"),
    traffic: d("cat.traffic", "Traffic"),
    devices: d("cat.devices", "Devices"),
    connect: d("cat.connect", "Connect"),
    info: d("cat.info", "Info"),
    decor: d("cat.decor", "Decor"),
    plans: d("cat.plans", "Plans"),
    social: d("cat.social", "Social"),
  };
  const tagLabels: Record<ItemTag, string> = {
    static: d("pal.tagStatic", "Static"),
    animated: d("pal.tagAnimated", "Animated"),
    interactive: d("pal.tagInteractive", "Interactive"),
    data: d("pal.tagData", "Data"),
    setup: d("pal.tagSetup", "Setup"),
  };
  const filterLabels: Record<Filter, string> = {
    static: d("pal.fStatic", "Static"),
    animated: d("pal.fAnimated", "Animated"),
    interactive: d("pal.fInteractive", "Interactive"),
    data: d("pal.fData", "Data-bound"),
    setup: d("pal.fSetup", "Needs setup"),
    fav: d("pal.fFav", "Favorites"),
    recent: d("pal.fRecent", "Recent"),
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: CATALOG.length, mine: libCtx?.lib.elements.length ?? 0 };
    for (const it of CATALOG) c[it.cat] = (c[it.cat] ?? 0) + 1;
    return c;
  }, [libCtx?.lib.elements.length]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = CATALOG.filter((it) => {
      if (cat !== "all" && it.cat !== cat) return false;
      if (needle && !itemSearchText(it).includes(needle)) return false;
      const tg = itemTags(it);
      for (const f of filters) {
        if (f === "fav") { if (!favs.includes(it.id)) return false; }
        else if (f === "recent") { if (!recent.includes(it.id)) return false; }
        else if (!tg.has(f)) return false;
      }
      return true;
    });
    if (sort === "az") list = [...list].sort((a, b) => a[L][0].localeCompare(b[L][0], L));
    else if (sort === "new") list = [...list].reverse();
    return list;
  }, [q, cat, filters, sort, favs, recent, L]);

  const toggleFilter = (f: Filter) => setFilters((s) => {
    const n = new Set(s);
    if (n.has(f)) n.delete(f); else n.add(f);
    return n;
  });
  const dirty = q !== "" || cat !== "all" || filters.size > 0;
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-medium ${on ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`;
  const filterKeys: Filter[] = ["static", "animated", "interactive", "data", "setup", "fav", "recent"];

  return (
    <div className="space-y-2">
      <style>{".thumb-paused *{animation-play-state:paused!important}"}</style>
      <div className="relative" data-tour="catalog-search">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--fg-subtle)]" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={d("pal.search", "Search elements…")} aria-label={d("pal.search", "Search elements…")} className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] pl-7 pr-2.5 text-[12.5px] outline-none focus:border-[var(--accent)]" />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={d("pal.categories", "Categories")}>
        {([...(libCtx ? ["mine"] : []), "all", ...CATALOG_CATEGORIES] as (CatalogCategory | "all" | "mine")[]).map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className={chip(cat === c)}>
            {c === "all" ? d("cat.all", "All") : c === "mine" ? d("lib.mine", "My library") : catLabel[c]} <span className="opacity-70">{counts[c] ?? 0}</span>
          </button>
        ))}
      </div>
      {mine ? null : <div className="flex flex-wrap gap-1" data-tour="catalog-filters" role="group" aria-label={d("pal.filters", "Filters")}>
        {filterKeys.map((f) => (
          <button key={f} type="button" onClick={() => toggleFilter(f)} aria-pressed={filters.has(f)} className={`${chip(filters.has(f))} inline-flex items-center gap-1`}>
            {f === "fav" ? <Star size={10} aria-hidden /> : null}
            {filterLabels[f]}
          </button>
        ))}
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]" data-tour="catalog-view" role="group" aria-label={d("pal.view", "View")}>
          {(["large", "grid", "list"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => changeView(v)} className={`px-2 py-1 text-[11px] ${view === v ? "bg-[var(--accent)] text-white" : "text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}>
              {v === "large" ? d("pal.viewLarge", "Large") : v === "grid" ? d("pal.viewGrid", "Grid") : d("pal.viewList", "List")}
            </button>
          ))}
        </div>
        {mine ? null : <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={d("pal.sort", "Sort")} className="h-7 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 text-[11px]">
          <option value="default">{d("pal.sortDefault", "Default")}</option>
          <option value="az">{d("pal.sortAz", "A→Z")}</option>
          <option value="new">{d("pal.sortNew", "Newest")}</option>
        </select>}
      </div>
      {mine ? <LibraryElements d={d} view={view} L={L} lang={lang} q={q} data={data} config={config} onAdd={onAdd} onDragStart={onDragStart} onHover={onHover} /> : <>
      <div className="flex items-center justify-between text-[11px] text-[var(--fg-subtle)]" aria-live="polite">
        <span>{d("pal.count", "%{n} found", { n: shown.length } as never)}</span>
        {dirty ? <button type="button" onClick={() => { setQ(""); setCat("all"); setFilters(new Set()); }} className="text-[var(--accent)] hover:underline">{d("pal.clear", "Clear filters")}</button> : null}
      </div>
      <div data-tour="catalog-list" className={view === "grid" ? "grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5" : "flex flex-col gap-1.5"}>
        {shown.map((it) => (
          <CatalogTile key={it.id} item={it} view={view} L={L} lang={lang} d={d} tags={itemTags(it)} tagLabels={tagLabels} catLabel={catLabel[it.cat]} fav={favs.includes(it.id)} onFav={toggleFav} onAdd={(b) => add(it.id, b)} onDragStart={(b, l, e) => { add(it.id, b); onDragStart(b, l, e); }} data={data} config={config} onHover={onHover} />
        ))}
      </div>
      {shown.length === 0 ? <p className="text-[11px] text-[var(--fg-subtle)]">{d("pal.none", "Nothing found")}</p> : null}
      </>}
    </div>
  );
}
