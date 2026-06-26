# SharX — User Guide

**Document version:** 1.0 · **Panel:** 1.6.6 · **Language:** English

---

# 1. SharX

## Brief description

**SharX** is a web panel for managing proxy and VPN connections powered by Xray. Through the browser, an administrator configures servers, creates client accounts, issues subscriptions, and monitors traffic.

## What the service does

- Creates and configures **inbounds** (VLESS, VMess, Trojan, Shadowsocks, and other protocols).
- Maintains a list of **clients** — end users who receive access.
- Generates **subscriptions** — links and configs for mobile and desktop apps (Happ, v2rayNG, Clash, etc.).
- Manages **nodes** — remote servers that handle traffic (in Multi-Node mode).
- Configures **hosts** — public domains and CDN addresses in subscriptions.
- Enforces access limits: traffic caps, expiry, device count (HWID), concurrent IPs.
- Shows statistics: online users, traffic, server health.

## Who it is for

| Role | Usage |
|------|-------|
| **Panel administrator** | Daily work: clients, inbounds, settings |
| **Infrastructure engineer** | Panel install, nodes, SSL, backups |
| **Support operator** | View clients, reset traffic, verify subscriptions |

End VPN users **do not use the panel** — they receive a subscription link and configure a client app.

## Problems it solves

1. Centralized management of many servers and protocols.
2. Granting and revoking access without manual per-device setup.
3. Traffic usage and subscription expiry control.
4. Protection against account sharing (HWID, IP limits).
5. Branded subscription page with instructions for clients.

---

# 2. Quick start

## What the administrator needs

| Requirement | Description |
|-------------|-------------|
| **Access** | Panel admin account (username and password) |
| **URL** | Panel address, e.g. `https://panel.example.com:2053` |
| **Browser** | Modern browser (Chrome, Firefox, Safari, Edge). JavaScript required |
| **Network** | HTTPS access to the panel URL (recommended) or HTTP |

Ports and domain are set during installation by a system administrator. In the panel UI they can be **viewed** (Settings → Panel & general → Panel binding) but **not changed** — only via server configuration.

## First login

1. Open the panel URL in a browser.
2. On the login page, enter **Username** and **Password**.
3. Click **Log in**.
4. If two-factor authentication (2FA) is enabled, enter the **2FA code** from an authenticator app or Telegram.
5. After a successful login, the **Dashboard** opens.

**Default credentials** (first install only, if unchanged):

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin` |

Change the password immediately: **Settings → Admin & restart → Change login and password**.

## Language selection

On the login page and in **Settings → Panel & general → Interface language** you can choose the panel language.

## Minimum workflow (single server)

1. **Inbounds** → **Create inbound** → choose protocol → **Save**.
2. **Clients** → **Add client** → enter name → select inbound → **Save**.
3. Copy the client subscription link and send it to the user.
4. The user adds the link in an app (Happ, v2rayNG, etc.).

## Minimum workflow (multiple servers, Multi-Node)

1. **Settings → Panel & general** → enable **Multi-Node mode** → **Save**.
2. **Nodes** → **Add node** → deploy the worker per the wizard → **Check**.
3. **Inbounds** → create inbound → on the **Nodes** step assign a server.
4. If needed: **Hosts** → add a public domain for the subscription.
5. **Clients** → create client → assign inbound.

---

# 3. Interface

The panel has a **sidebar** (left), **header** (top), and **main area** (center).

## Header

| Element | Purpose |
|---------|---------|
| Name and version | Panel identification, update indicator |
| GitHub / Telegram / Donate links | External project resources |

## Sidebar

| Section | When to use |
|---------|-------------|
| **Dashboard** | Daily system health check |
| **Inbounds** | Create and configure protocols and ports |
| **Nodes** * | Manage remote servers (Multi-Node only) |
| **Hosts** | Public domains in subscriptions (Multi-Node only) |
| **Clients** | End-user accounts |
| **Groups** | Group clients for bulk operations |
| **Settings** | Panel, subscription, and security configuration |
| **Xray** | Advanced proxy core configuration |
| **API Docs** | API reference (for automation) |
| **Log out** | End session |

\* The **Nodes** section is visible only when Multi-Node mode is enabled.

---

## 3.1. Dashboard

**Purpose:** overview of the panel, servers, and clients.

**When to use:** start of day, after changes, when troubleshooting.

**Displayed data:**

| Block | Data |
|-------|------|
| Resources | CPU, RAM, disk, swap |
| Xray / Telemt | Running / stopped, core version |
| Quick actions | Log, configuration, backup |
| Uptime | Panel and system uptime |
| Users online | Active client count |
| Database | PostgreSQL status |
| Network | Speed, TCP/UDP, IP addresses |
| Node availability | Online/offline (Multi-Node) |

**Available actions:**

- **Configure dashboard** — show/hide widgets, **Reset layout**.
- **Stop / Restart Xray** (single-node).
- **Stop Telemt**.
- **Log** — view, filter, export logs.
- **Backup** — export/import database.
- **CPU / memory history** — charts for selected interval.
- **Manage nodes** — go to Nodes section.

---

## 3.2. Inbounds

**Purpose:** configure entry points — protocol, port, encryption, transport.

**When to use:** when adding a new protocol, port, or server to subscriptions.

**Table columns:**

| Column | Content |
|--------|---------|
| Remark | Inbound name |
| Tag | Internal Xray identifier |
| Protocol | VLESS, VMess, Trojan, etc. |
| Host | Listen port |
| Upload/download | Total traffic |
| Status | On/Off toggle |

**Actions:** create, edit (row click), delete, filter, switch view (table / list / tiles).

---

## 3.3. Nodes

**Purpose:** manage remote worker servers.

**When to use:** scaling, new datacenter, connectivity issues.

**Main table columns:** Enabled, Name, Address, Status, Xray state, Sidecars (Telemt, AmneziaWG), Assigned inbounds, Actions.

**Actions:** add node (3-step wizard), health check, stop/restart Xray and sidecars, CPU/RAM/Disk metrics, delete.

---

## 3.4. Hosts

**Purpose:** override addresses in subscriptions (CDN domain, reverse proxy).

**When to use:** when clients should connect by domain, not node IP.

**Availability:** only when **Multi-Node mode** is enabled.

**Table:** Enabled, Name, Address, Port, Protocol, Remark, Assigned inbounds, Actions.

---

## 3.5. Clients

**Purpose:** end-user VPN/proxy accounts.

**When to use:** grant/revoke access, change limits, troubleshoot user issues.

**Summary tiles:** Total users, Online, Offline, Shown by filters.

**Table (configurable columns):** ID, name, comment, status, traffic, expiry, group, inbounds, UUID, Sub ID, etc.

**Actions:** add, edit (side panel), bulk actions, filters, column visibility.

---

## 3.6. Groups

**Purpose:** group clients for bulk setting changes.

**Table:** Name, Description, Client count, Actions.

**Actions:** add group, edit (bulk settings for all group clients), delete.

---

## 3.7. Settings

Tabs:

| Tab | Purpose |
|-----|---------|
| **Panel & general** | Language, theme, session, Multi-Node, HWID, IP limit, logs |
| **Security** | 2FA, API tokens |
| **Telegram** | Notification bot |
| **Subscription & JSON** | Subscription params, page builder |
| **LDAP** | External auth and client sync |
| **Grafana** | Monitoring integration |
| **Admin & restart** | Password change, panel restart |

On all tabs: **Reset**, **Save**. Unsaved changes show banner **You have unsaved changes.**

---

## 3.8. Xray

**Purpose:** advanced proxy core configuration.

**Tabs:** Core config, Final JSON, Geo files.

**Actions:** Save, Save and apply, reset to defaults, restart Xray, manage geoip/geosite.

---

## 3.9. Public subscription page

**URL:** `/panel/sub/?id=<subscription id>`

**Purpose:** end-user page (no panel menu): status, traffic, import buttons, QR codes.

**Configured in** **Settings → Subscription & JSON → builder**.

---

# 4. Main workflows

## 4.1. Log in to the panel

1. Open the panel URL.
2. Enter **Username** and **Password**.
3. Click **Log in**.
4. If 2FA is requested — enter the code and click **Log in** again.
5. Result: **Dashboard** opens; version shown in the header.

---

## 4.2. Change administrator password

1. Go to **Settings → Admin & restart**.
2. Fill **Current username**, **Current password**, **New username**, **New password**.
3. Click **Update**.
4. Result: success message. **2FA will be disabled** — re-enable if needed.

---

## 4.3. Create an inbound (VLESS + REALITY)

1. **Inbounds** → **Create inbound**.
2. **Basics:** protocol **VLESS**, port **443**, remark `VLESS-REALITY`.
3. **Transport:** network **tcp**, security **reality**, fill Dest, Server Names, REALITY keys.
4. **Auth:** flow `xtls-rprx-vision` if needed.
5. **Sniffing:** optional.
6. **Nodes** (Multi-Node): select server, enable **Include in subscription**.
7. Click **Save**.
8. Result: inbound in the list with status **Enabled**.

---

## 4.4. Add a node

1. Ensure **Multi-Node mode** is enabled.
2. **Nodes** → **Add node**.
3. Step 1: name, address, API port (usually 8080).
4. Step 2: copy **Docker Compose**, deploy on the node server, click **Check**.
5. Step 3: assign Xray profile or **Skip**.
6. Result: node status **online**, Xray **Running**.

---

## 4.5. Create a host for CDN

1. **Hosts** → **Add host**.
2. **General** tab: name, address `cdn.example.com`, port `443`.
3. Select inbounds, mode **Replace node addresses**.
4. **Add host**.
5. **Edit** → **Advanced:** HTTP Host, Path, **Force TLS** if needed.
6. Result: client subscription shows CDN domain instead of node IP.

---

## 4.6. Create a client

1. **Clients** → **Add client**.
2. Enter **name** (Latin letters, unique).
3. Select one or more **inbounds**.
4. Optionally: traffic limit, expiry, group, HWID.
5. Click **Save**.
6. Result: client in the list, UUID copied, subscription link available.

---

## 4.7. Edit a client

1. **Clients** → click a client row.
2. Change fields in the side panel (name **cannot** be changed).
3. Click **Save**.
4. Result: **Client updated.**

---

## 4.8. Delete a client

1. Open the client card **or** enable **Bulk actions**.
2. Click **Delete**.
3. Confirm in the dialog.
4. Result: client removed; subscription access stops.

---

## 4.9. Bulk assign group

1. **Clients** → **Bulk actions**.
2. Select clients with checkboxes (or **Select all matching filter**).
3. **Assign group** → choose group → confirm.
4. Result: selected clients updated.

---

## 4.10. Bulk reset traffic

1. **Clients** → **Bulk actions** → select clients.
2. **Reset traffic** → confirm.
3. Result: traffic counters cleared.

---

## 4.11. Create and configure a group

1. **Groups** → **Add group** → name (up to 30 chars) → **Create**.
2. **Edit group** → change expiry, traffic limit, inbounds, HWID → **Save**.
3. Result: settings applied to **all clients** in the group.

---

## 4.12. Search for a client

1. **Clients** → enter text in search **or** open **Column filters**.
2. Set conditions (name, group, status, traffic, expiry).
3. Result: filtered table; **Shown by filters** tile updates.

---

## 4.13. Filter inbounds

1. **Inbounds** → **Show column filters**.
2. Filter by remark, tag, protocol, port, status.
3. **Reset filters** — full list.

---

## 4.14. Export backup

1. **Dashboard** → **Quick actions** → **Backup**.
2. Click **Export database**.
3. Result: file downloads to your computer.

---

## 4.15. Export log

1. **Dashboard** → **Log**.
2. Set level and source filters if needed.
3. Click **Export**.
4. Result: log file saved.

---

## 4.16. Configure subscription page

1. **Settings → Subscription & JSON**.
2. Builder: **Branding** → logo, colors.
3. **Blocks** → add subscription-info, add-to-app, links-list.
4. **Response rules** → Profile-Title, update interval.
5. **Save**.
6. Open `/panel/sub/?id=<subId>` for a test client.

---

## 4.17. Enable two-factor authentication

1. **Settings → Security**.
2. **Set up app** → scan QR in Google Authenticator (or similar).
3. Enter confirmation code.
4. Result: 2FA required on next login.

---

## 4.18. Copy client subscription

1. **Clients** → open client.
2. Click **Open subscription** or copy link icon.
3. Result: link in clipboard — send to the user.

---

# 5. UI elements by page

Protocol-specific fields (REALITY, Hysteria, WireGuard) depend on the selected protocol; use (?) tooltips when unsure.

---

## 5.1. Login page

| Element | Purpose | Constraints | After use |
|---------|---------|-------------|-----------|
| Username | Admin login | Required | — |
| Password | Password | Required | — |
| 2FA code | TOTP / Telegram | Required if 2FA on | Panel access |
| Log in | Submit form | — | Dashboard or error |
| Interface language | Language | — | Page language changes |

---

## 5.2. Clients — create/edit form

| Field | Purpose | Values / limits | After save |
|-------|---------|-----------------|------------|
| Client name | Unique ID | Required; Latin; **immutable** after create | Stats and subscription |
| Comment | Admin note | Up to 100 chars | Panel only |
| UUID | Protocol ID | Auto; up to 64 chars | vless/vmess links |
| Telegram ID | Bot notifications | Number | Optional |
| Subscription ID | Subscription URL key | 16 chars; create only | In `/sub/...` URL |
| Expiry | End date | Empty = unlimited | EXPIRED after date |
| Traffic limit (GB) | Max traffic | 0 = unlimited | LIMITED when exceeded |
| Reset (days) | Counter reset period | Days | Auto traffic reset |
| Inbounds | Server access | Min. 1 for working subscription | Subscription lines |
| Group | Membership | One or none | Filtering, bulk ops |
| HWID | Device limit | 0 = unlimited; beta; Happ/v2rayTun | Blocks extra devices |
| IP limit | Concurrent IPs | Min. 1 when enabled | Drop/block per settings |
| Announcement | Subscription text | Up to 200 chars | Announce header |

**Client card buttons:** Enable/Disable, Open subscription, QR, Keys, Active sessions (IP), Reset traffic, Clear HWID, Delete.

**Bulk actions:** Assign group, Reset traffic, Clear HWID, Delete.

---

## 5.3. Inbounds — creation wizard

| Step | Key fields | Limits |
|------|------------|--------|
| Basics | Remark, Tag, Port, Listen address, Traffic limit, Scheduled reset | Port 1–65535; unique tag; `api` reserved |
| Transport | Network, TLS/Reality, WS path/host, gRPC service | Protocol-dependent |
| Auth | Flow, encryption, SS method, Hysteria password | Protocol-dependent |
| Sniffing | HTTP, TLS, QUIC, FakedNS | JSON or form |
| Nodes | Node list, published address/port, in subscription | Multi-Node only |

**Buttons:** Cancel, Back, Next, Save.

**View toggles:** Form / Xray config / Telemt config / AWG preview.

---

## 5.4. Nodes — form and wizard

| Field | Purpose | Limits |
|-------|---------|--------|
| Country (flag) | Emoji in name | Optional |
| Node name | Title | Required |
| Address or URL | API IP/domain | Required |
| Port | Worker API port | 1–65535, default 8080 |
| Traffic limit (GB) | Per-node cap | 0 = unlimited |
| TLS / HTTPS | API encryption | Toggle |
| Skip certificate verification | Self-signed | Toggle |
| Enabled | Active | Disabled node does not sync |

---

## 5.5. Hosts — form

| Field | Purpose | Limits |
|-------|---------|--------|
| Host name | Title | Required |
| Host address | Domain/IP in subscription | Required |
| Port | Port in subscription | 0 = from inbound |
| Protocol | Override | Optional |
| Subscription addresses | replace / prepend / append | Merge mode with nodes |
| Select inbounds | Binding | Min. 1 for effect |
| TLS overrides | SNI, Host, Path, ALPN, fp, security | Host lines only |

---

## 5.6. Groups — form

| Field | Limits |
|-------|--------|
| Name | Required, up to 30 chars |
| Description | Up to 100 chars |

Edit applies expiry, traffic, inbounds, HWID, IP to all group clients in bulk.

---

## 5.7. Settings — main fields

| Field | Purpose | Editable in UI |
|-------|---------|----------------|
| Language / Theme | Interface | Yes |
| Domain, panel port, SSL paths | Panel binding | **Read-only** |
| Session duration | Cookie lifetime (min) | Yes |
| Multi-Node mode | Distributed architecture | Yes (with confirm) |
| HWID mode | off / x-hwid / legacy | Yes |
| IP limit control | Global enforcement | Yes |
| Subscription params | URI, Provider ID, JSON | Partial (network via env) |

---

# 6. System messages

## 6.1. Success messages

| Message | When |
|---------|------|
| Login successful | After login |
| Client created / updated / deleted | Client operations |
| Inbound created / updated / deleted | Inbound operations |
| Node added / updated / deleted | Node operations |
| Host added / updated / deleted | Host operations |
| Group added / updated / deleted | Group operations |
| Settings updated | Save settings |
| Copied | Clipboard copy |
| Panel restarted successfully | Restart from settings |

## 6.2. Login errors

| Message | Cause | Fix |
|---------|-------|-----|
| Invalid account credentials | Wrong username or password | Check keyboard layout, Caps Lock; reset password on server |
| Enter the code from the app… | 2FA on, code missing | Enter 6-digit TOTP |
| Invalid two-factor authentication code | Wrong TOTP | Retry; check phone time sync |
| Login code sent to Telegram… | Telegram 2FA | Enter code from bot message |

## 6.3. Client errors

| Message | Cause | Fix |
|---------|-------|-----|
| Email is required | Empty name | Fill client name |
| Comment must be at most 100 characters | Limit exceeded | Shorten text |
| Announcement must be at most 200 characters | Limit exceeded | Shorten text |
| Failed to add client | Validation or duplicate name | Unique name; check limits |
| No clients selected | Bulk action without selection | Select clients |
| Select a group | Bulk assign without group | Choose group in dialog |

## 6.4. Inbound errors

| Message | Cause | Fix |
|---------|-------|-----|
| Port: 1–65535 | Invalid port | Enter valid port |
| Invalid stream transport JSON | Transport JSON error | Fix JSON or use form |
| Specify dest (host:port) first | REALITY without Dest | Fill Dest before SNI |

## 6.5. Node and host errors

| Message | Cause | Fix |
|---------|-------|-----|
| Please enter node name / address | Empty required fields | Fill form |
| Port must be between 1 and 65535 | Invalid port | Fix port |
| Please enter host name and address | Empty fields | Fill name and address |
| Multi-Node mode must be enabled to manage hosts | Multi-Node off | Enable in Settings |

## 6.6. General errors

| Message | Cause | Fix |
|---------|-------|-----|
| Failure | Generic API error | Retry; check Dashboard → Log |
| Something went wrong | Server error | Details may be in English in parentheses — contact support |
| Error loading settings | Settings failed to load | Refresh page; check panel availability |
| You have unsaved changes | Leaving settings | Save or Reset |

## 6.7. Public subscription page

| Message | Cause | Fix |
|---------|-------|-----|
| Subscription ID not specified | Missing `?id=` in URL | Add correct Sub ID |
| Subscription not found | Invalid or deleted Sub ID | Check client in panel |
| Too many requests | Rate limit | Wait and retry |

## 6.8. Warnings

| Message | Meaning | Action |
|---------|---------|--------|
| Security warning | HTTP without SSL | Use HTTPS; can hide with checkbox |
| No enabled nodes… | Multi-Node without active nodes | Add or enable a node |
| Enabling Multi-Node will stop local XRAY Core… | Mode change confirm | Read and confirm |
| HWID beta feature | Limited client support | Use Happ or v2rayTun |

---

# 7. FAQ

### Why is the client subscription empty?

- No **inbound** assigned to the client.
- Inbound is **disabled**.
- Multi-Node: no **nodes** on inbound or node is **offline**.
- Client **disabled**, **expired**, or **traffic limited** (custom remarks may show placeholder instead of servers).

### Why can't the client connect although subscription exists?

- Wrong TLS/Reality/WS on inbound or host.
- Port blocked by firewall on the node.
- CDN: Path, Host, or SSL mode mismatch.
- HWID: device limit exceeded (403 or placeholder).

### Why can't I save a client?

- Empty **name**.
- Name already taken.
- Comment or announcement over limit.

### Why doesn't Hosts work / section is empty?

- **Multi-Node mode** is not enabled.

### Why is a node offline?

- Worker container not running on the server.
- Wrong `SECRET_KEY` or `PANEL_URL` during install.
- Panel cannot reach node API port (firewall).

### Why was 2FA disabled after password change?

- Expected behavior: credential change resets 2FA. Re-enable under **Security**.

### Why can't I change the panel port in settings?

- Port, domain, and SSL paths are set at install (environment variables). UI is read-only.

### Why is statistics empty?

- No clients or no connections yet.
- Filters too narrow — **Reset filters**.
- Node offline — traffic not collected.

### Why are some UI labels in English?

- Some new elements lack translation — English fallback is shown.

### Why can't I add a second administrator?

- Current version supports **one** admin account.

---

# 8. System limitations

| Limitation | Description |
|------------|-------------|
| Single administrator | Cannot create multiple panel login accounts via UI |
| Client name | Cannot change after create; Latin lowercase only |
| Unique client name | Duplicate names not allowed |
| One group per client | Client in one group or none |
| Group name | Max 30 characters |
| Group description | Max 100 characters |
| Client comment | Max 100 characters |
| Client announcement | Max 200 characters |
| HWID | Beta; full support in Happ and v2rayTun |
| Hosts | Multi-Node only |
| Panel and subscription ports | Not editable in UI |
| Inbound tag `api` | Reserved |
| Inbound port (single-node) | Must be unique on server |
| LDAP panel login | LDAP password checked only if local user row exists |
| Password change | Disables 2FA |
| QR code | Text over ~2500 chars won't fit |

---

# 9. Tips

1. **Change** `admin`/`admin` password immediately after install.
2. **Enable 2FA** for the admin account.
3. **Name inbounds clearly** — `VLESS-CF-443-EU`, not `inbound1`.
4. **One protocol per inbound**; don't mix transports in one inbound.
5. **Test subscription** in the same app the user will use before handing it off.
6. **Multi-Node:** nodes and inbounds first, then hosts, then clients.
7. **CDN hosts** — set Force TLS/none to match your reverse proxy.
8. **Groups** — use for tiers (basic/premium) and bulk renewals.
9. **Backup** — export DB before major changes (Dashboard → Backup).
10. **Don't share panel access** — one admin, strong password, HTTPS.
11. **HWID** — warn users: Happ/v2rayTun only; new phone may need HWID clear.
12. **Log** — on **Failure**, check Dashboard → Log for details.

---

# 10. Glossary

| Term | Definition |
|------|------------|
| **Panel** | SharX web interface for administrators |
| **Administrator** | User who logs into the panel (not a client) |
| **Client** | End VPN/proxy user; account in **Clients** |
| **Inbound** | Server protocol, port, and transport configuration |
| **Node** | Remote worker server with Xray in Multi-Node mode |
| **Host** | Public domain or address in subscription (CDN, proxy) |
| **Subscription** | URL where apps load server list |
| **Sub ID** | Unique client subscription identifier (16 chars) |
| **UUID** | Client protocol identifier (vless/vmess) |
| **Multi-Node** | Xray not on panel; traffic on nodes |
| **HWID** | Device ID for device count limits |
| **2FA** | Two-factor authentication for panel login |
| **Sidecar** | Extra service on node (Telemt, AmneziaWG) |
| **Public subscription page** | Client web page: `/panel/sub/?id=...` |
| **Group** | Client set for bulk operations |
| **Provider ID** | Provider identifier for Happ app |

---

# 11. Questions for developers

The following could not be fully confirmed from docs and UI alone:

1. **Admin password policy** — minimum length, complexity, expiry?
2. **Password recovery** — self-service or CLI/DB only?
3. **Roles and multiple admins** — planned?
4. **Backup format** — version compatibility on import?
5. **Hard limits** on clients, nodes, inbounds?
6. **Public subscription rate limit** — exact thresholds for "Too many requests"?
7. **DB import behavior** — overwrite vs merge; service stop required?
8. **LDAP:** does login create a `users` row or only verify existing?
9. **Full remark model fields** — subscription remark builder docs?
10. **Which inbound fields** cannot change after clients assigned?
11. **Official supported client apps** and subscription formats?
12. **Panel update procedure** for admin without Docker access (UI only)?

---

# 12. Illustration recommendations

## Screenshots

| # | Capture | Section |
|---|---------|---------|
| 1 | Login with 2FA fields | Quick start |
| 2 | Full dashboard | Interface |
| 3 | Sidebar with Settings / Nodes / Clients expanded | Interface |
| 4 | Inbound wizard — all 5 steps | Inbounds |
| 5 | REALITY form filled | Inbounds |
| 6 | Add node — Docker Compose step | Nodes |
| 7 | Node list online/offline | Nodes |
| 8 | Host form — General and Advanced | Hosts |
| 9 | Clients with filters and bulk actions | Clients |
| 10 | Client side panel — all sections | Clients |
| 11 | Group edit modal with bulk actions | Groups |
| 12 | Settings → Subscription builder | Subscription |
| 13 | Public page `/panel/sub/` | Subscription |
| 14 | Settings → Security — 2FA and API tokens | Settings |
| 15 | Login error message | Messages |

## Diagrams

| # | Diagram | Purpose |
|---|---------|---------|
| 1 | Admin → Panel → Node → Client app | User-facing architecture |
| 2 | Single-node vs Multi-Node | Mode choice |
| 3 | Inbound → Node → Host → Subscription | Hosts section |
| 4 | Host modes: replace / prepend / append | Hosts |
| 5 | Client lifecycle: ACTIVE → LIMITED / EXPIRED / DISABLED | Limits |
| 6 | Login with 2FA flow | Security |

---

*End of guide. If the UI differs, the running panel version takes precedence.*
