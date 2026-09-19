"use client";

import { Plus, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AddSectionOption = { key: string; label: string; icon: LucideIcon };

type Props = {
  label: string;
  options: AddSectionOption[];
  onPick: (key: string) => void;
};

const MENU_W = 232;
const GAP = 6;

/**
 * "Add section" tile with a menu rendered in a portal, so it is never clipped or scrolled by the
 * carousel's overflow container. It opens downward and flips upward when there is no room.
 */
export function AddSectionMenu({ label, options, onPick }: Props) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.right - MENU_W, vw - MENU_W - 8));
    const below = vh - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    if (below >= 220 || below >= above) {
      setPos({ left, top: r.bottom + GAP, maxH: Math.max(140, Math.min(360, below)) });
    } else {
      setPos({ left, bottom: vh - r.top + GAP, maxH: Math.max(140, Math.min(360, above)) });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[3.25rem] w-[8.75rem] items-center gap-2.5 rounded-xl border border-dashed border-[var(--border-strong)] px-2.5 text-left text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-strong)]">
          <Plus size={16} />
        </span>
        <span className="text-[13px] font-medium">{label}</span>
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W, maxHeight: pos.maxH }}
              className="z-[300] overflow-auto rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] p-1 shadow-xl"
            >
              {options.map((o) => {
                const Icon = o.icon;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onPick(o.key);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--fg)] hover:bg-[var(--surface)]"
                  >
                    <Icon size={14} className="text-[var(--fg-muted)]" />
                    {o.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
