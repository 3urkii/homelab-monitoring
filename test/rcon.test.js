const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {
  encodePacket,
  decodePackets,
  rconExec,
  TYPE_AUTH,
  TYPE_EXEC,
  TYPE_RESPONSE,
} = require('../lib/rcon.js');

test('encodePacket: byte-exact frame for exec "list"', () => {
  const buf = encodePacket(0x12, 2, 'list');
  assert.equal(
    buf.toString('hex'),
    '0e000000' + '12000000' + '02000000' + '6c697374' + '0000',
  );
});

test('encodePacket/decodePackets: round-trips body, id, type', () => {
  for (const [id, type, body] of [[1, 3, 'hunter2'], [2, 2, ''], [7, 0, 'ünïcode §a']]) {
    const { packets, rest } = decodePackets(encodePacket(id, type, body));
    assert.equal(packets.length, 1);
    assert.deepEqual(packets[0], { id, type, body });
    assert.equal(rest.length, 0);
  }
});

test('decodePackets: two concatenated frames', () => {
  const buf = Buffer.concat([encodePacket(1, 0, 'first'), encodePacket(2, 0, 'second')]);
  const { packets, rest } = decodePackets(buf);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].body, 'first');
  assert.equal(packets[1].body, 'second');
  assert.equal(rest.length, 0);
});

test('decodePackets: frame split mid-packet, rest completes on re-feed', () => {
  const full = encodePacket(5, 0, 'fragmented response');
  const cut = 9;
  const first = decodePackets(full.subarray(0, cut));
  assert.equal(first.packets.length, 0);
  assert.equal(first.rest.length, cut);
  const second = decodePackets(Buffer.concat([first.rest, full.subarray(cut)]));
  assert.equal(second.packets.length, 1);
  assert.equal(second.packets[0].body, 'fragmented response');
});

test('decodePackets: fewer than 4 bytes returns everything as rest', () => {
  const { packets, rest } = decodePackets(Buffer.from([0x0e, 0x00]));
  assert.equal(packets.length, 0);
  assert.equal(rest.length, 2);
});

test('decodePackets: auth-failure frame (id -1)', () => {
  const { packets } = decodePackets(encodePacket(-1, 2, ''));
  assert.equal(packets[0].id, -1);
  assert.equal(packets[0].type, 2);
});

// ── socket-level tests against an in-process fake RCON server ──

function startFakeRcon(onPacket) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { packets, rest } = decodePackets(buf);
        buf = rest;
        for (const p of packets) onPacket(socket, p);
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

const PASSWORD = 'correct-horse';

function standardHandler(socket, p) {
  if (p.type === TYPE_AUTH) {
    socket.write(encodePacket(p.body === PASSWORD ? p.id : -1, 2, ''));
    return;
  }
  if (p.type === TYPE_EXEC) {
    socket.write(encodePacket(p.id, TYPE_RESPONSE, `ran: ${p.body}`));
  }
}

test('rconExec: auth + exec returns response body', async () => {
  const srv = await startFakeRcon(standardHandler);
  try {
    const out = await rconExec({ host: '127.0.0.1', port: srv.port, password: PASSWORD }, 'list');
    assert.equal(out, 'ran: list');
  } finally {
    await srv.close();
  }
});

test('rconExec: wrong password rejects with rcon_auth_failed', async () => {
  const srv = await startFakeRcon(standardHandler);
  try {
    await assert.rejects(
      rconExec({ host: '127.0.0.1', port: srv.port, password: 'nope' }, 'list'),
      (err) => err.code === 'rcon_auth_failed',
    );
  } finally {
    await srv.close();
  }
});

test('rconExec: unresponsive server rejects with rcon_unreachable', async () => {
  const srv = await startFakeRcon(() => { /* never reply */ });
  try {
    await assert.rejects(
      rconExec({ host: '127.0.0.1', port: srv.port, password: PASSWORD, timeoutMs: 200 }, 'list'),
      (err) => err.code === 'rcon_unreachable',
    );
  } finally {
    await srv.close();
  }
});

test('rconExec: connection refused rejects with rcon_unreachable', async () => {
  const srv = await startFakeRcon(() => {});
  const port = srv.port;
  await srv.close();
  await assert.rejects(
    rconExec({ host: '127.0.0.1', port, password: PASSWORD, timeoutMs: 1000 }, 'list'),
    (err) => err.code === 'rcon_unreachable',
  );
});

test('rconExec: multi-packet response is concatenated', async () => {
  const srv = await startFakeRcon((socket, p) => {
    if (p.type === TYPE_AUTH) return void socket.write(encodePacket(p.id, 2, ''));
    if (p.type === TYPE_EXEC) {
      socket.write(encodePacket(p.id, TYPE_RESPONSE, 'part one, '));
      socket.write(encodePacket(p.id, TYPE_RESPONSE, 'part two'));
    }
  });
  try {
    const out = await rconExec({ host: '127.0.0.1', port: srv.port, password: PASSWORD }, 'whitelist list');
    assert.equal(out, 'part one, part two');
  } finally {
    await srv.close();
  }
});

test('rconExec: ignores pre-auth RESPONSE_VALUE packet (Source servers)', async () => {
  const srv = await startFakeRcon((socket, p) => {
    if (p.type === TYPE_AUTH) {
      socket.write(encodePacket(p.id, TYPE_RESPONSE, ''));
      socket.write(encodePacket(p.id, 2, ''));
      return;
    }
    if (p.type === TYPE_EXEC) socket.write(encodePacket(p.id, TYPE_RESPONSE, 'ok'));
  });
  try {
    const out = await rconExec({ host: '127.0.0.1', port: srv.port, password: PASSWORD }, 'list');
    assert.equal(out, 'ok');
  } finally {
    await srv.close();
  }
});
