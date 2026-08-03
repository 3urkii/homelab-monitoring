// Minimal Source RCON client (https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
// used to talk to a Minecraft server. Zero dependencies: framing is plain
// int32LE fields over TCP via node:net.
const net = require('node:net');

const TYPE_AUTH = 3; // SERVERDATA_AUTH
const TYPE_EXEC = 2; // SERVERDATA_EXECCOMMAND
const TYPE_AUTH_RESPONSE = 2; // same value as EXEC; direction disambiguates
const TYPE_RESPONSE = 0; // SERVERDATA_RESPONSE_VALUE

const AUTH_ID = 1;
const EXEC_ID = 2;
const RESPONSE_GRACE_MS = 100;
const DEFAULT_TIMEOUT_MS = 5000;

// Frame: int32LE length (= 4 id + 4 type + body + 2 NUL), int32LE id,
// int32LE type, UTF-8 body, 0x00 0x00.
function encodePacket(id, type, body) {
  const bodyBuf = Buffer.from(String(body), 'utf8');
  const buf = Buffer.alloc(4 + 4 + 4 + bodyBuf.length + 2);
  buf.writeInt32LE(4 + 4 + bodyBuf.length + 2, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  return buf;
}

// Parses as many complete frames as `buf` holds; unconsumed bytes come back
// in `rest` so callers can accumulate across TCP fragmentation.
function decodePackets(buf) {
  const packets = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const length = buf.readInt32LE(offset);
    if (length < 10 || buf.length - offset < 4 + length) break;
    const id = buf.readInt32LE(offset + 4);
    const type = buf.readInt32LE(offset + 8);
    let end = offset + 4 + length;
    while (end > offset + 12 && buf[end - 1] === 0) end--;
    packets.push({ id, type, body: buf.toString('utf8', offset + 12, end) });
    offset += 4 + length;
  }
  return { packets, rest: buf.subarray(offset) };
}

function execOnce({ host, port, password, timeoutMs }, command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let authed = false;
    const parts = [];
    let graceTimer = null;
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (graceTimer) clearTimeout(graceTimer);
      socket.destroy();
      fn();
    };
    const fail = (message, code) => finish(() => {
      const err = new Error(message);
      err.code = code;
      reject(err);
    });
    const succeed = () => finish(() => resolve(parts.join('')));

    const deadline = setTimeout(
      () => fail(`rcon timed out after ${timeoutMs}ms`, 'rcon_unreachable'),
      timeoutMs,
    );

    socket.on('connect', () => {
      socket.write(encodePacket(AUTH_ID, TYPE_AUTH, password));
    });
    socket.on('error', (err) => fail(`rcon connection failed: ${err.message}`, 'rcon_unreachable'));
    socket.on('close', () => {
      // Some servers close right after the last response packet.
      if (parts.length) succeed();
      else fail('rcon connection closed unexpectedly', 'rcon_unreachable');
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { packets, rest } = decodePackets(buf);
      buf = rest;
      for (const p of packets) {
        if (!authed) {
          // Source servers send an empty RESPONSE_VALUE before the auth
          // response; skip anything that isn't the auth verdict.
          if (p.type !== TYPE_AUTH_RESPONSE) continue;
          if (p.id === -1) return fail('rcon auth failed', 'rcon_auth_failed');
          authed = true;
          socket.write(encodePacket(EXEC_ID, TYPE_EXEC, command));
          continue;
        }
        if (p.type === TYPE_RESPONSE && p.id === EXEC_ID) {
          parts.push(p.body);
          // Paper splits long responses across consecutive packets; collect
          // until the stream goes quiet instead of resolving on the first.
          if (graceTimer) clearTimeout(graceTimer);
          graceTimer = setTimeout(succeed, RESPONSE_GRACE_MS);
        }
      }
    });
  });
}

// Vanilla's RCON handler misbehaves under concurrent commands, so all calls
// share one queue: each command opens, auths, executes, and closes in turn.
let queue = Promise.resolve();

function rconExec({ host, port, password, timeoutMs = DEFAULT_TIMEOUT_MS }, command) {
  const result = queue.then(() => execOnce({ host, port, password, timeoutMs }, command));
  queue = result.catch(() => {});
  return result;
}

module.exports = {
  encodePacket,
  decodePackets,
  rconExec,
  TYPE_AUTH,
  TYPE_EXEC,
  TYPE_AUTH_RESPONSE,
  TYPE_RESPONSE,
  RESPONSE_GRACE_MS,
};
