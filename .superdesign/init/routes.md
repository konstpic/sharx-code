# SharX Panel — Route Map

Next.js App Router, file-based routing under `panel/app/` (no `pages/` directory). The build uses
`output: "export"` (static export, see `panel/next.config.ts`) with `trailingSlash: true`, so at runtime
every route resolves to a trailing-slash static HTML file (served by the Go backend). An optional
`NEXT_PUBLIC_BASE_PATH` env var can prefix all routes (multi-instance / reverse-proxy deployments).

Layout nesting:
```
app/layout.tsx                 (RootLayout — fonts, theme attrs, Providers)
├─ app/page.tsx                 → "/"                (LoginPage, no PanelShell)
└─ app/panel/layout.tsx         (PanelLayoutGate — PanelShell for all panel/* except /panel/sub)
   └─ app/panel/**/page.tsx     → "/panel/..."
```

---

## Route table

| URL path | Component file | Layout |
|---|---|---|
| `/` | `app/page.tsx` (inline `LoginPage`) | Root only — bespoke full-screen login chrome, no `PanelShell` |
| `/panel/` | `app/panel/page.tsx` → `components/DashboardPage.tsx` | `PanelShell` |
| `/panel/inbounds/` | `app/panel/inbounds/page.tsx` → `components/InboundsPage.tsx` | `PanelShell` |
| `/panel/hosts/` | `app/panel/hosts/page.tsx` → `components/HostsPage.tsx` | `PanelShell` |
| `/panel/nodes/` | `app/panel/nodes/page.tsx` → `components/NodesPage.tsx` | `PanelShell` |
| `/panel/nodes/statistics/` | `app/panel/nodes/statistics/page.tsx` → `components/NodesStatisticsPage.tsx` | `PanelShell` |
| `/panel/nodes/geography/` | `app/panel/nodes/geography/page.tsx` → `components/NodesGeographyPage.tsx` | `PanelShell` |
| `/panel/clients/` | `app/panel/clients/page.tsx` → `components/ClientsPage.tsx` | `PanelShell` |
| `/panel/clients/statistics/` | `app/panel/clients/statistics/page.tsx` → `components/ClientsStatisticsPage.tsx` | `PanelShell` |
| `/panel/groups/` | `app/panel/groups/page.tsx` → `components/GroupsPage.tsx` | `PanelShell` |
| `/panel/settings/` | `app/panel/settings/page.tsx` (redirect-only, client `router.replace` to default tab) | `PanelShell` |
| `/panel/settings/[tab]/` | `app/panel/settings/[tab]/page.tsx` → `components/SettingsPage.tsx` (static params from `SETTINGS_TAB_IDS`) | `PanelShell` |
| `/panel/db-inspector/` | `app/panel/db-inspector/page.tsx` → `components/DatabaseInspectorPage.tsx` | `PanelShell` |
| `/panel/xray/` | `app/panel/xray/page.tsx` → `components/XrayPage.tsx` | `PanelShell` |
| `/panel/xray/geo/` | `app/panel/xray/geo/page.tsx` → `components/XrayPage.tsx` (`initialView="geo"`) | `PanelShell` |
| `/panel/xray-core-config-profiles/` | `app/panel/xray-core-config-profiles/page.tsx` → `components/XrayCoreConfigProfilesPage.tsx` | `PanelShell` |
| `/panel/outbounds/` | `app/panel/outbounds/page.tsx` (inline, wraps `components/SimpleListPage.tsx`) | `PanelShell` |
| `/panel/api-docs/` | `app/panel/api-docs/page.tsx` → `components/ApiDocsPage.tsx` | `PanelShell` |
| `/panel/sub/` | `app/panel/sub/page.tsx` (inline `PublicSubPage`, uses `?id=` query param) → `components/sub/SubPageShell.tsx` + `SubPageRenderer.tsx` | **No `PanelShell`** — bare chrome via `PanelLayoutGate`'s public branch |

Note: `panel/PANEL_API_COVERAGE.md` documents the backend API surface the panel talks to, if further
domain detail is needed.

---

## Key page summaries

### `/` — Login (`app/page.tsx`)
Full-screen, no sidebar/navbar shell. Animated radial "vortex" backdrop (`.login-backdrop`, pure CSS
conic-gradient spirals), a slim top bar (brand wordmark + Telegram link + app-meta + language select),
then a centered `max-w-md` card (`Surface`) with username/password (+ optional 2FA code) fields using
`Input` with left-aligned Lucide icons, and a primary submit `Button`. Script-font animated "Hello"
greeting heading (`font-login-welcome`, `Sacramento` font) with a shimmering gradient-text sweep
animation. On success, redirects to `/panel/`.

### `/panel/` — Dashboard (`components/DashboardPage.tsx`, 2122 lines)
The main operator overview. Uses `PageScaffold` + `PageHeader` + multiple `Surface` cards with
`StatBlock`/`LinearProgress`/charts (via `recharts`), live-updating stats over `usePanelWebSocket`, log
stream tail (`useLogStream`, virtualized with `react-window`'s `FixedSizeList`), and quick links
(`Link`, `linkP`) to Inbounds/Clients/Nodes/Settings sections.

### `/panel/inbounds/` — Inbounds (`components/InboundsPage.tsx`, ~6964 lines — largest page)
CRUD table/list UI for Xray inbound connections, with the reusable `InboundColumnFiltersBar`,
`InboundListViews`, `InboundTlsCertPinBlock`, `InboundXrayCoreEditor` sub-components; heavy use of
`CheckboxOptionCard`/`CheckboxOptionList` for multi-select bulk actions, `Modal`/`Drawer` for
create/edit forms, `CompareModeFilterField` for numeric/traffic filters.

### `/panel/nodes/` — Nodes (`components/NodesPage.tsx`, ~2191 lines)
Multi-node fleet management (only relevant/shown in multi-node mode): node list, registration wizard
(`NodeRegisterStep` + `Stepper`), live resource usage drawer (`NodeResourceDrawer`), `NodeColumnFiltersBar`,
node status badges (`nodes/nodeBadges.tsx`).

### `/panel/clients/` — Clients (`components/ClientsPage.tsx`, ~5177 lines)
VPN client/user management: create/edit clients, QR code subscription links (`qrcode.react`), traffic
limits, expiry, per-client actions.

### `/panel/settings/[tab]/` — Settings (`components/SettingsPage.tsx`, ~1926 lines)
Tabbed settings surface (`SETTINGS_TAB_IDS`/`parseSettingsTab`) covering general panel config, Telegram
bot, subscription page builder (`components/settings/subscription/*` — a full drag-and-drop block editor
with live preview, the panel's richest nested feature area), remark model constructor, timezone/language.

### `/panel/xray/` and `/panel/xray/geo/` — Xray config (`components/XrayPage.tsx`, ~988 lines)
Simple/advanced Xray core config editor (`SimpleCoreForm`, `XrayTemplateSectionContent`,
`XrayTemplateNav`), a `Stepper`-driven flow, JSON import/export, geo-file management view (`initialView
="geo"`).

### `/panel/sub/` — Public subscription page (`app/panel/sub/page.tsx`)
The one genuinely public-facing, brandable, no-auth page in this codebase — closest existing analog to
"marketing surface." Fetches `panel("api/public/subscription")?id=...`, renders branded subscription
info via `SubPageShell` + `SubPageRenderer` (theme + color preset configurable per-deployment via
`SharxBranding`/`sharxSubpageConfig`). Handles loading/404/rate-limit/error states explicitly.

### `/panel/db-inspector/` — DB Inspector (`components/DatabaseInspectorPage.tsx`)
Read-only-ish raw SQLite table browser: `TableSidebar` + `TableViewer` + `EditableCell`, mobile-collapsible
table list (`Menu` icon toggle), destructive-action warnings (`AlertTriangle`/`ShieldAlert` icon tiles).

### Simpler / smaller pages
- `/panel/outbounds/` — thin wrapper around generic `SimpleListPage` (title/path/icon props only).
- `/panel/groups/` — node/inbound grouping CRUD (`components/GroupsPage.tsx`).
- `/panel/hosts/` — reverse-proxy/host entries CRUD (`components/HostsPage.tsx`).
- `/panel/api-docs/` — renders markdown API docs via `react-markdown` + `remark-gfm` + `rehype-slug`
  inside `.prose-doc` typography classes (see `theme.md`).
- `/panel/nodes/statistics/`, `/panel/clients/statistics/` — `recharts`-based analytics dashboards.
- `/panel/nodes/geography/` — `react-simple-maps` world map of node locations.
- `/panel/xray-core-config-profiles/` — named Xray core config profile CRUD, assignable per node.
