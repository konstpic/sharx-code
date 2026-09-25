"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
  Clock,
  Layers,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Shield,
  ShieldOff,
  Trash2,
  User,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { BundlePicker } from "@/components/bundles/BundlePicker";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson, type Msg } from "@/lib/api";
import { panel } from "@/lib/paths";
import { PageScaffold, PageHeader, Surface } from "@/components/panel";
import {
  Button,
  CheckboxField,
  ConfirmDialog,
  IconButton,
  IconTile,
  Input,
  Modal,
  Reveal,
  Spinner,
  useToast,
} from "@/components/ui";

/** Header used in every section card — matches the client edit modal. */
function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <IconTile icon={Icon} tone="accent" size="sm" />
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
        {children}
      </span>
    </div>
  );
}

/**
 * Visual hint shown beneath every right-column field. Tells the user whether
 * the prefilled value reflects what every client in the group currently has
 * (so saving without touching is a no-op), or whether clients differ — in
 * which case typing a value will normalize them all.
 */
function ConsistencyHint({
  loading,
  clientCount,
  consistent,
  t,
}: {
  loading: boolean;
  clientCount: number;
  consistent: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  if (clientCount < 1) {
    return (
      <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
        {t("pages.groups.hintNoClients", {
          defaultValue: "No clients in this group yet.",
        })}
      </p>
    );
  }
  if (loading) {
    return (
      <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
        {t("loading")}
      </p>
    );
  }
  if (consistent) {
    return (
      <p className="mt-1 text-[11px] text-emerald-600/90 dark:text-emerald-400/80">
        {t("pages.groups.hintConsistent", {
          defaultValue:
            "Current value across all {{count}} clients in this group.",
          count: clientCount,
        })}
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] text-amber-600/90 dark:text-amber-400/90">
      {t("pages.groups.hintMixed", {
        defaultValue:
          "Clients in this group currently have different values. Set a value to normalize all {{count}} clients.",
        count: clientCount,
      })}
    </p>
  );
}

/** Capsule toggle for inbound chips inside the group edit modal. */
function GroupInboundCapsule({
  selected,
  onToggle,
  label,
  sublabel,
}: {
  selected: boolean;
  onToggle: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        "inline-flex min-w-0 max-w-full flex-col rounded-full border px-3 py-1.5 text-left text-xs transition-colors " +
        (selected
          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--fg)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:border-[var(--fg-subtle)]")
      }
    >
      <span className="truncate font-medium">{label}</span>
      <span className="truncate text-[10px] text-[var(--fg-subtle)]">{sublabel}</span>
    </button>
  );
}

type GroupRow = {
  id: number;
  name: string;
  description: string;
  clientCount: number;
  createdAt?: number;
  updatedAt?: number;
};

type InboundOption = {
  id: number;
  remark: string;
  protocol: string;
  port: number;
};

type PendingBulk = {
  action: "reset" | "clearHwid" | "deleteAll" | "enable" | "disable";
  group: GroupRow;
};

/**
 * Common settings shared by every client in a group. A field is undefined when
 * client values differ — the UI then shows a "mixed" hint instead of a value.
 * Returned by the new `group/{id}/effectiveSettings` endpoint and used as the
 * source of truth that the group can override.
 */
type EffectiveSettings = {
  clientCount: number;
  expiryTime?: number;
  totalGB?: number;
  hwidEnabled?: boolean;
  maxHwid?: number;
  ipLimitEnabled?: boolean;
  maxIPs?: number;
  inboundIds?: number[];
  inboundIdsConsistent: boolean;
  bundleIds?: number[];
  bundleIdsConsistent?: boolean;
};

/** Convert an epoch ms timestamp to the `YYYY-MM-DDTHH:mm` form expected by `<input type="datetime-local">`. */
function epochToLocalInput(ms: number): string {
  if (!ms || ms < 1) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function TextArea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-[88px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] ${className}`}
      {...rest}
    />
  );
}

function pendingBulkDescription(
  t: (k: string) => string,
  p: PendingBulk,
): string {
  switch (p.action) {
    case "reset":
      return t("pages.groups.bulkResetTrafficConfirm");
    case "clearHwid":
      return t("pages.groups.bulkClearHwidConfirm");
    case "deleteAll":
      return t("pages.groups.bulkDeleteConfirm");
    case "enable":
      return t("pages.groups.bulkEnableConfirm");
    case "disable":
      return t("pages.groups.bulkDisableConfirm");
    default:
      return "";
  }
}

function formatGroupDateTime(ms: number | undefined, empty: string): string {
  if (ms == null || ms === 0) return empty;
  const normalized = ms < 1e12 ? ms * 1000 : ms;
  try {
    return new Date(normalized).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return empty;
  }
}

export function GroupsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);

  // "Add" modal — kept simple and separate from the edit modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", description: "" });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit modal — opens for a single group, mirrors the client edit modal.
  const [bulkGroup, setBulkGroup] = useState<GroupRow | null>(null);
  const [pendingBulk, setPendingBulk] = useState<PendingBulk | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: "", description: "" });
  const [hwidForm, setHwidForm] = useState({ maxHwid: 0, enabled: true });
  const [hwidTouched, setHwidTouched] = useState(false);
  const [ipForm, setIpForm] = useState({ maxIPs: 1, enabled: true });
  const [ipTouched, setIpTouched] = useState(false);
  const [trafficGB, setTrafficGB] = useState<number>(0);
  const [trafficTouched, setTrafficTouched] = useState(false);
  const [expiryValue, setExpiryValue] = useState<string>("");
  const [expiryTouched, setExpiryTouched] = useState(false);

  const [inbounds, setInbounds] = useState<InboundOption[]>([]);
  const [inboundIds, setInboundIds] = useState<Record<number, boolean>>({});
  const [inboundOrder, setInboundOrder] = useState<number[]>([]);
  const [inboundsTouched, setInboundsTouched] = useState(false);
  const [bundleMode, setBundleMode] = useState(false);
  const [bundleOptions, setBundleOptions] = useState<{ id: number; name: string; auto: boolean; clientCount: number }[]>([]);
  const [bundleSel, setBundleSel] = useState<Record<number, boolean>>({});
  const [bundlesTouched, setBundlesTouched] = useState(false);

  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [effectiveLoading, setEffectiveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getJson<GroupRow[]>(panel("group/list"));
    setLoading(false);
    if (r.success && Array.isArray(r.obj)) {
      setRows(
        (r.obj as GroupRow[]).map((x) => ({
          id: x.id,
          name: x.name ?? "",
          description: x.description ?? "",
          clientCount: x.clientCount ?? 0,
          createdAt: x.createdAt,
          updatedAt: x.updatedAt,
        })),
      );
    } else {
      setRows([]);
    }
  }, []);

  const loadInbounds = useCallback(async () => {
    const st = await getJson<{ enabled?: boolean }>(panel("bundle/state"));
    const on = !!(st.success && st.obj?.enabled);
    setBundleMode(on);
    if (on) {
      const b = await getJson<{ id: number; name: string; auto: boolean; clientCount: number }[]>(panel("bundle/list"));
      setBundleOptions(b.success && Array.isArray(b.obj) ? b.obj.filter((x) => !x.auto) : []);
    }
    const r = await getJson<InboundOption[]>(panel("api/inbounds/list"));
    if (r.success && Array.isArray(r.obj)) {
      setInbounds(
        (r.obj as InboundOption[]).map((x) => ({
          id: x.id,
          remark: x.remark || t("pages.groups.inboundFallback", { id: x.id }),
          protocol: x.protocol,
          port: x.port,
        })),
      );
    } else {
      setInbounds([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setAddForm({ name: "", description: "" });
    setAddOpen(true);
  };

  const openEdit = (r: GroupRow) => {
    setForm({ name: r.name, description: r.description });
    setHwidForm({ maxHwid: 0, enabled: true });
    setHwidTouched(false);
    setIpForm({ maxIPs: 1, enabled: true });
    setIpTouched(false);
    setTrafficGB(0);
    setTrafficTouched(false);
    setExpiryValue("");
    setExpiryTouched(false);
    setInboundIds({});
    setInboundOrder([]);
    setInboundsTouched(false);
    setBundleSel({});
    setBundlesTouched(false);
    setEffective(null);
    setBulkGroup(r);
  };

  /**
   * Apply the values returned by `effectiveSettings` to the form. Only fields
   * with a non-undefined value are prefilled — undefined means "mixed across
   * clients" and the UI surfaces a hint instead. We do NOT mark fields as
   * touched here so that Save skips bulk endpoints when the user hasn't
   * actually changed anything.
   */
  const applyEffective = useCallback((eff: EffectiveSettings) => {
    if (eff.expiryTime != null) {
      setExpiryValue(epochToLocalInput(eff.expiryTime));
    }
    if (eff.totalGB != null) {
      setTrafficGB(Math.max(0, Math.floor(eff.totalGB)));
    }
    if (eff.hwidEnabled != null && eff.maxHwid != null) {
      setHwidForm({ enabled: eff.hwidEnabled, maxHwid: eff.maxHwid });
    }
    if (eff.ipLimitEnabled != null && eff.maxIPs != null) {
      setIpForm({
        enabled: eff.ipLimitEnabled,
        maxIPs: Math.max(0, eff.maxIPs),
      });
    }
    if (eff.bundleIdsConsistent && Array.isArray(eff.bundleIds)) {
      const bm: Record<number, boolean> = {};
      for (const id of eff.bundleIds) bm[id] = true;
      setBundleSel(bm);
    }
    if (eff.inboundIdsConsistent && Array.isArray(eff.inboundIds)) {
      const ids = eff.inboundIds;
      const map: Record<number, boolean> = {};
      for (const id of ids) map[id] = true;
      setInboundIds(map);
      setInboundOrder(ids.slice());
    }
  }, []);

  const loadEffective = useCallback(
    async (groupId: number) => {
      setEffectiveLoading(true);
      try {
        const r = await getJson<EffectiveSettings>(
          panel(`group/${groupId}/effectiveSettings`),
        );
        if (r.success && r.obj && typeof r.obj === "object") {
          const eff = r.obj as EffectiveSettings;
          setEffective(eff);
          applyEffective(eff);
        } else {
          setEffective(null);
        }
      } catch {
        setEffective(null);
      } finally {
        setEffectiveLoading(false);
      }
    },
    [applyEffective],
  );

  useEffect(() => {
    if (bulkGroup) {
      void loadInbounds();
      void loadEffective(bulkGroup.id);
    }
  }, [bulkGroup, loadInbounds, loadEffective]);

  const closeEdit = () => {
    if (saving) return;
    setBulkGroup(null);
  };

  const toggleInboundId = (id: number) => {
    setInboundsTouched(true);
    setInboundIds((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      const isOn = next[id];
      setInboundOrder((order) => {
        if (isOn) return order.includes(id) ? order : [...order, id];
        return order.filter((x) => x !== id);
      });
      return next;
    });
  };

  const moveInboundOrder = (idx: number, dir: -1 | 1) => {
    setInboundsTouched(true);
    setInboundOrder((order) => {
      const j = idx + dir;
      if (j < 0 || j >= order.length) return order;
      const next = order.slice();
      const a = next[idx]!;
      const b = next[j]!;
      next[idx] = b;
      next[j] = a;
      return next;
    });
  };

  const submitAdd = async () => {
    const name = addForm.name.trim();
    if (!name) {
      toast.error(t("pages.groups.enterGroupName"));
      return;
    }
    setAddSubmitting(true);
    try {
      const r = await postJson<unknown>(
        panel("group/add"),
        { name, description: addForm.description.trim() },
        true,
      );
      if (r.success) {
        toast.success(
          (r as { msg?: string }).msg || t("pages.groups.addSuccess"),
        );
        setAddOpen(false);
        void load();
      } else {
        toast.error(
          (r as { msg?: string }).msg || t("pages.groups.addError"),
        );
      }
    } catch {
      toast.error(t("pages.groups.addError"));
    } finally {
      setAddSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    setDeleting(true);
    const r = await postJson(panel(`group/del/${deleteId}`));
    setDeleting(false);
    if (r.success) {
      toast.success(
        (r as { msg?: string }).msg || t("pages.groups.deleteSuccess"),
      );
      setDeleteId(null);
      void load();
    } else {
      toast.error(
        (r as { msg?: string }).msg || t("pages.groups.deleteError"),
      );
    }
  };

  const startBulkConfirm = (action: PendingBulk["action"]) => {
    if (!bulkGroup) return;
    setPendingBulk({ action, group: bulkGroup });
  };

  const runPendingBulk = async () => {
    if (pendingBulk == null) return;
    const { action, group } = pendingBulk;
    const id = group.id;
    setBulkWorking(true);
    let r: Msg<unknown> | null = null;
    try {
      switch (action) {
        case "reset":
          r = await postJson<unknown>(
            panel(`group/${id}/bulk/resetTraffic`),
            {},
            true,
          );
          break;
        case "clearHwid":
          r = await postJson<unknown>(
            panel(`group/${id}/bulk/clearHwid`),
            {},
            true,
          );
          break;
        case "deleteAll":
          r = await postJson<unknown>(
            panel(`group/${id}/bulk/delete`),
            {},
            true,
          );
          break;
        case "enable":
          r = await postJson<unknown>(
            panel(`group/${id}/bulk/enable`),
            { enable: true },
            true,
          );
          break;
        case "disable":
          r = await postJson<unknown>(
            panel(`group/${id}/bulk/enable`),
            { enable: false },
            true,
          );
          break;
        default:
          break;
      }
    } catch {
      r = null;
    } finally {
      setBulkWorking(false);
    }
    if (r?.success) {
      toast.success(
        (r as { msg?: string }).msg || t("success", { defaultValue: "OK" }),
      );
      setPendingBulk(null);
      if (action === "deleteAll") {
        // The group itself stays — but every client is gone.
        setBulkGroup((g) =>
          g && g.id === id ? { ...g, clientCount: 0 } : g,
        );
      }
      void load();
    } else {
      toast.error(
        (r as { msg?: string } | null)?.msg ||
          t("fail", { defaultValue: "Error" }),
      );
    }
  };

  /**
   * Apply every section the user touched. Each section maps to its own bulk
   * endpoint, but the user only sees a single Save button.
   */
  const submitAll = async () => {
    if (!bulkGroup) return;
    const name = form.name.trim();
    if (!name) {
      toast.error(t("pages.groups.enterGroupName"));
      return;
    }

    const id = bulkGroup.id;
    const nameChanged =
      name !== bulkGroup.name ||
      form.description.trim() !== bulkGroup.description;
    const noClientChanges =
      bulkGroup.clientCount < 1 ||
      (!expiryTouched &&
        !trafficTouched &&
        !hwidTouched &&
        !ipTouched &&
        !inboundsTouched);
    if (!nameChanged && noClientChanges) {
      toast.error(t("pages.groups.noChangesToApply"));
      return;
    }

    setSaving(true);
    const errors: string[] = [];

    const callBulk = async (
      path: string,
      body: unknown,
      label: string,
    ): Promise<boolean> => {
      try {
        const r = await postJson<unknown>(panel(path), body, true);
        if (r.success) return true;
        errors.push(
          (r as { msg?: string }).msg || `${label}: ${t("fail", { defaultValue: "Error" })}`,
        );
        return false;
      } catch {
        errors.push(`${label}: ${t("fail", { defaultValue: "Error" })}`);
        return false;
      }
    };

    try {
      if (nameChanged) {
        await callBulk(
          `group/update/${id}`,
          { name, description: form.description.trim() },
          t("pages.groups.editGroup"),
        );
      }
      if (expiryTouched && bulkGroup.clientCount > 0) {
        const ts = expiryValue ? new Date(expiryValue).getTime() : 0;
        if (expiryValue && isNaN(ts)) {
          errors.push(
            t("pages.groups.invalidDate", { defaultValue: "Invalid date" }),
          );
        } else {
          await callBulk(
            `group/${id}/bulk/setExpiry`,
            { expiryTime: ts },
            t("pages.groups.expiryDate", { defaultValue: "Expiry date" }),
          );
        }
      }
      if (trafficTouched && bulkGroup.clientCount > 0) {
        await callBulk(
          `group/${id}/bulk/setTrafficLimit`,
          { totalGB: Math.max(0, Math.floor(trafficGB)) },
          t("pages.groups.trafficLimitGB", {
            defaultValue: "Traffic limit (GB)",
          }),
        );
      }
      if (hwidTouched && bulkGroup.clientCount > 0) {
        await callBulk(
          `group/${id}/bulk/setHwidLimit`,
          {
            maxHwid: Math.max(0, Math.floor(Number(hwidForm.maxHwid)) || 0),
            enabled: hwidForm.enabled,
          },
          t("hwidSettings"),
        );
      }
      if (ipTouched && bulkGroup.clientCount > 0) {
        await callBulk(
          `group/${id}/bulk/setIPLimit`,
          {
            maxIPs: Math.max(0, Math.floor(ipForm.maxIPs)) || 0,
            enabled: ipForm.enabled,
          },
          t("pages.clients.ipLimitTitle", { defaultValue: "IP limit" }),
        );
      }
      if (bundleMode && bundlesTouched && bulkGroup.clientCount > 0) {
        await callBulk(
          `group/${id}/bulk/assignBundles`,
          { bundleIds: Object.keys(bundleSel).filter((k) => bundleSel[Number(k)]).map(Number), mode: "replace" },
          t("pages.groups.assignBundles", { defaultValue: "Bundles" }),
        );
      }
      if (!bundleMode && inboundsTouched && bulkGroup.clientCount > 0) {
        const ordered = inboundOrder.filter((iid) => inboundIds[iid]);
        await callBulk(
          `group/${id}/bulk/assignInbounds`,
          { inboundIds: ordered, mode: "replace" },
          t("pages.groups.assignInbounds"),
        );
      }
    } finally {
      setSaving(false);
    }

    if (errors.length === 0) {
      toast.success(
        t("pages.groups.updateSuccess", {
          defaultValue: "Group updated successfully",
        }),
      );
      // Keep the modal open for further tweaks, but reset "touched" markers and
      // reflect the new group name/description in the open header.
      if (bulkGroup) {
        setBulkGroup({
          ...bulkGroup,
          name,
          description: form.description.trim(),
        });
      }
      setBundlesTouched(false);
      setExpiryTouched(false);
      setTrafficTouched(false);
      setHwidTouched(false);
      setIpTouched(false);
      setInboundsTouched(false);
      void load();
    } else {
      toast.error(errors.join("\n"));
      void load();
    }
  };

  const hasPendingChanges = useMemo(() => {
    if (!bulkGroup) return false;
    const name = form.name.trim();
    const nameChanged =
      name !== bulkGroup.name ||
      form.description.trim() !== bulkGroup.description;
    return (
      nameChanged ||
      expiryTouched ||
      trafficTouched ||
      hwidTouched ||
      ipTouched ||
      inboundsTouched ||
      bundlesTouched
    );
  }, [
    bulkGroup,
    form.name,
    form.description,
    expiryTouched,
    trafficTouched,
    hwidTouched,
    ipTouched,
    inboundsTouched,
    bundlesTouched,
  ]);

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("menu.groups")}
        icon={Building2}
        iconTone="warning"
        actions={
          <>
            <Button variant="secondary" onClick={openAdd} className="!gap-2">
              <Plus size={16} />
              {t("pages.groups.addGroup")}
            </Button>
          </>
        }
      />
      <Reveal>
        <Surface padding="none" className="overflow-hidden">
          {loading && !rows.length ? (
            <div className="grid min-h-48 place-items-center">
              <Spinner size={32} />
            </div>
          ) : !rows.length ? (
            <div className="grid min-h-48 place-items-center px-4 py-12">
              <div className="flex flex-col items-center gap-3 text-center">
                <IconTile icon={Building2} tone="neutral" size="lg" />
                <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
              </div>
            </div>
          ) : (
            <div className="panel-data-table overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                    <th className="p-3">{t("pages.groups.name")}</th>
                    <th className="p-3">{t("pages.groups.groupDescription")}</th>
                    <th className="p-3">{t("pages.groups.clientCount")}</th>
                    <th className="p-3 w-44">{t("pages.groups.operate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--border)] text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
                    >
                      <td className="p-3 text-[var(--fg)]">{r.name}</td>
                      <td
                        className="p-3 max-w-[240px] truncate"
                        title={r.description}
                      >
                        {r.description || "—"}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {t("pages.groups.clientDisplay", {
                          count: r.clientCount,
                        })}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="secondary"
                            className="!p-2"
                            onClick={() => openEdit(r)}
                            aria-label={t("pages.groups.editGroup")}
                            title={t("pages.groups.editGroup")}
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            variant="danger"
                            className="!p-2"
                            onClick={() => setDeleteId(r.id)}
                            aria-label={t("delete")}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Surface>
      </Reveal>

      {/* Edit modal — mirrors the client edit modal for a familiar UX. */}
      <Modal
        open={bulkGroup != null}
        onClose={closeEdit}
        title={
          bulkGroup
            ? `${t("pages.groups.editGroupTitle", { defaultValue: "Edit group" })} — ${bulkGroup.name}`
            : t("pages.groups.editGroupTitle", { defaultValue: "Edit group" })
        }
        width={960}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={saving}
              onClick={closeEdit}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={saving}
              disabled={!hasPendingChanges}
              onClick={() => void submitAll()}
            >
              {t("save", { defaultValue: "Save" })}
            </Button>
          </div>
        }
      >
        {bulkGroup ? (
          <div
            className={
              "relative flex flex-col overflow-visible rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
            }
          >
            <div className="flex flex-col gap-4 p-5">
              {/* --- Header strip: state hint + action icons --- */}
              <div className="space-y-3 border-b border-[var(--border)] pb-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-xs text-[var(--fg-subtle)]">
                      {t("pages.groups.editHintAppliesToAll", {
                        defaultValue:
                          "Changes here will be applied to every client in this group.",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-0.5 lg:pt-0.5">
                    <IconButton
                      type="button"
                      label={t("pages.groups.actionEnableAll", {
                        defaultValue: "Enable all clients",
                      })}
                      disabled={bulkGroup.clientCount < 1 || bulkWorking}
                      className="!text-emerald-600 hover:!text-emerald-700 dark:!text-emerald-400 dark:hover:!text-emerald-300"
                      onClick={() => startBulkConfirm("enable")}
                    >
                      <Power size={18} />
                    </IconButton>
                    <IconButton
                      type="button"
                      label={t("pages.groups.actionDisableAll", {
                        defaultValue: "Disable all clients",
                      })}
                      disabled={bulkGroup.clientCount < 1 || bulkWorking}
                      onClick={() => startBulkConfirm("disable")}
                    >
                      <ShieldOff size={18} />
                    </IconButton>
                    <IconButton
                      type="button"
                      label={t("pages.groups.actionResetTraffic", {
                        defaultValue: "Reset traffic for all clients",
                      })}
                      disabled={bulkGroup.clientCount < 1 || bulkWorking}
                      onClick={() => startBulkConfirm("reset")}
                    >
                      <RotateCcw size={18} />
                    </IconButton>
                    <IconButton
                      type="button"
                      label={t("pages.groups.actionClearHwid", {
                        defaultValue: "Clear HWID for all clients",
                      })}
                      disabled={bulkGroup.clientCount < 1 || bulkWorking}
                      onClick={() => startBulkConfirm("clearHwid")}
                    >
                      <Shield size={18} />
                    </IconButton>
                    <IconButton
                      type="button"
                      label={t("pages.groups.actionDeleteAll", {
                        defaultValue: "Delete all clients in group",
                      })}
                      disabled={bulkGroup.clientCount < 1 || bulkWorking}
                      className="!text-red-600 hover:!text-red-700 dark:!text-red-400 dark:hover:!text-red-300"
                      onClick={() => startBulkConfirm("deleteAll")}
                    >
                      <Trash2 size={18} />
                    </IconButton>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* === LEFT column: identity + group data === */}
                <div className="space-y-5 text-sm">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={User}>
                      {t("pages.groups.sectionIdentity", {
                        defaultValue: "Identification",
                      })}
                    </SectionLabel>
                    <div className="space-y-4">
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="grp-edit-name"
                        >
                          {t("pages.groups.groupName", {
                            defaultValue: "Group name",
                          })}{" "}
                          *
                        </label>
                        <Input
                          id="grp-edit-name"
                          value={form.name}
                          maxLength={30}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              name: e.target.value.slice(0, 30),
                            }))
                          }
                          placeholder={t("pages.groups.enterGroupName")}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="grp-edit-desc"
                        >
                          {t("pages.groups.groupDescription")}
                        </label>
                        <TextArea
                          id="grp-edit-desc"
                          value={form.description}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              description: e.target.value,
                            }))
                          }
                          placeholder={t(
                            "pages.groups.enterGroupDescription",
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={Clock}>
                      {t("pages.groups.sectionGroupData", {
                        defaultValue: "Group data",
                      })}
                    </SectionLabel>
                    <ul className="space-y-2.5 text-xs">
                      <li className="flex flex-wrap justify-between gap-2">
                        <span className="text-[var(--fg-muted)]">
                          {t("pages.groups.dataClientCount", {
                            defaultValue: "Clients in group",
                          })}
                        </span>
                        <span className="text-[var(--fg)]">
                          {t("pages.groups.clientDisplay", {
                            count: bulkGroup.clientCount,
                          })}
                        </span>
                      </li>
                      <li className="flex flex-wrap justify-between gap-2">
                        <span className="text-[var(--fg-muted)]">
                          {t("pages.groups.dataCreated", {
                            defaultValue: "Created",
                          })}
                        </span>
                        <span className="text-[var(--fg)]">
                          {formatGroupDateTime(bulkGroup.createdAt, "—")}
                        </span>
                      </li>
                      <li className="flex flex-wrap justify-between gap-2">
                        <span className="text-[var(--fg-muted)]">
                          {t("pages.groups.dataUpdated", {
                            defaultValue: "Updated",
                          })}
                        </span>
                        <span className="text-[var(--fg)]">
                          {formatGroupDateTime(bulkGroup.updatedAt, "—")}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* === RIGHT column: expiry, traffic, inbounds, HWID, IP === */}
                <div className="space-y-5 text-sm">
                  {/* Expiry */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={Calendar}>
                      {t("pages.groups.expiryDate", {
                        defaultValue: "Expiry date",
                      })}
                    </SectionLabel>
                    <Input
                      id="grp-expiry"
                      type="datetime-local"
                      value={expiryValue}
                      onChange={(e) => {
                        setExpiryTouched(true);
                        setExpiryValue(e.target.value);
                      }}
                    />
                    <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                      {t("pages.groups.expiryHint", {
                        defaultValue: "Leave blank for unlimited",
                      })}
                    </p>
                    <ConsistencyHint
                      loading={effectiveLoading}
                      clientCount={bulkGroup.clientCount}
                      consistent={effective?.expiryTime != null}
                      t={t}
                    />
                  </div>

                  {/* Traffic */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={Activity}>
                      {t("pages.groups.trafficLimitGB", {
                        defaultValue: "Traffic limit (GB)",
                      })}
                    </SectionLabel>
                    <Input
                      id="grp-traffic"
                      type="number"
                      min={0}
                      step={1}
                      value={String(trafficGB)}
                      onChange={(e) => {
                        setTrafficTouched(true);
                        setTrafficGB(
                          Math.max(0, parseFloat(e.target.value) || 0),
                        );
                      }}
                    />
                    <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                      {t("pages.groups.trafficLimitHint", {
                        defaultValue: "0 = unlimited",
                      })}
                    </p>
                    <ConsistencyHint
                      loading={effectiveLoading}
                      clientCount={bulkGroup.clientCount}
                      consistent={effective?.totalGB != null}
                      t={t}
                    />
                  </div>

                  {/* Bundles (bundle scheme) */}
                  {bundleMode ? (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                      <SectionLabel icon={Layers}>{t("pages.groups.assignBundles", { defaultValue: "Bundles" })}</SectionLabel>
                      {bundleOptions.length === 0 ? (
                        <p className="text-xs text-[var(--fg-subtle)]">{t("pages.clients.noBundles", { defaultValue: "No bundles yet: create one on the Bundles page." })}</p>
                      ) : (
                        <BundlePicker
                          label={t("pages.groups.assignBundles", { defaultValue: "Bundles" })}
                          options={bundleOptions}
                          selected={bundleSel}
                          onToggle={(id) => {
                            setBundlesTouched(true);
                            setBundleSel((m) => ({ ...m, [id]: !m[id] }));
                          }}
                          countLabel={(n) => t("pages.clients.bundleMembers", { defaultValue: "{{n}} clients", n })}
                        />
                      )}
                      <p className="mt-2 text-xs text-[var(--fg-subtle)]">
                        {t("pages.groups.assignBundlesHint", { defaultValue: "Saving sets these bundles for every client of the group. Clients' personal access from the API is kept." })}
                      </p>
                      <ConsistencyHint loading={effectiveLoading} clientCount={bulkGroup.clientCount} consistent={effective?.bundleIdsConsistent === true} t={t} />
                    </div>
                  ) : null}

                  {!bundleMode ? (
                  <>
                  {/* Inbounds */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={Layers}>
                      {t("pages.groups.assignInbounds")}
                    </SectionLabel>
                    {inbounds.length === 0 ? (
                      <p className="text-xs text-[var(--fg-subtle)]">
                        {t("noData")}
                      </p>
                    ) : (
                      <div className="max-h-52 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div
                          className="flex flex-wrap gap-2"
                          role="group"
                          aria-label={t("pages.groups.assignInbounds")}
                        >
                          {inbounds.map((ib) => (
                            <GroupInboundCapsule
                              key={ib.id}
                              selected={!!inboundIds[ib.id]}
                              onToggle={() => toggleInboundId(ib.id)}
                              label={ib.remark}
                              sublabel={`${ib.protocol} · ${ib.port}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {inboundOrder.length >= 2 ? (
                      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                          {t("pages.clients.subscriptionInboundOrder", {
                            defaultValue: "Subscription order",
                          })}
                        </p>
                        {inboundOrder.map((iid, idx) => {
                          const ib = inbounds.find((x) => x.id === iid);
                          const label =
                            ib?.remark?.trim() || `Inbound ${iid}`;
                          return (
                            <div
                              key={iid}
                              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
                            >
                              <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg)]">
                                {label}
                              </span>
                              <IconButton
                                type="button"
                                label={t("pages.clients.moveInboundUp", {
                                  defaultValue: "Move up",
                                })}
                                disabled={idx === 0}
                                onClick={() => moveInboundOrder(idx, -1)}
                              >
                                <ArrowUp size={14} />
                              </IconButton>
                              <IconButton
                                type="button"
                                label={t("pages.clients.moveInboundDown", {
                                  defaultValue: "Move down",
                                })}
                                disabled={idx >= inboundOrder.length - 1}
                                onClick={() => moveInboundOrder(idx, 1)}
                              >
                                <ArrowDown size={14} />
                              </IconButton>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-[var(--fg-subtle)]">
                      {t("pages.groups.assignInboundsHint")}
                    </p>
                    <ConsistencyHint
                      loading={effectiveLoading}
                      clientCount={bulkGroup.clientCount}
                      consistent={effective?.inboundIdsConsistent === true}
                      t={t}
                    />
                  </div>

                  </>
                  ) : null}

                  {/* HWID */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={Shield}>
                      {t("hwidSettings")}
                    </SectionLabel>
                    <CheckboxField
                      checked={hwidForm.enabled}
                      onChange={(e) => {
                        setHwidTouched(true);
                        setHwidForm((f) => ({ ...f, enabled: e.target.checked }));
                      }}
                      label={t("hwidEnabled")}
                    />
                    <div className="mt-3">
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="grp-hwid"
                      >
                        {t("maxHwid")}
                      </label>
                      <Input
                        id="grp-hwid"
                        type="number"
                        min={0}
                        step={1}
                        disabled={!hwidForm.enabled}
                        value={String(hwidForm.maxHwid)}
                        onChange={(e) => {
                          setHwidTouched(true);
                          setHwidForm((f) => ({
                            ...f,
                            maxHwid: Math.max(
                              0,
                              Math.floor(Number(e.target.value) || 0),
                            ),
                          }));
                        }}
                      />
                      <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                        {t("pages.clients.maxHwidDesc")}
                      </p>
                    </div>
                    <ConsistencyHint
                      loading={effectiveLoading}
                      clientCount={bulkGroup.clientCount}
                      consistent={
                        effective?.hwidEnabled != null &&
                        effective?.maxHwid != null
                      }
                      t={t}
                    />
                  </div>

                  {/* IP Limit */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <SectionLabel icon={Users}>
                      {t("pages.clients.ipLimitTitle", {
                        defaultValue: "IP limit",
                      })}
                    </SectionLabel>
                    <CheckboxField
                      checked={ipForm.enabled}
                      onChange={(e) => {
                        setIpTouched(true);
                        setIpForm((f) => ({ ...f, enabled: e.target.checked }));
                      }}
                      label={t("pages.groups.ipLimitEnabled", {
                        defaultValue: "Limit concurrent IPs",
                      })}
                    />
                    <div className="mt-3">
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="grp-ip"
                      >
                        {t("pages.groups.maxIPs", {
                          defaultValue: "Max unique IPs",
                        })}
                      </label>
                      <Input
                        id="grp-ip"
                        type="number"
                        min={0}
                        disabled={!ipForm.enabled}
                        value={String(ipForm.maxIPs)}
                        onChange={(e) => {
                          setIpTouched(true);
                          setIpForm((f) => ({
                            ...f,
                            maxIPs: Math.max(
                              0,
                              Math.floor(Number(e.target.value) || 0),
                            ),
                          }));
                        }}
                      />
                    </div>
                    <ConsistencyHint
                      loading={effectiveLoading}
                      clientCount={bulkGroup.clientCount}
                      consistent={
                        effective?.ipLimitEnabled != null &&
                        effective?.maxIPs != null
                      }
                      t={t}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* "Add group" modal — minimal name + description. */}
      <Modal
        open={addOpen}
        onClose={() => {
          if (!addSubmitting) setAddOpen(false);
        }}
        title={t("pages.groups.addGroup")}
        width={480}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={addSubmitting}
              onClick={() => setAddOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={addSubmitting}
              onClick={() => void submitAdd()}
            >
              {t("create")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
              htmlFor="grp-name"
            >
              {t("pages.groups.groupName", { defaultValue: "Group name" })} *
            </label>
            <Input
              id="grp-name"
              value={addForm.name}
              onChange={(e) =>
                setAddForm((f) => ({
                  ...f,
                  name: e.target.value.slice(0, 30),
                }))
              }
              placeholder={t("pages.groups.enterGroupName")}
              maxLength={30}
              autoComplete="off"
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
              htmlFor="grp-desc"
            >
              {t("pages.groups.groupDescription")}
            </label>
            <TextArea
              id="grp-desc"
              value={addForm.description}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder={t("pages.groups.enterGroupDescription")}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId != null}
        title={t("pages.groups.deleteConfirm")}
        description={t("pages.groups.deleteConfirmText")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onCancel={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        danger
        loading={deleting}
      />

      <ConfirmDialog
        open={pendingBulk != null}
        title={t("sure")}
        description={
          pendingBulk ? pendingBulkDescription(t, pendingBulk) : undefined
        }
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onCancel={() => setPendingBulk(null)}
        onConfirm={runPendingBulk}
        danger={pendingBulk?.action === "deleteAll"}
        loading={bulkWorking}
      />
    </PageScaffold>
  );
}
