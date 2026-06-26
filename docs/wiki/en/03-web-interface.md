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
4. Settings → Subscription → design subscription page
5. Give client the subscription link
```

For multi-node:

```
1. Settings → enable Multi-Node
2. Nodes → add workers
3. Inbounds → create inbound → assign nodes
4. Hosts → configure CDN/domains for subscriptions
5. Clients → create and assign inbounds
6. Settings → Subscription → design page
```

## What's Next

- [Inbounds](./04-inbounds.md)
- [Clients](./07-clients.md)
- [Hosts](./06-hosts.md)
