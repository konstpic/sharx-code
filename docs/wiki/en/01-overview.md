# 1. Platform Overview

[← Contents](./README.md) | [Installation →](./02-installation.md)

## What Is SharX

**SharX** is a modern **Xray-core** management platform with support for distributed architecture (multiple worker servers), a visual subscription page builder, and advanced client access control.

The panel lets you:

- create and manage **inbounds** with different protocols and transports;
- manage **clients** (end users) with traffic limits, expiry dates, and device restrictions;
- distribute configurations via **subscription** — in a format understood by the specific client application;
- scale infrastructure by adding **nodes** (worker servers) under a single panel;
- configure a **public subscription page** with branding, instructions, and import buttons.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SharX Panel                          │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Web UI   │  │ PostgreSQL │  │ Subscription Svc │  │
│  │ (Next.js)│  │   (data)   │  │   (port 2096)    │  │
│  └──────────┘  └────────────┘  └──────────────────┘  │
│         │                              │                │
│         │         API / config         │                │
└─────────┼──────────────────────────────┼────────────────┘
          │                              │
    ┌─────▼─────┐                  ┌─────▼─────┐
    │  Node 1   │                  │  Node 2   │
    │ Xray +    │                  │ Xray +    │
    │ sidecars  │                  │ sidecars  │
    └───────────┘                  └───────────┘
```

### Operating Modes

| Mode | Description |
|------|-------------|
| **Single-node** | Xray runs on the same server as the panel. Suitable for small deployments. |
| **Multi-Node** | Xray **does not run** on the panel; configurations are sent to remote **nodes**. Traffic is processed on workers. |

Multi-Node mode is enabled in **Settings → General → Multi-Node mode**.

## Core Entities

### Inbound

A listener on the server: protocol (VLESS, VMess, Trojan, etc.), port, transport (TCP, WebSocket, gRPC, REALITY, etc.), TLS parameters. One inbound can serve many clients.

### Client

An end-user account. Contains UUID/password, inbound assignments, limits, expiry date, subscription identifier (`subId`). **Not to be confused with the panel administrator.**

### Node

A remote server with a SharX worker and Xray. The panel sends configuration via a secure API (mTLS + JWT), checks status, and collects statistics.

### Group

A logical grouping of clients for filtering and bulk operations (changing limits, assigning inbounds).

### Host

A public name or CDN address in the subscription. See [Hosts](./06-hosts.md) for details.

### Subscription

An HTTP endpoint where the client application fetches the server list. The response format depends on User-Agent (Happ, v2rayNG, Clash, sing-box, browser, etc.).

## Supported Protocols

| Protocol | Type | Purpose |
|----------|------|---------|
| **VLESS** | Xray | Primary protocol with XTLS, REALITY support |
| **VMess** | Xray | Classic V2Ray protocol |
| **Trojan** | Xray | Masquerades as HTTPS traffic |
| **Shadowsocks** | Xray | SS with various encryption methods |
| **Mixed** | Xray | SOCKS + HTTP on one port |
| **Hysteria 2** | Xray | UDP protocol with obfuscation |
| **WireGuard** | Xray | VPN via WireGuard |
| **AmneziaWG** | Sidecar | Modified WireGuard (Amnezia) |
| **Telemt (MTProto)** | Sidecar | Telegram proxy |

## Default Ports

| Service | Port | Purpose |
|---------|------|---------|
| Web panel | **2053** | Administrative interface |
| Subscriptions | **2096** | Subscription endpoint for client applications |
| PostgreSQL | **5432** | Database (internal) |
| HTTP (SSL) | **80** | Let's Encrypt certificate issuance |

## Technology Stack

- **Panel (UI):** Next.js, React, TypeScript
- **Backend:** Go (Gin), GORM, PostgreSQL
- **Proxy core:** Xray-core
- **Deployment:** Docker, Docker Compose
- **Updates:** Watchtower (included in compose)

## What's Next

- [Panel installation](./02-installation.md)
- [Web interface overview](./03-web-interface.md)
- [Hosts](./06-hosts.md) — for multi-node and CDN
