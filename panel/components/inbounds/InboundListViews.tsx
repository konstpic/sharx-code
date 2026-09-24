"use client";

import { Share2, Trash2 } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import type { TFunction } from "i18next";
import { sizeFormat } from "@/lib/format";
import { Button, Switch } from "@/components/ui";

export type InboundListRow = {
  id: number;
  remark: string;
  tag: string;
  protocol: string;
  port: number;
  up: number;
  down: number;
  enable: boolean;
};

export type InboundListViewContext = {
  t: TFunction;
  onOpenEdit: (id: number) => void;
  onToggleEnable: (id: number, next: boolean) => void;
  toggleEnableBusyId: number | null;
  onDelete: (id: number) => void;
  onShare: (id: number, remark: string) => void;
};

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

function inboundCardClass(disabled: boolean) {
  return `rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] transition-colors hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] hover:bg-[color-mix(in_oklab,var(--accent)_4%,transparent)] ${
    disabled ? "opacity-[0.7]" : ""
  } cursor-pointer`;
}

function openEditProps(id: number, ctx: InboundListViewContext) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => void ctx.onOpenEdit(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void ctx.onOpenEdit(id);
      }
    },
  };
}

function InboundOperateButtons({
  r,
  ctx,
  compact = false,
}: {
  r: InboundListRow;
  ctx: InboundListViewContext;
  compact?: boolean;
}) {
  const { t, onDelete, onShare } = ctx;
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
        onClick={() => onShare(r.id, r.remark)}
        title={t("pages.templates.share", { defaultValue: "Share as template" })}
        aria-label={t("pages.templates.share", { defaultValue: "Share as template" })}
      >
        <Share2 size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="!p-1.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
        onClick={() => onDelete(r.id)}
        title={t("delete")}
        aria-label={t("delete")}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}

function InboundMetaGrid({
  r,
  ctx,
  cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
}: {
  r: InboundListRow;
  ctx: InboundListViewContext;
  cols?: string;
}) {
  const { t } = ctx;
  return (
    <dl className={`grid ${cols} gap-x-4 gap-y-2`}>
      <MetaItem label={t("pages.inbounds.tagColumn", { defaultValue: "Tag" })}>
        <span className="font-mono">{r.tag || "—"}</span>
      </MetaItem>
      <MetaItem label={t("protocol")}>{r.protocol || "—"}</MetaItem>
      <MetaItem label={t("pages.inbounds.port")}>
        <span className="font-mono tabular-nums">{r.port}</span>
      </MetaItem>
      <MetaItem label={t("pages.inbounds.totalDownUp", { defaultValue: "Up / down" })}>
        <span className="font-mono tabular-nums whitespace-nowrap">
          {sizeFormat(r.up)} / {sizeFormat(r.down)}
        </span>
      </MetaItem>
    </dl>
  );
}

export function InboundListRowView({
  r,
  ctx,
}: {
  r: InboundListRow;
  ctx: InboundListViewContext;
}) {
  const { t, onToggleEnable, toggleEnableBusyId } = ctx;
  return (
    <article className={inboundCardClass(!r.enable)} {...openEditProps(r.id, ctx)}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Switch
                size="sm"
                checked={r.enable}
                disabled={toggleEnableBusyId === r.id}
                ariaLabel={`${t("enable")} — ${r.remark || `inbound ${r.id}`}`}
                onChange={(next) => void onToggleEnable(r.id, next)}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--fg)]">
                {r.remark || "—"}
              </h3>
              <p className="mt-0.5 truncate font-mono text-xs">
                {r.tag || `#${r.id}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide">
              {r.protocol || "—"}
            </span>
            <InboundOperateButtons r={r} ctx={ctx} />
          </div>
        </div>
        <InboundMetaGrid r={r} ctx={ctx} />
      </div>
    </article>
  );
}

export function InboundTileCardView({
  r,
  ctx,
}: {
  r: InboundListRow;
  ctx: InboundListViewContext;
}) {
  const { t, onToggleEnable, toggleEnableBusyId } = ctx;
  return (
    <article
      className={`${inboundCardClass(!r.enable)} flex h-full flex-col`}
      {...openEditProps(r.id, ctx)}
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
              checked={r.enable}
              disabled={toggleEnableBusyId === r.id}
              ariaLabel={`${t("enable")} — ${r.remark || `inbound ${r.id}`}`}
              onChange={(next) => void onToggleEnable(r.id, next)}
            />
          </div>
          <InboundOperateButtons r={r} ctx={ctx} compact />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--fg)]">
            {r.remark || "—"}
          </h3>
          <p className="mt-1 truncate font-mono text-[11px] leading-snug">
            {r.tag || `#${r.id}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide">
            {r.protocol || "—"}
          </span>
          <span className="font-mono text-xs tabular-nums text-[var(--fg-subtle)]">
            :{r.port}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <MetaItem label={t("pages.inbounds.port")}>
            <span className="font-mono tabular-nums">{r.port}</span>
          </MetaItem>
          <MetaItem label={t("pages.inbounds.totalDownUp", { defaultValue: "Up / down" })}>
            <span className="font-mono text-[11px] tabular-nums">
              {sizeFormat(r.up)} / {sizeFormat(r.down)}
            </span>
          </MetaItem>
        </dl>
      </div>
    </article>
  );
}

export function InboundListView({
  rows,
  ctx,
  emptyLabel,
}: {
  rows: InboundListRow[];
  ctx: InboundListViewContext;
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
        <InboundListRowView key={r.id} r={r} ctx={ctx} />
      ))}
    </div>
  );
}

export function InboundTilesView({
  rows,
  ctx,
  emptyLabel,
}: {
  rows: InboundListRow[];
  ctx: InboundListViewContext;
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
        <InboundTileCardView key={r.id} r={r} ctx={ctx} />
      ))}
    </div>
  );
}
