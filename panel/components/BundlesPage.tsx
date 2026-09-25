"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Package, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  IconButton,
  Input,
  Modal,
  PillTag,
  Reveal,
  SelectNative,
  Spinner,
  Switch,
  Tabs,
  useToast,
} from "@/components/ui";

export type BundleHostView = {
  id: number;
  name: string;
  address: string;
  port: number;
  kind: "address" | "placement" | "pool" | "local";
  inboundId?: number;
  inboundRemark?: string;
  nodeName?: string;
  poolName?: string;
  enable: boolean;
  customized: boolean;
  bundleIds?: number[];
  bundleNames?: string[];
};

type BundleHostRow = { id: number; hostId: number; hidden: boolean; host?: BundleHostView };
type Bundle = {
  id: number;
  name: string;
  description: string;
  enable: boolean;
  auto: boolean;
  followPlacements: boolean;
  clientCount: number;
  hosts?: BundleHostRow[];
};
type Member = { id: number; name: string; subId: string; enable: boolean };
type ClientLite = { id: number; name: string; subId?: string; enable?: boolean };
type Report = {
  status: string;
  error?: string;
  clients?: number;
  bundles?: number;
  hosts?: number;
  verified?: number;
  finishedAt?: number;
  mismatches?: { client: string; check: string; detail: string }[];
};
type State = { enabled: boolean; report?: Report | null };

type Draft = {
  id?: number;
  name: string;
  description: string;
  enable: boolean;
  followPlacements: boolean;
  refs: { hostId: number; hidden: boolean }[];
};

export function hostKindLabel(kind: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (kind) {
    case "placement":
      return t("pages.bundles.kindPlacement", { defaultValue: "Node" });
    case "pool":
      return t("pages.bundles.kindPool", { defaultValue: "Balancer" });
    case "local":
      return t("pages.bundles.kindLocal", { defaultValue: "Panel" });
    default:
      return t("pages.bundles.kindAddress", { defaultValue: "Address" });
  }
}

export function hostTarget(h: BundleHostView): string {
  const port = h.port > 0 ? `:${h.port}` : "";
  return h.kind === "local" ? "—" : `${h.address}${port}`;
}

export function BundlesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<State | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [hosts, setHosts] = useState<BundleHostView[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState("hosts");
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [hostPick, setHostPick] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, b, h] = await Promise.all([
      getJson<State>(panel("bundle/state")),
      getJson<Bundle[]>(panel("bundle/list")),
      getJson<BundleHostView[]>(panel("bundle/hosts")),
    ]);
    if (s.success && s.obj) setState(s.obj);
    if (b.success && Array.isArray(b.obj)) setBundles(b.obj);
    if (h.success && Array.isArray(h.obj)) setHosts(h.obj);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hostById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts]);

  const openEditor = async (b?: Bundle) => {
    setTab("hosts");
    setMemberQuery("");
    setHostPick("");
    if (!b) {
      setDraft({ name: "", description: "", enable: true, followPlacements: true, refs: [] });
      setMembers([]);
    } else {
      setDraft({
        id: b.id,
        name: b.name,
        description: b.description,
        enable: b.enable,
        followPlacements: b.followPlacements,
        refs: (b.hosts ?? []).map((x) => ({ hostId: x.hostId, hidden: x.hidden })),
      });
      const m = await getJson<Member[]>(panel(`bundle/members/${b.id}`));
      setMembers(m.success && Array.isArray(m.obj) ? m.obj : []);
    }
    if (clients.length === 0) {
      const c = await getJson<ClientLite[]>(panel("client/list"));
      if (c.success && Array.isArray(c.obj)) setClients(c.obj);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const body = {
      name: draft.name,
      description: draft.description,
      enable: draft.enable,
      followPlacements: draft.followPlacements,
      hostRefs: draft.refs,
    };
    const r = await postJson(draft.id ? panel(`bundle/update/${draft.id}`) : panel("bundle/add"), body, true);
    setSaving(false);
    if (!r.success) {
      toast.error(r.msg || t("fail"));
      return;
    }
    const n = (r.obj as { changedClients?: number } | undefined)?.changedClients ?? 0;
    if (n > 0) toast.info(t("pages.bundles.appliedTo", { defaultValue: "Access changed for {{n}} clients", n }));
    setDraft(null);
    await load();
  };

  const move = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const j = idx + dir;
      if (j < 0 || j >= d.refs.length) return d;
      const refs = [...d.refs];
      [refs[idx], refs[j]] = [refs[j], refs[idx]];
      return { ...d, refs };
    });
  };

  const addMember = async (c: ClientLite) => {
    if (!draft?.id) return;
    const r = await postJson(panel("bundle/members/add"), { bundleId: draft.id, clientIds: [c.id] }, true);
    if (!r.success) {
      toast.error(r.msg || t("fail"));
      return;
    }
    const m = await getJson<Member[]>(panel(`bundle/members/${draft.id}`));
    setMembers(m.success && Array.isArray(m.obj) ? m.obj : []);
    void load();
  };

  const removeMember = async (c: Member) => {
    if (!draft?.id) return;
    const r = await postJson(panel("bundle/members/remove"), { bundleId: draft.id, clientIds: [c.id] }, true);
    if (!r.success) {
      toast.error(r.msg || t("fail"));
      return;
    }
    setMembers((m) => m.filter((x) => x.id !== c.id));
    void load();
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const r = await postJson(panel(`bundle/del/${deleteTarget.id}`), {}, true);
    setBusy(false);
    setDeleteTarget(null);
    if (!r.success) toast.error(r.msg || t("fail"));
    await load();
  };

  const convert = async () => {
    setBusy(true);
    const r = await postJson<Report>(panel("bundle/convert"), {}, true);
    setBusy(false);
    if (!r.success) toast.error(r.msg || t("fail"));
    else toast.success(t("pages.bundles.converted", { defaultValue: "Converted and switched" }));
    await load();
  };

  const available = useMemo(() => {
    if (!draft) return [];
    const used = new Set(draft.refs.map((r) => r.hostId));
    return hosts.filter((h) => !used.has(h.id));
  }, [draft, hosts]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const clientMatches = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    return clients.filter((c) => !memberIds.has(c.id) && (q === "" || (c.name ?? "").toLowerCase().includes(q))).slice(0, 8);
  }, [clients, memberIds, memberQuery]);

  const report = state?.report;

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("pages.bundles.title", { defaultValue: "Bundles" })}
        icon={Package}
        iconTone="accent"
        actions={
          <>
            <Button variant="secondary" className="!gap-2" onClick={() => void openEditor()} disabled={!state?.enabled}>
              <Plus size={16} />
              {t("pages.bundles.add", { defaultValue: "Create bundle" })}
            </Button>
            <SectionHelpModal titleKey="pages.bundles.helpTitle" paragraphKeys={["pages.bundles.helpP1", "pages.bundles.helpP2", "pages.bundles.helpP3"]} />
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
            {state && !state.enabled ? (
              <Surface>
                <div className="flex flex-col gap-2 text-sm text-[var(--fg-muted)]">
                  <AlertBanner
                    type={report?.status === "failed" ? "error" : "info"}
                    title={
                      report?.status === "failed"
                        ? t("pages.bundles.convertFailed", { defaultValue: "The conversion did not switch: the previous scheme stays active." })
                        : t("pages.bundles.notConverted", { defaultValue: "Bundles are not active yet. The panel converts automatically after an upgrade." })
                    }
                    description={report?.error}
                  />
                  {report?.mismatches?.length ? (
                    <ul className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] p-2 font-mono text-[11px]">
                      {report.mismatches.map((m, i) => (
                        <li key={i} className="break-all">
                          {m.client}: {m.check}: {m.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    <Button variant="primary" loading={busy} onClick={() => void convert()}>
                      {t("pages.bundles.convertNow", { defaultValue: "Convert now" })}
                    </Button>
                  </div>
                </div>
              </Surface>
            ) : null}

            {state?.enabled ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-muted)]">
                <span>
                  {report?.status === "converted"
                    ? t("pages.bundles.convertedInfo", {
                        defaultValue: "Converted automatically: {{clients}} clients, {{bundles}} bundles, {{verified}} subscriptions verified identical.",
                        clients: report.clients ?? 0,
                        bundles: report.bundles ?? 0,
                        verified: report.verified ?? 0,
                      })
                    : t("pages.bundles.active", { defaultValue: "Bundles are active." })}
                </span>
              </div>
            ) : null}

            {bundles.map((b) => {
              const visible = (b.hosts ?? []).filter((x) => !x.hidden);
              return (
                <article key={b.id} className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 ${b.enable ? "" : "opacity-[0.7]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-[var(--fg)]">{b.name}</h3>
                        {b.auto ? <PillTag>{t("pages.bundles.auto", { defaultValue: "auto" })}</PillTag> : null}
                        {!b.enable ? <PillTag tone="amber">{t("pages.bundles.off", { defaultValue: "off" })}</PillTag> : null}
                        <PillTag tone="blue">
                          <Users size={12} className="mr-1" />
                          {b.clientCount}
                        </PillTag>
                      </div>
                      {b.description ? <p className="mt-1 text-xs text-[var(--fg-subtle)]">{b.description}</p> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton label={t("edit")} onClick={() => void openEditor(b)}>
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton label={t("delete")} onClick={() => setDeleteTarget(b)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visible.length === 0 ? (
                      <span className="text-xs text-[var(--fg-subtle)]">{t("pages.bundles.noVisibleHosts", { defaultValue: "No listed hosts" })}</span>
                    ) : (
                      visible.map((x) => (
                        <span key={x.id} className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1 text-xs ${x.host && x.host.enable ? "text-[var(--fg-muted)]" : "opacity-50"}`}>
                          <span className="text-[var(--fg-subtle)]">{x.host ? hostById.get(x.host.id)?.inboundRemark ?? "" : ""}</span>
                          {x.host?.name}
                          <span className="font-mono text-[10px] text-[var(--fg-subtle)]">{x.host ? hostTarget({ ...x.host, ...(hostById.get(x.host.id) ?? {}) } as BundleHostView) : ""}</span>
                        </span>
                      ))
                    )}
                  </div>
                </article>
              );
            })}
            {bundles.length === 0 && state?.enabled ? (
              <Surface>
                <p className="py-6 text-center text-sm text-[var(--fg-muted)]">{t("pages.bundles.empty", { defaultValue: "No bundles yet." })}</p>
              </Surface>
            ) : null}
          </div>
        )}
      </Reveal>

      <Modal
        open={draft != null}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id ? t("pages.bundles.editTitle", { defaultValue: "Edit bundle" }) : t("pages.bundles.add", { defaultValue: "Create bundle" })}
        width={760}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => setDraft(null)}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t("confirm")}
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundles.name", { defaultValue: "Name" })}</span>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 pb-2 text-xs text-[var(--fg-muted)]">
                <Switch size="sm" checked={draft.enable} onChange={(v) => setDraft({ ...draft, enable: v })} ariaLabel="enable" />
                {t("pages.bundles.enabled", { defaultValue: "Enabled" })}
              </label>
            </div>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-[var(--fg-muted)]">{t("pages.bundles.descriptionField", { defaultValue: "Description" })}</span>
              <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <Tabs
              active={tab}
              onChange={setTab}
              layoutId="bundle-editor-tabs"
              size="sm"
              tabs={[
                { id: "hosts", label: t("pages.bundles.tabHosts", { defaultValue: "Hosts" }) },
                { id: "members", label: t("pages.bundles.tabMembers", { defaultValue: "Clients" }) },
                { id: "options", label: t("pages.bundles.tabOptions", { defaultValue: "Options" }) },
              ]}
            />
            {tab === "hosts" ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-[var(--fg-subtle)]">
                  {t("pages.bundles.hostsHint", {
                    defaultValue:
                      "The client gets these hosts in this order and access to their inbounds. A hidden host is not listed in the subscription but still gives access.",
                  })}
                </p>
                {draft.refs.length === 0 ? (
                  <p className="py-3 text-center text-xs text-[var(--fg-subtle)]">{t("pages.bundles.noHosts", { defaultValue: "No hosts yet." })}</p>
                ) : (
                  draft.refs.map((r, i) => {
                    const h = hostById.get(r.hostId);
                    return (
                      <div key={r.hostId} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
                        <span className="w-5 text-center text-xs text-[var(--fg-subtle)]">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--fg)]">
                            {h?.name ?? `#${r.hostId}`}
                            {h ? <PillTag>{hostKindLabel(h.kind, t)}</PillTag> : null}
                            {h && !h.enable ? <PillTag tone="amber">{t("pages.bundles.off", { defaultValue: "off" })}</PillTag> : null}
                          </div>
                          <div className="truncate font-mono text-[11px] text-[var(--fg-subtle)]">
                            {h?.inboundRemark} · {h ? hostTarget(h) : ""}
                          </div>
                        </div>
                        <IconButton label={t("pages.bundles.up", { defaultValue: "Up" })} disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp size={14} />
                        </IconButton>
                        <IconButton label={t("pages.bundles.down", { defaultValue: "Down" })} disabled={i === draft.refs.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown size={14} />
                        </IconButton>
                        <IconButton
                          label={r.hidden ? t("pages.bundles.show", { defaultValue: "Show in subscription" }) : t("pages.bundles.hide", { defaultValue: "Hide from subscription" })}
                          onClick={() => setDraft({ ...draft, refs: draft.refs.map((x) => (x.hostId === r.hostId ? { ...x, hidden: !x.hidden } : x)) })}
                        >
                          {r.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </IconButton>
                        <IconButton label={t("delete")} onClick={() => setDraft({ ...draft, refs: draft.refs.filter((x) => x.hostId !== r.hostId) })}>
                          <X size={14} />
                        </IconButton>
                      </div>
                    );
                  })
                )}
                <div className="flex gap-2">
                  <SelectNative value={hostPick} onChange={(e) => setHostPick(e.target.value)} className="flex-1">
                    <option value="">{t("pages.bundles.addHost", { defaultValue: "Add a host…" })}</option>
                    {available.map((h) => (
                      <option key={h.id} value={h.id}>
                        {`${h.inboundRemark ?? ""} · ${h.name} · ${hostKindLabel(h.kind, t)} ${hostTarget(h)}`}
                      </option>
                    ))}
                  </SelectNative>
                  <Button
                    variant="secondary"
                    disabled={!hostPick}
                    onClick={() => {
                      setDraft({ ...draft, refs: [...draft.refs, { hostId: Number(hostPick), hidden: false }] });
                      setHostPick("");
                    }}
                  >
                    {t("add", { defaultValue: "Add" })}
                  </Button>
                </div>
              </div>
            ) : null}
            {tab === "members" ? (
              draft.id ? (
                <div className="flex flex-col gap-2">
                  <Input placeholder={t("pages.bundles.findClient", { defaultValue: "Find a client…" })} value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />
                  {memberQuery.trim() !== "" ? (
                    <div className="flex flex-wrap gap-2">
                      {clientMatches.map((c) => (
                        <button key={c.id} type="button" className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--fg-muted)] hover:border-[var(--accent)]" onClick={() => void addMember(c)}>
                          + {c.name || `#${c.id}`}
                        </button>
                      ))}
                      {clientMatches.length === 0 ? <span className="text-xs text-[var(--fg-subtle)]">—</span> : null}
                    </div>
                  ) : null}
                  <div className="max-h-56 overflow-auto rounded-xl border border-[var(--border)]">
                    {members.length === 0 ? (
                      <p className="p-3 text-center text-xs text-[var(--fg-subtle)]">{t("pages.bundles.noMembers", { defaultValue: "No clients in this bundle." })}</p>
                    ) : (
                      members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-1.5 text-sm last:border-0">
                          <span className={m.enable ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]"}>{m.name || `#${m.id}`}</span>
                          <IconButton label={t("delete")} onClick={() => void removeMember(m)}>
                            <X size={14} />
                          </IconButton>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-[var(--fg-subtle)]">
                    {t("pages.bundles.membersHint", { defaultValue: "Changes apply immediately: the client gains or loses access on the nodes." })}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--fg-subtle)]">{t("pages.bundles.saveFirst", { defaultValue: "Save the bundle first, then add clients." })}</p>
              )
            ) : null}
            {tab === "options" ? (
              <div className="flex flex-col gap-3 text-sm text-[var(--fg-muted)]">
                <label className="flex items-center gap-2">
                  <Switch size="sm" checked={draft.followPlacements} onChange={(v) => setDraft({ ...draft, followPlacements: v })} ariaLabel="follow" />
                  {t("pages.bundles.follow", { defaultValue: "Add new nodes and balancer pools of these inbounds automatically" })}
                </label>
              </div>
            ) : null}
            {draft.id && members.length > 0 ? (
              <AlertBanner
                type="warning"
                title={t("pages.bundles.affects", { defaultValue: "This bundle has {{n}} clients. Saving changes their access immediately.", n: members.length })}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("pages.bundles.deleteTitle", { defaultValue: "Delete bundle?" })}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              {t("delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-muted)]">
          {t("pages.bundles.deleteText", {
            defaultValue: "The {{n}} clients in it lose the access only this bundle gave them.",
            n: deleteTarget?.clientCount ?? 0,
          })}
        </p>
        <p className="mt-2 font-mono text-xs text-[var(--fg)]">{deleteTarget?.name}</p>
      </Modal>

    </PageScaffold>
  );
}
