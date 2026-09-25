"use client";

import { Pencil, Plus, RotateCcw, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import { hostKindLabel, hostTarget, type BundleHostView } from "@/components/BundlesPage";
import { Button, Collapsible, IconButton, Input, Modal, PillTag, Reveal, SelectNative, Spinner, Switch, useToast } from "@/components/ui";

type Inbound = { id: number; remark: string; protocol: string; port: number };

type Form = {
  id?: number;
  kind?: string;
  inboundId: number;
  name: string;
  address: string;
  port: string;
  enable: boolean;
  remarkSuffix: string;
  subscriptionSni: string;
  subscriptionHttpHost: string;
  subscriptionPath: string;
  subscriptionAlpn: string;
  subscriptionFingerprint: string;
  subscriptionSecurity: string;
  subscriptionAllowInsecure: "" | "true" | "false";
};

const EMPTY: Form = {
  inboundId: 0,
  name: "",
  address: "",
  port: "",
  enable: true,
  remarkSuffix: "",
  subscriptionSni: "",
  subscriptionHttpHost: "",
  subscriptionPath: "",
  subscriptionAlpn: "",
  subscriptionFingerprint: "",
  subscriptionSecurity: "",
  subscriptionAllowInsecure: "",
};

type FullHost = BundleHostView & Partial<Record<string, unknown>>;

function toBody(f: Form) {
  return {
    inboundId: f.inboundId,
    name: f.name,
    address: f.address,
    port: Number.parseInt(f.port, 10) || 0,
    enable: f.enable,
    remarkSuffix: f.remarkSuffix,
    subscriptionSni: f.subscriptionSni,
    subscriptionHttpHost: f.subscriptionHttpHost,
    subscriptionPath: f.subscriptionPath,
    subscriptionAlpn: f.subscriptionAlpn,
    subscriptionFingerprint: f.subscriptionFingerprint,
    subscriptionSecurity: f.subscriptionSecurity,
    subscriptionAllowInsecure: f.subscriptionAllowInsecure === "" ? null : f.subscriptionAllowInsecure === "true",
  };
}

function fromHost(h: FullHost): Form {
  const s = (k: string) => (typeof h[k] === "string" ? (h[k] as string) : "");
  const ai = h["subscriptionAllowInsecure"];
  return {
    id: h.id,
    kind: h.kind,
    inboundId: h.inboundId ?? 0,
    name: h.name,
    address: h.address,
    port: h.port > 0 ? String(h.port) : "",
    enable: h.enable,
    remarkSuffix: s("remarkSuffix"),
    subscriptionSni: s("subscriptionSni"),
    subscriptionHttpHost: s("subscriptionHttpHost"),
    subscriptionPath: s("subscriptionPath"),
    subscriptionAlpn: s("subscriptionAlpn"),
    subscriptionFingerprint: s("subscriptionFingerprint"),
    subscriptionSecurity: s("subscriptionSecurity"),
    subscriptionAllowInsecure: ai === true ? "true" : ai === false ? "false" : "",
  };
}

/** Hosts under the bundle scheme: every entry a client can be given, bound to one inbound. */
export function BundleHostsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [hosts, setHosts] = useState<FullHost[]>([]);
  const [inbounds, setInbounds] = useState<Inbound[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FullHost | null>(null);
  const [showOverrides, setShowOverrides] = useState(false);

  const load = useCallback(async () => {
    const [h, i] = await Promise.all([getJson<FullHost[]>(panel("bundle/hosts")), getJson<Inbound[]>(panel("api/inbounds/list"))]);
    if (h.success && Array.isArray(h.obj)) setHosts(h.obj);
    if (i.success && Array.isArray(i.obj)) setInbounds(i.obj);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<number, FullHost[]>();
    for (const h of hosts) {
      const k = h.inboundId ?? 0;
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()];
  }, [hosts]);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim() || (form.kind !== "local" && !form.address.trim()) || (!form.id && !form.inboundId)) {
      toast.error(t("pages.bundleHosts.required", { defaultValue: "Fill in the inbound, name and address" }));
      return;
    }
    setSaving(true);
    const r = await postJson(form.id ? panel(`bundle/hosts/update/${form.id}`) : panel("bundle/hosts/add"), toBody(form), true);
    setSaving(false);
    if (!r.success) {
      toast.error(r.msg || t("fail"));
      return;
    }
    setForm(null);
    await load();
  };

  const toggle = async (h: FullHost, next: boolean) => {
    setHosts((prev) => prev.map((x) => (x.id === h.id ? { ...x, enable: next } : x)));
    const r = await postJson(panel(`bundle/hosts/update/${h.id}`), { ...toBody(fromHost(h)), enable: next }, true);
    if (!r.success) toast.error(r.msg || t("fail"));
    await load();
  };

  const reset = async (h: FullHost) => {
    const r = await postJson(panel(`bundle/hosts/reset/${h.id}`), {}, true);
    if (!r.success) toast.error(r.msg || t("fail"));
    else toast.info(t("pages.bundleHosts.resetDone", { defaultValue: "The host follows its node or balancer again" }));
    window.setTimeout(() => void load(), 1500);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const r = await postJson(panel(`bundle/hosts/del/${deleteTarget.id}`), {}, true);
    setDeleteTarget(null);
    if (!r.success) toast.error(r.msg || t("fail"));
    await load();
  };

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("menu.hosts")}
        icon={Server}
        iconTone="accent"
        description={t("pages.bundleHosts.subtitle", {
          defaultValue: "Every entry a client can be given. Node and balancer hosts follow their placement; address hosts are yours. Bundles decide who gets which.",
        })}
        actions={
          <>
            <Button variant="secondary" className="!gap-2" onClick={() => setForm({ ...EMPTY, inboundId: inbounds[0]?.id ?? 0 })}>
              <Plus size={16} />
              {t("pages.bundleHosts.add", { defaultValue: "Add address host" })}
            </Button>
            <SectionHelpModal scene="hosts" titleKey="pages.bundleHosts.helpTitle" paragraphKeys={["pages.bundleHosts.helpP1", "pages.bundleHosts.helpP2", "pages.bundleHosts.helpP3"]} />
          </>
        }
      />
      <Reveal>
        {loading ? (
          <div className="grid min-h-40 place-items-center">
            <Spinner size={32} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {grouped.map(([inboundId, list]) => (
              <Surface key={inboundId} padding="none" className="overflow-hidden">
                <div className="border-b border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--fg)]">
                  {list[0]?.inboundRemark || `#${inboundId}`}
                </div>
                {list.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 last:border-0">
                    <Switch size="sm" checked={h.enable} onChange={(v) => void toggle(h, v)} ariaLabel="enable" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--fg)]">
                        {h.name}
                        <PillTag tone={h.kind === "address" ? "blue" : "neutral"}>{hostKindLabel(h.kind, t)}</PillTag>
                        {h.customized ? <PillTag tone="amber">{t("pages.bundleHosts.customized", { defaultValue: "edited" })}</PillTag> : null}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--fg-subtle)]">
                        {hostTarget(h)}
                        {h.nodeName ? ` · ${h.nodeName}` : ""}
                        {h.poolName ? ` · ${h.poolName}` : ""}
                      </div>
                    </div>
                    <div className="flex max-w-[40%] flex-wrap justify-end gap-1">
                      {(h.bundleNames ?? []).map((n, i) => (
                        <span key={i} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]">
                          {n}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      {h.customized && h.kind !== "address" ? (
                        <IconButton label={t("pages.bundleHosts.reset", { defaultValue: "Follow the node again" })} onClick={() => void reset(h)}>
                          <RotateCcw size={14} />
                        </IconButton>
                      ) : null}
                      <IconButton label={t("edit")} onClick={() => setForm(fromHost(h))}>
                        <Pencil size={14} />
                      </IconButton>
                      {h.kind === "address" ? (
                        <IconButton label={t("delete")} onClick={() => setDeleteTarget(h)}>
                          <Trash2 size={14} />
                        </IconButton>
                      ) : null}
                    </div>
                  </div>
                ))}
              </Surface>
            ))}
            {grouped.length === 0 ? (
              <Surface>
                <p className="py-6 text-center text-sm text-[var(--fg-muted)]">{t("noData")}</p>
              </Surface>
            ) : null}
          </div>
        )}
      </Reveal>

      <Modal
        open={form != null}
        onClose={() => !saving && setForm(null)}
        title={form?.id ? t("pages.bundleHosts.editTitle", { defaultValue: "Edit host" }) : t("pages.bundleHosts.add", { defaultValue: "Add address host" })}
        width={620}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => setForm(null)}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t("confirm")}
            </Button>
          </div>
        }
      >
        {form ? (
          <div className="flex flex-col gap-3">
            {!form.id ? (
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundleHosts.inbound", { defaultValue: "Inbound" })}</span>
                <SelectNative value={form.inboundId || ""} onChange={(e) => set({ inboundId: Number(e.target.value) })}>
                  {inbounds.map((i) => (
                    <option key={i.id} value={i.id}>
                      {(i.remark || `#${i.id}`) + ` · ${i.protocol} :${i.port}`}
                    </option>
                  ))}
                </SelectNative>
              </label>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_100px]">
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundleHosts.name", { defaultValue: "Name" })}</span>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundleHosts.address", { defaultValue: "Address" })}</span>
                <Input value={form.address} disabled={form.kind === "local"} onChange={(e) => set({ address: e.target.value })} placeholder="cdn.example.com" />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundleHosts.port", { defaultValue: "Port" })}</span>
                <Input inputMode="numeric" value={form.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, "") })} placeholder="0" />
              </label>
            </div>
            <p className="text-xs text-[var(--fg-subtle)]">{t("pages.bundleHosts.portHint", { defaultValue: "Port 0 or empty: the inbound's own port." })}</p>
            <button type="button" className="text-left text-xs font-medium text-[var(--accent)]" onClick={() => setShowOverrides((v) => !v)}>
              {showOverrides ? "▾ " : "▸ "}
              {t("pages.bundleHosts.overrides", { defaultValue: "Subscription link overrides (TLS / transport)" })}
            </button>
            <Collapsible open={showOverrides}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["subscriptionSni", "SNI"],
                    ["subscriptionHttpHost", "HTTP Host"],
                    ["subscriptionPath", "Path / serviceName"],
                    ["subscriptionAlpn", "ALPN"],
                    ["subscriptionFingerprint", "Fingerprint"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="block text-xs">
                    <span className="mb-1 block font-medium text-[var(--fg-muted)]">{label}</span>
                    <Input value={form[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<Form>)} />
                  </label>
                ))}
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundleHosts.security", { defaultValue: "Force TLS in link" })}</span>
                  <SelectNative value={form.subscriptionSecurity} onChange={(e) => set({ subscriptionSecurity: e.target.value })}>
                    <option value="">{t("pages.bundleHosts.inherit", { defaultValue: "Inherit" })}</option>
                    <option value="tls">TLS</option>
                    <option value="none">none</option>
                  </SelectNative>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundleHosts.allowInsecure", { defaultValue: "Allow insecure TLS" })}</span>
                  <SelectNative value={form.subscriptionAllowInsecure} onChange={(e) => set({ subscriptionAllowInsecure: e.target.value as Form["subscriptionAllowInsecure"] })}>
                    <option value="">{t("pages.bundleHosts.inherit", { defaultValue: "Inherit" })}</option>
                    <option value="true">{t("yes", { defaultValue: "Yes" })}</option>
                    <option value="false">{t("no", { defaultValue: "No" })}</option>
                  </SelectNative>
                </label>
              </div>
            </Collapsible>
            {form.kind && form.kind !== "address" ? (
              <p className="text-xs text-[var(--fg-subtle)]">
                {t("pages.bundleHosts.managedHint", { defaultValue: "This host follows its node or balancer. Saving changes marks it as edited; use the reset button to follow again." })}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("pages.bundleHosts.deleteTitle", { defaultValue: "Delete host?" })}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              {t("delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-muted)]">{t("pages.bundleHosts.deleteText", { defaultValue: "It is removed from every bundle. Clients keep their access to the inbound." })}</p>
        <p className="mt-2 font-mono text-xs text-[var(--fg)]">{deleteTarget?.name}</p>
      </Modal>
    </PageScaffold>
  );
}
