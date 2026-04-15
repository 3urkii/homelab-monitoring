const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { Poller } = require('./lib/poller.js');
const { Storage, METRIC_COLUMNS } = require('./lib/storage.js');
const proxmox = require('./lib/proxmox.js');
const nodeExporter = require('./lib/node_exporter.js');

const ROLLUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const RANGE_PRESETS = {
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

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
  for (const [i, l] of (cfg.guestLinks ?? []).entries()) {
    if (!l.machine || !machineNames.has(l.machine)) errors.push(`guestLinks[${i}].machine '${l.machine}' not in machines`);
    if (!l.guest) errors.push(`guestLinks[${i}].guest is required`);
    if (!l.url) errors.push(`guestLinks[${i}].url is required`);
  }
  if (errors.length) {
    throw new Error('config.js validation failed:\n  - ' + errors.join('\n  - '));
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

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const storage = new Storage(path.join(dataDir, 'dashboard.db'));
  setInterval(() => {
    try {
      storage.rollup();
    } catch (err) {
      console.error(`[storage] rollup failed: ${err.message}`);
    }
  }, ROLLUP_INTERVAL_MS);

  const poller = new Poller(config, {
    scrapers: {
      proxmox: (entry) => proxmox.fetch({ ...entry, proxmoxTimeoutMs: config.server.proxmoxTimeoutMs }),
      node_exporter: (entry) => nodeExporter.fetch({ ...entry, nodeExporterTimeoutMs: config.server.nodeExporterTimeoutMs }),
    },
    storage,
  });
  poller.start();

  const app = express();
  app.get('/api/stats', (_req, res) => res.json(poller.getState()));

  app.get('/api/history', (req, res) => {
    try {
      const { machine, guest, range } = req.query;
      const metrics = String(req.query.metrics ?? 'cpu,memUsed,memTotal,diskUsed,diskTotal,netRx,netTx')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!machine) return res.status(400).json({ error: 'machine query param is required' });
      const rangeMs = RANGE_PRESETS[range] ?? RANGE_PRESETS['24h'];
      const toTs = Date.now();
      const fromTs = toTs - rangeMs;
      const result = {};
      for (const metric of metrics) {
        if (!METRIC_COLUMNS[metric]) {
          return res.status(400).json({ error: `unknown metric: ${metric}` });
        }
        result[metric] = storage.query({
          machine,
          guest: guest || null,
          metric,
          fromTs,
          toTs,
        });
      }
      res.json({ machine, guest: guest || null, range, fromTs, toTs, metrics: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(config.server.port, () => {
    console.log(`[dashboard] listening on http://0.0.0.0:${config.server.port}`);
    console.log(`[dashboard] polling every ${config.server.pollIntervalMs}ms`);
    console.log(`[dashboard] storage at ${path.join(dataDir, 'dashboard.db')}`);
  });
}

main();
