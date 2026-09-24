# Balancer (edge load balancer)

Status: design, not implemented yet.

## Goal

A **balancer** is a separate server that sits in front of several nodes. Clients connect to the balancer's
address; the balancer forwards the raw connection to one of the nodes that serve the same inbound. It is added
and managed like a node (pairing, status, install over SSH or a copy-paste compose file) but runs an L4 proxy
(HAProxy or nginx `stream`) instead of Xray.

What it gives: one stable entry address for many nodes, automatic failover when a node dies, spreading load, and
hiding node IPs from clients (clients only see the balancer).

## What already exists and is reused

| Piece | Reuse |
|---|---|
| **Hosts** (`hosts`, `host_inbound_mappings`) | The subscription side. A host replaces, prepends or appends its address to the node entries of an inbound. This is exactly "balancer only" / "balancer plus direct". |
| `InboundNodeMapping.IncludeInSubscription` | Per node "show this direct entry or not". Gives "balancer plus only some direct nodes". |
| Pairing (`SECRET_KEY`, mTLS + JWT) and `node/auth` | Same trust model for the balancer agent. |
| SSH provisioning with pinned host key | Auto-install of the balancer. |
| Node list UI (table/list/tiles, drag-and-drop order, filters) | Balancers list. |

## Model

```
balancers            id, name, address (public host clients see), api_address, enable,
                     engine (haproxy|nginx), auth/pairing fields (as nodes), status, last_check,
                     agent_version, engine_version, config_hash, applied_hash, last_error, sort_order
balancer_pools       id, balancer_id, inbound_id, listen_port (0 = inbound port),
                     algorithm (roundrobin|leastconn|source), sub_enabled, sub_mode (replace|prepend|append),
                     host_id (managed Host), auto_members, enable
balancer_pool_members pool_id, node_id, weight, backup, enable, address_override, port_override
```

A **pool** = one inbound behind one balancer. Members default to every node the inbound is bound to
(`auto_members`), and can be edited (weights, backup, exclude).

Balancers live in their own table (not in `nodes`): a lot of code assumes every node is an Xray worker (config push,
traffic stats, inbound bindings), and a balancer row would leak into all of it.

## Traffic path

```
client ──► balancer:PORT ──(TCP/UDP passthrough)──► node:inbound.port ──► Xray
```

* No TLS termination: the balancer only relays bytes, so Reality, VLESS, VMess, Trojan, Shadowsocks, Telemt keep
  working unchanged. The client link differs only by address.
* Public port = inbound port by default, so the link is the inbound link with a different host. A custom listen port
  is allowed (unique per balancer).
* All members of a pool serve the **same inbound definition** (same keys, shortIds, clients), which the panel
  already guarantees for multi-node inbounds.
* Engines: **HAProxy** = TCP, active health checks, leastconn. **nginx stream** = TCP and UDP (Hysteria2, WireGuard,
  AmneziaWG), passive health checks. UDP pools require the nginx engine (the UI enforces it).
* Algorithms: round robin, least connections, source-IP hash (sticky by client IP, best for UDP and for per-IP limits).

## Subscription: balancer, direct, or both

Every pool with `sub_enabled` owns one **managed Host** (marked `managed_by_pool`). The panel keeps only these fields
in sync: address (balancer address), port (0 when equal to the inbound port), apply mode, enable, inbound mapping.
TLS/SNI/path overrides stay editable in the normal Hosts UI and are never overwritten.

| Pool mode | Client sees |
|---|---|
| `replace` | only the balancer entry. Node IPs are hidden. |
| `prepend` (default choice in the UI) | balancer first, then the direct node entries as fallback. |
| `append` | direct node entries, balancer last. |

The mode is chosen per pool. Disabling `sub_enabled` gives "direct only" for that inbound (the pool still balances, the
client just does not see it). Every entry (balancer, each direct node) can be shown or hidden on its own.
Combined with `include in subscription` on each node binding this covers: balancer only, balancer plus all direct,
balancer plus selected direct nodes. Deleting a pool deletes its managed Host.

## Control plane

Push model, like nodes:

1. Panel builds a JSON spec per balancer: `{engine, pools:[{id, listenPort, proto, algorithm, members:[{host, port, weight, backup}]}]}` and its hash.
2. `POST /api/v1/apply` on the agent (mTLS + JWT). The agent renders the engine config, validates it (`haproxy -c` /
   `nginx -t`), swaps it atomically and reloads gracefully (existing connections are not dropped). On a failed
   validation the old config keeps running and the error is reported back.
3. Triggers: any change to a balancer, pool, member, node address/enable, or inbound port (debounced), agent start
   (pull), and a periodic reconcile that compares `config_hash` with `applied_hash`.
4. `GET /api/v1/status` returns engine state and per pool/backend up/down and connection counts (HAProxy stats
   socket; nginx: parsed from the status module). The panel polls it like node health.

Backend address = node API host by default (override per member). Backend port = inbound port on the node.

## Agent and image

`sharx-balancer`: a small Go binary plus HAProxy and nginx on alpine. It reuses `node/auth`. Not the heavy node image.
Ports: agent API (default 8080, mTLS + JWT) and the pool listen ports. Install via compose snippet (as for nodes) or SSH
auto-install (host key pinned).

## Known trade-offs (shown in the UI and docs)

* **Client IP.** With plain passthrough, nodes see the balancer's IP as the client. Per-IP limits, session IPs and
  geo on the nodes then reflect the balancer. PROXY protocol fixes it but must be enabled on the Xray inbound
  (`acceptProxyProtocol`) and then direct connections to that same port stop working, so it is only offered for a pool
  whose inbound is **balancer-only** (`replace` mode with the node port firewalled). Off by default.
* **Health checking.** HAProxy checks backends actively; nginx OSS only reacts to failed connects.
* **Single point of failure.** One balancer is one entry point. Use `prepend`/`append` so clients keep direct nodes
  as a fallback, or run two balancers with two hosts.
* **CDN/WS scenarios** that need TLS termination are out of scope for the first version (use Hosts + a CDN).

## Phases

1. Migration, models, service (pool/member CRUD, spec builder, managed-Host sync), unit tests.
2. Agent, engine renderers (HAProxy, nginx), image, agent tests with real HAProxy/nginx.
3. Panel API and UI (list, add, pools editor, status), translations.
4. Provisioning (compose snippet, SSH install).
5. End-to-end on the test panel: real client connects through the balancer, node failure and recovery,
   subscription output for replace/prepend/append.
