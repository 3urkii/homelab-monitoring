const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTvConfig, trackedEntitiesFromTv, resolveShortcut, buildTvSnapshot } = require('../lib/tv.js');

const goodConfig = {
  powerEntity: 'media_player.da_tele_2',
  volumeEntity: 'media_player.vizio_tv_2545_television',
  shortcuts: [
    { id: 'plex', label: 'plex', icon: 'plex.svg', entity: 'media_player.da_tele_2', source: 'Plex' },
    { id: 'pc',   label: 'pc',   icon: 'pc.svg',   entity: 'media_player.vizio_tv_2545_television', source: 'win-pc' },
  ],
};

test('validateTvConfig: good config passes', () => {
  assert.deepEqual(validateTvConfig(goodConfig, true), []);
});

test('validateTvConfig: requires homeAssistant', () => {
  const errs = validateTvConfig(goodConfig, false);
  assert.ok(errs.some((e) => /requires homeAssistant/.test(e)));
});

test('validateTvConfig: rejects non-media_player powerEntity', () => {
  const cfg = { ...goodConfig, powerEntity: 'switch.tv' };
  const errs = validateTvConfig(cfg, true);
  assert.ok(errs.some((e) => /powerEntity must be a media_player/.test(e)));
});

test('validateTvConfig: rejects non-media_player volumeEntity', () => {
  const cfg = { ...goodConfig, volumeEntity: 'light.tv' };
  const errs = validateTvConfig(cfg, true);
  assert.ok(errs.some((e) => /volumeEntity must be a media_player/.test(e)));
});

test('validateTvConfig: rejects empty shortcuts', () => {
  const cfg = { ...goodConfig, shortcuts: [] };
  const errs = validateTvConfig(cfg, true);
  assert.ok(errs.some((e) => /shortcuts must be a non-empty array/.test(e)));
});

test('validateTvConfig: rejects duplicate shortcut id', () => {
  const cfg = { ...goodConfig, shortcuts: [
    { id: 'a', label: 'a', entity: 'media_player.x', source: 'A' },
    { id: 'a', label: 'b', entity: 'media_player.x', source: 'B' },
  ]};
  const errs = validateTvConfig(cfg, true);
  assert.ok(errs.some((e) => /duplicate/.test(e)));
});

test('validateTvConfig: rejects non-media_player shortcut entity', () => {
  const cfg = { ...goodConfig, shortcuts: [
    { id: 'a', label: 'a', entity: 'switch.x', source: 'A' },
  ]};
  const errs = validateTvConfig(cfg, true);
  assert.ok(errs.some((e) => /shortcuts\[0\].entity must be a media_player/.test(e)));
});

test('validateTvConfig: missing shortcut fields', () => {
  const cfg = { ...goodConfig, shortcuts: [{ id: '', label: '', entity: '', source: '' }] };
  const errs = validateTvConfig(cfg, true);
  assert.ok(errs.length >= 4);
});

test('trackedEntitiesFromTv: dedupes entities', () => {
  const set = trackedEntitiesFromTv(goodConfig);
  assert.equal(set.size, 2);
  assert.ok(set.has('media_player.da_tele_2'));
  assert.ok(set.has('media_player.vizio_tv_2545_television'));
});

test('trackedEntitiesFromTv: null tv -> empty set', () => {
  const set = trackedEntitiesFromTv(null);
  assert.equal(set.size, 0);
});

test('resolveShortcut: returns entity + source for known id', () => {
  const out = resolveShortcut(goodConfig.shortcuts, 'plex');
  assert.deepEqual(out, { entity: 'media_player.da_tele_2', source: 'Plex' });
});

test('resolveShortcut: unknown id throws', () => {
  assert.throws(() => resolveShortcut(goodConfig.shortcuts, 'nope'), /unknown shortcut/);
});

test('buildTvSnapshot: connected, marks active source', () => {
  const fakeHa = {
    isConnected: () => true,
    getMediaPlayerState: (id) => ({
      'media_player.da_tele_2': { on: true, source: 'Plex', is_volume_muted: false, volume_level: 0.4 },
      'media_player.vizio_tv_2545_television': { on: true, source: 'win-pc', is_volume_muted: true, volume_level: 0.3 },
    }[id] ?? null),
  };
  const snap = buildTvSnapshot(goodConfig, fakeHa);
  assert.equal(snap.connected, true);
  assert.equal(snap.power.on, true);
  assert.equal(snap.power.source, 'Plex');
  assert.equal(snap.volume.muted, true);
  assert.equal(snap.volume.level, 0.3);
  const sc = (id) => snap.shortcuts.find((s) => s.id === id);
  assert.equal(sc('plex').active, true);
  assert.equal(sc('pc').active, true);
});

test('buildTvSnapshot: disconnected -> connected=false, shortcuts inactive', () => {
  const fakeHa = { isConnected: () => false, getMediaPlayerState: () => null };
  const snap = buildTvSnapshot(goodConfig, fakeHa);
  assert.equal(snap.connected, false);
  assert.equal(snap.power, null);
  assert.equal(snap.volume, null);
  assert.equal(snap.shortcuts.every((s) => s.active === false), true);
});

test('buildTvSnapshot: connected but state cache empty -> nulls', () => {
  const fakeHa = { isConnected: () => true, getMediaPlayerState: () => null };
  const snap = buildTvSnapshot(goodConfig, fakeHa);
  assert.equal(snap.connected, true);
  assert.equal(snap.power, null);
  assert.equal(snap.volume, null);
});

test('validateTvConfig: missing required fields yields specific errors', () => {
  const errs = validateTvConfig({}, true);
  assert.ok(errs.some((e) => /powerEntity/.test(e)));
  assert.ok(errs.some((e) => /volumeEntity/.test(e)));
  assert.ok(errs.some((e) => /shortcuts must be a non-empty/.test(e)));
});
