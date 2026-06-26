# 4. Inbounds

[← Web Interface](./03-web-interface.md) | [Contents](./README.md) | [Nodes →](./05-nodes.md)

## What Is an Inbound

An **inbound** is a listener on the server that accepts incoming connections from client applications. Each inbound defines:

- **protocol** (VLESS, VMess, Trojan, etc.);
- **listening port**;
- **transport** (TCP, WebSocket, gRPC, REALITY, etc.);
- **TLS / REALITY** — encryption and masquerading;
- **authentication parameters** (UUID, password, flow).

End-user credentials (UUID, passwords) are stored in **clients**, not in the inbound. One inbound serves many clients.

### Chain: inbound → node → host → client

```
Inbound (protocol, port, TLS)
    ↓ assigned to
Node (where Xray actually listens)
    ↓ if needed
Host (which domain the client sees in the subscription)
    ↓ assigned to
Client (UUID, limits, subId)
```

## Inbound List

The **Inbounds** page (`/panel/inbounds/`) shows a table of all inbounds:

| Column | Description |
|--------|-------------|
| ID | Identifier |
| Remark | Inbound name |
| Protocol | VLESS, VMess, etc. |
| Port | Listening port |
| Traffic ↑/↓ | Total traffic |
| Clients | Number of assigned clients |
| Status | Enabled / disabled |

Filters, sorting, and table/tile view toggle are available.

## Creating an Inbound

Click **Add inbound** — a step-by-step wizard opens.

### Step 1. Basic Parameters

| Field | Description |
|-------|-------------|
| **Remark** | Inbound name (for convenience) |
| **Protocol** | Choose from list (see below) |
| **Port** | Listening port (randomly generated, can be changed) |
| **Listen** | IP address (`0.0.0.0` — all interfaces) |
| **Enable** | Inbound activity |
| **Traffic reset** | Periodic counter reset: never / hour / day / week / month |

### Step 2. Transport (Stream / Transport)

Settings depend on the protocol. For Xray protocols:

| Parameter | Options |
|-----------|---------|
| **Network** | `tcp`, `ws`, `grpc`, `quic`, `xhttp`, `httpupgrade`, `kcp`, `h2` |
| **Security** | `none`, `tls`, `reality` |

#### TCP

Basic transport. Additionally: HTTP masquerading (header type).

#### WebSocket (ws)

| Field | Description |
|-------|-------------|
| Path | WebSocket path (e.g. `/ws`) |
| Host | Host header |

#### gRPC

| Field | Description |
|-------|-------------|
| Service Name | gRPC service name |
| Multi Mode | Multiplexing mode |

#### REALITY

| Field | Description |
|-------|-------------|
| Dest | Target address for masquerading (e.g. `www.google.com:443`) |
| Server Names | SNI names |
| Private Key / Public Key | REALITY keys |
| Short IDs | Short identifiers |

#### TLS

| Field | Description |
|-------|-------------|
| Certificate | Path to cert or Let's Encrypt |
| SNI | Server Name Indication |
| ALPN | `h2`, `http/1.1` |
| Fingerprint | TLS fingerprint (chrome, firefox, etc.) |

> TLS and REALITY parameters must match what your CDN or firewall allows.

### Step 3. Authentication

Depends on protocol:

| Protocol | Parameters |
|----------|------------|
| **VLESS** | Flow (xtls-rprx-vision, etc.), Decryption |
| **VMess** | Security (auto, aes-128-gcm, chacha20-poly1305, none) |
| **Trojan** | Password (set at client level) |
| **Shadowsocks** | Encryption method (aes-256-gcm, chacha20-poly1305, 2022-blake3, etc.) |
| **Hysteria 2** | Obfuscation (salamander), password |
| **WireGuard** | Secret Key, Peers |
| **AmneziaWG** | Sidecar parameters (Jc, Jmin, Jmax, S1, S2, H, etc.) |
| **Telemt (MTProto)** | MTProto proxy parameters (no Xray streamSettings) |

### Step 4. Sniffing

Enable detection of incoming traffic protocol:

- HTTP, TLS, QUIC, FakedNS
- Route Only / Metadata Only

### Step 5. Nodes (Multi-Node Only)

When Multi-Node mode is enabled:

1. Select **nodes** where this inbound will run.
2. For each assignment configure:
   - **Include in subscription** — whether to show in client subscription;
   - **Published address/port** — what the client sees (may differ from node address);
   - **Remark suffix** — addition to the name in the subscription.

## Protocols — Quick Reference

### VLESS

Modern Xray protocol. Supports XTLS Vision, REALITY. Recommended for new deployments.

**Typical setup:** VLESS + TCP + REALITY or VLESS + WS + TLS.

### VMess

Classic V2Ray protocol. Wide client support.

**Typical setup:** VMess + WS + TLS.

### Trojan

Masquerades as ordinary HTTPS traffic. Requires a valid TLS certificate.

### Shadowsocks

Lightweight proxy protocol. Supports 2022-blake3 methods.

### Mixed

SOCKS5 + HTTP proxy on one port.

### Hysteria 2

UDP protocol with high throughput. Supports salamander obfuscation.

### WireGuard

VPN via WireGuard inside Xray. UDP transport, no TCP/WebSocket.

### AmneziaWG

Modified WireGuard (Amnezia sidecar). Configuration is delivered as `.conf` for AmneziaVPN.

### Telemt (MTProto)

Telegram proxy. Runs as a sidecar, does not use Xray streamSettings.

---

## Step-by-Step Setup Examples

### Example 1: VLESS + REALITY (Recommended)

| Step | Parameter | Value |
|------|-----------|-------|
| 1. Basic | Protocol | VLESS |
| | Port | `443` |
| | Remark | `VLESS-REALITY` |
| 2. Transport | Network | tcp |
| | Security | reality |
| | Dest | `www.microsoft.com:443` |
| | Server Names | `www.microsoft.com` |
| | Short IDs | generate |
| 3. Authentication | Flow | `xtls-rprx-vision` (optional) |
| 5. Nodes | Select node | DE-Server |

Create a client with this inbound → subscription contains a string with REALITY parameters.

### Example 2: VLESS + WebSocket + TLS (Cloudflare CDN)

| Step | Parameter | Value |
|------|-----------|-------|
| 1. Basic | Protocol | VLESS |
| | Port on node | `10000` (local) |
| 2. Transport | Network | ws |
| | Path | `/ws` |
| | Security | none (TLS on CDN) |
| 5. Nodes | Node | EU-Server |

Then create a **host** → [Hosts](./06-hosts.md):

- Address: `cdn.example.com`, port `443`, mode **replace**
- HTTP Host: `cdn.example.com`, Path: `/ws`, Force TLS: **tls**

### Example 3: Shadowsocks 2022

| Step | Parameter | Value |
|------|-----------|-------|
| 1. Basic | Protocol | Shadowsocks |
| | Port | `8388` |
| 3. Authentication | Method | `2022-blake3-aes-256-gcm` |

Client password is generated at the client level.

### Example 4: AmneziaWG (Sidecar)

| Step | Parameter | Value |
|------|-----------|-------|
| 1. Basic | Protocol | AmneziaWG |
| 3. Authentication | Jc, Jmin, Jmax… | per Amnezia documentation |
| 5. Nodes | Node with AWG sidecar | select |

Client receives `.conf` for import into AmneziaVPN.

---

From the inbound row menu:

| Action | Description |
|--------|-------------|
| **Edit** | Change parameters |
| **Clone** | Copy settings (port and IP set anew) |
| **Reset traffic** | Zero the counter |
| **Clients** | List of clients on this inbound |
| **Export links** | Links for clients |
| **Delete** | Remove inbound |

## Single-Node vs Multi-Node

| | Single-node | Multi-Node |
|---|-------------|------------|
| Where Xray runs | On panel server | On remote nodes |
| Nodes step | Hidden | Required |
| Address in subscription | Panel address | Node (or host) address |

## Recommendations

1. **One protocol — one inbound** for different ports or transports.
2. **REALITY** — for bypassing blocks without your own domain.
3. **TLS + WS** — for CDN (Cloudflare, etc.).
4. **Match parameters** to client application capabilities.
5. With many inbounds, use **filters and sorting**.

## What's Next

- [Nodes](./05-nodes.md) — assign to workers
- [Hosts](./06-hosts.md) — public addresses for subscriptions (CDN)
- [Clients](./07-clients.md) — assign users
