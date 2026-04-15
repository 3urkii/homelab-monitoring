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

test('Storage: insert and list alert events', () => {
  const s = mkStorage();
  s.insertAlertEvent({ ts: 1000, machine: 'm1', guest: null,  metric: 'cpu', kind: 'firing',   value: 95, threshold: 90, message: 'cpu hot' });
  s.insertAlertEvent({ ts: 2000, machine: 'm1', guest: 'g1',  metric: 'mem', kind: 'firing',   value: 92, threshold: 90, message: 'mem hot' });
  s.insertAlertEvent({ ts: 3000, machine: 'm1', guest: null,  metric: 'cpu', kind: 'resolved', value: 40, threshold: 90, message: 'cpu ok' });

  // all events, newest first
  const all = s.listAlertEvents({ limit: 10 });
  assert.equal(all.length, 3);
  assert.equal(all[0].ts, 3000, 'newest first');
  assert.equal(all[2].ts, 1000);

  // machine+guest filter: exactly the g1 mem event
  const filtered = s.listAlertEvents({ limit: 10, machine: 'm1', guest: 'g1' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].metric, 'mem');

  // machine-only filter: host-level events only (guest IS NULL) — must NOT include g1
  const hostOnly = s.listAlertEvents({ limit: 10, machine: 'm1' });
  assert.equal(hostOnly.length, 2, 'machine-only should return only host-level (guest IS NULL) rows');
  assert.ok(hostOnly.every(r => r.guest === null), 'all rows must have guest === null');
  assert.ok(hostOnly.every(r => r.metric === 'cpu'), 'both host events are cpu');

  // cross-machine isolation: m2 events must not appear in m1 results
  s.insertAlertEvent({ ts: 4000, machine: 'm2', guest: null, metric: 'cpu', kind: 'firing', value: 80, threshold: 75, message: 'm2 cpu' });
  const m1After = s.listAlertEvents({ limit: 10, machine: 'm1' });
  assert.equal(m1After.length, 2, 'm2 event must not bleed into m1 machine-only results');
  assert.ok(m1After.every(r => r.machine === 'm1'), 'all rows must belong to m1');

  s.close();
});

test('Storage.listActiveFiring: returns keys whose latest event is firing', () => {
  const s = mkStorage();
  // key A: firing then resolved → should NOT appear
  s.insertAlertEvent({ ts: 100, machine: 'a', guest: null, metric: 'cpu', kind: 'firing',   value: 95, threshold: 90, message: '' });
  s.insertAlertEvent({ ts: 200, machine: 'a', guest: null, metric: 'cpu', kind: 'resolved', value: 40, threshold: 90, message: '' });
  // key B: firing only → should appear
  s.insertAlertEvent({ ts: 150, machine: 'b', guest: 'g', metric: 'mem',  kind: 'firing',   value: 95, threshold: 90, message: '' });
  // key C: firing, resolved, firing → should appear (latest is firing)
  s.insertAlertEvent({ ts: 300, machine: 'c', guest: null, metric: 'disk', kind: 'firing',   value: 95, threshold: 90, message: '' });
  s.insertAlertEvent({ ts: 400, machine: 'c', guest: null, metric: 'disk', kind: 'resolved', value: 40, threshold: 90, message: '' });
  s.insertAlertEvent({ ts: 500, machine: 'c', guest: null, metric: 'disk', kind: 'firing',   value: 95, threshold: 90, message: '' });

  const active = s.listActiveFiring();
  const keys = active.map((a) => `${a.machine}/${a.guest ?? '_host'}/${a.metric}`).sort();
  assert.deepEqual(keys, ['b/g/mem', 'c/_host/disk']);
  const bRow = active.find((a) => a.machine === 'b');
  assert.equal(bRow.ts, 150);
  assert.equal(bRow.value, 95);
  s.close();
});

test('Storage.pruneAlertEvents: keeps last 1000 or last 90d, whichever is larger', () => {
  const s = mkStorage();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  // 5 ancient events (> 90d old, beyond the 1000 cap)
  for (let i = 0; i < 5; i++) {
    s.insertAlertEvent({ ts: now - 200 * day + i, machine: 'old', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: '' });
  }
  // 3 recent events
  for (let i = 0; i < 3; i++) {
    s.insertAlertEvent({ ts: now - i * 1000, machine: 'new', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: '' });
  }
  // Total rows = 8, well under 1000, so 1000-cap says keep all. But the 5 old ones are > 90d AND we have fewer than 1000 rows. Rule: keep last 1000 OR last 90d, whichever set is larger. 1000-cap keeps all 8; 90d-cap keeps only 3. Union = all 8. Nothing pruned.
  s.pruneAlertEvents(now);
  assert.equal(s.listAlertEvents({ limit: 1000 }).length, 8);

  // Now force the row count above 1000 by inserting many recent rows.
  for (let i = 0; i < 1200; i++) {
    s.insertAlertEvent({ ts: now - 10 * day - i, machine: 'bulk', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: '' });
  }
  s.pruneAlertEvents(now);
  const remaining = s.listAlertEvents({ limit: 5000 });
  // Rule: keep union of (last 1000 rows) and (last 90d). The 5 ancient rows are > 90d AND fall outside the 1000 newest → pruned.
  assert.ok(remaining.every((r) => r.machine !== 'old'), 'ancient rows should be pruned');
  assert.ok(remaining.length >= 1000, 'at least 1000 newest rows retained');
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
