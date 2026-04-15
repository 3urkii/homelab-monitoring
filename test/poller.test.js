const test = require('node:test');
const assert = require('node:assert/strict');
const { Poller } = require('../lib/poller.js');

const baseConfig = {
  server: { pollIntervalMs: 10_000 },
  machines: [
    { name: 'nas', type: 'node_exporter', host: '127.0.0.1', port: 9100 },
  ],
};

test('Poller: getState returns skeleton before first tick', () => {
  const poller = new Poller(baseConfig, { scrapers: {} });
  const state = poller.getState();
  assert.equal(state.lastPoll, null);
  assert.equal(state.globalStatus, 'down');
  assert.equal(state.machines.nas.status, 'down');
  assert.equal(state.machines.nas.host, null);
  assert.equal(state.services, undefined);
});

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
    scrapers: { node_exporter: async () => mockNodeExporterResult },
  });
  await poller.tick();
  const state = poller.getState();
  assert.ok(state.lastPoll);
  assert.equal(state.machines.nas.status, 'up');
  assert.equal(state.machines.nas.host.memUsed, 600);
  assert.equal(state.machines.nas.host.memTotal, 1000);
  assert.equal(state.machines.nas.host.diskUsed, 1200);
  assert.equal(state.machines.nas.host.diskTotal, 2000);
  assert.equal(state.machines.nas.host.netRx, null);
  assert.equal(state.machines.nas.host.netTx, null);
  assert.equal(state.machines.nas.host.cpuPct, null);
  assert.ok(state.machines.nas.host.uptime >= 3600);
  assert.deepEqual(state.machines.nas.host.loadavg, [0.1, 0.2, 0.3]);
});

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
  });
  await poller.tick();
  await new Promise((r) => setTimeout(r, 100));
  await poller.tick();
  const host = poller.getState().machines.nas.host;
  assert.ok(host.netRx > 0, `expected netRx > 0, got ${host.netRx}`);
  assert.ok(host.netTx > 0, `expected netTx > 0, got ${host.netTx}`);
  assert.equal(host.cpuPct.toFixed(0), '50');
});

test('Poller.tick: one scraper failing does not affect others', async () => {
  const config = {
    server: { pollIntervalMs: 10_000 },
    machines: [
      { name: 'nas',  type: 'node_exporter', host: '1', port: 9100 },
      { name: 'bad',  type: 'node_exporter', host: '2', port: 9100 },
    ],
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
  });
  await poller.tick();
  const state = poller.getState();
  assert.equal(state.machines.nas.status, 'up');
  assert.equal(state.machines.bad.status, 'down');
  assert.match(state.machines.bad.error, /boom/);
});

test('Poller.tick: applies proxmox scrape result (pre-computed cpuPct + rate-derived net)', async () => {
  const config = {
    server: { pollIntervalMs: 10_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox', host: '1', port: 8006, tokenId: 't', tokenSecret: 's' },
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
        cpuPct: 22.5, memUsed: 400, memTotal: 500, diskUsed: 10, diskTotal: 20, uptime: 100,
        _cumulative: { netRxBytes: 2000, netTxBytes: 1000 } },
    ],
  };
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => scraped },
  });
  await poller.tick();
  const state = poller.getState();
  assert.equal(state.machines['proxmox-dmz'].status, 'up');
  assert.equal(state.machines['proxmox-dmz'].host.cpuPct, 14.3);
  assert.equal(state.machines['proxmox-dmz'].host.memUsed, 800);
  assert.equal(state.machines['proxmox-dmz'].host.netRx, null);
  assert.equal(state.machines['proxmox-dmz'].guests.length, 1);
  assert.equal(state.machines['proxmox-dmz'].guests[0].name, 'mc-server');
  assert.equal(state.machines['proxmox-dmz'].guests[0].netRx, null);
  assert.equal(state.machines['proxmox-dmz'].guests[0].netTx, null);
  assert.equal(state.machines['proxmox-dmz'].guests[0]._cumulative, undefined);
  assert.equal(state.globalStatus, 'up');
});

test('Poller.tick: computes per-guest network rates across consecutive ticks', async () => {
  const config = {
    server: { pollIntervalMs: 10_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox', host: '1', port: 8006, tokenId: 't', tokenSecret: 's' },
    ],
  };
  let callCount = 0;
  const samples = [
    {
      host: { cpuPct: 10, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500,
              uptime: 100, loadavg: [0,0,0],
              _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
      guests: [
        { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
          cpuPct: 20, memUsed: 200, memTotal: 400, diskUsed: 5, diskTotal: 20, uptime: 50,
          _cumulative: { netRxBytes: 1000, netTxBytes: 500 } },
        { vmid: 102, name: 'cs2-srv', type: 'lxc', status: 'running',
          cpuPct: 30, memUsed: 250, memTotal: 400, diskUsed: 7, diskTotal: 20, uptime: 70,
          _cumulative: { netRxBytes: 5000, netTxBytes: 2500 } },
      ],
    },
    {
      host: { cpuPct: 10, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500,
              uptime: 100, loadavg: [0,0,0],
              _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
      guests: [
        { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
          cpuPct: 22, memUsed: 200, memTotal: 400, diskUsed: 5, diskTotal: 20, uptime: 50,
          _cumulative: { netRxBytes: 11000, netTxBytes: 5500 } },
        { vmid: 102, name: 'cs2-srv', type: 'lxc', status: 'running',
          cpuPct: 32, memUsed: 250, memTotal: 400, diskUsed: 7, diskTotal: 20, uptime: 70,
          _cumulative: { netRxBytes: 25000, netTxBytes: 12500 } },
      ],
    },
  ];
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => samples[callCount++] },
  });
  await poller.tick();
  await new Promise((r) => setTimeout(r, 100));
  await poller.tick();
  const guests = poller.getState().machines['proxmox-dmz'].guests;
  const mc = guests.find((g) => g.vmid === 101);
  const cs2 = guests.find((g) => g.vmid === 102);
  assert.ok(mc.netRx > 0, `mc netRx should be > 0, got ${mc.netRx}`);
  assert.ok(mc.netTx > 0, `mc netTx should be > 0, got ${mc.netTx}`);
  assert.ok(cs2.netRx > mc.netRx);
  assert.equal(mc._cumulative, undefined);
  assert.equal(cs2._cumulative, undefined);
});

test('Poller: persists samples to injected storage on each tick', async () => {
  const config = {
    server: { pollIntervalMs: 10_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox' },
    ],
  };
  const scraped = {
    host: {
      cpuPct: 15, memUsed: 800, memTotal: 1000, diskUsed: 100, diskTotal: 200,
      uptime: 3600, loadavg: [0.1, 0.2, 0.3],
      _cumulative: { netRxBytes: 0, netTxBytes: 0 },
    },
    guests: [
      { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
        cpuPct: 22, memUsed: 400, memTotal: 500, diskUsed: 10, diskTotal: 20, uptime: 100,
        _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
    ],
  };
  const captured = [];
  const storage = { insertBatch: (rows) => captured.push(...rows) };
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => scraped },
    storage,
  });
  await poller.tick();
  assert.equal(captured.length, 2, 'should persist 1 host + 1 guest sample');
  const host = captured.find((s) => s.guest === null);
  const guest = captured.find((s) => s.guest === 'mc-server');
  assert.equal(host.machine, 'proxmox-dmz');
  assert.equal(host.cpuPct, 15);
  assert.equal(host.memUsed, 800);
  assert.equal(guest.cpuPct, 22);
  assert.equal(guest.memUsed, 400);
});

test('Poller: invokes alertManager.evaluate(state) at end of tick', async () => {
  const calls = [];
  const fakeAlertManager = { evaluate: async (state, now) => { calls.push({ state, now }); } };
  const config = {
    server: { port: 0, pollIntervalMs: 60_000, proxmoxTimeoutMs: 1000, nodeExporterTimeoutMs: 1000, serviceTimeoutMs: 1000 },
    machines: [{ name: 'm', type: 'node_exporter', host: 'x', port: 9100 }],
  };
  const fakeScraper = async () => ({
    memTotal: 1000, memAvailable: 500, diskTotal: 10000, diskAvailable: 5000,
    netRxBytes: 0, netTxBytes: 0, cpuIdleSeconds: 0, cpuTotalSeconds: 1, bootTimeSeconds: 0, loadavg: [0,0,0],
  });
  const p = new Poller(config, { scrapers: { node_exporter: fakeScraper }, storage: null, alertManager: fakeAlertManager });
  await p.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].state.machines.m.status, 'up');
});

test('Poller: overlays guestLinks url/icon onto matching auto-discovered guests', async () => {
  const config = {
    server: { pollIntervalMs: 10_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox' },
    ],
    guestLinks: [
      { machine: 'proxmox-dmz', guest: 'mc-server', url: 'http://mc.example/', icon: 'mc.svg' },
    ],
  };
  const scraped = {
    host: {
      cpuPct: 10, memUsed: 100, memTotal: 1000, diskUsed: 10, diskTotal: 100,
      uptime: 100, loadavg: [0,0,0],
      _cumulative: { netRxBytes: 0, netTxBytes: 0 },
    },
    guests: [
      { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
        cpuPct: 20, memUsed: 200, memTotal: 400, diskUsed: 5, diskTotal: 20, uptime: 50,
        _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
      { vmid: 102, name: 'other-lxc', type: 'lxc', status: 'running',
        cpuPct: 5, memUsed: 100, memTotal: 200, diskUsed: 1, diskTotal: 10, uptime: 10,
        _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
    ],
  };
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => scraped },
  });
  await poller.tick();
  const guests = poller.getState().machines['proxmox-dmz'].guests;
  const mc = guests.find((g) => g.name === 'mc-server');
  const other = guests.find((g) => g.name === 'other-lxc');
  assert.equal(mc.url, 'http://mc.example/');
  assert.equal(mc.icon, 'mc.svg');
  assert.equal(other.url, null);
  assert.equal(other.icon, null);
});
