# 15. Security Hardening

[← Balancers](./14-balancers.md) | [Contents](./README.md)

A checklist for administrators running SharX in production.

## Database

- Never publish PostgreSQL (port 5432) on a public interface. The default `docker-compose.yml` binds it to `127.0.0.1`; keep it that way.
- Replace the placeholder database password in `.env` before the first start. Use a long random value.
- If the panel and the database are on different hosts, use a private network or TLS.

## Panel access

- Serve the panel over HTTPS only, and put it behind a reverse proxy you control. Do not expose the panel port directly next to a proxy: client IP headers (`X-Forwarded-For`) are only trustworthy when they come from your own proxy.
- Turn on two-factor authentication for every administrator (Settings → Security) and use unique passwords.
- Review active sessions regularly (Settings → Security → Sessions) and end the ones you do not recognise.
- Give administrator accounts only to people who need them: an administrator can import/export the database, change the Xray configuration and manage nodes.

## API tokens

- Treat API tokens like passwords: create one per integration, store it in a secret manager, delete tokens you no longer use.
- Rotate tokens periodically. A token stays valid until you delete it.

## Nodes

- Restrict the node health endpoint (`/health`) and the Prometheus metrics endpoint to your monitoring network with a firewall or reverse-proxy rules. They reveal versions, uptime and sidecar state.
- When installing a node over SSH, check the server fingerprint yourself before entering credentials.
- If a node or an installation host may have been compromised, regenerate the pairing secret and re-pair the nodes.

## Updates and Docker

- Keep the panel, nodes and balancers up to date; update from the panel's Version dialog or pull the latest images.
- Watchtower has access to the Docker socket, which is equivalent to root on the host. Keep its HTTP API on `127.0.0.1` and set `WATCHTOWER_HTTP_API_TOKEN` to a strong value.
- Use only trusted sources for geo files and templates.

## Backups

- A database export contains password hashes, subscription IDs and secrets. Store backups encrypted and restrict access.
- Make sure `pg_dump` is available in the panel container (the official image includes it) so exports are complete. Restore only files created by the panel.
- After restoring, check that the panel starts and the migrations finish without errors.
