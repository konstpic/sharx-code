# 6. Hosts

[← Nodes](./05-nodes.md) | [Contents](./README.md) | [Clients →](./07-clients.md)

## What Is a Host

A **host** is a public name, domain, or CDN endpoint that the client sees in the **subscription** instead of or alongside the node's raw IP address.

A host **does not replace a node** and **does not accept traffic itself**. The node still processes connections. The host only changes **which address, port, and TLS parameters** appear in the `vless://`, `vmess://`, etc. link.

### When Hosts Are Needed

| Situation | Why a host |
|-----------|------------|
| Node behind **reverse proxy** (nginx, Caddy, HAProxy) | Subscription shows proxy domain; Xray listens locally on node |
| Traffic via **Cloudflare CDN** | Subscription shows CDN domain with WS/gRPC |
| **Load balancer** in front of multiple nodes | One domain → multiple backends |
| Hide real node IP | Client sees only CDN domain |
| Different domains per region | Host `eu.cdn.example.com` and `us.cdn.example.com` on same inbounds |
| TLS terminator in front of Xray | Xray without TLS, link has `security=tls` (see overrides) |

### Prerequisites

The **Hosts** section (`/panel/hosts/`) is available **only** when **Multi-Node mode** is enabled:

1. **Settings → General** → enable **Multi-Node mode**.
2. Add and connect **nodes**.
3. On inbounds **assign nodes** (Nodes step when creating inbound).

Otherwise the interface shows: *"Multi-Node mode must be enabled to manage hosts"*.

---

## Host List

**Hosts** page (`/panel/hosts/`):

| Column | Description |
|--------|-------------|
| **Name** | Host name (for administrator) |
| **Address** | Public domain or IP |
| **Port** | Port in subscription (`0` = from inbound) |
| **Protocol** | Optional protocol override |
| **Assigned inbounds** | List of bound inbounds |
| **Enabled** | Whether host is active |
| **Addresses in subscription** | Mode: Replace / Prepend / Append |

**?** button in header — built-in section help.

---

## Creating a Host (Step by Step)

### Step 1. Open Form

**Hosts** → **Add new host**.

### Step 2. General Tab

| Field | Required | Description |
|-------|----------|-------------|
| **Host name** | Yes | Arbitrary name (`CDN-EU`, `Cloudflare-main`) |
| **Host address** | Yes | Domain or IP the client sees (`cdn.example.com`) |
| **Port** | No | Port in subscription. **0** — use inbound port |
| **Protocol** | No | Protocol override (rarely needed) |
| **Remark** | No | Comment |
| **Enabled** | — | Disabled host does not participate in subscription |

#### Selecting Inbounds

Click **Select inbounds** — mark one or more **connections** this host applies to.

The host affects only subscriptions of clients with those inbounds assigned.

#### "Addresses in Subscription" Mode

Defines how the host address is combined with node entries:

| Mode | In UI | Result in subscription |
|------|-------|------------------------|
| **replace** | Replace node addresses | Client sees **only** host address; node entries hidden |
| **prepend** | Add before nodes | Host entry first, then node entries |
| **append** | Add after nodes | Node entries first, then host entry |

**Example** (inbound on 2 nodes: DE, NL):

```
Replace mode:
  → cdn.example.com:443          (host only)

Prepend mode:
  → cdn.example.com:443          (host)
  → 185.x.x.x:443 🇩🇪 DE         (node 1)
  → 91.x.x.x:443 🇳🇱 NL          (node 2)

Append mode:
  → 185.x.x.x:443 🇩🇪 DE
  → 91.x.x.x:443 🇳🇱 NL
  → cdn.example.com:443          (host)
```

> **Replace** — typical choice for CDN: client connects only via domain.
> **Prepend/Append** — when you need both CDN and direct node access (backup, testing).

### Step 3. Save

Click **Add host**. Host appears in the list.

### Step 4. Advanced Tab (After Creation)

When **creating** a host, the Advanced tab only has TLS/transport overrides. Node order and published addresses are configured **after saving**:

**Edit host** → **Advanced** tab.

---

## Advanced Settings

### TLS and Transport Overrides in Links

Section **"Subscription link overrides (TLS / transport)"**.

> Apply **only** to subscription entries with **this host's address** (and external proxy). Node entries in prepend/append modes **keep** TLS and transport from the inbound.

| Field | Description |
|-------|-------------|
| **SNI (TLS / Reality)** | Server Name Indication in link. Empty — from inbound |
| **HTTP Host** | Host header for WS / gRPC / xhttp |
| **Path / gRPC service name** | WebSocket path or gRPC serviceName |
| **ALPN** | Comma-separated: `h2,http/1.1` |
| **TLS fingerprint (fp)** | chrome, firefox, safari, etc. |
| **Allow insecure TLS** | As inbound / Yes / No |
| **Force TLS in link** | Inherit / Force TLS / Force none |

#### Force TLS — Typical Case

When a **TLS terminator** (Caddy, nginx, HAProxy, Cloudflare) accepts HTTPS and Xray on the node listens **without TLS**:

| On node (inbound) | In subscription link |
|-------------------|----------------------|
| `security: none` | `security=tls` (Force TLS) |

And vice versa: Xray with TLS, plain TCP outside — **Force none**.

### Subscription Entries (Nodes)

Section appears when editing a host if inbounds with assigned nodes are selected.

| Element | Description |
|---------|-------------|
| **Entry list** | One entry per inbound ↔ node binding |
| **Order** | Up / Down buttons — order in subscription |
| **Published address** | Address for this entry (overrides node address) |
| **Published port** | Port for this entry |
| **Include in subscription** | Whether to show this entry |
| **Remark suffix** | Addition to server name (`🇩🇪`, `-backup`) |

**Refresh list** button — reload entries after changing host inbounds.

If inbound has no nodes — message: *"This inbound has no nodes — assign nodes in Inbounds"*.

---

## Practical Scenarios

### Scenario 1: Cloudflare + VLESS + WebSocket

**Infrastructure:**
- Node: Xray listens on `127.0.0.1:10000`, WS path `/ws`, no TLS.
- Cloudflare: `cdn.example.com` → proxy to node, SSL Full.

**Host setup:**

| Field | Value |
|-------|-------|
| Address | `cdn.example.com` |
| Port | `443` |
| Mode | **replace** |
| HTTP Host | `cdn.example.com` |
| Path | `/ws` |
| Force TLS | **Force TLS** |
| Inbounds | VLESS-WS inbound |

**Result:** client gets link to `cdn.example.com:443` with `security=tls`, path `/ws`.

---

### Scenario 2: Direct Access + CDN (Backup)

**Goal:** primary entry via CDN, backup — direct to node.

| Field | Value |
|-------|-------|
| Mode | **prepend** |
| Host address | `cdn.example.com:443` |

**Result in subscription:**
1. `cdn.example.com` (via CDN)
2. `185.x.x.x` (direct to node)

---

### Scenario 3: REALITY Behind nginx stream

**Infrastructure:**
- Xray: REALITY on node port 443.
- Outside: nginx stream passthrough on same port.
- Clients connect via domain `proxy.example.com`.

| Field | Value |
|-------|-------|
| Address | `proxy.example.com` |
| Port | `443` |
| Mode | **replace** |
| SNI | `www.microsoft.com` (from REALITY inbound) |

SNI overrides come from inbound if not set on host.

---

### Scenario 4: Multiple Hosts for Different Inbounds

| Host | Inbound | Purpose |
|------|---------|---------|
| `eu.cdn.com` | VLESS-EU | European CDN |
| `us.cdn.com` | VLESS-US | American CDN |
| `tg.cdn.com` | Telemt | MTProto via CDN |

One client with both inbounds will see entries from both hosts.

---

## Edit and Delete

### Editing

**Actions** → **Edit host**:

- **General** tab — name, address, port, inbounds, mode;
- **Advanced** tab — TLS overrides and node entry order.

Changes take effect on the client's next subscription refresh.

### Enable / Disable

**Enabled** toggle — quickly disable host without deletion. Disabled host does not participate in subscription generation.

### Delete

**Delete host** → confirmation. Inbounds and nodes are **not deleted** — only the host record.

---

## Relationship to Other Sections

```
Inbound (protocol, port, TLS on node)
    │
    ├── Nodes (where Xray listens, node published address)
    │
    └── Hosts (what client sees in subscription)
            │
            ▼
        Client subscription
```

| Setting | Where set | What it affects |
|---------|-----------|-----------------|
| Protocol, UUID, flow | Inbound + Client | Link type |
| Xray listening port | Inbound | Real port on node |
| Node address in subscription | Inbound → Nodes | Node IP in entry |
| Public domain | **Host** | Domain in host entry |
| TLS in link | Inbound or **Host** (override) | `security=` in URI |
| Server order | **Host** → Advanced | Entry order |

---

## Troubleshooting

| Problem | Possible cause | Solution |
|---------|----------------|----------|
| Hosts not shown | Multi-Node disabled | Enable in Settings → General |
| Empty subscription | No client inbounds / host disabled | Check client and Enabled flag |
| Client won't connect via CDN | Wrong path / Host / TLS | Check overrides on Advanced tab |
| Duplicate entries | prepend/append mode + replace on another host | Check all host modes |
| "No nodes on inbound" | Inbound not bound to nodes | Inbounds → edit → Nodes step |
| TLS mismatch | Force TLS/none doesn't match infrastructure | Align with reverse proxy |

---

## Recommendations

1. Start with **replace** mode — easier to debug one entry.
2. **Don't duplicate** TLS settings: configure inbound first, override on host only what differs (domain, path, security).
3. After changing host inbounds, click **Refresh list** on Advanced tab.
4. Test subscription in target app (Happ, v2rayNG), not only in browser.
5. For Cloudflare: orange cloud (proxy) + WS/gRPC; REALITY via CF needs a separate scheme.

## What's Next

- [Clients](./07-clients.md) — assign inbounds to users
- [Subscription page](./09-subscription-page.md) — design public page
- [Routing](./10-routing.md) — client routing and Xray routing
