"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { SelectNative, Switch, useToast } from "@/components/ui";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Field as ConfigField } from "@/components/xray/configurator/fields";

/** One configured check: a client-facing connection of a node (or of the whole mesh). */
export type MeshProbeTarget = {
  /** Empty for a check that applies to every exit node. */
  node?: string;
  port: number;
  sni: string;
  /** A check can be switched off without being deleted. */
  on?: boolean;
};

/** A client-facing endpoint of a node, as returned by GET /panel/mesh/probe-presets. */
export type MeshProbeInbound = {
  id: number;
  port: number;
  sni: string;
  protocol?: string;
  remark?: string;
  address?: string;
  /** The endpoint is published on every exit node. */
  universal?: boolean;
  /** Only TLS endpoints with a server name can answer a probe. */
  probeable: boolean;
};

export type MeshProbeNode = {
  name: string;
  /** Human readable name of the node; the mesh name stays internal. */
  label?: string;
  role: string;
  host: string;
  overlay: string;
  inbounds: MeshProbeInbound[];
};

export type MeshProbePresetSet = { nodes: MeshProbeNode[] };

export type MeshProbePathResult = { ok: number; total: number; ms: number };

/** Live result of one configured check. */
export type MeshProbeTargetResult = {
  node: string;
  port: number;
  sni: string;
  direct?: MeshProbePathResult;
  wg?: MeshProbePathResult;
};

export type MeshProbesProps = {
  probes: MeshProbeTarget[];
  setProbes: (next: MeshProbeTarget[]) => void;
  /** Live results, one entry per configured check and exit node. */
  targets?: MeshProbeTargetResult[];
  /** Unix time of the last controller snapshot. */
  snapshotAt?: number;
  /** Bumped by the page to reload the connection list. */
  reload: number;
  mode: "shared" | "nodes";
  operate: boolean;
  tr: (key: string, fallback: string) => string;
  onCreateAll?: () => void;
};

type Tone = "ok" | "warn" | "bad" | "none";

/**
 * Status colors of the mesh topology map (healthy / asymmetric / down) mixed with
 * the colors of the active theme, so a pill stays readable in every light and
 * dark theme and never looks foreign next to the rest of the panel.
 */
const SEMANTIC: Record<Exclude<Tone, "none">, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  bad: "#fb7185",
};

function toneStyle(tone: Tone) {
  const sem = tone === "none" ? null : SEMANTIC[tone];
  if (!sem) {
    return {
      color: "var(--fg-muted)",
      background: "transparent",
      borderColor: "var(--border)",
    };
  }
  return {
    color: `color-mix(in oklab, ${sem} 76%, var(--fg))`,
    background: `color-mix(in oklab, ${sem} 12%, var(--bg-elevated))`,
    borderColor: `color-mix(in oklab, ${sem} 30%, var(--border))`,
  };
}

function ProbePill({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={toneStyle(tone)}
    >
      {children}
    </span>
  );
}

const NONE = "__none__";

export function MeshProbes({
  probes,
  setProbes,
  targets = [],
  snapshotAt,
  reload,
  mode,
  operate,
  tr,
  onCreateAll,
}: MeshProbesProps) {
  const toast = useToast();
  const [data, setData] = useState<MeshProbePresetSet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getJson<MeshProbePresetSet>(panel("mesh/probe-presets"))
      .then((r) => {
        if (!alive) return;
        if (r.success && r.obj) setData(r.obj);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  const shared = mode === "shared";
  const nodes = useMemo(
    () => (data?.nodes || []).filter((n) => n.role === "exit"),
    [data],
  );
  /** Connections published on every exit node: one check covers the whole mesh. */
  const universal = useMemo(() => {
    const out: MeshProbeInbound[] = [];
    (data?.nodes || []).forEach((n) =>
      (n.inbounds || []).forEach((ib) => {
        if (
          ib.universal &&
          !out.some((u) => u.port === ib.port && u.sni === ib.sni)
        ) {
          out.push(ib);
        }
      }),
    );
    return out;
  }, [data]);

  const label = (ib: MeshProbeInbound) => {
    const head = ib.sni
      ? `${ib.port} - ${ib.sni}`
      : `${ib.port} - ${ib.protocol || "connection"}`;
    let tail = ib.remark ? ` - ${ib.remark}` : "";
    if (!ib.sni) tail += ` - ${tr("probesNoTls", "no TLS")}`;
    return head + tail;
  };

  /** The technical mesh name (n10) stays internal, the operator sees the node label. */
  const nodeTitle = (n: MeshProbeNode) => n.label || n.name;

  const optsFor = (scope: string) => {
    if (scope === "") return universal;
    const nd = nodes.find((n) => n.name === scope);
    return nd ? nd.inbounds || [] : [];
  };

  const sharedScopes = useMemo(
    () =>
      universal.length
        ? [
            {
              key: "",
              title: tr("probesAllExits", "All exit nodes"),
              sub: tr("probesSharedHint", "Published on every exit node"),
            },
          ]
        : [],
    [universal.length, tr],
  );

  const nodeScopes = useMemo(() => {
    const out: { key: string; title: string; sub: string }[] = [];
    const seen: Record<string, boolean> = {};
    nodes.forEach((n) => {
      out.push({
        key: n.name,
        title: nodeTitle(n),
        sub: `${n.host} -> ${n.overlay}`,
      });
      seen[n.name] = true;
    });
    /* a check of a node that is not enrolled any more must stay visible */
    probes.forEach((p) => {
      const sc = p.node || "";
      if (sc !== "" && !seen[sc]) {
        out.push({ key: sc, title: sc, sub: "" });
        seen[sc] = true;
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, probes, tr]);

  const pickScopes = shared ? sharedScopes : nodeScopes;
  const [pickNode, setPickNode] = useState<string>(
    shared ? (sharedScopes.length ? sharedScopes[0].key : NONE) : NONE,
  );
  const [pickInb, setPickInb] = useState("");
  const scopeKeys =
    pickScopes.map((sc) => sc.key).join("|") + `#${pickScopes.length}`;
  const lastScope = useRef(pickNode);

  useEffect(() => {
    const valid = pickScopes.some((sc) => sc.key === pickNode);
    if (!valid) {
      /* the shared scope has a single obvious choice, the node list does not */
      setPickNode(shared && pickScopes.length ? pickScopes[0].key : NONE);
      return;
    }
    if (lastScope.current !== pickNode) {
      lastScope.current = pickNode;
      setPickInb("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKeys]);

  const setRow = (i: number, patch: Partial<MeshProbeTarget>) => {
    setProbes(
      probes.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    );
  };

  const usedMap = (scope: string) => {
    const used: Record<string, boolean> = {};
    probes.forEach((p) => {
      if ((p.node || "") === scope) used[`${p.port}|${p.sni}`] = true;
    });
    return used;
  };

  /** Live result of one check: the direct and the overlay path. */
  const targetResult = (scope: string, port: number, sni: string) => {
    const res: {
      direct: { ok: number; total: number; ms: number } | null;
      wg: { ok: number; total: number; ms: number } | null;
      count: number;
    } = { direct: null, wg: null, count: 0 };
    const add = (t: MeshProbeTargetResult) => {
      res.count += 1;
      (["direct", "wg"] as const).forEach((path) => {
        const r = t[path];
        if (!r) return;
        if (!res[path]) res[path] = { ok: 0, total: 0, ms: 0 };
        res[path]!.ok += r.ok || 0;
        res[path]!.total += r.total || 0;
        res[path]!.ms += r.ms || 0;
      });
    };
    targets.forEach((t) => {
      if (t.port !== port || t.sni !== sni) return;
      if (scope === "") {
        if ((t.node || "") !== "") return;
        add(t);
        return;
      }
      if (t.node === scope) add(t);
    });
    (["direct", "wg"] as const).forEach((path) => {
      const r = res[path];
      if (r && r.total) r.ms = Math.round(r.ms / r.total);
    });
    return res;
  };

  /** One colored pill per path, right of the row. */
  const resultPills = (scope: string, p: MeshProbeTarget) => {
    const res = targetResult(scope, p.port, p.sni);
    const pills: ReactNode[] = [];
    (
      [
        ["direct", tr("direct", "Direct")],
        ["wg", tr("wg", "WireGuard")],
      ] as const
    ).forEach(([path, name]) => {
      const r = res[path];
      if (!r) return;
      const dead = r.total > 0 && r.ok === 0;
      const tone: Tone = dead ? "bad" : r.ok === r.total ? "ok" : "warn";
      const text = dead
        ? `${name}: ${tr("probesNoAnswer", "does not answer")}`
        : `${name} ${r.ok}/${r.total}${r.ms ? ` · ${r.ms} ${tr("milliseconds", "ms")}` : ""}`;
      pills.push(
        <ProbePill key={path} tone={tone}>
          {text}
        </ProbePill>,
      );
    });
    if (!pills.length) {
      pills.push(
        <ProbePill key="none" tone="none">
          {tr("probesNoResult", "no data yet")}
        </ProbePill>,
      );
    }
    return (
      <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {pills}
      </span>
    );
  };

  const scopeTitle = (scope: string) => {
    const all = [...sharedScopes, ...nodeScopes];
    for (const sc of all) if (sc.key === scope) return sc.title;
    return scope;
  };

  const saveHint = () =>
    tr(
      "probesSaveHint",
      "Do not forget to press Save configuration at the bottom of the page.",
    );

  const addCheck = () => {
    const opts = pickNode === NONE ? [] : optsFor(pickNode);
    if (!opts.length) return;
    const used = usedMap(pickNode);
    const pick = opts.filter(
      (o) => !used[`${o.port}|${o.sni}`] && o.probeable,
    )[0];
    if (!pick) return;
    /* keep the new check inside the group of its node */
    let at = -1;
    probes.forEach((p, i) => {
      if ((p.node || "") === pickNode) at = i;
    });
    const next = probes.slice();
    next.splice(at + 1, 0, {
      node: pickNode,
      port: pick.port,
      sni: pick.sni,
      on: true,
    });
    setProbes(next);
    toast.success(
      tr(
        "probesAdded",
        "The connection {conn} was added to the checks of {node}",
      )
        .replace("{conn}", label(pick))
        .replace(
          "{node}",
          shared ? tr("probesAllExits", "All exit nodes") : scopeTitle(pickNode),
        ),
      saveHint(),
    );
  };

  const trashBtn = (i: number) => (
    <button
      type="button"
      disabled={!operate}
      title={tr("probesRemove", "Remove check")}
      aria-label={tr("probesRemove", "Remove check")}
      className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1.5 text-[var(--fg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => {
        setProbes(probes.filter((_, j) => j !== i));
        toast.success(tr("probesRemoved", "The check was removed"), saveHint());
      }}
    >
      <Trash2 className="size-4" />
    </button>
  );

  /** One check: [connection] [on/off] [remove] [live result] */
  const row = (scope: string, p: MeshProbeTarget, i: number) => {
    const opts = optsFor(scope);
    const val = `${p.port}|${p.sni}`;
    const known = opts.some((o) => `${o.port}|${o.sni}` === val);
    return (
      <div key={`${scope}-${i}`} className="flex flex-wrap items-center gap-3">
        <SelectNative
          disabled={!operate}
          value={val}
          style={{ width: "26rem", maxWidth: "100%" }}
          onChange={(e) => {
            const parts = String(e.target.value).split("|");
            setRow(i, {
              port: Number(parts[0]),
              sni: parts.slice(1).join("|"),
            });
          }}
        >
          {!known && <option value={val}>{p.port} - {p.sni}</option>}
          {opts.map((o) => (
            <option key={`${o.port}|${o.sni}`} value={`${o.port}|${o.sni}`}>
              {label(o)}
            </option>
          ))}
        </SelectNative>
        <Switch
          size="sm"
          ariaLabel={tr("probesToggle", "Toggle probe")}
          checked={p.on !== false}
          disabled={!operate}
          onChange={(v) => {
            setRow(i, { on: v });
            toast.success(
              v
                ? tr("probesTurnedOn", "The check is on")
                : tr("probesTurnedOff", "The check is off"),
              saveHint(),
            );
          }}
        />
        {trashBtn(i)}
        {resultPills(scope, p)}
      </div>
    );
  };

  /** One block per node: the node on the left, all of its checks on the right. */
  const list = (scopes: { key: string; title: string; sub: string }[]) => (
    <div className="flex flex-col gap-3">
      {scopes.map((sc) => {
        const rows: ReactNode[] = [];
        probes.forEach((p, i) => {
          if ((p.node || "") === sc.key) rows.push(row(sc.key, p, i));
        });
        return (
          <div
            key={`sc${sc.key}`}
            className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4 sm:flex-row sm:items-start sm:gap-4"
          >
            <div
              className="flex min-w-0 flex-col gap-1 sm:shrink-0"
              style={{ width: "15rem" }}
            >
              <h3 className="truncate font-medium">{sc.title}</h3>
              {sc.sub ? (
                <p className="mt-1 truncate font-mono text-xs text-[var(--fg-muted)]">
                  {sc.sub}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-[var(--fg-muted)]">
                {tr("probesCount", "{n} checks").replace(
                  "{n}",
                  String(rows.length),
                )}
              </p>
              {snapshotAt ? (
                <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                  {tr("probesCheckedAgo", "checked {n} s ago").replace(
                    "{n}",
                    String(
                      Math.max(
                        0,
                        Math.floor(Date.now() / 1000 - snapshotAt),
                      ),
                    ),
                  )}
                </p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {rows.length ? (
                rows
              ) : (
                <p className="text-xs text-[var(--fg-muted)]">
                  {tr("probesNoTargets", "No check for this node yet.")}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const addForm = () => {
    if (!pickScopes.length) return null;
    const opts = pickNode === NONE ? [] : optsFor(pickNode);
    const cur = pickInb
      ? opts.filter((o) => `${o.port}|${o.sni}` === pickInb)[0]
      : opts[0];
    const nodeField = shared ? null : (
      <ConfigField label={tr("probesPickNode", "Node")}>
        <SelectNative
          disabled={!operate}
          style={{ width: "16rem" }}
          value={pickNode}
          onChange={(e) => setPickNode(e.target.value)}
        >
          <option value={NONE}>
            {tr("probesChooseNode", "Select a node")}
          </option>
          {pickScopes.map((sc) => (
            <option key={sc.key} value={sc.key}>
              {sc.title}
            </option>
          ))}
        </SelectNative>
      </ConfigField>
    );
    const connField = (
      <ConfigField label={tr("probesPickConn", "Connection")}>
        <SelectNative
          disabled={!operate || !opts.length}
          style={{ width: "26rem", maxWidth: "100%" }}
          value={cur ? `${cur.port}|${cur.sni}` : ""}
          onChange={(e) => setPickInb(e.target.value)}
        >
          {opts.length ? (
            opts.map((o) => (
              <option key={`${o.port}|${o.sni}`} value={`${o.port}|${o.sni}`}>
                {label(o)}
              </option>
            ))
          ) : (
            <option value="">
              {tr("probesChooseConn", "Select a connection")}
            </option>
          )}
        </SelectNative>
      </ConfigField>
    );
    const used = usedMap(pickNode);
    const canAdd = opts.some(
      (o) => !used[`${o.port}|${o.sni}`] && o.probeable,
    );
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          {nodeField}
          {connField}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!operate || !canAdd}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            onClick={addCheck}
          >
            {tr("probesAddCheck", "Add to check")}
          </button>
          {cur && !cur.probeable ? (
            <span className="text-xs" style={{ color: "var(--accent-ambient)" }}>
              {tr(
                "probesNoTlsHint",
                "This connection has no TLS/SNI - only TLS connections can be probed.",
              )}
            </span>
          ) : null}
          {!canAdd && opts.length ? (
            <span className="text-xs text-[var(--fg-muted)]">
              {tr(
                "probesAllAdded",
                "Every checkable connection of this node is already in the list.",
              )}
            </span>
          ) : null}
          {shared ? (
            <span className="text-xs text-[var(--fg-muted)]">
              {tr(
                "probesSharedFormHint",
                "A connection published on every exit node is checked once for the whole mesh.",
              )}
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  const empty = (text: string, action?: () => void) => (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3">
      <p className="text-sm text-[var(--fg-muted)]">{text}</p>
      {action ? (
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          onClick={action}
        >
          {tr("probesCreateAll", "Create a connection for all nodes")}
        </button>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (loading) {
    body = (
      <p className="text-sm text-[var(--fg-muted)]">
        {tr("probesLoading", "Loading connections...")}
      </p>
    );
  } else if (!data) {
    body = (
      <p className="text-sm text-[var(--fg-muted)]">
        {tr(
          "probesLoadFail",
          "Could not load the connections. Check the panel API.",
        )}
      </p>
    );
  } else if (shared) {
    body = sharedScopes.length ? (
      <div className="flex flex-col gap-4">
        {addForm()}
        {list(sharedScopes)}
      </div>
    ) : (
      empty(
        tr(
          "probesNoShared",
          "No connection is published on every exit node yet.",
        ),
        onCreateAll,
      )
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {addForm()}
        {nodeScopes.length ? (
          list(nodeScopes)
        ) : (
          empty(tr("probesNoNodes", "No exit nodes found in the mesh."))
        )}
      </div>
    );
  }

  return <div className="flex flex-col gap-2">{body}</div>;
}
