const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertManager } = require('../lib/alerts.js');
const { Storage } = require('../lib/storage.js');

function mkConfig(overrides = []) {
  return {
    ntfy: { url: 'https://ntfy.sh/fake', firingPriority: 'high', resolvedPriority: 'default', firingTags: ['warning'], resolvedTags: ['white_check_mark'] },
    defaults: { cpuPct: 90, memPct: 90, diskPct: 90, forMs: 60_000, reachability: true },
    overrides,
  };
}

test('AlertManager.resolveRule: guest override beats machine override beats defaults', () => {
  const mgr = new AlertManager({
    config: mkConfig([
      { machine: 'a',                       cpuPct: 80 },
      { machine: 'a', guest: 'g1', cpuPct: 70 },
    ]),
    storage: new Storage(':memory:'),
    fetch: async () => ({ ok: true }),
  });
  assert.equal(mgr.resolveRule('a', null).cpuPct, 80, 'machine-level override applies to host');
  assert.equal(mgr.resolveRule('a', 'g1').cpuPct, 70, 'guest override wins');
  assert.equal(mgr.resolveRule('a', 'g2').cpuPct, 80, 'fallback to machine override');
  assert.equal(mgr.resolveRule('b', null).cpuPct, 90, 'fallback to defaults');
  // Non-overridden fields come from defaults
  assert.equal(mgr.resolveRule('a', 'g1').memPct, 90);
});

function mkState(machine, host) {
  return { lastPoll: null, globalStatus: 'up', machines: { [machine]: { type: 'proxmox', status: 'up', host, guests: [] } } };
}

test('AlertManager.evaluate: cpu ok→pending→firing→resolved with forMs gate', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  const hot = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };

  // t=0: cpu hot, ok→pending, no POST
  await mgr.evaluate(mkState('m', hot), 0);
  assert.equal(calls.length, 0);
  // t=30s: still hot, still pending
  await mgr.evaluate(mkState('m', hot), 30_000);
  assert.equal(calls.length, 0);
  // t=60s: forMs elapsed, pending→firing, POST
  await mgr.evaluate(mkState('m', hot), 60_000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /FIRING.*m.*cpu/);
  assert.equal(calls[0].opts.headers.Priority, 'high');
  // t=70s: still firing, no new POST
  await mgr.evaluate(mkState('m', hot), 70_000);
  assert.equal(calls.length, 1);
  // t=80s: cool, firing→ok, resolved POST
  await mgr.evaluate(mkState('m', cold), 80_000);
  assert.equal(calls.length, 2);
  assert.match(calls[1].opts.headers.Title, /OK.*m.*cpu/);
  assert.equal(calls[1].opts.headers.Priority, 'default');
  storage.close();
});

test('AlertManager.evaluate: condition flaps below forMs → no notification', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot),  0);
  await mgr.evaluate(mkState('m', hot),  30_000);
  await mgr.evaluate(mkState('m', cold), 40_000);
  assert.equal(calls.length, 0);
  storage.close();
});

test('AlertManager.evaluate: reachability fires immediately on scrape failure', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  // up
  await mgr.evaluate(mkState('m', { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 }), 0);
  assert.equal(calls.length, 0);
  // down — fires with no forMs delay
  const downState = { lastPoll: null, globalStatus: 'down', machines: { m: { type: 'proxmox', status: 'down', host: null, guests: [], error: 'boom' } } };
  await mgr.evaluate(downState, 1000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /FIRING.*m.*reachability/);
  // still down, no new POST
  await mgr.evaluate(downState, 2000);
  assert.equal(calls.length, 1);
  // recovered
  await mgr.evaluate(mkState('m', { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 }), 3000);
  assert.equal(calls.length, 2);
  assert.match(calls[1].opts.headers.Title, /OK.*m.*reachability/);
  storage.close();
});

test('AlertManager.evaluate: transitions persist to storage', async () => {
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async () => ({ ok: true }),
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot),  0);
  await mgr.evaluate(mkState('m', hot),  60_000);
  await mgr.evaluate(mkState('m', cold), 120_000);
  const events = storage.listAlertEvents({ limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[1].kind, 'firing');
  assert.equal(events[0].kind, 'resolved');
  assert.equal(events[1].value, 95);
  assert.equal(events[1].threshold, 90);
  storage.close();
});

test('AlertManager.evaluate: ntfy failure does not prevent event row or block next call', async () => {
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async () => { throw new Error('network'); },
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot), 0);
  await mgr.evaluate(mkState('m', hot), 60_000);
  const events = storage.listAlertEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'firing');
  storage.close();
});

test('AlertManager: rehydrates firing state from storage on construct', async () => {
  const storage = new Storage(':memory:');
  // Seed: a firing event with no later resolved for m/_host/cpu
  storage.insertAlertEvent({ ts: 1000, machine: 'm', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: 'cpu hot' });

  const calls = [];
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });

  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };

  // First evaluate with condition still hot → must NOT re-fire
  await mgr.evaluate(mkState('m', hot), 10_000);
  assert.equal(calls.length, 0);

  // Cool down → resolved POST fires
  await mgr.evaluate(mkState('m', cold), 11_000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /OK.*m.*cpu/);
  storage.close();
});

test('AlertManager.getActive: returns currently-firing rules from in-memory state', async () => {
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async () => ({ ok: true }),
  });
  const hot = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot), 0);
  await mgr.evaluate(mkState('m', hot), 60_000);
  const active = mgr.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].machine, 'm');
  assert.equal(active[0].metric, 'cpu');
  assert.equal(active[0].value, 95);
  assert.equal(active[0].since, 60_000);
  storage.close();
});
