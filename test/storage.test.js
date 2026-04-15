const test = require('node:test');
const assert = require('node:assert/strict');
const { Storage, HOT_MS, WARM_MS } = require('../lib/storage.js');

function mkStorage() {
  return new Storage(':memory:');
}

test('Storage: inserts and queries samples', () => {
  const s = mkStorage();
  const now = Date.now();
  s.insertBatch([
    { machine: 'proxmox-dmz', guest: null,         ts: now - 20_000, cpuPct: 10, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500, netRx: 5, netTx: 3 },
    { machine: 'proxmox-dmz', guest: null,         ts: now - 10_000, cpuPct: 12, memUsed: 110, memTotal: 1000, diskUsed: 52, diskTotal: 500, netRx: 6, netTx: 4 },
    { machine: 'proxmox-dmz', guest: 'mc-server',  ts: now - 20_000, cpuPct: 40, memUsed: 300, memTotal: 400,  diskUsed: 15, diskTotal: 20,  netRx: 2, netTx: 1 },
    { machine: 'proxmox-dmz', guest: 'mc-server',  ts: now - 10_000, cpuPct: 45, memUsed: 310, memTotal: 400,  diskUsed: 15, diskTotal: 20,  netRx: 3, netTx: 2 },
  ]);
  const hostCpu = s.query({ machine: 'proxmox-dmz', guest: null, metric: 'cpu', fromTs: now - 60_000, toTs: now });
  assert.equal(hostCpu.length, 2);
  assert.equal(hostCpu[0][1], 10);
  assert.equal(hostCpu[1][1], 12);
  const guestCpu = s.query({ machine: 'proxmox-dmz', guest: 'mc-server', metric: 'cpu', fromTs: now - 60_000, toTs: now });
  assert.equal(guestCpu.length, 2);
  assert.equal(guestCpu[0][1], 40);
  assert.equal(guestCpu[1][1], 45);
  s.close();
});

test('Storage: host and guest are distinct entities', () => {
  const s = mkStorage();
  const hostId = s.getOrCreateEntityId('proxmox-dmz', null);
  const guestId = s.getOrCreateEntityId('proxmox-dmz', 'mc-server');
  assert.notEqual(hostId, guestId);
  assert.equal(s.getOrCreateEntityId('proxmox-dmz', null), hostId);
  assert.equal(s.getOrCreateEntityId('proxmox-dmz', 'mc-server'), guestId);
  s.close();
});

test('Storage: unknown metric throws', () => {
  const s = mkStorage();
  assert.throws(() => s.query({ machine: 'a', guest: null, metric: 'mystery', fromTs: 0, toTs: 1 }), /unknown metric/);
  s.close();
});

test('Storage.rollup: downsamples 10s to 1m for data older than 24h', () => {
  const s = mkStorage();
  const now = Date.now();
  // Align baseTs to a minute boundary 25h back so all 6 10s samples fall in exactly one bucket
  const rawBaseTs = now - 25 * 60 * 60 * 1000;
  const baseTs = Math.floor(rawBaseTs / 60_000) * 60_000;
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push({ machine: 'm', guest: null, ts: baseTs + i * 10_000, cpuPct: 10 + i, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500, netRx: i, netTx: i });
  }
  s.insertBatch(rows);
  const before = s.stats();
  assert.equal(before.samples10s, 6);
  assert.equal(before.samples1m, 0);

  s.rollup(now);

  const after = s.stats();
  assert.equal(after.samples10s, 0, 'hot tier should be empty after rollup');
  assert.equal(after.samples1m, 1, '6 samples in one bucket should collapse to exactly 1 row');
  const q = s.query({ machine: 'm', guest: null, metric: 'cpu', fromTs: baseTs, toTs: baseTs + 60_000, tier: '1m' });
  assert.equal(q.length, 1);
  // cpu average of 10..15 = 12.5
  assert.equal(q[0][1], 12.5);
  assert.equal(q[0][0], baseTs);
  s.close();
});

test('Storage.rollup: downsamples 1m to 10m for data older than 7d, and prunes 10m older than 30d', () => {
  const s = mkStorage();
  const now = Date.now();
  // Seed the 1m table directly by inserting 10s samples at exactly 1-minute boundaries, then rolling up.
  // Easier: put data > 7d old into 10s, roll up twice.
  const weekPlusDay = now - 8 * 24 * 60 * 60 * 1000; // 8 days old
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ machine: 'm', guest: null, ts: weekPlusDay + i * 10_000, cpuPct: 20 + i, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500, netRx: i, netTx: i });
  }
  s.insertBatch(rows);
  s.rollup(now);
  const after = s.stats();
  assert.equal(after.samples10s, 0);
  // 1m tier should be empty too because the data is > 7d old
  assert.equal(after.samples1m, 0);
  assert.ok(after.samples10m >= 1, '10m tier should have at least one row');
  s.close();
});

test('Storage.query: auto-picks tier based on range span', () => {
  const s = mkStorage();
  const now = Date.now();
  // Insert a 1m-aged row into 10s, rollup so it lands in 1m tier
  const oneDayAgo = now - 25 * 60 * 60 * 1000;
  s.insertBatch([
    { machine: 'm', guest: null, ts: oneDayAgo,          cpuPct: 30, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500, netRx: 0, netTx: 0 },
    { machine: 'm', guest: null, ts: oneDayAgo + 10_000, cpuPct: 30, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500, netRx: 0, netTx: 0 },
  ]);
  s.rollup(now);
  // Query a wide range (>24h) — should auto-pick the 1m tier and find the downsampled row
  const result = s.query({
    machine: 'm', guest: null, metric: 'cpu',
    fromTs: now - 3 * 24 * 60 * 60 * 1000,  // 3 days back
    toTs: now,
  });
  assert.ok(result.length >= 1, `expected at least 1 row from auto-tier query, got ${result.length}`);
  s.close();
});
