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
