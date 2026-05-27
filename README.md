# Homelab Dashboard

Local-network dashboard for monitoring Proxmox hosts with auto-discovered LXCs/VMs, historical graphs, and ntfy alerting.

## Prerequisites

- Node.js 20+ (Ubuntu 24: `apt install nodejs npm`)
- Network reachability from this host to every Proxmox node on API port 8006 (HTTPS)

## Install

```bash
git clone <this-repo> /opt/homelab-monitoring
cd /opt/homelab-monitoring
npm install
cp config.example.js config.js
```

`config.js` is gitignored — your secrets stay local. `config.example.js` is the tracked template.

## Create a read-only Proxmox API token

For each Proxmox host you want to monitor:

1. Log into the Proxmox web UI as root.
2. **Datacenter → Permissions → Users → Add** — realm `pve`, user `dashboard`. Submit.
3. **Datacenter → Permissions → API Tokens → Add** — user `dashboard@pve`, token ID `readonly`, **uncheck "Privilege Separation"**. Submit.
4. **Copy the secret** shown in the popup — you will only see it once.
5. **Datacenter → Permissions → Add → User Permission** — path `/`, user `dashboard@pve`, role `PVEAuditor`, propagate checked.

The token's full ID is `dashboard@pve!readonly` and goes in `config.js` as `tokenId`, paired with the secret in `tokenSecret`.

## Configure

Edit `config.js`. Replace every `REPLACE_ME` with actual values:

- `machines[].name` — **must match the Proxmox node hostname exactly** (visible in the Proxmox UI under Datacenter → Summary). Used in the Proxmox API paths and to filter `/cluster/resources`.
- `machines[].label` — optional; friendlier display name shown on the dashboard card and in ntfy alert titles. Defaults to `name`.
- `machines[].host` — IP address or DNS name of the Proxmox node
- `machines[].tokenSecret` — Proxmox API token secret
- `machines[].primaryUrl` — optional; makes the machine card name a clickable link to the web UI
- `guestLinks[]` — optional; overlay a URL + icon onto an auto-discovered LXC/VM so its row becomes clickable. The `guest` field must match the LXC/VM name in Proxmox.

**Guests are auto-discovered.** Every LXC and VM on your Proxmox hosts appears in the dashboard with live stats — no config needed. You only add `guestLinks` entries for guests you want to make clickable.

## Run

```bash
node server.js
```

Open `http://<this-host>:3000/` in a browser.

Test: `npm test` runs the unit tests for the Proxmox parser, poller, storage, and alerts.

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

Drop SVG files into `public/icons/` matching the `icon` filenames in `guestLinks[]` (e.g. `plex-light.svg`). Missing files fall back to a 3-character text label derived from the guest name. Browse `selfh.st/icons/` for an open-source icon pack covering most self-hosted services.

## Historical graphs

Every poll persists CPU / memory / disk / network for every machine **and** every auto-discovered guest into a local SQLite file at `data/dashboard.db`. Click the graph button on any machine card or guest row to open a chart modal with a range picker (1h / 24h / 7d / 30d), overlaid CPU, memory, rx, and tx lines, and drag-to-zoom.

Retention is tiered to keep disk use bounded:

| Tier | Resolution | Retention |
|---|---|---|
| Hot | 10s | 24 hours |
| Warm | 1 minute | 7 days |
| Cold | 10 minutes | 30 days |

A background rollup runs every 5 minutes: data aging out of a tier is averaged into the next tier, then the previous tier is pruned. Expected steady-state disk footprint is roughly **60 MB for 25 entities**, scaling linearly (~100 MB at 40, ~150 MB at 60).

`data/` is in `.gitignore` and backed by SQLite WAL — safe across restarts, no migration needed when the schema is unchanged.

## Alerting (ntfy)

Push notifications to an [ntfy](https://ntfy.sh) topic when a rule fires or resolves. Add an `alerts` block to `config.js`:

```js
alerts: {
  ntfy: {
    url: "https://ntfy.sh/your-private-topic",
    firingPriority: "high",
    resolvedPriority: "default",
    firingTags: ["warning"],
    resolvedTags: ["white_check_mark"],
  },
  defaults: {
    cpuPct: 90,
    memPct: 90,
    diskPct: 90,
    forMs: 5 * 60 * 1000,
    reachability: true,
  },
  overrides: [
    { machine: "proxmox-internal", guest: "plex-lxc", cpuPct: 95 },
    // Mute every alert for an on-demand guest you spin up and shut down frequently:
    { machine: "proxmox-internal", guest: "test-vm", mute: true },
    // Machine-level mute silences the host and all its guests:
    // { machine: "proxmox-dmz", mute: true },
  ],
},
```

A threshold must hold continuously for `forMs` before firing. Reachability (scrape failure / machine down) fires immediately. One notification on fire, one on resolve — no re-notify. Events persist to SQLite (`alert_events` table, keeps last 1000 rows or 90 days) and render in the dashboard's **Alerts** section (active list + collapsible history). Omit the `alerts` block entirely to disable.

`mute: true` on an override skips all evaluation (cpu/mem/disk/reachability) for that machine/guest. Any alerts already firing for it auto-resolve on the next poll, so they clear from ntfy and the active list. Drop the override to re-enable.

Guests deleted from Proxmox are detected automatically: on the next poll where the host is reachable but the guest is no longer in `/cluster/resources`, any stuck firing alerts for it auto-resolve and its state is forgotten. No manual cleanup needed when you destroy an LXC/VM.

## Weather widget (landing page)

Optional weather chip in the landing-page header showing current temperature + conditions, with a click-to-open dropdown that has feels-like, humidity, wind, sunrise/sunset, and a 7-day forecast. Powered by [Open-Meteo](https://open-meteo.com) — no API key.

Add a `weather` block to `config.js`:

```js
weather: {
  latitude: 40.7128,
  longitude: -74.0060,
  label: "home",        // optional; shown in the dropdown
  unit: "fahrenheit",   // optional; "celsius" (default) | "fahrenheit"
},
```

The server proxies Open-Meteo and caches the response for 10 minutes; if a refresh fails it serves the last good response with a `cached — last fetch failed` notice. Omit the block to hide the chip entirely.

## Hue lights via Home Assistant

Optional `/lights` page that lists, controls, and live-updates Philips Hue (or any HA-managed) lights and scenes through a thin proxy in front of Home Assistant. The dashboard never sees the HA token; the backend holds a single WebSocket to HA and fans events out to all connected browsers via Server-Sent Events.

**Mint a token**

1. Open HA → click your user avatar (bottom-left) → **Long-Lived Access Tokens**.
2. Create Token, name it `dashboard`, copy the value (shown once).

**Configure**

Uncomment the `homeAssistant` block in `config.js`:

```js
homeAssistant: {
  url: "http://homeassistant.local:8123",
  token: "paste-long-lived-token-here",
},
```

Restart the dashboard. A `lights` link appears in the header; `/lights` is also reachable directly. Omit the block entirely to disable.

**How it works**

- Backend opens one WS to `<HA_URL>/api/websocket`, authenticates with the long-lived token, fetches the area / device / entity registries, subscribes to `state_changed` (filtered to `light.*` and `scene.*`), and reconnects with exponential backoff (1s → 30s, jittered) on disconnect.
- REST commands go through `POST /api/lights/:entity_id` (`{ on?, brightness_pct?, rgb_color? }`) and `POST /api/scenes/:entity_id/activate`. Brightness is `0..100` on the wire and converted to HA's `0..255` server-side.
- The frontend subscribes to `GET /api/lights/stream` (SSE). The first event is a full snapshot; subsequent events are per-entity diffs. Multiple tabs share the single upstream WS.
- When HA is unreachable, the page shows a `home-assistant offline — reconnecting…` banner; commands still queue but `GET /api/lights` returns `503 Home Assistant offline` until the WS reconnects.
- Lights/scenes are grouped by HA "area". Anything without an area lands in `Unassigned`. Color picker is shown only for bulbs whose `supported_color_modes` includes `hs`/`rgb`/`rgbw`/`rgbww`/`xy`. Unreachable bulbs (`state == "unavailable"`) render greyed out and disabled.

### TV remote

Set `config.tv` (requires `homeAssistant`) to mount a TV-remote button in the top bar of `/` and `/lights`. The remote drives `media_player.*` entities — power, volume, mute, and a configurable 2×2 grid of one-tap source shortcuts (HDMI inputs, apps). See `config.example.js` for the schema.

## Known limitations

- **QEMU VM disk usage** reports as `0 B / 0 B` unless `qemu-guest-agent` is installed inside the guest. LXC containers report correctly.
- **First poll after startup** shows `—` for network rates and node_exporter CPU% because rate calculation needs two samples.
- **No authentication** — deploy only on an internal network.
- **HTTP only** — no TLS termination; put it behind a reverse proxy if you need HTTPS.
- **uPlot is loaded from a CDN** on first chart open (jsDelivr). The dashboard runs fine without internet, but clicking a chart button on an offline host will show a load error.

## Architecture

See `docs/superpowers/specs/2026-04-15-homelab-dashboard-design.md` for the design document.

- `server.js` — Express wiring, config validation, routes, storage, rollup job
- `lib/poller.js` — interval loop, in-memory cache, rate calculation, error isolation, persistence
- `lib/storage.js` — SQLite time-series store with tiered retention
- `lib/proxmox.js` — Proxmox API client (`/cluster/resources` + `/nodes/<name>/status`)
- `lib/node_exporter.js` — Prometheus text parser + HTTP fetch
- `lib/home_assistant.js` — Home Assistant WebSocket client + light/scene parsers (optional, enabled when `homeAssistant` block is in config)
- `lib/sse_broker.js` — generic Server-Sent Events fan-out used to push HA state to browser clients
- `public/index.html` — self-contained frontend (Dracula palette, JetBrains Mono, Rajdhani, uPlot modal)
- `public/lights.html` — lights & scenes UI (optional)
