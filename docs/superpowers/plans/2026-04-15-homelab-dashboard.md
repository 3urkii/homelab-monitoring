# Homelab Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page local-network dashboard that polls Proxmox hosts + a TrueNAS node_exporter every 10 seconds and displays live CPU/RAM/disk/network stats plus service up/down links, all configured through a single `config.js`.

**Architecture:** Express server with an in-memory polling cache. `lib/proxmox.js` talks to the Proxmox API (`/cluster/resources` + `/nodes/<name>/status`). `lib/node_exporter.js` parses the Prometheus text format from port 9100. `lib/poller.js` owns the interval timer, dispatches to scrapers, computes byte/sec and CPU rate deltas, and isolates failures per machine. `server.js` wires Express routes over the cache. `public/index.html` is a self-contained frontend that polls `/api/stats` every 5 s and patches the DOM.

**Tech Stack:** Node.js 20+, Express ^4 (only runtime dep), built-in `node:https` / `node:http` / `node:test`, vanilla HTML/CSS/JS frontend with Google Fonts (JetBrains Mono, Rajdhani), Dracula palette.

**Reference spec:** `docs/superpowers/specs/2026-04-15-homelab-dashboard-design.md`

---

## File Structure

```
homelab-monitoring/
├── config.js                                   # single source of truth (Task 2)
├── server.js                                   # express + routes + wiring (Task 17)
├── lib/
│   ├── poller.js                               # Tasks 12-16
│   ├── proxmox.js                              # Tasks 9-11
│   └── node_exporter.js                        # Tasks 3-8
├── public/
│   ├── index.html                              # Tasks 18-22
│   └── icons/.gitkeep                          # Task 2
├── test/
│   ├── fixtures/
│   │   ├── node-exporter-metrics.txt           # Task 3
│   │   ├── proxmox-cluster-resources.json      # Task 9
│   │   └── proxmox-node-status.json            # Task 9
│   ├── node_exporter.test.js                   # Tasks 3-8
│   ├── proxmox.test.js                         # Tasks 9-11
│   └── poller.test.js                          # Tasks 12-16
├── homelab-dashboard.service                   # Task 23
├── package.json                                # Task 1
├── .gitignore                                  # Task 1
└── README.md                                   # Task 24
```

**Responsibility split:**
- `lib/node_exporter.js` — pure `parseMetrics(text)` function + `fetchMetrics(entry)` HTTP wrapper. Scraper returns raw cumulative counters; poller computes rates.
- `lib/proxmox.js` — pure `parseClusterResources(data, nodeName)` + `parseNodeStatus(data)` + `fetchResources(entry)` / `fetchNodeStatus(entry)` HTTP wrappers via `node:https` with `rejectUnauthorized:false`. Two parallel calls per tick merged into `{ host, guests }`.
- `lib/poller.js` — `Poller` class with injected scrapers for tests. Owns interval + in-memory cache + previous-sample map for rate computation. One failing scraper cannot affect others.
- `server.js` — thin: load config, validate, start poller, register routes, listen.
- `public/index.html` — single file, inline `<style>` + `<script>`, diff-render into existing nodes so CSS transitions animate smoothly.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "homelab-dashboard",
  "version": "1.0.0",
  "description": "Local-network homelab monitoring dashboard",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
config.local.js
```

- [ ] **Step 3: Install express**

Run: `npm install`
Expected: `added 60 packages` (exact count varies), creates `node_modules/` and `package-lock.json`.

- [ ] **Step 4: Verify Node version**

Run: `node --version`
Expected: `v20.x.x` or higher. If lower, stop and install Node 20+.

- [ ] **Step 5: Initialize git**

Run: `git init && git branch -m main`
Expected: `Initialized empty Git repository …`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: scaffold project with express dependency"
```

---

## Task 2: Config template + frontend scaffolding dirs

**Files:**
- Create: `config.js`
- Create: `public/icons/.gitkeep`

- [ ] **Step 1: Create `config.js`**

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

- [ ] **Step 2: Create `public/icons/.gitkeep` (empty file)**

Run: `mkdir -p public/icons && touch public/icons/.gitkeep`

- [ ] **Step 3: Commit**

```bash
git add config.js public/icons/.gitkeep
git commit -m "feat: add config.js template and public/icons/ scaffold"
```

---

## Task 3: `parseMetrics` — memory fields

**Files:**
- Create: `test/fixtures/node-exporter-metrics.txt`
- Create: `test/node_exporter.test.js`
- Create: `lib/node_exporter.js`

- [ ] **Step 1: Create the fixture `test/fixtures/node-exporter-metrics.txt`**

```
# HELP node_memory_MemTotal_bytes Memory information field MemTotal_bytes.
# TYPE node_memory_MemTotal_bytes gauge
node_memory_MemTotal_bytes 1.6777216e+10
# HELP node_memory_MemAvailable_bytes Memory information field MemAvailable_bytes.
# TYPE node_memory_MemAvailable_bytes gauge
node_memory_MemAvailable_bytes 8.388608e+09
# HELP node_filesystem_size_bytes Filesystem size in bytes.
# TYPE node_filesystem_size_bytes gauge
node_filesystem_size_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 1.073741824e+11
node_filesystem_size_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run"} 8.38e+08
# HELP node_filesystem_avail_bytes Filesystem space available to non-root users in bytes.
# TYPE node_filesystem_avail_bytes gauge
node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 5.36870912e+10
node_filesystem_avail_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run"} 8.38e+08
# HELP node_network_receive_bytes_total Network device statistic receive_bytes.
# TYPE node_network_receive_bytes_total counter
node_network_receive_bytes_total{device="eth0"} 1.234567e+09
node_network_receive_bytes_total{device="lo"} 1.23e+07
# HELP node_network_transmit_bytes_total Network device statistic transmit_bytes.
# TYPE node_network_transmit_bytes_total counter
node_network_transmit_bytes_total{device="eth0"} 5.678e+08
node_network_transmit_bytes_total{device="lo"} 1.23e+07
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 12345.67
node_cpu_seconds_total{cpu="0",mode="iowait"} 10.5
node_cpu_seconds_total{cpu="0",mode="system"} 200.3
node_cpu_seconds_total{cpu="0",mode="user"} 500.8
node_cpu_seconds_total{cpu="1",mode="idle"} 12400.12
node_cpu_seconds_total{cpu="1",mode="iowait"} 8.1
node_cpu_seconds_total{cpu="1",mode="system"} 195.7
node_cpu_seconds_total{cpu="1",mode="user"} 495.4
# HELP node_boot_time_seconds Node boot time, in unixtime.
# TYPE node_boot_time_seconds gauge
node_boot_time_seconds 1.7002e+09
# HELP node_load1 1m load average.
# TYPE node_load1 gauge
node_load1 0.15
# HELP node_load5 5m load average.
# TYPE node_load5 gauge
node_load5 0.22
# HELP node_load15 15m load average.
# TYPE node_load15 gauge
node_load15 0.18
```

- [ ] **Step 2: Create `test/node_exporter.test.js` with first failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseMetrics } = require('../lib/node_exporter.js');

const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures/node-exporter-metrics.txt'),
  'utf8',
);

test('parseMetrics: memory fields', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.memTotal, 16_777_216_000);
  assert.equal(result.memAvailable, 8_388_608_000);
});
```

- [ ] **Step 3: Run tests to verify fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/node_exporter.js'`

- [ ] **Step 4: Create `lib/node_exporter.js` with minimal parseMetrics**

```js
function parseMetrics(text) {
  const lines = text.split('\n');
  const out = {
    memTotal: 0,
    memAvailable: 0,
  };
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, value } = parsed;
    if (name === 'node_memory_MemTotal_bytes') out.memTotal = value;
    else if (name === 'node_memory_MemAvailable_bytes') out.memAvailable = value;
  }
  return out;
}

function parseLine(line) {
  const match = line.match(/^([a-z_:][a-z0-9_:]*)(?:\{([^}]*)\})?\s+(.+)$/i);
  if (!match) return null;
  const [, name, labelsStr, valueStr] = match;
  const value = Number(valueStr);
  if (Number.isNaN(value)) return null;
  const labels = {};
  if (labelsStr) {
    for (const pair of labelsStr.matchAll(/([a-z_][a-z0-9_]*)="([^"]*)"/gi)) {
      labels[pair[1]] = pair[2];
    }
  }
  return { name, labels, value };
}

module.exports = { parseMetrics, parseLine };
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test`
Expected: `# pass 1`

- [ ] **Step 6: Commit**

```bash
git add lib/node_exporter.js test/fixtures/node-exporter-metrics.txt test/node_exporter.test.js
git commit -m "feat(node_exporter): parse memory fields from /metrics"
```

---

## Task 4: `parseMetrics` — filesystem fields with fstype filter

**Files:**
- Modify: `test/node_exporter.test.js`
- Modify: `lib/node_exporter.js`

- [ ] **Step 1: Append filesystem test to `test/node_exporter.test.js`**

```js
test('parseMetrics: filesystem fields (/ only, tmpfs excluded)', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.diskTotal, 107_374_182_400);
  assert.equal(result.diskAvailable, 53_687_091_200);
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test`
Expected: FAIL — `diskTotal undefined` or equivalent.

- [ ] **Step 3: Add filesystem handling to `lib/node_exporter.js`**

Replace the `parseMetrics` function with:

```js
const EXCLUDED_FSTYPES = new Set([
  'tmpfs', 'overlay', 'squashfs', 'devtmpfs', 'nsfs', 'ramfs', 'autofs', 'proc', 'sysfs',
]);

function parseMetrics(text) {
  const lines = text.split('\n');
  const out = {
    memTotal: 0,
    memAvailable: 0,
    diskTotal: 0,
    diskAvailable: 0,
  };
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, labels, value } = parsed;
    if (name === 'node_memory_MemTotal_bytes') out.memTotal = value;
    else if (name === 'node_memory_MemAvailable_bytes') out.memAvailable = value;
    else if (name === 'node_filesystem_size_bytes' && labels.mountpoint === '/' && !EXCLUDED_FSTYPES.has(labels.fstype)) {
      out.diskTotal = value;
    } else if (name === 'node_filesystem_avail_bytes' && labels.mountpoint === '/' && !EXCLUDED_FSTYPES.has(labels.fstype)) {
      out.diskAvailable = value;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: `# pass 2`

- [ ] **Step 5: Commit**

```bash
git add lib/node_exporter.js test/node_exporter.test.js
git commit -m "feat(node_exporter): parse root filesystem size excluding tmpfs/overlay"
```

---

## Task 5: `parseMetrics` — network counters (sum, exclude lo)

**Files:**
- Modify: `test/node_exporter.test.js`
- Modify: `lib/node_exporter.js`

- [ ] **Step 1: Append network test**

```js
test('parseMetrics: network byte counters exclude loopback', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.netRxBytes, 1_234_567_000);
  assert.equal(result.netTxBytes, 567_800_000);
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `netRxBytes undefined`.

- [ ] **Step 3: Add network fields to `parseMetrics`**

Add to `out` initializer:
```js
netRxBytes: 0,
netTxBytes: 0,
```

Add to the switch block inside the loop:
```js
else if (name === 'node_network_receive_bytes_total' && labels.device !== 'lo') {
  out.netRxBytes += value;
} else if (name === 'node_network_transmit_bytes_total' && labels.device !== 'lo') {
  out.netTxBytes += value;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 3`

- [ ] **Step 5: Commit**

```bash
git add lib/node_exporter.js test/node_exporter.test.js
git commit -m "feat(node_exporter): sum network rx/tx counters across non-loopback devices"
```

---

## Task 6: `parseMetrics` — CPU seconds (idle + total)

**Files:**
- Modify: `test/node_exporter.test.js`
- Modify: `lib/node_exporter.js`

- [ ] **Step 1: Append CPU test**

```js
test('parseMetrics: cpu seconds (idle + total across all cores and modes)', () => {
  const result = parseMetrics(fixture);
  // idle = 12345.67 + 12400.12
  assert.equal(result.cpuIdleSeconds.toFixed(2), '24745.79');
  // total = idle + iowait + system + user = 24745.79 + 18.6 + 396.0 + 996.2 = 26156.59
  assert.equal(result.cpuTotalSeconds.toFixed(2), '26156.59');
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `cpuIdleSeconds undefined`.

- [ ] **Step 3: Add CPU handling**

Add to `out` initializer:
```js
cpuIdleSeconds: 0,
cpuTotalSeconds: 0,
```

Add to loop:
```js
else if (name === 'node_cpu_seconds_total') {
  out.cpuTotalSeconds += value;
  if (labels.mode === 'idle') out.cpuIdleSeconds += value;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 4`

- [ ] **Step 5: Commit**

```bash
git add lib/node_exporter.js test/node_exporter.test.js
git commit -m "feat(node_exporter): sum cpu idle and total seconds across cores"
```

---

## Task 7: `parseMetrics` — boot time + load average

**Files:**
- Modify: `test/node_exporter.test.js`
- Modify: `lib/node_exporter.js`

- [ ] **Step 1: Append boot time + loadavg test**

```js
test('parseMetrics: boot time and load averages', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.bootTimeSeconds, 1_700_200_000);
  assert.deepEqual(result.loadavg, [0.15, 0.22, 0.18]);
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `bootTimeSeconds undefined`.

- [ ] **Step 3: Add fields**

Add to initializer:
```js
bootTimeSeconds: 0,
loadavg: [0, 0, 0],
```

Add to loop:
```js
else if (name === 'node_boot_time_seconds') out.bootTimeSeconds = value;
else if (name === 'node_load1')  out.loadavg[0] = value;
else if (name === 'node_load5')  out.loadavg[1] = value;
else if (name === 'node_load15') out.loadavg[2] = value;
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 5`

- [ ] **Step 5: Commit**

```bash
git add lib/node_exporter.js test/node_exporter.test.js
git commit -m "feat(node_exporter): parse boot time and load averages"
```

---

## Task 8: `fetch` wrapper — HTTP GET + parse (integration-lite test)

**Files:**
- Modify: `test/node_exporter.test.js`
- Modify: `lib/node_exporter.js`

- [ ] **Step 1: Append fetch test with a local `node:http` server**

```js
const http = require('node:http');
const { fetch: fetchMetrics } = require('../lib/node_exporter.js');

test('fetch: retrieves and parses metrics over local HTTP', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(fixture);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const result = await fetchMetrics({ name: 'test', host: '127.0.0.1', port, nodeExporterTimeoutMs: 2000 });
    assert.equal(result.memTotal, 16_777_216_000);
    assert.equal(result.netRxBytes, 1_234_567_000);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('fetch: throws on non-2xx', async () => {
  const server = http.createServer((req, res) => res.writeHead(500).end('err'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => fetchMetrics({ name: 'bad', host: '127.0.0.1', port, nodeExporterTimeoutMs: 2000 }),
      /HTTP 500/,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `fetchMetrics is not a function`.

- [ ] **Step 3: Implement `fetch` in `lib/node_exporter.js`**

Append to the file (keep existing `parseMetrics` / `parseLine`):

```js
async function fetch(entry) {
  const url = `http://${entry.host}:${entry.port}/metrics`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), entry.nodeExporterTimeoutMs ?? 5000);
  try {
    const res = await globalThis.fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`node_exporter ${entry.name}: HTTP ${res.status}`);
    }
    const text = await res.text();
    return parseMetrics(text);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`node_exporter ${entry.name}: timeout after ${entry.nodeExporterTimeoutMs ?? 5000}ms`);
    }
    if (err.message.startsWith('node_exporter ')) throw err;
    throw new Error(`node_exporter ${entry.name}: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { parseMetrics, parseLine, fetch };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 7`

- [ ] **Step 5: Commit**

```bash
git add lib/node_exporter.js test/node_exporter.test.js
git commit -m "feat(node_exporter): add HTTP fetch wrapper with timeout and error wrapping"
```

---

## Task 9: Proxmox `parseClusterResources` — host/node row

**Files:**
- Create: `test/fixtures/proxmox-cluster-resources.json`
- Create: `test/fixtures/proxmox-node-status.json`
- Create: `test/proxmox.test.js`
- Create: `lib/proxmox.js`

- [ ] **Step 1: Create `test/fixtures/proxmox-cluster-resources.json`**

```json
{
  "data": [
    {
      "type": "node",
      "node": "proxmox-dmz",
      "status": "online",
      "cpu": 0.143,
      "mem": 8589934592,
      "maxmem": 34359738368,
      "disk": 214748364800,
      "maxdisk": 1099511627776,
      "netin": 1048576000,
      "netout": 524288000,
      "uptime": 864000
    },
    {
      "type": "lxc",
      "node": "proxmox-dmz",
      "vmid": 101,
      "name": "mc-server",
      "status": "running",
      "cpu": 0.225,
      "mem": 2147483648,
      "maxmem": 4294967296,
      "disk": 10737418240,
      "maxdisk": 21474836480,
      "uptime": 432000
    },
    {
      "type": "qemu",
      "node": "proxmox-dmz",
      "vmid": 201,
      "name": "win-vm",
      "status": "stopped",
      "cpu": 0,
      "mem": 0,
      "maxmem": 8589934592,
      "disk": 0,
      "maxdisk": 0,
      "uptime": 0
    },
    {
      "type": "node",
      "node": "proxmox-internal",
      "status": "online"
    },
    {
      "type": "storage",
      "node": "proxmox-dmz",
      "storage": "local-zfs"
    }
  ]
}
```

- [ ] **Step 2: Create `test/fixtures/proxmox-node-status.json`**

```json
{
  "data": {
    "loadavg": ["0.10", "0.15", "0.18"],
    "uptime": 864000,
    "cpu": 0.143,
    "memory": {
      "total": 34359738368,
      "used": 8589934592,
      "free": 25769803776
    },
    "rootfs": {
      "total": 1099511627776,
      "used": 214748364800,
      "avail": 884763262976,
      "free": 884763262976
    }
  }
}
```

- [ ] **Step 3: Create `test/proxmox.test.js` with first failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseClusterResources } = require('../lib/proxmox.js');

const clusterFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/proxmox-cluster-resources.json'), 'utf8'));

test('parseClusterResources: extracts host stats for matching node', () => {
  const { host } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  assert.equal(host.cpuPct.toFixed(1), '14.3');
  assert.equal(host.memUsed, 8589934592);
  assert.equal(host.memTotal, 34359738368);
  assert.equal(host.diskUsed, 214748364800);
  assert.equal(host.diskTotal, 1099511627776);
  assert.equal(host.uptime, 864000);
  assert.equal(host._cumulative.netRxBytes, 1048576000);
  assert.equal(host._cumulative.netTxBytes, 524288000);
});

test('parseClusterResources: throws when node not found', () => {
  assert.throws(
    () => parseClusterResources(clusterFixture.data, 'nonexistent'),
    /node not found/,
  );
});
```

- [ ] **Step 4: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/proxmox.js'`.

- [ ] **Step 5: Create `lib/proxmox.js` with minimal `parseClusterResources`**

```js
function parseClusterResources(data, nodeName) {
  let host = null;
  const guests = [];
  for (const item of data) {
    if (item.type === 'node' && item.node === nodeName) {
      host = {
        cpuPct: (item.cpu ?? 0) * 100,
        memUsed: item.mem ?? 0,
        memTotal: item.maxmem ?? 0,
        diskUsed: item.disk ?? 0,
        diskTotal: item.maxdisk ?? 0,
        uptime: item.uptime ?? 0,
        loadavg: null,
        _cumulative: {
          netRxBytes: item.netin ?? 0,
          netTxBytes: item.netout ?? 0,
        },
      };
    }
  }
  if (!host) {
    throw new Error(`proxmox ${nodeName}: node not found in cluster/resources (check the config "name" field matches the PVE node hostname)`);
  }
  return { host, guests };
}

module.exports = { parseClusterResources };
```

- [ ] **Step 6: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 9`

- [ ] **Step 7: Commit**

```bash
git add lib/proxmox.js test/fixtures/proxmox-cluster-resources.json test/fixtures/proxmox-node-status.json test/proxmox.test.js
git commit -m "feat(proxmox): parse host fields from /cluster/resources"
```

---

## Task 10: Proxmox `parseClusterResources` — guest rows (LXC + QEMU)

**Files:**
- Modify: `test/proxmox.test.js`
- Modify: `lib/proxmox.js`

- [ ] **Step 1: Append guest test**

```js
test('parseClusterResources: collects LXC and QEMU guests for the target node', () => {
  const { guests } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  assert.equal(guests.length, 2);

  const lxc = guests.find((g) => g.vmid === 101);
  assert.equal(lxc.type, 'lxc');
  assert.equal(lxc.name, 'mc-server');
  assert.equal(lxc.status, 'running');
  assert.equal(lxc.cpuPct.toFixed(1), '22.5');
  assert.equal(lxc.memUsed, 2147483648);
  assert.equal(lxc.memTotal, 4294967296);
  assert.equal(lxc.diskUsed, 10737418240);
  assert.equal(lxc.diskTotal, 21474836480);

  const qemu = guests.find((g) => g.vmid === 201);
  assert.equal(qemu.type, 'qemu');
  assert.equal(qemu.name, 'win-vm');
  assert.equal(qemu.status, 'stopped');
  assert.equal(qemu.diskTotal, 0); // VM without qemu-guest-agent
});

test('parseClusterResources: filters out other nodes and storage entries', () => {
  const { guests } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  // 2 guests only; "proxmox-internal" node and "local-zfs" storage excluded
  assert.equal(guests.length, 2);
  assert.ok(guests.every((g) => g.vmid !== undefined));
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `guests.length is 0`.

- [ ] **Step 3: Extend `parseClusterResources`**

Replace the function body's loop (keep the outer structure) with:

```js
for (const item of data) {
  if (item.type === 'node' && item.node === nodeName) {
    host = {
      cpuPct: (item.cpu ?? 0) * 100,
      memUsed: item.mem ?? 0,
      memTotal: item.maxmem ?? 0,
      diskUsed: item.disk ?? 0,
      diskTotal: item.maxdisk ?? 0,
      uptime: item.uptime ?? 0,
      loadavg: null,
      _cumulative: {
        netRxBytes: item.netin ?? 0,
        netTxBytes: item.netout ?? 0,
      },
    };
  } else if ((item.type === 'lxc' || item.type === 'qemu') && item.node === nodeName) {
    guests.push({
      vmid: item.vmid,
      name: item.name ?? `vm-${item.vmid}`,
      type: item.type,
      status: item.status ?? 'unknown',
      cpuPct: (item.cpu ?? 0) * 100,
      memUsed: item.mem ?? 0,
      memTotal: item.maxmem ?? 0,
      diskUsed: item.disk ?? 0,
      diskTotal: item.maxdisk ?? 0,
      uptime: item.uptime ?? 0,
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 11`

- [ ] **Step 5: Commit**

```bash
git add lib/proxmox.js test/proxmox.test.js
git commit -m "feat(proxmox): collect LXC and QEMU guests in parseClusterResources"
```

---

## Task 11: Proxmox `fetch` — two parallel HTTP calls merged

**Files:**
- Modify: `test/proxmox.test.js`
- Modify: `lib/proxmox.js`

- [ ] **Step 1: Append `parseNodeStatus` test**

```js
const { parseNodeStatus } = require('../lib/proxmox.js');

const statusFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/proxmox-node-status.json'), 'utf8'));

test('parseNodeStatus: extracts loadavg as numbers', () => {
  const result = parseNodeStatus(statusFixture.data);
  assert.deepEqual(result.loadavg, [0.10, 0.15, 0.18]);
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `parseNodeStatus is not a function`.

- [ ] **Step 3: Add `parseNodeStatus` to `lib/proxmox.js`**

Append before `module.exports`:

```js
function parseNodeStatus(data) {
  return {
    loadavg: (data.loadavg ?? []).map(Number),
  };
}
```

Update exports:
```js
module.exports = { parseClusterResources, parseNodeStatus, fetch };
```

- [ ] **Step 4: Implement `fetch` using `node:https`**

Add to `lib/proxmox.js` (above `module.exports`):

```js
const https = require('node:https');

function httpsRequest(options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`parse failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}

async function fetch(entry) {
  const commonOptions = {
    host: entry.host,
    port: entry.port ?? 8006,
    method: 'GET',
    headers: {
      Authorization: `PVEAPIToken=${entry.tokenId}=${entry.tokenSecret}`,
    },
    rejectUnauthorized: entry.rejectUnauthorized ?? false,
  };
  const timeoutMs = entry.proxmoxTimeoutMs ?? 5000;
  try {
    const [clusterRes, statusRes] = await Promise.all([
      httpsRequest({ ...commonOptions, path: '/api2/json/cluster/resources' }, timeoutMs),
      httpsRequest({ ...commonOptions, path: `/api2/json/nodes/${encodeURIComponent(entry.name)}/status` }, timeoutMs),
    ]);
    const { host, guests } = parseClusterResources(clusterRes.data, entry.name);
    const { loadavg } = parseNodeStatus(statusRes.data);
    host.loadavg = loadavg;
    return { host, guests };
  } catch (err) {
    if (err.message.startsWith('proxmox ')) throw err;
    throw new Error(`proxmox ${entry.name}: ${err.message}`);
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 12`

- [ ] **Step 6: Manual verification note**

The `fetch` function is not unit-tested (would require setting up a local HTTPS server with a self-signed cert, which is high effort for low reward since the pure parsers are already tested). It will be exercised end-to-end once `server.js` and real PVE credentials exist. If `fetch` misbehaves after Task 17, debug by logging the `httpsRequest` responses directly.

- [ ] **Step 7: Commit**

```bash
git add lib/proxmox.js test/proxmox.test.js
git commit -m "feat(proxmox): add parseNodeStatus and two-call fetch merging loadavg"
```

---

## Task 12: `Poller` class — constructor + `getState()`

**Files:**
- Create: `test/poller.test.js`
- Create: `lib/poller.js`

- [ ] **Step 1: Create `test/poller.test.js` with the first test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Poller } = require('../lib/poller.js');

const baseConfig = {
  server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
  machines: [
    { name: 'nas', type: 'node_exporter', host: '127.0.0.1', port: 9100 },
  ],
  services: [],
};

test('Poller: getState returns skeleton before first tick', () => {
  const poller = new Poller(baseConfig, { scrapers: {}, servicePing: async () => {} });
  const state = poller.getState();
  assert.equal(state.lastPoll, null);
  assert.equal(state.globalStatus, 'down');
  assert.equal(state.machines.nas.status, 'down');
  assert.equal(state.machines.nas.host, null);
  assert.deepEqual(state.services, []);
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/poller.js'`.

- [ ] **Step 3: Create `lib/poller.js` with constructor + `getState`**

```js
class Poller {
  #config;
  #scrapers;
  #servicePing;
  #state;
  #previousSamples = new Map();
  #timer = null;

  constructor(config, { scrapers, servicePing }) {
    this.#config = config;
    this.#scrapers = scrapers;
    this.#servicePing = servicePing;
    this.#state = {
      lastPoll: null,
      globalStatus: 'down',
      machines: Object.fromEntries(
        config.machines.map((m) => [
          m.name,
          { type: m.type, status: 'down', lastUpdated: null, error: null, host: null, guests: [] },
        ]),
      ),
      services: config.services.map((s) => ({
        name: s.name, url: s.url, machine: s.machine, icon: s.icon,
        status: 'down', responseTime: null, lastChecked: null,
      })),
    };
  }

  getState() {
    return this.#state;
  }
}

module.exports = { Poller };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 13`

- [ ] **Step 5: Commit**

```bash
git add lib/poller.js test/poller.test.js
git commit -m "feat(poller): Poller class with getState skeleton"
```

---

## Task 13: `Poller.tick()` — dispatch to injected scrapers

**Files:**
- Modify: `test/poller.test.js`
- Modify: `lib/poller.js`

- [ ] **Step 1: Append tick dispatch test**

```js
test('Poller.tick: dispatches by type and populates state', async () => {
  const mockNodeExporterResult = {
    memTotal: 1000, memAvailable: 400,
    diskTotal: 2000, diskAvailable: 800,
    netRxBytes: 100, netTxBytes: 50,
    cpuIdleSeconds: 90, cpuTotalSeconds: 100,
    bootTimeSeconds: Math.floor(Date.now() / 1000) - 3600,
    loadavg: [0.1, 0.2, 0.3],
  };
  const poller = new Poller(baseConfig, {
    scrapers: {
      node_exporter: async () => mockNodeExporterResult,
    },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  const state = poller.getState();
  assert.ok(state.lastPoll);
  assert.equal(state.machines.nas.status, 'up');
  assert.equal(state.machines.nas.host.memUsed, 600);
  assert.equal(state.machines.nas.host.memTotal, 1000);
  assert.equal(state.machines.nas.host.diskUsed, 1200);
  assert.equal(state.machines.nas.host.diskTotal, 2000);
  // First tick → rate-derived fields are null (no previous sample yet)
  assert.equal(state.machines.nas.host.netRx, null);
  assert.equal(state.machines.nas.host.netTx, null);
  assert.equal(state.machines.nas.host.cpuPct, null);
  // Uptime is fine on first tick (derived from bootTime, not from delta)
  assert.ok(state.machines.nas.host.uptime >= 3600);
  assert.deepEqual(state.machines.nas.host.loadavg, [0.1, 0.2, 0.3]);
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — `poller.tick is not a function`.

- [ ] **Step 3: Implement `tick()` for node_exporter case**

Add to `Poller` class:

```js
async tick() {
  const now = Date.now();
  const machineTasks = this.#config.machines.map((entry) => this.#scrapeMachine(entry, now));
  const serviceTasks = this.#config.services.map((svc) => this.#pingService(svc));
  await Promise.allSettled([...machineTasks, ...serviceTasks]);
  this.#state.lastPoll = new Date(now).toISOString();
  this.#updateGlobalStatus();
}

async #scrapeMachine(entry, now) {
  const scraper = this.#scrapers[entry.type];
  if (!scraper) {
    this.#markDown(entry.name, `unknown machine type: ${entry.type}`);
    return;
  }
  try {
    const raw = await scraper(entry);
    this.#applyScrapeResult(entry, raw, now);
  } catch (err) {
    this.#markDown(entry.name, err.message);
  }
}

#applyScrapeResult(entry, raw, now) {
  const prev = this.#previousSamples.get(entry.name);
  let host;
  let guests = [];
  if (entry.type === 'node_exporter') {
    const rates = prev
      ? this.#computeRates(prev, raw, now)
      : { netRx: null, netTx: null, cpuPct: null };
    const nowSec = Math.floor(now / 1000);
    host = {
      cpuPct: rates.cpuPct,
      memUsed: raw.memTotal - raw.memAvailable,
      memTotal: raw.memTotal,
      diskUsed: raw.diskTotal - raw.diskAvailable,
      diskTotal: raw.diskTotal,
      netRx: rates.netRx,
      netTx: rates.netTx,
      uptime: nowSec - raw.bootTimeSeconds,
      loadavg: raw.loadavg,
    };
    this.#previousSamples.set(entry.name, { ts: now, ...raw });
  } else if (entry.type === 'proxmox') {
    // Populated in a later step
    host = raw.host;
    guests = raw.guests;
  }
  this.#state.machines[entry.name] = {
    type: entry.type,
    status: 'up',
    lastUpdated: new Date(now).toISOString(),
    error: null,
    host,
    guests,
  };
}

#computeRates(prev, raw, now) {
  const elapsed = (now - prev.ts) / 1000;
  if (elapsed <= 0) return { netRx: null, netTx: null, cpuPct: null };
  const netRx = Math.max(0, (raw.netRxBytes - prev.netRxBytes) / elapsed);
  const netTx = Math.max(0, (raw.netTxBytes - prev.netTxBytes) / elapsed);
  const idleDelta = raw.cpuIdleSeconds - prev.cpuIdleSeconds;
  const totalDelta = raw.cpuTotalSeconds - prev.cpuTotalSeconds;
  const cpuPct = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null;
  return { netRx, netTx, cpuPct };
}

#markDown(name, errorMessage) {
  this.#state.machines[name] = {
    ...this.#state.machines[name],
    status: 'down',
    lastUpdated: new Date().toISOString(),
    error: errorMessage,
    host: null,
    guests: [],
  };
}

async #pingService(svc) {
  try {
    const result = await this.#servicePing(svc);
    const target = this.#state.services.find((s) => s.name === svc.name && s.url === svc.url);
    if (target) {
      target.status = result.status;
      target.responseTime = result.responseTime ?? null;
      target.lastChecked = new Date().toISOString();
    }
  } catch {
    const target = this.#state.services.find((s) => s.name === svc.name && s.url === svc.url);
    if (target) {
      target.status = 'down';
      target.responseTime = null;
      target.lastChecked = new Date().toISOString();
    }
  }
}

#updateGlobalStatus() {
  const machineStatuses = Object.values(this.#state.machines).map((m) => m.status);
  const serviceStatuses = this.#state.services.map((s) => s.status);
  const all = [...machineStatuses, ...serviceStatuses];
  if (all.length === 0) { this.#state.globalStatus = 'down'; return; }
  if (all.every((s) => s === 'up')) this.#state.globalStatus = 'up';
  else if (all.every((s) => s === 'down')) this.#state.globalStatus = 'down';
  else this.#state.globalStatus = 'degraded';
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 14`

- [ ] **Step 5: Commit**

```bash
git add lib/poller.js test/poller.test.js
git commit -m "feat(poller): tick dispatches to scrapers, applies node_exporter results"
```

---

## Task 14: `Poller.tick()` — network rate calculation between ticks

**Files:**
- Modify: `test/poller.test.js`

- [ ] **Step 1: Append rate calculation test**

```js
test('Poller.tick: computes network rates between consecutive ticks', async () => {
  let callCount = 0;
  const bootTime = Math.floor(Date.now() / 1000) - 3600;
  const samples = [
    { memTotal: 1000, memAvailable: 400, diskTotal: 2000, diskAvailable: 800,
      netRxBytes: 1000, netTxBytes: 500,
      cpuIdleSeconds: 900, cpuTotalSeconds: 1000,
      bootTimeSeconds: bootTime, loadavg: [0,0,0] },
    { memTotal: 1000, memAvailable: 400, diskTotal: 2000, diskAvailable: 800,
      netRxBytes: 11000, netTxBytes: 5500,
      cpuIdleSeconds: 905, cpuTotalSeconds: 1010,
      bootTimeSeconds: bootTime, loadavg: [0,0,0] },
  ];
  const poller = new Poller(baseConfig, {
    scrapers: { node_exporter: async () => samples[callCount++] },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  // Sleep 100ms so timestamps differ
  await new Promise((r) => setTimeout(r, 100));
  await poller.tick();
  const host = poller.getState().machines.nas.host;
  assert.ok(host.netRx > 0, `expected netRx > 0, got ${host.netRx}`);
  assert.ok(host.netTx > 0, `expected netTx > 0, got ${host.netTx}`);
  // CPU: idle delta 5, total delta 10 → cpuPct = (1 - 5/10)*100 = 50
  assert.equal(host.cpuPct.toFixed(0), '50');
});
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 15` (the rate calculation was already implemented in Task 13; this test locks it in).

- [ ] **Step 3: Commit**

```bash
git add test/poller.test.js
git commit -m "test(poller): verify rate calculation between ticks"
```

---

## Task 15: `Poller.tick()` — error isolation across machines

**Files:**
- Modify: `test/poller.test.js`

- [ ] **Step 1: Append error isolation test**

```js
test('Poller.tick: one scraper failing does not affect others', async () => {
  const config = {
    server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
    machines: [
      { name: 'nas',  type: 'node_exporter', host: '1', port: 9100 },
      { name: 'bad',  type: 'node_exporter', host: '2', port: 9100 },
    ],
    services: [],
  };
  const good = {
    memTotal: 1000, memAvailable: 400, diskTotal: 2000, diskAvailable: 800,
    netRxBytes: 0, netTxBytes: 0, cpuIdleSeconds: 0, cpuTotalSeconds: 0,
    bootTimeSeconds: Math.floor(Date.now()/1000) - 1, loadavg: [0,0,0],
  };
  const poller = new Poller(config, {
    scrapers: {
      node_exporter: async (entry) => {
        if (entry.name === 'bad') throw new Error('boom');
        return good;
      },
    },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  const state = poller.getState();
  assert.equal(state.machines.nas.status, 'up');
  assert.equal(state.machines.bad.status, 'down');
  assert.match(state.machines.bad.error, /boom/);
});
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 16` (implementation already handles this via Promise.allSettled and per-machine try/catch).

- [ ] **Step 3: Commit**

```bash
git add test/poller.test.js
git commit -m "test(poller): verify error isolation between machines"
```

---

## Task 16: `Poller.tick()` — proxmox result application + service ping

**Files:**
- Modify: `test/poller.test.js`
- Modify: `lib/poller.js`

- [ ] **Step 1: Append proxmox + service ping test**

```js
test('Poller.tick: applies proxmox scrape result (pre-computed cpuPct + rate-derived net)', async () => {
  const config = {
    server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox', host: '1', port: 8006, tokenId: 't', tokenSecret: 's' },
    ],
    services: [
      { name: 'Plex', machine: 'proxmox-dmz', url: 'http://example/', icon: 'plex.svg' },
    ],
  };
  const bootTime = Math.floor(Date.now() / 1000) - 3600;
  const scraped = {
    host: {
      cpuPct: 14.3, memUsed: 800, memTotal: 1000, diskUsed: 100, diskTotal: 200,
      uptime: 3600, loadavg: [0.1, 0.2, 0.3],
      _cumulative: { netRxBytes: 10000, netTxBytes: 5000 },
    },
    guests: [
      { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
        cpuPct: 22.5, memUsed: 400, memTotal: 500, diskUsed: 10, diskTotal: 20, uptime: 100 },
    ],
  };
  const pings = [];
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => scraped },
    servicePing: async (svc) => { pings.push(svc.name); return { status: 'up', responseTime: 42 }; },
  });
  await poller.tick();
  const state = poller.getState();
  assert.equal(state.machines['proxmox-dmz'].status, 'up');
  assert.equal(state.machines['proxmox-dmz'].host.cpuPct, 14.3);
  assert.equal(state.machines['proxmox-dmz'].host.memUsed, 800);
  assert.equal(state.machines['proxmox-dmz'].host.netRx, null); // first tick → no rate
  assert.equal(state.machines['proxmox-dmz'].guests.length, 1);
  assert.equal(state.machines['proxmox-dmz'].guests[0].name, 'mc-server');
  assert.equal(pings[0], 'Plex');
  assert.equal(state.services[0].status, 'up');
  assert.equal(state.services[0].responseTime, 42);
  assert.equal(state.globalStatus, 'up');
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: FAIL — proxmox `host.netRx` is not stripped of `_cumulative` and rates aren't applied.

- [ ] **Step 3: Extend `#applyScrapeResult` proxmox branch in `lib/poller.js`**

Replace the existing `else if (entry.type === 'proxmox')` branch with:

```js
} else if (entry.type === 'proxmox') {
  const rawHost = raw.host;
  const prevProxmox = this.#previousSamples.get(entry.name);
  let netRx = null, netTx = null;
  if (prevProxmox) {
    const elapsed = (now - prevProxmox.ts) / 1000;
    if (elapsed > 0) {
      netRx = Math.max(0, (rawHost._cumulative.netRxBytes - prevProxmox.netRxBytes) / elapsed);
      netTx = Math.max(0, (rawHost._cumulative.netTxBytes - prevProxmox.netTxBytes) / elapsed);
    }
  }
  host = {
    cpuPct: rawHost.cpuPct,
    memUsed: rawHost.memUsed,
    memTotal: rawHost.memTotal,
    diskUsed: rawHost.diskUsed,
    diskTotal: rawHost.diskTotal,
    netRx, netTx,
    uptime: rawHost.uptime,
    loadavg: rawHost.loadavg,
  };
  guests = raw.guests;
  this.#previousSamples.set(entry.name, {
    ts: now,
    netRxBytes: rawHost._cumulative.netRxBytes,
    netTxBytes: rawHost._cumulative.netTxBytes,
  });
}
```

Also add `start()` and `stop()` to the class for the server to use later:

```js
start() {
  if (this.#timer) return;
  this.tick().catch(() => {});
  this.#timer = setInterval(() => { this.tick().catch(() => {}); }, this.#config.server.pollIntervalMs);
}

stop() {
  if (this.#timer) { clearInterval(this.#timer); this.#timer = null; }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: `# pass 17`

- [ ] **Step 5: Commit**

```bash
git add lib/poller.js test/poller.test.js
git commit -m "feat(poller): apply proxmox results with rate-calc and add start/stop"
```

---

## Task 17: `server.js` — config validation, wiring, routes

**Files:**
- Create: `server.js`

- [ ] **Step 1: Create `server.js`**

```js
const path = require('node:path');
const express = require('express');
const { Poller } = require('./lib/poller.js');
const proxmox = require('./lib/proxmox.js');
const nodeExporter = require('./lib/node_exporter.js');

function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') errors.push('config.js must export an object');
  if (!cfg.server || typeof cfg.server.port !== 'number') errors.push('server.port must be a number');
  if (!Array.isArray(cfg.machines) || cfg.machines.length === 0) errors.push('machines must be a non-empty array');
  const machineNames = new Set();
  for (const [i, m] of (cfg.machines ?? []).entries()) {
    if (!m.name) errors.push(`machines[${i}].name is required`);
    if (!['proxmox', 'node_exporter'].includes(m.type)) errors.push(`machines[${i}].type must be 'proxmox' or 'node_exporter'`);
    if (!m.host || m.host === 'REPLACE_ME') errors.push(`machines[${i}].host must be set (not REPLACE_ME)`);
    if (m.type === 'proxmox') {
      if (!m.tokenId || m.tokenId === 'REPLACE_ME') errors.push(`machines[${i}].tokenId must be set`);
      if (!m.tokenSecret || m.tokenSecret === 'REPLACE_ME') errors.push(`machines[${i}].tokenSecret must be set`);
    }
    if (m.type === 'node_exporter' && !m.port) errors.push(`machines[${i}].port required for node_exporter`);
    machineNames.add(m.name);
  }
  for (const [i, s] of (cfg.services ?? []).entries()) {
    if (!s.name) errors.push(`services[${i}].name is required`);
    if (!s.url) errors.push(`services[${i}].url is required`);
    if (!machineNames.has(s.machine)) errors.push(`services[${i}].machine '${s.machine}' not in machines`);
  }
  if (errors.length) {
    throw new Error('config.js validation failed:\n  - ' + errors.join('\n  - '));
  }
}

async function servicePing(svc, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await globalThis.fetch(svc.url, { signal: controller.signal, redirect: 'follow' });
    const responseTime = Date.now() - start;
    return { status: res.ok || (res.status >= 300 && res.status < 400) ? 'up' : 'down', responseTime };
  } catch {
    return { status: 'down', responseTime: null };
  } finally {
    clearTimeout(timeout);
  }
}

function main() {
  let config;
  try {
    config = require('./config.js');
    validateConfig(config);
  } catch (err) {
    console.error(`[fatal] ${err.message}`);
    process.exit(1);
  }

  const poller = new Poller(config, {
    scrapers: {
      proxmox: (entry) => proxmox.fetch({ ...entry, proxmoxTimeoutMs: config.server.proxmoxTimeoutMs }),
      node_exporter: (entry) => nodeExporter.fetch({ ...entry, nodeExporterTimeoutMs: config.server.nodeExporterTimeoutMs }),
    },
    servicePing: (svc) => servicePing(svc, config.server.serviceTimeoutMs),
  });
  poller.start();

  const app = express();
  app.get('/api/stats', (_req, res) => res.json(poller.getState()));
  app.get('/api/ping', (_req, res) => res.json({ services: poller.getState().services }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(config.server.port, () => {
    console.log(`[dashboard] listening on http://0.0.0.0:${config.server.port}`);
    console.log(`[dashboard] polling every ${config.server.pollIntervalMs}ms`);
  });
}

main();
```

- [ ] **Step 2: Verify syntax by booting with an invalid config**

Run: `node server.js`
Expected: exits 1 with `[fatal] config.js validation failed:` because `config.js` still has `REPLACE_ME` values.

- [ ] **Step 3: Verify /api/stats route with a temporary valid config**

Create `config.local.js` (gitignored) with dummy values pointing to localhost:

```js
module.exports = {
  server: { port: 3001, pollIntervalMs: 10000, serviceTimeoutMs: 2000, proxmoxTimeoutMs: 5000, nodeExporterTimeoutMs: 5000 },
  machines: [{ name: 'nas', type: 'node_exporter', host: '127.0.0.1', port: 19999 }],
  services: [{ name: 'test', machine: 'nas', url: 'http://127.0.0.1:19999/', icon: 'test.svg' }],
};
```

Then: `CONFIG=./config.local.js node -e "const c=require('./config.local.js');require('./server.js');"`

Actually, since `server.js` hardcodes `require('./config.js')`, a simpler path: temporarily edit `config.js` with valid placeholders, run `node server.js` in one terminal, `curl http://localhost:3000/api/stats` in another, verify JSON shape (machines.nas.status will be 'down' because nothing is listening on 19999 — that's expected), then revert `config.js`.

Expected JSON response (abbreviated):
```json
{
  "lastPoll": "2026-04-15T...",
  "globalStatus": "down",
  "machines": { "nas": { "status": "down", "error": "..." } },
  "services": [ { "name": "test", "status": "down" } ]
}
```

- [ ] **Step 4: Revert `config.js` to template state if modified**

Run: `git checkout config.js`

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(server): express wiring, config validation, service ping, routes"
```

---

## Task 18: `public/index.html` — structure + CSS (fonts, palette, scanline, layout)

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create `public/index.html` with HTML structure and CSS only**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>homelab.status</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #282a36;
  --bg-alt: #1e1f29;
  --surface: #343746;
  --current-line: #44475a;
  --fg: #f8f8f2;
  --comment: #6272a4;
  --green: #50fa7b;
  --yellow: #f1fa8c;
  --orange: #ffb86c;
  --red: #ff5555;
  --pink: #ff79c6;
  --purple: #bd93f9;
  --cyan: #8be9fd;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: Rajdhani, "JetBrains Mono", monospace;
  min-height: 100vh;
  color-scheme: dark;
  overflow-x: hidden;
}
body::after {
  content: "";
  position: fixed; inset: 0;
  background: repeating-linear-gradient(to bottom, transparent 0, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px);
  pointer-events: none; z-index: 9999;
}
header {
  border-bottom: 1px solid var(--current-line);
  background: linear-gradient(180deg, var(--bg-alt) 0%, var(--bg) 100%);
  padding: 1.5rem 2rem;
  display: flex; align-items: center; gap: 1.5rem;
}
h1 {
  font-family: "JetBrains Mono", monospace;
  font-size: 2rem; font-weight: 700; letter-spacing: -0.02em;
}
h1 .domain { color: var(--purple); text-shadow: 0 0 24px rgba(189,147,249,0.45); }
h1 .tld    { color: var(--pink);   text-shadow: 0 0 24px rgba(255,121,198,0.45); }
.status-chip {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--comment);
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.status-chip .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--comment); animation: pulse 2.5s ease-in-out infinite;
}
.status-chip[data-status="up"]       .dot { background: var(--green);  box-shadow: 0 0 6px var(--green); }
.status-chip[data-status="degraded"] .dot { background: var(--yellow); box-shadow: 0 0 6px var(--yellow); }
.status-chip[data-status="down"]     .dot { background: var(--red);    box-shadow: 0 0 6px var(--red); }
.last-poll {
  margin-left: auto;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.78rem; color: var(--comment);
}
.last-poll .prompt { color: var(--green); margin-right: 0.5ch; }
.refresh {
  background: transparent; border: 1px solid var(--current-line);
  color: var(--fg); padding: 0.35rem 0.7rem; border-radius: 4px;
  font-family: "JetBrains Mono", monospace; cursor: pointer;
}
.refresh:hover { border-color: var(--purple); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }

main {
  max-width: 1200px; margin: 0 auto;
  padding: 2rem; display: flex; flex-direction: column; gap: 2.5rem;
}
.section-title {
  font-family: Rajdhani, monospace;
  font-size: 0.85rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.15em; color: var(--comment);
}
.section-title .accent { color: var(--pink); margin-right: 0.5ch; }

.machines-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.services-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }

.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--current-line);
  border-radius: 4px;
  padding: 1.25rem 1.25rem 1.25rem 1.5rem;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  overflow: hidden;
}
.card::before {
  content: ""; position: absolute; inset-block: 0; left: 0;
  width: 3px; background: var(--purple); opacity: 0.8;
  border-radius: 4px 0 0 4px; transition: opacity 0.2s ease;
}
.card::after {
  content: ""; position: absolute; bottom: 0; right: 0;
  width: 0; height: 0; border-style: solid; border-width: 0 0 18px 18px;
  border-color: transparent transparent var(--current-line) transparent; opacity: 0.5;
}
.card[data-status="down"] { border-color: var(--red); }
.card[data-status="down"]::before { background: var(--red); }

.card-header {
  display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1rem;
}
.card-name {
  font-family: Rajdhani, monospace; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; font-size: 1.1rem; color: var(--fg);
  text-shadow: 0 0 16px rgba(189,147,249,0.35);
}
.card-status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--comment); animation: pulse 2.5s ease-in-out infinite;
}
.card[data-status="up"]   .card-status-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.card[data-status="down"] .card-status-dot { background: var(--red);   box-shadow: 0 0 6px var(--red); }

.stat-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; font-family: "JetBrains Mono", monospace; font-size: 0.78rem; }
.stat-row .label   { color: var(--comment); width: 3.5rem; text-transform: uppercase; }
.stat-row .bar     { flex: 1; height: 6px; background: var(--current-line); border-radius: 2px; overflow: hidden; }
.stat-row .bar-fill{ height: 100%; background: var(--purple); width: 0; transition: width 0.4s ease, background 0.4s ease; }
.stat-row .value   { color: var(--fg); min-width: 5.5rem; text-align: right; }

.bar-fill[data-level="low"]   { background: var(--purple); }
.bar-fill[data-level="mid"]   { background: var(--cyan); }
.bar-fill[data-level="high"]  { background: var(--orange); }
.bar-fill[data-level="crit"]  { background: var(--red); }

.net-row {
  display: flex; justify-content: space-between;
  font-family: "JetBrains Mono", monospace; font-size: 0.78rem;
  color: var(--cyan); margin-top: 0.5rem;
}
.uptime-row {
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  color: var(--comment); margin-top: 0.4rem;
}

details.guests { margin-top: 0.8rem; border-top: 1px dashed var(--current-line); padding-top: 0.7rem; }
details.guests > summary {
  cursor: pointer; list-style: none;
  font-family: Rajdhani, monospace; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.12em; font-size: 0.72rem; color: var(--comment);
}
details.guests > summary::-webkit-details-marker { display: none; }
details.guests > summary::before { content: "▸ "; color: var(--pink); }
details.guests[open] > summary::before { content: "▾ "; }
.guest-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 0.5rem; align-items: center;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  padding: 0.25rem 0;
}
.guest-row .guest-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--comment); }
.guest-row[data-status="running"] .guest-dot { background: var(--green); box-shadow: 0 0 4px var(--green); }
.guest-row[data-status="stopped"] .guest-dot { background: var(--comment); }
.guest-row .guest-name { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.guest-row .guest-metric { color: var(--comment); }

.service-card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--current-line);
  border-radius: 4px;
  padding: 1rem;
  display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start;
  text-decoration: none; color: inherit;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.service-card::before {
  content: ""; position: absolute; inset-block: 0; left: 0;
  width: 3px; background: var(--purple); opacity: 0.8;
  border-radius: 4px 0 0 4px;
}
.service-card:hover {
  border-color: var(--purple); transform: translateY(-3px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(0,0,0,0.2);
}
.service-icon {
  width: 48px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 1rem;
  color: var(--purple);
  filter: drop-shadow(0 0 6px var(--purple));
}
.service-icon img { width: 48px; height: 48px; object-fit: contain; }
.service-name {
  font-family: Rajdhani, monospace; font-weight: 700; text-transform: uppercase;
  font-size: 1rem; letter-spacing: 0.04em; color: var(--fg);
}
.service-status {
  font-family: "JetBrains Mono", monospace; font-size: 0.7rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--comment);
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.service-status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--comment); }
.service-card[data-status="up"]   .service-status .dot { background: var(--green); box-shadow: 0 0 4px var(--green); }
.service-card[data-status="down"] .service-status .dot { background: var(--red);   box-shadow: 0 0 4px var(--red); }

.error-banner {
  background: var(--surface); border: 1px solid var(--red); border-radius: 4px;
  padding: 0.5rem 1rem; color: var(--red);
  font-family: "JetBrains Mono", monospace; font-size: 0.78rem;
  display: none;
}
.error-banner.visible { display: block; }

footer {
  margin-top: 3rem; padding: 1.2rem 2rem;
  border-top: 1px solid var(--current-line); background: var(--bg-alt);
  text-align: center;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem; color: var(--comment);
}
footer .prompt { color: var(--green); margin-right: 0.5ch; }
</style>
</head>
<body>
<header>
  <h1><span class="bracket">[</span><span class="domain">homelab</span><span class="tld">.status</span><span class="bracket">]</span></h1>
  <div class="status-chip" id="globalStatus" data-status="down"><span class="dot"></span><span id="globalStatusLabel">booting</span></div>
  <div class="last-poll"><span class="prompt">$</span><span id="lastPoll">waiting for first poll…</span></div>
  <button class="refresh" id="refreshBtn" title="Force refresh">⟳</button>
</header>
<main>
  <div class="error-banner" id="errorBanner">stats stale — retrying</div>
  <section>
    <div class="section-title"><span class="accent">&gt;</span>MACHINES</div>
    <div class="machines-grid" id="machinesGrid"></div>
  </section>
  <section>
    <div class="section-title"><span class="accent">&gt;</span>SERVICES</div>
    <div class="services-grid" id="servicesGrid"></div>
  </section>
</main>
<footer><span class="prompt">$</span>homelab-dashboard — polling /api/stats every 5s</footer>
<script></script>
</body>
</html>
```

- [ ] **Step 2: Manual smoke test**

Start the server (after Task 17 config revert), visit `http://localhost:3000/` in a browser. Expected: header + empty placeholders + footer, all Dracula-themed, with scanline overlay visible, JetBrains Mono / Rajdhani fonts loaded. No errors in the browser console. No data in the grids yet (script empty). Kill the server.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(frontend): HTML structure, Dracula palette, scanline, fonts, card styles"
```

---

## Task 19: `public/index.html` — machine card render + stat bars

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace the empty `<script>` tag with the render logic**

```html
<script>
const POLL_INTERVAL_MS = 5000;
let lastStatsOk = true;

function formatBytes(n) {
  if (n == null) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
function formatRate(n) {
  if (n == null) return '—';
  return `${formatBytes(n)}/s`;
}
function formatPct(n) {
  if (n == null) return '—';
  return `${n.toFixed(0)}%`;
}
function formatUptime(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function levelFor(pct) {
  if (pct == null) return 'low';
  if (pct < 60) return 'low';
  if (pct < 80) return 'mid';
  if (pct < 95) return 'high';
  return 'crit';
}
function pctSafe(used, total) {
  if (!total || total === 0) return null;
  return (used / total) * 100;
}

function renderMachineCard(machine, state) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.machine = machine.name;
  card.dataset.status = state.status;
  card.innerHTML = `
    <div class="card-header">
      <span class="card-status-dot"></span>
      <span class="card-name">${machine.name}</span>
    </div>
    <div class="stats"></div>
    <div class="net-row"><span class="rx">↓ —</span><span class="tx">↑ —</span></div>
    <div class="uptime-row">up —</div>
    <details class="guests" ${machine.type === 'proxmox' ? 'open' : 'hidden'}>
      <summary>guests</summary>
      <div class="guest-list"></div>
    </details>
  `;
  const stats = card.querySelector('.stats');
  stats.innerHTML = [
    statRow('CPU', null),
    statRow('MEM', null),
    statRow('DSK', null),
  ].join('');
  return card;
}
function statRow(label, pct) {
  const level = levelFor(pct);
  return `
    <div class="stat-row" data-metric="${label.toLowerCase()}">
      <span class="label">${label}</span>
      <div class="bar"><div class="bar-fill" data-level="${level}" style="width:${pct ?? 0}%"></div></div>
      <span class="value">${formatPct(pct)}</span>
    </div>
  `;
}
function updateMachineCard(card, machine, state) {
  card.dataset.status = state.status;
  const host = state.host;
  const cpuPct = host?.cpuPct ?? null;
  const memPct = host ? pctSafe(host.memUsed, host.memTotal) : null;
  const dskPct = host ? pctSafe(host.diskUsed, host.diskTotal) : null;
  setStat(card, 'cpu', cpuPct, host ? formatPct(cpuPct) : '—');
  setStat(card, 'mem', memPct, host ? `${formatBytes(host.memUsed)} / ${formatBytes(host.memTotal)}` : '—');
  setStat(card, 'dsk', dskPct, host ? `${formatBytes(host.diskUsed)} / ${formatBytes(host.diskTotal)}` : '—');
  card.querySelector('.rx').textContent = `↓ ${formatRate(host?.netRx)}`;
  card.querySelector('.tx').textContent = `↑ ${formatRate(host?.netTx)}`;
  card.querySelector('.uptime-row').textContent = `up ${formatUptime(host?.uptime)}`;
}
function setStat(card, metric, pct, valueText) {
  const row = card.querySelector(`.stat-row[data-metric="${metric}"]`);
  const fill = row.querySelector('.bar-fill');
  fill.style.width = pct == null ? '0%' : `${Math.min(100, pct)}%`;
  fill.dataset.level = levelFor(pct);
  row.querySelector('.value').textContent = valueText;
}

const state = { machines: {}, services: {}, config: null };

async function fetchConfig() {
  // Frontend has no direct config access; we discover machines & services from /api/stats
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastStatsOk = true;
    document.getElementById('errorBanner').classList.remove('visible');
    renderStats(data);
  } catch (err) {
    lastStatsOk = false;
    document.getElementById('errorBanner').classList.add('visible');
    console.warn('[stats] fetch failed:', err.message);
  }
}

function renderStats(data) {
  // global status
  const chip = document.getElementById('globalStatus');
  chip.dataset.status = data.globalStatus;
  document.getElementById('globalStatusLabel').textContent = data.globalStatus;
  document.getElementById('lastPoll').textContent = `last poll ${new Date(data.lastPoll).toLocaleTimeString()}`;

  // machines
  const grid = document.getElementById('machinesGrid');
  for (const [name, machineState] of Object.entries(data.machines)) {
    let card = grid.querySelector(`.card[data-machine="${name}"]`);
    if (!card) {
      card = renderMachineCard({ name, type: machineState.type }, machineState);
      grid.appendChild(card);
    }
    updateMachineCard(card, { name, type: machineState.type }, machineState);
  }
}

document.getElementById('refreshBtn').addEventListener('click', fetchStats);
fetchStats();
setInterval(fetchStats, POLL_INTERVAL_MS);
</script>
```

- [ ] **Step 2: Manual smoke test**

Start the server with a valid `config.js` pointing at at least one reachable machine (or accept that everything shows offline). Visit `http://localhost:3000/`. Expected: machine cards appear, stat bars render (may be empty/offline), DOM does not flicker on subsequent polls, no console errors. Kill the server.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(frontend): render machine cards with stat bars and network rates"
```

---

## Task 20: `public/index.html` — guests section render

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add guest rendering inside `updateMachineCard` (before the closing brace)**

Add after `card.querySelector('.uptime-row').textContent = ...;`:

```js
  const guestList = card.querySelector('.guest-list');
  const details = card.querySelector('details.guests');
  if (state.guests && state.guests.length > 0) {
    details.hidden = false;
    details.querySelector('summary').textContent = `guests [${state.guests.length}]`;
    guestList.innerHTML = state.guests
      .sort((a, b) => (b.status === 'running') - (a.status === 'running') || a.name.localeCompare(b.name))
      .map((g) => {
        const cpu = g.cpuPct == null ? '—' : `${g.cpuPct.toFixed(0)}%`;
        const mem = pctSafe(g.memUsed, g.memTotal);
        const memPct = mem == null ? '—' : `${mem.toFixed(0)}%`;
        return `
          <div class="guest-row" data-status="${g.status}">
            <span class="guest-dot"></span>
            <span class="guest-name">${escapeHtml(g.name)}</span>
            <span class="guest-metric">cpu ${cpu}</span>
            <span class="guest-metric">mem ${memPct}</span>
          </div>
        `;
      }).join('');
  } else if (machine.type === 'proxmox') {
    details.hidden = false;
    details.querySelector('summary').textContent = 'guests [0]';
    guestList.innerHTML = '';
  } else {
    details.hidden = true;
  }
```

And add an `escapeHtml` helper above `renderMachineCard`:

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
```

- [ ] **Step 2: Manual smoke test**

Start server pointing at a real Proxmox host. Verify the guests section shows the LXC/VM list, sorted running-first, with CPU and memory percentages. Click to collapse/expand. No console errors.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(frontend): render collapsible guest list with running-first sort"
```

---

## Task 21: `public/index.html` — services grid + icon resolution

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Append service rendering to `renderStats`**

Add at the bottom of `renderStats`:

```js
  // services
  const sGrid = document.getElementById('servicesGrid');
  for (const svc of data.services) {
    const key = `${svc.machine}::${svc.name}`;
    let el = sGrid.querySelector(`.service-card[data-key="${CSS.escape(key)}"]`);
    if (!el) {
      el = document.createElement('a');
      el.className = 'service-card';
      el.dataset.key = key;
      el.href = svc.url;
      el.target = '_blank';
      el.rel = 'noopener';
      el.innerHTML = `
        <div class="service-icon"></div>
        <div class="service-name">${escapeHtml(svc.name)}</div>
        <div class="service-status"><span class="dot"></span><span class="text">—</span></div>
      `;
      const iconEl = el.querySelector('.service-icon');
      const iconVal = svc.icon ?? '';
      if (iconVal.endsWith('.svg') || iconVal.includes('/')) {
        const img = document.createElement('img');
        img.src = `icons/${iconVal}`;
        img.alt = svc.name;
        img.onerror = () => { iconEl.textContent = iconFallback(svc.name); };
        iconEl.appendChild(img);
      } else if (iconVal) {
        iconEl.textContent = iconVal;
      } else {
        iconEl.textContent = iconFallback(svc.name);
      }
      sGrid.appendChild(el);
    }
    el.dataset.status = svc.status;
    el.querySelector('.service-status .text').textContent =
      svc.status === 'up' ? `up ${svc.responseTime ?? '—'}ms` : 'offline';
  }
```

And the helper:

```js
function iconFallback(name) {
  return String(name).replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || '???';
}
```

- [ ] **Step 2: Manual smoke test**

Drop a PNG or placeholder-named SVG into `public/icons/` matching a config entry; start the server; verify the icon shows. Delete the file; reload; verify the fallback text label appears (e.g. `PVE`). Verify clicking a service opens its URL in a new tab.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(frontend): service grid with SVG icon loading and text fallback"
```

---

## Task 22: `public/index.html` — offline states, global status polish

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Improve offline card display**

Add inside `updateMachineCard`, right after `card.dataset.status = state.status;`:

```js
  const errorHolder = card.querySelector('.card-error') ?? (() => {
    const el = document.createElement('div');
    el.className = 'card-error';
    el.style.cssText = 'color:var(--red);font-family:"JetBrains Mono",monospace;font-size:0.7rem;margin-top:0.4rem;';
    card.appendChild(el);
    return el;
  })();
  errorHolder.textContent = state.status === 'down' && state.error ? state.error : '';
```

- [ ] **Step 2: Manual smoke test**

Point `config.js` at a non-existent Proxmox host. Verify the card turns red, the error string shows under the stats, and the global status chip shows `degraded` or `down`.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(frontend): surface per-machine error strings and polish offline display"
```

---

## Task 23: systemd unit file

**Files:**
- Create: `homelab-dashboard.service`

- [ ] **Step 1: Create `homelab-dashboard.service`**

```ini
[Unit]
Description=Homelab Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dashboard
Group=dashboard
WorkingDirectory=/opt/homelab-monitoring
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

# Hardening (safe defaults for a read-only dashboard)
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/homelab-monitoring/logs

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Commit**

```bash
git add homelab-dashboard.service
git commit -m "chore: add systemd unit file"
```

---

## Task 24: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
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
````

- [ ] **Step 2: Final full-suite run**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: setup, PVE token, node_exporter, systemd, known limitations"
```

---

## Self-review notes

**Spec coverage check:**
- Poll interval 10 s, frontend poll 5 s, port 3000 → Task 2 config + Task 17 server ✓
- Proxmox API integration (cluster/resources + nodes/<name>/status) → Tasks 9–11 ✓
- node_exporter integration → Tasks 3–8 ✓
- In-memory cache + rate computation → Tasks 12–16 ✓
- `/api/stats` and `/api/ping` routes → Task 17 ✓
- `config.js` single source of truth + validation → Tasks 2 + 17 ✓
- Dracula palette + scanlines + fonts → Task 18 ✓
- Machine cards + stat bars + color thresholds → Tasks 18–19 ✓
- Guests section (LXC + QEMU) → Task 20 ✓
- Service grid with SVG icons + text fallback → Task 21 ✓
- Offline error surfacing → Task 22 ✓
- systemd unit → Task 23 ✓
- README with PVE token howto + node_exporter setup → Task 24 ✓

**Known simplifications:**
- `lib/proxmox.js` `fetch()` is not unit-tested (covered manually end-to-end from Task 17 onward). Pure parsers `parseClusterResources` and `parseNodeStatus` are fully unit-tested.
- Frontend has no automated tests — manual smoke tests after each render task.
- `CONFIG=...` environment variable override is not implemented — `server.js` hardcodes `require('./config.js')`. If you want a separate dev config, symlink or edit the file.

**Type consistency:**
- `parseMetrics` return shape: `{ memTotal, memAvailable, diskTotal, diskAvailable, netRxBytes, netTxBytes, cpuIdleSeconds, cpuTotalSeconds, bootTimeSeconds, loadavg }` — stable across Tasks 3–8.
- `parseClusterResources` returns `{ host: { ..., _cumulative: { netRxBytes, netTxBytes } }, guests: [] }` — stable across Tasks 9–11.
- Poller state shape matches `/api/stats` example in the spec — verified in Task 16 test.
