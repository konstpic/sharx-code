# 3. Web Interface

[← Installation](./02-installation.md) | [Contents](./README.md) | [Inbounds →](./04-inbounds.md)

## Logging In

1. Open the panel URL in your browser (default `http://server:2053`).
2. Enter the administrator login and password.
3. If two-factor authentication (2FA) is enabled, enter the TOTP code or confirm via Telegram.

The session is stored in encrypted cookies — you don't need to re-enter the password until the session expires or you log out.

## Interface Layout

```
┌──────────────────────────────────────────────────────────────┐
│  SharX Panel          ★ GitHub  Telegram  Donate  v1.6.6   │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                 │
│  Sidebar   │              Main area                          │
│  menu      │         (tables, forms, charts)               │
│            │                                                 │
│            │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

### Header

- **SharX Panel** name and version.
- Links: GitHub, Telegram, Donate.
- Update indicator (when a new version is available).

### Sidebar Menu

| Item | Route | Description |
|------|-------|-------------|
| **Dashboard** | `/panel/` | Summary: traffic, online, Xray status |
| **Inbounds** | `/panel/inbounds/` | Inbound management |
| **Nodes** * | `/panel/nodes/` | Worker servers (Multi-Node only) |
| ↳ Management | `/panel/nodes/` | Node list and creation |
| ↳ Statistics | `/panel/nodes/statistics/` | Traffic per node |
| ↳ Geography | `/panel/nodes/geography/` | Location map |
| **Hosts** | `/panel/hosts/` | Public addresses for subscriptions (Multi-Node only) |
| **Clients** | `/panel/clients/` | End users |
| ↳ Management | `/panel/clients/` | List, create, edit |
| ↳ Statistics | `/panel/clients/statistics/` | Traffic per client |
| **Groups** | `/panel/groups/` | Client groups |
| **Settings** | `/panel/settings/general/` | Panel configuration |
| **Xray** | `/panel/xray/` | Core configuration template |
| ↳ Template | `/panel/xray/` | Base Xray JSON template |
| ↳ Geo files | `/panel/xray/geo/` | geoip.dat, geosite.dat |
| ↳ Core profiles | `/panel/xray-core-config-profiles/` | Configuration profiles |
| **API Docs** | `/panel/api-docs/` | REST API reference |
| **Logout** | `/logout/` | End session |

\* The **Nodes** section appears only when Multi-Node mode is enabled.

## Dashboard

The home page shows:

- **Total traffic** — upload and download for the period.
- **Online clients** — number of active connections.
- **Xray status** — running / stopped / error (in single-node mode).
- **Node status** — online/offline, Xray on each node (in multi-node).
- **Charts** — traffic and connection dynamics.

Data updates in real time via WebSocket.

## Settings (Tabs)

| Tab | Contents |
|-----|----------|
| **General** | Domain, ports, TLS, Multi-Node mode, theme, language |
| **Security** | 2FA (TOTP), API tokens, HWID mode |
| **Telegram** | Bot for notifications and login |
| **Subscription** | Subscription page builder |
| **LDAP** | External administrator authentication |
| **Grafana** | Loki, VictoriaMetrics, dashboard integration |
| **Administrator** | Change login/password, restart panel |

## Section Help

On **Inbounds**, **Nodes**, **Clients**, and **Hosts** pages, the header has a **?** (help) button — a brief description of the section and main actions.

## Language and Theme

- **Interface language** can be switched in settings or is saved from browser locale preferences. Russian, English, and other languages are supported.
- **Theme** (light / dark) is configured in general settings.

## Public Subscription Page

Separate route `/panel/sub/?id=<subId>` — page for end users without the panel sidebar. Opens when following a subscription link from a browser.

## API Docs

Built-in REST API viewer (`/panel/api-docs/`) — endpoint descriptions for automation and integrations. Full documentation: `web/docs/API.md`.

## DB Inspector

**Settings → DB Inspector** (`/panel/db-inspector/`) — PostgreSQL table viewer for debugging. Not intended for everyday use.

## Typical Workflow

```
1. Dashboard       → check system status
2. Inbounds        → create/configure inbound
3. Clients         → add user, assign inbound
4. Panel Settings → “Subscription & JSON” → design subscription page
5. Give client the subscription link
```

For multi-node:

```
1. Settings → enable Multi-Node
2. Nodes → add workers
3. Inbounds → create inbound → assign nodes
4. Hosts → configure CDN/domains for subscriptions
5. Clients → create and assign inbounds
6. Panel Settings → “Subscription & JSON” → design page
```

## Dashboard widget: Telegram DC availability (Telemt)

The **Telemt DC** widget shows how every running Telemt (MTProto) instance reaches the Telegram datacenters. It appears only when at least one Telemt inbound is running (on the panel host in standalone mode, or on worker nodes in multi-node mode).

**How data is collected.** The browser polls `GET /panel/api/inbounds/telemtDcStatus` (default every 15 s; 5/15/30/60 s selectable, remembered in the browser). The panel asks each Telemt instance's local control API (`/v1/stats/dcs`, `/v1/runtime/upstream_quality`, `/v1/runtime/me_pool_state`, `/v1/runtime/me_quality`); in multi-node mode each node agent does this locally and the panel fans out to all nodes in parallel with an 8 s per-node timeout. Results are cached for a few seconds, so several open dashboards do not multiply the load. If a node stops answering, its last known data is shown for up to 10 minutes, marked as stale, together with the error; other nodes are not affected. Charts and "since" timers are built in the browser from successive polls (about 40 points per DC, kept for the browser session).

**States.**

| State | Meaning |
|-------|---------|
| available (up) | Endpoints are reachable and the required Middle-End writers are alive (or, without ME, upstream probes reach the DC). |
| degraded | Fewer writers alive than required, or fewer than 50% of the DC's endpoints reachable. Capacity is reduced but traffic still flows. |
| unavailable (down) | No reachable endpoint, no alive writer, or every healthy upstream reports the DC unreachable. |
| unknown | Telemt has no data for this DC yet. |

State is always shown with an icon and text, not only colour.

**Fields.** RTT is the Middle-End round-trip time (or the best upstream connect latency when ME has no value); *Endpoints* are reachable/total ME endpoints; *ME writers* are alive/required writer connections and *Coverage* is their ratio; *Sessions* are client sessions bound to the DC; *IP family* is IPv4/IPv6/both/unreachable as seen by upstream probes; *Source* tells whether the state comes from the Middle-End pool or from upstream probes. DC ids: `DC1`-`DC5` are the main datacenters, `DCn media` (negative ids in Telemt) are media datacenters, `DC203 CDN` is the CDN cluster. Expanding a DC also shows the writer floor (min/target/max), endpoints with their writer counts, refills in progress and upstream reachability; the instance details show the ME writer pool, reconnect/route-drop counters and each upstream route's health.

**Layout adapts to the tile size.** A small tile shows one summary line and coloured DC dots; a medium tile shows chips per DC; a large tile shows a table with RTT sparklines. The tile scrolls internally.

**Working with it.** The header shows overall health (all up / N degraded / N down), counts by panel and node, the age of the last update with a freshness indicator, a refresh button, pause/resume, the poll interval, an opt-in browser notification when a DC goes from up to down, and buttons to copy a diagnostic summary (text or JSON) for support. Filters: problems only, node, search by tag/remark/node name; sort by problems, RTT or sessions; group by node or by DC. DCs whose state changed since the previous poll flash briefly, and the **Events** list keeps the last 20 transitions.

**Unavailable instances** show a reason code with a hint: `api_disabled` (enable `server.api.enabled` in the Telemt parameters), `feature_disabled` (set `server.api.minimal_runtime_enabled = true`), `unreachable` (check that the API listen address is enabled, the inbound is running and its log is clean), `source_unavailable` (Telemt has no snapshot yet; wait after a restart).

## What's Next

- [Inbounds](./04-inbounds.md)
- [Clients](./07-clients.md)
- [Hosts](./06-hosts.md)


## Custom dashboard panels: available metrics

Custom panels (metric kind) pick their data from a searchable catalogue, grouped as Panel resources, Network, Clients, Nodes (aggregates), Node: <name>, Balancers (aggregates), Balancer: <name>, Telemt, Traffic, Database and Panel process. Saved panels reference metrics by id, so ids never change.

- **Aggregates.** `nodes.*` and `balancers.*` combine every enabled node or balancer: `nodes.cpu.avg|max|min`, `nodes.mem.avg|max`, `nodes.disk.avg|max`, `nodes.latency.avg|max`, `nodes.traffic.up|down|total`, `nodes.rate.up|down` (bytes/s over the last 5 minutes), `nodes.clients.online`, `nodes.offline`, `balancers.connections`, `balancers.healthy`, `balancers.pools.unhealthy` (backends reported down), `balancers.rate.in|out`, `balancers.errors`, `balancers.failovers` and more.
- **Per entity.** Every node and balancer is selectable by name: `node:<id>:cpu`, `node:<id>:traffic.down`, `node:<id>:status`, `balancer:<id>:connections`, `balancer:<id>:healthy`. The label is "<name> · <metric>". If the node or balancer is deleted (or you lose access), the panel shows "no data" and the editor lists the metric as unavailable instead of failing.
- **Panel counters.** `stats.clients.*`, `stats.inbounds.*`, `traffic.up|down|total`, `traffic.rate.up|down`, `audit.events24h|failed24h` (the audit counters need `audit:read`).
- **Source.** `GET /panel/api/server/dashboardMetrics` (permission `dashboard:read`; node data additionally needs `nodes:read`, balancer data `balancers:read`). It is cached for about 8 seconds on the server, uses grouped queries only and never contacts nodes or agents: values come from the last health check and resource poll. An offline node or balancer returns null for live values (CPU, connections, ...) while traffic totals stay.
- **Units and levels.** Values are formatted by unit (bytes, bytes/s, percent, ms, count, duration, status). Metrics carry default warn/critical levels as metadata (CPU 70/90 %, memory and disk 80/90 %, latency 150/500 ms, healthy backends below 99/50 %).
- **Templates.** "Nodes overview" (one card per node: status, CPU, memory, traffic, clients online) and "Balancers overview" (status, connections, healthy backends, throughput, errors).
