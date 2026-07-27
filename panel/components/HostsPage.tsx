"use client";

import { ArrowDown, ArrowUp, List, Plus, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  CheckboxField,
  Drawer,
  IconButton,
  IconTile,
  Input,
  Modal,
  Reveal,
  SelectNative,
  Spinner,
  Switch,
  TabPanels,
  Tabs,
  type TabItem,
  useToast,
} from "@/components/ui";

type InboundOption = {
  id: number;
  remark: string;
  protocol: string;
  port: number;
};

type HostRow = {
  id: number;
  name: string;
  address: string;
  port: number;
  protocol: string;
  remark: string;
  enable: boolean;
  subscriptionApplyMode?: string;
  inboundIds?: number[];
  subscriptionSni?: string;
  subscriptionHttpHost?: string;
  subscriptionPath?: string;
  subscriptionAlpn?: string;
  subscriptionFingerprint?: string;
  subscriptionAllowInsecure?: boolean | null;
  subscriptionSecurity?: string;
};

type HostInboundDetailBindingsFragment = {
  id: number;
  remark: string;
  protocol: string;
  port: number;
  nodeIds?: number[];
  nodeBindings?: Array<{
    nodeId: number;
    nodeName?: string;
    publishedAddress?: string;
    publishedPort?: number;
    includeInSubscription?: boolean;
    subscriptionRemarkSuffix?: string;
    serverDescription?: string;
  }>;
};

type HostNodeBindingFormRow = {
  nodeId: number;
  nodeName?: string;
  publishedAddress: string;
  publishedPort: string;
  includeInSubscription: boolean;
  subscriptionRemarkSuffix: string;
  serverDescription: string;
};

function hostInboundDetailToBindingRows(
  ib: HostInboundDetailBindingsFragment,
): HostNodeBindingFormRow[] {
  const nb = (ib.nodeBindings ?? []).filter((b) => (b.nodeId ?? 0) > 0);
  if (nb.length > 0) {
    return nb.map((b) => {
      const nn = (b.nodeName ?? "").trim();
      return {
        nodeId: b.nodeId,
        ...(nn !== "" ? { nodeName: nn } : {}),
        publishedAddress: (b.publishedAddress ?? "").trim(),
        publishedPort: String(b.publishedPort ?? 0),
        includeInSubscription: b.includeInSubscription !== false,
        subscriptionRemarkSuffix: (b.subscriptionRemarkSuffix ?? "").trim(),
        serverDescription: (b.serverDescription ?? "").trim(),
      };
    });
  }
  return (ib.nodeIds ?? [])
    .filter((id) => id > 0)
    .map((nodeId) => ({
      nodeId,
      publishedAddress: "",
      publishedPort: "0",
      includeInSubscription: true,
      subscriptionRemarkSuffix: "",
      serverDescription: "",
    }));
}

type HostFormTab = "general" | "advanced";

type AllowInsecureUi = "inherit" | "on" | "off";

function allowInsecureFromApi(v: unknown): AllowInsecureUi {
  if (v === true) return "on";
  if (v === false) return "off";
  return "inherit";
}

function allowInsecureToApi(s: AllowInsecureUi): boolean | null {
  if (s === "on") return true;
  if (s === "off") return false;
  return null;
}

type SecurityOverrideUi = "inherit" | "tls" | "none";

type HostTlsFormSlice = {
  subscriptionSni: string;
  subscriptionHttpHost: string;
  subscriptionPath: string;
  subscriptionAlpn: string;
  subscriptionFingerprint: string;
  subscriptionAllowInsecure: AllowInsecureUi;
  subscriptionSecurity: SecurityOverrideUi;
};

const defaultTlsForm = (): HostTlsFormSlice => ({
  subscriptionSni: "",
  subscriptionHttpHost: "",
  subscriptionPath: "",
  subscriptionAlpn: "",
  subscriptionFingerprint: "",
  subscriptionAllowInsecure: "inherit",
  subscriptionSecurity: "inherit",
});

function HostSubscriptionTlsSection({
  values,
  onChange,
}: {
  values: HostTlsFormSlice;
  onChange: (patch: Partial<HostTlsFormSlice>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Surface padding="md" className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        {t("pages.hosts.subscriptionTlsSection")}
      </p>
      <p className="text-xs leading-snug text-[var(--fg-muted)]">
        {t("pages.hosts.subscriptionTlsSectionHint")}
      </p>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionSni")}
        </span>
        <Input
          value={values.subscriptionSni}
          onChange={(e) =>
            onChange({ subscriptionSni: e.target.value })
          }
          placeholder={t("pages.hosts.subscriptionSniPh")}
          autoComplete="off"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionHttpHost")}
        </span>
        <Input
          value={values.subscriptionHttpHost}
          onChange={(e) =>
            onChange({ subscriptionHttpHost: e.target.value })
          }
          placeholder={t("pages.hosts.subscriptionHttpHostPh")}
          autoComplete="off"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionPath")}
        </span>
        <Input
          value={values.subscriptionPath}
          onChange={(e) =>
            onChange({ subscriptionPath: e.target.value })
          }
          placeholder={t("pages.hosts.subscriptionPathPh")}
          autoComplete="off"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionAlpn")}
        </span>
        <Input
          value={values.subscriptionAlpn}
          onChange={(e) =>
            onChange({ subscriptionAlpn: e.target.value })
          }
          placeholder={t("pages.hosts.subscriptionAlpnPh")}
          autoComplete="off"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionFingerprint")}
        </span>
        <Input
          value={values.subscriptionFingerprint}
          onChange={(e) =>
            onChange({ subscriptionFingerprint: e.target.value })
          }
          placeholder={t("pages.hosts.subscriptionFingerprintPh")}
          autoComplete="off"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionAllowInsecure")}
        </span>
        <SelectNative
          value={values.subscriptionAllowInsecure}
          onChange={(e) =>
            onChange({
              subscriptionAllowInsecure: e.target.value as AllowInsecureUi,
            })
          }
        >
          <option value="inherit">
            {t("pages.hosts.subscriptionAllowInsecureInherit")}
          </option>
          <option value="on">{t("pages.hosts.subscriptionAllowInsecureOn")}</option>
          <option value="off">{t("pages.hosts.subscriptionAllowInsecureOff")}</option>
        </SelectNative>
        <span className="text-[11px] text-[var(--fg-subtle)]">
          {t("pages.hosts.subscriptionAllowInsecureHint")}
        </span>
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--fg-muted)]">
          {t("pages.hosts.subscriptionSecurity", { defaultValue: "Force TLS in share link" })}
        </span>
        <SelectNative
          value={values.subscriptionSecurity}
          onChange={(e) =>
            onChange({
              subscriptionSecurity: e.target.value as SecurityOverrideUi,
            })
          }
        >
          <option value="inherit">
            {t("pages.hosts.subscriptionSecurityInherit", { defaultValue: "Inherit from inbound" })}
          </option>
          <option value="tls">
            {t("pages.hosts.subscriptionSecurityTls", { defaultValue: "Force TLS (security=tls)" })}
          </option>
          <option value="none">
            {t("pages.hosts.subscriptionSecurityNone", { defaultValue: "Force none (security=none)" })}
          </option>
        </SelectNative>
        <span className="text-[11px] text-[var(--fg-subtle)]">
          {t("pages.hosts.subscriptionSecurityHint", {
            defaultValue:
              "Use when a TLS terminator (Caddy/HAProxy/nginx) fronts Xray: Xray runs with security=none but the share link must advertise security=tls (or vice versa).",
          })}
        </span>
      </label>
    </Surface>
  );
}

function securityFromApi(v: unknown): SecurityOverrideUi {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "tls") return "tls";
    if (s === "none") return "none";
  }
  return "inherit";
}

function securityToApi(s: SecurityOverrideUi): string {
  return s === "inherit" ? "" : s;
}

function hostTlsFromRow(o: HostRow): HostTlsFormSlice {
  return {
    subscriptionSni: (o.subscriptionSni ?? "").trim(),
    subscriptionHttpHost: (o.subscriptionHttpHost ?? "").trim(),
    subscriptionPath: (o.subscriptionPath ?? "").trim(),
    subscriptionAlpn: (o.subscriptionAlpn ?? "").trim(),
    subscriptionFingerprint: (o.subscriptionFingerprint ?? "").trim(),
    subscriptionAllowInsecure: allowInsecureFromApi(
      o.subscriptionAllowInsecure,
    ),
    subscriptionSecurity: securityFromApi(o.subscriptionSecurity),
  };
}

function hostBindingRowsToPayload(rows: HostNodeBindingFormRow[]) {
  return rows
    .filter((r) => r.nodeId > 0)
    .map((r) => ({
      nodeId: r.nodeId,
      publishedAddress: r.publishedAddress.trim(),
      publishedPort: Math.max(0, Math.floor(Number(r.publishedPort)) || 0),
      includeInSubscription: r.includeInSubscription,
      subscriptionRemarkSuffix: r.subscriptionRemarkSuffix.trim(),
      serverDescription: r.serverDescription.trim(),
    }));
}

export function HostsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState<HostRow[]>([]);
  const [inbounds, setInbounds] = useState<InboundOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    address: "",
    port: "0",
    protocol: "",
    remark: "",
    enable: true,
    subscriptionApplyMode: "replace",
    ...defaultTlsForm(),
  });
  const [inboundPick, setInboundPick] = useState<Record<number, boolean>>({});

  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    address: "",
    port: "0",
    protocol: "",
    remark: "",
    enable: true,
    subscriptionApplyMode: "replace",
    ...defaultTlsForm(),
  });
  const [editInboundPick, setEditInboundPick] = useState<
    Record<number, boolean>
  >({});
  const [hostSubDrafts, setHostSubDrafts] = useState<
    Record<number, HostNodeBindingFormRow[]>
  >({});
  const [hostSubLoaded, setHostSubLoaded] = useState(false);
  const [hostSubLoading, setHostSubLoading] = useState(false);
  const [togglingEnableId, setTogglingEnableId] = useState<number | null>(null);
  const [addModalTab, setAddModalTab] = useState<HostFormTab>("general");
  const [editModalTab, setEditModalTab] = useState<HostFormTab>("general");
  const [deleteTarget, setDeleteTarget] = useState<HostRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [addInboundPickerOpen, setAddInboundPickerOpen] = useState(false);
  const [editInboundPickerOpen, setEditInboundPickerOpen] = useState(false);
  const [addInboundSearch, setAddInboundSearch] = useState("");
  const [editInboundSearch, setEditInboundSearch] = useState("");

  const loadInbounds = useCallback(async () => {
    const r = await getJson<InboundOption[]>(panel("api/inbounds/list"));
    if (r.success && Array.isArray(r.obj)) {
      setInbounds(
        (r.obj as InboundOption[]).map((x) => ({
          id: x.id,
          remark: x.remark || `Inbound ${x.id}`,
          protocol: x.protocol,
          port: x.port,
        })),
      );
    } else {
      setInbounds([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [hostsRes] = await Promise.all([
      getJson<HostRow[]>(panel("host/list")),
      loadInbounds(),
    ]);
    setLoading(false);
    if (hostsRes.success && Array.isArray(hostsRes.obj)) {
      setRows(hostsRes.obj as HostRow[]);
    } else {
      setRows([]);
      if (!hostsRes.success) {
        toast.error(t("pages.hosts.loadError"));
      }
    }
  }, [loadInbounds, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const inboundLabel = (id: number) => {
    const ib = inbounds.find((x) => x.id === id);
    if (!ib) return `#${id}`;
    return `${ib.remark} (${ib.protocol}:${ib.port})`;
  };

  const filterInboundOptions = useCallback((q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return inbounds;
    return inbounds.filter((ib) =>
      `${ib.remark} ${ib.protocol} ${ib.port}`.toLowerCase().includes(s),
    );
  }, [inbounds]);

  const hostFormTabItems = useMemo<TabItem<HostFormTab>[]>(
    () => [
      { id: "general", label: t("pages.hosts.tabGeneral") },
      { id: "advanced", label: t("pages.hosts.tabAdvanced") },
    ],
    [t],
  );

  const refreshHostSubscriptionDrafts = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) {
        setHostSubDrafts({});
        setHostSubLoaded(false);
        return;
      }
      setHostSubLoading(true);
      try {
        const next: Record<number, HostNodeBindingFormRow[]> = {};
        await Promise.all(
          ids.map(async (id) => {
            const r = await getJson<HostInboundDetailBindingsFragment>(
              panel(`api/inbounds/get/${id}`),
            );
            if (r.success && r.obj && typeof r.obj === "object") {
              next[id] = hostInboundDetailToBindingRows(
                r.obj as HostInboundDetailBindingsFragment,
              );
            } else {
              next[id] = [];
            }
          }),
        );
        setHostSubDrafts(next);
        setHostSubLoaded(true);
      } catch {
        toast.error(t("pages.hosts.subscriptionEndpointsLoadError"));
      } finally {
        setHostSubLoading(false);
      }
    },
    [t, toast],
  );

  useEffect(() => {
    if (!editOpen || editId == null) return;
    const ids = Object.entries(editInboundPick)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
      .filter((n) => n > 0);
    if (ids.length === 0) {
      setHostSubDrafts({});
      setHostSubLoaded(false);
      return;
    }
    void refreshHostSubscriptionDrafts(ids);
    // Intentionally omit editInboundPick: checkbox changes must not refetch drafts (user uses Refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editInboundPick excluded by design
  }, [editOpen, editId, refreshHostSubscriptionDrafts]);

  const openAdd = () => {
    setForm({
      name: "",
      address: "",
      port: "0",
      protocol: "",
      remark: "",
      enable: true,
      subscriptionApplyMode: "replace",
      ...defaultTlsForm(),
    });
    setInboundPick({});
    setAddInboundSearch("");
    setAddInboundPickerOpen(false);
    setAddModalTab("general");
    setAddOpen(true);
    void loadInbounds();
  };

  const submitAdd = async () => {
    const name = form.name.trim();
    const address = form.address.trim();
    if (!name || !address) {
      toast.error(t("pages.hosts.enterHostNameAndAddress"));
      return;
    }
    const port = Math.max(0, Math.floor(Number(form.port)) || 0);
    const inboundIds = Object.entries(inboundPick)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
      .filter((n) => n > 0);

    setSubmitting(true);
    try {
      const body = {
        name,
        address,
        port,
        protocol: form.protocol.trim(),
        remark: form.remark.trim(),
        enable: form.enable,
        subscriptionApplyMode: form.subscriptionApplyMode || "replace",
        subscriptionSni: form.subscriptionSni.trim(),
        subscriptionHttpHost: form.subscriptionHttpHost.trim(),
        subscriptionPath: form.subscriptionPath.trim(),
        subscriptionAlpn: form.subscriptionAlpn.trim(),
        subscriptionFingerprint: form.subscriptionFingerprint.trim(),
        subscriptionAllowInsecure: allowInsecureToApi(
          form.subscriptionAllowInsecure,
        ),
        subscriptionSecurity: securityToApi(form.subscriptionSecurity),
        ...(inboundIds.length > 0 ? { inboundIds } : {}),
      };
      const r = await postJson<HostRow>(panel("host/add"), body, true);
      if (r.success) {
        toast.success(
          (r as { msg?: string }).msg || t("pages.hosts.addSuccess"),
        );
        setAddOpen(false);
        void load();
      } else {
        toast.error(
          (r as { msg?: string }).msg || t("pages.hosts.addError"),
        );
      }
    } catch {
      toast.error(t("pages.hosts.addError"));
    } finally {
      setSubmitting(false);
    }
  };

  const patchHostEnable = useCallback(
    async (row: HostRow, next: boolean) => {
      setTogglingEnableId(row.id);
      try {
        const r = await postJson(
          panel(`host/update/${row.id}`),
          { enable: next },
          true,
        );
        if (r.success) {
          setRows((prev) =>
            prev.map((x) => (x.id === row.id ? { ...x, enable: next } : x)),
          );
        } else {
          toast.error(
            (r as { msg?: string }).msg || t("pages.hosts.updateError"),
          );
        }
      } catch {
        toast.error(t("pages.hosts.updateError"));
      } finally {
        setTogglingEnableId(null);
      }
    },
    [t, toast],
  );

  const openEdit = async (row: HostRow) => {
    setHostSubDrafts({});
    setHostSubLoaded(false);
    setHostSubLoading(false);
    setEditModalTab("general");
    setEditId(row.id);
    setEditForm({
      name: row.name,
      address: row.address,
      port: String(row.port ?? 0),
      protocol: row.protocol ?? "",
      remark: row.remark ?? "",
      enable: row.enable !== false,
      subscriptionApplyMode: row.subscriptionApplyMode ?? "replace",
      ...hostTlsFromRow(row),
    });
    const pick: Record<number, boolean> = {};
    for (const id of row.inboundIds ?? []) {
      if (id > 0) pick[id] = true;
    }
    setEditInboundPick(pick);
    setEditInboundSearch("");
    setEditInboundPickerOpen(false);
    void loadInbounds();
    const r = await getJson<HostRow>(panel(`host/get/${row.id}`));
    if (r.success && r.obj && typeof r.obj === "object") {
      const o = r.obj as HostRow;
      setEditForm((f) => ({
        ...f,
        name: o.name,
        address: o.address,
        port: String(o.port ?? 0),
        protocol: o.protocol ?? "",
        remark: o.remark ?? "",
        enable: o.enable !== false,
        subscriptionApplyMode: o.subscriptionApplyMode ?? "replace",
        ...hostTlsFromRow(o),
      }));
      const p2: Record<number, boolean> = {};
      for (const id of o.inboundIds ?? []) {
        if (id > 0) p2[id] = true;
      }
      setEditInboundPick(p2);
    }
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (!editSubmitting) {
      setEditOpen(false);
      setEditId(null);
      setEditModalTab("general");
      setHostSubDrafts({});
      setHostSubLoaded(false);
      setHostSubLoading(false);
    }
  };

  const submitEdit = async () => {
    if (editId == null) return;
    const name = editForm.name.trim();
    const address = editForm.address.trim();
    if (!name || !address) {
      toast.error(t("pages.hosts.enterHostNameAndAddress"));
      return;
    }
    const port = Math.max(0, Math.floor(Number(editForm.port)) || 0);
    const inboundIds = Object.entries(editInboundPick)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
      .filter((n) => n > 0);

    setEditSubmitting(true);
    try {
      const body = {
        name,
        address,
        port,
        protocol: editForm.protocol.trim(),
        remark: editForm.remark.trim(),
        enable: editForm.enable,
        subscriptionApplyMode: editForm.subscriptionApplyMode || "replace",
        subscriptionSni: editForm.subscriptionSni.trim(),
        subscriptionHttpHost: editForm.subscriptionHttpHost.trim(),
        subscriptionPath: editForm.subscriptionPath.trim(),
        subscriptionAlpn: editForm.subscriptionAlpn.trim(),
        subscriptionFingerprint: editForm.subscriptionFingerprint.trim(),
        subscriptionAllowInsecure: allowInsecureToApi(
          editForm.subscriptionAllowInsecure,
        ),
        subscriptionSecurity: securityToApi(editForm.subscriptionSecurity),
        inboundIds,
      };
      const r = await postJson<HostRow>(
        panel(`host/update/${editId}`),
        body,
        true,
      );
      if (r.success) {
        let subBindingsOk = true;
        if (hostSubLoaded && editId != null) {
          const payload = {
            inbounds: inboundIds
              .map((iid) => ({
                inboundId: iid,
                nodeBindings: hostBindingRowsToPayload(
                  hostSubDrafts[iid] ?? [],
                ),
              }))
              .filter((x) => x.nodeBindings.length > 0),
          };
          if (payload.inbounds.length > 0) {
            const r2 = await postJson(
              panel(`host/subscription-bindings/${editId}`),
              payload,
              true,
            );
            if (!r2.success) {
              subBindingsOk = false;
              toast.error(
                (r2 as { msg?: string }).msg ||
                  t("pages.hosts.subscriptionBindingsSaveError"),
              );
            }
          }
        }
        if (subBindingsOk) {
          toast.success(
            (r as { msg?: string }).msg || t("pages.hosts.updateSuccess"),
          );
        }
        setEditOpen(false);
        setEditId(null);
        setEditModalTab("general");
        setHostSubDrafts({});
        setHostSubLoaded(false);
        setHostSubLoading(false);
        void load();
      } else {
        toast.error(
          (r as { msg?: string }).msg || t("pages.hosts.updateError"),
        );
      }
    } catch {
      toast.error(t("pages.hosts.updateError"));
    } finally {
      setEditSubmitting(false);
    }
  };

  const patchHostSubRow = (
    inboundId: number,
    nodeId: number,
    patch: Partial<Omit<HostNodeBindingFormRow, "nodeId">>,
  ) => {
    setHostSubDrafts((prev) => {
      const rows = prev[inboundId];
      if (!rows) return prev;
      return {
        ...prev,
        [inboundId]: rows.map((r) =>
          r.nodeId === nodeId ? { ...r, ...patch } : r,
        ),
      };
    });
  };

  const moveHostSubRow = (inboundId: number, idx: number, delta: number) => {
    setHostSubDrafts((prev) => {
      const rows = [...(prev[inboundId] ?? [])];
      const j = idx + delta;
      if (j < 0 || j >= rows.length) return prev;
      const a = rows[idx]!;
      const b = rows[j]!;
      rows[idx] = b;
      rows[j] = a;
      return { ...prev, [inboundId]: rows };
    });
  };

  const editSelectedInboundIds = () =>
    Object.entries(editInboundPick)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
      .filter((n) => n > 0);

  const confirmDeleteHost = async () => {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      const r = await postJson(
        panel(`host/del/${deleteTarget.id}`),
        {},
        true,
      );
      if (r.success) {
        toast.success(t("pages.hosts.deleteSuccess"));
        setDeleteTarget(null);
        void load();
      } else {
        toast.error(
          (r as { msg?: string }).msg || t("pages.hosts.deleteError"),
        );
      }
    } catch {
      toast.error(t("pages.hosts.deleteError"));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("pages.hosts.title")}
        icon={Server}
        iconTone="info"
        actions={
          <>
            <Button variant="secondary" onClick={openAdd} className="!gap-2">
              <Plus size={16} />
              {t("pages.hosts.addHost")}
            </Button>
            <SectionHelpModal
              titleKey="pages.hosts.helpModalTitle"
              paragraphKeys={[
                "pages.hosts.helpModalP1",
                "pages.hosts.helpModalP2",
                "pages.hosts.helpModalP3",
                "pages.hosts.helpModalP4",
              ]}
            />
          </>
        }
      />
      <Reveal>
      <Surface padding="none" className="overflow-hidden">
        {loading && !rows.length ? (
          <div className="grid min-h-48 place-items-center">
            <Spinner size={32} />
          </div>
        ) : rows.length === 0 ? (
          <div className="grid min-h-48 place-content-center gap-4 px-4 py-8 text-center text-sm text-[var(--fg-muted)]">
            <div className="flex flex-col items-center gap-3">
              <IconTile icon={Server} tone="neutral" size="lg" />
              <p>{t("noData")}</p>
            </div>
            <div>
              <Button variant="primary" onClick={openAdd} className="!gap-2">
                <Plus size={16} />
                {t("pages.hosts.addHost")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="panel-data-table overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                  <th
                    className="w-14 p-3"
                    scope="col"
                    aria-label={t("pages.hosts.enable")}
                  />
                  <th className="p-3">{t("pages.hosts.name")}</th>
                  <th className="p-3">{t("pages.hosts.address")}</th>
                  <th className="p-3">{t("pages.hosts.port")}</th>
                  <th className="p-3">{t("pages.hosts.protocol")}</th>
                  <th className="p-3">{t("remark")}</th>
                  <th className="p-3">{t("pages.hosts.assignedInbounds")}</th>
                  <th className="p-3 w-20">{t("pages.hosts.operate")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    className={`border-b border-[var(--border)] text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)] ${
                      r.enable === false ? "opacity-[0.7]" : ""
                    } cursor-pointer`}
                    onClick={() => void openEdit(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openEdit(r);
                      }
                    }}
                  >
                    <td
                      className="p-3 w-14"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Switch
                        size="sm"
                        checked={r.enable !== false}
                        disabled={togglingEnableId === r.id}
                        ariaLabel={t("pages.hosts.enable")}
                        onChange={(next) => {
                          void patchHostEnable(r, next);
                        }}
                      />
                    </td>
                    <td className="p-3 text-[var(--fg)]">{r.name}</td>
                    <td className="p-3 font-mono text-xs">{r.address}</td>
                    <td className="p-3 font-mono text-xs">{r.port}</td>
                    <td className="p-3">{r.protocol || "—"}</td>
                    <td className="p-3 max-w-[200px] truncate" title={r.remark}>
                      {r.remark || "—"}
                    </td>
                    <td className="p-3 max-w-[280px] text-xs">
                      {(r.inboundIds?.length ?? 0) === 0
                        ? "—"
                        : (r.inboundIds ?? []).map(inboundLabel).join(", ")}
                    </td>
                    <td
                      className="p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          className="!p-1.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                          onClick={() => setDeleteTarget(r)}
                          title={t("pages.hosts.deleteHost")}
                          aria-label={t("pages.hosts.deleteHost")}
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

      <Drawer
        open={addOpen}
        onClose={() => {
          if (!submitting) setAddOpen(false);
        }}
        title={t("pages.hosts.addHost")}
        width={560}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={submitting}
              onClick={() => setAddOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={submitting}
              onClick={() => void submitAdd()}
            >
              {t("create")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_88%,transparent)] px-4 py-3">
            <span className="text-sm font-medium text-[var(--fg)]">
              {t("pages.hosts.visibleEnabled")}
            </span>
            <Switch
              size="sm"
              checked={form.enable}
              ariaLabel={t("pages.hosts.enable")}
              onChange={(next) =>
                setForm((f) => ({ ...f, enable: next }))
              }
            />
          </div>
          <Tabs<HostFormTab>
            tabs={hostFormTabItems}
            active={addModalTab}
            onChange={setAddModalTab}
            size="sm"
            layoutId="host-add-form-tab"
          />
          <TabPanels value={addModalTab}>
            {addModalTab === "general" ? (
              <>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostName")}
                  </span>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostAddress")}
                  </span>
                  <Input
                    value={form.address}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, address: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostPort")}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={form.port}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, port: e.target.value }))
                    }
                  />
                  <span className="text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.hosts.portZeroHint")}
                  </span>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostProtocol")}
                  </span>
                  <Input
                    value={form.protocol}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, protocol: e.target.value }))
                    }
                    placeholder="—"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("remark")}
                  </span>
                  <Input
                    value={form.remark}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, remark: e.target.value }))
                    }
                  />
                </label>
                <div className="border-t border-[var(--border)] pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[var(--fg-muted)]">
                        {t("pages.hosts.assignedInbounds")}
                      </p>
                      <p className="text-[11px] text-[var(--fg-subtle)]">
                        {t("pages.hosts.selectedInboundCount", {
                          count: Object.entries(inboundPick).filter(
                            ([, v]) => v,
                          ).length,
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!gap-2"
                      onClick={() => setAddInboundPickerOpen(true)}
                    >
                      <List size={16} aria-hidden />
                      {t("pages.hosts.selectInbounds")}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <AlertBanner
                  type="warning"
                  title={t("pages.hosts.tabAdvanced")}
                  description={t("pages.hosts.advancedTabDisclaimer")}
                />
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.subscriptionApplyMode")}
                  </span>
                  <SelectNative
                    value={form.subscriptionApplyMode}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        subscriptionApplyMode: e.target.value,
                      }))
                    }
                  >
                    <option value="replace">
                      {t("pages.hosts.subModeReplace")}
                    </option>
                    <option value="prepend">
                      {t("pages.hosts.subModePrepend")}
                    </option>
                    <option value="append">
                      {t("pages.hosts.subModeAppend")}
                    </option>
                  </SelectNative>
                  <span className="text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.hosts.subscriptionApplyModeHint")}
                  </span>
                </label>
                <HostSubscriptionTlsSection
                  values={{
                    subscriptionSni: form.subscriptionSni,
                    subscriptionHttpHost: form.subscriptionHttpHost,
                    subscriptionPath: form.subscriptionPath,
                    subscriptionAlpn: form.subscriptionAlpn,
                    subscriptionFingerprint: form.subscriptionFingerprint,
                    subscriptionAllowInsecure: form.subscriptionAllowInsecure,
                    subscriptionSecurity: form.subscriptionSecurity,
                  }}
                  onChange={(patch) =>
                    setForm((f) => ({ ...f, ...patch }))
                  }
                />
                <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--fg-muted)]">
                  {t("pages.hosts.advancedTabAddHint")}
                </p>
              </div>
            )}
          </TabPanels>
        </div>
      </Drawer>

      <Modal
        open={addInboundPickerOpen}
        onClose={() => {
          setAddInboundPickerOpen(false);
          setAddInboundSearch("");
        }}
        title={t("pages.hosts.selectInbounds")}
        width={440}
        portalClassName="z-[100]"
        lockBodyScroll={false}
        footer={
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setAddInboundPickerOpen(false);
                setAddInboundSearch("");
              }}
            >
              {t("close")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            value={addInboundSearch}
            onChange={(e) => setAddInboundSearch(e.target.value)}
            placeholder={t("pages.hosts.inboundSearchPlaceholder")}
            autoComplete="off"
          />
          <div className="max-h-[min(320px,50vh)] space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] p-3">
            {inbounds.length === 0 ? (
              <p className="text-xs text-[var(--fg-subtle)]">—</p>
            ) : (
              filterInboundOptions(addInboundSearch).map((ib) => (
                <CheckboxField
                  key={ib.id}
                  label={`${ib.remark} (${ib.protocol}:${ib.port})`}
                  checked={!!inboundPick[ib.id]}
                  onChange={(e) =>
                    setInboundPick((m) => ({
                      ...m,
                      [ib.id]: e.target.checked,
                    }))
                  }
                />
              ))
            )}
          </div>
        </div>
      </Modal>

      <Drawer
        open={editOpen}
        onClose={closeEdit}
        title={t("pages.hosts.editHost")}
        width={560}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={editSubmitting}
              onClick={closeEdit}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={editSubmitting}
              onClick={() => void submitEdit()}
            >
              {t("update")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_88%,transparent)] px-4 py-3">
            <span className="text-sm font-medium text-[var(--fg)]">
              {t("pages.hosts.visibleEnabled")}
            </span>
            <Switch
              size="sm"
              checked={editForm.enable}
              ariaLabel={t("pages.hosts.enable")}
              onChange={(next) =>
                setEditForm((f) => ({ ...f, enable: next }))
              }
            />
          </div>
          <Tabs<HostFormTab>
            tabs={hostFormTabItems}
            active={editModalTab}
            onChange={setEditModalTab}
            size="sm"
            layoutId="host-edit-form-tab"
          />
          <TabPanels value={editModalTab}>
            {editModalTab === "general" ? (
              <>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostName")}
                  </span>
                  <Input
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostAddress")}
                  </span>
                  <Input
                    value={editForm.address}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, address: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostPort")}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={editForm.port}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, port: e.target.value }))
                    }
                  />
                  <span className="text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.hosts.portZeroHint")}
                  </span>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.hostProtocol")}
                  </span>
                  <Input
                    value={editForm.protocol}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, protocol: e.target.value }))
                    }
                    placeholder="—"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("remark")}
                  </span>
                  <Input
                    value={editForm.remark}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, remark: e.target.value }))
                    }
                  />
                </label>
                <div className="border-t border-[var(--border)] pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[var(--fg-muted)]">
                        {t("pages.hosts.assignedInbounds")}
                      </p>
                      <p className="text-[11px] text-[var(--fg-subtle)]">
                        {t("pages.hosts.selectedInboundCount", {
                          count: Object.entries(editInboundPick).filter(
                            ([, v]) => v,
                          ).length,
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!gap-2"
                      onClick={() => setEditInboundPickerOpen(true)}
                    >
                      <List size={16} aria-hidden />
                      {t("pages.hosts.selectInbounds")}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <AlertBanner
                  type="warning"
                  title={t("pages.hosts.tabAdvanced")}
                  description={t("pages.hosts.advancedTabDisclaimer")}
                />
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--fg-muted)]">
                    {t("pages.hosts.subscriptionApplyMode")}
                  </span>
                  <SelectNative
                    value={editForm.subscriptionApplyMode}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        subscriptionApplyMode: e.target.value,
                      }))
                    }
                  >
                    <option value="replace">
                      {t("pages.hosts.subModeReplace")}
                    </option>
                    <option value="prepend">
                      {t("pages.hosts.subModePrepend")}
                    </option>
                    <option value="append">
                      {t("pages.hosts.subModeAppend")}
                    </option>
                  </SelectNative>
                  <span className="text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.hosts.subscriptionApplyModeHint")}
                  </span>
                </label>
                <HostSubscriptionTlsSection
                  values={{
                    subscriptionSni: editForm.subscriptionSni,
                    subscriptionHttpHost: editForm.subscriptionHttpHost,
                    subscriptionPath: editForm.subscriptionPath,
                    subscriptionAlpn: editForm.subscriptionAlpn,
                    subscriptionFingerprint: editForm.subscriptionFingerprint,
                    subscriptionAllowInsecure:
                      editForm.subscriptionAllowInsecure,
                    subscriptionSecurity: editForm.subscriptionSecurity,
                  }}
                  onChange={(patch) =>
                    setEditForm((f) => ({ ...f, ...patch }))
                  }
                />
                <div className="border-t border-[var(--border)] pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[var(--fg-muted)]">
                        {t("pages.hosts.subscriptionEndpointsSection")}
                      </p>
                      <p className="text-[11px] text-[var(--fg-subtle)]">
                        {t("pages.hosts.subscriptionEndpointsHint")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        hostSubLoading || editSelectedInboundIds().length === 0
                      }
                      loading={hostSubLoading}
                      onClick={() =>
                        void refreshHostSubscriptionDrafts(
                          editSelectedInboundIds(),
                        )
                      }
                    >
                      {t("pages.hosts.subscriptionEndpointsRefresh")}
                    </Button>
                  </div>
                  {editSelectedInboundIds().length === 0 ? (
                    <p className="text-xs text-[var(--fg-subtle)]">
                      {t("pages.hosts.subscriptionEndpointsNoInbounds")}
                    </p>
                  ) : hostSubLoading && !hostSubLoaded ? (
                    <div className="grid place-items-center py-6">
                      <Spinner size={28} />
                    </div>
                  ) : (
                    <div className="max-h-[min(420px,55vh)] space-y-4 overflow-y-auto pr-1">
                      {editSelectedInboundIds().map((iid) => {
                        const meta = inbounds.find((x) => x.id === iid);
                        const title =
                          meta != null
                            ? `${meta.remark} (${meta.protocol}:${meta.port})`
                            : inboundLabel(iid);
                        const rows = hostSubDrafts[iid] ?? [];
                        return (
                          <div key={iid}>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                              #{iid} · {title}
                            </p>
                            {rows.length === 0 ? (
                              <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--fg-muted)]">
                                {t("pages.hosts.subscriptionEndpointsNoNodes")}
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {rows.map((row, idx) => (
                                  <div
                                    key={row.nodeId}
                                    className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
                                  >
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fg)]">
                                        {(row.nodeName ?? "").trim()
                                          ? `${(row.nodeName ?? "").trim()} · id ${row.nodeId}`
                                          : `${t("pages.hosts.subscriptionNodeFallback")} ${row.nodeId}`}
                                      </span>
                                      <div className="flex items-center gap-0.5">
                                        <IconButton
                                          type="button"
                                          label={t("pages.hosts.moveEndpointUp")}
                                          disabled={idx === 0}
                                          onClick={() =>
                                            moveHostSubRow(iid, idx, -1)
                                          }
                                        >
                                          <ArrowUp size={16} />
                                        </IconButton>
                                        <IconButton
                                          type="button"
                                          label={t(
                                            "pages.hosts.moveEndpointDown",
                                          )}
                                          disabled={idx >= rows.length - 1}
                                          onClick={() =>
                                            moveHostSubRow(iid, idx, 1)
                                          }
                                        >
                                          <ArrowDown size={16} />
                                        </IconButton>
                                      </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <label className="grid gap-1">
                                        <span className="text-[11px] text-[var(--fg-muted)]">
                                          {t(
                                            "pages.inbounds.nodePublishedAddress",
                                            {
                                              defaultValue:
                                                "Published address (optional)",
                                            },
                                          )}
                                        </span>
                                        <Input
                                          value={row.publishedAddress}
                                          onChange={(e) =>
                                            patchHostSubRow(iid, row.nodeId, {
                                              publishedAddress: e.target.value,
                                            })
                                          }
                                          placeholder={t(
                                            "pages.inbounds.nodePublishedAddressPh",
                                            {
                                              defaultValue:
                                                "Empty = node address",
                                            },
                                          )}
                                        />
                                      </label>
                                      <label className="grid gap-1">
                                        <span className="text-[11px] text-[var(--fg-muted)]">
                                          {t("pages.inbounds.nodePublishedPort", {
                                            defaultValue:
                                              "Published port (0 = inbound)",
                                          })}
                                        </span>
                                        <Input
                                          type="number"
                                          min={0}
                                          value={row.publishedPort}
                                          onChange={(e) =>
                                            patchHostSubRow(iid, row.nodeId, {
                                              publishedPort: e.target.value,
                                            })
                                          }
                                        />
                                      </label>
                                    </div>
                                    <label className="mt-2 grid gap-1">
                                      <span className="text-[11px] text-[var(--fg-muted)]">
                                        {t(
                                          "pages.inbounds.subscriptionRemarkSuffix",
                                          {
                                            defaultValue: "Remark suffix",
                                          },
                                        )}
                                      </span>
                                      <Input
                                        value={row.subscriptionRemarkSuffix}
                                        onChange={(e) =>
                                          patchHostSubRow(iid, row.nodeId, {
                                            subscriptionRemarkSuffix:
                                              e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="mt-2 grid gap-1">
                                      <span className="text-[11px] text-[var(--fg-muted)]">
                                        {t("pages.inbounds.serverDescription", {
                                          defaultValue:
                                            "Server description (optional, max 30)",
                                        })}
                                      </span>
                                      <Input
                                        maxLength={30}
                                        value={row.serverDescription}
                                        onChange={(e) =>
                                          patchHostSubRow(iid, row.nodeId, {
                                            serverDescription: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <div className="mt-2">
                                      <CheckboxField
                                        checked={row.includeInSubscription}
                                        onChange={(e) =>
                                          patchHostSubRow(iid, row.nodeId, {
                                            includeInSubscription:
                                              e.target.checked,
                                          })
                                        }
                                        label={t(
                                          "pages.inbounds.includeInSubscription",
                                          {
                                            defaultValue:
                                              "Include in subscription",
                                          },
                                        )}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabPanels>
        </div>
      </Drawer>

      <Modal
        open={editInboundPickerOpen}
        onClose={() => {
          setEditInboundPickerOpen(false);
          setEditInboundSearch("");
        }}
        title={t("pages.hosts.selectInbounds")}
        width={440}
        portalClassName="z-[100]"
        lockBodyScroll={false}
        footer={
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setEditInboundPickerOpen(false);
                setEditInboundSearch("");
              }}
            >
              {t("close")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            value={editInboundSearch}
            onChange={(e) => setEditInboundSearch(e.target.value)}
            placeholder={t("pages.hosts.inboundSearchPlaceholder")}
            autoComplete="off"
          />
          <div className="max-h-[min(320px,50vh)] space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] p-3">
            {inbounds.length === 0 ? (
              <p className="text-xs text-[var(--fg-subtle)]">—</p>
            ) : (
              filterInboundOptions(editInboundSearch).map((ib) => (
                <CheckboxField
                  key={ib.id}
                  label={`${ib.remark} (${ib.protocol}:${ib.port})`}
                  checked={!!editInboundPick[ib.id]}
                  onChange={(e) =>
                    setEditInboundPick((m) => ({
                      ...m,
                      [ib.id]: e.target.checked,
                    }))
                  }
                />
              ))
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => {
          if (deleteSubmitting) return;
          setDeleteTarget(null);
        }}
        closable={!deleteSubmitting}
        title={t("pages.hosts.deleteConfirm")}
        width={480}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={deleteSubmitting}
              onClick={() => setDeleteTarget(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleteSubmitting}
              onClick={() => void confirmDeleteHost()}
            >
              {t("pages.hosts.deleteHost")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-muted)]">
          {t("pages.hosts.deleteConfirmText")}
        </p>
        {deleteTarget ? (
          <p className="mt-2 font-mono text-xs text-[var(--fg)]">
            {deleteTarget.name} — {deleteTarget.address}
          </p>
        ) : null}
      </Modal>
    </PageScaffold>
  );
}
