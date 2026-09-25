"use client";

import { Plus, Search, Trash2 } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { LIST_ITEM_FIELDS, VARIABLE_CATALOG, type VariableInfo } from "@/lib/subLayout/context";
import { evalExpr, parseExpression, renderTemplate, type Ctx } from "@/lib/subLayout/template";
import type { LayoutDoc } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { InsertContext, SmallBtn } from "./ui";

type Props = {
  doc: LayoutDoc;
  /** Languages of the page (config locales + en, ru). */
  langs: string[];
  ctx: Ctx;
  lang: string;
  d: D;
  commit: (doc: LayoutDoc, opts?: { key?: string }) => void;
};

const GROUPS: { id: VariableInfo["group"]; en: string }[] = [
  { id: "user", en: "Client" },
  { id: "traffic", en: "Traffic" },
  { id: "subscription", en: "Subscription" },
  { id: "devices", en: "Devices" },
  { id: "links", en: "Links" },
  { id: "apps", en: "Apps" },
  { id: "page", en: "Page" },
];

function valueOf(ctx: Ctx, path: string, lang: string): string {
  try {
    const v = evalExpr(parseExpression(path).e, ctx);
    if (Array.isArray(v)) return `[${v.length}]`;
    if (v !== null && typeof v === "object") return "{…}";
    return renderTemplate(`{{ ${path} }}`, ctx, { lang }).out || "∅";
  } catch {
    return "?";
  }
}

export function VariablesPanel({ doc, langs, ctx, lang, d, commit }: Props) {
  const reg = useContext(InsertContext);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");

  const insert = (text: string) => {
    if (reg.current) {
      reg.current(text);
      setNote("");
    } else {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      setNote(d("var.copied", "Copied. Click a text field first to insert variables right there."));
    }
  };

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return VARIABLE_CATALOG.filter((v) => !s || v.path.toLowerCase().includes(s) || v.hint.toLowerCase().includes(s));
  }, [q]);

  const vars = doc.vars ?? {};
  const setVars = (next: Record<string, string>, key?: string) => commit({ ...doc, vars: next }, { key });

  return (
    <div className="p-3">
      <div className="relative mb-2">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--fg-subtle)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={d("var.search", "Search variables…")} className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] pl-7 pr-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)]" aria-label={d("var.search", "Search variables…")} />
      </div>
      <p className="mb-2 text-[11px] leading-snug text-[var(--fg-subtle)]">{d("var.hint", "Click a variable to put it into the text field you were editing. Values come from the preview client.")}</p>
      {note ? <p className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400">{note}</p> : null}

      {GROUPS.map((g) => {
        const list = items.filter((v) => v.group === g.id);
        if (!list.length) return null;
        return (
          <div key={g.id} className="mb-3">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d(`vg.${g.id}`, g.en)}</div>
            <div className="space-y-0.5">
              {list.map((v) => (
                <VarRow key={v.path} v={v} ctx={ctx} lang={lang} d={d} onInsert={insert} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="mb-3 border-t border-[var(--border)] pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("var.mine", "My variables")}</div>
          <SmallBtn title={d("var.add", "Add a variable")} onClick={() => {
            let i = 1;
            while (`var${i}` in vars) i++;
            setVars({ ...vars, [`var${i}`]: "" });
          }}>
            <Plus size={14} />
          </SmallBtn>
        </div>
        {Object.keys(vars).length === 0 ? <p className="text-[11px] text-[var(--fg-subtle)]">{d("var.mineHint", "Your own constants, for example a bot link. Use them as vars.name.")}</p> : null}
        <div className="space-y-1.5">
          {Object.entries(vars).map(([k, val]) => (
            <div key={k} className="grid grid-cols-[90px_minmax(0,1fr)_28px] items-center gap-1">
              <input
                defaultValue={k}
                aria-label={d("var.name", "Variable name")}
                onBlur={(e) => {
                  const nk = e.target.value.trim().replace(/[^A-Za-z0-9_]/g, "_");
                  if (!nk || nk === k || nk in vars || /^[0-9]/.test(nk)) {
                    e.target.value = k;
                    return;
                  }
                  const next: Record<string, string> = {};
                  for (const [ok, ov] of Object.entries(vars)) next[ok === k ? nk : ok] = ov;
                  setVars(next);
                }}
                className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
              />
              <input value={val} aria-label={d("var.value", "Value")} onChange={(e) => setVars({ ...vars, [k]: e.target.value }, `var:${k}`)} placeholder={d("var.value", "Value")} className="h-8 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]" />
              <button type="button" title={d("act.delete", "Delete")} onClick={() => {
                const next = { ...vars };
                delete next[k];
                setVars(next);
              }} className="grid size-7 place-items-center rounded-md text-[var(--fg-subtle)] hover:text-red-400">
                <Trash2 size={13} />
              </button>
              <button type="button" onClick={() => insert(`{{ vars.${k} }}`)} className="col-span-3 -mt-0.5 text-left font-mono text-[10.5px] text-[var(--accent)] hover:underline">{`{{ vars.${k} }}`}</button>
            </div>
          ))}
        </div>
      </div>

      <TranslationsSection doc={doc} langs={langs} d={d} commit={commit} insert={insert} />

      <div className="border-t border-[var(--border)] pt-3">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("var.syntax", "Syntax")}</div>
        <div className="space-y-1 font-mono text-[10.5px] leading-snug text-[var(--fg-muted)]">
          <div>{"{{ user.username | upper }}"}</div>
          <div>{'{{ user.expiresAt | date("DD.MM.YYYY") }}'}</div>
          <div>{"{{#if user.isActive}}…{{else}}…{{/if}}"}</div>
          <div>{"{{#each links as l}}{{ l.title }}{{/each}}"}</div>
          <div>{'{{ n | plural("device","devices") }}'}</div>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--fg-subtle)]">{d("var.filters", "Filters: upper, lower, truncate(n), default(x), bytes, number(d), percent(a,b), date(fmt), ago, plural(one,few,many), join, urlencode, b64.")}</p>
      </div>
    </div>
  );
}

function VarRow({ v, ctx, lang, d, onInsert }: { v: VariableInfo; ctx: Ctx; lang: string; d: D; onInsert: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const val = valueOf(ctx, v.path, lang);
  const fields = v.kind === "list" ? LIST_ITEM_FIELDS[v.path] : undefined;
  return (
    <div>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (v.kind === "list" ? setOpen((o) => !o) : onInsert(`{{ ${v.path} }}`))}
        title={d(`vh.${v.path.replace(/\W/g, "_")}`, v.hint)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]"
      >
        <span className="min-w-0">
          <span className="block truncate font-mono text-[11.5px] text-[var(--fg)]">{v.path}</span>
          <span className="block truncate text-[10.5px] text-[var(--fg-subtle)]">{d(`vh.${v.path.replace(/\W/g, "_")}`, v.hint)}</span>
        </span>
        <span className="max-w-[92px] truncate rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10.5px] text-[var(--fg-muted)]" title={val}>{val}</span>
      </button>
      {open && fields ? (
        <div className="ml-2 mb-1 space-y-0.5 border-l border-[var(--border)] pl-2">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(`{{#each ${v.path} as item}}{{ item.${fields[0].path} }}{{/each}}`)} className="block w-full rounded px-1.5 py-0.5 text-left font-mono text-[10.5px] text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]">
            {d("var.eachBlock", "insert an #each block")}
          </button>
          {fields.map((f) => (
            <button key={f.path} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(`{{ item.${f.path} }}`)} title={d(`vf.${v.path.replace(/\W/g, "_")}_${f.path}`, f.hint)} className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]">
              <span className="font-mono text-[11px] text-[var(--fg)]">item.{f.path}</span>
              <span className="truncate text-[10.5px] text-[var(--fg-subtle)]">{d(`vf.${v.path.replace(/\W/g, "_")}_${f.path}`, f.hint)}</span>
            </button>
          ))}
          <p className="px-1.5 text-[10px] text-[var(--fg-subtle)]">{d("var.itemHint", "Inside a Repeat element the current item is item.")}</p>
        </div>
      ) : null}
    </div>
  );
}


function TranslationsSection({ doc, langs, d, commit, insert }: { doc: LayoutDoc; langs: string[]; d: D; commit: Props["commit"]; insert: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const i18n = doc.i18n ?? {};
  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const m of Object.values(i18n)) for (const k of Object.keys(m)) set.add(k);
    return [...set].sort();
  }, [i18n]);
  const used = useMemo(() => {
    const json = JSON.stringify(doc.nodes);
    return new Set(keys.filter((k) => json.includes(`tr.${k}`)));
  }, [doc.nodes, keys]);
  const shown = keys.filter((k) => {
    const s = q.trim().toLowerCase();
    return !s || k.toLowerCase().includes(s) || Object.values(i18n).some((m) => (m[k] ?? "").toLowerCase().includes(s));
  });
  const missing = (l: string) => keys.filter((k) => used.has(k) && !(i18n[l] ?? {})[k]).length;
  const set = (lang: string, key: string, value: string) => commit({ ...doc, i18n: { ...i18n, [lang]: { ...(i18n[lang] ?? {}), [key]: value } } }, { key: `tr:${lang}:${key}` });
  const unused = keys.filter((k) => !used.has(k));

  return (
    <div data-tour="translations" className="mb-3 border-t border-[var(--border)] pt-3">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("tr.title", "Translations")}</div>
      <p className="mb-2 text-[11px] leading-snug text-[var(--fg-subtle)]">{d("tr.hint", "Texts of ready-made elements are stored here and switch with the page language. Use them anywhere as ‹‹ tr.key ››.")}</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {langs.map((l) => (
          <span key={l} className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${missing(l) ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`} title={d("tr.missing", "%{n} missing", { n: missing(l) })}>
            {l.toUpperCase()} {missing(l) ? `−${missing(l)}` : "✓"}
          </span>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={d("tr.search", "Search texts…")} aria-label={d("tr.search", "Search texts…")} className="mb-2 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-[12px] outline-none focus:border-[var(--accent)]" />
      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-0.5">
        {shown.slice(0, 80).map((k) => (
          <div key={k} className="rounded-lg border border-[var(--border)]">
            <button type="button" onClick={() => setOpen(open === k ? null : k)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
              <span className={`size-1.5 shrink-0 rounded-full ${used.has(k) ? "bg-[var(--accent)]" : "bg-[var(--fg-subtle)]"}`} />
              <span className="min-w-0 flex-1 truncate text-[12px]">{(i18n.en ?? {})[k] ?? (Object.values(i18n).map((m) => m[k]).find(Boolean) ?? k)}</span>
            </button>
            {open === k ? (
              <div className="space-y-1.5 border-t border-[var(--border)] p-2">
                {langs.map((l) => (
                  <label key={l} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-1.5">
                    <span className="pt-1.5 text-[10.5px] font-semibold uppercase text-[var(--fg-subtle)]">{l}</span>
                    <textarea rows={2} value={(i18n[l] ?? {})[k] ?? ""} onChange={(e) => set(l, k, e.target.value)} placeholder={l === "en" ? "" : (i18n.en ?? {})[k] ?? ""} className="min-h-[34px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]" />
                  </label>
                ))}
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{{ tr.${k} }}`)} className="font-mono text-[10.5px] text-[var(--accent)] hover:underline">{`{{ tr.${k} }}`}</button>
              </div>
            ) : null}
          </div>
        ))}
        {shown.length > 80 ? <p className="px-1 text-[10.5px] text-[var(--fg-subtle)]">{d("tr.more", "Showing 80 of %{n}. Use the search.", { n: shown.length })}</p> : null}
        {keys.length === 0 ? <p className="text-[11px] text-[var(--fg-subtle)]">{d("tr.empty", "No translated texts yet. Ready-made elements from the catalog add theirs.")}</p> : null}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input value={newKey} onChange={(e) => setNewKey(e.target.value.replace(/[^A-Za-z0-9_]/g, "_"))} placeholder={d("tr.newKey", "new key, e.g. welcome")} aria-label={d("tr.newKey", "new key, e.g. welcome")} className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 font-mono text-[12px] outline-none focus:border-[var(--accent)]" />
        <SmallBtn title={d("tr.add", "Add text")} onClick={() => {
          if (!newKey || keys.includes(newKey)) return;
          commit({ ...doc, i18n: { ...i18n, en: { ...(i18n.en ?? {}), [newKey]: "" } } });
          setOpen(newKey);
          setNewKey("");
        }}>
          <Plus size={14} />
        </SmallBtn>
        {unused.length ? (
          <SmallBtn title={d("tr.clean", "Remove %{n} unused texts", { n: unused.length })} onClick={() => {
            const next: Record<string, Record<string, string>> = {};
            for (const [l, m] of Object.entries(i18n)) next[l] = Object.fromEntries(Object.entries(m).filter(([k]) => used.has(k)));
            commit({ ...doc, i18n: next });
          }}>
            <Trash2 size={14} />
          </SmallBtn>
        ) : null}
      </div>
    </div>
  );
}
