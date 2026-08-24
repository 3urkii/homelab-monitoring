const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_COMMAND_ALLOWLIST,
  validateMinecraftConfig,
  normalizeServersConfig,
  validateServersConfig,
  checkCommand,
  isValidUsername,
  stripColorCodes,
  parseWhitelistList,
  classifyWhitelistResponse,
  parseSseChunk,
} = require('../lib/minecraft.js');

const goodConfig = {
  rcon: { host: '10.0.20.87', port: 25575, password: 'a-long-random-string' },
  logAgent: { url: 'http://10.0.20.87:8127' },
};

const goodPlan = { url: 'http://10.0.20.87:8804', machine: 'proxmox-dmz', guest: 'mc-server' };

test('validateMinecraftConfig: good config passes', () => {
  assert.deepEqual(validateMinecraftConfig(goodConfig), []);
});

test('validateMinecraftConfig: logAgent and commandAllowlist are optional', () => {
  const cfg = { rcon: goodConfig.rcon };
  assert.deepEqual(validateMinecraftConfig(cfg), []);
  assert.deepEqual(
    validateMinecraftConfig({ ...cfg, commandAllowlist: ['whitelist', 'list'] }),
    [],
  );
});

test('validateMinecraftConfig: rejects non-object', () => {
  assert.ok(validateMinecraftConfig(null).some((e) => /must be an object/.test(e)));
});

test('validateMinecraftConfig: missing rcon', () => {
  const errs = validateMinecraftConfig({});
  assert.ok(errs.some((e) => /minecraft\.rcon must be an object/.test(e)));
});

test('validateMinecraftConfig: custom prefix used in error messages', () => {
  const errs = validateMinecraftConfig({}, 'servers[1].minecraft');
  assert.ok(errs.some((e) => /^servers\[1\]\.minecraft\.rcon must be an object/.test(e)));
});

test('validateMinecraftConfig: REPLACE_ME host and password rejected', () => {
  const cfg = { rcon: { host: 'REPLACE_ME', port: 25575, password: 'REPLACE_ME' } };
  const errs = validateMinecraftConfig(cfg);
  assert.ok(errs.some((e) => /rcon\.host must be set/.test(e)));
  assert.ok(errs.some((e) => /rcon\.password must be set/.test(e)));
});

test('validateMinecraftConfig: bad ports rejected', () => {
  for (const port of [0, 70000, 25575.5, '25575', undefined]) {
    const cfg = { rcon: { ...goodConfig.rcon, port } };
    assert.ok(
      validateMinecraftConfig(cfg).some((e) => /rcon\.port must be an integer/.test(e)),
      `port ${port} should be rejected`,
    );
  }
});

test('validateMinecraftConfig: bad logAgent rejected', () => {
  const errs = validateMinecraftConfig({ rcon: goodConfig.rcon, logAgent: {} });
  assert.ok(errs.some((e) => /logAgent\.url must be set/.test(e)));
});

test('validateMinecraftConfig: bad commandAllowlist entries rejected', () => {
  for (const allowlist of [[], ['whitelist add'], ['/op'], [''], [42]]) {
    const cfg = { rcon: goodConfig.rcon, commandAllowlist: allowlist };
    assert.ok(
      validateMinecraftConfig(cfg).some((e) => /commandAllowlist/.test(e)),
      `${JSON.stringify(allowlist)} should be rejected`,
    );
  }
});

test('normalizeServersConfig: legacy plan+minecraft migrates to one-element servers array', () => {
  const cfg = { server: { port: 3000 }, plan: { ...goodPlan }, minecraft: { rcon: goodConfig.rcon } };
  normalizeServersConfig(cfg);
  assert.equal(cfg.plan, undefined);
  assert.equal(cfg.minecraft, undefined);
  assert.equal(cfg.servers.length, 1);
  assert.equal(cfg.servers[0].id, 'default');
  assert.equal(cfg.servers[0].label, 'mc-server');
  assert.deepEqual(cfg.servers[0].plan, goodPlan);
  assert.deepEqual(cfg.servers[0].minecraft, { rcon: goodConfig.rcon });
  assert.deepEqual(validateServersConfig(cfg.servers), []);
});

test('normalizeServersConfig: legacy plan without minecraft migrates without a minecraft block', () => {
  const cfg = { plan: { ...goodPlan } };
  normalizeServersConfig(cfg);
  assert.equal(cfg.servers[0].minecraft, undefined);
});

test('normalizeServersConfig: existing servers array passes through untouched', () => {
  const servers = [{ id: 'vanilla', label: 'Vanilla SMP', plan: { ...goodPlan } }];
  const cfg = { servers };
  normalizeServersConfig(cfg);
  assert.equal(cfg.servers, servers);
  assert.equal(cfg.servers.length, 1);
});

test('normalizeServersConfig: no plan and no servers is a no-op', () => {
  const cfg = { server: { port: 3000 } };
  normalizeServersConfig(cfg);
  assert.equal(cfg.servers, undefined);
});

test('normalizeServersConfig: tolerates non-object config', () => {
  assert.equal(normalizeServersConfig(null), null);
  assert.equal(normalizeServersConfig(undefined), undefined);
});

test('validateServersConfig: good multi-server config passes', () => {
  const servers = [
    { id: 'vanilla', label: 'Vanilla SMP', plan: { ...goodPlan }, minecraft: { rcon: goodConfig.rcon } },
    {
      id: 'soulrend',
      label: 'Soulrend',
      plan: { url: 'http://10.0.20.88:8805', machine: 'proxmox-dmz', guest: 'soulrend-srv' },
      minecraft: {
        rcon: { host: '10.0.20.88', port: 25576, password: 'another-long-string' },
        commandAllowlist: ['whitelist', 'list', 'say', 'tps', 'forge'],
      },
    },
  ];
  assert.deepEqual(validateServersConfig(servers), []);
});

test('validateServersConfig: rejects non-array and empty array', () => {
  for (const servers of [undefined, null, {}, 'x', []]) {
    assert.ok(
      validateServersConfig(servers).some((e) => /non-empty array/.test(e)),
      `${JSON.stringify(servers)} should be rejected`,
    );
  }
});

test('validateServersConfig: invalid ids rejected', () => {
  for (const id of [undefined, null, 42, '', 'Bad', 'has space', 'dot.dot', 'slash/y']) {
    const errs = validateServersConfig([{ id, plan: { ...goodPlan } }]);
    assert.ok(
      errs.some((e) => /id must be a URL-safe slug/.test(e)),
      `id ${JSON.stringify(id)} should be rejected`,
    );
  }
});

test('validateServersConfig: duplicate ids rejected', () => {
  const errs = validateServersConfig([
    { id: 'vanilla', plan: { ...goodPlan } },
    { id: 'vanilla', plan: { ...goodPlan } },
  ]);
  assert.ok(errs.some((e) => /servers\[1\]\.id 'vanilla' is duplicated/.test(e)));
});

test('validateServersConfig: plan sub-object required and validated', () => {
  assert.ok(validateServersConfig([{ id: 'a' }]).some((e) => /servers\[0\]\.plan must be an object/.test(e)));
  const errs = validateServersConfig([
    { id: 'a', plan: { url: 'http://REPLACE_ME:8804', machine: 'REPLACE_ME', guest: 'REPLACE_ME' } },
  ]);
  assert.ok(errs.some((e) => /servers\[0\]\.plan\.url must be a non-empty URL/.test(e)));
  assert.ok(errs.some((e) => /servers\[0\]\.plan\.machine is required/.test(e)));
  assert.ok(errs.some((e) => /servers\[0\]\.plan\.guest is required/.test(e)));
});

test('validateServersConfig: minecraft sub-errors carry the servers[i] prefix', () => {
  const errs = validateServersConfig([
    { id: 'a', plan: { ...goodPlan }, minecraft: { rcon: { host: 'REPLACE_ME', port: 0, password: '' } } },
  ]);
  assert.ok(errs.some((e) => /^servers\[0\]\.minecraft\.rcon\.host must be set/.test(e)));
  assert.ok(errs.some((e) => /^servers\[0\]\.minecraft\.rcon\.port must be an integer/.test(e)));
});

test('validateServersConfig: bad labels rejected', () => {
  for (const label of ['', 42, {}]) {
    const errs = validateServersConfig([{ id: 'a', label, plan: { ...goodPlan } }]);
    assert.ok(
      errs.some((e) => /servers\[0\]\.label must be a non-empty string/.test(e)),
      `label ${JSON.stringify(label)} should be rejected`,
    );
  }
});

test('checkCommand: allows allowlisted command with args', () => {
  const res = checkCommand('whitelist add Notch', DEFAULT_COMMAND_ALLOWLIST);
  assert.deepEqual(res, { ok: true, command: 'whitelist add Notch' });
});

test('checkCommand: strips one leading slash', () => {
  const res = checkCommand('/list', DEFAULT_COMMAND_ALLOWLIST);
  assert.deepEqual(res, { ok: true, command: 'list' });
});

test('checkCommand: first token matched case-insensitively, args keep case', () => {
  const res = checkCommand('TPS', DEFAULT_COMMAND_ALLOWLIST);
  assert.equal(res.ok, true);
  const res2 = checkCommand('Say Hello World', DEFAULT_COMMAND_ALLOWLIST);
  assert.deepEqual(res2, { ok: true, command: 'Say Hello World' });
});

test('checkCommand: rejects command not in allowlist', () => {
  for (const cmd of ['op steve', '/stop', 'ban griefer', 'execute as @a run kill']) {
    const res = checkCommand(cmd, DEFAULT_COMMAND_ALLOWLIST);
    assert.equal(res.ok, false, `${cmd} should be rejected`);
    assert.match(res.error, /not in the allowlist/);
  }
});

test('checkCommand: rejects empty, non-string, oversized, control chars', () => {
  assert.equal(checkCommand('', DEFAULT_COMMAND_ALLOWLIST).ok, false);
  assert.equal(checkCommand('   ', DEFAULT_COMMAND_ALLOWLIST).ok, false);
  assert.equal(checkCommand('/', DEFAULT_COMMAND_ALLOWLIST).ok, false);
  assert.equal(checkCommand(42, DEFAULT_COMMAND_ALLOWLIST).ok, false);
  assert.equal(checkCommand('list ' + 'x'.repeat(300), DEFAULT_COMMAND_ALLOWLIST).ok, false);
  assert.equal(checkCommand('list\nstop', DEFAULT_COMMAND_ALLOWLIST).ok, false);
});

test('checkCommand: custom allowlist replaces default', () => {
  assert.equal(checkCommand('list', ['say']).ok, false);
  assert.equal(checkCommand('say hi', ['say']).ok, true);
});

test('isValidUsername: matrix', () => {
  for (const name of ['abc', 'Notch', 'newbie_steve', 'a'.repeat(16), 'A1_b2']) {
    assert.equal(isValidUsername(name), true, `${name} should be valid`);
  }
  for (const name of ['ab', 'a'.repeat(17), 'bad name', 'bad-name', 'name!', '', null, 42]) {
    assert.equal(isValidUsername(name), false, `${String(name)} should be invalid`);
  }
});

test('stripColorCodes: removes section-sign codes', () => {
  assert.equal(stripColorCodes('§aGreen §lBold§r plain'), 'Green Bold plain');
  assert.equal(stripColorCodes('no codes'), 'no codes');
  assert.equal(stripColorCodes(null), '');
});

test('parseWhitelistList: standard response', () => {
  const players = parseWhitelistList('There are 3 whitelisted player(s): alpha, bravo_2, Charlie');
  assert.deepEqual(players, ['alpha', 'bravo_2', 'Charlie']);
});

test('parseWhitelistList: empty whitelist', () => {
  assert.deepEqual(parseWhitelistList('There are no whitelisted players'), []);
});

test('parseWhitelistList: older wording variant', () => {
  const players = parseWhitelistList('There are 2 whitelisted players: alpha, bravo');
  assert.deepEqual(players, ['alpha', 'bravo']);
});

test('parseWhitelistList: color-coded response', () => {
  const players = parseWhitelistList('§eThere are 1 whitelisted player(s): §aalpha');
  assert.deepEqual(players, ['alpha']);
});

test('parseWhitelistList: garbage returns empty', () => {
  assert.deepEqual(parseWhitelistList('Unknown command'), []);
  assert.deepEqual(parseWhitelistList(''), []);
});

test('classifyWhitelistResponse: variants', () => {
  assert.equal(classifyWhitelistResponse('Added Notch to the whitelist'), 'added');
  assert.equal(classifyWhitelistResponse('Removed Notch from the whitelist'), 'removed');
  assert.equal(classifyWhitelistResponse('Player is already whitelisted'), 'already');
  assert.equal(classifyWhitelistResponse('That player does not exist'), 'not_found');
  assert.equal(classifyWhitelistResponse('Player is not whitelisted'), 'not_found');
  assert.equal(classifyWhitelistResponse('Something else entirely'), 'unknown');
});

test('parseSseChunk: single complete event', () => {
  const { events, state } = parseSseChunk(null, 'event: line\ndata: {"a":1}\n\n');
  assert.deepEqual(events, [{ event: 'line', data: '{"a":1}' }]);
  assert.equal(state.buffer, '');
});

test('parseSseChunk: event split across two chunks', () => {
  const first = parseSseChunk(null, 'event: line\nda');
  assert.deepEqual(first.events, []);
  const second = parseSseChunk(first.state, 'ta: hello\n\n');
  assert.deepEqual(second.events, [{ event: 'line', data: 'hello' }]);
});

test('parseSseChunk: comments ignored, default event name', () => {
  const { events } = parseSseChunk(null, ': keepalive\n\ndata: x\n\n');
  assert.deepEqual(events, [{ event: 'message', data: 'x' }]);
});

test('parseSseChunk: multiple events in one chunk', () => {
  const { events } = parseSseChunk(null, 'event: line\ndata: one\n\nevent: line\ndata: two\n\n');
  assert.equal(events.length, 2);
  assert.equal(events[0].data, 'one');
  assert.equal(events[1].data, 'two');
});

test('parseSseChunk: CRLF line endings', () => {
  const { events } = parseSseChunk(null, 'event: line\r\ndata: x\r\n\r\n');
  assert.deepEqual(events, [{ event: 'line', data: 'x' }]);
});
