"use client";

import { Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button, Input, SelectNative, Switch } from "@/components/ui";
import type { RoutingTagContext } from "@/components/xray/routing/useRoutingTags";
import { isRecord } from "@/lib/xrayConfigSections";

export type SectionEditorProps = {
  value: string;
  onChange: (sectionJson: string) => void;
  readOnly: boolean;
  t: TFunction;
  tags: RoutingTagContext;
};

export type Tr = (key: string, fallback: string, vars?: Record<string, string | number>) => string;

/** Translation helper scoped to pages.xray.cfg.* with an English fallback. */
export function makeTr(t: TFunction): Tr {
  return (key, fallback, vars) => t(`pages.xray.cfg.${key}`, { defaultValue: fallback, ...vars }) as string;
}

/**
 * Controlled JSON-object view over a section string. Unknown keys are never dropped:
 * edits patch the parsed object and re-serialize it.
 */
export function useJsonObject(value: string, onChange: (json: string) => void) {
  const obj = useMemo<Record<string, unknown>>(() => {
    try {
      const p = JSON.parse(value) as unknown;
      return isRecord(p) ? p : {};
    } catch {
      return {};
    }
  }, [value]);

  /** Patch keys; `undefined` removes the key. */
  const patch = useCallback(
    (p: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...obj };
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      onChange(JSON.stringify(next, null, 2));
    },
    [obj, onChange],
  );
  return { obj, patch };
}

/** Same as useJsonObject but for a section that is an array of objects. */
export function useJsonArray(value: string, onChange: (json: string) => void) {
  const arr = useMemo<unknown[]>(() => {
    try {
      const p = JSON.parse(value) as unknown;
      if (Array.isArray(p)) return p;
      if (isRecord(p) && Object.keys(p).length > 0) return [p];
      return [];
    } catch {
      return [];
    }
  }, [value]);
  const set = useCallback((next: unknown[]) => onChange(JSON.stringify(next, null, 2)), [onChange]);
  return { arr, set };
}

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-[11px] leading-snug text-[var(--fg-subtle)]">{hint}</div> : null}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--fg)]">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] leading-snug text-[var(--fg-subtle)]">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={typeof label === "string" ? label : undefined} />
    </div>
  );
}

export function TextField({
  value,
  onChange,
  disabled,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Input
      className={`w-full ${mono ? "font-mono" : ""}`}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Number input that writes `undefined` when cleared so the key is removed from JSON. */
export function NumberField({
  value,
  onChange,
  disabled,
  placeholder,
  min,
}: {
  value: unknown;
  onChange: (v: number | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
}) {
  return (
    <Input
      type="number"
      min={min}
      className="w-full"
      value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.trim() === "") return onChange(undefined);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function SelectField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label?: string }[];
  disabled?: boolean;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <SelectNative value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? (o.value === "" ? "—" : o.value)}
        </option>
      ))}
      {!known ? <option value={value}>{value}</option> : null}
    </SelectNative>
  );
}

export function ToggleChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
          : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
      }`}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
      {title || actions ? (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <div className="text-sm font-semibold text-[var(--fg)]">{title}</div>
          <div className="flex items-center gap-0.5">{actions}</div>
        </div>
      ) : null}
      <div className="p-3">{children}</div>
    </div>
  );
}

export function MiniBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "text-rose-300 hover:bg-rose-500/10" : "text-[var(--fg-muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"
      }`}
    >
      {children}
    </button>
  );
}

/** Row-level controls (up / down / delete) shared by list editors. */
export function RowActions({
  index,
  total,
  readOnly,
  tr,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  readOnly: boolean;
  tr: Tr;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <MiniBtn label={tr("moveUp", "Move up")} disabled={readOnly || index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp size={15} />
      </MiniBtn>
      <MiniBtn label={tr("moveDown", "Move down")} disabled={readOnly || index === total - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown size={15} />
      </MiniBtn>
      <MiniBtn label={tr("remove", "Remove")} disabled={readOnly} onClick={onRemove} danger>
        <Trash2 size={15} />
      </MiniBtn>
    </>
  );
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length || from === to) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Button type="button" variant="secondary" className="!gap-2" disabled={disabled} onClick={onClick}>
      <Plus size={16} />
      {children}
    </Button>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-5 text-center text-sm text-[var(--fg-muted)]">
      {children}
    </div>
  );
}

/**
 * Textarea holding a JSON value. The user's text is kept locally while invalid and only
 * committed to the parent once it parses, so typing never clobbers the config.
 */
export function JsonArea({
  value,
  onCommit,
  disabled,
  rows = 5,
  placeholder,
}: {
  value: unknown;
  onCommit: (v: unknown) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const canonical = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(canonical);
  const [lastCanonical, setLastCanonical] = useState(canonical);
  const [error, setError] = useState(false);
  if (canonical !== lastCanonical) {
    // parent changed the value (reorder / reload): adopt it
    setLastCanonical(canonical);
    setText(canonical);
    setError(false);
  }
  return (
    <div>
      <textarea
        rows={rows}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (v.trim() === "") {
            setError(false);
            onCommit(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(v) as unknown;
            setError(false);
            setLastCanonical(JSON.stringify(parsed, null, 2));
            onCommit(parsed);
          } catch {
            setError(true);
          }
        }}
        className={`w-full rounded-xl border bg-[var(--bg)] p-2 font-mono text-xs text-[var(--fg)] outline-none focus:ring-1 focus:ring-[var(--accent)] ${
          error ? "border-rose-500/60" : "border-[var(--border)] focus:border-[var(--accent)]"
        }`}
      />
      {error ? <div className="mt-1 text-[11px] text-rose-300">JSON</div> : null}
    </div>
  );
}

export function SubSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">{title}</div>
      {children}
    </div>
  );
}

export function Disclosure({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/**
 * Collapsible, draggable list row shared by the list-style editors: grip, index, title with
 * badges, optional summary, and up / down / duplicate / delete actions. Must sit inside a Reorder.Group.
 */
export function ReorderCard<T>({
  value,
  index,
  total,
  open,
  onToggle,
  title,
  badges,
  summary,
  readOnly,
  onMove,
  onDuplicate,
  onRemove,
  canRemove = true,
  children,
}: {
  value: T;
  index: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
  badges?: ReactNode;
  summary?: ReactNode;
  readOnly: boolean;
  onMove: (to: number) => void;
  onDuplicate?: () => void;
  onRemove: () => void;
  canRemove?: boolean;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const iconBtn =
    "rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <Reorder.Item value={value} as="div" dragListener={false} dragControls={controls} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
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
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-semibold text-[var(--fg-muted)]">{index + 1}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[var(--surface)]">
          {open ? <ChevronDown size={16} className="shrink-0 text-[var(--fg-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--fg-muted)]" />}
          <span className="truncate text-sm font-medium text-[var(--fg)]">{title}</span>
          {badges}
          {summary ? <span className="hidden min-w-0 truncate font-mono text-[11px] text-[var(--fg-subtle)] md:inline">{summary}</span> : null}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button type="button" className={iconBtn} disabled={readOnly || index === 0} onClick={() => onMove(index - 1)} aria-label="up">
            <ArrowUp size={15} />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly || index === total - 1} onClick={() => onMove(index + 1)} aria-label="down">
            <ArrowDown size={15} />
          </button>
          {onDuplicate ? (
            <button type="button" className={iconBtn} disabled={readOnly} onClick={onDuplicate} aria-label="duplicate">
              <Copy size={15} />
            </button>
          ) : null}
          <button type="button" className={`${iconBtn} !text-rose-300 hover:!bg-rose-500/10`} disabled={readOnly || !canRemove} onClick={onRemove} aria-label="delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {open ? <div className="space-y-4 border-t border-[var(--border)] p-3.5">{children}</div> : null}
    </Reorder.Item>
  );
}
