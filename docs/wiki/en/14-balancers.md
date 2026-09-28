# 14. Balancers

[← Bundles](./13-bundles.md) | [Contents](./README.md)

## What a balancer is

A **balancer** is a separate server with **HAProxy** or **nginx (stream)** in front of your nodes. The client connects to the balancer's address, and the balancer forwards the connection to one of the nodes running the same inbound.

```
client ──► balancer:PORT ──(TCP/UDP passthrough)──► node:inbound port ──► Xray
```

Traffic is **not decrypted**, so Reality, TLS, VLESS, VMess, Trojan, Shadowsocks, Telemt and other protocols work unchanged; only the address in the client link differs.

What it gives you: one stable address for several nodes, automatic exclusion of a failed node, load spreading, hiding node IPs from clients.

The section is in the menu **Nodes → Balancers** (`/panel/nodes/balancers/`) and, like **Nodes**, is available in Multi-Node mode.

## Components

| Component | Description |
|-----------|-------------|
| **Agent** | A process on your server: receives the configuration from the panel, validates it with the engine (`haproxy -c` / `nginx -t`), swaps it atomically and reloads without dropping current connections. If validation fails the previous config keeps running and the error is visible in the panel. After a restart it brings up the last applied configuration by itself. |
| **Pool** | One inbound "put behind the balancer": port, distribution, health checks, PROXY protocol, members. |
| **Pool members** | The pool's nodes: weight, "backup", enabled or not. By default they are taken from the nodes assigned to the inbound ("Follow the inbound's nodes automatically"). |

## Engines

| | HAProxy | nginx (stream) |
|---|---------|----------------|
| TCP | yes | yes |
| UDP (Hysteria2, WireGuard, AmneziaWG) | no | yes |
| Health checks | active (TCP connect every 3 s) | passive (two failures in a row, 10 s pause) |
| Distribution | "Round robin", "Least connections", "By client IP (sticky)" | same |

A UDP inbound can only be put behind a balancer with the **nginx** engine — the panel checks this.

## Adding and installing

1. **Nodes → Balancers → Add balancer**: **Name**, **Public address (what clients connect to)**, **Engine**, optionally **Agent API address** (default `http://<public address>:8080`) and **Note**.
2. Press **Install on the server** and choose a method:
   - **Automatically over SSH.** Enter **SSH host**, **Port**, **User** and **Password** or **Private key**. Press **Check the server and install**. The panel reads the server's **SSH host key fingerprint** and asks you to confirm it ("Confirm the server's SSH host key"): compare it with the output of `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server and press **Fingerprint matches, connect**. Without confirmation the connection is not opened. The panel then installs Docker (if missing), writes `docker-compose.yml` to `/opt/sharxbalancer`, starts the agent and pushes the configuration. Credentials are used once and are not stored.
   - **Manually (docker-compose).** The install window has a ready `docker-compose.yml` with your `SECRET_KEY`. Save it on the server and run `docker compose up -d`.
3. In the server firewall open the **agent port** (default **8080**) for the panel and the **pool ports** for clients. The agent runs in `network_mode: host`.

The panel-to-agent channel is protected by JWT with a shared secret but has **no TLS**: restrict the agent port to the panel's address.

## Pools

**Balancers** → on the card, **Put an inbound behind this balancer**:

| Field | Description |
|-------|-------------|
| **Inbound** | Which inbound is balanced (UDP: nginx only) |
| **Balancer port** | Port for clients; empty means "same as the inbound" |
| **Distribution** | Round robin / Least connections / By client IP |
| **What the client gets in the subscription** | Whether to show the balancer (see below) |
| **Nodes in the pool**, **Weight**, "backup" | Members; with "Follow the inbound's nodes automatically" the node set is maintained automatically |
| **Member weight** | How the weight of each node is decided: Manual, Auto: by node load, Auto: by ping (see below) |
| **Skip nodes that stop responding** | Health checks |
| **PROXY protocol** | Real client IP on the nodes (see "Limitations") |
| **Pool enabled** | Enables the pool |

The panel pushes the configuration to the agent and reconciles it every 15 seconds: node changes of the inbound, port changes, a disabled node are picked up automatically. Card buttons: **Refresh status**, **Push configuration**.

## Member weight: Manual, Auto: by node load, Auto: by ping

By default HAProxy/nginx just spread connections round-robin (or by the chosen algorithm) with every member weighted equally. **Member weight** on the pool form changes how the per-node weight is decided:

| Mode | Weight comes from | Node without data |
|------|--------------------|--------------------|
| **Manual** | The number you type into the **Weight** column for each node | — (you always set it) |
| **Auto: by node load** | The node's admin-set **Uplink bandwidth (Mbps)** (Nodes → edit) vs. its real reported throughput | Falls back to a low weight (1) instead of being excluded |
| **Auto: by ping** | TCP-connect latency the balancer agent itself measures to that node | An unreachable node, or one the agent hasn't reported yet, falls back to a low weight (1) |

**Auto: by node load** needs one extra setting per node: open **Nodes → edit node → Uplink bandwidth (Mbps)** and enter the node's real uplink capacity (0 = unknown). The node service samples its main network interface every 3 seconds and reports the current throughput to the panel; the panel turns `throughput / bandwidth` into a load percentage and weights nodes with more headroom higher. A node left at 0 Mbps is not excluded — it simply always gets the low fallback weight, so it still receives some traffic under this mode.

**Auto: by ping** needs nothing extra on the node side: the balancer agent already TCP-dials every pool member as part of its own health check, and now times that connection. Closer/faster nodes (lower latency to the balancer) get a higher weight automatically. This is the mode to reach for when "load" doesn't matter as much as physical/network distance from the balancer — e.g. clients are expected to connect through this particular balancer's region and you want it preferring the nearest node.

Both auto modes recompute on a shared timer, **Settings → General → Balancer auto-weight → Recompute interval (sec)** (default 30 s, minimum 5 s — one setting, applies to every pool set to an auto mode). Each recompute writes the new weight into the pool's member rows and re-pushes the configuration to the agent, so a `docker exec ... cat haproxy.cfg` on the balancer shows the current computed weights (`server sN <host>:<port> weight <N> ...`).

Switching a pool to **Manual** stops the recompute for that pool; the last computed (or your own) weights stay until you change them.

> Auto weighting only chooses *how much* traffic a healthy node gets — it does not replace health checks. A node that fails its health check is still dropped from rotation regardless of weight mode.

## Traffic graph

The **Traffic** button on the balancer card opens a live graph: speed "To clients" and "From clients", connections, breakdown by pool. The agent samples the data every 2 seconds, the last hour of history is kept in the agent, the panel database is not loaded. nginx has no per-port counters, so an estimate is shown (half of the server's network traffic).

## How a balancer appears in the subscription (2.0 model)

If a pool has subscription output enabled, the panel creates a "Balancer" (`pool`) host; it appears in **Hosts** by itself. A client gets it only if the host is **included in a bundle** ([Bundles](./13-bundles.md)). The order of entries in the subscription is the order of hosts in the bundle:

| You want | Put in the bundle |
|----------|-------------------|
| Balancer first, then direct nodes as a fallback | the balancer host, then node hosts |
| Direct nodes, balancer last | node hosts, then the balancer host |
| Balancer only | only the balancer host (node addresses are hidden; if the balancer is down there is no route) |
| Balancer works but is not in the subscription | a pool without subscription output ("Do not show the balancer") or the host is not in any bundle |

Several balancers per inbound are supported.

> **Before 2.0** the output mode ("balancer, then direct", "direct, then balancer", "balancer only") was chosen on the pool and defined the order by itself. In 2.0 the bundle sets the order; on upgrade the old pool modes are recalculated into the order of hosts in bundles, and the conversion verifies that subscriptions did not change. The pool form still has the mode choice; rely on the bundle for the order in the subscription.

## Limitations

- **Client IP.** Without PROXY protocol the nodes see the balancer's address: IP limits, sessions and geography on the nodes show it. PROXY protocol is enabled on the pool, but the inbound must accept it (`acceptProxyProtocol`); direct connections to that port then stop working. Use it with the "balancer only" setup.
- **Health.** The L4 check only sees "the port accepts connections". A node with a hung Xray and an open port stays in rotation.
- **Single point of failure.** One balancer is one entry point. Keep direct node hosts after the balancer host in the bundle, or use two balancers.
- **No TLS termination.** WebSocket/gRPC behind a CDN that needs TLS on the balancer is not supported: use an [address host](./06-hosts.md) and the CDN.
- The panel-to-agent channel has no TLS (see above).

## What's Next

- [Hosts](./06-hosts.md), [Bundles](./13-bundles.md)
- [Nodes](./05-nodes.md)

---

[← Back to contents](./README.md)
