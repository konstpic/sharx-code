"use client";

import {
  Boxes, Braces, Check, Clapperboard, Columns2, Compass, Filter, Globe, Grid3x3, Images, Languages, Layers, LayoutGrid, LayoutTemplate, MousePointerClick, Move, PartyPopper, Palette, Pipette,
  Rocket, Save, Search, SlidersHorizontal, Smartphone, Sparkles, Type, Undo2, UserSearch, Variable, Wand2, Zap, ZoomIn, type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { markHelpSeen } from "@/lib/helpSeen";
import type { D } from "../i18n";
import { placeCard, shouldAutoStart, type Rect } from "./tourLogic";
import { MINI_TRACKS, TOUR_TEXT } from "./tourSteps";
import type { TourController } from "./useTour";

const ICONS: Record<string, LucideIcon> = {
  Boxes, Braces, Clapperboard, Columns2, Filter, Globe, Grid3x3, Images, Languages, Layers, LayoutGrid, LayoutTemplate, MousePointerClick, Move, PartyPopper, Palette, Pipette,
  Rocket, Save, Search, SlidersHorizontal, Smartphone, Sparkles, Type, Undo2, UserSearch, Variable, Wand2, Zap, ZoomIn,
};

const tx = (d: D, key: string, vars?: Record<string, unknown>) => d(key, TOUR_TEXT[key] ?? key, vars);
const trackLabelKey = (id: string) => (id === "quick" ? "tour.track.quick" : id === "full" ? "tour.track.full" : `tour.mini.${id}`);

function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of Array.from(all)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const CSS = `
@keyframes sxTourPulse{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--accent) 60%,transparent)}100%{box-shadow:0 0 0 12px transparent}}
.sx-tour-ring{animation:sxTourPulse 1.6s ease-out infinite;transition:left .25s ease,top .25s ease,width .25s ease,height .25s ease}
.sx-tour-card{transition:left .25s ease,top .25s ease}
@media (prefers-reduced-motion: reduce){.sx-tour-ring,.sx-tour-card{animation:none!important;transition:none!important}}
`;

/** Mounted before the section help modal: on the very first visit the tour goes first and the help modal stays quiet. */
export function TourAutoStart({ tour }: { tour: TourController }) {
  const started = useRef(false);
  const open = tour.openChooser;
  useEffect(() => {
    if (started.current || !shouldAutoStart()) return;
    started.current = true;
    markHelpSeen("subpage-designer");
    const tm = window.setTimeout(() => open(true), 900);
    return () => {
      window.clearTimeout(tm);
      started.current = false;
    };
  }, [open]);
  return null;
}

/** Toolbar button with the tour menu. */
export function TourMenu({ tour, d }: { tour: TourController; d: D }) {
  const [open, setOpen] = useState(false);
  const [resume, setResume] = useState<{ track: string; step: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open]);
  const toggle = () => {
    if (!open) setResume(tour.resumeInfo());
    setOpen((o) => !o);
  };
  const run = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  const item = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[var(--surface)]";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-tour="tour-button"
        title={tx(d, "tour.menu.title")}
        aria-label={tx(d, "tour.menu.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
      >
        <Compass size={15} />
        <span className="hidden xl:inline">{tx(d, "tour.menu")}</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-9 z-[450] w-64 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl">
          {resume ? (
            <button type="button" role="menuitem" className={`${item} font-medium text-[var(--accent)]`} onClick={run(() => tour.start(resume.track, resume.step))}>
              {tx(d, "tour.menu.continue")}
            </button>
          ) : null}
          <button type="button" role="menuitem" className={item} onClick={run(() => tour.start("quick"))}>{tx(d, "tour.menu.quick")}</button>
          <button type="button" role="menuitem" className={item} onClick={run(() => tour.start("full"))}>{tx(d, "tour.menu.full")}</button>
          <div className="px-2.5 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{tx(d, "tour.menu.minis")}</div>
          {MINI_TRACKS.map((m) => (
            <button key={m} type="button" role="menuitem" className={item} onClick={run(() => tour.start(m))}>{tx(d, trackLabelKey(m))}</button>
          ))}
          <div className="my-1 h-px bg-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            className={`${item} text-[var(--fg-muted)]`}
            onClick={run(() => {
              tour.reset();
              tour.start("quick");
            })}
          >
            {tx(d, "tour.menu.reset")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const sameRect = (a: Rect | null, b: Rect | null) => (a === b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Spotlight + coach card. Renders nothing while the tour is idle. */
export function TourOverlay({ tour, d }: { tour: TourController; d: D }) {
  const { phase, step, index, total, flash } = tour;
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 16, y: 16 });
  const [dont, setDont] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const stepKey = phase === "run" ? step?.id ?? "" : phase;

  // locate the target and follow it
  useEffect(() => {
    if (phase === "idle") return;
    setRect(null);
    if (phase === "choose" || !step) return;
    let el: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let scrolled = false;
    const measure = () => {
      const found = findTarget(step.target) ?? findTarget(step.fallback);
      if (found !== el) {
        ro?.disconnect();
        el = found;
        if (el && typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(measure);
          ro.observe(el);
        }
        if (el && !scrolled) {
          scrolled = true;
          try {
            el.scrollIntoView({ block: "nearest", inline: "nearest" });
          } catch {
            /* ignore */
          }
        }
      }
      const next = el ? ((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }))(el.getBoundingClientRect()) : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    measure();
    const early = [60, 180, 400, 800].map((ms) => window.setTimeout(measure, ms));
    const iv = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      early.forEach((t) => window.clearTimeout(t));
      window.clearInterval(iv);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro?.disconnect();
    };
  }, [phase, step]);

  // place the card
  useLayoutEffect(() => {
    if (phase === "idle") return;
    const place = () => {
      const c = cardRef.current;
      if (!c) return;
      const p = placeCard(rect, { w: c.offsetWidth, h: c.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
      setPos((prev) => (prev.x === p.x && prev.y === p.y ? prev : p));
    };
    place();
    const c = cardRef.current;
    const ro = c && typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (c) ro?.observe(c);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [phase, rect, stepKey, flash]);

  // focus the card on every step
  useEffect(() => {
    if (phase !== "idle") cardRef.current?.focus({ preventScroll: true });
  }, [phase, stepKey]);

  // keyboard
  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || !!t.closest(".monaco-editor"));
      const inCard = !!t && !!cardRef.current?.contains(t);
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        tour.skip();
        return;
      }
      if (typing || phase !== "run") return;
      const idle = !t || t === document.body || t === cardRef.current;
      if (e.key === "ArrowRight" || (e.key === "Enter" && idle)) {
        if (inCard && t?.tagName === "BUTTON" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        if (index + 1 >= total) tour.finish(dont);
        else tour.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        tour.back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, tour, index, total, dont]);

  if (phase === "idle" || typeof document === "undefined") return null;

  const Ico = ICONS[step?.icon ?? "Sparkles"] ?? Sparkles;
  const last = phase === "run" && index + 1 >= total;
  const btn = "inline-flex h-8 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--surface)]";
  const primary = "inline-flex h-8 items-center justify-center rounded-lg bg-[var(--accent)] px-3.5 text-xs font-medium text-white hover:opacity-90";
  const P = 6;

  const card =
    phase === "choose" ? (
      <>
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]"><Sparkles size={18} /></span>
          <h2 className="text-[15px] font-semibold leading-tight">{tx(d, "tour.choose.t")}</h2>
        </div>
        <p className="mt-2.5 text-[13px] leading-snug text-[var(--fg-muted)]" aria-live="polite">{tx(d, "tour.choose.b")}</p>
        <div className="mt-3 grid gap-2">
          <button type="button" className={`${primary} !h-auto flex-col items-start gap-0.5 !px-3 !py-2 text-left`} onClick={() => tour.start("quick")}>
            <span>{tx(d, "tour.choose.quick")}</span>
            <span className="text-[11px] font-normal opacity-80">{tx(d, "tour.choose.quickHint")}</span>
          </button>
          <button type="button" className={`${btn} !h-auto flex-col items-start gap-0.5 !px-3 !py-2 text-left`} onClick={() => tour.start("full")}>
            <span>{tx(d, "tour.choose.full")}</span>
            <span className="text-[11px] font-normal text-[var(--fg-muted)]">{tx(d, "tour.choose.fullHint")}</span>
          </button>
        </div>
        <div className="mt-3 text-right">
          <button type="button" className="text-xs text-[var(--fg-muted)] underline-offset-2 hover:underline" onClick={tour.skip}>{tx(d, "tour.choose.later")}</button>
        </div>
      </>
    ) : step ? (
      <>
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]"><Ico size={18} /></span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{tx(d, "tour.stepOf", { n: index + 1, total })}</div>
            <h2 className="text-[15px] font-semibold leading-tight">{tx(d, `tour.s.${step.id}.t`)}</h2>
          </div>
        </div>
        <div aria-live="polite">
          <p className="mt-2.5 text-[13px] leading-snug text-[var(--fg-muted)]">{tx(d, `tour.s.${step.id}.b`)}</p>
          {step.task ? (
            flash ? (
              <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-400"><Check size={14} />{tx(d, "tour.nice")}</div>
            ) : (
              <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg)]">
                <MousePointerClick size={14} className="text-[var(--accent)]" />
                <span><span className="text-[var(--accent)]">{tx(d, "tour.try")}:</span> {tx(d, `tour.s.${step.id}.h`)}</span>
              </div>
            )
          ) : null}
        </div>
        {step.next ? (
          <div className="mt-3">
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{tx(d, "tour.next.title")}</div>
            <div className="grid gap-1">
              {(tour.trackId === "quick" ? (["full", ...MINI_TRACKS] as string[]) : (MINI_TRACKS.filter((m) => m !== tour.trackId) as string[])).map((m) => (
                <button key={m} type="button" className={`${btn} justify-start`} onClick={() => tour.start(m)}>{tx(d, trackLabelKey(m))}</button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-[3px]" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < index ? "bg-[var(--accent)]" : i === index ? "bg-[var(--accent)] opacity-70" : "bg-[var(--border)]"}`} />
          ))}
        </div>
        {last ? (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-muted)]">
            <input type="checkbox" checked={dont} onChange={(e) => setDont(e.target.checked)} />
            {tx(d, "tour.dontShow")}
          </label>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="mr-auto text-xs text-[var(--fg-muted)] underline-offset-2 hover:underline" onClick={tour.skip}>{tx(d, "tour.skip")}</button>
          {index > 0 ? <button type="button" className={btn} onClick={tour.back}>{tx(d, "tour.back")}</button> : null}
          {last ? (
            <button type="button" className={primary} onClick={() => tour.finish(dont)}>{tx(d, "tour.finish")}</button>
          ) : step.task && !flash ? (
            <button type="button" className={btn} onClick={tour.next}>{tx(d, "tour.skipStep")}</button>
          ) : (
            <button type="button" className={primary} onClick={tour.next}>{tx(d, "tour.next")}</button>
          )}
        </div>
      </>
    ) : null;

  return createPortal(
    <div className="fixed inset-0 z-[500]" style={{ pointerEvents: phase === "choose" ? "auto" : "none" }} data-tour-root>
      <style>{CSS}</style>
      {rect && phase === "run" ? (
        <>
          <div className="sx-tour-ring fixed rounded-xl" style={{ left: rect.x - P, top: rect.y - P, width: rect.w + P * 2, height: rect.h + P * 2, boxShadow: "0 0 0 9999px rgba(2,6,23,.6)", border: "2px solid var(--accent)", pointerEvents: "none" }} aria-hidden />
        </>
      ) : (
        <div className="fixed inset-0" style={{ background: "rgba(2,6,23,.55)", pointerEvents: "none" }} aria-hidden />
      )}
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-label={tx(d, "tour.aria")}
        className="sx-tour-card fixed w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-[var(--fg)] shadow-2xl outline-none"
        style={{ left: pos.x, top: pos.y, pointerEvents: "auto" }}
      >
        {card}
      </div>
    </div>,
    document.body,
  );
}
