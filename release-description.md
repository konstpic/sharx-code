## Release v1.0.0

**SharX** is a modern multi-node Xray management platform with Docker-first deployment, observability hooks, and a visual subscription page builder.

### ✨ Key Features

- **Node Mode**: One panel manages multiple nodes
- **PostgreSQL**: Full migration from SQLite
- **Redis Integration**: Enhanced performance with caching
- **Grafana Integration**: Advanced monitoring with Prometheus metrics and Loki logs
- **Docker-Based**: Easy deployment with pre-built images
- **HWID Protection**: Device identification (Beta, Happ & V2RayTun)
- **Auto SSL**: Let's Encrypt certificates with auto-renewal
- **Environment-Based Configuration**: Flexible domain, port, and certificate management via environment variables

### 🐳 Docker Images

Images are available in Harbor:

- **sharx**: `harbor.sharxconnect.app/sharx/sharx:1.0.0` / `harbor.sharxconnect.app/sharx/sharx:latest`
- **sharxnode**: `harbor.sharxconnect.app/sharx/sharxnode:1.0.0` / `harbor.sharxconnect.app/sharx/sharxnode:latest`
- **postgres**: `harbor.sharxconnect.app/sharx/postgres:16-alpine` / `harbor.sharxconnect.app/sharx/postgres:latest`

### 📦 Quick Start

Update your `docker-compose.yml`:

```yaml
services:
  sharx:
    image: harbor.sharxconnect.app/sharx/sharx:latest
  sharxnode:
    image: harbor.sharxconnect.app/sharx/sharxnode:latest
  postgres:
    image: harbor.sharxconnect.app/sharx/postgres:latest
```

### 📝 Installation

For detailed installation instructions, see the [README](https://github.com/konstpic/SharX#quick-start--быстрый-старт).

Quick install:

```bash
git clone https://github.com/konstpic/SharX.git
cd SharX
sudo bash ./install_ru.sh
```

### 🔄 Changes

See commit history for detailed changes.
