# Dashboard and manual list order

The dashboard editor exposes reorder handles, size grips, explicit width/height selectors, optional titles, and widget visibility. Resource history tiles support lines, areas, bars, and numeric values; other metric widgets support numeric/table alternatives. Existing data collection and service action buttons are retained. Small screens show one column and retain keyboard size/order controls.

Layouts use versioned JSON in `dashboardLayout:user:{id}`, with validated bounds and a migration from the existing enabled-widget preference. Saving is delayed briefly to avoid a request per resize frame. The current shared theme is unchanged.

Host and bundle reorder routes require their existing update permission. Legacy hosts remain scoped to their owner and kind; bundle-scheme hosts use the existing shared administration scope. Stale and partial ID lists keep remaining entries. Positions are negative so newly created entries with a default position of zero append to manually ordered rows. Editing an entry cannot reset its manual position. The order of hosts inside individual bundles and clients' subscriptions is not rewritten.

Client filters are stored alongside the existing table preferences. Additional text fields accept contains, `=`, and `!=`; numeric fields support comparisons and `min..max` ranges. Traffic thresholds accept B/KB/MB/GB/TB (GB if omitted); speeds accept bps/Kbps/Mbps/Gbps (Mbps if omitted). Date comparisons cover whole local calendar days, and `none`/`нет`/`—` match missing values. Existing filters remain compatible.

Validation: `node panel/scripts/test-dashboard-customization.mjs`; PostgreSQL integration test `TestReorderHostsBundlesPersistenceAndScope`; production frontend build; Go service/controller/RBAC checks.

The v2 workspace supports up to 12 named dashboards, duplication, three starter templates, and up to 24 custom panels per dashboard. Legacy v1 layouts migrate into a board without replacing visibility or sizing. The catalog includes panel resources, network counters, clients, database, process, node state, and per-node CPU/memory/disk measurements. Nine metric views share real values; backend resource history stays distinct from recent page-local samples of metrics without a history API.

Visual blocks reuse the subscription layout document, tree operations, canvas, inspector, responsive styles, animation engine, catalog forms, template expressions, parameter editor, and Monaco code editor. `LayoutRenderer.context` and `Canvas.context` are optional adapters; subscription rendering keeps its existing defaults. Catalog shapes are rebound to dashboard data rather than subscription account fields. Custom HTML uses the existing isolated `HtmlEmbed`; HTTPS embeds use a sandboxed iframe. Only chosen numeric metrics are exposed through `metric`, `metrics`, `byId` and `window.sub`; no subscription URLs, session credentials or complete status object are passed to user code.
