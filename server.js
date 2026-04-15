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
