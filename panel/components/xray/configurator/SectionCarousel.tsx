"use client";

import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type CarouselItem = {
  id: string;
  label: string;
  summary?: string;
  icon: LucideIcon;
  /** Group heading shown above the first tile of each group. */
  group?: string;
  issue?: "error" | "warning";
  /** Visually separate from the sections (used for the "Entire config" tile). */
  trailing?: boolean;
};

type Props = {
  items: CarouselItem[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  prevLabel: string;
  nextLabel: string;
  /** Extra tile rendered after the sections (e.g. "Add section"). */
  extra?: ReactNode;
};

export function SectionCarousel({ items, activeId, onSelect, disabled, ariaLabel, prevLabel, nextLabel, extra }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeIdx = Math.max(0, items.findIndex((i) => i.id === activeId));

  useEffect(() => {
    const sc = scrollerRef.current;
    const el = sc?.querySelector<HTMLElement>(`[data-slide="${CSS.escape(activeId)}"]`);
    if (!sc || !el) return;
    const left = el.offsetLeft - (sc.clientWidth - el.clientWidth) / 2;
    sc.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [activeId, items.length]);

  const go = (delta: number) => {
    const next = items[activeIdx + delta];
    if (next && !disabled) onSelect(next.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  };

  // Segments: consecutive items sharing the same group label render under one heading.
  const segments: { group?: string; trailing?: boolean; items: CarouselItem[] }[] = [];
  for (const it of items) {
    const last = segments[segments.length - 1];
    if (last && last.group === it.group && last.trailing === it.trailing) last.items.push(it);
    else segments.push({ group: it.group, trailing: it.trailing, items: [it] });
  }

  const firstTrailing = segments.findIndex((sg) => sg.trailing);
  const extraTile = extra ? (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="h-3" />
      {extra}
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={prevLabel}
        disabled={disabled || activeIdx === 0}
        onClick={() => go(-1)}
        className="absolute left-0 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--fg-muted)] shadow-sm transition-colors hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        disabled={disabled || activeIdx === items.length - 1}
        onClick={() => go(1)}
        className="absolute right-0 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--fg-muted)] shadow-sm transition-colors hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight size={16} />
      </button>

      <div
        ref={scrollerRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="relative flex items-end gap-4 overflow-x-auto scroll-smooth px-10 pb-2 pt-1 [scrollbar-width:thin]"
      >
        {segments.map((seg, si) => (
          <Fragment key={si}>
            {seg.trailing && si === firstTrailing && extra ? extraTile : null}
          <div className={`flex shrink-0 flex-col gap-1 ${seg.trailing ? "border-l border-[var(--border)] pl-4" : ""}`}>
            <div className="h-3 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{seg.group ?? ""}</div>
            <div className="flex gap-2">
              {seg.items.map((it) => {
                const active = it.id === activeId;
                const Icon = it.icon;
                return (
                  <button
                    key={it.id}
                    data-slide={it.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    disabled={disabled}
                    onClick={() => onSelect(it.id)}
                    className={`group relative flex w-[8.75rem] shrink-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent)]"
                        : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                    }`}
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                        active ? "bg-[var(--accent)] text-[var(--accent-fg,#0d1117)]" : "bg-[var(--surface-strong)] text-[var(--fg-muted)] group-hover:text-[var(--fg)]"
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-[13px] font-medium ${active ? "text-[var(--accent)]" : "text-[var(--fg)]"}`}>{it.label}</span>
                      <span className="block truncate text-[11px] text-[var(--fg-subtle)]">{it.summary ?? " "}</span>
                    </span>
                    {it.issue ? (
                      <span
                        title={it.issue}
                        className={`absolute -right-1 -top-1 grid size-4 place-items-center rounded-full ${
                          it.issue === "error" ? "bg-rose-500 text-white" : "bg-amber-500 text-black"
                        }`}
                      >
                        <AlertTriangle size={10} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          </Fragment>
        ))}
        {firstTrailing === -1 && extra ? extraTile : null}
      </div>
    </div>
  );
}
