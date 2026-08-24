const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { McSampler, parseListResponse, parseTpsResponse } = require('../lib/mc_sampler.js');
const { encodePacket, decodePackets, TYPE_AUTH, TYPE_EXEC, TYPE_RESPONSE } = require('../lib/rcon.js');
const { Storage } = require('../lib/storage.js');

test('parseListResponse: vanilla/Forge wording', () => {
  assert.deepEqual(
    parseListResponse('There are 3 of a max of 20 players online: a, b, c'),
    { players: 3 },
  );
  assert.deepEqual(parseListResponse('There are 0 of a max of 20 players online:'), { players: 0 });
});

test('parseListResponse: older slash wording and color codes', () => {
  assert.deepEqual(parseListResponse('§e3/20 players online:'), { players: 3 });
  assert.deepEqual(parseListResponse('There are §c12§r players online'), { players: 12 });
});

test('parseListResponse: garbage returns null', () => {
  assert.equal(parseListResponse('Unknown command'), null);
  assert.equal(parseListResponse(''), null);
});

test('parseTpsResponse: forge overall line', () => {
  const out = parseTpsResponse(
    'Dim minecraft:overworld (minecraft:overworld): Mean tick time: 3.244 ms. Mean TPS: 20.000\n' +
    'Overall: Mean tick time: 4.104 ms. Mean TPS: 19.876',
  );
  assert.deepEqual(out, { tickMs: 4.104, tps: 19.876 });
});

test('parseTpsResponse: forge with comma decimal separator', () => {
  const out = parseTpsResponse('Overall: Mean tick time: 4,104 ms. Mean TPS: 19,876');
  assert.deepEqual(out, { tickMs: 4.104, tps: 19.876 });
});

test('parseTpsResponse: paper wording, starred value, color codes', () => {
  assert.deepEqual(
    parseTpsResponse('§6TPS from last 1m, 5m, 15m: §a19.98, 19.99, 20.0'),
    { tps: 19.98, tickMs: null },
  );
  assert.deepEqual(
    parseTpsResponse('TPS from last 5s, 1m, 5m, 15m: *20.0, *20.0, 19.95, 19.9'),
    { tps: 20.0, tickMs: null },
  );
});

test('parseTpsResponse: unknown command returns null', () => {
  assert.equal(parseTpsResponse('Unknown or incomplete command, see below for error'), null);
  assert.equal(parseTpsResponse(''), null);
});

test('storage: mc samples round-trip raw', () => {
  const storage = new Storage(':memory:');
  try {
    storage.insertMcSample({ serverId: 'soulrend', ts: 1000, players: 3, tps: 19.5, tickMs: 12.2 });
    storage.insertMcSample({ serverId: 'soulrend', ts: 2000, players: 4, tps: null, tickMs: null });
    storage.insertMcSample({ serverId: 'other', ts: 1500, players: 9, tps: 20, tickMs: 5 });
    const rows = storage.queryMcSamples({ serverId: 'soulrend', fromTs: 0, toTs: 5000 });
    assert.deepEqual(rows, [[1000, 3, 19.5, 12.2], [2000, 4, null, null]]);
  } finally {
    storage.close();
  }
});

test('storage: mc samples bucketed averaging', () => {
  const storage = new Storage(':memory:');
  try {
    storage.insertMcSample({ serverId: 's', ts: 0, players: 2, tps: 20, tickMs: 10 });
    storage.insertMcSample({ serverId: 's', ts: 30_000, players: 4, tps: 18, tickMs: 20 });
    storage.insertMcSample({ serverId: 's', ts: 60_000, players: 6, tps: 16, tickMs: 30 });
    const rows = storage.queryMcSamples({ serverId: 's', fromTs: 0, toTs: 90_000, bucketMs: 60_000 });
    assert.deepEqual(rows, [[0, 3, 19, 15], [60_000, 6, 16, 30]]);
  } finally {
    storage.close();
  }
});

test('storage: mc samples pruned after 30 days', () => {
  const storage = new Storage(':memory:');
  try {
    const now = 100 * 24 * 3600 * 1000;
    storage.insertMcSample({ serverId: 's', ts: now - 31 * 24 * 3600 * 1000, players: 1 });
    storage.insertMcSample({ serverId: 's', ts: now - 1000, players: 2 });
    storage.pruneMcSamples(now);
    const rows = storage.queryMcSamples({ serverId: 's', fromTs: 0, toTs: now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0][1], 2);
  } finally {
    storage.close();
  }
});

// ── end-to-end tick against an in-process fake RCON server ──

const PASSWORD = 'sampler-pass';

function startFakeRcon(commandHandler) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { packets, rest } = decodePackets(buf);
        buf = rest;
        for (const p of packets) {
          if (p.type === TYPE_AUTH) {
            socket.write(encodePacket(p.body === PASSWORD ? p.id : -1, 2, ''));
          } else if (p.type === TYPE_EXEC) {
            socket.write(encodePacket(p.id, TYPE_RESPONSE, commandHandler(p.body)));
          }
        }
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

test('McSampler: samples a Forge-style server, probing forge tps', async () => {
  const commands = [];
  const srv = await startFakeRcon((cmd) => {
    commands.push(cmd);
    if (cmd === 'list') return 'There are 2 of a max of 20 players online: ModdedMage, GearGrinder';
    if (cmd === 'forge tps') return 'Overall: Mean tick time: 12.500 ms. Mean TPS: 19.250';
    return 'Unknown command';
  });
  const storage = new Storage(':memory:');
  const sampler = new McSampler({
    serverId: 'soulrend',
    rcon: { host: '127.0.0.1', port: srv.port, password: PASSWORD },
    storage,
    intervalMs: 60_000,
  });
  try {
    sampler.start();
    await waitFor(() => storage.queryMcSamples({ serverId: 'soulrend', fromTs: 0, toTs: Date.now() + 1 }).length > 0);
    const [row] = storage.queryMcSamples({ serverId: 'soulrend', fromTs: 0, toTs: Date.now() + 1 });
    assert.equal(row[1], 2);
    assert.equal(row[2], 19.25);
    assert.equal(row[3], 12.5);
    assert.deepEqual(commands, ['list', 'forge tps']);
    assert.equal(sampler.status().online, true);
    assert.equal(sampler.status().sample.players, 2);
  } finally {
    sampler.stop();
    storage.close();
    await srv.close();
  }
});

test('McSampler: falls back to paper tps, then remembers the probed command', async () => {
  const commands = [];
  const srv = await startFakeRcon((cmd) => {
    commands.push(cmd);
    if (cmd === 'list') return 'There are 1 of a max of 20 players online: solo';
    if (cmd === 'tps') return 'TPS from last 1m, 5m, 15m: 19.90, 19.95, 20.0';
    return 'Unknown command';
  });
  const storage = new Storage(':memory:');
  const sampler = new McSampler({
    serverId: 'paper',
    rcon: { host: '127.0.0.1', port: srv.port, password: PASSWORD },
    storage,
    intervalMs: 60_000,
  });
  try {
    sampler.start();
    await waitFor(() => storage.queryMcSamples({ serverId: 'paper', fromTs: 0, toTs: Date.now() + 1 }).length > 0);
    const [row] = storage.queryMcSamples({ serverId: 'paper', fromTs: 0, toTs: Date.now() + 1 });
    assert.equal(row[1], 1);
    assert.equal(row[2], 19.9);
    assert.equal(row[3], null);
    // First tick probes forge tps (unknown) then tps.
    assert.deepEqual(commands, ['list', 'forge tps', 'tps']);
  } finally {
    sampler.stop();
    storage.close();
    await srv.close();
  }
});

test('McSampler: unreachable server marks offline, no sample stored', async () => {
  const srv = await startFakeRcon(() => '');
  const port = srv.port;
  await srv.close();
  const storage = new Storage(':memory:');
  const sampler = new McSampler({
    serverId: 'down',
    rcon: { host: '127.0.0.1', port, password: PASSWORD, timeoutMs: 300 },
    storage,
    intervalMs: 60_000,
  });
  try {
    sampler.start();
    // Connection refused fails the first tick almost immediately; give it
    // time to settle, then check nothing was stored and status shows offline.
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(sampler.status().online, false);
    assert.equal(sampler.status().sample, null);
    assert.equal(storage.queryMcSamples({ serverId: 'down', fromTs: 0, toTs: Date.now() + 1 }).length, 0);
  } finally {
    sampler.stop();
    storage.close();
  }
});
