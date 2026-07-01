"use client";

import { CheckCircle2, Circle, Loader2, Server, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinearProgress, Modal } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";

const PANEL_RELOAD_DELAY_MS = 30_000;
const NODE_WAIT_TIMEOUT_MS = 5 * 60_000;
const NODE_POLL_INTERVAL_MS = 3_000;
const POST_TRIGGER_SETTLE_MS = 5_000;

type StepStatus = "pending" | "running" | "success" | "error" | "skipped";

type NodeRow = {
  id: number;
  name: string;
  enable: boolean;
  status: StepStatus;
  error?: string;
};

type PanelRow = {
  status: StepStatus | "reloading";
  error?: string;
};

type DockerUpdatePlan = {
  multiNode: boolean;
  nodes: Array<{ id: number; name: string; enable: boolean }>;
};

type TriggerNodeResult = {
  id: number;
  name: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

type DockerUpdateProgressModalProps = {
  open: boolean;
  panelVersion?: string;
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = window.setTimeout(() => resolve(), ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function StepIcon({ status }: { status: StepStatus | "reloading" }) {
  if (status === "running" || status === "reloading") {
    return <Loader2 className="size-4 shrink-0 animate-spin text-[var(--ifm-color-primary)]" aria-hidden />;
  }
  if (status === "success") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />;
  }
  if (status === "error") {
    return <XCircle className="size-4 shrink-0 text-red-500" aria-hidden />;
  }
  if (status === "skipped") {
    return <Circle className="size-4 shrink-0 text-[var(--fg-muted)]" aria-hidden />;
  }
  return <Circle className="size-4 shrink-0 text-[var(--fg-muted)]/50" aria-hidden />;
}

function statusLabel(
  t: (key: string, opts?: { defaultValue?: string }) => string,
  status: StepStatus | "reloading",
): string {
  switch (status) {
    case "pending":
      return t("menu.dockerUpdateStepPending", { defaultValue: "Waiting" });
    case "running":
      return t("menu.dockerUpdateStepRunning", { defaultValue: "Updating…" });
    case "reloading":
      return t("menu.dockerUpdatePanelReloading", { defaultValue: "Panel is restarting…" });
    case "success":
      return t("menu.dockerUpdateStepSuccess", { defaultValue: "Done" });
    case "error":
      return t("menu.dockerUpdateStepError", { defaultValue: "Failed" });
    case "skipped":
      return t("menu.dockerUpdateStepSkipped", { defaultValue: "Skipped (disabled)" });
    default:
      return status;
  }
}

function computeProgress(
  panelRow: PanelRow,
  nodes: NodeRow[],
  reloadProgress: number,
  phase: "idle" | "workers" | "panel" | "reload",
): number {
  const enabledNodes = nodes.filter((n) => n.enable);
  const enabledCount = enabledNodes.length;

  if (phase === "idle") return 0;

  let workersDone = 0;
  for (const node of enabledNodes) {
    if (node.status === "success" || node.status === "error") {
      workersDone += 1;
    } else if (node.status === "running") {
      workersDone += 0.35;
    }
  }

  const workersShare = enabledCount > 0 ? 0.82 : 0;
  const panelShare = enabledCount > 0 ? 0.18 : 1;

  let workersPct = 0;
  if (enabledCount > 0) {
    workersPct = (workersDone / enabledCount) * workersShare * 100;
  }

  let panelPct = 0;
  if (panelRow.status === "running") {
    panelPct = panelShare * 35;
  } else if (panelRow.status === "reloading") {
    panelPct = panelShare * (40 + reloadProgress * 0.6);
  } else if (panelRow.status === "success") {
    panelPct = panelShare * 100;
  } else if (panelRow.status === "error") {
    panelPct = panelShare * 100;
  }

  if (enabledCount === 0 && phase === "panel") {
    if (panelRow.status === "reloading") {
      return 40 + reloadProgress * 0.6;
    }
    if (panelRow.status === "running") {
      return 25;
    }
  }

  return Math.min(100, Math.round(workersPct + panelPct));
}

export function DockerUpdateProgressModal({ open, panelVersion }: DockerUpdateProgressModalProps) {
  const { t } = useTranslation();
  const [panelRow, setPanelRow] = useState<PanelRow>({ status: "pending" });
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [multiNode, setMultiNode] = useState(false);
  const [phase, setPhase] = useState<"idle" | "workers" | "panel" | "reload">("idle");
  const [reloadProgress, setReloadProgress] = useState(0);
  const runRef = useRef(0);

  const progress = useMemo(
    () => computeProgress(panelRow, nodes, reloadProgress, phase),
    [panelRow, nodes, reloadProgress, phase],
  );

  useEffect(() => {
    if (!open) {
      setPanelRow({ status: "pending" });
      setNodes([]);
      setMultiNode(false);
      setPhase("idle");
      setReloadProgress(0);
      return;
    }

    const runId = ++runRef.current;
    const abort = new AbortController();

    const setNodeStatus = (id: number, patch: Partial<NodeRow>) => {
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    };

    (async () => {
      try {
        setPhase("workers");
        setPanelRow({ status: "pending" });

        const planRes = await getJson<DockerUpdatePlan>(panel("api/server/updater/plan"));
        if (runRef.current !== runId) return;
        if (!planRes.success || !planRes.obj) {
          setPanelRow({ status: "error", error: planRes.msg || t("fail") });
          return;
        }

        const plan = planRes.obj;
        setMultiNode(Boolean(plan.multiNode));
        const initialNodes: NodeRow[] = (plan.nodes ?? []).map((n) => ({
          id: n.id,
          name: n.name,
          enable: n.enable,
          status: n.enable ? "pending" : "skipped",
        }));
        setNodes(initialNodes);

        const enabledNodes = initialNodes.filter((n) => n.enable);

        if (plan.multiNode && enabledNodes.length > 0) {
          for (const n of enabledNodes) {
            setNodeStatus(n.id, { status: "running" });
          }

          await postJson(panel("api/server/updater/workers/prep"), {}, true);
          if (runRef.current !== runId) return;

          const triggerRes = await postJson<{ nodes: TriggerNodeResult[] }>(
            panel("api/server/updater/workers/trigger"),
            {},
            true,
          );
          if (runRef.current !== runId) return;

          const triggerResults = triggerRes.obj?.nodes ?? [];
          for (const res of triggerResults) {
            if (res.skipped) {
              setNodeStatus(res.id, { status: "skipped" });
              continue;
            }
            if (res.ok) {
              setNodeStatus(res.id, { status: "running" });
            } else {
              setNodeStatus(res.id, { status: "error", error: res.error });
            }
          }

          await sleep(POST_TRIGGER_SETTLE_MS, abort.signal);
          if (runRef.current !== runId) return;

          const waitTargets = new Set<number>();
          for (const res of triggerResults) {
            if (!res.skipped && res.ok) {
              waitTargets.add(res.id);
            }
          }

          const waitStarted = Date.now();
          while (waitTargets.size > 0 && Date.now() - waitStarted < NODE_WAIT_TIMEOUT_MS) {
            if (runRef.current !== runId) return;

            for (const id of [...waitTargets]) {
              const checkRes = await postJson<{ status?: string }>(panel(`api/node/check/${id}`));
              const nodeObj = checkRes.obj as { status?: string } | undefined;
              const online = (nodeObj?.status ?? "").toLowerCase() === "online";
              if (checkRes.success && online) {
                waitTargets.delete(id);
                setNodeStatus(id, { status: "success" });
              } else {
                setNodeStatus(id, { status: "running" });
              }
            }

            if (waitTargets.size === 0) break;
            await sleep(NODE_POLL_INTERVAL_MS, abort.signal);
          }

          if (runRef.current !== runId) return;

          for (const id of waitTargets) {
            setNodeStatus(id, {
              status: "error",
              error: t("menu.dockerUpdateNodeWaitTimeout", {
                defaultValue: "Timed out waiting for restart",
              }),
            });
          }

          await postJson(panel("api/server/updater/workers/finish"), {}, true);
          if (runRef.current !== runId) return;
        }

        setPhase("panel");
        setPanelRow({ status: "running" });
        const panelRes = await postJson(panel("api/server/updater/panel/trigger"), {}, true);
        if (runRef.current !== runId) return;

        if (!panelRes.success) {
          setPanelRow({ status: "error", error: panelRes.msg || t("fail") });
          return;
        }

        setPhase("reload");
        setPanelRow({ status: "reloading" });
        const reloadStarted = Date.now();
        const reloadTimer = window.setInterval(() => {
          const elapsed = Date.now() - reloadStarted;
          setReloadProgress(Math.min(100, (elapsed / PANEL_RELOAD_DELAY_MS) * 100));
        }, 200);

        window.setTimeout(() => {
          window.clearInterval(reloadTimer);
          setReloadProgress(100);
          window.location.reload();
        }, PANEL_RELOAD_DELAY_MS);
      } catch (err) {
        if (runRef.current !== runId) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPanelRow({ status: "error", error: t("fail") });
      }
    })();

    return () => {
      abort.abort();
    };
  }, [open, t]);

  const panelLabel = t("menu.dockerUpdatePanelLabel", { defaultValue: "Panel" });
  const nodesLabel = t("menu.dockerUpdateNodesLabel", { defaultValue: "Worker nodes" });

  return (
    <Modal
      open={open}
      onClose={() => {}}
      closeOnEscape={false}
      closable={false}
      title={t("menu.dockerUpdateModalTitle", { defaultValue: "Updating containers" })}
      width={520}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--fg-muted)]">
          {t("menu.dockerUpdateOverallHint", {
            defaultValue: "Worker nodes are updated first, then the panel restarts.",
          })}
        </p>

        <LinearProgress percent={progress} strokeColor="var(--ifm-color-primary)" />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)]/30 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Server className="size-4 shrink-0 text-[var(--ifm-color-primary)]" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--fg-muted)]">{panelLabel}</div>
                <div className="truncate text-sm font-medium text-[var(--fg)]">
                  SharX {panelVersion ? `v${panelVersion}` : ""}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--fg-muted)]">
              <StepIcon status={panelRow.status} />
              <span>{statusLabel(t, panelRow.status)}</span>
            </div>
          </div>
          {panelRow.error ? (
            <p className="px-1 text-xs text-red-500">{panelRow.error}</p>
          ) : null}
        </div>

        {multiNode ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
              {nodesLabel}
            </div>
            {nodes.length > 0 ? (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                {nodes.map((node) => (
                  <li
                    key={node.id}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-[var(--bg-muted)]/40"
                  >
                    <span className="min-w-0 truncate text-sm text-[var(--fg)]">{node.name}</span>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--fg-muted)]">
                      <StepIcon status={node.status} />
                      <span className="max-w-[10rem] truncate">{statusLabel(t, node.status)}</span>
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
