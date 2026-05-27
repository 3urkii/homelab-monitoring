const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseLights,
  parseLightState,
  parseSceneState,
  parseMediaPlayerState,
  buildEntityToAreaMap,
  isLightOrScene,
  isTracked,
  pctToBrightness,
  brightnessToPct,
  lightSupportsColor,
} = require('../lib/home_assistant.js');

const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const states = fx('ha-states.json');
const areas = fx('ha-areas.json');
const devices = fx('ha-devices.json');
const entities = fx('ha-entities.json');

test('parseLightState: on with rgb and brightness', () => {
  const s = states.find((x) => x.entity_id === 'light.living_room_lamp');
  const out = parseLightState(s);
  assert.equal(out.entity_id, 'light.living_room_lamp');
  assert.equal(out.name, 'Living Room Lamp');
  assert.equal(out.on, true);
  assert.equal(out.reachable, true);
  assert.equal(out.brightness_pct, 75);
  assert.deepEqual(out.rgb, [255, 200, 120]);
  assert.equal(out.supports_color, true);
});

test('parseLightState: off light reports brightness 0', () => {
  const s = states.find((x) => x.entity_id === 'light.living_room_ceiling');
  const out = parseLightState(s);
  assert.equal(out.on, false);
  assert.equal(out.brightness_pct, 0);
  assert.equal(out.rgb, null);
  assert.equal(out.supports_color, false);
});

test('parseLightState: unavailable -> reachable=false', () => {
  const s = states.find((x) => x.entity_id === 'light.bedroom_lamp');
  const out = parseLightState(s);
  assert.equal(out.reachable, false);
  assert.equal(out.supports_color, false);
});

test('parseSceneState: name and entity_id', () => {
  const s = states.find((x) => x.entity_id === 'scene.living_room_movie');
  const out = parseSceneState(s);
  assert.equal(out.entity_id, 'scene.living_room_movie');
  assert.equal(out.name, 'Movie Time');
});

test('buildEntityToAreaMap: resolves area via device, then direct override', () => {
  const map = buildEntityToAreaMap(entities, devices);
  assert.equal(map.get('light.living_room_lamp'), 'living_room');
  assert.equal(map.get('light.bedroom_lamp'), 'bedroom');
  assert.equal(map.get('light.orphan_strip'), null);
  assert.equal(map.get('scene.living_room_movie'), 'living_room');
});

test('parseLights: groups by room and sorts', () => {
  const out = parseLights(states, areas, devices, entities);
  const roomNames = out.rooms.map((r) => r.name);
  assert.deepEqual(roomNames, ['Bedroom', 'Living Room']);

  const lr = out.rooms.find((r) => r.id === 'living_room');
  const lrLightNames = lr.lights.map((l) => l.name);
  assert.deepEqual(lrLightNames, ['Living Room Ceiling', 'Living Room Lamp']);
  assert.deepEqual(lr.scenes.map((s) => s.name), ['Movie Time']);

  const br = out.rooms.find((r) => r.id === 'bedroom');
  assert.deepEqual(br.lights.map((l) => l.name), ['Bedroom Lamp']);
  assert.deepEqual(br.scenes.map((s) => s.name), ['Sleep']);
});

test('parseLights: lights/scenes without area land in unassigned', () => {
  const out = parseLights(states, areas, devices, entities);
  assert.deepEqual(out.unassigned.lights.map((l) => l.entity_id), ['light.orphan_strip']);
  assert.deepEqual(out.unassigned.scenes.map((s) => s.entity_id), ['scene.orphan_scene']);
});

test('parseLights: only includes scenes labeled "dashboard"', () => {
  const out = parseLights(states, areas, devices, entities);
  const allSceneIds = out.rooms.flatMap((r) => r.scenes.map((s) => s.entity_id))
    .concat(out.unassigned.scenes.map((s) => s.entity_id));
  assert.ok(allSceneIds.includes('scene.living_room_movie'));
  assert.ok(allSceneIds.includes('scene.bedroom_sleep'));
  assert.ok(allSceneIds.includes('scene.orphan_scene'));
  assert.ok(!allSceneIds.includes('scene.living_room_party'));
  assert.ok(!allSceneIds.includes('scene.orphan_unlabeled'));
});

test('parseLights: ignores non-light/scene entities', () => {
  const out = parseLights(states, areas, devices, entities);
  const allLightIds = out.rooms.flatMap((r) => r.lights.map((l) => l.entity_id))
    .concat(out.unassigned.lights.map((l) => l.entity_id));
  assert.ok(!allLightIds.includes('switch.kitchen_kettle'));
  assert.ok(!allLightIds.includes('sensor.living_room_temp'));
});

test('isLightOrScene', () => {
  assert.equal(isLightOrScene('light.foo'), true);
  assert.equal(isLightOrScene('scene.bar'), true);
  assert.equal(isLightOrScene('switch.baz'), false);
  assert.equal(isLightOrScene(''), false);
  assert.equal(isLightOrScene(undefined), false);
});

test('pctToBrightness clamps to 0..255 and rounds', () => {
  assert.equal(pctToBrightness(0), 0);
  assert.equal(pctToBrightness(100), 255);
  assert.equal(pctToBrightness(50), 128);
  assert.equal(pctToBrightness(-10), 0);
  assert.equal(pctToBrightness(150), 255);
  assert.equal(pctToBrightness(null), null);
});

test('brightnessToPct rounds', () => {
  assert.equal(brightnessToPct(0), 0);
  assert.equal(brightnessToPct(255), 100);
  assert.equal(brightnessToPct(128), 50);
  assert.equal(brightnessToPct(null), null);
});

test('lightSupportsColor: detects color-capable modes', () => {
  assert.equal(lightSupportsColor({ supported_color_modes: ['hs'] }), true);
  assert.equal(lightSupportsColor({ supported_color_modes: ['rgb', 'color_temp'] }), true);
  assert.equal(lightSupportsColor({ supported_color_modes: ['xy'] }), true);
  assert.equal(lightSupportsColor({ supported_color_modes: ['color_temp'] }), false);
  assert.equal(lightSupportsColor({ supported_color_modes: ['onoff', 'brightness'] }), false);
  assert.equal(lightSupportsColor({}), false);
  assert.equal(lightSupportsColor(undefined), false);
});

test('parseMediaPlayerState: on with source, volume, mute', () => {
  const s = states.find((x) => x.entity_id === 'media_player.da_tele_2');
  const out = parseMediaPlayerState(s);
  assert.equal(out.entity_id, 'media_player.da_tele_2');
  assert.equal(out.name, 'Living Room TV');
  assert.equal(out.state, 'on');
  assert.equal(out.on, true);
  assert.equal(out.source, 'Plex');
  assert.deepEqual(out.source_list, ['Plex', 'YouTube', 'Home']);
  assert.equal(out.volume_level, 0.42);
  assert.equal(out.is_volume_muted, false);
});

test('parseMediaPlayerState: muted, vizio', () => {
  const s = states.find((x) => x.entity_id === 'media_player.vizio_tv_2545_television');
  const out = parseMediaPlayerState(s);
  assert.equal(out.is_volume_muted, true);
  assert.equal(out.source, 'scenescapes');
});

test('parseMediaPlayerState: off', () => {
  const s = states.find((x) => x.entity_id === 'media_player.tv_off');
  const out = parseMediaPlayerState(s);
  assert.equal(out.state, 'off');
  assert.equal(out.on, false);
  assert.equal(out.source, null);
  assert.deepEqual(out.source_list, []);
  assert.equal(out.volume_level, null);
  assert.equal(out.is_volume_muted, false);
});

test('parseMediaPlayerState: playing/paused count as on', () => {
  const out1 = parseMediaPlayerState({ entity_id: 'media_player.x', state: 'playing', attributes: {} });
  const out2 = parseMediaPlayerState({ entity_id: 'media_player.x', state: 'paused', attributes: {} });
  assert.equal(out1.on, true);
  assert.equal(out2.on, true);
});

test('isTracked: lights and scenes always tracked', () => {
  assert.equal(isTracked('light.foo', new Set()), true);
  assert.equal(isTracked('scene.bar', new Set()), true);
});

test('isTracked: media_player tracked only when in set', () => {
  const set = new Set(['media_player.da_tele_2']);
  assert.equal(isTracked('media_player.da_tele_2', set), true);
  assert.equal(isTracked('media_player.other', set), false);
  assert.equal(isTracked('media_player.other', new Set()), false);
});

test('isTracked: other domains never tracked', () => {
  assert.equal(isTracked('switch.kitchen', new Set(['switch.kitchen'])), false);
  assert.equal(isTracked('', new Set()), false);
  assert.equal(isTracked(undefined, new Set()), false);
});
