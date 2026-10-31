"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  cloneElement,
  isValidElement,
  useState,
  type ReactNode,
} from "react";
import { Network, RefreshCw, Database, LogOut, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageScaffold, Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  ConfirmDialog,
  Input,
  SelectNative,
  Spinner,
  Switch,
  Textarea,
  Tabs,
  CheckboxField,
  IconButton,
} from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { useRbac } from "@/lib/rbac";

import {
  Field as ConfigField,
  ToggleRow,
} from "@/components/xray/configurator/fields";
import { MeshHelp } from "@/components/mesh/MeshHelp";
import { MeshOverview } from "@/components/mesh/MeshOverview";
import { type MeshView } from "@/components/mesh/model";
import { LogExplorer, type LogEntry } from "@/components/LogExplorer";

type Settings = {
  enabled: boolean;
  relay_address: string;
  probe_ports: number[];
  sni: string;
  balancer_uuid: string;
  interval: number;
};
type Worker = { id: number; name: string; enable: boolean };
type Balancer = {
  id: number;
  name: string;
  enable: boolean;
  pools?: { id: number; inboundRemark?: string; enable: boolean }[];
};
type Status = MeshView & {
  settings: Settings;
  running?: boolean;
  error?: string;
  busy?: boolean;
  bootstrap_pending?: boolean;
  auto_relay?: boolean;
  auto_balancer?: boolean;
  auto_ip_update?: boolean;
  jobs?: {
    id: string;
    title: string;
    status: string;
    error?: string;
    steps: { t: string; ts?: number; text: string }[];
  }[];
  events?: {
    id: string;
    t: string;
    ts?: number;
    level?: string;
    msg: string;
  }[];
  balancer_error?: string;
};
const defaults: Settings = {
  enabled: false,
  relay_address: "",
  probe_ports: [],
  sni: "",
  balancer_uuid: "",
  interval: 30,
};
function Field({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <ConfigField label={title} hint={hint}>
      {isValidElement<Record<string, unknown>>(children)
        ? cloneElement(children, { "aria-label": title })
        : children}
    </ConfigField>
  );
}
export function MeshPage() {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`pages.mesh.${key}`, { defaultValue: fallback }),
    [t],
  );
  const { can } = useRbac();
  const operate = can("mesh:operate");
  const [multi, setMulti] = useState<boolean | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [settings, setSettings] = useState(defaults);
  const [ports, setPorts] = useState(""),
    [nodes, setNodes] = useState<Worker[]>([]),
    [balancers, setBalancers] = useState<Balancer[]>([]);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [nodeId, setNodeId] = useState(0),
    [role, setRole] = useState("exit");
  const [user, setUser] = useState("root"),
    [port, setPort] = useState(22),
    [password, setPassword] = useState(""),
    [privateKey, setPrivateKey] = useState("");
  const [hostKeyType, setHostKeyType] = useState("");
  const [fingerprint, setFingerprint] = useState(""),
    [trusted, setTrusted] = useState(false),
    [members, setMembers] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: string;
    body: object;
  } | null>(null);
  const [tab, setTab] = useState("network");
  const initialized = useRef(false),
    alive = useRef(true);
  const load = useCallback(async () => {
    const r = await getJson<Status>(panel("mesh/status"));
    if (!r.success) throw new Error(r.msg);
    if (!alive.current) return;
    setStatus(r.obj);
    if (!initialized.current) {
      setSettings(r.obj.settings);
      setPorts(r.obj.settings.probe_ports.join(", "));
      initialized.current = true;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const mode = await postJson<{ multiNodeMode: boolean }>(
          panel("setting/all"),
        );
        if (!mode.success) throw new Error(mode.msg);
        if (!alive.current) return;
        setMulti(Boolean(mode.obj.multiNodeMode));
        if (!mode.obj.multiNodeMode) return;
        await load();
        if (can("nodes:read")) {
          const r = await getJson<Worker[]>(panel("node/list"));
          if (alive.current && r.success) setNodes(r.obj ?? []);
        }
        if (can("balancers:read")) {
          const r = await getJson<Balancer[]>(panel("balancer/list"));
          if (alive.current && r.success) setBalancers(r.obj ?? []);
        }
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof Error
              ? e.message
              : tr("loadError", "Could not load mesh status"),
          );
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [can, load, tr]);
  useEffect(() => {
    if (!multi) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await load();
      } catch {
        if (active) setError(tr("loadError", "Could not load mesh status"));
      }
      if (active) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [multi, load, tr]);
  useEffect(() => {
    setFingerprint("");
    setTrusted(false);
  }, [nodeId, port]);
  const mutate = async (path: string, body: object) => {
    setPending(true);
    setError("");
    try {
      const r = await postJson(panel(`mesh/${path}`), body, true);
      if (!r.success) throw new Error(r.msg);
      await load();
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : tr("actionError", "Mesh operation failed"),
      );
      return false;
    } finally {
      setPending(false);
    }
  };
  const action = (name: string, body: object) => mutate(`action/${name}`, body);
  const busy =
    pending ||
    status?.busy ||
    (status?.jobs ?? []).some((j) => j.status === "running");
  const names = Object.keys(status?.enrolled ?? {}),
    label = (name: string) =>
      nodes.find((n) => `n${n.id}` === name)?.name ?? name;
  const ask = (
    title: string,
    description: string,
    action: string,
    body: object,
  ) => setConfirm({ title, description, action, body });
  const journal = useMemo<LogEntry[]>(
    () =>
      [
        ...(status?.events || []).map((e) => ({
          ts: e.ts || Date.parse(e.t.replace(" ", "T") + "Z"),
          source: "mesh",
          component: "controller",
          level:
            e.level || (/ошиб|error|failed/i.test(e.msg) ? "error" : "info"),
          message: e.msg,
        })),
        ...(status?.jobs || []).flatMap((j) => [
          ...j.steps.map((step) => ({
            ts: step.ts || NaN,
            source: "mesh",
            component: "operation",
            level: "info",
            message: `${j.title}: ${step.text}`,
          })),
          ...(j.error
            ? [
                {
                  ts: j.steps.at(-1)?.ts || NaN,
                  source: "mesh",
                  component: "operation",
                  level: "error",
                  message: `${j.title}: ${j.error}`,
                },
              ]
            : []),
        ]),
      ].filter((e) => Number.isFinite(e.ts)),
    [status?.events, status?.jobs],
  );
  return (
    <PageScaffold>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            <Network className="size-6 text-[var(--accent)]" />
            {tr("title", "Mesh & relays")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--fg-muted)]">
            {tr(
              "intro",
              "Private networking, automatic transit and managed relays between selected worker nodes.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MeshHelp />
          <Button
            disabled={!multi || pending}
            onClick={() =>
              void load().catch(() =>
                setError(tr("loadError", "Could not load mesh status")),
              )
            }
          >
            <RefreshCw className="size-4" />
            {tr("refresh", "Refresh")}
          </Button>
          {multi && operate && (
            <Button variant="primary" onClick={() => setTab("nodes")}>
              {tr("enroll", "Add a worker to mesh")}
            </Button>
          )}
        </div>
      </header>
      {error && <AlertBanner type="error" title={error} />}
      {multi === null ? (
        <Spinner />
      ) : !multi ? (
        <Surface>
          {tr(
            "standalone",
            "Mesh is unavailable in standalone mode. Enable multi-node mode to manage networking between worker nodes.",
          )}
        </Surface>
      ) : (
        <div className="space-y-5">
          <Tabs
            active={tab}
            onChange={setTab}
            layoutId="mesh-tabs"
            tabs={[
              { id: "network", label: tr("networkMap", "Network topology") },
              { id: "nodes", label: tr("nodes", "Mesh nodes") },
              { id: "automation", label: tr("automation", "Automation") },
              { id: "events", label: tr("journal", "Journal") },
              { id: "settings", label: tr("settings", "Settings") },
            ]}
          />
          {status?.error && <AlertBanner type="warning" title={status.error} />}
          {!status?.running && tab !== "settings" && (
            <Surface>
              <p className="mb-4 text-sm text-[var(--fg-muted)]">
                {tr("stopped", "Stopped")}
              </p>
              <Button onClick={() => setTab("settings")}>
                {tr("settings", "Settings")}
              </Button>
            </Surface>
          )}
          {tab === "settings" && (
            <Surface>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">
                    {tr("controller", "Mesh controller")}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--fg-muted)]">
                    {status?.running
                      ? tr("running", "Running inside the panel")
                      : tr("stopped", "Stopped")}
                  </p>
                </div>
                <Switch
                  ariaLabel={tr("enabled", "Enable mesh")}
                  checked={settings.enabled}
                  disabled={!operate || busy}
                  onChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
                />
              </div>
              {(status?.jobs || []).some((j) => j.status === "running") && (
                <Surface>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm">
                      <Spinner />
                      {
                        (status?.jobs || []).find((j) => j.status === "running")
                          ?.title
                      }
                    </span>
                    <Button onClick={() => setTab("events")}>
                      {tr("journal", "Journal")}
                    </Button>
                  </div>
                </Surface>
              )}
              {status?.error && (
                <p role="status" className="mt-3 text-sm">
                  {status.error}
                </p>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Field
                  title={tr("relayAddress", "Relay address (entry nodes)")}
                >
                  <Input
                    disabled={!operate}
                    value={settings.relay_address}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        relay_address: e.target.value,
                      }))
                    }
                    placeholder="relay.example.com"
                  />
                </Field>
                <Field title={tr("pool", "Managed balancer pool")}>
                  <SelectNative
                    disabled={!operate}
                    value={settings.balancer_uuid}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        balancer_uuid: e.target.value,
                      }))
                    }
                  >
                    <option value="">
                      {tr("noPool", "Do not manage a pool")}
                    </option>
                    {balancers
                      .filter((b) => b.enable)
                      .flatMap((b) =>
                        (b.pools ?? [])
                          .filter((p) => p.enable)
                          .map((p) => (
                            <option key={p.id} value={`pool-${p.id}`}>
                              {b.name} · {p.inboundRemark || `#${p.id}`}
                            </option>
                          )),
                      )}
                  </SelectNative>
                </Field>
                <Field title={tr("sni", "TLS probe SNI")}>
                  <Input
                    disabled={!operate}
                    value={settings.sni}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, sni: e.target.value }))
                    }
                    placeholder="probe.example.com"
                  />
                </Field>
                <Field title={tr("ports", "TLS probe ports (comma-separated)")}>
                  <Input
                    disabled={!operate}
                    value={ports}
                    onChange={(e) => setPorts(e.target.value)}
                  />
                </Field>
              </div>
              <p className="mt-3 text-sm text-[var(--fg-muted)]">
                {tr(
                  "probeHelp",
                  "Use ports that answer HTTPS with this SNI on every exit. Leave empty for overlay monitoring only. TCP connect alone does not prove a working path.",
                )}
              </p>
              {operate && (
                <Button
                  className="mt-4 min-h-11"
                  variant="primary"
                  loading={pending}
                  disabled={busy}
                  onClick={() =>
                    void mutate("settings", {
                      ...settings,
                      probe_ports: ports
                        .split(",")
                        .filter((p) => p.trim())
                        .map(Number),
                    })
                  }
                >
                  {tr("save", "Save configuration")}
                </Button>
              )}
            </Surface>
          )}
          {status?.running && (
            <>
              {tab === "network" && (
                <MeshOverview
                  view={status}
                  label={label}
                  busy={busy}
                  operate={operate}
                  action={action}
                  manage={() => setTab("nodes")}
                />
              )}
              {tab === "automation" && (
                <Surface>
                  <h2 className="font-semibold">
                    {tr("automation", "Automation")}
                  </h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    {(
                      [
                        [
                          "auto_relay",
                          "autoRelay",
                          "Switch relays automatically",
                        ],
                        [
                          "auto_balancer",
                          "autoBalancer",
                          "Exclude unreachable nodes from the selected pool",
                        ],
                        [
                          "auto_ip_update",
                          "autoIP",
                          "Follow a node's public IP",
                        ],
                      ] as const
                    ).map(([flag, key, fallback]) => (
                      <ToggleRow
                        key={flag}
                        label={tr(key, fallback)}
                        hint={tr(`${key}Hint`, "")}
                        checked={Boolean(status[flag])}
                        disabled={!operate || busy || !status.quorum?.quorum}
                        onChange={(v) => void action("flags", { [flag]: v })}
                      />
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-[var(--fg-muted)]">
                    {tr(
                      "ipHelp",
                      "IP updates require the agent to stay online and report its new address. DNS is managed separately. Manual pool exclusions remain unchanged.",
                    )}
                  </p>
                  {status.balancer_error && settings.balancer_uuid && (
                    <p role="status" className="mt-3 text-sm">
                      {status.balancer_error}
                    </p>
                  )}
                </Surface>
              )}
              {tab === "nodes" && (
                <Surface>
                  <h2 className="font-semibold">{tr("nodes", "Mesh nodes")}</h2>
                  {!names.length && (
                    <p className="mt-3 text-sm text-[var(--fg-muted)]">
                      {tr(
                        "empty",
                        "Add existing workers below. The panel itself never joins the overlay.",
                      )}
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-[var(--fg-muted)]">
                    {tr(
                      "nodeActionsHint",
                      "Relay mode affects exit publication, not mesh transit. etcd membership is independent of entry/exit roles. Remove an etcd member before removing its mesh agent.",
                    )}
                  </p>
                  <div className="mt-4 grid gap-3">
                    {names.map((name) => {
                      const n = status.enrolled![name],
                        top = status.topology?.nodes.find(
                          (v) => v.name === name,
                        ),
                        member = status.quorum?.members.some(
                          (m) => m.name === name,
                        ),
                        age = top?.agent_age;
                      return (
                        <div
                          key={name}
                          className="rounded-xl border border-[var(--border)] p-4"
                        >
                          <div className="flex flex-wrap justify-between gap-4">
                            <div>
                              <h3 className="font-medium">
                                {label(name)} ·{" "}
                                {n.role === "entry"
                                  ? tr("entry", "Entry")
                                  : tr("exit", "Exit")}
                              </h3>
                              <p className="mt-1 break-all font-mono text-xs">
                                {n.host} → {n.overlay}
                              </p>
                              <p className="mt-1 text-sm text-[var(--fg-muted)]">
                                {age == null
                                  ? tr("awaiting", "Waiting for agent")
                                  : age < 30
                                    ? tr("online", "Agent online")
                                    : `${tr("stale", "Last report")} ${age} ${tr("seconds", "s")}`}
                                {member ? " · etcd" : ""}
                                {status.relays?.[name]?.pending
                                  ? ` · ${tr("recovering", "Relay operation pending")}`
                                  : ""}
                              </p>
                            </div>
                            {operate && (
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {n.role === "exit" && (
                                  <SelectNative
                                    className="!w-40 shrink-0"
                                    aria-label={`${tr("relayMode", "Relay mode")} ${label(name)}`}
                                    disabled={busy || !status.quorum?.quorum}
                                    value={status.relay_modes?.[name] ?? "auto"}
                                    onChange={(e) =>
                                      void action("relay", {
                                        exit: name,
                                        mode: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="auto">
                                      {tr("auto", "Automatic")}
                                    </option>
                                    <option value="direct">
                                      {tr("direct", "Direct")}
                                    </option>
                                    <option value="relay">
                                      {tr("relay", "Relay")}
                                    </option>
                                  </SelectNative>
                                )}
                                <IconButton
                                  label={
                                    member && (status.quorum?.size ?? 0) <= 3
                                      ? tr(
                                          "minVotersHint",
                                          "Cannot remove: at least three healthy voters must remain",
                                        )
                                      : member
                                        ? tr("removeEtcd", "Remove from etcd")
                                        : tr("addEtcd", "Add to etcd")
                                  }
                                  className="!h-10 !w-10 border border-[var(--border)] bg-[var(--bg-elevated)]"
                                  disabled={
                                    busy ||
                                    !status.quorum?.quorum ||
                                    (member && (status.quorum?.size ?? 0) <= 3)
                                  }
                                  onClick={() =>
                                    ask(
                                      member
                                        ? tr("removeEtcd", "Remove from etcd")
                                        : tr("addEtcd", "Add to etcd"),
                                      tr(
                                        "etcdHelp",
                                        "A new member joins as a learner and votes after synchronization. Removal must leave at least three healthy voters. Node data is preserved.",
                                      ),
                                      "etcd",
                                      { name, member: !member },
                                    )
                                  }
                                >
                                  {member ? (
                                    <LogOut size={17} />
                                  ) : (
                                    <Database size={17} />
                                  )}
                                </IconButton>
                                <IconButton
                                  label={
                                    member
                                      ? tr(
                                          "removeAgentMemberHint",
                                          "Remove this node from etcd before removing its mesh agent",
                                        )
                                      : tr("remove", "Remove mesh from node")
                                  }
                                  className="!h-10 !w-10 border border-[var(--border)] bg-[var(--bg-elevated)] !text-rose-400"
                                  disabled={busy || member}
                                  onClick={() =>
                                    ask(
                                      tr("remove", "Remove mesh from node"),
                                      tr(
                                        "removeHelp",
                                        "Stops this panel's mesh agent and links. Worker services and etcd data are preserved.",
                                      ),
                                      "remove",
                                      { name },
                                    )
                                  }
                                >
                                  <Trash2 size={17} />
                                </IconButton>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-6 border-t border-[var(--border)] pt-4">
                    <h3 className="font-semibold">
                      etcd · {status.quorum?.healthy ?? 0}/
                      {status.quorum?.size ?? 0}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--fg-muted)]">
                      {tr(
                        "quorumHelp",
                        "Choose three installed nodes for the initial quorum. Clients and peers use mTLS from the start.",
                      )}
                    </p>
                    <p className="mt-2 text-xs text-[var(--fg-subtle)]">
                      {tr(
                        "membershipHint",
                        "Adding a member installs etcd as a learner and promotes it after synchronization. Removing a voter is disabled when only three remain.",
                      )}
                    </p>
                    {(!status.quorum?.size || status.bootstrap_pending) &&
                      operate && (
                        <>
                          <div className="my-4 flex flex-wrap gap-4">
                            {names.map((name) => (
                              <CheckboxField
                                key={name}
                                label={label(name)}
                                className="min-h-11"
                                checked={members.includes(name)}
                                onChange={(e) =>
                                  setMembers((v) =>
                                    e.target.checked
                                      ? [...v, name]
                                      : v.filter((n) => n !== name),
                                  )
                                }
                              />
                            ))}
                          </div>
                          <Button
                            className="min-h-11"
                            disabled={
                              busy || ![3, 5, 7].includes(members.length)
                            }
                            onClick={() =>
                              ask(
                                tr("bootstrap", "Install initial etcd quorum"),
                                tr(
                                  "bootstrapHelp",
                                  "Installs a new isolated etcd on selected nodes. Existing etcd containers and data are never overwritten.",
                                ),
                                "bootstrap",
                                { names: members },
                              )
                            }
                          >
                            {tr("bootstrap", "Install initial etcd quorum")}
                          </Button>
                        </>
                      )}
                  </div>
                </Surface>
              )}
              {tab === "nodes" && operate && (
                <Surface>
                  <h2 className="font-semibold">
                    {tr("enroll", "Add a worker to mesh")}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--fg-muted)]">
                    {tr(
                      "enrollHelp",
                      "SSH credentials are used once. Installs the panel's own SSH identity, a mesh agent and isolated WireGuard links. Requires Linux with systemd and root or passwordless sudo.",
                    )}
                  </p>
                  <form
                    className="mt-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action("enroll", {
                        nodeId,
                        role,
                        user,
                        sshPort: port,
                        password,
                        privateKey,
                        fingerprint,
                        keyType: hostKeyType,
                      }).then((ok) => {
                        if (ok) {
                          setPassword("");
                          setPrivateKey("");
                          setTrusted(false);
                        }
                      });
                    }}
                  >
                    <Field
                      title={tr("worker", "Registered worker")}
                      hint={tr(
                        "workerHint",
                        "Select an enabled worker already registered in the panel. The panel itself does not join mesh.",
                      )}
                    >
                      <SelectNative
                        value={nodeId}
                        onChange={(e) => setNodeId(Number(e.target.value))}
                      >
                        <option value={0}>
                          {tr("choose", "Choose a node")}
                        </option>
                        {nodes
                          .filter((n) => n.enable)
                          .map((n) => (
                            <option value={n.id} key={n.id}>
                              {n.name}
                            </option>
                          ))}
                      </SelectNative>
                    </Field>
                    <Field
                      title={tr("role", "Mesh role")}
                      hint={tr(
                        "roleHint",
                        "Entry nodes check exit availability and accept relay traffic. Exit nodes provide worker services. Both can carry mesh transit.",
                      )}
                    >
                      <SelectNative
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                      >
                        <option value="entry">{tr("entry", "Entry")}</option>
                        <option value="exit">{tr("exit", "Exit")}</option>
                      </SelectNative>
                    </Field>
                    <Field
                      title={tr("sshUser", "SSH user")}
                      hint={tr(
                        "sshHint",
                        "Installation requires root or passwordless sudo. SSH credentials are used once.",
                      )}
                    >
                      <Input
                        value={user}
                        autoComplete="off"
                        onChange={(e) => setUser(e.target.value)}
                      />
                    </Field>
                    <Field
                      title={tr("sshPort", "SSH port")}
                      hint={tr(
                        "sshPortHint",
                        "SSH management port on this worker; unrelated to WireGuard and service ports.",
                      )}
                    >
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Button
                        className="min-h-11"
                        disabled={!nodeId || busy}
                        onClick={() => {
                          setPending(true);
                          setTrusted(false);
                          void postJson<{
                            fingerprint: string;
                            keyType: string;
                          }>(panel("mesh/ssh-hostkey"), { nodeId, port }, true)
                            .then((r) => {
                              if (!r.success) throw new Error(r.msg);
                              setFingerprint(r.obj.fingerprint);
                              setHostKeyType(r.obj.keyType);
                            })
                            .catch((e) =>
                              setError(
                                e instanceof Error
                                  ? e.message
                                  : tr("actionError", "Mesh operation failed"),
                              ),
                            )
                            .finally(() => setPending(false));
                        }}
                      >
                        {tr("fingerprint", "Read SSH host key")}
                      </Button>
                      {fingerprint && (
                        <>
                          <p className="my-3 break-all font-mono text-xs">
                            {fingerprint}
                          </p>
                          <CheckboxField
                            className="min-h-11"
                            checked={trusted}
                            onChange={(e) => setTrusted(e.target.checked)}
                            label={tr(
                              "trust",
                              "I verified this SSH fingerprint against the server",
                            )}
                          />
                        </>
                      )}
                    </div>
                    {trusted && (
                      <>
                        <Field title={tr("password", "One-time SSH password")}>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </Field>
                        <Field
                          title={tr("key", "Or a one-time SSH private key")}
                        >
                          <Textarea
                            autoComplete="off"
                            value={privateKey}
                            onChange={(e) => setPrivateKey(e.target.value)}
                          />
                        </Field>
                      </>
                    )}
                    <div>
                      <Button
                        className="min-h-11"
                        type="submit"
                        variant="primary"
                        loading={pending}
                        disabled={
                          busy ||
                          !trusted ||
                          !nodeId ||
                          !(password || privateKey)
                        }
                      >
                        {tr("install", "Install mesh agent")}
                      </Button>
                    </div>
                  </form>
                </Surface>
              )}
              {tab === "events" && (
                <Surface>
                  <h2 className="mb-4 font-semibold">
                    {tr("journal", "Journal")}
                  </h2>
                  <p className="mb-4 text-xs text-[var(--fg-muted)]">
                    {tr(
                      "journalHelp",
                      "Controller events and operation steps retained by mesh. Use filters or download the displayed journal.",
                    )}
                  </p>
                  <LogExplorer
                    source={{ type: "panel", id: 0 }}
                    entries={journal}
                    defaultRange="all"
                  />
                </Surface>
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={tr("continue", "Continue")}
        cancelLabel={tr("cancel", "Cancel")}
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm && (await action(confirm.action, confirm.body)))
            setConfirm(null);
        }}
      />
    </PageScaffold>
  );
}
