"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { sizeFormat } from "@/lib/format";
import { Button, Input, Modal, SelectNative, Spinner } from "@/components/ui";

type Bytes = { upload: number; download: number; total: number };
type Point = { t: number; upload: number | null; download: number | null; total: number | null; nodes?: Record<string, Bytes> };
type TrafficNode = Bytes & { id: number; name: string };
type History = { points: Point[]; nodes: TrafficNode[]; cumulative: Bytes; cumulativeNodes: TrafficNode[]; baseline: Bytes; startedAt: number; bucketSeconds: number; rangeStart: number; rangeEnd: number };
export type TrafficTarget = { kind: "client" | "node"; id: number; name: string };
export function TrafficHistoryModal({ target, onClose, nested = false }: {
  target: TrafficTarget | null; onClose: () => void; nested?: boolean;
}) {
  const { t } = useTranslation();
  const localDate = (value: number) => { const d = new Date(value); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const [custom, setCustom] = useState<{from: number; to: number} | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [fromDraft, setFromDraft] = useState(() => localDate(Date.now()-3600000));
  const [toDraft, setToDraft] = useState(() => localDate(Date.now()));
  const draftFrom = new Date(fromDraft).getTime(), draftTo = new Date(toDraft).getTime();
  const validDraft = Number.isFinite(draftFrom) && Number.isFinite(draftTo) && draftFrom > 0 && draftTo > draftFrom && draftTo-draftFrom <= 366*86400000;
  const [minutes, setMinutes] = useState(60);
  const [nodeFilter, setNodeFilter] = useState("all");
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const kind = target?.kind;
  const id = target?.id;
  useEffect(() => { setNodeFilter("all"); }, [kind, id]);
  useEffect(() => {
    if (id == null || nested) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [id, nested]);
  useEffect(() => {
    if (!kind || id == null) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    setHistory(null); setError(false); setLoading(true);
    const load = async () => {
      try {
        const r = await getJson<History>(panel(`${kind}/traffic-history/${id}?${custom ? `from=${custom.from}&to=${custom.to}` : `minutes=${minutes}`}`));
        if (disposed) return;
        if (r.success && r.obj && Array.isArray(r.obj.points)) { setHistory(r.obj); setError(false); }
        else { setError(true); }
      } catch { if (!disposed) setError(true); }
      finally { if (!disposed) { setLoading(false); timer = setTimeout(() => void load(), 10_000); } }
    };
    void load();
    return () => { disposed = true; clearTimeout(timer); };
  }, [kind, id, minutes, custom, retry]);

  const nodes = history?.nodes ?? [];
  const selected = nodes.some(n => String(n.id) === nodeFilter) ? nodeFilter : "all";
  const points = (history?.points ?? []).map(p => {
    if (selected === "all") return p;
    const bytes = p.nodes?.[selected];
    return { ...p, upload: p.upload == null ? null : bytes?.upload ?? 0,
      download: p.download == null ? null : bytes?.download ?? 0, total: p.total == null ? null : bytes?.total ?? 0 };
  });
  const sums = points.reduce((sum, p) => ({ upload: sum.upload + (p.upload ?? 0), download: sum.download + (p.download ?? 0), total: sum.total + (p.total ?? 0) }), { upload: 0, download: 0, total: 0 });
  const hasSamples = points.some(p => p.total != null);
  const spanMinutes = custom ? (custom.to-custom.from)/60000 : minutes;
  const time = (value: number) => spanMinutes > 1440
    ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }) + (spanMinutes <= 10080 ? ` ${new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "")
    : new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const upload = t("pages.trafficHistory.upload");
  const download = t("pages.trafficHistory.download");
  const total = t("pages.trafficHistory.total");
  const nodeName = (n: TrafficNode) => n.id === 0 ? t("pages.trafficHistory.unattributed") : n.name || `${t("pages.trafficHistory.node")} #${n.id}`;

  return (
    <Modal open={target != null} onClose={onClose} width={920}
      title={`${t("pages.trafficHistory.title")} · ${target?.name ?? ""}`}
      portalClassName="!z-[120]" lockBodyScroll={false}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("pages.trafficHistory.range")}>
            {[15, 60, 360, 1440, 10080, 43200, 129600].map(n => (
              <Button key={n} variant={!custom && minutes === n ? "primary" : "secondary"}
                aria-pressed={!custom && minutes === n} className="!h-9 !px-3 !text-xs" onClick={() => { setCustom(null); setMinutes(n); }}>
                {n === 15 ? t("pages.trafficHistory.minutes", { count: n }) : n <= 1440 ? t("pages.trafficHistory.hours", { count: n / 60 }) : t("pages.trafficHistory.days", { count: n / 1440 })}
              </Button>
            ))}
          </div>
          <Button variant={custom ? "primary" : "secondary"} className="!h-9 !text-xs" aria-expanded={dateOpen} onClick={() => { if (!dateOpen) { setFromDraft(localDate(history?.rangeStart ?? Date.now()-minutes*60000)); setToDraft(localDate(history?.rangeEnd ?? Date.now())); } setDateOpen(v => !v); }}>{t("pages.trafficHistory.custom")}</Button>
        </div>
        {dateOpen ? <div className="grid gap-3 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1 text-xs text-[var(--fg-muted)]">{t("pages.trafficHistory.from")}<Input type="datetime-local" value={fromDraft} onChange={e => setFromDraft(e.target.value)} /></label>
          <label className="space-y-1 text-xs text-[var(--fg-muted)]">{t("pages.trafficHistory.to")}<Input type="datetime-local" value={toDraft} onChange={e => setToDraft(e.target.value)} /></label>
          <Button className="self-end" disabled={!validDraft} onClick={() => { setCustom({from:draftFrom,to:draftTo}); setDateOpen(false); }}>{t("pages.trafficHistory.apply")}</Button>
          {!validDraft ? <p className="text-xs text-[var(--danger)] sm:col-span-3">{t("pages.trafficHistory.invalidRange")}</p> : null}
        </div> : null}
        <p className="text-xs text-[var(--fg-muted)]">{history ? `${new Date(history.rangeStart).toLocaleString()} — ${new Date(history.rangeEnd).toLocaleString()} · ` : ""}{t("pages.trafficHistory.refresh")}</p>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--fg)]">{t("pages.trafficHistory.cumulative")}</span>
            <span className="font-mono text-lg text-[var(--fg)]">{history?.cumulative ? sizeFormat(history.cumulative.total) : "—"}</span>
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-[var(--fg-muted)]">
            <span>{upload} {sizeFormat(history?.cumulative?.upload ?? 0)} · {download} {sizeFormat(history?.cumulative?.download ?? 0)}</span>
            <span>{t("pages.trafficHistory.beforeTimeline")} {sizeFormat(history?.baseline?.total ?? 0)}</span>
          </div>
        </div>
        {kind === "client" ? <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-muted)]">
          {t("pages.trafficHistory.node")}
          <SelectNative value={selected} onChange={e => setNodeFilter(e.target.value)} className="!h-9 !w-auto min-w-48 !text-xs">
            <option value="all">{t("pages.trafficHistory.allNodes")}</option>
            {nodes.map(n => <option key={n.id} value={String(n.id)}>{nodeName(n)}</option>)}
          </SelectNative>
        </label> : null}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[{ label: total, value: sums.total }, { label: upload, value: sums.upload }, { label: download, value: sums.download }].map(item => (
            <div key={item.label} className="rounded-xl border border-[var(--border)] p-3">
              <div className="text-xs text-[var(--fg-muted)]">{item.label}</div>
              <div className="mt-1 font-mono text-base text-[var(--fg)]">{hasSamples ? sizeFormat(item.value) : "—"}</div>
              <div className="mt-1 text-[11px] text-[var(--fg-subtle)]">{t("pages.trafficHistory.forRange")}</div>
            </div>
          ))}
        </div>
        {error ? <div className="flex items-center justify-between gap-3 text-sm text-[var(--danger)]" role="alert">
          {t("pages.trafficHistory.error")}<Button variant="secondary" onClick={() => setRetry(v => v + 1)}>{t("pages.trafficHistory.retry")}</Button>
        </div> : null}
        <p className="text-xs text-[var(--fg-muted)]">{t("pages.trafficHistory.interval", { seconds: history?.bucketSeconds ?? 60 })}</p>
        <div className="h-72 w-full min-w-0" role="img" aria-label={t("pages.trafficHistory.chartLabel")}>
          {loading ? <div className="grid h-full place-items-center"><Spinner size={28} /></div>
          : !hasSamples ? <div className="grid h-full place-items-center text-sm text-[var(--fg-muted)]">{t("pages.trafficHistory.empty")}</div>
          : <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 16, bottom: 12, left: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="t" type="number" domain={[history?.rangeStart ?? "dataMin", history?.rangeEnd ?? "dataMax"]} allowDataOverflow scale="time" tickFormatter={time}
                tick={{ fill: "var(--fg-muted)", fontSize: 11 }} minTickGap={50} />
              <YAxis tickFormatter={sizeFormat} width={78} tick={{ fill: "var(--fg-muted)", fontSize: 11 }} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Point;
                return <div className="max-w-80 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs shadow-lg">
                  <div className="mb-2 text-[var(--fg-muted)]">{new Date(Number(label)).toLocaleString()} – {new Date(Number(label) + (history?.bucketSeconds ?? 60) * 1000)[(history?.bucketSeconds ?? 60) >= 86400 ? "toLocaleString" : "toLocaleTimeString"]()}</div>
                  {payload.map(p => <div key={String(p.dataKey)} className="flex justify-between gap-6"><span>{p.name}</span><span className="font-mono">{sizeFormat(Number(p.value))}</span></div>)}
                  {kind === "client" && selected === "all" && nodes.length ? <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                    {nodes.filter(n => (row.nodes?.[String(n.id)]?.total ?? 0) > 0).map(n => <div key={n.id} className="flex justify-between gap-4"><span>{nodeName(n)}</span><span className="font-mono">{sizeFormat(row.nodes?.[String(n.id)]?.total ?? 0)}</span></div>)}
                  </div> : null}
                </div>;
              }} />
              <Legend />
              <Line dataKey="total" name={total} stroke="var(--accent)" strokeWidth={2.5} type="linear" dot={points.length === 1} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="upload" name={upload} stroke="#22c55e" strokeDasharray="2 3" strokeWidth={1.5} type="linear" dot={points.length === 1} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="download" name={download} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} type="linear" dot={points.length === 1} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>}
        </div>
        {kind === "client" && nodes.length ? <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <caption className="px-3 py-2 text-left font-medium text-[var(--fg)]">{t("pages.trafficHistory.byNode")}</caption>
            <thead className="text-[var(--fg-muted)]"><tr><th className="px-3 py-2">{t("pages.trafficHistory.node")}</th><th className="px-3 py-2">{upload}</th><th className="px-3 py-2">{download}</th><th className="px-3 py-2">{total}</th></tr></thead>
            <tbody>{nodes.map(n => <tr key={n.id} className="border-t border-[var(--border)]">
              <td className="px-3 py-2"><button type="button" className="text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline" onClick={() => setNodeFilter(String(n.id))}>{nodeName(n)}</button></td>
              <td className="px-3 py-2 font-mono">{sizeFormat(n.upload)}</td><td className="px-3 py-2 font-mono">{sizeFormat(n.download)}</td><td className="px-3 py-2 font-mono">{sizeFormat(n.total)}</td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {kind === "client" && (history?.cumulativeNodes?.length ?? 0) > 0 ? <details className="rounded-xl border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--fg)]">{t("pages.trafficHistory.cumulativeByNode")}</summary>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs">
            <thead className="text-[var(--fg-muted)]"><tr><th className="py-2">{t("pages.trafficHistory.node")}</th><th className="py-2">{upload}</th><th className="py-2">{download}</th><th className="py-2">{total}</th></tr></thead>
            <tbody>{history?.cumulativeNodes.map(n => <tr key={n.id} className="border-t border-[var(--border)]"><td className="py-2">{nodeName(n)}</td><td className="py-2 font-mono">{sizeFormat(n.upload)}</td><td className="py-2 font-mono">{sizeFormat(n.download)}</td><td className="py-2 font-mono">{sizeFormat(n.total)}</td></tr>)}</tbody>
          </table></div>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">{t("pages.trafficHistory.legacyHint")}</p>
        </details> : null}
        <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
          {t("pages.trafficHistory.hint")}
          {history?.startedAt ? ` ${t("pages.trafficHistory.since")} ${new Date(history.startedAt).toLocaleString()}.` : ""}
        </p>
      </div>
    </Modal>
  );
}
