# Embedded mesh (v2.13.0)

The controller is native **Go**, running as part of the `x-ui` process in the **same panel container**. There is no child interpreter, sidecar, controller listener or Docker socket. Host agents are static Go binaries bundled for Linux amd64 and arm64 and installed only on enrolled workers. The panel requires no NET_ADMIN, host networking or access to the overlay: authenticated etcd requests travel through pinned SSH tunnels.

Only multi-node installations can use mesh. It is disabled by default; standalone mode never starts the controller or creates its state. Server-side mode guards and `mesh:read` / administrator-only `mesh:operate` permissions protect all routes. Organization-scoped accounts cannot manage this shared infrastructure.

## Setup

1. Enable multi-node mode and register the worker nodes normally.
2. Open Nodes → Mesh & relays, enable mesh and save. No remote installation runs automatically.
3. Select an existing worker, its entry/exit role and SSH port. Read and independently verify its SSH host-key fingerprint. Submit one-time SSH credentials. The panel installs its own Ed25519 public identity, Linux tools and `sharx-mesh-agent.service` on that worker. Passwords and uploaded private keys are not saved. Subsequent connections require the same pinned SSH host key. A root account, or passwordless sudo, and systemd are required.
4. Select three installed workers and install the initial etcd quorum. Five or seven are also supported. Clients and peers require mTLS from the first start; there is no HTTP migration stage. Existing etcd and data are never overwritten. Interrupted bootstrap can resume with the same members.
5. Agents discover selected peers from a single atomic registry value (partial bootstrap prefixes cannot remove links), generate private WireGuard keys locally, build links and choose transit paths using loss, RTT and normalized load with hysteresis. They retain their last graph when etcd or the panel is unavailable.
6. For automatic relay/pool decisions, configure real HTTPS probe ports and SNI that work on **every selected exit**. A TCP SYN/ACK is not considered proof that traffic works. Without these probes, only overlay monitoring is available.
7. Configure the public entry/relay address and explicitly select one balancer pool. Enable only the automation you want. Defaults are observe-only.

The panel itself, unrelated servers and balancer-only agents cannot be enrolled: enrollment requires an enabled worker row and derives its IP from that row. The current installer requires an IPv4 node API address. A node may be both an entry/exit and an etcd member; these are separate roles.

## Resource isolation

Resources differ from the Remnawave mesh. Do not reuse that mesh's inventory, CA, SSH key or endpoints.

| Resource | SharX |
|---|---|
| Overlay | `10.203.0.0/24` (up to 200 enrolled nodes) |
| Point-to-point links | `10.204.X.Y`, interfaces `sxm-<peer>` |
| WireGuard UDP | `53000 + peer's overlay octet` |
| etcd client / peer | HTTPS 2399 / 2391, overlay and loopback only |
| etcd container / persistent data | `sharx-mesh-etcd` / `/var/lib/sharx-mesh-etcd` on selected workers |
| Host agent / configuration | `sharx-mesh-agent.service` / `/etc/sharx-mesh` |
| DNAT relay | `sharx-mesh-fwd.service`, `SXMFWD*` chains |
| Relay ports | 55000–64999, stable 100-port slots for up to 100 exit slots |
| etcd keys | `/sharx-mesh/` |

Check these ranges against the installation's existing networks and listeners before enabling mesh. Firewall policy must permit the listed WireGuard ports between enrolled workers, ICMP on overlay links, HTTPS etcd between workers, and configured public relay ports. No firewall is opened in the cluster.

## Relays and subscriptions

Modes are automatic, direct and relay. Relay state records originals durably on the panel persistent volume **before** forwarding or subscription changes. Interrupted operations resume. Address/port edits made outside mesh cause a conflict rather than silent overwrite. Restoring preserves a host's raw zero/inherited port and its original customization flag, including hosts disabled while the relay was active.

Only placement hosts belonging unambiguously to a particular node are eligible. Arbitrary address hosts, pool hosts, legacy shared hosts and hosts with a custom published port different from the inbound's real port are not rewritten. Configure explicit placement hosts for mesh-managed subscriptions. New eligible hosts created while a relay is active are reconciled into its saved plan. Both TCP and UDP use the allocated relay port. At most 100 distinct inbound ports can be allocated; assignments remain stable when new ports are added.

A pool's mesh exclusion is a separate desired-state layer. It does not overwrite manual member enable/weight/backup flags and applies only to the explicitly selected pool. Directly disabling a node and disabling it in the mesh pool are different operations.

The public-IP watcher requires three matching observations. An offline node cannot announce a provider-side IP change: recover the guest network first. The API URL retains its scheme, port and path. DNS automation is intentionally not implicit: domains remain under their existing DNS/GitOps management.

## etcd operations and durability

New members join as learners and are promoted only after etcd confirms synchronization. Removing a voter must leave at least three healthy voters. Membership transitions and bootstrap seeds survive controller restarts. Removed members' data is retained. Finish a pending operation before starting another.

The etcd 3.6.15 image is version-pinned. See the official [runtime reconfiguration guide](https://etcd.io/docs/v3.6/op-guide/runtime-configuration/) and [transport security model](https://etcd.io/docs/v3.6/op-guide/security/).

Mount a persistent volume at `XUI_MESH_STATE_DIR` (default `/etc/x-ui/mesh`). It holds the mesh's own SSH identity, CA, enrollment, stable port assignments, bootstrap progress and discovery seeds. Directory permissions are 0700, sensitive/state files 0600. Back this volume up **alongside PostgreSQL and etcd data**: a database-only backup is insufficient. Never commit these files. Keep this deployment single-replica; there is one controller owner per panel process, not a distributed controller election.

Leaf certificates are valid for one year and the CA for ten years. Plan certificate renewal before expiry; CA recreation is refused when an existing CA certificate has lost its key. Do not delete mesh state to troubleshoot a running installation.

Disabling multi-node stops the panel controller. Agents preserve established routes across a panel outage; they are explicitly removed with “Remove mesh from node,” after restoring relays and removing any etcd role. Removal preserves worker services and etcd data.

## Development verification

- `go test ./...` plus PostgreSQL integration tests using `SHARX_TEST_DB` (disposable database only).
- `go test -race ./mesh/...`: native lifecycle, routing hysteresis, untrusted registry validation and relay journals.
- `cd panel && npx tsc --noEmit --incremental false && npm run build`.
- The local Linux integration fixture uses `mesh/test/Dockerfile.node`. Never point it at production workers or attach a production Docker socket.

Release v2.13.0 ships the optional feature disabled by default. Enabling and enrolling production nodes remains an explicit administrator operation.
