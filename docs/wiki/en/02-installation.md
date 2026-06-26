# 2. Installation

[← Overview](./01-overview.md) | [Contents](./README.md) | [Web Interface →](./03-web-interface.md)

## Requirements

- Linux server (Ubuntu, Debian, CentOS, Fedora, Arch, Alpine, openSUSE)
- Root access
- Free ports: **2053** (panel), **2096** (subscriptions), **80** (for SSL certificate)
- Docker and Docker Compose (installed automatically by the script or manually)

---

## Option 1: Automated Installation (Recommended)

```bash
git clone https://github.com/konstpic/SharX.git
cd SharX
sudo ./install_ru.sh
```

The script:

1. Detects the Linux distribution and installs Docker.
2. Prompts you to choose network mode: **host** or **bridge**.
3. Configures panel and subscription ports.
4. Generates a PostgreSQL password.
5. Issues an SSL certificate via Let's Encrypt (acme.sh).
6. Starts all services.

### Management Menu

After installation, running `sudo ./install_ru.sh` again opens the menu:

- Install / update / start / stop / restart the panel
- Change ports, database password, certificates
- View logs and status
- Uninstall

---

## Option 2: Manual Installation via Docker Compose

### Step 1. Clone the Repository

```bash
git clone https://github.com/konstpic/SharX.git
cd SharX
```

### Step 2. Configure docker-compose.yml

Open `docker-compose.yml` and change:

**Database password** — replace `change_this_password` with a strong password in both places:

```yaml
XUI_DB_PASSWORD: your_strong_password
POSTGRES_PASSWORD: your_strong_password
```

Passwords **must match**.

**Ports** (in bridge mode):

```yaml
ports:
  - "2053:2053"   # Web interface
  - "2096:2096"   # Subscriptions
```

**Host network mode** (recommended for performance):

```yaml
network_mode: host
```

With `network_mode: host`, remove the `ports` section — ports are opened directly on the host. For PostgreSQL connection use `XUI_DB_HOST: 127.0.0.1`.

### Step 3. SSL Certificates

```bash
mkdir -p cert
cp /path/to/fullchain.pem cert/cert.pem
cp /path/to/privkey.pem cert/privkey.pem
```

Files are mounted into the container. In panel settings specify paths:

- Certificate: `/app/cert/cert.pem`
- Key: `/app/cert/privkey.pem`

### Step 4. Start

```bash
docker compose up -d
```

### Step 5. First Login

Open in your browser:

```
http://your-server-IP:2053
```

**Default credentials:**

| Field | Value |
|-------|-------|
| Login | `admin` |
| Password | `admin` |

> Change the password immediately after login: **Settings → Administrator**.

### Step 6. Configure TLS in the Panel

1. Go to **Settings → General**.
2. Specify the **domain name** (e.g. `panel.example.com`).
3. Specify certificate paths (see above).
4. Save and restart the container:

```bash
docker compose restart sharx
```

5. Open `https://panel.example.com:2053` and verify the certificate is valid.

---

## Environment Variables

Full reference: `ENV_VARIABLES.md` in the repository root.

### Main Panel Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `XUI_WEB_PORT` | `2053` | Web interface port |
| `XUI_WEB_DOMAIN` | — | Panel domain |
| `XUI_WEB_BASE_PATH` | `/` | Base URL path |
| `XUI_WEB_CERT_FILE` | — | Path to SSL certificate |
| `XUI_WEB_KEY_FILE` | — | Path to private key |
| `XUI_SUB_PORT` | `2096` | Subscription service port |
| `XUI_SUB_PATH` | `/sub/` | Subscription URI path |
| `XUI_SUB_DOMAIN` | — | Domain for subscriptions |
| `XUI_DB_HOST` | `127.0.0.1` | PostgreSQL host |
| `XUI_DB_PASSWORD` | — | Database password |

These parameters are set **only via environment variables** and are not editable in the web interface.

---

## Updating the Panel

`docker-compose.yml` includes **Watchtower** — an automatic container update service.

**From the web interface:** update button in the panel header (when the registry image is configured correctly).

**Manually:**

```bash
docker compose pull
docker compose up -d
```

**Via script:**

```bash
sudo ./install_ru.sh
# → 2) Update panel
```

> For production, use a ready-made image from the registry (e.g. `registry.konstpic.ru/sharx/sharx:version`) instead of local `build:`, otherwise Watchtower cannot pull updates.

---

## Node Installation (Brief)

Nodes are installed **separately** on other servers after configuring the panel:

1. Enable **Multi-Node mode** in panel settings.
2. Add a node via the interface — copy `docker-compose.yml` with `PANEL_URL` and `SECRET_KEY`.
3. On the node server: `docker compose up -d --build`.

See [Nodes](./05-nodes.md) for details.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Panel won't open | Check `docker compose ps`, logs: `docker compose logs sharx` |
| Database connection error | Ensure `XUI_DB_PASSWORD` = `POSTGRES_PASSWORD`; with host network use `127.0.0.1` |
| SSL not working | Check paths `/app/cert/cert.pem` and `privkey.pem` inside the container |
| Subscription unavailable | Check port 2096, `XUI_SUB_DOMAIN`, firewall |

---

## What's Next

- [Web interface](./03-web-interface.md)
- [Creating inbounds](./04-inbounds.md)
