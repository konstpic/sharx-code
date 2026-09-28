# 5. Nodes

[← Inbounds](./04-inbounds.md) | [Contents](./README.md) | [Hosts →](./06-hosts.md)

## What Is a Node

A **node** is a remote server with a SharX worker and Xray that processes client traffic. The panel manages nodes centrally: sends configuration, checks status, collects statistics.

Nodes are used only in **Multi-Node** mode.

## Enabling Multi-Node Mode

1. Open **Panel Settings → “Panel & general”** and find the **“Nodes and network”** section.
2. Enable the **Multi-Node mode** toggle.
3. Save settings.

After enabling:

- Xray **does not start** on the panel server;
- configurations are **sent** to worker nodes;
- inbounds **must be assigned** to nodes;
- subscriptions are built from **hosts**: every node with an inbound gets a "Node" host (before 2.0 node addresses were added when the subscription was assembled).

The sidebar **Nodes** section appears with subsections: Node management, Statistics, Geography, **Balancers** (see [Balancers](./14-balancers.md)).

## Adding a Node

**Nodes** page (`/panel/nodes/`) → **Add node**.

The wizard has three steps.

### Step 1. New Node

| Field | Description |
|-------|-------------|
| **Node name** | Unique name (can include country flag 🇩🇪🇺🇸) |
| **Address / URL** | Node server IP or domain |
| **Port** | Worker API port (default **8080**) |
| **TLS** | Use HTTPS for API |
| **Traffic limit (GB)** | 0 = unlimited |

### Step 2. Registration

Two sub-steps:

#### 2.1. Register in Panel

Click **Create node record** (or similar button on the sub-step).

The panel:
1. Creates a database record.
2. Generates **SECRET_KEY** — base64 JSON bundle (TLS, mTLS, JWT).
3. Shows ready **`docker-compose.yml`**:

```yaml
# fragment — real values are substituted automatically
services:
  sharx-node:
    environment:
      PANEL_URL: https://panel.example.com
      SECRET_KEY: eyJ...base64...
```

**Actions:**
1. Click **Copy** on the compose block.
2. Do not edit `SECRET_KEY` manually.

#### 2.2. Connect Node

On the **node server** (separate VPS):

```bash
# 1. Prepare directory
mkdir -p ~/sharx-node && cd ~/sharx-node

# 2. Create compose file
nano docker-compose.yml
# Paste copied content, save (Ctrl+O, Enter, Ctrl+X)

# 3. Start
docker compose up -d --build

# 4. Check logs
docker compose logs -f
```

**Node server requirements:**
- Linux with Docker;
- inbound ports open (443, 10000, etc.);
- `/dev/net/tun` (for VPN protocols);
- outbound access to panel `PANEL_URL`.

Return to the panel → click **Check** (health-check).

**Success:** status **online**, Xray — **Running**.

**Offline error:**
- panel cannot reach node at `address:8080`;
- incorrect `SECRET_KEY`;
- firewall blocks node API port (8080) from panel IP.

### Step 3. Xray Profile for Node

Optionally assign an **Xray core config profile** for this node:

- **Skip** — use default profile;
- **Assign and close** — bind selected profile.

## Installing a Node over SSH

When installing a node or a [balancer](./14-balancers.md) over SSH the panel first reads the server's **SSH host key fingerprint** and asks you to confirm it ("Confirm the server's SSH host key" → **Fingerprint matches, connect**). Compare it with the output of `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server. Without a confirmed fingerprint the connection is rejected (before 2.0 any key was accepted). For the API: call `POST /panel/node/ssh-hostkey` first, then pass `hostKeyFingerprint` to `POST /panel/node/ssh-provision`.

## Manual Node Deployment

Typical node `docker-compose.yml` contains:

```yaml
environment:
  SECRET_KEY: <base64 bundle from panel>
  PANEL_URL: https://panel.example.com
  NODE_ADDRESS: <public IP if auto-detection doesn't work>
```

- `network_mode: host` — recommended;
- volumes: `cert/`, `data/`, `logs/`;
- Telemt and AmneziaWG sidecars if needed.

Details: `node/README.md`.

## Node Authentication

| Mode | Description |
|------|-------------|
| **Pairing (recommended)** | mTLS + JWT via `SECRET_KEY`. Secure exchange. |
| **Legacy** | Static API key (deprecated, for compatibility). |

In pairing mode, separate manual TLS setup on the node is **not required** — everything is set by the `SECRET_KEY` bundle.

## Node List

Table / tiles with information:

| Field | Description |
|-------|-------------|
| **Status** | `online` / `offline` / `unknown` — API availability |
| **Xray** | Running / Stopped / Error — core state on node |
| **Telemt** | MTProto sidecar state |
| **AmneziaWG** | AmneziaWG sidecar state |
| **Traffic** | Upload / download |
| **Inbounds** | Assigned connections |
| **Profiles** | Core configuration profiles |

## Node Actions

| Action | Description |
|--------|-------------|
| **Check** | API health-check |
| **Reload config** | Push configuration to node |
| **Stop / Start Xray** | Core management |
| **Stop / Start Telemt** | MTProto sidecar management |
| **Stop / Start AmneziaWG** | AWG sidecar management |
| **Edit** | Change name, address, limits |
| **Disable** | Temporarily stop sync (without deletion) |
| **Delete** | Remove node from panel |

## Assigning Inbounds to Nodes

When creating or editing an **inbound**, on the **Nodes** step:

1. Select one or more nodes.
2. For each assignment configure:
   - **Include in subscription** — show endpoint in client subscription;
   - **Published address** — address the client sees;
   - **Published port** — port in subscription;
   - **Remark suffix** — addition to server name in subscription.

One inbound can be assigned to **multiple nodes**. For each assignment the panel creates a "Node" host itself (edit address, port, suffix and description in **Hosts**); the client gets it in the subscription if the host is in one of the client's [bundles](./13-bundles.md). If the bundle has auto-add enabled, the host of a new node is appended to the bundle automatically.

An empty node list when editing an inbound detaches the inbound from all nodes. When a node is deleted its hosts are removed, but clients keep their access.

## Statistics and Geography

| Section | URL | Contents |
|---------|-----|----------|
| **Statistics** | `/panel/nodes/statistics/` | Traffic, online per node |
| **Geography** | `/panel/nodes/geography/` | Node location map |

## Node Traffic Limit

The **Traffic limit (GB)** field on a node limits total traffic through that node. Value `0` — unlimited.

## Uplink Bandwidth (Load-Based Balancing)

The **Uplink bandwidth (Mbps)** field tells the panel this node's real network capacity so a balancer pool with **Member weight → Auto: by node load** can weight it correctly (see [Balancers → Member weight](./14-balancers.md#member-weight-manual-auto-by-node-load-auto-by-ping)). Value `0` — unknown; the node still works normally and can still be used with manual weights or "Auto: by ping", it just always gets a low fallback weight under load mode instead of being weighted by real usage.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Node offline | Check container is running; API port reachable from panel; firewall |
| Pairing error | Ensure `SECRET_KEY` and `PANEL_URL` copied from panel unchanged |
| Xray won't start | Check logs on node; ensure inbounds are assigned |
| Panel can't reach node | With HTTPS panel — CA trust on node; check `NODE_ADDRESS` |

## Full Cycle: Panel to Working Node

```
1. Panel Settings → “Panel & general” → “Nodes and network” → enable “Multi-Node Mode”
2. Nodes → Add node → fill name and address
3. Registration step → copy docker-compose.yml
4. On node server: docker compose up -d --build
5. In panel: Check → status online
6. Inbounds → create inbound → Nodes step → select this node
7. Hosts → check the node host; (optional) add an address host for your own domain
8. Bundles → create a bundle with the needed hosts
9. Clients → create client → pick the bundle
10. Verify subscription in client application
```

## What's Next

- [Hosts](./06-hosts.md) — public addresses and CDN for subscriptions
- [Inbounds](./04-inbounds.md) — assign inbounds to nodes
- [Bundles](./13-bundles.md), [Balancers](./14-balancers.md)
- [Clients](./07-clients.md)
