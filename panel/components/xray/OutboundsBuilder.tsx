"use client";

import { Reorder, useDragControls } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  GripVertical,
  Link,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import {
  type OutboundFormRow,
  OUTBOUND_PROTOCOL_OPTIONS,
  moveRow,
  newOutboundRow,
  parseOutboundsSection,
  patchRowRaw,
  serializeOutboundsSection,
  updateRowProtocol,
} from "@/lib/xrayOutboundForm";
import { OutboundEditor } from "@/components/xray/outbound/OutboundEditor";
import { parseProxyLink } from "@/lib/parseProxyLink";
import { Button, Input, SelectNative } from "@/components/ui";

type Props = {
  value: string;
  onChange: (sectionJson: string) => void;
  readOnly: boolean;
  t: TFunction;
  /** When this changes (e.g. profile load), re-parse `value` from server */
  syncKey: string | number;
  /** How many routing rules / balancers reference each outbound tag. */
  usage?: Record<string, number>;
  /** Known inbound tags (loopback target suggestions). */
  inboundTags?: string[];
};

function asRec(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return { ...(v as Record<string, unknown>) };
  return {};
}

function outboundSummary(row: OutboundFormRow): string {
  const st = asRec(row.raw.settings);
  const first = (arr: unknown) => (Array.isArray(arr) && arr[0] && typeof arr[0] === "object" ? (arr[0] as Record<string, unknown>) : null);
  const srv = first(st.vnext) ?? first(st.servers);
  const parts: string[] = [];
  if (srv && typeof srv.address === "string" && srv.address) {
    parts.push(srv.port != null ? `${srv.address}:${srv.port}` : srv.address);
  } else if (typeof st.address === "string" && st.address) {
    parts.push(st.port != null ? `${st.address}:${st.port}` : st.address);
  }
  const ss = asRec(row.raw.streamSettings);
  if (typeof ss.network === "string" && ss.network) parts.push(ss.network);
  if (typeof ss.security === "string" && ss.security && ss.security !== "none") parts.push(ss.security);
  return parts.join(" · ");
}

function OutboundItem({
  row,
  index,
  total,
  open,
  usedBy,
  readOnly,
  t,
  otherTags,
  inboundTags,
  onToggle,
  onRow,
  onMove,
  onDuplicate,
  onRemove,
}: {
  row: OutboundFormRow;
  index: number;
  total: number;
  open: boolean;
  usedBy: number;
  readOnly: boolean;
  t: TFunction;
  otherTags: string[];
  inboundTags: string[];
  onToggle: () => void;
  onRow: (r: OutboundFormRow) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const summary = outboundSummary(row);
  const iconBtn =
    "rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <Reorder.Item
      value={row}
      as="div"
      dragListener={false}
      dragControls={controls}
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]"
    >
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <button
          type="button"
          aria-label="drag"
          disabled={readOnly}
          onPointerDown={(e) => {
            if (!readOnly) controls.start(e);
          }}
          className="cursor-grab touch-none rounded-lg p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical size={18} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-semibold text-[var(--fg-muted)]">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[var(--surface)]"
        >
          {open ? <ChevronDown size={16} className="shrink-0 text-[var(--fg-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--fg-muted)]" />}
          <span className="truncate text-sm font-medium text-[var(--fg)]">{row.tag || <em className="text-[var(--fg-subtle)]">no tag</em>}</span>
          <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)]">{row.protocol}</span>
          {summary ? <span className="hidden min-w-0 truncate font-mono text-[11px] text-[var(--fg-subtle)] md:inline">{summary}</span> : null}
        </button>
        {usedBy > 0 ? (
          <span
            title={t("pages.xray.cfg.usedByHint", { defaultValue: "Referenced by routing rules or balancers" })}
            className="shrink-0 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
          >
            {t("pages.xray.cfg.usedBy", { defaultValue: "used: {{n}}", n: usedBy })}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button type="button" className={iconBtn} disabled={readOnly || index === 0} onClick={() => onMove(index - 1)} aria-label="up">
            <ChevronUp size={15} />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly || index === total - 1} onClick={() => onMove(index + 1)} aria-label="down">
            <ChevronDown size={15} />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly} onClick={onDuplicate} aria-label="duplicate">
            <Copy size={15} />
          </button>
          <button type="button" className={`${iconBtn} !text-rose-300 hover:!bg-rose-500/10`} disabled={readOnly || total <= 1} onClick={onRemove} aria-label="delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-[var(--border)] p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">tag</label>
              <Input
                className="w-full font-mono"
                value={row.tag}
                readOnly={readOnly}
                onChange={(e) => {
                  const v = e.target.value;
                  onRow({ ...row, tag: v, raw: { ...row.raw, tag: v } });
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">{t("protocol")}</label>
              <SelectNative
                value={row.protocol}
                disabled={readOnly}
                onChange={(e) => onRow(updateRowProtocol(row, e.target.value))}
              >
                {OUTBOUND_PROTOCOL_OPTIONS.includes(row.protocol as (typeof OUTBOUND_PROTOCOL_OPTIONS)[number]) ? null : (
                  <option value={row.protocol}>{row.protocol}</option>
                )}
                {OUTBOUND_PROTOCOL_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </SelectNative>
            </div>
          </div>
          <OutboundEditor
            raw={row.raw}
            onRaw={(raw) => onRow(patchRowRaw(row, raw))}
            protocol={row.protocol}
            readOnly={readOnly}
            t={t}
            otherOutboundTags={otherTags}
            inboundTags={inboundTags}
          />
        </div>
      ) : null}
    </Reorder.Item>
  );
}

export function OutboundsBuilder({ value, onChange, readOnly, t, syncKey, usage, inboundTags }: Props) {
  const [rows, setRows] = useState<OutboundFormRow[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [initError, setInitError] = useState<string | null>(null);
  const lastEmitted = useRef<string | null>(null);
  const prevSyncKey = useRef(syncKey);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const normJson = useCallback((s: string) => {
    try {
      return JSON.stringify(JSON.parse(s));
    } catch {
      return s;
    }
  }, []);

  useEffect(() => {
    const syncKeyBumped = prevSyncKey.current !== syncKey;
    prevSyncKey.current = syncKey;
    if (!syncKeyBumped && lastEmitted.current != null && normJson(value) === normJson(lastEmitted.current)) {
      return;
    }
    const { rows: next, error } = parseOutboundsSection(value);
    if (error) {
      setInitError(t("pages.xrayCoreConfigProfiles.invalidJson"));
      return;
    }
    setInitError(null);
    setRows(next!);
    lastEmitted.current = serializeOutboundsSection(next!);
  }, [value, syncKey, t, normJson]);

  const push = useCallback(
    (next: OutboundFormRow[]) => {
      setRows(next);
      const json = serializeOutboundsSection(next);
      lastEmitted.current = json;
      onChange(json);
    },
    [onChange],
  );

  if (initError) {
    return <p className="text-sm text-rose-300">{initError}</p>;
  }

  const allOpen = rows.length > 0 && rows.every((r) => open[r.id]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--fg-subtle)]">
          {t("pages.xray.cfg.outboundsOrder", { defaultValue: "The first outbound is the default: traffic that matches no rule goes there. Drag the handle to reorder." })}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="!gap-1.5 !px-2.5 !py-1.5 !text-xs"
          onClick={() => setOpen(allOpen ? {} : Object.fromEntries(rows.map((r) => [r.id, true])))}
        >
          {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          {allOpen ? t("pages.xray.routingBuilder.collapseAll", { defaultValue: "Collapse all" }) : t("pages.xray.routingBuilder.expandAll", { defaultValue: "Expand all" })}
        </Button>
      </div>
      <Reorder.Group axis="y" values={rows} onReorder={(next) => !readOnly && push(next)} as="div" className="space-y-2">
        {rows.map((row, idx) => (
          <OutboundItem
            key={row.id}
            row={row}
            index={idx}
            total={rows.length}
            open={open[row.id] ?? false}
            usedBy={usage?.[row.tag.trim()] ?? 0}
            readOnly={readOnly}
            t={t}
            otherTags={rows.filter((r) => r.id !== row.id).map((r) => r.tag.trim()).filter(Boolean)}
            inboundTags={inboundTags ?? []}
            onToggle={() => setOpen((o) => ({ ...o, [row.id]: !(o[row.id] ?? false) }))}
            onRow={(r) => {
              const n = rows.slice();
              n[idx] = r;
              push(n);
            }}
            onMove={(to) => push(moveRow(rows, idx, to))}
            onDuplicate={() => {
              const copy: OutboundFormRow = {
                ...row,
                id: `dup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                tag: `${row.tag}-copy`,
                raw: { ...row.raw, tag: `${row.tag}-copy` },
              };
              const n = rows.slice();
              n.splice(idx + 1, 0, copy);
              push(n);
              setOpen((o) => ({ ...o, [copy.id]: true }));
            }}
            onRemove={() => {
              if (rows.length <= 1) return;
              push(rows.filter((_, i) => i !== idx));
            }}
          />
        ))}
      </Reorder.Group>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="!gap-2"
          disabled={readOnly}
          onClick={() => push([...rows, newOutboundRow("freedom")])}
        >
          <Plus size={16} />
          {t("pages.xray.outbound.add")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="!gap-2"
          disabled={readOnly}
          onClick={() => {
            setImportText("");
            setImportError(null);
            setImportOpen((v) => !v);
          }}
        >
          <Link size={16} />
          {t("pages.xray.outbound.importFromLink", "Import from link")}
        </Button>
      </div>
      {importOpen && !readOnly && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 space-y-2">
          <p className="text-xs text-[var(--fg-muted)]">
            {t("pages.xray.outbound.importHint", "Paste vless://, vmess://, trojan://, or ss:// links (one per line)")}
          </p>
          <textarea
            className="w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-sm font-mono resize-y min-h-[80px] text-[var(--fg)]"
            placeholder="vless://..."
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importError && <p className="text-xs text-rose-400">{importError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const lines = importText.split("\n").map((l) => l.trim()).filter(Boolean);
                if (lines.length === 0) {
                  setImportError(t("pages.xray.outbound.importEmpty", "No links to import"));
                  return;
                }
                const imported: OutboundFormRow[] = [];
                const failed: string[] = [];
                for (const line of lines) {
                  const parsed = parseProxyLink(line);
                  if (parsed) {
                    imported.push({ id: `import-${Date.now()}-${Math.random()}`, ...parsed });
                  } else {
                    failed.push(line.slice(0, 60));
                  }
                }
                if (imported.length === 0) {
                  setImportError(t("pages.xray.outbound.importFailed", "Could not parse any links"));
                  return;
                }
                push([...rows, ...imported]);
                setImportOpen(false);
                setImportText("");
                setImportError(null);
                if (failed.length > 0) {
                  // show partial failure info
                  setImportError(
                    t("pages.xray.outbound.importPartial", `Imported {{count}} links. Failed: {{failed}}`, {
                      count: imported.length,
                      failed: failed.join(", "),
                    }),
                  );
                  setImportOpen(true);
                }
              }}
            >
              {t("pages.xray.outbound.importApply", "Import")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setImportOpen(false);
                setImportError(null);
                setImportText("");
              }}
            >
              {t("cancel", "Cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
