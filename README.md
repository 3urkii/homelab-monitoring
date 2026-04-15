# Homelab Dashboard

Local-network dashboard for monitoring Proxmox hosts + a TrueNAS node_exporter, with service quick-launch links.

## Prerequisites

- Node.js 20+ (Ubuntu 24: `apt install nodejs npm`)
- Network reachability from this host to every target machine on:
  - Proxmox API port 8006 (HTTPS)
  - node_exporter port 9100 (HTTP)
  - Service URLs you want to ping

## Install

```bash
git clone <this-repo> /opt/homelab-monitoring
cd /opt/homelab-monitoring
npm install
```

## Create a read-only Proxmox API token

For each Proxmox host you want to monitor:

1. Log into the Proxmox web UI as root.
2. **Datacenter → Permissions → Users → Add** — realm `pve`, user `dashboard`. Submit.
3. **Datacenter → Permissions → API Tokens → Add** — user `dashboard@pve`, token ID `readonly`, **uncheck "Privilege Separation"**. Submit.
4. **Copy the secret** shown in the popup — you will only see it once.
5. **Datacenter → Permissions → Add → User Permission** — path `/`, user `dashboard@pve`, role `PVEAuditor`, propagate checked.

The token's full ID is `dashboard@pve!readonly` and goes in `config.js` as `tokenId`, paired with the secret in `tokenSecret`.

## Install node_exporter on TrueNAS

TrueNAS SCALE (systemd-based):

```bash
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.2/node_exporter-1.8.2.linux-amd64.tar.gz
tar xzf node_exporter-*.tar.gz
sudo mv node_exporter-*/node_exporter /usr/local/bin/
# Create a systemd unit or an init script per your preference.
```

Verify: `curl http://<nas-ip>:9100/metrics` should return Prometheus text.

## Configure

Edit `config.js`. Replace every `REPLACE_ME` with actual values:

- `machines[].host` — IP address of the machine
- `machines[].tokenSecret` — Proxmox API token secret (Proxmox entries only)
- `services[].url` — full URL of each service

The `name` field on each `machines[]` entry must match the **Proxmox node hostname** exactly (visible in the Proxmox UI under Datacenter → Summary).

## Run

```bash
node server.js
```

Open `http://<this-host>:3000/` in a browser.

Test: `npm test` runs the unit tests for the Prometheus and Proxmox parsers and the poller.

## systemd service

```bash
sudo cp homelab-dashboard.service /etc/systemd/system/
sudo useradd --system --home /opt/homelab-monitoring --shell /usr/sbin/nologin dashboard
sudo chown -R dashboard:dashboard /opt/homelab-monitoring
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-dashboard
sudo systemctl status homelab-dashboard
```

Logs: `journalctl -u homelab-dashboard -f`

## Service icons

Drop SVG files into `public/icons/` matching the `icon` filenames in `config.js` (e.g. `plex.svg`, `pve.svg`). If a file is missing, the frontend falls back to a 3-character text label derived from the service name.

## Known limitations

- **QEMU VM disk usage** reports as `0 B / 0 B` unless `qemu-guest-agent` is installed inside the guest. LXC containers report correctly.
- **First poll after startup** shows `—` for network rates and node_exporter CPU% because rate calculation needs two samples.
- **No authentication** — deploy only on an internal network.
- **HTTP only** — no TLS termination; put it behind a reverse proxy if you need HTTPS.

## Architecture

See `docs/superpowers/specs/2026-04-15-homelab-dashboard-design.md` for the design document.

- `server.js` — Express wiring, config validation, routes, service ping
- `lib/poller.js` — interval loop, in-memory cache, rate calculation, error isolation
- `lib/proxmox.js` — Proxmox API client (`/cluster/resources` + `/nodes/<name>/status`)
- `lib/node_exporter.js` — Prometheus text parser + HTTP fetch
- `public/index.html` — self-contained frontend (Dracula palette, JetBrains Mono, Rajdhani)
