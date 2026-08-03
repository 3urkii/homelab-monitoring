const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_COMMAND_ALLOWLIST,
  validateMinecraftConfig,
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

test('validateMinecraftConfig: good config passes', () => {
  assert.deepEqual(validateMinecraftConfig(goodConfig, true), []);
});

test('validateMinecraftConfig: logAgent and commandAllowlist are optional', () => {
  const cfg = { rcon: goodConfig.rcon };
  assert.deepEqual(validateMinecraftConfig(cfg, true), []);
  assert.deepEqual(
    validateMinecraftConfig({ ...cfg, commandAllowlist: ['whitelist', 'list'] }, true),
    [],
  );
});

test('validateMinecraftConfig: requires plan', () => {
  const errs = validateMinecraftConfig(goodConfig, false);
  assert.ok(errs.some((e) => /requires plan/.test(e)));
});

test('validateMinecraftConfig: rejects non-object', () => {
  assert.ok(validateMinecraftConfig(null, true).some((e) => /must be an object/.test(e)));
});

test('validateMinecraftConfig: missing rcon', () => {
  const errs = validateMinecraftConfig({}, true);
  assert.ok(errs.some((e) => /minecraft\.rcon must be an object/.test(e)));
});

test('validateMinecraftConfig: REPLACE_ME host and password rejected', () => {
  const cfg = { rcon: { host: 'REPLACE_ME', port: 25575, password: 'REPLACE_ME' } };
  const errs = validateMinecraftConfig(cfg, true);
  assert.ok(errs.some((e) => /rcon\.host must be set/.test(e)));
  assert.ok(errs.some((e) => /rcon\.password must be set/.test(e)));
});

test('validateMinecraftConfig: bad ports rejected', () => {
  for (const port of [0, 70000, 25575.5, '25575', undefined]) {
    const cfg = { rcon: { ...goodConfig.rcon, port } };
    assert.ok(
      validateMinecraftConfig(cfg, true).some((e) => /rcon\.port must be an integer/.test(e)),
      `port ${port} should be rejected`,
    );
  }
});

test('validateMinecraftConfig: bad logAgent rejected', () => {
  const errs = validateMinecraftConfig({ rcon: goodConfig.rcon, logAgent: {} }, true);
  assert.ok(errs.some((e) => /logAgent\.url must be set/.test(e)));
});

test('validateMinecraftConfig: bad commandAllowlist entries rejected', () => {
  for (const allowlist of [[], ['whitelist add'], ['/op'], [''], [42]]) {
    const cfg = { rcon: goodConfig.rcon, commandAllowlist: allowlist };
    assert.ok(
      validateMinecraftConfig(cfg, true).some((e) => /commandAllowlist/.test(e)),
      `${JSON.stringify(allowlist)} should be rejected`,
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
