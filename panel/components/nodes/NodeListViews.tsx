"use client";

import { Activity, Power, RefreshCw, Trash2 } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  NodeStatusBadge,
  TelemtStateBadge,
  AmneziaWgStateBadge,
  XrayStateBadge,
} from "@/components/nodes/nodeBadges";
import { NodeLoadBlock } from "@/components/nodes/NodeLoadBlock";
import { Button, Switch } from "@/components/ui";
import type { NodeLoad } from "@/lib/nodeLoad";

import type { ListViewMode } from "@/lib/listViewModeStorage";

/** @deprecated use ListViewMode from listViewModeStorage */
export type NodeViewMode = ListViewMode;

export type NodeListRow = {
  id: number;
  name: string;
  address: string;
  authMode?: string;
  status: string;
  responseTime?: number;
  useTls?: boolean;
  xrayVersion?: string;
  telemtVersion?: string;
  workerVersion?: string;
  xrayState?: string;
  telemtState?: string;
  amneziawgState?: string;
  enable?: boolean;
  inbounds?: { id?: number; remark?: string }[];
};

export type NodeListViewContext = {
  t: TFunction;
  authModeLabel: (m?: string) => string;
  onlineUsersByNode: Record<number, number>;
  /** Recent CPU/RAM/disk history per node id (tiles view). */
  loadByNode?: Record<number, NodeLoad>;
  onOpenEdit: (r: NodeListRow) => void;
  onPatchEnable: (r: NodeListRow, next: boolean) => void;
  togglingEnableId: number | null;
  onStopXray: (r: NodeListRow) => void;
  onRestartXray: (r: NodeListRow) => void;
  xrayStoppingId: number | null;
  xrayRestartingId: number | null;
  onStopTelemt: (r: NodeListRow) => void;
  onRestartTelemt: (r: NodeListRow) => void;
  telemtStoppingId: number | null;
  telemtRestartingId: number | null;
  onStopAmneziaWg: (r: NodeListRow) => void;
  onRestartAmneziaWg: (r: NodeListRow) => void;
  amneziawgStoppingId: number | null;
  amneziawgRestartingId: number | null;
  onMetrics: (r: NodeListRow) => void;
  onDelete: (r: NodeListRow) => void;
};

function inboundsLabel(r: NodeListRow): string {
  if (!r.inbounds?.length) return "—";
  return r.inbounds
    .map((ib) => ib.remark || (ib.id != null ? `#${ib.id}` : "—"))
    .join(", ");
}

function responseTimeLabel(r: NodeListRow): string {
  return r.responseTime != null && r.responseTime > 0 ? `${r.responseTime} ms` : "—";
}

function MetaItem({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs text-[var(--fg-muted)]">{children}</dd>
    </div>
  );
}

function NodeOperateButtons({
  r,
  ctx,
  compact = false,
}: {
  r: NodeListRow;
  ctx: NodeListViewContext;
  compact?: boolean;
}) {
  const { t, onMetrics, onDelete } = ctx;
  return (
    <div
      className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        className="!p-1.5 text-[var(--fg-muted)] hover:text-[var(--accent)]"
        title={t("pages.nodes.viewMetrics", { defaultValue: "CPU / RAM / Disk" })}
        aria-label={t("pages.nodes.viewMetrics", { defaultValue: "CPU / RAM / Disk" })}
        onClick={() => onMetrics(r)}
      >
        <Activity size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="!p-1.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
        onClick={() => onDelete(r)}
        title={t("pages.nodes.deleteNode")}
        aria-label={t("pages.nodes.deleteNode")}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}

function NodeXrayControls({ r, ctx }: { r: NodeListRow; ctx: NodeListViewContext }) {
  const {
    t,
    onStopXray,
    onRestartXray,
    xrayStoppingId,
    xrayRestartingId,
  } = ctx;
  const running = (r.xrayState || "").toLowerCase() === "running";
  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        {t("pages.nodes.xrayState")}
      </span>
      <XrayStateBadge state={r.xrayState} t={t} />
      {r.enable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="!p-1.5 text-[var(--fg-muted)] hover:text-amber-300 disabled:opacity-40"
            loading={xrayStoppingId === r.id}
            disabled={!running || xrayStoppingId === r.id || xrayRestartingId === r.id}
            title={
              running
                ? t("pages.nodes.stopXrayOnNode")
                : t("pages.nodes.xrayStoppedPowerInactiveHint", {
                    defaultValue:
                      "Xray is stopped — use restart to start it again.",
                  })
            }
            aria-label={t("pages.nodes.stopXrayOnNode")}
            onClick={() => onStopXray(r)}
          >
            <Power size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="!p-1.5 text-[var(--fg-muted)] hover:text-sky-300 disabled:opacity-40"
            loading={xrayRestartingId === r.id}
            disabled={xrayRestartingId === r.id || xrayStoppingId === r.id}
            title={t("pages.nodes.restartXrayOnNode")}
            aria-label={t("pages.nodes.restartXrayOnNode")}
            onClick={() => onRestartXray(r)}
          >
            <RefreshCw size={16} />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function NodeTelemtControls({ r, ctx }: { r: NodeListRow; ctx: NodeListViewContext }) {
  const {
    t,
    onStopTelemt,
    onRestartTelemt,
    telemtStoppingId,
    telemtRestartingId,
  } = ctx;
  const running = (r.telemtState || "").toLowerCase() === "running";
  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        {t("pages.nodes.telemtState")}
      </span>
      <TelemtStateBadge state={r.telemtState} t={t} />
      {r.enable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="!p-1.5 text-[var(--fg-muted)] hover:text-amber-300 disabled:opacity-40"
            loading={telemtStoppingId === r.id}
            disabled={!running || telemtStoppingId === r.id || telemtRestartingId === r.id}
            title={
              running
                ? t("pages.nodes.stopTelemtOnNode")
                : t("pages.nodes.telemtStoppedPowerInactiveHint", {
                    defaultValue:
                      "Telemt is stopped — use restart to start it again.",
                  })
            }
            aria-label={t("pages.nodes.stopTelemtOnNode")}
            onClick={() => onStopTelemt(r)}
          >
            <Power size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="!p-1.5 text-[var(--fg-muted)] hover:text-sky-300 disabled:opacity-40"
            loading={telemtRestartingId === r.id}
            disabled={telemtRestartingId === r.id || telemtStoppingId === r.id}
            title={t("pages.nodes.restartTelemtOnNode")}
            aria-label={t("pages.nodes.restartTelemtOnNode")}
            onClick={() => onRestartTelemt(r)}
          >
            <RefreshCw size={16} />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function NodeAmneziaWgControls({ r, ctx }: { r: NodeListRow; ctx: NodeListViewContext }) {
  const {
    t,
    onStopAmneziaWg,
    onRestartAmneziaWg,
    amneziawgStoppingId,
    amneziawgRestartingId,
  } = ctx;
  const running = (r.amneziawgState || "").toLowerCase() === "running";
  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        AWG
      </span>
      <AmneziaWgStateBadge state={r.amneziawgState} t={t} />
      {r.enable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="!p-1.5 text-[var(--fg-muted)] hover:text-amber-300 disabled:opacity-40"
            loading={amneziawgStoppingId === r.id}
            disabled={!running || amneziawgStoppingId === r.id || amneziawgRestartingId === r.id}
            title={t("pages.nodes.stopAmneziaWgOnNode")}
            aria-label={t("pages.nodes.stopAmneziaWgOnNode")}
            onClick={() => onStopAmneziaWg(r)}
          >
            <Power size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="!p-1.5 text-[var(--fg-muted)] hover:text-sky-300 disabled:opacity-40"
            loading={amneziawgRestartingId === r.id}
            disabled={amneziawgRestartingId === r.id || amneziawgStoppingId === r.id}
            title={t("pages.nodes.restartAmneziaWgOnNode")}
            aria-label={t("pages.nodes.restartAmneziaWgOnNode")}
            onClick={() => onRestartAmneziaWg(r)}
          >
            <RefreshCw size={16} />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function nodeCardClass(disabled: boolean) {
  return `rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] transition-colors hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] hover:bg-[color-mix(in_oklab,var(--accent)_4%,transparent)] ${
    disabled ? "opacity-[0.7]" : ""
  } cursor-pointer`;
}

function openEditProps(r: NodeListRow, ctx: NodeListViewContext) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => void ctx.onOpenEdit(r),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void ctx.onOpenEdit(r);
      }
    },
  };
}

function NodeMetaGrid({ r, ctx, cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" }: {
  r: NodeListRow;
  ctx: NodeListViewContext;
  cols?: string;
}) {
  const { t, authModeLabel, onlineUsersByNode } = ctx;
  return (
    <dl className={`grid ${cols} gap-x-4 gap-y-2`}>
      <MetaItem label={t("pages.nodes.authMode")}>{authModeLabel(r.authMode)}</MetaItem>
      <MetaItem label={t("pages.nodes.onlineUsers")}>
        <span className="font-mono">{onlineUsersByNode[r.id] ?? 0}</span>
      </MetaItem>
      <MetaItem label={t("pages.nodes.responseTime")}>
        <span className="font-mono">{responseTimeLabel(r)}</span>
      </MetaItem>
      <MetaItem label={t("pages.nodes.workerVersion")}>
        <span className="font-mono">{r.workerVersion || "—"}</span>
      </MetaItem>
      <MetaItem label={t("pages.nodes.xrayVersion")}>
        <span className="font-mono">{r.xrayVersion || "—"}</span>
      </MetaItem>
      <MetaItem label={t("pages.nodes.telemtVersion")}>
        <span className="font-mono">{r.telemtVersion || "—"}</span>
      </MetaItem>
      <MetaItem label={t("pages.nodes.assignedInbounds")} className="sm:col-span-2 lg:col-span-2">
        {inboundsLabel(r)}
      </MetaItem>
    </dl>
  );
}

export function NodeListRowView({
  r,
  ctx,
}: {
  r: NodeListRow;
  ctx: NodeListViewContext;
}) {
  const { t, onPatchEnable, togglingEnableId } = ctx;
  return (
    <article
      className={nodeCardClass(r.enable === false)}
      {...openEditProps(r, ctx)}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Switch
                size="sm"
                checked={r.enable !== false}
                disabled={togglingEnableId === r.id}
                ariaLabel={t("pages.nodes.nodeEnabled")}
                onChange={(next) => void onPatchEnable(r, next)}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{r.name}</h3>
              <p className="mt-0.5 truncate font-mono text-xs">{r.address}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NodeStatusBadge status={r.status} t={t} />
            <NodeOperateButtons r={r} ctx={ctx} />
          </div>
        </div>
        <NodeMetaGrid r={r} ctx={ctx} />
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:flex-wrap sm:gap-6">
          <NodeXrayControls r={r} ctx={ctx} />
          <NodeTelemtControls r={r} ctx={ctx} />
          <NodeAmneziaWgControls r={r} ctx={ctx} />
        </div>
      </div>
    </article>
  );
}

export function NodeTileCardView({
  r,
  ctx,
}: {
  r: NodeListRow;
  ctx: NodeListViewContext;
}) {
  const { t, onPatchEnable, togglingEnableId, authModeLabel, onlineUsersByNode, loadByNode } = ctx;
  return (
    <article
      className={`${nodeCardClass(r.enable === false)} flex h-full flex-col`}
      {...openEditProps(r, ctx)}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Switch
              size="sm"
              checked={r.enable !== false}
              disabled={togglingEnableId === r.id}
              ariaLabel={t("pages.nodes.nodeEnabled")}
              onChange={(next) => void onPatchEnable(r, next)}
            />
          </div>
          <NodeOperateButtons r={r} ctx={ctx} compact />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{r.name}</h3>
          <p className="mt-1 truncate font-mono text-[11px] leading-snug">{r.address}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NodeStatusBadge status={r.status} t={t} />
          <span className="text-[11px] text-[var(--fg-subtle)]">
            {authModeLabel(r.authMode)}
          </span>
        </div>
        <NodeLoadBlock load={loadByNode?.[r.id]} />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <MetaItem label={t("pages.nodes.onlineUsers")}>
            <span className="font-mono">{onlineUsersByNode[r.id] ?? 0}</span>
          </MetaItem>
          <MetaItem label={t("pages.nodes.responseTime")}>
            <span className="font-mono">{responseTimeLabel(r)}</span>
          </MetaItem>
          <MetaItem label={t("pages.nodes.workerVersion")}>
            <span className="font-mono text-[11px]">{r.workerVersion || "—"}</span>
          </MetaItem>
          <MetaItem label={t("pages.nodes.xrayVersion")}>
            <span className="font-mono text-[11px]">{r.xrayVersion || "—"}</span>
          </MetaItem>
          <MetaItem label={t("pages.nodes.telemtVersion")}>
            <span className="font-mono text-[11px]">{r.telemtVersion || "—"}</span>
          </MetaItem>
        </dl>
        <p className="line-clamp-2 text-[11px] leading-snug text-[var(--fg-subtle)]">
          <span className="font-semibold uppercase tracking-wide">
            {t("pages.nodes.assignedInbounds")}:{" "}
          </span>
          {inboundsLabel(r)}
        </p>
        <div className="mt-auto flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          <NodeXrayControls r={r} ctx={ctx} />
          <NodeTelemtControls r={r} ctx={ctx} />
          <NodeAmneziaWgControls r={r} ctx={ctx} />
        </div>
      </div>
    </article>
  );
}

export function NodeListView({
  rows,
  ctx,
  emptyLabel,
}: {
  rows: NodeListRow[];
  ctx: NodeListViewContext;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="pb-6 text-center text-sm text-[var(--fg-subtle)]">{emptyLabel}</p>
    );
  }
  return (
    <div className="space-y-3 pb-3">
      {rows.map((r) => (
        <NodeListRowView key={r.id} r={r} ctx={ctx} />
      ))}
    </div>
  );
}

export function NodeTilesView({
  rows,
  ctx,
  emptyLabel,
}: {
  rows: NodeListRow[];
  ctx: NodeListViewContext;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="pb-6 text-center text-sm text-[var(--fg-subtle)]">{emptyLabel}</p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 pb-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <NodeTileCardView key={r.id} r={r} ctx={ctx} />
      ))}
    </div>
  );
}
