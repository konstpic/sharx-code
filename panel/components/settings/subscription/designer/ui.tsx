"use client";

import { ChevronDown } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

// ------------------------------------------------------------------------------------
// Variable insertion: the last focused template field registers itself, the variables panel inserts into it.
// ------------------------------------------------------------------------------------

export type InsertFn = (text: string) => void;
export type InsertRegistry = { current: InsertFn | null };
export const InsertContext = createContext<InsertRegistry>({ current: null });

/** Text field that takes {{variables}}: remembers its caret so a variable can be inserted where it was. */
export function TplField({
  value,
  onChange,
  multiline,
  rows = 3,
  placeholder,
  mono,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const reg = useContext(InsertContext);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const onFocus = useCallback(() => {
    reg.current = (text: string) => {
      const el = ref.current;
      const cur = valueRef.current;
      const s = el?.selectionStart ?? cur.length;
      const e = el?.selectionEnd ?? cur.length;
      const next = cur.slice(0, s) + text + cur.slice(e);
      onChange(next);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const pos = s + text.length;
        el.setSelectionRange(pos, pos);
      });
    };
  }, [reg, onChange]);

  const cls = `w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-[12.5px] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-subtle)] focus:border-[var(--accent)] ${mono ? "font-mono text-[12px]" : ""} ${className}`;
  if (multiline) {
    return (
      <textarea
        ref={ref as unknown as React.RefObject<HTMLTextAreaElement>}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={onFocus}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        className={`${cls} resize-y py-1.5`}
        spellCheck={false}
      />
    );
  }
  return (
    <input
      ref={ref as unknown as React.RefObject<HTMLInputElement>}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      className={`${cls} h-8`}
      spellCheck={false}
    />
  );
}

// ------------------------------------------------------------------------------------
// Layout primitives
// ------------------------------------------------------------------------------------

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)] hover:text-[var(--fg)]" aria-expanded={open}>
          <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
          {title}
        </button>
        {right}
      </div>
      {open ? <div className="space-y-2 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2" title={hint}>
      <span className="truncate text-[11.5px] text-[var(--fg-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------
// Controls
// ------------------------------------------------------------------------------------

export function Seg<T extends string>({
  items,
  value,
  onChange,
  className = "",
}: {
  items: { id: T; label?: ReactNode; title?: string; icon?: ReactNode }[];
  value: T | undefined;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={`inline-flex h-8 w-full items-stretch gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5 ${className}`}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={it.title}
            onClick={() => onChange(it.id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium transition-colors ${on ? "bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] text-[var(--fg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A number field. `undefined` shows the placeholder. Drag on the little grip at the left to scrub the value, like in a
 * design tool; arrow keys step (Shift = 10).
 */
export function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  unit,
  className = "",
  ariaLabel,
  disabled,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  unit?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const clamp = useCallback((n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)), [min, max]);
  const drag = useRef<{ x: number; v: number } | null>(null);

  const onGripDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value ?? 0 };
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const mult = e.shiftKey ? 10 : 1;
    onChange(clamp(Math.round((drag.current.v + dx * step * mult) / step) * step));
  };
  const onGripUp = () => {
    drag.current = null;
  };

  return (
    <div className={`flex h-8 items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] focus-within:border-[var(--accent)] ${className}`}>
      <span
        className="grid h-full w-4 shrink-0 cursor-ew-resize place-items-center text-[var(--fg-subtle)] hover:text-[var(--fg)]"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        title="Drag to change"
        aria-hidden
      >
        <span className="text-[9px] leading-none">⋮⋮</span>
      </span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={value === undefined ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") return onChange(undefined);
          const n = Number(raw.replace(",", "."));
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp((value ?? 0) + d));
          }
        }}
        className="h-full w-full min-w-0 bg-transparent px-1 text-[12.5px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
      />
      {unit ? <span className="pr-2 text-[10.5px] text-[var(--fg-subtle)]">{unit}</span> : null}
    </div>
  );
}

export const COLOR_TOKENS: { id: string; label: string; value: string }[] = [
  { id: "accent", label: "Accent", value: "var(--sub-accent)" },
  { id: "accent-soft", label: "Accent soft", value: "var(--sub-accent-soft)" },
  { id: "ambient", label: "Ambient", value: "var(--sub-accent-ambient)" },
  { id: "fg", label: "Text", value: "var(--sub-fg)" },
  { id: "fg-strong", label: "Text strong", value: "var(--sub-fg-strong)" },
  { id: "fg-muted", label: "Text muted", value: "var(--sub-fg-muted)" },
  { id: "bg", label: "Background", value: "var(--sub-bg)" },
  { id: "bg-elevated", label: "Elevated", value: "var(--sub-bg-elevated)" },
  { id: "surface", label: "Surface", value: "var(--sub-surface)" },
  { id: "surface-strong", label: "Surface strong", value: "var(--sub-surface-strong)" },
  { id: "border", label: "Border", value: "var(--sub-border)" },
  { id: "success", label: "Success", value: "var(--sub-success)" },
  { id: "danger", label: "Danger", value: "var(--sub-danger)" },
];

function hexOf(v: string | undefined): string {
  if (v && /^#[0-9a-f]{6}$/i.test(v)) return v;
  return "#22d3ee";
}

/** A color: hex / rgba / gradient text, a native picker for hex, and the page's theme tokens. */
export function ColorInput({ value, onChange, placeholder = "none", allowGradient }: { value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string; allowGradient?: boolean }) {
  const [tokens, setTokens] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tokens) return;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setTokens(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [tokens]);
  return (
    <div ref={boxRef} className="relative">
      <div className="flex h-8 items-center gap-1.5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] pl-1 focus-within:border-[var(--accent)]">
        <label className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[var(--border)]" style={{ background: value || "transparent" }} title="Pick a color">
          <input type="color" value={hexOf(value)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Color" />
        </label>
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.trim() === "" ? undefined : e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
          aria-label="Color value"
          title={allowGradient ? "Color or CSS gradient" : "Color"}
        />
        <button type="button" onClick={() => setTokens((o) => !o)} className="h-full px-1.5 text-[10.5px] font-medium text-[var(--fg-muted)] hover:text-[var(--fg)]" title="Theme colors">
          ◐
        </button>
      </div>
      {tokens ? (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-xl">
          {COLOR_TOKENS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onChange(t.value);
                setTokens(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] text-[var(--fg)] hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]"
            >
              <span className="size-4 rounded border border-[var(--border)] bg-[#161b23]" style={{ background: `${t.value}, #161b23` }} />
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Pick<T extends string>({ value, onChange, options, className = "" }: { value: T | undefined; onChange: (v: T) => void; options: { id: T; label: string }[]; className?: string }) {
  return (
    <select
      value={value ?? options[0]?.id}
      onChange={(e) => onChange(e.target.value as T)}
      className={`h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)] ${className}`}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--fg)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

export function SmallBtn({ children, onClick, title, active, disabled, className = "" }: { children: ReactNode; onClick?: () => void; title?: string; active?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "border-[color-mix(in_oklab,var(--accent)_50%,transparent)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--fg)]" : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A slider with a number field next to it (the number scrubs and accepts typing). */
export function Slide({ value, onChange, min, max, step = 1, unit, placeholder, ariaLabel }: { value: number | undefined; onChange: (v: number | undefined) => void; min: number; max: number; step?: number; unit?: string; placeholder?: string; ariaLabel?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value ?? min))} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full accent-[var(--accent)]" aria-label={ariaLabel} />
      <Num value={value} min={min} step={step} unit={unit} placeholder={placeholder} onChange={onChange} ariaLabel={ariaLabel} />
    </div>
  );
}
