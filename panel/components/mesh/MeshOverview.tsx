"use client";
import { useState, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { Network, Activity, Route, Database } from "lucide-react";
import { Surface } from "@/components/panel";
import { Button, Input, PillTag, SelectNative } from "@/components/ui";
import {
  freshAgent,
  linkMetric,
  meshEdges,
  meshTransits,
  radialLayout,
  type MeshView,
} from "./model";

import styles from "./mesh-map.module.css";

const colors = {
  healthy: "#34d399",
  asymmetric: "#fbbf24",
  down: "#fb7185",
  unknown: "#71717a",
};
export function MeshOverview({
  view,
  label,
  busy,
  operate,
  action,
  manage,
}: {
  view: MeshView;
  label: (name: string) => string;
  busy: boolean | undefined;
  operate: boolean;
  action: (name: string, body: object) => Promise<boolean>;
  manage: () => void;
}) {
  const { t, i18n } = useTranslation();
  const markerId = `mesh-arrow-${useId().replaceAll(":", "")}`;
  const [motion, setMotion] = useState(true);
  const [hovered, hover] = useState("");
  const tr = (key: string, fallback: string) =>
    t(`pages.mesh.${key}`, { defaultValue: fallback });
  const [selected, select] = useState("");
  const focused = hovered || selected;
  const [query, search] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      5000,
    );
    return () => clearInterval(timer);
  }, []);
  const nodes = view.enrolled || {},
    names = Object.keys(nodes).sort();
  const edges = meshEdges(view, now),
    transits = meshTransits(view, now);
  const filtered = names.filter((n) =>
    `${label(n)} ${nodes[n].host} ${nodes[n].overlay}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  // A bounded map stays legible; search and the full tables keep larger inventories accessible.
  const visible = filtered.slice(0, 24);
  const { height, positions } = radialLayout(nodes, visible);
  const selectedEdge = edges.find((e) => e.id === selected);
  const selectedNode = nodes[selected];
  const titles = {
    healthy: tr("bidirectional", "Bidirectional"),
    asymmetric: tr("asymmetric", "Asymmetric"),
    down: tr("down", "Unavailable"),
    unknown: tr("unknown", "No fresh data"),
  };
  const cycleAge = view.last_cycle ? now - view.last_cycle : null;
  const quorumFresh =
    !!view.quorum?.observed_at && now - view.quorum.observed_at < 90;
  const probesFresh = cycleAge != null && cycleAge < 90;
  const stats = [
    {
      icon: Network,
      title: tr("agents", "Agents online"),
      value: `${names.filter((n) => freshAgent(view, n, now)).length}/${names.length}`,
      note: tr("agentWindow", "Reports within 60 seconds"),
    },
    {
      icon: Activity,
      title: tr("links", "Links & transit"),
      value: `${edges.filter((e) => e.state === "healthy").length}/${edges.length}`,
      note: tr("bothDirections", "Healthy in both directions"),
    },
    {
      icon: Route,
      title: tr("activeTransit", "Active transit routes"),
      value: transits.length,
      note: tr("transitNote", "Directed routes through another node"),
    },
    {
      icon: Database,
      title: "etcd",
      value: `${view.quorum?.healthy ?? 0}/${view.quorum?.size ?? 0}`,
      note:
        view.quorum?.quorum && quorumFresh
          ? tr("quorumOK", "Quorum available")
          : tr("quorumLost", "Quorum unavailable"),
    },
  ];
  const badge = (healthy: boolean | null | undefined) => (
    <PillTag tone={healthy == null ? "neutral" : healthy ? "green" : "rose"}>
      {healthy == null
        ? tr("unknown", "No fresh data")
        : healthy
          ? tr("available", "Available")
          : tr("down", "Unavailable")}
    </PillTag>
  );
  const probe = (exit: string, path: string) => {
    const results = Object.entries(view.probe_matrix || {})
      .map(([entry, exits]) => ({ entry, result: exits[exit]?.[path] }))
      .filter((v) => v.result);
    const total = results.reduce((sum, v) => sum + v.result.total, 0),
      ok = results.reduce((sum, v) => sum + v.result.ok, 0);
    return (
      <span
        title={results
          .map((v) => `${label(v.entry)}: ${v.result.ok}/${v.result.total}`)
          .join("\n")}
        className="font-mono text-xs"
      >
        {total ? `${ok}/${total} HTTPS` : "—"}
      </span>
    );
  };
  const milliseconds = tr("milliseconds", "ms");
  const seconds = tr("seconds", "s");
  const metric = (link: Parameters<typeof linkMetric>[0]) =>
    linkMetric(link, milliseconds, i18n.language);
  const reasons: Record<string, string> = {
    manual: tr("reasonManual", "Manual selection"),
    "manual mode": tr("reasonManual", "Manual selection"),
    "node removed": tr("reasonRemoved", "Node removed"),
    "automatic path health": tr("reasonHealth", "Automatic path health check"),
    "new placement hosts": tr("reasonNewHosts", "New placement hosts"),
  };
  const reasonLabel = (reason: string) => reasons[reason] || reason;
  const th =
    "whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-[var(--fg-muted)]";
  const td = "px-4 py-3 text-sm";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Surface key={s.title}>
            <div className="flex items-center justify-between text-sm text-[var(--fg-muted)]">
              <span>{s.title}</span>
              <s.icon className="size-4 text-[var(--accent)]" />
            </div>
            <div className="my-2 text-3xl font-semibold tabular-nums">
              {s.value}
            </div>
            <p className="text-xs text-[var(--fg-muted)]">{s.note}</p>
          </Surface>
        ))}
      </div>
      <Surface padding="none">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div>
            <h2 className="font-semibold">
              {tr("networkMap", "Network topology")}
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {tr(
                "mapHelp",
                "Select a node or link to inspect both directions. Dotted blue paths show active transit.",
              )}
            </p>
          </div>
          <Input
            aria-label={tr("searchNodes", "Find a node or IP")}
            placeholder={tr("searchNodes", "Find a node or IP")}
            value={query}
            onChange={(e) => search(e.target.value)}
            className="!w-52"
          />
        </div>
        <div className="flex flex-wrap gap-4 px-5 pt-4 text-xs text-[var(--fg-muted)]">
          {Object.entries(titles).map(([key, title]) => (
            <span key={key} className="flex items-center gap-2">
              <span
                className="h-0.5 w-5"
                style={{ background: colors[key as keyof typeof colors] }}
              />
              {title}
            </span>
          ))}
          <span className="text-sky-400">⇢ {tr("transit", "Transit")}</span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-violet-500" />
            {tr("entry", "Entry")}
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-cyan-600" />
            {tr("exit", "Exit")}
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-orange-400" />
            {tr("relay", "Relay")}
          </span>
          <span>◎ etcd</span>
          <button
            type="button"
            aria-pressed={motion}
            onClick={() => setMotion((v) => !v)}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--fg)]"
            title={tr(
              "motionHelp",
              "Motion indicates link availability, not measured traffic volume.",
            )}
          >
            {motion
              ? tr("motionOn", "Link motion: on")
              : tr("motionOff", "Link motion: off")}
          </button>
          {selected && (
            <button
              type="button"
              onClick={() => select("")}
              className="rounded-md border border-[var(--border)] px-2 py-1"
            >
              {tr("clearSelection", "Clear selection")}
            </button>
          )}
          <span className="text-amber-400">♛ {tr("leader", "Leader")}</span>
        </div>
        {!visible.length ? (
          <div className="p-12 text-center text-sm text-[var(--fg-muted)]">
            {tr(
              "emptyMap",
              "No matching mesh nodes. Add registered workers to begin.",
            )}
          </div>
        ) : (
          <div className="overflow-x-auto p-3">
            <div
              className={`relative mx-auto min-w-[640px] max-w-[980px] ${motion ? "" : styles.paused}`}
              style={{ height }}
            >
              <svg
                aria-label={tr("networkMap", "Network topology")}
                className="absolute inset-0 h-full w-full"
                viewBox={`0 0 1000 ${height}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <marker
                    id={markerId}
                    viewBox="0 0 10 10"
                    refX="5"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                  </marker>
                </defs>
                {edges
                  .filter((e) => positions[e.a] && positions[e.b])
                  .map((e) => {
                    const a = positions[e.a],
                      b = positions[e.b];
                    const x1 = a.x * 10,
                      x2 = b.x * 10;
                    const d = `M ${x1} ${a.y} L ${x2} ${b.y}`;
                    const active =
                      !focused ||
                      focused === e.id ||
                      focused === e.a ||
                      focused === e.b;
                    return (
                      <g
                        key={e.id}
                        opacity={active ? 1 : 0.15}
                        className={styles.edge}
                      >
                        <path
                          d={d}
                          fill="none"
                          stroke={colors[e.state]}
                          strokeWidth={focused && active ? 3 : 1.5}
                          opacity={active ? 0.8 : 0.65}
                          strokeDasharray={
                            e.state === "healthy" ? "6 6" : "4 5"
                          }
                          vectorEffect="non-scaling-stroke"
                        />
                        {active &&
                          (e.state === "healthy" ||
                            e.state === "asymmetric") && (
                            <>
                              {e.ab?.ok && (
                                <path
                                  d={d}
                                  fill="none"
                                  stroke={colors[e.state]}
                                  strokeWidth="2.5"
                                  strokeDasharray="8 96"
                                  vectorEffect="non-scaling-stroke"
                                  className={styles.flow}
                                />
                              )}
                              {e.ba?.ok && (
                                <path
                                  d={d}
                                  fill="none"
                                  stroke={colors[e.state]}
                                  strokeWidth="2.5"
                                  strokeDasharray="8 96"
                                  vectorEffect="non-scaling-stroke"
                                  className={`${styles.flow} ${styles.reverse}`}
                                />
                              )}
                            </>
                          )}
                        {focused && active && visible.length <= 8 && (
                          <text
                            x={(x1 + x2) / 2}
                            y={(a.y + b.y) / 2 - 8}
                            textAnchor="middle"
                            fill={colors[e.state]}
                            fontSize="11"
                            style={{
                              paintOrder: "stroke",
                              stroke: "var(--bg-elevated)",
                              strokeWidth: 5,
                            }}
                            pointerEvents="none"
                          >
                            {e.state === "healthy" &&
                            e.ab?.rtt != null &&
                            e.ba?.rtt != null
                              ? `${Math.max(e.ab.rtt, e.ba.rtt).toLocaleString(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${milliseconds}`
                              : titles[e.state]}
                          </text>
                        )}
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth="18"
                          role="button"
                          tabIndex={0}
                          aria-label={`${label(e.a)} ↔ ${label(e.b)}: ${titles[e.state]}`}
                          aria-pressed={selected === e.id}
                          onMouseEnter={() => hover(e.id)}
                          onMouseLeave={() => hover("")}
                          onFocus={() => hover(e.id)}
                          onBlur={() => hover("")}
                          onClick={() => select(e.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              select(e.id);
                            }
                          }}
                          className={styles.hit}
                        />
                      </g>
                    );
                  })}
                {transits
                  .filter(
                    (r) =>
                      positions[r.from] && positions[r.via] && positions[r.to],
                  )
                  .map((r) => {
                    const a = positions[r.from],
                      b = positions[r.via],
                      c = positions[r.to];
                    return (
                      <path
                        key={`${r.from}:${r.to}`}
                        d={`M ${a.x * 10} ${a.y} L ${b.x * 10} ${b.y} L ${c.x * 10} ${c.y}`}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3"
                        strokeDasharray="12 12"
                        markerMid={`url(#${markerId})`}
                        className={styles.transit}
                        opacity=".9"
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>
                          {label(r.from)} → {label(r.via)} → {label(r.to)}
                        </title>
                      </path>
                    );
                  })}
              </svg>
              {visible.map((name) => {
                const p = positions[name],
                  member = view.quorum?.members.find((m) => m.name === name),
                  online = freshAgent(view, name, now);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => select(name)}
                    aria-pressed={selected === name}
                    onMouseEnter={() => hover(name)}
                    onMouseLeave={() => hover("")}
                    onFocus={() => hover(name)}
                    onBlur={() => hover("")}
                    style={{
                      opacity:
                        focused &&
                        focused !== name &&
                        !edges.some(
                          (e) =>
                            e.id === focused && (e.a === name || e.b === name),
                        ) &&
                        !edges.some(
                          (e) =>
                            e.id === selected && (e.a === name || e.b === name),
                        )
                          ? 0.55
                          : 1,
                      left: `${p.x}%`,
                      top: p.y,
                      transform: "translate(-50%, -50%)",
                    }}
                    title={`${label(name)} · ${nodes[name].role === "entry" ? tr("entry", "Entry") : tr("exit", "Exit")}
${nodes[name].host} → ${nodes[name].overlay}
${online ? tr("online", "Agent online") : tr("unknown", "No fresh data")}${member ? " · etcd" : ""}${member?.leader ? ` · ${tr("leader", "Leader")}` : ""}${view.relays?.[name]?.on ? ` · ${tr("relay", "Relay")}` : ""}`}
                    className={`${styles.node} absolute flex size-16 items-center justify-center rounded-full border-2 p-1 text-center text-white shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] ${online ? (nodes[name].role === "entry" ? "bg-violet-600" : "bg-cyan-600") : "bg-zinc-600"} ${selected === name ? "border-white" : "border-transparent"}`}
                  >
                    {member && (
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute -inset-2 rounded-full border-2 ${member.leader ? `border-amber-400 ${styles.leader}` : "border-zinc-400"}`}
                      />
                    )}
                    {view.relays?.[name]?.on && (
                      <span
                        aria-label={tr("relay", "Relay")}
                        className="absolute -right-0.5 -top-0.5 size-3.5 rounded-full border-2 border-[var(--bg-elevated)] bg-orange-400"
                      />
                    )}
                    <strong className="line-clamp-2 break-words text-[11px] font-semibold leading-tight">
                      {label(name)}
                    </strong>
                    <span className="pointer-events-none absolute left-1/2 top-full mt-4 w-40 -translate-x-1/2 whitespace-nowrap text-center font-mono text-[11px] font-normal text-[var(--fg-muted)]">
                      {nodes[name].overlay}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="border-t border-[var(--border)] px-5 py-4 text-sm">
          {selectedEdge ? (
            <>
              <strong>
                {label(selectedEdge.a)} ↔ {label(selectedEdge.b)} ·{" "}
                {titles[selectedEdge.state]}
              </strong>
              <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs text-[var(--fg-muted)]">
                <span>
                  {label(selectedEdge.a)} → {label(selectedEdge.b)}:{" "}
                  {metric(selectedEdge.ab)}
                </span>
                <span>
                  {label(selectedEdge.b)} → {label(selectedEdge.a)}:{" "}
                  {metric(selectedEdge.ba)}
                </span>
              </div>
            </>
          ) : selectedNode ? (
            <>
              <strong>
                {label(selected)} ·{" "}
                {freshAgent(view, selected, now)
                  ? tr("online", "Agent online")
                  : tr("stale", "Last report")}
              </strong>
              <p className="mt-2 break-all font-mono text-xs text-[var(--fg-muted)]">
                {selectedNode.host} → {selectedNode.overlay} ·{" "}
                {tr("stale", "Last report")}:{" "}
                {view.topology?.nodes.find((n) => n.name === selected)
                  ?.agent_age ?? "—"}
                {seconds}
              </p>
            </>
          ) : (
            <span className="text-[var(--fg-muted)]">
              {tr(
                "selectLink",
                "Select a node or connection on the map for details.",
              )}
            </span>
          )}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--fg-muted)]">
            <span>
              {tr("lastCycle", "Last reconciliation")}:{" "}
              {cycleAge == null ? "—" : `${Math.max(0, cycleAge)} ${seconds}`}
            </span>
            {filtered.length > 24 && (
              <span>
                {tr(
                  "mapLimit",
                  "Showing the first 24 matches. Narrow your search; tables include all nodes.",
                )}
              </span>
            )}
          </div>
          {transits.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-sky-400">
              {transits.map((r) => (
                <p key={`${r.from}:${r.to}`}>
                  {label(r.from)} → {label(r.via)} → {label(r.to)}
                </p>
              ))}
            </div>
          )}
        </div>
      </Surface>
      <Surface padding="none">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-semibold">
              {tr("etcdCluster", "etcd cluster")}
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              mTLS ·{" "}
              {tr(
                "etcdLive",
                "Linearizable health checks and live Raft status",
              )}
            </p>
          </div>
          <Button onClick={manage}>
            {tr("membership", "Manage membership")}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-[var(--border)] bg-[var(--bg)]">
              <tr>
                {[
                  tr("worker", "Registered worker"),
                  tr("role", "Mesh role"),
                  tr("health", "Health"),
                  tr("raftTerm", "Raft term"),
                  tr("raftIndex", "Raft index"),
                  tr("raftApplied", "Applied index"),
                  tr("dbSize", "DB size"),
                  tr("version", "Version"),
                ].map((v) => (
                  <th className={th} key={v}>
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(view.quorum?.members || []).map((m) => (
                <tr key={m.name}>
                  <td className={td}>{label(m.name)}</td>
                  <td className={td}>
                    <PillTag tone={m.leader ? "amber" : "neutral"}>
                      {m.leader ? tr("leader", "Leader") : tr("voter", "Voter")}
                    </PillTag>
                  </td>
                  <td className={td}>
                    {badge(quorumFresh ? m.healthy : null)}
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {m.raft_term || "—"}
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {m.raft_index || "—"}
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {m.raft_applied_index || "—"}
                  </td>
                  <td className={td}>
                    {m.db_size == null
                      ? "—"
                      : `${(m.db_size / 1048576).toFixed(2)} MiB`}
                  </td>
                  <td className={td}>{m.version || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!view.quorum?.members.length && (
            <p className="p-5 text-sm text-[var(--fg-muted)]">
              {tr("noQuorum", "No etcd members installed.")}
            </p>
          )}
        </div>
      </Surface>
      <Surface padding="none">
        <div className="p-5">
          <h2 className="font-semibold">
            {tr("exitHealth", "Exit availability & relays")}
          </h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {tr(
              "exitProbeHelp",
              "HTTPS checks from entry nodes. Direct and overlay states require three consecutive results before switching.",
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-[var(--border)] bg-[var(--bg)]">
              <tr>
                {[
                  tr("exit", "Exit"),
                  tr("direct", "Direct"),
                  "WireGuard",
                  tr("relay", "Relay"),
                  tr("relayMode", "Relay mode"),
                ].map((v) => (
                  <th key={v} className={th}>
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {names
                .filter((n) => nodes[n].role === "exit")
                .map((n) => (
                  <tr key={n}>
                    <td className={td}>
                      <div className="font-medium">{label(n)}</div>
                      <div className="mt-1 font-mono text-xs text-[var(--fg-muted)]">
                        {nodes[n].host}
                      </div>
                    </td>
                    <td className={td}>
                      <div>{probe(n, "direct")}</div>
                      <div className="mt-2">
                        {badge(
                          probesFresh ? view.exits?.[n]?.direct_healthy : null,
                        )}
                      </div>
                    </td>
                    <td className={td}>
                      <div>{probe(n, "wg")}</div>
                      <div className="mt-2">
                        {badge(
                          probesFresh ? view.exits?.[n]?.wg_healthy : null,
                        )}
                      </div>
                    </td>
                    <td className={td}>
                      <PillTag
                        tone={
                          view.relays?.[n]?.pending
                            ? "amber"
                            : view.relays?.[n]?.on
                              ? "blue"
                              : "neutral"
                        }
                      >
                        {view.relays?.[n]?.pending
                          ? tr("recovering", "Relay operation pending")
                          : view.relays?.[n]?.on
                            ? tr("relay", "Relay")
                            : tr("direct", "Direct")}
                      </PillTag>
                      {view.relays?.[n]?.reason && (
                        <p className="mt-2 max-w-60 text-xs text-[var(--fg-muted)]">
                          {reasonLabel(view.relays[n].reason!)}
                        </p>
                      )}
                    </td>
                    <td className={td}>
                      <SelectNative
                        aria-label={`${tr("relayMode", "Relay mode")} ${label(n)}`}
                        value={view.relay_modes?.[n] || "auto"}
                        disabled={
                          !operate ||
                          busy ||
                          !view.quorum?.quorum ||
                          !quorumFresh
                        }
                        onChange={(e) =>
                          void action("relay", {
                            exit: n,
                            mode: e.target.value,
                          })
                        }
                      >
                        <option value="auto">{tr("auto", "Automatic")}</option>
                        <option value="direct">{tr("direct", "Direct")}</option>
                        <option value="relay">{tr("relay", "Relay")}</option>
                      </SelectNative>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}
