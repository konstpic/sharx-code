import { buildCatalogItem, type CatalogItem } from "./catalog";

export type ItemTag = "static" | "animated" | "interactive" | "data" | "setup";

const DATA_RE = /\b(user|devices|subscription|links|apps|now)\b/;
const SETUP_RE = /\bvars\./;

const tagCache = new Map<string, Set<ItemTag>>();

/** Tags derived automatically from the built subtree. Every item gets at least one. */
export function itemTags(item: CatalogItem): Set<ItemTag> {
  const hit = tagCache.get(item.id);
  if (hit) return hit;
  const tags = new Set<ItemTag>();
  const sub = buildCatalogItem(item);
  if (/^(step|anim)-/.test(item.id)) tags.add("animated");
  const exprs: string[] = [];
  for (const n of Object.values(sub.nodes)) {
    const props = (n.props ?? {}) as Record<string, unknown>;
    if (n.type === "scene") tags.add("animated");
    if (n.type === "button" || n.type === "apps") tags.add("interactive");
    if (n.type === "apps" || n.type === "repeat") tags.add("data");
    if (n.type === "html") {
      const css = String(props.css ?? "");
      if (css.includes("@keyframes") || css.includes("animation")) tags.add("animated");
      if (props.allowScripts) tags.add("interactive");
    }
    if (typeof n.visibleIf === "string") exprs.push(n.visibleIf);
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1]);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(n.props);
    walk(n.style);
  }
  for (const e of exprs) {
    if (SETUP_RE.test(e)) tags.add("setup");
    if (DATA_RE.test(e)) tags.add("data");
  }
  if (tags.size === 0) tags.add("static");
  tagCache.set(item.id, tags);
  return tags;
}

/** Lower-case haystack for search: titles, hints (ru + en), id, category and tags. */
export function itemSearchText(item: CatalogItem): string {
  return `${item.id} ${item.cat} ${item.en.join(" ")} ${item.ru.join(" ")} ${[...itemTags(item)].join(" ")}`.toLowerCase();
}
