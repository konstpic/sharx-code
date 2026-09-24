"use client";

import { Copy, Pencil, Plus, RefreshCw, Scale, Send, Terminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { panel } from "@/lib/paths";
import { applyOrder, useReorderDnd } from "@/lib/useReorderDnd";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  DragHandle,
  IconButton,
  Input,
  Modal,
  PillTag,
  RadioOptionCard,
  Reveal,
  SelectNative,
  Spinner,
  Switch,
  useToast,
} from "@/components/ui";

/** Harbor-style path (same as published images); self-hosters may replace host/project. */
const BALANCER_DOCKER_IMAGE = "harbor.sharxconnect.app/sharx/sharxbalancer:latest";

type Engine = "haproxy" | "nginx";
type SubMode = "replace" | "prepend" | "append";
type Algo = "roundrobin" | "leastconn" | "source";

type Member = {
  id?: number;
  nodeId: number;
  weight: number;
  backup: boolean;
  enable: boolean;
  addressOverride: string;
  portOverride: number;
  nodeName?: string;
  nodeAddr?: string;
  nodeStatus?: string;
};

type Pool = {
  id: number;
  balancerId: number;
  inboundId: number;
  listenPort: number;
  algorithm: Algo;
  proxyProtocol: boolean;
  healthCheck: boolean;
  subEnabled: boolean;
  subMode: SubMode;
  autoMembers: boolean;
  enable: boolean;
  inboundRemark?: string;
  inboundProtocol?: string;
  inboundPort?: number;
  transport?: "tcp" | "udp";
  members?: Member[];
};

type LiveMember = { host: string; port: number; up: boolean | null; sessions: number; total: number };
type LivePool = { id: number; port: number; proto: string; listening: boolean | null; members: LiveMember[] };

type Balancer = {
  id: number;
  name: string;
  address: string;
  apiAddress: string;
  remark: string;
  engine: Engine;
  enable: boolean;
  status: string;
  lastCheck: number;
  responseTime: number;
  agentVersion: string;
  engineVersion: string;
  configHash: string;
  appliedHash: string;
  lastError: string;
  pools?: Pool[];
  live?: { running: boolean; hash: string; lastError: string; pools?: LivePool[] };
};

type InboundOption = {
  id: number;
  remark: string;
  protocol: string;
  port: number;
  nodeBindings?: { nodeId: number; nodeName?: string }[];
};

function buildBalancerComposeYaml(secretKey: string, port: number) {
  return `services:
  balancer:
    image: ${BALANCER_DOCKER_IMAGE}
    container_name: sharx-balancer
    restart: unless-stopped
    network_mode: host
    volumes:
      - sharx-balancer-data:/app/data
    environment:
      SECRET_KEY: ${JSON.stringify(secretKey)}
      SHARX_BALANCER_PORT: "${port}"

volumes:
  sharx-balancer-data:
`;
}

const isUdpProtocol = (p?: string) => p === "hysteria" || p === "hysteria2" || p === "wireguard" || p === "amneziawg";

function statusTone(s: string): "green" | "rose" | "amber" | "neutral" {
  if (s === "online") return "green";
  if (s === "offline" || s === "error") return "rose";
  return "neutral";
}

function Dot({ up }: { up: boolean | null | undefined }) {
  const c = up === true ? "bg-emerald-400" : up === false ? "bg-rose-400" : "bg-[var(--fg-subtle)]";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${c}`} aria-hidden />;
}

export function BalancersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [list, setList] = useState<Balancer[]>([]);
  const [loading, setLoading] = useState(true);
  const [inbounds, setInbounds] = useState<InboundOption[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [editing, setEditing] = useState<Partial<Balancer> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Balancer | null>(null);
  const [poolEdit, setPoolEdit] = useState<{ balancer: Balancer; pool: Partial<Pool> } | null>(null);
  const [poolDelete, setPoolDelete] = useState<Pool | null>(null);
  const [install, setInstall] = useState<Balancer | null>(null);
  const [secret, setSecret] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const r = await getJson<Balancer[]>(panel("balancer/list"));
    if (!silent) setLoading(false);
    if (r.success && Array.isArray(r.obj)) setList(r.obj);
  }, []);

  const loadInbounds = useCallback(async () => {
    const r = await getJson<InboundOption[]>(panel("api/inbounds/list"));
    if (r.success && Array.isArray(r.obj)) setInbounds(r.obj);
  }, []);

  useEffect(() => {
    void load();
    void loadInbounds();
    const timer = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(timer);
  }, [load, loadInbounds]);

  const reorder = useCallback(
    async (nextIds: number[]) => {
      const pos = new Map(nextIds.map((id, i) => [id, i]));
      setList((prev) => [...prev].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)));
      const r = await postJson(panel("balancer/reorder"), { ids: nextIds }, true);
      if (!r.success) {
        toast.error(r.msg || t("fail"));
        void load(true);
      }
    },
    [load, t, toast],
  );
  const dnd = useReorderDnd({ ids: list.map((b) => b.id), enabled: true, orientation: "vertical", onReorder: (ids) => void reorder(ids) });
  const shown = applyOrder(list, dnd.order);

  const openInstall = useCallback(
    async (b: Balancer) => {
      setInstall(b);
      if (!secret) {
        const r = await getJson<{ secretKey?: string }>(panel("node/secret"));
        if (r.success && r.obj?.secretKey) setSecret(r.obj.secretKey);
      }
    },
    [secret],
  );

  const saveBalancer = async () => {
    if (!editing) return;
    setSaving(true);
    const isNew = !editing.id;
    const r = await postJson<Balancer>(
      isNew ? panel("balancer/add") : panel(`balancer/update/${editing.id}`),
      {
        name: editing.name ?? "",
        address: editing.address ?? "",
        apiAddress: editing.apiAddress ?? "",
        remark: editing.remark ?? "",
        engine: editing.engine ?? "haproxy",
      },
      true,
    );
    setSaving(false);
    if (!r.success) {
      toast.error(r.msg || t("fail"));
      return;
    }
    setEditing(null);
    await load(true);
    if (isNew && r.obj) void openInstall(r.obj);
  };

  const act = async (b: Balancer, path: string, okMsg?: string) => {
    setBusyId(b.id);
    const r = await postJson(panel(`balancer/${path}/${b.id}`), {}, true);
    setBusyId(null);
    if (!r.success) toast.error(r.msg || t("fail"));
    else if (okMsg) toast.success(okMsg);
    else if (r.msg) toast.info(r.msg);
    await load(true);
  };

  const toggleEnable = async (b: Balancer, next: boolean) => {
    setList((prev) => prev.map((x) => (x.id === b.id ? { ...x, enable: next } : x)));
    const r = await postJson(panel(`balancer/enable/${b.id}`), { enable: next }, true);
    if (!r.success) toast.error(r.msg || t("fail"));
    await load(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    const r = await postJson(panel(`balancer/del/${deleteTarget.id}`), {}, true);
    setBusyId(null);
    setDeleteTarget(null);
    if (!r.success) toast.error(r.msg || t("fail"));
    await load(true);
  };

  const confirmPoolDelete = async () => {
    if (!poolDelete) return;
    const r = await postJson(panel(`balancer/pool/del/${poolDelete.id}`), {}, true);
    setPoolDelete(null);
    if (!r.success) toast.error(r.msg || t("fail"));
    await load(true);
  };

  const modeLabel = (m: SubMode, on: boolean) => {
    if (!on) return t("pages.balancers.subHiddenShort", { defaultValue: "Direct only" });
    if (m === "replace") return t("pages.balancers.subReplaceShort", { defaultValue: "Balancer only" });
    if (m === "append") return t("pages.balancers.subAppendShort", { defaultValue: "Direct, then balancer" });
    return t("pages.balancers.subPrependShort", { defaultValue: "Balancer, then direct" });
  };

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("pages.balancers.title", { defaultValue: "Balancers" })}
        icon={Scale}
        iconTone="accent"
        actions={
          <>
            <Button variant="secondary" className="!gap-2" onClick={() => setEditing({ engine: "haproxy", name: "", address: "", apiAddress: "", remark: "" })}>
              <Plus size={16} />
              {t("pages.balancers.add", { defaultValue: "Add balancer" })}
            </Button>
            <SectionHelpModal
              titleKey="pages.balancers.helpTitle"
              paragraphKeys={["pages.balancers.helpP1", "pages.balancers.helpP2", "pages.balancers.helpP3"]}
            />
          </>
        }
      />
      <Reveal>
        {loading ? (
          <div className="grid min-h-40 place-items-center">
            <Spinner size={32} />
          </div>
        ) : shown.length === 0 ? (
          <Surface>
            <div className="grid place-items-center gap-3 py-8 text-center text-sm text-[var(--fg-muted)]">
              <Scale className="size-10 opacity-60" aria-hidden />
              <p className="max-w-lg text-balance">
                {t("pages.balancers.empty", {
                  defaultValue:
                    "A balancer is a separate server in front of your nodes: clients connect to it and it forwards the traffic to a healthy node.",
                })}
              </p>
              <Button variant="primary" className="!gap-2" onClick={() => setEditing({ engine: "haproxy", name: "", address: "", apiAddress: "", remark: "" })}>
                <Plus size={16} />
                {t("pages.balancers.add", { defaultValue: "Add balancer" })}
              </Button>
            </div>
          </Surface>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((b) => {
              const drift = b.appliedHash !== b.configHash && b.configHash !== "";
              const busy = busyId === b.id;
              return (
                <article
                  key={b.id}
                  {...dnd.itemProps(b.id)}
                  className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 ${b.enable ? "" : "opacity-[0.7]"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <DragHandle
                        enabled={dnd.enabled}
                        label={t("pages.balancers.drag", { defaultValue: "Drag to reorder" })}
                        {...dnd.handleProps(b.id)}
                      />
                      <Switch
                        size="sm"
                        checked={b.enable}
                        ariaLabel={t("pages.balancers.enabled", { defaultValue: "Enabled" })}
                        onChange={(v) => void toggleEnable(b, v)}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-[var(--fg)]">{b.name}</h3>
                          <PillTag tone={statusTone(b.status)}>
                            {t(`pages.balancers.status.${b.status}`, { defaultValue: b.status })}
                            {b.status === "online" && b.responseTime > 0 ? ` · ${b.responseTime} ms` : ""}
                          </PillTag>
                          <PillTag tone="blue">{b.engine === "nginx" ? "nginx" : "HAProxy"}</PillTag>
                          {drift ? (
                            <PillTag tone="amber">{t("pages.balancers.notApplied", { defaultValue: "Config not applied" })}</PillTag>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-[var(--fg-muted)]">
                          {b.address}
                          {b.agentVersion ? ` · agent ${b.agentVersion}` : ""}
                        </p>
                        {b.remark ? <p className="mt-0.5 text-xs text-[var(--fg-subtle)]">{b.remark}</p> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton label={t("pages.balancers.install", { defaultValue: "Install on the server" })} onClick={() => void openInstall(b)}>
                        <Terminal size={16} />
                      </IconButton>
                      <IconButton label={t("pages.balancers.refresh", { defaultValue: "Refresh status" })} disabled={busy} onClick={() => void act(b, "refresh")}>
                        <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
                      </IconButton>
                      <IconButton label={t("pages.balancers.apply", { defaultValue: "Push configuration" })} disabled={busy} onClick={() => void act(b, "apply", t("pages.balancers.applied", { defaultValue: "Configuration applied" }))}>
                        <Send size={16} />
                      </IconButton>
                      <IconButton label={t("edit")} onClick={() => setEditing(b)}>
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton label={t("delete")} onClick={() => setDeleteTarget(b)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>

                  {b.lastError ? (
                    <div className="mt-3">
                      <AlertBanner type="error" title={b.lastError} />
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-col gap-2">
                    {(b.pools ?? []).map((p) => {
                      const live = b.live?.pools?.find((x) => x.id === p.id);
                      const port = p.listenPort || p.inboundPort || 0;
                      return (
                        <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium text-[var(--fg)]">
                                {p.inboundRemark || `#${p.inboundId}`}
                              </span>
                              <PillTag>{p.inboundProtocol}</PillTag>
                              <PillTag>{(p.transport ?? "tcp").toUpperCase()}</PillTag>
                              <span className="font-mono text-xs text-[var(--fg-muted)]">
                                :{port}
                                {p.listenPort && p.listenPort !== p.inboundPort ? ` → :${p.inboundPort}` : ""}
                              </span>
                              {live?.listening === false ? (
                                <PillTag tone="rose">{t("pages.balancers.notListening", { defaultValue: "Port is not listening" })}</PillTag>
                              ) : null}
                              {!p.enable ? <PillTag>{t("pages.balancers.poolOff", { defaultValue: "Off" })}</PillTag> : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <PillTag tone={p.subEnabled ? "blue" : "neutral"}>{modeLabel(p.subMode, p.subEnabled)}</PillTag>
                              <IconButton label={t("edit")} onClick={() => setPoolEdit({ balancer: b, pool: p })}>
                                <Pencil size={14} />
                              </IconButton>
                              <IconButton label={t("delete")} onClick={() => setPoolDelete(p)}>
                                <Trash2 size={14} />
                              </IconButton>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(p.members ?? []).length === 0 ? (
                              <span className="text-xs text-[var(--fg-subtle)]">
                                {t("pages.balancers.noMembers", { defaultValue: "No nodes: assign nodes to the inbound first" })}
                              </span>
                            ) : (
                              (p.members ?? []).map((m) => {
                                const host = m.addressOverride || m.nodeAddr;
                                const lm = live?.members?.find((x) => x.host === host);
                                const state = !m.enable || m.nodeStatus === "disabled" ? null : lm ? lm.up : null;
                                return (
                                  <span
                                    key={m.nodeId}
                                    className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1 text-xs ${m.enable ? "text-[var(--fg-muted)]" : "opacity-50"}`}
                                    title={host}
                                  >
                                    <Dot up={state} />
                                    {m.nodeName}
                                    {m.weight !== 1 ? <span className="text-[var(--fg-subtle)]">×{m.weight}</span> : null}
                                    {m.backup ? <span className="text-[var(--fg-subtle)]">{t("pages.balancers.backup", { defaultValue: "backup" })}</span> : null}
                                    {lm && lm.total > 0 ? <span className="text-[var(--fg-subtle)]">· {lm.total}</span> : null}
                                  </span>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div>
                      <Button
                        variant="ghost"
                        className="!gap-2 !px-2 !py-1 text-xs"
                        onClick={() =>
                          setPoolEdit({
                            balancer: b,
                            pool: { balancerId: b.id, listenPort: 0, algorithm: "roundrobin", healthCheck: true, subEnabled: true, subMode: "prepend", autoMembers: true, enable: true, proxyProtocol: false },
                          })
                        }
                      >
                        <Plus size={14} />
                        {t("pages.balancers.addPool", { defaultValue: "Put an inbound behind this balancer" })}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Reveal>

      {/* Add / edit balancer */}
      <Modal
        open={editing != null}
        onClose={() => !saving && setEditing(null)}
        title={editing?.id ? t("pages.balancers.editTitle", { defaultValue: "Edit balancer" }) : t("pages.balancers.add", { defaultValue: "Add balancer" })}
        width={560}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => setEditing(null)}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void saveBalancer()}>
              {t("confirm")}
            </Button>
          </div>
        }
      >
        {editing ? (
          <div className="flex flex-col gap-4">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.name", { defaultValue: "Name" })}</span>
              <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="EU-edge" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                {t("pages.balancers.address", { defaultValue: "Public address (what clients connect to)" })}
              </span>
              <Input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="lb.example.com" />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.engine", { defaultValue: "Engine" })}</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <RadioOptionCard
                  name="engine"
                  heading="HAProxy"
                  description={t("pages.balancers.engineHaproxy", { defaultValue: "TCP, active health checks, least connections. No UDP." })}
                  checked={editing.engine !== "nginx"}
                  onChange={() => setEditing({ ...editing, engine: "haproxy" })}
                />
                <RadioOptionCard
                  name="engine"
                  heading="nginx (stream)"
                  description={t("pages.balancers.engineNginx", { defaultValue: "TCP and UDP (Hysteria2, WireGuard, AmneziaWG). Passive health checks." })}
                  checked={editing.engine === "nginx"}
                  onChange={() => setEditing({ ...editing, engine: "nginx" })}
                />
              </div>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                {t("pages.balancers.apiAddress", { defaultValue: "Agent API address (optional)" })}
              </span>
              <Input
                value={editing.apiAddress ?? ""}
                onChange={(e) => setEditing({ ...editing, apiAddress: e.target.value })}
                placeholder={`http://${editing.address || "lb.example.com"}:8080`}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.remark", { defaultValue: "Note" })}</span>
              <Input value={editing.remark ?? ""} onChange={(e) => setEditing({ ...editing, remark: e.target.value })} />
            </label>
          </div>
        ) : null}
      </Modal>

      {/* Install */}
      <Modal
        open={install != null}
        onClose={() => setInstall(null)}
        title={t("pages.balancers.installTitle", { defaultValue: "Install the balancer agent" })}
        width={680}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setInstall(null)}>
              {t("close")}
            </Button>
          </div>
        }
      >
        {install ? (
          <div className="flex flex-col gap-3 text-sm text-[var(--fg-muted)]">
            <p>
              {t("pages.balancers.installText", {
                defaultValue:
                  "On the server that will be the balancer, save this as docker-compose.yml and run docker compose up -d. The panel then pushes the configuration by itself. Open the agent port and the pool ports in the server firewall.",
              })}
            </p>
            {secret ? (
              <>
                <pre className="max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 font-mono text-xs text-[var(--fg)]">
                  {buildBalancerComposeYaml(secret, agentPort(install.apiAddress))}
                </pre>
                <div>
                  <Button
                    variant="secondary"
                    className="!gap-2"
                    onClick={async () => {
                      await copyTextToClipboard(buildBalancerComposeYaml(secret, agentPort(install.apiAddress)));
                      toast.success(t("copied"));
                    }}
                  >
                    <Copy size={14} />
                    {t("copy")}
                  </Button>
                </div>
              </>
            ) : (
              <Spinner size={24} />
            )}
          </div>
        ) : null}
      </Modal>

      {/* Pool editor */}
      {poolEdit ? (
        <PoolModal
          key={`${poolEdit.balancer.id}-${poolEdit.pool.id ?? "new"}`}
          balancer={poolEdit.balancer}
          pool={poolEdit.pool}
          inbounds={inbounds}
          usedInboundIds={(poolEdit.balancer.pools ?? []).map((p) => p.inboundId)}
          onClose={() => setPoolEdit(null)}
          onSaved={async () => {
            setPoolEdit(null);
            await load(true);
          }}
        />
      ) : null}

      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("pages.balancers.deleteTitle", { defaultValue: "Delete balancer?" })}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {t("delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-muted)]">
          {t("pages.balancers.deleteText", {
            defaultValue: "The balancer disappears from client subscriptions. The server and the agent on it are not touched: stop them yourself.",
          })}
        </p>
        <p className="mt-2 font-mono text-xs text-[var(--fg)]">{deleteTarget?.name}</p>
      </Modal>

      <Modal
        open={poolDelete != null}
        onClose={() => setPoolDelete(null)}
        title={t("pages.balancers.poolDeleteTitle", { defaultValue: "Remove the inbound from the balancer?" })}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPoolDelete(null)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmPoolDelete()}>
              {t("delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-muted)]">
          {t("pages.balancers.poolDeleteText", { defaultValue: "Clients stop seeing the balancer address for this inbound." })}
        </p>
      </Modal>
    </PageScaffold>
  );
}

function agentPort(api: string): number {
  try {
    const u = new URL(api);
    return Number(u.port) || 8080;
  } catch {
    return 8080;
  }
}

function PoolModal({
  balancer,
  pool,
  inbounds,
  usedInboundIds,
  onClose,
  onSaved,
}: {
  balancer: Balancer;
  pool: Partial<Pool>;
  inbounds: InboundOption[];
  usedInboundIds: number[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isNew = !pool.id;
  const [inboundId, setInboundId] = useState<number>(pool.inboundId ?? 0);
  const [listenPort, setListenPort] = useState<string>(pool.listenPort ? String(pool.listenPort) : "");
  const [algorithm, setAlgorithm] = useState<Algo>((pool.algorithm as Algo) ?? "roundrobin");
  const [healthCheck, setHealthCheck] = useState(pool.healthCheck ?? true);
  const [proxyProtocol, setProxyProtocol] = useState(pool.proxyProtocol ?? false);
  const [enable, setEnable] = useState(pool.enable ?? true);
  const [subEnabled, setSubEnabled] = useState(pool.subEnabled ?? true);
  const [subMode, setSubMode] = useState<SubMode>((pool.subMode as SubMode) ?? "prepend");
  const [autoMembers, setAutoMembers] = useState(pool.autoMembers ?? true);
  const [members, setMembers] = useState<Member[]>(pool.members ?? []);
  const [saving, setSaving] = useState(false);
  const touchedMembers = useRef(!isNew);

  const selectable = useMemo(
    () => inbounds.filter((i) => i.id === pool.inboundId || !usedInboundIds.includes(i.id)),
    [inbounds, usedInboundIds, pool.inboundId],
  );
  const chosen = inbounds.find((i) => i.id === inboundId);
  const udp = isUdpProtocol(chosen?.protocol);
  const engineBlocksUdp = udp && balancer.engine !== "nginx";

  // New pool: members default to the inbound's nodes.
  useEffect(() => {
    if (!isNew || touchedMembers.current || !chosen) return;
    setMembers(
      (chosen.nodeBindings ?? []).map((b) => ({
        nodeId: b.nodeId,
        nodeName: b.nodeName,
        weight: 1,
        backup: false,
        enable: true,
        addressOverride: "",
        portOverride: 0,
      })),
    );
  }, [isNew, chosen]);

  const patchMember = (nodeId: number, patch: Partial<Member>) => {
    touchedMembers.current = true;
    setMembers((prev) => prev.map((m) => (m.nodeId === nodeId ? { ...m, ...patch } : m)));
  };

  const save = async () => {
    if (!inboundId) {
      toast.error(t("pages.balancers.pickInbound", { defaultValue: "Choose an inbound" }));
      return;
    }
    setSaving(true);
    const port = Number.parseInt(listenPort, 10) || 0;
    const r = await postJson(
      panel("balancer/pool/save"),
      {
        id: pool.id ?? 0,
        balancerId: balancer.id,
        inboundId,
        listenPort: port,
        algorithm,
        healthCheck,
        proxyProtocol: udp ? false : proxyProtocol,
        enable,
        subEnabled,
        subMode,
        autoMembers,
        members: members.map((m) => ({
          nodeId: m.nodeId,
          weight: m.weight,
          backup: m.backup,
          enable: m.enable,
          addressOverride: m.addressOverride,
          portOverride: m.portOverride,
        })),
      },
      true,
    );
    setSaving(false);
    if (!r.success) {
      toast.error(r.msg || t("fail"));
      return;
    }
    await onSaved();
  };

  const modes: { id: string; mode: SubMode; on: boolean; head: string; desc: string }[] = [
    {
      id: "prepend",
      mode: "prepend",
      on: true,
      head: t("pages.balancers.subPrepend", { defaultValue: "Balancer first, then direct nodes" }),
      desc: t("pages.balancers.subPrependDesc", { defaultValue: "The client gets the balancer plus every direct node as a fallback." }),
    },
    {
      id: "append",
      mode: "append",
      on: true,
      head: t("pages.balancers.subAppend", { defaultValue: "Direct nodes first, balancer last" }),
      desc: t("pages.balancers.subAppendDesc", { defaultValue: "Same entries, the balancer is the last one." }),
    },
    {
      id: "replace",
      mode: "replace",
      on: true,
      head: t("pages.balancers.subReplace", { defaultValue: "Balancer only" }),
      desc: t("pages.balancers.subReplaceDesc", { defaultValue: "Node addresses are hidden. If the balancer is down, the client has no route." }),
    },
    {
      id: "hidden",
      mode: "prepend",
      on: false,
      head: t("pages.balancers.subHidden", { defaultValue: "Do not show the balancer" }),
      desc: t("pages.balancers.subHiddenDesc", { defaultValue: "Clients get direct nodes only. The balancer keeps working for those who know its address." }),
    },
  ];

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={isNew ? t("pages.balancers.addPool", { defaultValue: "Put an inbound behind this balancer" }) : t("pages.balancers.editPool", { defaultValue: "Edit inbound in balancer" })}
      width={720}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={engineBlocksUdp} onClick={() => void save()}>
            {t("confirm")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <label className="block text-sm">
          <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.inbound", { defaultValue: "Inbound" })}</span>
          <SelectNative value={inboundId || ""} disabled={!isNew} onChange={(e) => setInboundId(Number(e.target.value))}>
            <option value="">{t("pages.balancers.pickInbound", { defaultValue: "Choose an inbound" })}</option>
            {selectable.map((i) => (
              <option key={i.id} value={i.id}>
                {(i.remark || `#${i.id}`) + ` · ${i.protocol} :${i.port}`}
              </option>
            ))}
          </SelectNative>
        </label>
        {engineBlocksUdp ? <AlertBanner type="error" title={t("pages.balancers.udpNeedsNginx", { defaultValue: "This inbound uses UDP. Switch the balancer engine to nginx." })} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.listenPort", { defaultValue: "Balancer port" })}</span>
            <Input
              inputMode="numeric"
              value={listenPort}
              onChange={(e) => setListenPort(e.target.value.replace(/\D/g, ""))}
              placeholder={chosen ? String(chosen.port) : t("pages.balancers.sameAsInbound", { defaultValue: "same as the inbound" })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.algorithm", { defaultValue: "Distribution" })}</span>
            <SelectNative value={algorithm} onChange={(e) => setAlgorithm(e.target.value as Algo)}>
              <option value="roundrobin">{t("pages.balancers.algoRoundRobin", { defaultValue: "Round robin" })}</option>
              <option value="leastconn">{t("pages.balancers.algoLeastConn", { defaultValue: "Least connections" })}</option>
              <option value="source">{t("pages.balancers.algoSource", { defaultValue: "By client IP (sticky)" })}</option>
            </SelectNative>
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.subscription", { defaultValue: "What the client gets in the subscription" })}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {modes.map((m) => (
              <RadioOptionCard
                key={m.id}
                name="submode"
                heading={m.head}
                description={m.desc}
                checked={m.on ? subEnabled && subMode === m.mode : !subEnabled}
                onChange={() => {
                  setSubEnabled(m.on);
                  if (m.on) setSubMode(m.mode);
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--fg-subtle)]">
            {t("pages.balancers.subNote", {
              defaultValue: "Each direct node can also be hidden from the subscription in the inbound's node settings.",
            })}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--fg-muted)]">{t("pages.balancers.nodes", { defaultValue: "Nodes in the pool" })}</span>
            <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <Switch size="sm" checked={autoMembers} onChange={setAutoMembers} ariaLabel="auto" />
              {t("pages.balancers.autoMembers", { defaultValue: "Follow the inbound's nodes automatically" })}
            </label>
          </div>
          {members.length === 0 ? (
            <p className="text-xs text-[var(--fg-subtle)]">{t("pages.balancers.noMembers", { defaultValue: "No nodes: assign nodes to the inbound first" })}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-elevated)] text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">
                  <tr>
                    <th className="p-2">{t("pages.balancers.node", { defaultValue: "Node" })}</th>
                    <th className="w-16 p-2">{t("pages.balancers.on", { defaultValue: "On" })}</th>
                    <th className="w-20 p-2">{t("pages.balancers.weight", { defaultValue: "Weight" })}</th>
                    <th className="w-20 p-2">{t("pages.balancers.backup", { defaultValue: "backup" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.nodeId} className="border-t border-[var(--border)]">
                      <td className="p-2 text-[var(--fg)]">{m.nodeName ?? `#${m.nodeId}`}</td>
                      <td className="p-2">
                        <Switch size="sm" checked={m.enable} onChange={(v) => patchMember(m.nodeId, { enable: v })} ariaLabel="on" />
                      </td>
                      <td className="p-2">
                        <Input
                          className="!h-8 !px-2 text-xs"
                          inputMode="numeric"
                          value={String(m.weight)}
                          onChange={(e) => patchMember(m.nodeId, { weight: Math.min(256, Number(e.target.value.replace(/\D/g, "")) || 0) })}
                        />
                      </td>
                      <td className="p-2">
                        <Switch size="sm" checked={m.backup} onChange={(v) => patchMember(m.nodeId, { backup: v })} ariaLabel="backup" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-[var(--fg-muted)]">
          <label className="flex items-center gap-2">
            <Switch size="sm" checked={healthCheck} onChange={setHealthCheck} ariaLabel="health" />
            {t("pages.balancers.healthCheck", { defaultValue: "Skip nodes that stop responding" })}
          </label>
          <label className="flex items-center gap-2">
            <Switch size="sm" checked={enable} onChange={setEnable} ariaLabel="enable" />
            {t("pages.balancers.poolEnabled", { defaultValue: "Pool enabled" })}
          </label>
          {!udp ? (
            <label className="flex items-center gap-2">
              <Switch size="sm" checked={proxyProtocol} onChange={setProxyProtocol} ariaLabel="proxy protocol" />
              {t("pages.balancers.proxyProtocol", { defaultValue: "PROXY protocol (real client IP on the nodes)" })}
            </label>
          ) : null}
        </div>
        {proxyProtocol && !udp ? (
          <AlertBanner type="warning" title={t("pages.balancers.proxyProtocolWarn", {
              defaultValue:
                "The inbound must accept PROXY protocol, and then direct connections to that port stop working. Use it only together with “Balancer only”.",
            })} />
        ) : null}
      </div>
    </Modal>
  );
}
