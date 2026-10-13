"use client";
import React, {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { MoveDown, MoveUp, Scaling, X, Pencil } from "lucide-react";
import {
  Input,
  SelectNative,
  IconButton,
  Drawer,
  Button,
} from "@/components/ui";
import { DragHandle } from "@/components/ui/drag-handle";
import { useReorderDnd, type ReorderDnd } from "@/lib/useReorderDnd";
import {
  defaultTile,
  type DashboardLayout,
  type TileSettings,
} from "@/lib/dashboardBuilder";
import {
  DASHBOARD_WIDGET_ORDER,
  DASHBOARD_WIDGET_I18N,
  type DashboardWidgetId,
} from "@/lib/dashboardLayout";
const BuilderContext = createContext<{
  layout: DashboardLayout;
  setLayout: Dispatch<SetStateAction<DashboardLayout>>;
  editing: boolean;
  dnd: ReorderDnd;
  keys: string[];
  hide: (id: string) => void;
} | null>(null);
export function DashboardBuilder({
  layout,
  setLayout,
  editing,
  hide,
  children,
}: {
  layout: DashboardLayout;
  setLayout: Dispatch<SetStateAction<DashboardLayout>>;
  editing: boolean;
  hide: (id: string) => void;
  children: ReactNode;
}) {
  const keys = [...DASHBOARD_WIDGET_ORDER, ...layout.panels.map((p) => p.id)];
  const dnd = useReorderDnd({
    ids: layout.order.map((id) => keys.indexOf(id) + 1),
    enabled: editing,
    orientation: "horizontal",
    onReorder: (ids) =>
      setLayout((l) => ({
        ...l,
        order: ids.map((n) => keys[n - 1]).filter(Boolean),
      })),
  });
  return (
    <BuilderContext.Provider
      value={{ layout, setLayout, editing, dnd, hide, keys }}
    >
      <div
        className="dashboard-builder grid gap-4"
        style={{
          gridTemplateColumns: "repeat(12,minmax(0,1fr))",
          gridAutoRows: "minmax(40px, auto)",
          gridAutoFlow: "row dense",
        }}
      >
        {children}
      </div>
      <style>{`@media(max-width:767px){.dashboard-builder{display:flex!important;flex-direction:column}.dashboard-tile{width:100%;min-height:180px}.dashboard-resize{display:none!important}}`}</style>
    </BuilderContext.Provider>
  );
}
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
  const ctx = useContext(BuilderContext)!;
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [properties, setProperties] = useState(false);
  const [draft, setDraft] = useState<TileSettings | null>(null);
  const customized = Boolean(ctx.layout.tiles[id]);
  const config = ctx.layout.tiles[id] ?? defaultTile(id);
  const numericId = ctx.keys.indexOf(id) + 1;
  const title =
    config.title ||
    label ||
    (DASHBOARD_WIDGET_I18N[id as DashboardWidgetId]
      ? t(DASHBOARD_WIDGET_I18N[id as DashboardWidgetId])
      : id);
  const change = (patch: Partial<TileSettings>) =>
    ctx.setLayout((l) => ({
      ...l,
      tiles: {
        ...l.tiles,
        [id]: { ...(l.tiles[id] ?? defaultTile(id)), ...patch },
      },
    }));
  const order = ctx.layout.order.indexOf(id);
  const move = (offset: number) =>
    ctx.setLayout((l) => {
      const ids = [...l.order];
      const from = ids.indexOf(id),
        to = from + offset;
      if (to < 0 || to >= ids.length) return l;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return { ...l, order: ids };
    });
  const open = () => {
    if (onEdit) {
      onEdit();
      return;
    }
    setDraft({ ...config });
    setProperties(true);
  };
  return (
    <section
      ref={ref}
      {...ctx.dnd.itemProps(numericId)}
      data-dashboard-tile={id}
      data-editing={ctx.editing ? "true" : "false"}
      className={`dashboard-tile group/tile relative flex min-w-0 flex-col overflow-hidden rounded-2xl border ${ctx.editing ? "border-[color-mix(in_oklab,var(--accent)_55%,var(--border))]" : "border-[var(--border)]"}`}
      style={{
        order,
        gridColumn: `span ${config.width}`,
        // A tile nobody resized fits its content; only a stored (resized/edited) height pins the row span.
        gridRow: customized ? `span ${config.height}` : "auto",
      }}
      aria-label={title}
    >
      {(label || config.title) && !(ctx.editing && config.width < 5) ? (
        <div className="flex min-h-10 items-center gap-2 px-4 pt-3">
          <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-[var(--fg)]">
            {title}
          </h2>
        </div>
      ) : null}
      {ctx.editing ? (
        <div className="absolute right-2 top-2 z-30 flex items-center gap-0.5 rounded-xl border border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] px-1 py-0.5 shadow-lg backdrop-blur-md">
          <DragHandle
            enabled
            label={t("pages.builder.move")}
            {...ctx.dnd.handleProps(numericId)}
          />
          {config.width >= 5 ? (
            <span className="max-w-[9rem] truncate px-1 text-[11px] font-medium text-[var(--fg)]">
              {title}
            </span>
          ) : null}
          <span className="mx-1 rounded-md bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--accent)]">
            {config.width}×{config.height}
          </span>
          <IconButton label={t("pages.builder.editPanel")} onClick={open}>
            <Pencil size={14} />
          </IconButton>
          <IconButton label={t("pages.builder.up")} onClick={() => move(-1)}>
            <MoveUp size={13} />
          </IconButton>
          <IconButton label={t("pages.builder.down")} onClick={() => move(1)}>
            <MoveDown size={13} />
          </IconButton>
          <IconButton label={t("pages.builder.hide")} onClick={() => ctx.hide(id)}>
            <X size={14} />
          </IconButton>
        </div>
      ) : null}
      <div className={`min-h-0 flex-1 overflow-auto [&>div]:!mt-0 [&>div]:min-h-full ${ctx.editing ? "pt-9" : ""}`}>
        {views[config.view] ?? children}
      </div>
      {ctx.editing ? (
        <button
          type="button"
          className="dashboard-resize absolute bottom-1.5 right-1.5 z-30 grid size-7 touch-none cursor-nwse-resize place-items-center rounded-lg border border-[color-mix(in_oklab,var(--accent)_40%,var(--border))] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] text-[var(--accent)] shadow-md backdrop-blur-md transition hover:scale-110"
          aria-label={t("pages.builder.resize")}
          onPointerDown={(e) => {
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const startX = e.clientX,
              startY = e.clientY;
            const parentWidth =
              ref.current?.parentElement?.getBoundingClientRect().width ?? 1200;
            const start = { ...config };
            if (!customized) {
              const h = ref.current?.getBoundingClientRect().height ?? 0;
              if (h > 0) start.height = Math.max(3, Math.min(24, Math.round((h + 16) / 56)));
            }
            const onMove = (ev: PointerEvent) =>
              change({
                width: Math.max(
                  3,
                  Math.min(
                    12,
                    start.width +
                      Math.round((ev.clientX - startX) / (parentWidth / 12)),
                  ),
                ),
                height: Math.max(
                  3,
                  Math.min(
                    24,
                    start.height + Math.round((ev.clientY - startY) / 56),
                  ),
                ),
              });
            const stop = () => {
              el.removeEventListener("pointermove", onMove);
              el.removeEventListener("pointerup", stop);
              el.removeEventListener("pointercancel", stop);
            };
            el.addEventListener("pointermove", onMove);
            el.addEventListener("pointerup", stop);
            el.addEventListener("pointercancel", stop);
          }}
        >
          <Scaling size={15} />
        </button>
      ) : null}
      <Drawer
        lockBodyScroll={properties}
        open={properties}
        onClose={() => setProperties(false)}
        title={t("pages.builder.editPanel")}
        width={440}
        footer={
          <Button
            onClick={() => {
              if (draft) change(draft);
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
              <Input
                value={draft.title}
                placeholder={title}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.view")}
              <SelectNative
                value={views[draft.view] ? draft.view : "default"}
                onChange={(e) => setDraft({ ...draft, view: e.target.value })}
              >
                <option value="default">{t("pages.builder.default")}</option>
                {Object.keys(views).map((v) => (
                  <option key={v} value={v}>
                    {t(`pages.builder.${v}`)}
                  </option>
                ))}
              </SelectNative>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-xs text-[var(--fg-muted)]">
                {t("pages.builder.width")}
                <SelectNative
                  value={draft.width}
                  onChange={(e) =>
                    setDraft({ ...draft, width: Number(e.target.value) })
                  }
                >
                  {Array.from({ length: 10 }, (_, i) => i + 3).map((n) => (
                    <option key={n} value={n}>
                      {n}/12
                    </option>
                  ))}
                </SelectNative>
              </label>
              <label className="space-y-2 text-xs text-[var(--fg-muted)]">
                {t("pages.builder.height")}
                <SelectNative
                  value={draft.height}
                  onChange={(e) =>
                    setDraft({ ...draft, height: Number(e.target.value) })
                  }
                >
                  {Array.from({ length: 22 }, (_, i) => i + 3).map((n) => (
                    <option key={n} value={n}>
                      {n * 40 + (n - 1) * 16}px
                    </option>
                  ))}
                </SelectNative>
              </label>
            </div>
            <div className="h-64 overflow-auto rounded-xl border border-[var(--border)]">
              {views[draft.view] ?? children}
            </div>
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}
