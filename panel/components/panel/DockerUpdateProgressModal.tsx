"use client";

import { CheckCircle2, Circle, CircleDashed, Loader2, RefreshCw, Server, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, LinearProgress, Modal } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";

/**
 * The update runs as a server-side job (see web/service/docker_update_job.go). The browser only
 * starts it and polls its state, so it does not matter that the panel restarts in the middle of
 * it — polling simply reconnects, and whether each step worked is read from the job, never from a
 * dropped connection.
 */

const POLL_MS = 2_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;
const RELOAD_DELAY_MS = 3_000;

type StepStatus = "pending" | "triggering" | "restarting" | "updated" | "uptodate" | "error" | "skipped";

type JobNode = {
  id: number;
  name: string;
  enable: boolean;
  colocated: boolean;
  status: StepStatus;
  versionBefore: string;
  versionAfter: string;
  message?: string;
};

type Job = {
  id: string;
  state: "running" | "done" | "failed";
  phase: string;
  multiNode: boolean;
  panel: { status: StepStatus; versionBefore: string; versionAfter: string; message?: string };
  nodes: JobNode[] | null;
};

type Props = { open: boolean; panelVersion?: string };

function hasHttpResponse(err: unknown): number | null {
  if (err && typeof err === "object" && "response" in err) {
    const r = (err as { response?: { status?: number } }).response;
    if (r && typeof r.status === "number") return r.status;
  }
  return null;
}

function StepIcon({ status }: { status: StepStatus | "reconnecting" }) {
  if (status === "triggering" || status === "restarting" || status === "reconnecting") {
    return <Loader2 className="size-4 shrink-0 animate-spin text-[var(--ifm-color-primary)]" aria-hidden />;
  }
  if (status === "updated" || status === "uptodate") return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "error") return <XCircle className="size-4 shrink-0 text-red-500" aria-hidden />;
  if (status === "skipped") return <CircleDashed className="size-4 shrink-0 text-[var(--fg-muted)]" aria-hidden />;
  return <Circle className="size-4 shrink-0 text-[var(--fg-muted)]/50" aria-hidden />;
}

function progressOf(job: Job | null): number {
  if (!job) return 2;
  const nodes = (job.nodes ?? []).filter((n) => n.enable);
  const weight = (s: StepStatus) =>
    s === "updated" || s === "uptodate" || s === "error" ? 1 : s === "restarting" ? 0.6 : s === "triggering" ? 0.25 : 0;
  const panelDone = job.panel.status === "updated" || job.panel.status === "uptodate" || job.panel.status === "error";
  const panelPart = panelDone ? 1 : job.panel.status === "triggering" ? 0.5 : 0;
  if (nodes.length === 0) return Math.round((panelDone ? 1 : job.panel.status === "triggering" ? 0.6 : 0.1) * 100);
  const nodesPart = nodes.reduce((a, n) => a + weight(n.status), 0) / nodes.length;
  return Math.max(3, Math.min(100, Math.round((nodesPart * 0.8 + panelPart * 0.2) * 100)));
}

export function DockerUpdateProgressModal({ open, panelVersion }: Props) {
  const { t } = useTranslation();
  const [job, setJob] = useState<Job | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setJob(null);
      setReconnecting(false);
      setFatal(null);
      return;
    }
    let active = true;
    const alive = () => active;
    let timer: number | undefined;
    let reloadTimer: number | undefined;
    const startedAt = Date.now();

    const scheduleReload = () => {
      reloadTimer = window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    };

    const finishIfDone = (j: Job): boolean => {
      if (j.state === "running") return false;
      // The panel image changed — reload to pick up the new UI. Problems stay on screen instead.
      if (j.state === "done" && j.panel.status === "updated") scheduleReload();
      return true;
    };

    const poll = async () => {
      if (!alive()) return;
      try {
        const res = await getJson<Job | null>(panel("api/server/updater/job"));
        if (!alive()) return;
        setReconnecting(false);
        if (res.success && res.obj) {
          setJob(res.obj);
          if (finishIfDone(res.obj)) return;
        }
      } catch (err) {
        if (!alive()) return;
        const status = hasHttpResponse(err);
        if (status === 401 || status === 403) {
          setFatal(t("menu.dockerUpdateSessionLost", { defaultValue: "The session expired while the panel was restarting. Sign in again — the update keeps running." }));
          return;
        }
        // No response (or a 5xx while the new panel is still booting): the panel is restarting.
        setReconnecting(true);
        if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
          setFatal(t("menu.dockerUpdateGaveUp", { defaultValue: "The panel did not come back in 15 minutes. Check the server." }));
          return;
        }
      }
      timer = window.setTimeout(poll, POLL_MS);
    };

    (async () => {
      // Starting is idempotent on the server: if a job is already running it is returned as is.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await postJson<Job>(panel("api/server/updater/job/start"), {}, true);
          if (!alive()) return;
          if (!res.success || !res.obj) {
            setFatal(res.msg || t("fail"));
            return;
          }
          setJob(res.obj);
          break;
        } catch (err) {
          if (!alive()) return;
          if (hasHttpResponse(err) !== null || attempt === 4) {
            setFatal(t("menu.dockerUpdateStartFailed", { defaultValue: "Could not start the update." }));
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      timer = window.setTimeout(poll, POLL_MS);
    })();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      if (reloadTimer) window.clearTimeout(reloadTimer);
    };
  }, [open, t]);

  const finished = job != null && job.state !== "running";
  const progress = useMemo(() => (finished ? 100 : progressOf(job)), [job, finished]);

  const statusLabel = (s: StepStatus): string => {
    switch (s) {
      case "pending":
        return t("menu.dockerUpdateStepPending", { defaultValue: "Waiting" });
      case "triggering":
        return t("menu.dockerUpdateStepStarting", { defaultValue: "Starting update…" });
      case "restarting":
        return t("menu.dockerUpdateStepRestarting", { defaultValue: "Restarting…" });
      case "updated":
        return t("menu.dockerUpdateStepUpdated", { defaultValue: "Updated" });
      case "uptodate":
        return t("menu.dockerUpdateStepUpToDate", { defaultValue: "Already up to date" });
      case "error":
        return t("menu.dockerUpdateStepError", { defaultValue: "Failed" });
      case "skipped":
        return t("menu.dockerUpdateStepSkipped", { defaultValue: "Skipped (disabled)" });
      default:
        return s;
    }
  };

  const versionText = (before: string, after: string) => (before && after && before !== after ? `${before} → ${after}` : after || before || "");

  const panelStatus: StepStatus | "reconnecting" =
    reconnecting && job && job.state === "running" && job.panel.status === "triggering" ? "reconnecting" : (job?.panel.status ?? "pending");
  const panelLabel =
    panelStatus === "reconnecting"
      ? t("menu.dockerUpdatePanelReloading", { defaultValue: "Panel is restarting…" })
      : job?.panel.status === "triggering"
        ? t("menu.dockerUpdatePanelUpdating", { defaultValue: "Updating — the panel will restart" })
        : statusLabel(job?.panel.status ?? "pending");

  const nodes = job?.nodes ?? [];
  const hasErrors = job?.state === "failed";

  return (
    <Modal
      open={open}
      onClose={() => {}}
      closeOnEscape={false}
      closable={false}
      title={t("menu.dockerUpdateModalTitle", { defaultValue: "Updating containers" })}
      width={520}
      footer={
        finished || fatal ? (
          <div className="flex justify-end">
            <Button variant="primary" className="!gap-2" onClick={() => window.location.reload()}>
              <RefreshCw size={15} />
              {t("menu.dockerUpdateReload", { defaultValue: "Reload page" })}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--fg-muted)]">
          {t("menu.dockerUpdateOverallHint", { defaultValue: "Worker nodes are updated first, then the panel restarts." })}
        </p>

        <LinearProgress percent={progress} strokeColor="var(--ifm-color-primary)" />

        {reconnecting && !finished ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {t("menu.dockerUpdateReconnecting", {
              defaultValue: "The panel is restarting — reconnecting. The update keeps running on the server; no action needed.",
            })}
          </p>
        ) : null}
        {fatal ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{fatal}</p> : null}
        {finished ? (
          <p className={`rounded-lg border px-3 py-2 text-xs ${hasErrors ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
            {hasErrors
              ? t("menu.dockerUpdateFinishedWithErrors", { defaultValue: "Finished with problems — see the failed items below." })
              : job?.panel.status === "updated"
                ? t("menu.dockerUpdateFinishedOk", { defaultValue: "Update finished. The page will reload." })
                : t("menu.dockerUpdateFinishedNoChange", { defaultValue: "Finished — nothing needed a restart." })}
          </p>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)]/30 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Server className="size-4 shrink-0 text-[var(--ifm-color-primary)]" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--fg-muted)]">{t("menu.dockerUpdatePanelLabel", { defaultValue: "Panel" })}</div>
                <div className="truncate text-sm font-medium text-[var(--fg)]">
                  SharX{" "}
                  {job && (job.panel.versionAfter || job.panel.versionBefore)
                    ? `v${versionText(job.panel.versionBefore, job.panel.versionAfter)}`
                    : panelVersion
                      ? `v${panelVersion}`
                      : ""}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--fg-muted)]">
              <StepIcon status={panelStatus} />
              <span className="max-w-[12rem] truncate">{panelLabel}</span>
            </div>
          </div>
          {job?.panel.message ? <p className="px-1 text-xs text-[var(--fg-muted)]">{job.panel.message}</p> : null}
        </div>

        {job?.multiNode ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
              {t("menu.dockerUpdateNodesLabel", { defaultValue: "Worker nodes" })}
            </div>
            {nodes.length > 0 ? (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                {nodes.map((node) => (
                  <li key={node.id} className="flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-[var(--bg-muted)]/40">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-[var(--fg)]">{node.name}</div>
                      {versionText(node.versionBefore, node.versionAfter) ? (
                        <div className="truncate font-mono text-[11px] text-[var(--fg-subtle)]">{versionText(node.versionBefore, node.versionAfter)}</div>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-col items-end gap-0.5">
                      <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--fg-muted)]">
                        <StepIcon status={node.status} />
                        <span className="max-w-[10rem] truncate">{statusLabel(node.status)}</span>
                      </div>
                      {node.message ? (
                        <span className={`max-w-[14rem] truncate text-[10px] ${node.status === "error" ? "text-red-500" : "text-[var(--fg-subtle)]"}`} title={node.message}>
                          {node.message}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--fg-muted)]">
                {t("menu.dockerUpdateNoNodes", { defaultValue: "No worker nodes configured" })}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
