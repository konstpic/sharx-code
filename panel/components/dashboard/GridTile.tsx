"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Copy, GripVertical, Maximize2, MoreHorizontal, Pencil, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import { Button, Drawer, Input, Modal, SelectNative } from "@/components/ui";
import { defaultTile, type TileSettings } from "@/lib/dashboardBuilder";
import { DASHBOARD_WIDGET_I18N, type DashboardWidgetId } from "@/lib/dashboardLayout";
import { GRID_GAP, GRID_ROW_HEIGHT, type ResizeHandle } from "@/lib/dashboardGrid";
import { useGrid } from "./gridContext";

/* ---------------------------------------------------------------- resize handles */

type HandleDef = { h: ResizeHandle; box: CSSProperties; dot: CSSProperties; cursor: string; visible?: boolean };

const EDGE = 8;
const CORNER = 16;
const HANDLES: HandleDef[] = [
  { h: "e", cursor: "ew-resize", visible: true, box: { right: 0, top: CORNER, bottom: CORNER, width: EDGE }, dot: { right: 1, top: "50%", width: 4, height: 32, transform: "translateY(-50%)" } },
  { h: "s", cursor: "ns-resize", visible: true, box: { bottom: 0, left: CORNER, right: CORNER, height: EDGE }, dot: { bottom: 1, left: "50%", height: 4, width: 32, transform: "translateX(-50%)" } },
  { h: "se", cursor: "nwse-resize", visible: true, box: { right: 0, bottom: 0, width: CORNER, height: CORNER }, dot: { right: 3, bottom: 3, width: 8, height: 8, borderRadius: 3 } },
  { h: "w", cursor: "ew-resize", box: { left: 0, top: CORNER, bottom: CORNER, width: EDGE }, dot: { left: 1, top: "50%", width: 4, height: 32, transform: "translateY(-50%)" } },
  { h: "n", cursor: "ns-resize", box: { top: 0, left: CORNER, right: CORNER, height: EDGE }, dot: { top: 1, left: "50%", height: 4, width: 32, transform: "translateX(-50%)" } },
  { h: "ne", cursor: "nesw-resize", box: { right: 0, top: 0, width: CORNER, height: CORNER }, dot: { right: 3, top: 3, width: 8, height: 8, borderRadius: 3 } },
  { h: "nw", cursor: "nwse-resize", box: { left: 0, top: 0, width: CORNER, height: CORNER }, dot: { left: 3, top: 3, width: 8, height: 8, borderRadius: 3 } },
  { h: "sw", cursor: "nesw-resize", box: { left: 0, bottom: 0, width: CORNER, height: CORNER }, dot: { left: 3, bottom: 3, width: 8, height: 8, borderRadius: 3 } },
];

/* ---------------------------------------------------------------- tile menu */

type MenuItem = { key: string; icon: LucideIcon; label: string; run: () => void; danger?: boolean };

function TileMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback((refocus = true) => {
    setPos(null);
    if (refocus) btnRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!pos || !popRef.current) return;
    popRef.current.querySelector<HTMLButtonElement>("button")?.focus();
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: globalThis.PointerEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || btnRef.current?.contains(n)) return;
      setPos(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const away = () => setPos(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [pos, close]);

  const toggle = () => {
    if (pos) return close();
    const r = btnRef.current!.getBoundingClientRect();
    const width = 224;
    const height = items.length * 36 + 8;
    const top = r.bottom + 4 + height > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4;
    setPos({ left: Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8), top });
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const btns = [...(popRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length;
    btns[next]?.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pos != null}
        aria-label={label}
        title={label}
        onClick={toggle}
        className="inline-grid size-7 shrink-0 place-items-center rounded-lg text-[var(--fg-muted)] transition hover:bg-[color-mix(in_oklab,var(--fg)_9%,transparent)] hover:text-[var(--fg)]"
      >
        <MoreHorizontal size={16} />
      </button>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              role="menu"
              onKeyDown={onMenuKey}
              className="fixed z-[10000] w-56 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 shadow-2xl"
              style={{ left: pos.left, top: pos.top }}
            >
              {items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(false);
                    it.run();
                  }}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition hover:bg-[color-mix(in_oklab,var(--fg)_9%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--fg)_9%,transparent)] focus-visible:outline-none ${it.danger ? "text-[var(--danger,#ef4444)]" : "text-[var(--fg)]"}`}
                >
                  <it.icon size={14} className="shrink-0" />
                  <span className="min-w-0 truncate">{it.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ---------------------------------------------------------------- tile */

export function DashboardTile({
  id,
  children,
  views = {},
  label,
  onEdit,
}: {
  id: string;
  children: ReactNode;
  views?: Record<string, ReactNode>;
  label?: string;
  onEdit?: () => void;
}) {
  const ctx = useGrid();
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [properties, setProperties] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [draft, setDraft] = useState<TileSettings | null>(null);
  const config = ctx.layout.tiles[id] ?? defaultTile(id);
  const title = config.title || label || (DASHBOARD_WIDGET_I18N[id as DashboardWidgetId] ? t(DASHBOARD_WIDGET_I18N[id as DashboardWidgetId]) : id);
  const item = ctx.items.get(id);
  const content = views[config.view] ?? children;

  const change = (patch: Partial<TileSettings>) =>
    ctx.setLayout((l) => ({ ...l, tiles: { ...l.tiles, [id]: { ...(l.tiles[id] ?? defaultTile(id)), ...patch } } }));

  const open = () => {
    if (onEdit) return onEdit();
    setDraft({ ...config });
    setProperties(true);
  };

  /** Measure the content at its natural height and size the tile to it (rounded up to whole rows). */
  const fitHeight = () => {
    const body = bodyRef.current;
    const section = ref.current;
    if (!body || !section) return;
    const chrome = section.getBoundingClientRect().height - body.getBoundingClientRect().height;
    const prev = { flex: body.style.flex, height: body.style.height, overflowY: body.style.overflowY };
    body.style.flex = "none";
    body.style.height = "auto";
    body.style.overflowY = "visible";
    const natural = body.scrollHeight;
    body.style.flex = prev.flex;
    body.style.height = prev.height;
    body.style.overflowY = prev.overflowY;
    ctx.setSize(id, { h: Math.ceil((chrome + natural + GRID_GAP) / (GRID_ROW_HEIGHT + GRID_GAP)) });
  };

  if (!item) return null;
  const { geo } = ctx;
  const stepX = geo.colW + geo.gap;
  const stepY = geo.rowH + geo.gap;
  const active = ctx.active?.id === id;
  const dragging = active && ctx.active?.kind === "drag";
  const resizing = active && ctx.active?.kind === "resize";
  const left = dragging ? ctx.active!.left : item.x * stepX;
  const top = dragging ? ctx.active!.top : item.y * stepY;
  const width = item.w * geo.colW + (item.w - 1) * geo.gap;
  const height = item.h * geo.rowH + (item.h - 1) * geo.gap;

  const menu: MenuItem[] = [
    { key: "edit", icon: Pencil, label: t("pages.builder.editPanel"), run: open },
    ...(ctx.canDuplicate(id) ? [{ key: "dup", icon: Copy, label: t("pages.builder.duplicate"), run: () => ctx.duplicate(id) }] : []),
    { key: "full", icon: Maximize2, label: t("pages.builder.fullscreen"), run: () => setFullscreen(true) },
    { key: "fit", icon: ArrowUpDown, label: t("pages.builder.fitHeight"), run: fitHeight },
    { key: "reset", icon: RotateCcw, label: t("pages.builder.resetSize"), run: () => ctx.resetSize(id) },
    { key: "remove", icon: Trash2, label: t("pages.builder.remove"), run: () => ctx.hide(id), danger: true },
  ];

  const showHeader = Boolean(label || config.title) && !ctx.editing;

  return (
    <section
      ref={ref}
      data-dashboard-tile={id}
      data-grid="true"
      data-editing={ctx.editing ? "true" : "false"}
      data-active={active ? "true" : "false"}
      data-resizing={resizing ? "true" : "false"}
      tabIndex={ctx.editing ? 0 : undefined}
      aria-label={title}
      aria-keyshortcuts={ctx.editing ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight" : undefined}
      aria-roledescription={ctx.editing ? t("pages.builder.movableTile") : undefined}
      onKeyDown={(e) => {
        ctx.onKeyboard(id, title, e);
      }}
      className={`dashboard-tile group/tile flex min-w-0 flex-col overflow-hidden rounded-2xl border ${ctx.editing ? "border-[color-mix(in_oklab,var(--accent)_55%,var(--border))]" : "border-[var(--border)]"}`}
      style={{ width, height, transform: `translate3d(${left}px, ${top}px, 0)`, zIndex: dragging ? 40 : resizing ? 30 : undefined }}
    >
      {ctx.editing ? (
        <div className="dashboard-tile-bar flex h-9 shrink-0 items-center gap-1 border-b border-[color-mix(in_oklab,var(--accent)_25%,var(--border))] bg-[color-mix(in_oklab,var(--bg-elevated)_80%,transparent)] pl-1 pr-1">
          <div
            className="flex h-full min-w-0 flex-1 cursor-grab touch-none select-none items-center gap-1 active:cursor-grabbing"
            onPointerDown={(e) => ctx.startDrag(id, e)}
            title={t("pages.builder.move")}
          >
            <span className="grid size-6 shrink-0 place-items-center text-[var(--fg-subtle)]" aria-hidden>
              <GripVertical size={15} />
            </span>
            <span className="gt-bar-title min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--fg)]">{title}</span>
            <span className="gt-bar-size shrink-0 rounded-md bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--accent)]">
              {item.w}×{item.h}
            </span>
          </div>
          <TileMenu label={t("pages.builder.tileMenu")} items={menu} />
        </div>
      ) : showHeader ? (
        <div className="flex min-h-10 shrink-0 items-center gap-2 px-4 pt-3">
          <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-[var(--fg)]">{title}</h2>
        </div>
      ) : null}
      <div ref={bodyRef} className="dashboard-tile-body min-h-0 flex-1 [&>div]:!mt-0 [&>div]:min-h-full">
        {content}
      </div>
      {!ctx.editing ? (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label={t("pages.builder.fullscreen")}
          title={t("pages.builder.fullscreen")}
          className="absolute right-2 top-2 z-20 inline-grid size-7 place-items-center rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_88%,transparent)] text-[var(--fg-muted)] opacity-0 backdrop-blur transition hover:text-[var(--fg)] focus-visible:opacity-100 group-hover/tile:opacity-100"
        >
          <Maximize2 size={13} />
        </button>
      ) : (
        HANDLES.map((d) => (
          <div
            key={d.h}
            aria-hidden
            className="dashboard-resize-handle"
            data-visible={d.visible ? "true" : "false"}
            style={{ ...d.box, cursor: d.cursor }}
            onPointerDown={(e) => ctx.startResize(id, d.h, e)}
          >
            <i style={d.dot} />
          </div>
        ))
      )}

      <Modal open={fullscreen} onClose={() => setFullscreen(false)} title={title} width={1180}>
        <div className="dashboard-tile-body h-[min(72vh,760px)] rounded-xl [&>div]:!mt-0 [&>div]:min-h-full">{content}</div>
      </Modal>

      <Drawer
        lockBodyScroll={properties}
        open={properties}
        onClose={() => setProperties(false)}
        title={t("pages.builder.editPanel")}
        width={440}
        footer={
          <Button
            onClick={() => {
              if (draft) change({ title: draft.title, view: draft.view });
              setProperties(false);
            }}
          >
            {t("pages.trafficHistory.apply")}
          </Button>
        }
      >
        {draft ? (
          <div className="space-y-5">
            <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.title")}
              <Input value={draft.title} placeholder={title} maxLength={100} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.view")}
              <SelectNative value={views[draft.view] ? draft.view : "default"} onChange={(e) => setDraft({ ...draft, view: e.target.value })}>
                <option value="default">{t("pages.builder.default")}</option>
                {Object.keys(views).map((v) => (
                  <option key={v} value={v}>
                    {t(`pages.builder.${v}`)}
                  </option>
                ))}
              </SelectNative>
            </label>
            <div className="h-64 overflow-auto rounded-xl border border-[var(--border)]">{views[draft.view] ?? children}</div>
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}
