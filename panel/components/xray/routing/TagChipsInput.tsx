"use client";

import { X } from "lucide-react";
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

export type ChipSuggestion = {
  value: string;
  hint?: string;
  /** Selecting puts the text in the input for completion instead of adding a chip. */
  prefix?: boolean;
};

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  suggestions?: ChipSuggestion[];
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  /** Chip is drawn as "unknown" (amber) when this returns true. */
  isUnknown?: (v: string) => boolean;
  ariaLabel?: string;
};

const SEPARATORS = /[\s,;]+/;

export function TagChipsInput({
  values,
  onChange,
  suggestions = [],
  placeholder,
  disabled,
  mono = true,
  isUnknown,
  ariaLabel,
}: Props) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const taken = new Set(values);
    return suggestions
      .filter((s) => (s.prefix ? true : !taken.has(s.value)))
      .filter((s) => !q || s.value.toLowerCase().includes(q) || (s.hint ?? "").toLowerCase().includes(q))
      .slice(0, 40);
  }, [suggestions, draft, values]);

  const commit = (raw: string) => {
    const parts = raw.split(SEPARATORS).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
    setActive(0);
    setNavigated(false);
  };

  const pick = (s: ChipSuggestion) => {
    if (s.prefix) {
      setDraft(s.value);
      inputRef.current?.focus();
      return;
    }
    commit(s.value);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setNavigated(true);
      setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setNavigated(true);
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (navigated && open && filtered[active]) {
        pick(filtered[active]!);
      } else if (draft.trim()) {
        commit(draft);
      }
    } else if (e.key === "," || e.key === ";" || (e.key === " " && draft.trim())) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (SEPARATORS.test(text.trim())) {
      e.preventDefault();
      commit(text);
    }
  };

  return (
    <div className="relative">
      <div
        className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 transition-colors focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] ${disabled ? "opacity-60" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v) => (
          <span
            key={v}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${mono ? "font-mono" : ""} ${
              isUnknown?.(v)
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg)]"
            }`}
          >
            <span className="truncate">{v}</span>
            {!disabled ? (
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="rounded-full p-0.5 text-[var(--fg-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onChange(values.filter((x) => x !== v));
                }}
              >
                <X size={12} />
              </button>
            ) : null}
          </span>
        ))}
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          disabled={disabled}
          value={draft}
          placeholder={values.length ? "" : placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setActive(0);
            setNavigated(false);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (draft.trim()) commit(draft);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={`min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] ${mono ? "font-mono text-xs" : ""}`}
        />
      </div>
      {open && !disabled && filtered.length > 0 ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] p-1 shadow-lg"
        >
          {filtered.map((s, i) => (
            <li key={s.value + (s.prefix ? "*" : "")} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left ${
                  i === active ? "bg-[var(--surface-strong)]" : "hover:bg-[var(--surface)]"
                }`}
              >
                <span className={`truncate text-xs text-[var(--fg)] ${mono ? "font-mono" : ""}`}>{s.value}</span>
                {s.hint ? <span className="shrink-0 text-[11px] text-[var(--fg-subtle)]">{s.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
