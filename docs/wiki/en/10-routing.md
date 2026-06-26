# 10. Routing

[← Subscription Page](./09-subscription-page.md) | [Contents](./README.md) | [HWID and Limits →](./11-hwid-and-limits.md)

SharX has **several independent types of routing**. Don't confuse them:

| Type | Where configured | What it does |
|------|------------------|--------------|
| **Hosts** | [Hosts](./06-hosts.md) | Address and TLS substitution in subscription |
| **Client routing** | Settings → Subscription → Client routing | Rules for Happ / sing-box on device |
| **Xray routing** | Xray → Template / Core profiles | Server-side rules on node |
| **JSON templates** | Settings → Subscription → JSON templates | Extra rules in JSON subscription |
| **IP blocking (limit)** | Automatic with IP limit | Hot-push blocking to nodes |

> Address substitution in subscription (CDN, domains) is **[Hosts](./06-hosts.md)**, not this section.

---

## Client Routing (Happ)

**Settings → Subscription → Client routing**

Routing profiles in a format compatible with **Happ** and similar clients. Delivered via subscription HTTP headers:

| Header | Description |
|--------|-------------|
| `Routing` | Deeplink: `happ://routing/add/{base64(JSON)}` |
| `Routing-Enable` | `1` — enable routing |

### When to Use

- Split traffic: Russian sites — DIRECT, rest — PROXY.
- Block ads (geosite:category-ads-all → BLOCK).
- Configure DNS (local / via proxy).
- Deliver a single routing profile to all Happ clients.

### Profile Parameters

| Parameter | Description |
|-----------|-------------|
| **Global proxy** | All traffic via proxy |
| **Route order** | Rule application sequence |
| **Domain strategy** | AsIs, IPIfNonMatch, IPOnDemand |

### Rules

Each rule has an action and lists:

| Action | Description |
|--------|-------------|
| **DIRECT** | Direct connection |
| **PROXY** | Via proxy |
| **BLOCK** | Block |

Lists:

- **Sites** (domains, geosite: `geosite:ru`, `geosite:google`);
- **IP** (CIDR, geoip: `geoip:private`).

### DNS

| Tab | Description |
|-----|-------------|
| **Remote DNS** | DNS via proxy (1.1.1.1, 8.8.8.8) |
| **Local DNS** | DNS direct |
| **DNS hosts** | Static records (`example.com → 1.2.3.4`) |
| **GeoIP / Geosite URL** | List URLs |

### Deeplink Presets

| Preset | Prefix |
|--------|--------|
| Happ | `happ://routing/add/` |
| Incy | `incy://routing/add/` |
| SharX | Own format |
| Custom | Arbitrary prefix |

### Example: Russia DIRECT, Rest PROXY

```
Rule 1: geosite:ru → DIRECT
Rule 2: geoip:ru → DIRECT
Rule 3: 0.0.0.0/0 → PROXY
```

Happ client on subscription refresh receives `Routing` header with deeplink to this profile.

---

## Xray Routing (Server-Side)

**Xray → Template** (`/panel/xray/`) or **Core profiles** (`/panel/xray-core-config-profiles/`)

Routing rules on the **server** (Xray core). Define where to send traffic **after** accepting on inbound.

### When to Use

- Route different inbound traffic to different outbounds.
- Block BitTorrent on server.
- Send traffic through proxy chain (double-hop).
- Balance between multiple exit nodes.

### Rule Builder

Each rule contains:

| Field | Description |
|-------|-------------|
| **Type** | field / logical |
| **Domain** | Domain list |
| **IP** | CIDR |
| **Port** | Port range |
| **Inbound Tag** | Inbound connection tag |
| **Outbound Tag** | Outbound tag (freedom, proxy, block) |
| **Balancer Tag** | Balancer |

Rules apply **top to bottom** — first match wins.

### Outbounds

**Outbounds** page (`/panel/outbounds/`):

| Protocol | Purpose |
|----------|---------|
| `freedom` | Direct internet exit |
| `blackhole` | Drop traffic |
| `socks` / `http` | Via another proxy |
| `vless`, `vmess`, `trojan`… | Chain via another server |

### Core Profiles

In multi-node each node can be assigned a **core config profile** — separate routing/outbound/dns rule set. E.g.: EU nodes with one profile, US nodes with another.

---

## JSON Routing Templates

**Settings → Subscription → JSON templates → Rules**

Additional routing rules **prepended** to the routing section of JSON subscription (for sing-box, Xray JSON format).

Useful when the client app reads routing from subscription body, not Happ headers.

---

## Automatic IP Blocking

With **concurrent IP limit** enabled (see [HWID and limits](./11-hwid-and-limits.md#concurrent-ip-limit)) the panel automatically adds routing rules on nodes to block "extra" IP addresses.

| Mode | Action |
|------|--------|
| **Drop** | Terminate active connections |
| **Block** | Deny subscription/routing for IP |
| **Drop + Block** | Both actions |

---

## Diagram: What to Configure Where

```
Client subscription
├── Server address      → Hosts (domain) + Nodes (IP)
├── TLS in link         → Inbound or Host (override)
├── Routing on phone    → Client routing (Happ)
└── JSON routing        → JSON templates

Traffic on server
└── Where to send       → Xray routing + Outbounds
```

---

## Recommendations

1. **Hosts** — for CDN and domains; see [dedicated section](./06-hosts.md).
2. **Client routing** — for Happ users (split tunneling, blocks).
3. **Xray routing** — for server policy (exit, block, chain).
4. Don't duplicate the same rules in three places — choose the level for the task.

## What's Next

- [HWID and limits](./11-hwid-and-limits.md)
- [Panel settings](./12-settings.md)
