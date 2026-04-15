const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { Poller } = require('./lib/poller.js');
const { Storage, METRIC_COLUMNS } = require('./lib/storage.js');

const RANGE_PRESETS = {
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const startTs = Date.now() / 1000;

const devConfig = {
  server: { pollIntervalMs: 3000, serviceTimeoutMs: 1000, proxmoxTimeoutMs: 2000, nodeExporterTimeoutMs: 2000 },
  machines: [
    { name: 'proxmox-dmz',      type: 'proxmox',       primaryUrl: 'https://demo-proxmox-dmz.invalid:8006' },
    { name: 'proxmox-internal', type: 'proxmox',       primaryUrl: 'https://demo-proxmox-internal.invalid:8006' },
    { name: 'nas',              type: 'node_exporter', primaryUrl: 'http://demo-nas.invalid' },
  ],
  guestLinks: [
    { machine: 'proxmox-dmz',      guest: 'mealie-lxc', url: 'http://127.0.0.1:1/mealie',    icon: 'mealie-light.svg' },
    { machine: 'proxmox-internal', guest: 'plex-lxc',   url: 'http://127.0.0.1:1/plex',      icon: 'plex-light.svg'   },
    { machine: 'proxmox-internal', guest: 'dashboard',  url: 'http://127.0.0.1:1/dashboard', icon: 'dashboard.svg'    },
  ],
};

function drift(base, range, freq) {
  const t = Date.now() / 1000 - startTs;
  return Math.max(0, Math.min(100, base + Math.sin(t * freq) * range));
}

async function mockProxmox(entry) {
  const elapsedSec = Date.now() / 1000 - startTs;
  const isDmz = entry.name === 'proxmox-dmz';
  return {
    host: {
      cpuPct: isDmz ? drift(35, 20, 0.3) : drift(18, 10, 0.2),
      memUsed: (isDmz ? 22 : 14) * 1e9 + Math.sin(elapsedSec * 0.1) * 1e9,
      memTotal: 32 * 1e9,
      diskUsed: (isDmz ? 410 : 520) * 1e9,
      diskTotal: 1024 * 1e9,
      uptime: 864000 + Math.floor(elapsedSec),
      loadavg: [0.35, 0.42, 0.48],
      _cumulative: {
        netRxBytes: (isDmz ? 12e6 : 3e6) * elapsedSec,
        netTxBytes: (isDmz ? 8e6 : 1.5e6) * elapsedSec,
      },
    },
    guests: isDmz
      ? [
          { vmid: 101, name: 'mc-server',  type: 'lxc',  status: 'running', cpuPct: drift(45, 15, 0.4),  memUsed: 3.2e9, memTotal: 4e9,   diskUsed: 12e9,  diskTotal: 20e9, uptime: 432000, _cumulative: { netRxBytes: 1_500_000 * elapsedSec, netTxBytes: 800_000 * elapsedSec } },
          { vmid: 102, name: 'val-srv',    type: 'lxc',  status: 'running', cpuPct: drift(60, 20, 0.5),  memUsed: 3.6e9, memTotal: 4e9,   diskUsed: 15e9,  diskTotal: 20e9, uptime: 200000, _cumulative: { netRxBytes: 4_000_000 * elapsedSec, netTxBytes: 2_500_000 * elapsedSec } },
          { vmid: 103, name: 'cs2-srv',    type: 'lxc',  status: 'running', cpuPct: drift(30, 15, 0.35), memUsed: 2.1e9, memTotal: 4e9,   diskUsed: 18e9,  diskTotal: 20e9, uptime: 120000, _cumulative: { netRxBytes: 6_000_000 * elapsedSec, netTxBytes: 3_200_000 * elapsedSec } },
          { vmid: 105, name: 'mealie-lxc', type: 'lxc',  status: 'running', cpuPct: drift(4,  2, 0.3),   memUsed: 340e6, memTotal: 1e9,   diskUsed: 2.4e9, diskTotal: 10e9, uptime: 350000, _cumulative: { netRxBytes: 80_000 * elapsedSec,    netTxBytes: 60_000 * elapsedSec } },
          { vmid: 104, name: 'rust-srv',   type: 'lxc',  status: 'stopped', cpuPct: 0,                   memUsed: 0,     memTotal: 6e9,   diskUsed: 22e9,  diskTotal: 40e9, uptime: 0,      _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
          { vmid: 301, name: 'win-srv',    type: 'qemu', status: 'stopped', cpuPct: 0,                   memUsed: 0,     memTotal: 8e9,   diskUsed: 0,     diskTotal: 0,    uptime: 0,      _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
        ]
      : [
          { vmid: 201, name: 'plex-lxc',  type: 'lxc',  status: 'running', cpuPct: drift(12, 8, 0.25),  memUsed: 2.4e9, memTotal: 4e9,   diskUsed: 5.5e9, diskTotal: 20e9, uptime: 700000, _cumulative: { netRxBytes: 300_000 * elapsedSec, netTxBytes: 10_000_000 * elapsedSec } },
          { vmid: 202, name: 'nginx-lxc', type: 'lxc',  status: 'running', cpuPct: drift(2, 1, 0.8),    memUsed: 512e6, memTotal: 1e9,   diskUsed: 2e9,   diskTotal: 10e9, uptime: 900000, _cumulative: { netRxBytes: 200_000 * elapsedSec, netTxBytes: 800_000 * elapsedSec } },
          { vmid: 203, name: 'pihole',    type: 'lxc',  status: 'running', cpuPct: drift(1, 0.5, 1),    memUsed: 220e6, memTotal: 512e6, diskUsed: 1e9,   diskTotal: 5e9,  uptime: 600000, _cumulative: { netRxBytes: 100_000 * elapsedSec, netTxBytes: 100_000 * elapsedSec } },
          { vmid: 204, name: 'dashboard', type: 'lxc',  status: 'running', cpuPct: drift(3, 2, 0.6),    memUsed: 180e6, memTotal: 512e6, diskUsed: 600e6, diskTotal: 5e9,  uptime: 150000, _cumulative: { netRxBytes: 50_000 * elapsedSec, netTxBytes: 50_000 * elapsedSec } },
        ],
  };
}

async function mockNodeExporter() {
  const elapsedSec = Date.now() / 1000 - startTs;
  return {
    memTotal: 64e9,
    memAvailable: 50e9 - Math.sin(elapsedSec * 0.15) * 2e9,
    diskTotal: 20e12,
    diskAvailable: 12e12 - elapsedSec * 1e6,
    netRxBytes: 45e6 * elapsedSec,
    netTxBytes: 30e6 * elapsedSec,
    cpuIdleSeconds: 900_000 + elapsedSec * 0.85,
    cpuTotalSeconds: 1_000_000 + elapsedSec,
    bootTimeSeconds: Math.floor(Date.now() / 1000) - 10_200_000,
    loadavg: [0.75, 0.82, 0.88],
  };
}

const serviceStates = new Map([
  ['Proxmox DMZ', 'up'],
  ['Mealie', 'up'],
  ['Proxmox Internal', 'up'],
  ['Plex', 'up'],
  ['netboot.xyz', 'down'],
  ['Dashboard', 'up'],
  ['TrueNAS', 'up'],
]);

async function mockServicePing(svc) {
  const status = serviceStates.get(svc.name) ?? 'up';
  return { status, responseTime: status === 'up' ? Math.floor(20 + Math.random() * 80) : null };
}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const storage = new Storage(path.join(dataDir, 'dev.db'));

const poller = new Poller(devConfig, {
  scrapers: { proxmox: mockProxmox, node_exporter: mockNodeExporter },
  storage,
});
poller.start();

const app = express();
app.get('/api/stats', (_req, res) => res.json(poller.getState()));

app.get('/api/history', (req, res) => {
  try {
    const { machine, guest, range } = req.query;
    const metrics = String(req.query.metrics ?? 'cpu,memUsed,memTotal,diskUsed,diskTotal,netRx,netTx')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (!machine) return res.status(400).json({ error: 'machine query param is required' });
    const rangeMs = RANGE_PRESETS[range] ?? RANGE_PRESETS['24h'];
    const toTs = Date.now();
    const fromTs = toTs - rangeMs;
    const result = {};
    for (const metric of metrics) {
      if (!METRIC_COLUMNS[metric]) return res.status(400).json({ error: `unknown metric: ${metric}` });
      result[metric] = storage.query({ machine, guest: guest || null, metric, fromTs, toTs });
    }
    res.json({ machine, guest: guest || null, range, fromTs, toTs, metrics: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[dev] homelab-dashboard dev server on http://localhost:${port}`);
  console.log(`[dev] mocked scrapers drifting every ${devConfig.server.pollIntervalMs}ms`);
  console.log(`[dev] storage at ${path.join(dataDir, 'dev.db')}`);
});
