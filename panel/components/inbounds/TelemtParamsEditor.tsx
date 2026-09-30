"use client";

import { Plus, Search, Trash2, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Button, IconButton, Input, SelectNative } from "@/components/ui";

/** One documented Telemt config.toml key (served by GET /panel/api/inbounds/telemtParams). */
export type TelemtParam = {
  section: string;
  key: string;
  array: boolean;
  type: string;
  default: string;
  hot: boolean;
  desc: string;
  valid: string;
  container: boolean;
  managed: boolean;
  /** First Telemt release that accepts this key (empty = all supported releases). */
  since?: string;
  kind: "bool" | "int" | "float" | "string" | "strlist" | "enum" | "object";
  options?: string[];
  min?: number;
  max?: number;
};

export type TelemtParams = Record<string, unknown>;
export type TelemtUpstream = Record<string, unknown>;

const paramId = (p: TelemtParam) => (p.section ? `${p.section}.${p.key}` : p.key);

let catalogPromise: Promise<TelemtParam[]> | null = null;
function loadCatalog(): Promise<TelemtParam[]> {
  if (!catalogPromise) {
    catalogPromise = getJson<TelemtParam[]>(panel("api/inbounds/telemtParams"))
      .then((r) => (Array.isArray(r.obj) ? r.obj : []))
      .catch(() => {
        catalogPromise = null;
        return [];
      });
  }
  return catalogPromise;
}

const inputCls = "font-mono text-xs";

/** Value editor for one parameter. `value === undefined` means "not set" (Telemt default). */
function ParamControl({
  p,
  value,
  onChange,
}: {
  p: TelemtParam;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const unset = value === undefined;
  const placeholder = p.default && p.default !== "—" ? p.default : "";
  switch (p.kind) {
    case "bool":
      return (
        <SelectNative
          className={inputCls}
          value={unset ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
        >
          <option value="">{t("pages.inbounds.telemtParamDefault", { defaultValue: "default" })}{placeholder ? ` (${placeholder})` : ""}</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </SelectNative>
      );
    case "int":
    case "float":
      return (
        <Input
          type="number"
          className={inputCls}
          min={p.min}
          max={p.max}
          step={p.kind === "float" ? "any" : 1}
          placeholder={placeholder}
          value={unset ? "" : String(value)}
          spellCheck={false}
          onChange={(e) => {
            const s = e.target.value.trim();
            if (s === "") return onChange(undefined);
            const n = Number(s);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
    case "enum": {
      const opts = p.options ?? [];
      const cur = unset ? "" : String(value);
      return (
        <SelectNative className={inputCls} value={cur} onChange={(e) => {
          const s = e.target.value;
          if (s === "") return onChange(undefined);
          if (s === "true" || s === "false") return onChange(s === "true");
          const isNum = /^\d+$/.test(s) && opts.every((o) => /^\d+$/.test(o) || o === "true" || o === "false");
          onChange(isNum ? Number(s) : s);
        }}>
          <option value="">{t("pages.inbounds.telemtParamDefault", { defaultValue: "default" })}{placeholder ? ` (${placeholder})` : ""}</option>
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </SelectNative>
      );
    }
    case "strlist":
      return (
        <textarea
          className={`${inputCls} min-h-[60px] w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[var(--fg)]`}
          placeholder={t("pages.inbounds.telemtParamOnePerLine", { defaultValue: "one value per line" })}
          spellCheck={false}
          value={Array.isArray(value) ? (value as string[]).join("\n") : ""}
          onChange={(e) => {
            const list = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
            onChange(list.length ? list : undefined);
          }}
        />
      );
    case "object":
      return <JsonField value={value} onChange={onChange} placeholder={placeholder} />;
    default:
      return (
        <Input
          className={inputCls}
          placeholder={placeholder}
          value={unset ? "" : String(value)}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      );
  }
}

/** Raw JSON editor for table/map-valued keys; commits only valid JSON. */
function JsonField({ value, onChange, placeholder }: { value: unknown; onChange: (v: unknown) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value === undefined ? "" : JSON.stringify(value));
  const [bad, setBad] = useState(false);
  return (
    <div>
      <textarea
        className={`${inputCls} min-h-[60px] w-full rounded-md border px-2 py-1.5 text-[var(--fg)] bg-[var(--bg-elevated)] ${bad ? "border-red-500" : "border-[var(--border)]"}`}
        spellCheck={false}
        placeholder={placeholder || '{ "key": "value" }'}
        value={draft}
        onChange={(e) => {
          const s = e.target.value;
          setDraft(s);
          if (s.trim() === "") {
            setBad(false);
            return onChange(undefined);
          }
          try {
            onChange(JSON.parse(s));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad ? <p className="mt-1 text-[11px] text-red-500">JSON</p> : null}
    </div>
  );
}

function ParamRow({
  p,
  value,
  onChange,
}: {
  p: TelemtParam;
  value: unknown;
  onChange: (id: string, v: unknown) => void;
}) {
  const { t } = useTranslation();
  const id = paramId(p);
  const isSet = value !== undefined;
  return (
    <div className={`rounded-md border p-2.5 ${isSet ? "border-[var(--accent)]/50 bg-[var(--accent)]/5" : "border-[var(--border)]"}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <code className="text-xs font-semibold text-[var(--fg)]">{p.key}</code>
        <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-px font-mono text-[10px] text-[var(--fg-subtle)]">{p.type}</span>
        {p.default ? <span className="text-[10px] text-[var(--fg-subtle)]">{t("pages.inbounds.telemtParamDefaultLabel", { defaultValue: "default" })}: {p.default}</span> : null}
        {p.since ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-500" title={t("pages.inbounds.telemtParamSinceHint", { defaultValue: "Older Telemt builds reject this key; the panel refuses to save it while a target runs an older version." })}>
            Telemt ≥ {p.since}
          </span>
        ) : null}
        {p.hot ? (
          <span title={t("pages.inbounds.telemtParamHot", { defaultValue: "Applied by Telemt without restart (hot-reload)" })} className="inline-flex items-center text-[10px] text-amber-500">
            <Zap className="h-3 w-3" />
          </span>
        ) : null}
        {isSet ? (
          <button type="button" className="ml-auto text-[11px] text-[var(--fg-subtle)] underline hover:text-[var(--fg)]" onClick={() => onChange(id, undefined)}>
            {t("pages.inbounds.telemtParamReset", { defaultValue: "reset" })}
          </button>
        ) : null}
      </div>
      <ParamControl p={p} value={value} onChange={(v) => onChange(id, v)} />
      {p.desc ? <p className="mt-1.5 text-[11px] leading-snug text-[var(--fg-muted)]">{p.desc}</p> : null}
      {p.valid ? <p className="mt-0.5 text-[10px] leading-snug text-[var(--fg-subtle)]">{p.valid}</p> : null}
    </div>
  );
}

function sectionLabel(s: string) {
  return s === "" ? "(top level)" : s;
}

export function TelemtParamsEditor({
  params,
  onChange,
  upstreams,
  onUpstreamsChange,
  webEnabled,
}: {
  params: TelemtParams;
  onChange: (next: TelemtParams) => void;
  upstreams: TelemtUpstream[];
  onUpstreamsChange: (next: TelemtUpstream[]) => void;
  webEnabled: boolean;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<TelemtParam[] | null>(null);
  const [q, setQ] = useState("");
  const [onlySet, setOnlySet] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    loadCatalog().then((c) => alive && setCatalog(c));
    return () => {
      alive = false;
    };
  }, []);

  const editable = useMemo(
    () => (catalog ?? []).filter((p) => !p.managed && !p.container && !(p.array && !p.section.startsWith("web."))),
    [catalog],
  );
  const bySection = useMemo(() => {
    const m = new Map<string, TelemtParam[]>();
    for (const p of editable) {
      if (!webEnabled && p.section.startsWith("web")) continue;
      if (p.section === "web" && p.key === "enabled") continue;
      const arr = m.get(p.section) ?? [];
      arr.push(p);
      m.set(p.section, arr);
    }
    return m;
  }, [editable, webEnabled]);
  const upstreamParams = useMemo(() => (catalog ?? []).filter((p) => p.section === "upstreams" && !p.container), [catalog]);

  const setParam = (id: string, v: unknown) => {
    const next = { ...params };
    if (v === undefined) delete next[id];
    else next[id] = v;
    onChange(next);
  };

  const needle = q.trim().toLowerCase();
  const matches = (p: TelemtParam) =>
    (!onlySet || params[paramId(p)] !== undefined) &&
    (!needle || p.key.toLowerCase().includes(needle) || p.section.toLowerCase().includes(needle) || p.desc.toLowerCase().includes(needle));

  const setCount = Object.keys(params).length;

  if (catalog === null) {
    return <p className="text-xs text-[var(--fg-subtle)]">{t("common.loading", { defaultValue: "Loading…" })}</p>;
  }
  if (catalog.length === 0) {
    return <p className="text-xs text-red-500">{t("pages.inbounds.telemtParamsUnavailable", { defaultValue: "Parameter catalog is unavailable." })}</p>;
  }

  const flat = needle || onlySet;
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-[var(--fg-muted)]">
        {t("pages.inbounds.telemtParamsHint", {
          defaultValue:
            "Every documented Telemt config.toml key. Only the keys you set are written; everything else keeps Telemt's default. Keys SharX manages itself (ports, API, users, listeners) are not shown. ⚡ = applied without restart. A key must be supported by the Telemt build installed on the node.",
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-subtle)]" />
          <Input className="pl-7 text-xs" placeholder={t("pages.inbounds.telemtParamsSearch", { defaultValue: "Search key or description…" })} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
          <input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} />
          {t("pages.inbounds.telemtParamsOnlySet", { defaultValue: "only set" })} ({setCount})
        </label>
        {setCount > 0 ? (
          <Button type="button" variant="ghost" onClick={() => onChange({})}>
            {t("pages.inbounds.telemtParamsClear", { defaultValue: "Reset all" })}
          </Button>
        ) : null}
      </div>

      {flat ? (
        <div className="space-y-2">
          {[...bySection.values()].flat().filter(matches).slice(0, 80).map((p) => (
            <div key={paramId(p)}>
              <div className="mb-0.5 font-mono text-[10px] text-[var(--fg-subtle)]">[{sectionLabel(p.section)}]</div>
              <ParamRow p={p} value={params[paramId(p)]} onChange={setParam} />
            </div>
          ))}
        </div>
      ) : (
        [...bySection.entries()].map(([section, list]) => {
          const n = list.filter((p) => params[paramId(p)] !== undefined).length;
          const isOpen = !!open[section];
          return (
            <div key={section} className="rounded-lg border border-[var(--border)]">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                onClick={() => setOpen((o) => ({ ...o, [section]: !o[section] }))}
              >
                <span className="font-mono text-xs font-semibold text-[var(--fg)]">[{sectionLabel(section)}]</span>
                <span className="text-[11px] text-[var(--fg-subtle)]">
                  {n > 0 ? `${n} ✓ · ` : ""}
                  {list.length}
                </span>
              </button>
              {isOpen ? (
                <div className="space-y-2 border-t border-[var(--border)] p-3">
                  {list.map((p) => (
                    <ParamRow key={paramId(p)} p={p} value={params[paramId(p)]} onChange={setParam} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })
      )}

      <div className="rounded-lg border border-[var(--border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-xs font-semibold text-[var(--fg)]">[[upstreams]]</span>
          <Button type="button" variant="ghost" onClick={() => onUpstreamsChange([...upstreams, { type: "direct" }])}>
            <Plus className="h-3.5 w-3.5" /> {t("pages.inbounds.telemtUpstreamAdd", { defaultValue: "Add upstream" })}
          </Button>
        </div>
        <p className="mb-2 text-[11px] leading-snug text-[var(--fg-muted)]">
          {t("pages.inbounds.telemtUpstreamsHint", {
            defaultValue: "How Telemt reaches Telegram (direct, SOCKS4/5, Shadowsocks). With no entries Telemt uses a direct connection.",
          })}
        </p>
        <div className="space-y-2">
          {upstreams.map((up, idx) => (
            <div key={idx} className="rounded-md border border-[var(--border)] p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--fg)]">#{idx + 1}</span>
                <IconButton type="button" label="remove" onClick={() => onUpstreamsChange(upstreams.filter((_, i) => i !== idx))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {upstreamParams.map((p) => (
                  <div key={p.key}>
                    <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">{p.key}</label>
                    <ParamControl
                      p={p}
                      value={up[p.key]}
                      onChange={(v) => {
                        const next = { ...up };
                        if (v === undefined) delete next[p.key];
                        else next[p.key] = v;
                        onUpstreamsChange(upstreams.map((u, i) => (i === idx ? next : u)));
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
