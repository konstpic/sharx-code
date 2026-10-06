"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowDownUp, ChevronRight, Copy, Download, Radio, RefreshCw, Search, WrapText, X } from "lucide-react";
import { AlertBanner, Button, IconButton, Input, SelectNative } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { panel } from "@/lib/paths";

export type LogSource = { type: "node" | "balancer" | "panel"; id: number };

type Entry = {
  source: string;
  level: string;
  message: string;
  ts: number;
  component?: string;
  connId?: string;
};
type Bucket = { t: number; debug: number; info: number; warn: number; error: number };
type Result = {
  entries: Entry[];
  components: string[];
  volume: Bucket[];
  total: number;
  agentLogLevel?: string;
  agentError?: string;
};

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_STYLE: Record<Level, { text: string; bar: string; chip: string; fill: string }> = {
  debug: { text: "text-[var(--fg-subtle)]", bar: "border-l-transparent", chip: "border-zinc-500/40 text-zinc-300", fill: "#71717a" },
  info: { text: "text-sky-400", bar: "border-l-transparent", chip: "border-sky-500/40 text-sky-300", fill: "#38bdf8" },
  warn: { text: "text-amber-400", bar: "border-l-amber-400", chip: "border-amber-500/40 text-amber-300", fill: "#fbbf24" },
  error: { text: "text-red-400", bar: "border-l-red-500", chip: "border-red-500/40 text-red-300", fill: "#f87171" },
};

const RANGES: { id: string; ms: number; label: string }[] = [
  { id: "15m", ms: 15 * 60_000, label: "15 min" },
  { id: "1h", ms: 3_600_000, label: "1 h" },
  { id: "6h", ms: 6 * 3_600_000, label: "6 h" },
  { id: "24h", ms: 24 * 3_600_000, label: "24 h" },
  { id: "7d", ms: 7 * 86_400_000, label: "7 d" },
  { id: "all", ms: 0, label: "All" },
];

function lvl(l: string): Level {
  const x = l === "warning" ? "warn" : l;
  return (LEVELS as readonly string[]).includes(x) ? (x as Level) : "info";
}

function fmtTime(ts: number, withDate: boolean): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return withDate ? `${p(d.getDate())}.${p(d.getMonth() + 1)} ${t}` : t;
}

const FIELD_RE = /([A-Za-z_][\w.-]*)=("[^"]*"|\S+)/g;

function splitMessage(msg: string): { text: string; fields: [string, string][] } {
  const first = msg.search(/\s[A-Za-z_][\w.-]*=\S/);
  if (first < 0) return { text: msg, fields: [] };
  const fields: [string, string][] = [];
  for (const m of msg.slice(first).matchAll(FIELD_RE)) fields.push([m[1], m[2].replace(/^"|"$/g, "")]);
  return { text: msg.slice(0, first).trim(), fields };
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-400/30 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Log explorer in the spirit of Grafana/Loki: volume histogram, level and component chips, term search ("-term" excludes),
 * time range, live tail, expandable lines with field filters, and download as txt / ndjson / csv.
 */
export function LogExplorer({ source, heightClass = "max-h-[56vh]" }: { source: LogSource; heightClass?: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState("1h");
  const [levels, setLevels] = useState<Set<Level>>(new Set(["info", "warn", "error"]));
  const [components, setComponents] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [live, setLive] = useState(true);
  const [newestFirst, setNewestFirst] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dlOpen, setDlOpen] = useState(false);
  const [levelBusy, setLevelBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(qDraft), 300);
    return () => window.clearTimeout(id);
  }, [qDraft]);

  const params = useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams({ levels: Array.from(levels).join(",") });
      if (components.size > 0) p.set("component", Array.from(components).join(","));
      if (q.trim()) p.set("q", q.trim());
      const ms = RANGES.find((r) => r.id === range)?.ms ?? 0;
      if (ms > 0) p.set("since", String(Date.now() - ms));
      for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
      return p;
    },
    [levels, components, q, range],
  );

  const base = `api/server/logs/entity/${source.type}/${source.id}`;

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await getJson<Result>(panel(`${base}?${params({ count: "1500" })}`));
      if (my !== seq.current) return;
      if (!r.success) {
        setError(r.msg || "Failed to load logs");
        return;
      }
      setError("");
      setRes(r.obj);
      setKnown((prev) => Array.from(new Set([...prev, ...(r.obj.components ?? [])])).sort());
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [base, params]);

  useEffect(() => {
    setRes(null);
    setKnown([]);
    setComponents(new Set());
  }, [source.type, source.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [live, load]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    apply(n);
  };

  const addTerm = (term: string) => setQDraft((cur) => (cur.split(/\s+/).includes(term) ? cur : `${cur.trim()} ${term}`.trim()));

  const counts = useMemo(() => {
    const c: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const b of res?.volume ?? []) {
      c.debug += b.debug;
      c.info += b.info;
      c.warn += b.warn;
      c.error += b.error;
    }
    return c;
  }, [res]);

  const rows = useMemo(() => {
    const e = res?.entries ?? [];
    return newestFirst ? e : [...e].reverse();
  }, [res, newestFirst]);

  const terms = useMemo(() => q.toLowerCase().split(/\s+/).filter((x) => x && !x.startsWith("-")), [q]);
  const spansDays = rows.length > 0 && new Date(rows[0].ts).toDateString() !== new Date(rows[rows.length - 1].ts).toDateString();

  const downloadHref = (format: string) => panel(`${base}?${params({ download: "1", format, count: "100000" })}`);

  const setAgentLevel = async (lv: "info" | "debug") => {
    setLevelBusy(true);
    try {
      const r = await postJson(panel(`balancer/log-level/${source.id}`), { level: lv }, true);
      if (!r.success) setError(r.msg);
      await load();
    } finally {
      setLevelBusy(false);
    }
  };

  const filtersActive = components.size > 0 || q.trim() !== "" || levels.size !== 3 || !levels.has("info") || levels.has("debug");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]" />
          <Input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder={t("pages.logs.searchPh", { defaultValue: "Search: words must all match, -word excludes   e.g. timeout -debug" })}
            className="!pl-8"
            autoComplete="off"
          />
        </div>
        <SelectNative inputSize="sm" className="!w-28" value={range} onChange={(e) => setRange(e.target.value)} title={t("pages.logs.range", { defaultValue: "Time range" })}>
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id === "all" ? t("pages.logs.rangeAll", { defaultValue: "All time" }) : t("pages.logs.rangeLast", { defaultValue: "Last {{r}}", r: r.label })}
            </option>
          ))}
        </SelectNative>
        <Button
          type="button"
          variant={live ? "primary" : "secondary"}
          className="!h-8 !gap-1.5 !px-2.5 !text-xs"
          onClick={() => setLive((v) => !v)}
          title={t("pages.logs.liveHint", { defaultValue: "Live tail: reload every 4 seconds" })}
        >
          <Radio size={13} className={live ? "animate-pulse" : ""} />
          {live ? t("pages.logs.live", { defaultValue: "Live" }) : t("pages.logs.paused", { defaultValue: "Paused" })}
        </Button>
        <IconButton label={t("pages.logs.refresh", { defaultValue: "Refresh" })} onClick={() => void load()}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </IconButton>
        <IconButton label={t("pages.logs.sort", { defaultValue: "Newest first / oldest first" })} onClick={() => setNewestFirst((v) => !v)}>
          <ArrowDownUp size={16} className={newestFirst ? "" : "text-[var(--accent)]"} />
        </IconButton>
        <IconButton label={t("pages.logs.wrap", { defaultValue: "Wrap long lines" })} onClick={() => setWrap((v) => !v)}>
          <WrapText size={16} className={wrap ? "text-[var(--accent)]" : ""} />
        </IconButton>
        <div className="relative">
          <Button type="button" variant="secondary" className="!h-8 !gap-1.5 !px-2.5 !text-xs" onClick={() => setDlOpen((v) => !v)}>
            <Download size={13} />
            {t("pages.logs.download", { defaultValue: "Download" })}
          </Button>
          {dlOpen ? (
            <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-xs shadow-xl" onMouseLeave={() => setDlOpen(false)}>
              <p className="border-b border-[var(--border)] px-3 py-2 text-[var(--fg-subtle)]">
                {t("pages.logs.downloadHint", { defaultValue: "Everything matching the current filters (up to 100 000 lines)" })}
              </p>
              {[
                ["log", "Text (.log)"],
                ["ndjson", "JSON lines (.ndjson)"],
                ["csv", "Spreadsheet (.csv)"],
              ].map(([f, label]) => (
                <a key={f} href={downloadHref(f)} download onClick={() => setDlOpen(false)} className="block px-3 py-2 text-[var(--fg)] hover:bg-[var(--bg)]">
                  {label}
                </a>
              ))}
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-[var(--fg)] hover:bg-[var(--bg)]"
                onClick={() => {
                  void copyTextToClipboard(rows.map((e) => `${new Date(e.ts).toISOString()} ${e.level.toUpperCase()} [${e.component || e.source}] ${e.message}`).join("\n"));
                  setDlOpen(false);
                }}
              >
                {t("pages.logs.copyShown", { defaultValue: "Copy the lines shown" })}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => toggle(levels, l, setLevels)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-opacity ${LEVEL_STYLE[l].chip} ${levels.has(l) ? "bg-white/5" : "opacity-40"}`}
          >
            {l} <span className="font-mono font-normal opacity-70">{counts[l]}</span>
          </button>
        ))}
        {known.length > 0 ? <span className="mx-1 h-4 w-px bg-[var(--border)]" /> : null}
        {known.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggle(components, c, setComponents)}
            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
              components.has(c) ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            {c}
          </button>
        ))}
        {filtersActive ? (
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)] hover:text-[var(--fg)]"
            onClick={() => {
              setLevels(new Set(["info", "warn", "error"]));
              setComponents(new Set());
              setQDraft("");
            }}
          >
            <X size={12} />
            {t("pages.logs.reset", { defaultValue: "Reset filters" })}
          </button>
        ) : null}
      </div>

      {(res?.volume?.length ?? 0) > 1 ? (
        <div className="h-[72px] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2 pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={res!.volume} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={1}>
              <XAxis dataKey="t" tickFormatter={(v: number) => fmtTime(v, false).slice(0, 5)} tick={{ fontSize: 10, fill: "var(--fg-subtle)" }} axisLine={false} tickLine={false} minTickGap={36} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.06)" }}
                contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                labelFormatter={(v) => fmtTime(Number(v), true)}
              />
              {LEVELS.map((l) => (
                <Bar key={l} dataKey={l} stackId="v" fill={LEVEL_STYLE[l].fill} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {source.type === "balancer" && res?.agentLogLevel ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--fg-muted)]">
          <span>
            {t("pages.logs.agentLevel", { defaultValue: "Agent journal level" })}: <b className="text-[var(--fg)]">{res.agentLogLevel.toUpperCase()}</b>
          </span>
          <Button type="button" variant="secondary" className="!h-7 !text-xs" disabled={levelBusy} onClick={() => void setAgentLevel(res.agentLogLevel === "debug" ? "info" : "debug")}>
            {res.agentLogLevel === "debug" ? t("pages.logs.debugOff", { defaultValue: "Back to INFO" }) : t("pages.logs.debugOn", { defaultValue: "Record every connection (DEBUG)" })}
          </Button>
          <span className="text-[var(--fg-subtle)]">
            {t("pages.logs.debugHint", { defaultValue: "DEBUG adds one line per closed connection; use it while investigating, then switch back." })}
          </span>
        </div>
      ) : null}
      {res?.agentError ? (
        <AlertBanner type="warning" title={`${t("pages.logs.agentUnavailable", { defaultValue: "The agent's own journal is unavailable" })}: ${res.agentError}`} />
      ) : null}
      {error ? <AlertBanner type="error" title={error} /> : null}

      <div className="text-[11px] text-[var(--fg-subtle)]">
        {t("pages.logs.shown", { defaultValue: "{{n}} of {{total}} lines", n: rows.length, total: res?.total ?? 0 })}
      </div>

      <div className={`${heightClass} overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]`}>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]">{loading ? "…" : t("pages.logs.empty", { defaultValue: "No entries for these filters yet." })}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((e, i) => {
              const key = `${e.ts}-${i}`;
              const L = lvl(e.level);
              const { text, fields } = splitMessage(e.message);
              const isOpen = open === key;
              return (
                <li key={key} className={`border-l-[3px] text-[13px] leading-snug ${LEVEL_STYLE[L].bar} ${isOpen ? "bg-[var(--bg)]" : "hover:bg-[var(--bg)]"}`}>
                  <div className="grid cursor-pointer grid-cols-[1rem_4.5rem_3.25rem_6.5rem_1fr] items-baseline gap-x-2 px-2 py-1.5" onClick={() => setOpen(isOpen ? null : key)}>
                    <ChevronRight size={12} className={`self-center text-[var(--fg-subtle)] transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <time className="font-mono text-xs tabular-nums text-[var(--fg-subtle)]" title={new Date(e.ts).toISOString()}>
                      {fmtTime(e.ts, spansDays)}
                    </time>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${LEVEL_STYLE[L].text}`}>{L}</span>
                    <span className="truncate text-xs text-[var(--fg-muted)]">{e.component || e.source}</span>
                    <div className={`min-w-0 ${wrap ? "break-words" : "truncate"} ${L === "debug" ? "text-[var(--fg-muted)]" : "text-[var(--fg)]"}`}>
                      <Highlight text={text} terms={terms} />
                      {fields.map(([k, v], j) => (
                        <span key={j} className="ml-2 whitespace-nowrap font-mono text-[11px]">
                          <span className="text-[var(--fg-subtle)]">{k}=</span>
                          <span className="text-[var(--fg-muted)]">
                            <Highlight text={v} terms={terms} />
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {isOpen ? (
                    <div className="space-y-2 border-t border-[var(--border)] px-3 py-2 pl-9 text-xs">
                      <p className="whitespace-pre-wrap break-words font-mono text-[var(--fg)]">{e.message}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {[...fields, ...(e.connId ? ([["conn", e.connId]] as [string, string][]) : []), ...(e.component ? ([["component", e.component]] as [string, string][]) : [])].map(([k, v], j) => (
                          <span key={j} className="inline-flex items-center gap-1 font-mono">
                            <span className="text-[var(--fg-subtle)]">{k}</span>
                            <span className="text-[var(--fg)]">{v}</span>
                            <button type="button" title={t("pages.logs.filterFor", { defaultValue: "Filter for this value" })} className="rounded px-1 text-emerald-400 hover:bg-white/10" onClick={() => addTerm(v.includes(" ") ? v.split(" ")[0] : v)}>
                              +
                            </button>
                            <button type="button" title={t("pages.logs.filterOut", { defaultValue: "Filter out this value" })} className="rounded px-1 text-red-400 hover:bg-white/10" onClick={() => addTerm(`-${v.includes(" ") ? v.split(" ")[0] : v}`)}>
                              −
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" className="!h-7 !gap-1 !text-xs" onClick={() => void copyTextToClipboard(`${new Date(e.ts).toISOString()} ${e.level.toUpperCase()} [${e.component || e.source}] ${e.message}`)}>
                          <Copy size={12} />
                          {t("pages.logs.copyLine", { defaultValue: "Copy line" })}
                        </Button>
                        {e.connId ? (
                          <Button type="button" variant="secondary" className="!h-7 !text-xs" onClick={() => setQDraft(e.connId!)}>
                            {t("pages.logs.filterConn", { defaultValue: "Show only this connection" })}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
