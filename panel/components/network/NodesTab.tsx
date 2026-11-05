"use client";

import { Pause, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  CheckboxField,
  ConfirmDialog,
  IconButton,
  Input,
  LinearProgress,
  Modal,
  PillTag,
  SelectNative,
  Skeleton,
} from "@/components/ui";
import { formatCredits, formatGB } from "./format";
import type {
  NetworkNode,
  NetworkNodeSecurity,
  PublishNodePayload,
  UpdateNodePayload,
} from "@/types/network";

type Worker = { id: number; name: string; enable?: boolean };

const LIMITS = {
  trafficLimitGB: { min: 1, max: 100000 },
  speedLimitMbps: { min: 1, max: 10000 },
  reserveMbps: { min: 0, max: 10000 },
  maxSessions: { min: 1, max: 100 },
  priceCreditsPerGB: { min: 0.1, max: 10 },
} as const;

type LimitField = keyof typeof LIMITS;

type FormState = {
  label: string;
  security: NetworkNodeSecurity;
  endpointHost: string;
  trafficLimitGB: string;
  speedLimitMbps: string;
  reserveMbps: string;
  maxSessions: string;
  priceCreditsPerGB: string;
  riskAck: boolean;
};

const emptyForm: FormState = {
  label: "",
  security: "reality",
  endpointHost: "",
  trafficLimitGB: "500",
  speedLimitMbps: "200",
  reserveMbps: "20",
  maxSessions: "20",
  priceCreditsPerGB: "1.0",
  riskAck: false,
};

function nodeTone(status: string | undefined): "green" | "blue" | "amber" | "rose" | "neutral" {
  switch (status) {
    case "published":
      return "green";
    case "draining":
      return "amber";
    case "error":
      return "rose";
    case "draft":
      return "blue";
    default:
      return "neutral";
  }
}

export function NodesTab({ manage, onChanged }: { manage: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string, options?: Record<string, string | number>) =>
      t(`pages.network.${key}`, { defaultValue: fallback, ...options }),
    [t],
  );

  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);

  const [modal, setModal] = useState<
    | { kind: "publish"; nodeId: number; nodeName: string }
    | { kind: "edit"; pub: NetworkNode }
    | null
  >(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState("");
  const [unpublish, setUnpublish] = useState<NetworkNode | null>(null);
  const [publishPicker, setPublishPicker] = useState("0");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await getJson<{ nodes?: NetworkNode[] }>(panel("network/nodes"));
      if (!r.success) throw new Error(r.msg);
      setNodes(Array.isArray(r.obj?.nodes) ? r.obj.nodes : []);
      setError("");
    } catch (e) {
      if (!silent)
        setError(e instanceof Error ? e.message : tr("loadNodesError", "Could not load nodes"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
    if (manage) {
      void getJson<Worker[]>(panel("node/list")).then((r) => {
        if (r.success && Array.isArray(r.obj)) setWorkers(r.obj);
      });
    }
  }, [load, manage]);

  const publishedNodeIds = useMemo(
    () => new Set(nodes.map((n) => n.nodeId)),
    [nodes],
  );
  const unpublishedWorkers = useMemo(
    () => workers.filter((w) => !publishedNodeIds.has(w.id)),
    [workers, publishedNodeIds],
  );

  const openPublish = (nodeId: number, nodeName: string) => {
    setForm({ ...emptyForm, label: nodeName });
    setFormError("");
    setModal({ kind: "publish", nodeId, nodeName });
  };

  const openEdit = (pub: NetworkNode) => {
    setForm({
      label: pub.label ?? "",
      security: "reality",
      endpointHost: "",
      trafficLimitGB: String(pub.trafficLimitGB ?? 500),
      speedLimitMbps: String(pub.speedLimitMbps ?? 200),
      reserveMbps: String(pub.reserveMbps ?? 20),
      maxSessions: String(pub.maxSessions ?? 20),
      priceCreditsPerGB: String(pub.priceCreditsPerGB ?? 1),
      riskAck: true,
    });
    setFormError("");
    setModal({ kind: "edit", pub });
  };

  const validate = (): string => {
    for (const field of Object.keys(LIMITS) as LimitField[]) {
      const { min, max } = LIMITS[field];
      const n = Number(form[field]);
      if (!Number.isFinite(n) || n < min || n > max) {
        return tr(`range_${field}`, "{{field}}: enter a number from {{min}} to {{max}}", {
          field: tr(field, field),
          min,
          max,
        });
      }
    }
    if (modal?.kind === "publish" && !form.riskAck) {
      return tr("riskAckRequired", "Confirm that you accept the risks");
    }
    return "";
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      if (modal?.kind === "publish") {
        const body: PublishNodePayload = {
          nodeId: modal.nodeId,
          label: form.label.trim() || undefined,
          security: form.security,
          endpointHost: form.endpointHost.trim() || undefined,
          trafficLimitGB: Number(form.trafficLimitGB),
          speedLimitMbps: Number(form.speedLimitMbps),
          reserveMbps: Number(form.reserveMbps),
          maxSessions: Number(form.maxSessions),
          priceCreditsPerGB: Number(form.priceCreditsPerGB),
          riskAck: form.riskAck,
        };
        const r = await postJson(panel("network/nodes/publish"), body, true);
        if (!r.success) throw new Error(r.msg);
      } else if (modal?.kind === "edit") {
        const body: UpdateNodePayload = {
          id: modal.pub.id,
          trafficLimitGB: Number(form.trafficLimitGB),
          speedLimitMbps: Number(form.speedLimitMbps),
          reserveMbps: Number(form.reserveMbps),
          maxSessions: Number(form.maxSessions),
          priceCreditsPerGB: Number(form.priceCreditsPerGB),
          paused: modal.pub.paused ?? false,
        };
        const r = await postJson(panel("network/nodes/update"), body, true);
        if (!r.success) throw new Error(r.msg);
      }
      setModal(null);
      await load(true);
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : tr("actionError", "Operation failed"));
    } finally {
      setBusy(false);
    }
  };

  const setPaused = async (pub: NetworkNode, paused: boolean) => {
    setRowBusy(pub.id);
    setError("");
    try {
      const body: UpdateNodePayload = {
        id: pub.id,
        trafficLimitGB: pub.trafficLimitGB ?? LIMITS.trafficLimitGB.min,
        speedLimitMbps: pub.speedLimitMbps ?? LIMITS.speedLimitMbps.min,
        reserveMbps: pub.reserveMbps ?? 0,
        maxSessions: pub.maxSessions ?? LIMITS.maxSessions.min,
        priceCreditsPerGB: pub.priceCreditsPerGB ?? LIMITS.priceCreditsPerGB.min,
        paused,
      };
      const r = await postJson(panel("network/nodes/update"), body, true);
      if (!r.success) throw new Error(r.msg);
      await load(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("actionError", "Operation failed"));
    } finally {
      setRowBusy(null);
    }
  };

  const doUnpublish = async () => {
    if (!unpublish) return;
    setBusy(true);
    setError("");
    try {
      const r = await postJson(panel("network/nodes/unpublish"), { id: unpublish.id }, true);
      if (!r.success) throw new Error(r.msg);
      setUnpublish(null);
      await load(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("actionError", "Operation failed"));
    } finally {
      setBusy(false);
    }
  };

  const limitField = (
    field: LimitField,
    label: string,
    step?: string,
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        min={LIMITS[field].min}
        max={LIMITS[field].max}
        step={step ?? "1"}
        value={form[field]}
        onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
      />
    </label>
  );

  return (
    <div className="space-y-5">
      {error && <AlertBanner type="error" title={error} />}
      <Surface>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{tr("myNodes", "My published nodes")}</h2>
          <div className="flex items-center gap-2">
            <Button onClick={() => void load()} disabled={loading}>
              <RefreshCw className="size-4" />
              {t("refresh")}
            </Button>
          </div>
        </div>

        {manage && unpublishedWorkers.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <SelectNative
              className="!w-64"
              value={publishPicker}
              onChange={(e) => setPublishPicker(e.target.value)}
              aria-label={tr("chooseNode", "Choose a node")}
            >
              <option value="0">{tr("chooseNode", "Choose a node")}</option>
              {unpublishedWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </SelectNative>
            <Button
              variant="primary"
              disabled={publishPicker === "0"}
              onClick={() => {
                const w = unpublishedWorkers.find((x) => x.id === Number(publishPicker));
                if (w) openPublish(w.id, w.name);
              }}
            >
              <Plus className="size-4" />
              {tr("publish", "Publish")}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14" rounded="xl" />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--fg-subtle)]">
            {tr(
              "emptyNodes",
              "No published nodes yet. Publish a node to earn credits from other participants.",
            )}
          </p>
        ) : (
          <div className="panel-data-table overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                  <th className="p-3">{tr("node", "Node")}</th>
                  <th className="p-3">{t("status")}</th>
                  <th className="p-3">{tr("sessions", "Sessions")}</th>
                  <th className="p-3">{tr("trafficOfLimit", "Traffic / limit")}</th>
                  <th className="p-3">{tr("pricePerGB", "Price / GB")}</th>
                  <th className="w-32 p-3">{t("edit")}</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => {
                  const limit = n.trafficLimitGB ?? 0;
                  const used = n.trafficUsedGB ?? 0;
                  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                  const paused = Boolean(n.paused);
                  return (
                    <tr
                      key={n.id}
                      className="border-b border-[var(--border)] align-middle last:border-0"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{n.label || n.nodeName}</span>
                          <PillTag tone={n.nodeOnline ? "green" : "neutral"}>
                            {n.nodeOnline ? t("online") : t("offline")}
                          </PillTag>
                        </div>
                        {n.error ? (
                          <p className="mt-1 text-xs text-rose-400">{n.error}</p>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PillTag tone={nodeTone(n.status)}>
                            {n.status ? tr(`nodeStatus_${n.status}`, n.status) : "—"}
                          </PillTag>
                          {paused ? (
                            <PillTag tone="amber">{tr("paused", "paused")}</PillTag>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 tabular-nums">
                        {n.activeSessions ?? 0}
                        <span className="text-[var(--fg-subtle)]">
                          {" "}
                          / {n.maxSessions ?? "—"}
                        </span>
                      </td>
                      <td className="w-48 p-3">
                        <div className="flex items-center gap-2">
                          <LinearProgress
                            className="w-24"
                            percent={pct}
                            strokeColor={
                              pct >= 90 ? "#f43f5e" : pct >= 70 ? "#f59e0b" : "#34d399"
                            }
                          />
                          <span className="whitespace-nowrap text-xs tabular-nums text-[var(--fg-muted)]">
                            {formatGB(used)} / {formatGB(limit)} GB
                          </span>
                        </div>
                      </td>
                      <td className="p-3 tabular-nums">
                        {formatCredits(n.priceCreditsPerGB)} ₢
                      </td>
                      <td className="p-3">
                        {manage ? (
                          <div className="flex items-center gap-1">
                            {(n.status === "draft" || !n.coordinatorNodeId) && n.status !== "published" ? (
                              <Button
                                className="!px-3 !py-1.5 text-xs"
                                onClick={() => openPublish(n.nodeId, n.nodeName)}
                              >
                                {tr("publish", "Publish")}
                              </Button>
                            ) : null}
                            <IconButton
                              label={paused ? tr("resume", "Resume") : tr("pause", "Pause")}
                              disabled={rowBusy === n.id}
                              onClick={() => void setPaused(n, !paused)}
                            >
                              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                            </IconButton>
                            <IconButton
                              label={t("edit")}
                              disabled={rowBusy === n.id}
                              onClick={() => openEdit(n)}
                            >
                              <Pencil className="size-4" />
                            </IconButton>
                            <IconButton
                              label={tr("unpublish", "Unpublish")}
                              className="!text-rose-400"
                              disabled={rowBusy === n.id}
                              onClick={() => setUnpublish(n)}
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={
          modal?.kind === "publish"
            ? tr("publishTitle", "Publish node")
            : tr("editTitle", "Node limits")
        }
        width={560}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              {t("save")}
            </Button>
          </div>
        }
      >
        {formError && (
          <div className="mb-4">
            <AlertBanner type="error" title={formError} />
          </div>
        )}
        {modal?.kind === "publish" && (
          <p className="mb-4 text-sm text-[var(--fg-muted)]">
            {tr("publishIntro", "The node will be offered to other participants within the limits below.")}{" "}
            <span className="font-medium text-[var(--fg)]">{modal.nodeName}</span>
          </p>
        )}
        <fieldset disabled={!manage} className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0">
          {modal?.kind === "publish" && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {tr("label", "Label")}
                </span>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {tr("security", "Security")}
                </span>
                <SelectNative
                  value={form.security}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, security: e.target.value as NetworkNodeSecurity }))
                  }
                >
                  <option value="reality">VLESS + REALITY</option>
                </SelectNative>
              </label>
              <label className="col-span-full block">
                <span className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {tr("endpointHost", "Endpoint host (optional)")}
                </span>
                <Input
                  value={form.endpointHost}
                  onChange={(e) => setForm((f) => ({ ...f, endpointHost: e.target.value }))}
                  placeholder="node.example.com"
                />
              </label>
            </>
          )}
          {limitField("trafficLimitGB", tr("trafficLimitGB", "Traffic limit, GB"))}
          {limitField("speedLimitMbps", tr("speedLimitMbps", "Speed limit, Mbps"))}
          {limitField("reserveMbps", tr("reserveMbps", "Reserve, Mbps"))}
          {limitField("maxSessions", tr("maxSessions", "Max sessions"))}
          <p className="text-sm text-[var(--fg-muted)]">
            {tr("operatorSetsPrice", "Тариф задаёт оператор сети. Владелец выбирает объём, скорость и резерв; изменение лимитов не меняет цену действующих аренд.")}
          </p>
        </fieldset>
        {modal?.kind === "publish" && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <CheckboxField
              align="start"
              checked={form.riskAck}
              onChange={(e) => setForm((f) => ({ ...f, riskAck: e.target.checked }))}
              label={<span className="text-amber-100">{tr("riskAckShort", "I accept the risks")}</span>}
            />
            <p className="mt-2 text-xs leading-relaxed text-amber-100/90">
              {tr(
                "riskText",
                "I understand that traffic from other network participants will pass through my server; complaints and blocks by third parties are possible; I can stop participating at any time, but already established connections will finish within a few minutes.",
              )}
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={unpublish !== null}
        title={tr("unpublishTitle", "Unpublish node?")}
        description={tr(
          "unpublishText",
          "The node disappears from the catalog, active sessions end and traffic through it stops.",
        )}
        confirmLabel={tr("unpublish", "Unpublish")}
        cancelLabel={t("cancel")}
        danger
        loading={busy}
        onCancel={() => setUnpublish(null)}
        onConfirm={() => void doUnpublish()}
      />
    </div>
  );
}
