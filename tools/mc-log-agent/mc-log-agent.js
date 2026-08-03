#!/usr/bin/env node
// mc-log-agent — tails a Minecraft server log and serves it over HTTP.
// Runs on the Minecraft host; zero dependencies (node:http + node:fs only).
//
//   MC_LOG_FILE=/opt/minecraft/logs/latest.log node mc-log-agent.js
//
// Env:
//   MC_LOG_FILE       path to latest.log (required)
//   MC_LOG_PORT       listen port (default 8127)
//   MC_LOG_BIND       bind address (default 0.0.0.0 — firewall to the dashboard host)
//   MC_LOG_MAX_LINES  ring buffer size (default 2000)
//
// Endpoints:
//   GET /recent?lines=N  last N buffered lines as { file, lines }
//   GET /stream          SSE: `line` events with {ts, line}
//   GET /healthz         { ok, file, size, clients }

const http = require('node:http');
const fs = require('node:fs');

const FILE = process.env.MC_LOG_FILE;
const PORT = Number(process.env.MC_LOG_PORT) || 8127;
const BIND = process.env.MC_LOG_BIND || '0.0.0.0';
const MAX_LINES = Number(process.env.MC_LOG_MAX_LINES) || 2000;
const POLL_MS = 500;
const KEEPALIVE_MS = 15_000;
const BACKFILL_BYTES = 256 * 1024;

if (!FILE) {
  console.error('[mc-log-agent] MC_LOG_FILE is required');
  process.exit(1);
}

const ring = [];
const clients = new Set();
let offset = 0;
let lastIno = null;
let partial = '';

function pushLine(line, broadcast) {
  if (!line) return;
  const entry = { ts: Date.now(), line };
  ring.push(entry);
  if (ring.length > MAX_LINES) ring.splice(0, ring.length - MAX_LINES);
  if (!broadcast) return;
  const payload = `event: line\ndata: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

function readSlice(size, broadcast = true) {
  let fd;
  try { fd = fs.openSync(FILE, 'r'); } catch { return; }
  try {
    const buf = Buffer.alloc(size - offset);
    const read = fs.readSync(fd, buf, 0, buf.length, offset);
    offset += read;
    partial += buf.toString('utf8', 0, read);
    const lines = partial.split('\n');
    partial = lines.pop();
    for (const l of lines) pushLine(l.replace(/\r$/, ''), broadcast);
  } finally {
    fs.closeSync(fd);
  }
}

// Poll instead of fs.watch: log4j rotation renames latest.log out from under
// a watcher, while a stat every 500ms is rotation-proof and near-free.
function tick() {
  let stat;
  try {
    stat = fs.statSync(FILE);
  } catch {
    return; // rotation gap or missing file — keep polling
  }
  if (lastIno === null) {
    // First sight: backfill the ring from the tail without broadcasting.
    lastIno = stat.ino;
    offset = Math.max(0, stat.size - BACKFILL_BYTES);
    const truncated = offset > 0;
    readSlice(stat.size, false);
    if (truncated && ring.length) ring.shift(); // first backfilled line is likely partial
    return;
  }
  if (stat.ino !== lastIno || stat.size < offset) {
    // Rotated (new inode) or truncated — start over from the top.
    lastIno = stat.ino;
    offset = 0;
    partial = '';
  }
  if (stat.size > offset) readSlice(stat.size);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }
  if (url.pathname === '/recent') {
    const n = Math.max(1, Math.min(MAX_LINES, Number(url.searchParams.get('lines')) || 200));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ file: FILE, lines: ring.slice(-n).map((e) => e.line) }));
  }
  if (url.pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/healthz') {
    let size = null;
    try { size = fs.statSync(FILE).size; } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, file: FILE, size, clients: clients.size }));
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

setInterval(tick, POLL_MS);
setInterval(() => {
  for (const res of clients) {
    try { res.write(': keepalive\n\n'); } catch { clients.delete(res); }
  }
}, KEEPALIVE_MS);

server.listen(PORT, BIND, () => {
  tick();
  console.log(`[mc-log-agent] tailing ${FILE}`);
  console.log(`[mc-log-agent] listening on http://${BIND}:${PORT}`);
});
