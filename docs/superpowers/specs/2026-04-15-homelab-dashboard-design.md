---
title: Homelab Dashboard v1
date: 2026-04-15
status: approved
---

# Homelab Dashboard v1

## Purpose

Local-network web dashboard for three homelab machines + hosted services. Replaces eyeballing `htop` over SSH. Runs as systemd service (or inside an LXC) on `proxmox-internal`.

## Goals

- At-a-glance CPU/RAM/disk/network for proxmox-dmz, proxmox-internal, nas
- Per-guest stats for every LXC/VM on both Proxmox hosts (game servers visible automatically)
- Grouped quick-launch service cards with live up/down status
- `config.js` = single source of truth for IPs, ports, tokens, URLs
- Dark terminal aesthetic matching burkii.wtf (Dracula palette, scanlines, Rajdhani + JetBrains Mono)

## Non-goals (v1)

No DB, no history/graphs, no alerts, no auth, no HTTPS, no WebSockets, no per-VM deep metrics (IOPS, process list).

## Architecture

Express HTTP on port 3000. Background poller every `server.pollIntervalMs` (default 10 000 ms) scrapes all machines in parallel and caches results in memory. Frontend polls `/api/stats` every 5 s and patches DOM in place so CSS transitions animate.

Scraping by machine `type`:

- `proxmox` → HTTPS GET `https://<host>:<port>/api2/json/cluster/resources` with `Authorization: PVEAPIToken=<tokenId>=<tokenSecret>`. Self-signed cert → `rejectUnauthorized: false`. One call returns node + every LXC + every VM on that host.
- `node_exporter` → HTTP GET `http://<host>:<port>/metrics`. Parse Prometheus text exposition format, extract CPU / memory / filesystem / network / uptime families.

Service reachability runs in the same tick: GET with 2 s timeout. 2xx/3xx = up, everything else = down.

## Data flow

```
config.js → server.js boot → validate → new Poller(config).start()
                                          ↓ every 10 s
                                    Promise.allSettled([
                                      machines.map(scrape),
                                      services.map(ping),
                                    ])
                                          ↓
                                    update in-memory cache
                                    compute rx/tx + cpu rates from deltas

GET /api/stats → return cache as JSON
GET /api/ping  → return cache.services
GET /          → serve public/index.html
```

## Components

### server.js (~80 lines)

- `require('./config.js')` → validate required fields → fail fast on missing/malformed
- `new Poller(config).start()`
- Express routes: `/api/stats`, `/api/ping`, static `public/`
- `app.listen(config.server.port)`

### lib/poller.js (~120 lines)

`Poller` class owns the interval + cache.

- `start()` / `stop()` — for runtime and tests
- `tick()` — parallel scrape via `Promise.allSettled`; per-machine try/catch isolates failures
- Dispatch by `entry.type` → `lib/proxmox.fetch(entry)` or `lib/node_exporter.fetch(entry)`
- Rate calc: `(bytesNow - bytesPrev) / (tsNow - tsPrev)` for network, same pattern for node_exporter CPU% (needs two samples). First tick shows `—` for any rate-derived field.
- `getState()` → the JSON shape `/api/stats` returns

### lib/proxmox.js (~150 lines)

Single export: `async fetch(entry) → { host, guests }` or throws.

- URL: `https://${host}:${port}/api2/json/cluster/resources`
- Header: `Authorization: PVEAPIToken=${tokenId}=${tokenSecret}`
- Use the built-in `node:https` module with `rejectUnauthorized: entry.rejectUnauthorized ?? false` to handle Proxmox's self-signed certs. Wrap as a Promise returning parsed JSON body. (Chose `node:https` over adding `undici`/`node-fetch` to keep the runtime-dep count at exactly 1: express.)
- Walk `data[]`, split by `type`:
  - `type === "node"` with matching `node === entry.name` → host stats
  - `type === "lxc" | "qemu"` with matching `node` → push to `guests[]`
- Field normalization:
  - `cpu` float 0–1 → `cpuPct` 0–100
  - `mem`/`maxmem`, `disk`/`maxdisk` → `memUsed/memTotal`, `diskUsed/diskTotal` (bytes)
  - `netin`/`netout` → cumulative counters (poller computes rates)
  - pass through `status`, `uptime`, `vmid`, `name`
- Known quirk: QEMU VM `disk` often reports 0 unless `qemu-guest-agent` is installed in the guest. README documents this. UI shows `n/a` for 0/0 disk instead of an empty bar.
- Error → throw `new Error('proxmox <name>: <reason>')`

### lib/node_exporter.js (~180 lines)

Single export: `async fetch(entry) → { host }` or throws.

- Plain text parser: skip `# ...` comments, regex `/^([a-z_:][a-z0-9_:]*)(?:\{([^}]*)\})?\s+(.+)$/i`, parse labels as `key="value",...`
- Metrics consumed:
  - `node_cpu_seconds_total{mode}` → sum across cores, idle vs. total; cpuPct = `(1 - idleDelta/totalDelta) * 100` across two samples
  - `node_memory_MemTotal_bytes`, `node_memory_MemAvailable_bytes` → `memTotal`, `memUsed = total - available`
  - `node_filesystem_size_bytes`, `node_filesystem_avail_bytes` filtered `mountpoint="/"` AND `fstype` ∉ {`tmpfs`,`overlay`,`squashfs`,`devtmpfs`,`nsfs`,`ramfs`} → `diskTotal`, `diskUsed = size - avail`
  - `node_network_receive_bytes_total`, `node_network_transmit_bytes_total` summed across all interfaces except `lo` → cumulative (poller rates)
  - `node_boot_time_seconds` → `uptime = now - bootTime`
  - `node_load1`, `node_load5`, `node_load15` → `loadavg`
- Fixture-driven unit tests

### public/index.html (self-contained)

Inline `<style>` + `<script>`. No bundler, no framework. Loads Google Fonts for JetBrains Mono 400/700 + Rajdhani 500/700.

Structure:

```
<header>
  <h1>homelab.status</h1>
  <div class="status-chip">● up</div>
  <div class="last-poll">$ 14:32:09 · next in 3s</div>
  <button class="refresh">⟳</button>
</header>
<main>
  <section class="machines"> … 3 machine cards … </section>
  <section class="services"> … N service cards … </section>
</main>
```

- `setInterval(fetchStats, 5000)` + one immediate call on load
- Render fn diffs values into existing nodes (no `innerHTML` rewrites for the whole page)
- Machine card: `<details open>` guests section so it's collapsible but expanded by default

## Config schema (config.js)

```js
module.exports = {
  server: {
    port: 3000,
    pollIntervalMs: 10_000,
    serviceTimeoutMs: 2_000,
    proxmoxTimeoutMs: 5_000,
    nodeExporterTimeoutMs: 5_000,
  },

  machines: [
    {
      name: "proxmox-dmz",
      type: "proxmox",
      host: "REPLACE_ME",        // e.g. "10.0.20.10"
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME", // paste from PVE UI
      rejectUnauthorized: false,
    },
    {
      name: "proxmox-internal",
      type: "proxmox",
      host: "REPLACE_ME",
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME",
      rejectUnauthorized: false,
    },
    {
      name: "nas",
      type: "node_exporter",
      host: "REPLACE_ME",
      port: 9100,
    },
  ],

  services: [
    { name: "Proxmox DMZ",      machine: "proxmox-dmz",      url: "https://REPLACE_ME:8006",     icon: "pve.svg"      },
    { name: "Mealie",           machine: "proxmox-dmz",      url: "http://REPLACE_ME:9000",      icon: "mealie.svg"   },
    { name: "Proxmox Internal", machine: "proxmox-internal", url: "https://REPLACE_ME:8006",     icon: "pve.svg"      },
    { name: "Plex",             machine: "proxmox-internal", url: "http://REPLACE_ME:32400/web", icon: "plex.svg"     },
    { name: "netboot.xyz",      machine: "proxmox-internal", url: "http://REPLACE_ME:8080",      icon: "netboot.svg"  },
    { name: "Dashboard",        machine: "proxmox-internal", url: "http://REPLACE_ME:3000",      icon: "dashboard.svg"},
    { name: "TrueNAS",          machine: "nas",              url: "http://REPLACE_ME",           icon: "truenas.svg"  },
  ],
};
```

Validation at startup — fail fast if any of: `server.port` not int, `machines[].type` ∉ {`proxmox`,`node_exporter`}, `proxmox` without `tokenId`/`tokenSecret`, `node_exporter` without `port`, service `machine` not in `machines[].name`.

### Icon resolution

Frontend rule: if `icon` ends in `.svg` or contains `/` → render `<img src="icons/${icon}" onerror="fallbackToLabel(this)">`. Otherwise render as text label (3-char upper). Fallback on 404 → text label = first 3 chars of `name.toUpperCase()`. User drops SVG files into `public/icons/` to match filenames; no rebuild.

## API: GET /api/stats (example)

```json
{
  "lastPoll": "2026-04-15T14:32:09.482Z",
  "globalStatus": "up",
  "machines": {
    "proxmox-dmz": {
      "type": "proxmox",
      "status": "up",
      "lastUpdated": "2026-04-15T14:32:09.482Z",
      "error": null,
      "host": {
        "cpuPct": 14.3,
        "memUsed": 8589934592, "memTotal": 34359738368,
        "diskUsed": 214748364800, "diskTotal": 1099511627776,
        "netRx": 1048576, "netTx": 524288,
        "uptime": 864000,
        "loadavg": [0.10, 0.15, 0.18]
      },
      "guests": [
        {
          "vmid": 101, "name": "mc-server", "type": "lxc", "status": "running",
          "cpuPct": 22.5,
          "memUsed": 2147483648, "memTotal": 4294967296,
          "diskUsed": 10737418240, "diskTotal": 21474836480,
          "uptime": 432000
        }
      ]
    }
  },
  "services": [
    {
      "name": "Plex", "url": "http://10.0.10.5:32400/web",
      "machine": "proxmox-internal", "icon": "plex.svg",
      "status": "up", "responseTime": 34,
      "lastChecked": "2026-04-15T14:32:09.482Z"
    }
  ]
}
```

`globalStatus`: `up` if all machines + services up, `degraded` if any down, `down` if everything is down. If a machine has never succeeded, `host: null`, `guests: []`, `error` populated.

`GET /api/ping` returns just the `services` array.

## UI layout (ASCII sketch)

```
┌─────────────────────────────────────────────────────────────────┐
│ homelab.status              ● up   $ 14:32:09 · next 3s   [⟳]  │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                │
│ │PROXMOX-DMZ ●│ │PROX-INTRN  ●│ │NAS         ●│                │
│ │cpu  ▓▓▓░░░  │ │cpu  ▓░░░░░  │ │cpu  ▓▓░░░░  │                │
│ │mem  ▓▓▓▓░░  │ │mem  ▓▓▓░░░  │ │mem  ▓░░░░░  │                │
│ │disk ▓▓░░░░  │ │disk ▓▓▓▓▓░  │ │disk ▓▓▓▓░░  │                │
│ │↓12M/s ↑8M/s │ │↓3M/s ↑1M/s  │ │↓45M/s ↑30M  │                │
│ │up 10d 4h    │ │up 42d 19h   │ │up 118d 7h   │                │
│ │── guests ── │ │── guests ── │ └─────────────┘                │
│ │mc-server  ● │ │plex-lxc  ●  │                                │
│ │val-srv    ● │ │nginx-lxc ●  │                                │
│ │cs2-srv    ○ │ │pihole    ●  │                                │
│ └─────────────┘ └─────────────┘                                │
│                                                                 │
│ ── SERVICES ─────────────────────────────────────────────────   │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐               │
│ │PVE │ │MLE │ │PVE │ │PLX │ │NET │ │DSH │ │NAS │               │
│ │● up│ │● up│ │● up│ │● up│ │○ dn│ │● up│ │● up│               │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘               │
└─────────────────────────────────────────────────────────────────┘
```

Breakpoints: 1 column <720 px, 2 columns <1080 px, 3 columns ≥1080 px. Services grid: `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`.

## Styling tokens (from burkii.wtf)

CSS variables:

```css
--bg: #282a36;           /* page background */
--bg-alt: #1e1f29;       /* header/footer stripe */
--surface: #343746;      /* card background */
--current-line: #44475a; /* borders, dividers */
--fg: #f8f8f2;           /* primary text */
--comment: #6272a4;      /* secondary text, labels */
--green: #50fa7b;        /* online, $ prompt */
--yellow: #f1fa8c;       /* warning */
--orange: #ffb86c;       /* nearing limit */
--red: #ff5555;          /* offline, error */
--pink: #ff79c6;         /* section title accent */
--purple: #bd93f9;       /* primary accent, headings */
--cyan: #8be9fd;         /* network rates */
```

Fonts: JetBrains Mono 400/700, Rajdhani 500/700 (Google Fonts link identical to burkii.wtf).

Effects ported from burkii.wtf:

- Global scanline overlay: `body::after { background: repeating-linear-gradient(to bottom, transparent 0, transparent 3px, rgba(0,0,0,.04) 3px, rgba(0,0,0,.04) 4px); position: fixed; inset: 0; pointer-events: none; z-index: 9999; }`
- Card: `bg=var(--surface)`, `1px solid var(--current-line)`, `border-radius: 4px`, 3px purple accent bar on left via `::before`, bottom-right corner triangle via CSS border trick
- Machine-name `text-shadow: 0 0 24px rgba(189,147,249,.45)`
- Status dots: 7 px circle, `box-shadow: 0 0 6px <color>`, `pulse` keyframe opacity 1 → 0.45 → 1 at 2.5 s
- Stat bar: track `var(--current-line)`, fill transitions `width 400ms ease`
- Section titles: uppercase Rajdhani, pink `>` prefix marker
- Footer: terminal-style `$ last poll 14:32:09 — next in 3 s`, green `$`

Fill color thresholds:

- `<60 %` → `--purple`
- `60–80 %` → `--cyan`
- `80–95 %` → `--orange`
- `>95 %` → `--red`

## Error handling

Definition of "scrape failure" = any of: network unreachable, TCP/TLS error, socket timeout, HTTP non-2xx, JSON/Prometheus parse error, missing required fields.

| Situation | Behaviour |
|---|---|
| `config.js` missing / malformed | log, exit 1 |
| Scrape failure on a Proxmox host | that machine `status: "down"`, `error` populated with single-line reason, guests list becomes empty, other machines unaffected |
| Scrape failure on the nas node_exporter | machine `status: "down"`, `error` populated, other machines unaffected |
| Single guest missing one or more fields | include in guests list with `cpuPct: null` / `memUsed: null`, render with gray dot |
| Service ping timeout / non-2xx / network error | that service `status: "down"`, other services unaffected |
| Frontend `/api/stats` fetch fails | small "stats stale — retrying" banner, keep last-good data visible, stop advancing the "next poll" countdown until the fetch succeeds |
| First tick (no prior sample) | rate-derived fields — network rx/tx on all machines, and node_exporter cpuPct — render as `—`. Non-rate fields (mem, disk, uptime, proxmox cpuPct which arrives pre-computed) render normally on the first tick. |
| A machine has never succeeded since startup | card shows `host: null` → "OFFLINE" state, stats replaced by `---`, error string shown small in red |

## Testing approach

- `node:test` built-in runner, no jest/mocha dep
- `test/proxmox.test.js` — fixture-driven: feed captured `/cluster/resources` JSON, assert normalized `{host, guests[]}` shape and values
- `test/node_exporter.test.js` — fixture-driven: feed captured `/metrics` text, assert parsed output; specifically covers the filesystem fstype filter and network lo-interface exclusion
- `test/poller.test.js` — inject mock scrapers, assert (a) rate calculation between two samples, (b) one scraper throwing does not affect others, (c) `getState()` shape
- No e2e / UI tests — manual browser verification only

## Deliverables tree

```
homelab-monitoring/
├── config.js
├── server.js
├── lib/
│   ├── poller.js
│   ├── proxmox.js
│   └── node_exporter.js
├── public/
│   ├── index.html
│   └── icons/                   # user drops SVGs here
├── test/
│   ├── fixtures/
│   │   ├── proxmox-cluster-resources.json
│   │   └── node-exporter-metrics.txt
│   ├── proxmox.test.js
│   ├── node_exporter.test.js
│   └── poller.test.js
├── homelab-dashboard.service    # systemd unit template
├── package.json
└── README.md
```

## README outline

1. Prerequisites — Node 20+, Ubuntu 24
2. Install — clone, `npm install`
3. Proxmox API token — step-by-step: Datacenter → Permissions → Users (add `dashboard@pve`), → API Tokens → Add (user `dashboard@pve`, ID `readonly`, uncheck Privilege Separation), → Permissions (add `/`, user `dashboard@pve`, role `PVEAuditor`). Paste token secret into `config.js`.
4. node_exporter on TrueNAS — SCALE (systemd) and CORE (rc.d) one-liners
5. Edit `config.js` — replace every `REPLACE_ME`
6. Run — `node server.js`, open `http://<proxmox-internal-ip>:3000`
7. Run tests — `npm test`
8. systemd service — copy `homelab-dashboard.service`, edit `WorkingDirectory`/`User`, `systemctl daemon-reload && systemctl enable --now homelab-dashboard`
9. Icons — drop SVGs into `public/icons/` matching `config.js` `icon` filenames. Text label fallback if missing.
10. Known limitations — QEMU VM disk shows as `n/a` without `qemu-guest-agent`; first poll shows `—` for network and node_exporter CPU%.

## Dependencies

- `express` ^4 (runtime)
- Everything else: Node 20+ built-ins (`fetch`, `node:test`, `undici.Agent`, `http`, `https`, `fs`, `path`)
- Dev dependencies: none

## Resolved decisions

- Proxmox stats via Proxmox API `/cluster/resources`, not node_exporter (one call, all guests, proper auth)
- NAS stats via node_exporter on port 9100 (TrueNAS integrates cleanly)
- `lib/` split for testability and future extensibility
- SVG icons in `public/icons/` with text-label fallback
- Dracula palette + Rajdhani + JetBrains Mono + scanline overlay (burkii.wtf lineage)
- Port 3000, poll interval 10 s, frontend poll 5 s
- Single runtime dep: `express`
