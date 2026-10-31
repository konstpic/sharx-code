export type MeshNode = {
  host: string;
  overlay: string;
  role: string;
  rw_node: string;
};
export type MeshLink = { ok: boolean; rtt?: number; loss?: number };
export type MeshView = {
  snapshot_at?: number;
  last_cycle?: number;
  enrolled?: Record<string, MeshNode>;
  quorum?: {
    healthy: number;
    size: number;
    quorum?: boolean;
    leader?: string;
    observed_at?: number;
    members: {
      name: string;
      healthy: boolean;
      leader?: boolean;
      endpoint?: string;
      version?: string;
      raft_term?: string;
      raft_index?: string;
      raft_applied_index?: string;
      db_size?: number;
    }[];
  };
  topology?: {
    nodes: {
      name: string;
      agent_age: number | null;
      role?: string;
      etcd?: boolean;
      leader?: boolean;
      relay?: boolean;
    }[];
  };
  overlay?: {
    obs: Record<string, Record<string, MeshLink>>;
    route: Record<string, Record<string, string>>;
  };
  probe_matrix?: Record<
    string,
    Record<string, Record<string, { ok: number; total: number; ms: number }>>
  >;
  relays?: Record<string, { on: boolean; pending: boolean; reason?: string }>;
  relay_modes?: Record<string, string>;
  exits?: Record<
    string,
    { direct_healthy: boolean | null; wg_healthy: boolean | null }
  >;
  pinned_disabled?: string[];
};
export function freshAgent(view: MeshView, name: string, now: number) {
  const age = view.topology?.nodes.find((n) => n.name === name)?.agent_age;
  return age != null && age + Math.max(0, now - (view.snapshot_at || now)) < 60;
}
export function meshEdges(view: MeshView, now: number) {
  const names = Object.keys(view.enrolled || {}).sort();
  return names.flatMap((a, i) =>
    names.slice(i + 1).map((b) => {
      const ab = view.overlay?.obs[a]?.[b],
        ba = view.overlay?.obs[b]?.[a];
      const fresh = freshAgent(view, a, now) && freshAgent(view, b, now);
      const state: "unknown" | "healthy" | "asymmetric" | "down" =
        !fresh || !ab || !ba
          ? "unknown"
          : ab.ok && ba.ok
            ? "healthy"
            : ab.ok || ba.ok
              ? "asymmetric"
              : "down";
      return { a, b, ab, ba, state, id: `${a}:${b}` };
    }),
  );
}
export function meshTransits(view: MeshView, now: number) {
  const nodes = view.enrolled || {};
  return Object.entries(view.overlay?.route || {}).flatMap(([from, routes]) =>
    Object.entries(routes || {}).flatMap(([to, via]) =>
      nodes[from] &&
      nodes[to] &&
      nodes[via] &&
      from !== to &&
      via !== from &&
      via !== to &&
      freshAgent(view, from, now)
        ? [{ from, to, via }]
        : [],
    ),
  );
}
export function linkMetric(link?: MeshLink, unit = "ms", locale = "en") {
  if (!link) return "—";
  return `${link.rtt == null ? "—" : `${link.rtt.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`} · ${link.loss == null ? "—" : `${Math.round(link.loss * 100)}%`}`;
}

/** Remna-style radial topology: entries at left, exits on an arc; one role uses a full ring. */
export function radialLayout(nodes: Record<string, MeshNode>, names: string[]) {
  const entries = names.filter((name) => nodes[name].role === "entry");
  const exits = names.filter((name) => nodes[name].role !== "entry");
  const ring =
    !entries.length || !exits.length || entries.length > 6 || exits.length > 10;
  const height = ring
    ? Math.max(480, names.length * 32 + 180)
    : Math.max(480, Math.max(entries.length * 96, exits.length * 70) + 100);
  const positions: Record<string, { x: number; y: number }> = {};
  const center = height / 2;
  const ry = center - 90;
  if (names.length === 1) positions[names[0]] = { x: 50, y: center };
  else if (ring) {
    names.forEach((name, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / names.length;
      positions[name] = {
        x: 50 + Math.cos(angle) * 34,
        y: center + Math.sin(angle) * ry,
      };
    });
  } else {
    entries.forEach((name, i) => {
      positions[name] = {
        x: 14,
        y: center + (i - (entries.length - 1) / 2) * 96,
      };
    });
    exits.forEach((name, i) => {
      const angle =
        exits.length === 1
          ? 0
          : -Math.PI / 2.3 + ((i / (exits.length - 1)) * Math.PI * 2) / 2.3;
      positions[name] = {
        x: 56 + Math.cos(angle) * 30,
        y: center + Math.sin(angle) * ry,
      };
    });
  }
  return { height, positions };
}
