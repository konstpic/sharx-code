# 5. Nodes

[← Inbounds](./04-inbounds.md) | [Contents](./README.md) | [Hosts →](./06-hosts.md)

## What Is a Node

A **node** is a remote server with a SharX worker and Xray that processes client traffic. The panel manages nodes centrally: sends configuration, checks status, collects statistics.

Nodes are used only in **Multi-Node** mode.

## Enabling Multi-Node Mode

1. Go to **Settings → General**.
2. Enable the **Multi-Node mode** toggle.
3. Save settings.

After enabling:

- Xray **does not start** on the panel server;
- configurations are **sent** to worker nodes;
- inbounds **must be assigned** to nodes;
- subscriptions use **node addresses** (or hosts).

The sidebar **Nodes** section appears with subsections: Management, Statistics, Geography.

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

One inbound can be assigned to **multiple nodes** — the client subscription will have entries for each.

## Statistics and Geography

| Section | URL | Contents |
|---------|-----|----------|
| **Statistics** | `/panel/nodes/statistics/` | Traffic, online per node |
| **Geography** | `/panel/nodes/geography/` | Node location map |

## Node Traffic Limit

The **Traffic limit (GB)** field on a node limits total traffic through that node. Value `0` — unlimited.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Node offline | Check container is running; API port reachable from panel; firewall |
| Pairing error | Ensure `SECRET_KEY` and `PANEL_URL` copied from panel unchanged |
| Xray won't start | Check logs on node; ensure inbounds are assigned |
| Panel can't reach node | With HTTPS panel — CA trust on node; check `NODE_ADDRESS` |

## Full Cycle: Panel to Working Node

```
1. Settings → General → enable Multi-Node
2. Nodes → Add node → fill name and address
3. Registration step → copy docker-compose.yml
4. On node server: docker compose up -d --build
5. In panel: Check → status online
6. Inbounds → create inbound → Nodes step → select this node
7. (Optional) Hosts → public domain for subscription
8. Clients → create client → assign inbound
9. Verify subscription in client application
```

## What's Next

- [Hosts](./06-hosts.md) — public addresses and CDN for subscriptions
- [Inbounds](./04-inbounds.md) — assign inbounds
- [Clients](./07-clients.md)
