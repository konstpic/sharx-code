"use client";

import { Power, RefreshCw, Radio, ShieldHalf, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import type { NodeListRow, NodeListViewContext } from "@/components/nodes/NodeListViews";

type CoreDef = {
  id: "xray" | "telemt" | "amneziawg";
  name: string;
  icon: LucideIcon;
  version: string;
  state: string | undefined;
  stopping: boolean;
  restarting: boolean;
  onStop: () => void;
  onRestart: () => void;
  stopTitle: string;
  restartTitle: string;
};

const DOT: Record<string, string> = {
  running: "#22c55e",
  stopped: "#f59e0b",
  error: "#ef4444",
  unknown: "#94a3b8",
};

function IconAction({
  children,
  title,
  onClick,
  disabled,
  loading,
  tone,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  tone: "stop" | "restart";
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`!size-7 !rounded-md !border !border-[var(--border)] !p-0 text-[var(--fg-muted)] disabled:opacity-40 ${
        tone === "stop" ? "hover:!border-amber-400/60 hover:text-amber-300" : "hover:!border-sky-400/60 hover:text-sky-300"
      }`}
      loading={loading}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Every core of a node in one aligned block: name, version, state and stop/restart actions. */
export function NodeCoresBlock({ r, ctx }: { r: NodeListRow; ctx: NodeListViewContext }) {
  const { t } = ctx;
  const cores: CoreDef[] = [
    {
      id: "xray",
      name: "Xray",
      icon: Zap,
      version: r.xrayVersion || "",
      state: r.xrayState,
      stopping: ctx.xrayStoppingId === r.id,
      restarting: ctx.xrayRestartingId === r.id,
      onStop: () => ctx.onStopXray(r),
      onRestart: () => ctx.onRestartXray(r),
      stopTitle: t("pages.nodes.stopXrayOnNode"),
      restartTitle: t("pages.nodes.restartXrayOnNode"),
    },
    {
      id: "telemt",
      name: "Telemt",
      icon: Radio,
      version: r.telemtVersion || "",
      state: r.telemtState,
      stopping: ctx.telemtStoppingId === r.id,
      restarting: ctx.telemtRestartingId === r.id,
      onStop: () => ctx.onStopTelemt(r),
      onRestart: () => ctx.onRestartTelemt(r),
      stopTitle: t("pages.nodes.stopTelemtOnNode"),
      restartTitle: t("pages.nodes.restartTelemtOnNode"),
    },
    {
      id: "amneziawg",
      name: "AmneziaWG",
      icon: ShieldHalf,
      version: "",
      state: r.amneziawgState,
      stopping: ctx.amneziawgStoppingId === r.id,
      restarting: ctx.amneziawgRestartingId === r.id,
      onStop: () => ctx.onStopAmneziaWg(r),
      onRestart: () => ctx.onRestartAmneziaWg(r),
      stopTitle: t("pages.nodes.stopAmneziaWgOnNode"),
      restartTitle: t("pages.nodes.restartAmneziaWgOnNode"),
    },
  ];

  const stateLabel = (c: CoreDef, s: string) => {
    const key = c.id === "amneziawg" ? "amneziawg" : c.id;
    return t(`pages.nodes.${key}State${s.charAt(0).toUpperCase()}${s.slice(1)}`, {
      defaultValue: s === "running" ? "Running" : s === "stopped" ? "Stopped" : s === "error" ? "Error" : "Unknown",
    });
  };

  return (
    <div
      className="flex flex-col gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        <span>{t("pages.nodes.coresTitle", { defaultValue: "Cores" })}</span>
        {r.workerVersion ? (
          <span className="rounded panel-inset-strong px-1.5 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal text-[var(--fg-muted)]">
            worker {r.workerVersion}
          </span>
        ) : null}
      </div>
      {cores.map((c) => {
        const s = (c.state || "unknown").toLowerCase();
        const st = s in DOT ? s : "unknown";
        const running = st === "running";
        const Icon = c.icon;
        const busy = c.stopping || c.restarting;
        return (
          <div
            key={c.id}
            className="grid grid-cols-[minmax(5.75rem,auto)_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-[var(--border)] panel-inset px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--fg)]">
              <Icon size={13} className="shrink-0 text-[var(--fg-muted)]" aria-hidden />
              <span className="truncate">{c.name}</span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-muted)]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: DOT[st] }} aria-hidden />
                {stateLabel(c, st)}
              </span>
              {c.version ? (
                <span className="rounded panel-inset-strong px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                  {c.version}
                </span>
              ) : null}
            </span>
            {r.enable ? (
              <span className="flex shrink-0 items-center gap-1">
                <IconAction tone="stop" title={c.stopTitle} onClick={c.onStop} loading={c.stopping} disabled={!running || busy}>
                  <Power size={14} />
                </IconAction>
                <IconAction tone="restart" title={c.restartTitle} onClick={c.onRestart} loading={c.restarting} disabled={busy}>
                  <RefreshCw size={14} />
                </IconAction>
              </span>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Assigned inbounds as chips: first few, the rest behind a "+N" toggle. */
export function NodeInboundChips({ r, label }: { r: NodeListRow; label: string }) {
  const [open, setOpen] = useState(false);
  const items = (r.inbounds ?? []).map((ib) => ib.remark || (ib.id != null ? `#${ib.id}` : "—"));
  const LIMIT = 3;
  const shown = open ? items : items.slice(0, LIMIT);
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{label}</div>
      {items.length === 0 ? (
        <span className="text-[11px] text-[var(--fg-subtle)]">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {shown.map((name, i) => (
            <span
              key={`${name}-${i}`}
              title={name}
              className="max-w-full truncate rounded-full border border-[var(--border)] panel-inset px-2 py-0.5 text-[10px] text-[var(--fg-muted)]"
            >
              {name}
            </span>
          ))}
          {items.length > LIMIT ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] hover:panel-inset-strong"
            >
              {open ? "−" : `+${items.length - LIMIT}`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
