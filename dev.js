const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { Poller } = require('./lib/poller.js');
const { Storage, METRIC_COLUMNS } = require('./lib/storage.js');
const { SseBroker } = require('./lib/sse_broker.js');
const { checkCommand, isValidUsername, DEFAULT_COMMAND_ALLOWLIST } = require('./lib/minecraft.js');

const RANGE_PRESETS = {
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const startTs = Date.now() / 1000;

const devConfig = {
  server: { pollIntervalMs: 3000, serviceTimeoutMs: 1000, proxmoxTimeoutMs: 2000, nodeExporterTimeoutMs: 2000 },
  machines: [
    { name: 'proxmox-dmz',      type: 'proxmox',       primaryUrl: 'https://demo-proxmox-dmz.invalid:8006' },
    { name: 'proxmox-internal', type: 'proxmox',       primaryUrl: 'https://demo-proxmox-internal.invalid:8006' },
    { name: 'nas',              type: 'node_exporter', primaryUrl: 'http://demo-nas.invalid' },
  ],
  guestLinks: [
    { machine: 'proxmox-dmz',      guest: 'mealie-lxc', url: 'http://127.0.0.1:1/mealie',    icon: 'mealie-light.svg' },
    { machine: 'proxmox-internal', guest: 'plex-lxc',   url: 'http://127.0.0.1:1/plex',      icon: 'plex-light.svg'   },
    { machine: 'proxmox-internal', guest: 'dashboard',  url: 'http://127.0.0.1:1/dashboard', icon: 'dashboard.svg'    },
  ],
  servers: [
    { id: 'vanilla',  label: 'Vanilla SMP', plan: { url: 'http://mock', machine: 'proxmox-dmz', guest: 'mc-server' } },
    { id: 'soulrend', label: 'Soulrend',    plan: { url: 'http://mock', machine: 'proxmox-dmz', guest: 'soulrend-srv' } },
  ],
};

function drift(base, range, freq) {
  const t = Date.now() / 1000 - startTs;
  return Math.max(0, Math.min(100, base + Math.sin(t * freq) * range));
}

async function mockProxmox(entry) {
  const elapsedSec = Date.now() / 1000 - startTs;
  const isDmz = entry.name === 'proxmox-dmz';
  return {
    host: {
      cpuPct: isDmz ? drift(35, 20, 0.3) : drift(18, 10, 0.2),
      memUsed: (isDmz ? 22 : 14) * 1e9 + Math.sin(elapsedSec * 0.1) * 1e9,
      memTotal: 32 * 1e9,
      diskUsed: (isDmz ? 410 : 520) * 1e9,
      diskTotal: 1024 * 1e9,
      uptime: 864000 + Math.floor(elapsedSec),
      loadavg: [0.35, 0.42, 0.48],
      _cumulative: {
        netRxBytes: (isDmz ? 12e6 : 3e6) * elapsedSec,
        netTxBytes: (isDmz ? 8e6 : 1.5e6) * elapsedSec,
      },
    },
    guests: isDmz
      ? [
          { vmid: 101, name: 'mc-server',  type: 'lxc',  status: 'running', cpuPct: drift(45, 15, 0.4),  memUsed: 3.2e9, memTotal: 4e9,   diskUsed: 12e9,  diskTotal: 20e9, uptime: 432000, _cumulative: { netRxBytes: 1_500_000 * elapsedSec, netTxBytes: 800_000 * elapsedSec } },
          { vmid: 102, name: 'val-srv',    type: 'lxc',  status: 'running', cpuPct: drift(60, 20, 0.5),  memUsed: 3.6e9, memTotal: 4e9,   diskUsed: 15e9,  diskTotal: 20e9, uptime: 200000, _cumulative: { netRxBytes: 4_000_000 * elapsedSec, netTxBytes: 2_500_000 * elapsedSec } },
          { vmid: 103, name: 'cs2-srv',    type: 'lxc',  status: 'running', cpuPct: drift(30, 15, 0.35), memUsed: 2.1e9, memTotal: 4e9,   diskUsed: 18e9,  diskTotal: 20e9, uptime: 120000, _cumulative: { netRxBytes: 6_000_000 * elapsedSec, netTxBytes: 3_200_000 * elapsedSec } },
          { vmid: 106, name: 'soulrend-srv', type: 'lxc', status: 'running', cpuPct: drift(55, 20, 0.45), memUsed: 6.1e9, memTotal: 8e9,  diskUsed: 24e9,  diskTotal: 40e9, uptime: 96000,  _cumulative: { netRxBytes: 2_200_000 * elapsedSec, netTxBytes: 1_100_000 * elapsedSec } },
          { vmid: 105, name: 'mealie-lxc', type: 'lxc',  status: 'running', cpuPct: drift(4,  2, 0.3),   memUsed: 340e6, memTotal: 1e9,   diskUsed: 2.4e9, diskTotal: 10e9, uptime: 350000, _cumulative: { netRxBytes: 80_000 * elapsedSec,    netTxBytes: 60_000 * elapsedSec } },
          { vmid: 104, name: 'rust-srv',   type: 'lxc',  status: 'stopped', cpuPct: 0,                   memUsed: 0,     memTotal: 6e9,   diskUsed: 22e9,  diskTotal: 40e9, uptime: 0,      _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
          { vmid: 301, name: 'win-srv',    type: 'qemu', status: 'stopped', cpuPct: 0,                   memUsed: 0,     memTotal: 8e9,   diskUsed: 0,     diskTotal: 0,    uptime: 0,      _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
        ]
      : [
          { vmid: 201, name: 'plex-lxc',  type: 'lxc',  status: 'running', cpuPct: drift(12, 8, 0.25),  memUsed: 2.4e9, memTotal: 4e9,   diskUsed: 5.5e9, diskTotal: 20e9, uptime: 700000, _cumulative: { netRxBytes: 300_000 * elapsedSec, netTxBytes: 10_000_000 * elapsedSec } },
          { vmid: 202, name: 'nginx-lxc', type: 'lxc',  status: 'running', cpuPct: drift(2, 1, 0.8),    memUsed: 512e6, memTotal: 1e9,   diskUsed: 2e9,   diskTotal: 10e9, uptime: 900000, _cumulative: { netRxBytes: 200_000 * elapsedSec, netTxBytes: 800_000 * elapsedSec } },
          { vmid: 203, name: 'pihole',    type: 'lxc',  status: 'running', cpuPct: drift(1, 0.5, 1),    memUsed: 220e6, memTotal: 512e6, diskUsed: 1e9,   diskTotal: 5e9,  uptime: 600000, _cumulative: { netRxBytes: 100_000 * elapsedSec, netTxBytes: 100_000 * elapsedSec } },
          { vmid: 204, name: 'dashboard', type: 'lxc',  status: 'running', cpuPct: drift(3, 2, 0.6),    memUsed: 180e6, memTotal: 512e6, diskUsed: 600e6, diskTotal: 5e9,  uptime: 150000, _cumulative: { netRxBytes: 50_000 * elapsedSec, netTxBytes: 50_000 * elapsedSec } },
        ],
  };
}

async function mockNodeExporter() {
  const elapsedSec = Date.now() / 1000 - startTs;
  return {
    memTotal: 64e9,
    memAvailable: 50e9 - Math.sin(elapsedSec * 0.15) * 2e9,
    diskTotal: 20e12,
    diskAvailable: 12e12 - elapsedSec * 1e6,
    netRxBytes: 45e6 * elapsedSec,
    netTxBytes: 30e6 * elapsedSec,
    cpuIdleSeconds: 900_000 + elapsedSec * 0.85,
    cpuTotalSeconds: 1_000_000 + elapsedSec,
    bootTimeSeconds: Math.floor(Date.now() / 1000) - 10_200_000,
    loadavg: [0.75, 0.82, 0.88],
  };
}

const serviceStates = new Map([
  ['Proxmox DMZ', 'up'],
  ['Mealie', 'up'],
  ['Proxmox Internal', 'up'],
  ['Plex', 'up'],
  ['netboot.xyz', 'down'],
  ['Dashboard', 'up'],
  ['TrueNAS', 'up'],
]);

async function mockServicePing(svc) {
  const status = serviceStates.get(svc.name) ?? 'up';
  return { status, responseTime: status === 'up' ? Math.floor(20 + Math.random() * 80) : null };
}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const storage = new Storage(path.join(dataDir, 'dev.db'));

const poller = new Poller(devConfig, {
  scrapers: { proxmox: mockProxmox, node_exporter: mockNodeExporter },
  storage,
});
poller.start();

const app = express();
app.get('/api/stats', (_req, res) => res.json(poller.getState()));

app.get('/api/history', (req, res) => {
  try {
    const { machine, guest, range } = req.query;
    const metrics = String(req.query.metrics ?? 'cpu,memUsed,memTotal,diskUsed,diskTotal,netRx,netTx')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (!machine) return res.status(400).json({ error: 'machine query param is required' });
    const rangeMs = RANGE_PRESETS[range] ?? RANGE_PRESETS['24h'];
    const toTs = Date.now();
    const fromTs = toTs - rangeMs;
    const result = {};
    for (const metric of metrics) {
      if (!METRIC_COLUMNS[metric]) return res.status(400).json({ error: `unknown metric: ${metric}` });
      result[metric] = storage.query({ machine, guest: guest || null, metric, fromTs, toTs });
    }
    res.json({ machine, guest: guest || null, range, fromTs, toTs, metrics: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Plan + Minecraft admin mock (per server) ───────────
const mockServers = new Map([
  ['vanilla', {
    planServerName: 'Survival',
    tpsBase: 19.8,
    allowlist: DEFAULT_COMMAND_ALLOWLIST,
    whitelist: ['xXDragonSlayerXx', 'CraftQueen', 'BlockMaster99', 'newbie_steve'],
    players: ['xXDragonSlayerXx', 'CraftQueen', 'BlockMaster99', 'RedstoneWiz', 'SkyBuilder',
              'MinerJoe', 'EnderKnight', 'PixelFarmer', 'NetherExplorer', 'newbie_steve'],
    logFile: '/opt/minecraft/logs/latest.log',
  }],
  ['soulrend', {
    planServerName: 'Soulrend',
    tpsBase: 18.6,
    allowlist: [...DEFAULT_COMMAND_ALLOWLIST, 'forge'],
    whitelist: ['ModdedMage', 'GearGrinder', 'CraftQueen'],
    players: ['ModdedMage', 'GearGrinder', 'AetherWalker', 'CraftQueen', 'VoidTinkerer',
              'RuneSmith', 'BossFarmer', 'packtester42'],
    logFile: '/opt/soulrend/logs/latest.log',
  }],
]);

function withMockServer(handler) {
  return (req, res) => {
    const ms = mockServers.get(req.params.serverId);
    if (!ms) return res.status(404).json({ error: 'unknown server' });
    handler(ms, req, res);
  };
}

app.get('/plan', (_req, res) => res.redirect(`/plan/${devConfig.servers[0].id}`));
app.get('/plan/:serverId', (req, res) => {
  if (!mockServers.has(req.params.serverId)) return res.status(404).send('unknown server');
  res.sendFile(path.join(__dirname, 'public', 'plan.html'));
});

app.get('/api/servers', (_req, res) => {
  res.json(devConfig.servers.map((s) => ({
    id: s.id,
    label: s.label || s.id,
    plan: { machine: s.plan.machine, guest: s.plan.guest },
    hasMc: true,
  })));
});

function mockPlanGraph(ms, type) {
  const now = Date.now();
  const points = [];
  var step = 300_000;
  for (let t = now - 7 * 24 * 3600_000; t <= now; t += step) {
    const hour = new Date(t).getHours();
    const activity = Math.sin((hour - 6) * Math.PI / 12);
    if (type === 'playersOnline') {
      points.push([t, Math.max(0, Math.round(3 + activity * 4 + (Math.random() - 0.5) * 2))]);
    } else {
      const tps = Math.min(20, Math.max(14, ms.tpsBase - Math.random() * 0.6 + activity * 0.3));
      const players = Math.max(0, Math.round(3 + activity * 4 + (Math.random() - 0.5) * 2));
      const chunks = Math.round(4000 + players * 200 + Math.random() * 300);
      const entities = Math.round(800 + players * 60 + Math.random() * 100);
      var cpu = Math.min(100, Math.max(5, 25 + players * 5 + Math.random() * 10));
      points.push([t, tps, players, chunks, entities, 42_000, 3200 + Math.random() * 400, cpu]);
    }
  }
  if (type === 'playersOnline') return { keys: ['date', 'playersOnline'], values: points };
  return {
    keys: ['date', 'tps', 'playersOnline', 'chunks', 'entities', 'free_disk_space', 'ram', 'cpu'],
    values: points,
    zones: { tpsThresholdMed: 18, tpsThresholdLow: 15 },
  };
}

function mockPlayersTable(ms) {
  const now = Date.now();
  const groups = ['Very Active', 'Very Active', 'Active', 'Active', 'Active', 'Regular', 'Regular', 'Irregular', 'Irregular', 'New'];
  return {
    players: ms.players.map((name, i) => ({
      name,
      playtime: Math.max(3_600_000, 432_000_000 - i * 46_000_000),
      sessions: Math.max(2, 89 - i * 9),
      last_seen: now - (i + 1) * 3_600_000,
      activity_group: groups[Math.min(i, groups.length - 1)],
    })),
  };
}

app.use('/api/servers/:serverId/plan', withMockServer((ms, req, res) => {
  const p = req.path;
  const avgTps = ms.tpsBase.toFixed(2);
  if (p === '/v1/networkMetadata') {
    return res.json({
      currentServer: { serverName: ms.planServerName, serverUUID: `mock-uuid-${ms.planServerName}` },
      servers: [{ serverName: ms.planServerName, serverUUID: `mock-uuid-${ms.planServerName}` }],
    });
  }
  if (p === '/v1/serverOverview') {
    return res.json({
      numbers: { total_players: ms.players.length * 4, regular_players: ms.players.length, online_players: 3 },
      last_7_days: { unique_players: 18, unique_players_day: '2.57/day', new_players: 4, new_players_day: '0.57/day', average_tps: avgTps, low_tps_spikes: 2, downtime: '0s' },
      last_30_days: { unique_players: 31, new_players: 9, average_tps: avgTps },
    });
  }
  if (p === '/v1/performanceOverview') {
    return res.json({
      last_7_days: { average_tps: avgTps, low_tps_spikes: 2, average_players: '2.8', average_entities: '946', average_chunks: '4521' },
      last_30_days: { average_tps: avgTps, low_tps_spikes: 7, average_players: '2.3', average_entities: '912', average_chunks: '4380' },
    });
  }
  if (p === '/v1/playerbaseOverview') {
    return res.json({
      current_playerbase: { 'Very Active': 3, 'Active': 5, 'Regular': 4, 'Irregular': 8, 'New': 4, 'Inactive': 18 },
    });
  }
  if (p === '/v1/graph') {
    return res.json(mockPlanGraph(ms, req.query.type));
  }
  if (p === '/v1/playersTable') {
    return res.json(mockPlayersTable(ms));
  }
  res.status(404).json({ error: 'unknown Plan endpoint' });
}));

function mockRconResponse(ms, cmd) {
  const first = cmd.split(/\s+/, 1)[0].toLowerCase();
  if (cmd.toLowerCase() === 'whitelist list') {
    return `There are ${ms.whitelist.length} whitelisted player(s): ${ms.whitelist.join(', ')}`;
  }
  if (first === 'list') return `There are 3 of a max of 20 players online: ${ms.players.slice(0, 3).join(', ')}`;
  if (first === 'tps') return `TPS from last 1m, 5m, 15m: ${ms.tpsBase.toFixed(2)}, ${ms.tpsBase.toFixed(2)}, ${(ms.tpsBase + 0.1).toFixed(1)}`;
  if (first === 'forge') return `Overall: Mean tick time: 12.314 ms. Mean TPS: ${ms.tpsBase.toFixed(3)}`;
  if (first === 'say' || first === 'msg' || first === 'tell') return '';
  if (first === 'seed') return 'Seed: [-4218267558469834081]';
  if (first === 'difficulty') return 'The difficulty is Normal';
  return `(mock) executed: ${cmd}`;
}

app.get('/api/servers/:serverId/mc/config', withMockServer((ms, _req, res) => {
  res.json({ console: true, whitelist: true, logs: true, allowlist: ms.allowlist });
}));

app.post('/api/servers/:serverId/mc/command', express.json({ limit: '64kb' }), withMockServer((ms, req, res) => {
  const check = checkCommand((req.body || {}).command, ms.allowlist);
  if (!check.ok) return res.status(400).json({ error: check.error });
  setTimeout(() => res.json({ command: check.command, response: mockRconResponse(ms, check.command) }), 150);
}));

app.get('/api/servers/:serverId/mc/whitelist', withMockServer((ms, _req, res) => {
  res.json({ players: [...ms.whitelist] });
}));

app.post('/api/servers/:serverId/mc/whitelist/add', express.json({ limit: '64kb' }), withMockServer((ms, req, res) => {
  const name = (req.body || {}).name;
  if (!isValidUsername(name)) return res.status(400).json({ error: 'name must match ^[A-Za-z0-9_]{3,16}$' });
  const already = ms.whitelist.includes(name);
  if (!already) ms.whitelist.push(name);
  res.json({
    ok: true,
    result: already ? 'already' : 'added',
    response: already ? 'Player is already whitelisted' : `Added ${name} to the whitelist`,
    players: [...ms.whitelist],
  });
}));

app.post('/api/servers/:serverId/mc/whitelist/remove', express.json({ limit: '64kb' }), withMockServer((ms, req, res) => {
  const name = (req.body || {}).name;
  if (!isValidUsername(name)) return res.status(400).json({ error: 'name must match ^[A-Za-z0-9_]{3,16}$' });
  const idx = ms.whitelist.indexOf(name);
  if (idx >= 0) ms.whitelist.splice(idx, 1);
  res.json({
    ok: true,
    result: idx >= 0 ? 'removed' : 'not_found',
    response: idx >= 0 ? `Removed ${name} from the whitelist` : 'Player is not whitelisted',
    players: [...ms.whitelist],
  });
}));

function mockLogLine(ms) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const p = ms.players[Math.floor(Math.random() * ms.players.length)];
  const templates = [
    `[${hh}:${mm}:${ss}] [Server thread/INFO]: <${p}> anyone near spawn?`,
    `[${hh}:${mm}:${ss}] [Server thread/INFO]: ${p} joined the game`,
    `[${hh}:${mm}:${ss}] [Server thread/INFO]: ${p} left the game`,
    `[${hh}:${mm}:${ss}] [Server thread/INFO]: ${p} has made the advancement [Hot Stuff]`,
    `[${hh}:${mm}:${ss}] [Server thread/INFO]: Saving the game (this may take a moment!)`,
    `[${hh}:${mm}:${ss}] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running 2043ms or 40 ticks behind`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

for (const ms of mockServers.values()) {
  ms.logRing = Array.from({ length: 200 }, () => mockLogLine(ms));
  ms.logBroker = new SseBroker();
  setInterval(() => {
    const line = mockLogLine(ms);
    ms.logRing.push(line);
    if (ms.logRing.length > 2000) ms.logRing.shift();
    ms.logBroker.broadcast('line', { ts: Date.now(), line });
  }, 1500 + Math.floor(Math.random() * 2500));
}

app.get('/api/servers/:serverId/mc/logs/recent', withMockServer((ms, req, res) => {
  const n = Math.max(1, Math.min(1000, Number(req.query.lines) || 200));
  res.json({ file: ms.logFile, lines: ms.logRing.slice(-n) });
}));

app.get('/api/servers/:serverId/mc/logs/stream', withMockServer((ms, _req, res) => {
  ms.logBroker.addClient(res);
}));

// ── Page routes (clean URLs) ───────────────────────────
app.get('/monitoring', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'monitoring.html')));
app.get('/lights', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'lights.html')));
app.get('/chat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

// ── Weather mock (Open-Meteo emulation) ────────────────
app.get('/api/weather', (_req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
  const codes = [1, 2, 3, 61, 80, 95, 0];
  const sunrise = days.map((d) => `${d.toISOString().slice(0, 10)}T06:42`);
  const sunset = days.map((d) => `${d.toISOString().slice(0, 10)}T20:18`);
  res.json({
    label: 'Dev City',
    unit: 'celsius',
    current: {
      temperature_2m: 18.4 + Math.sin(Date.now() / 60000) * 1.2,
      apparent_temperature: 17.1,
      relative_humidity_2m: 64,
      weather_code: 2,
      wind_speed_10m: 11.5,
      is_day: 1,
    },
    daily: {
      time: days.map((d) => d.toISOString().slice(0, 10)),
      weather_code: codes,
      temperature_2m_max: [21, 22, 19, 17, 18, 24, 26],
      temperature_2m_min: [11, 12, 10, 9, 10, 13, 15],
      precipitation_probability_max: [10, 20, 60, 80, 70, 5, 0],
      sunrise,
      sunset,
    },
    fetchedAt: Date.now(),
  });
});

// ── Chat mock (Home Assistant /api/conversation/process emulation) ─
const chatSessions = new Map();
const CHAT_LATENCY_MS = 650;

function chatReply(text, sessionId) {
  const t = text.toLowerCase().trim();
  const session = chatSessions.get(sessionId) || { turns: 0 };
  session.turns += 1;
  chatSessions.set(sessionId, session);

  // Light control intents → action_done
  const offMatch = t.match(/(?:turn (?:off|out)|switch off|kill|shut off)\s+(?:the\s+)?(.+?)(?:\s+lights?)?$/);
  if (offMatch || /^lights?\s+off$/.test(t)) {
    const target = offMatch && offMatch[1] && offMatch[1] !== 'all' ? offMatch[1] : 'all the lights';
    for (const r of lightsState.rooms) {
      const matchRoom = !offMatch || target === 'all the lights' || r.name.toLowerCase().includes(target);
      if (!matchRoom) continue;
      for (const l of r.lights) { if (l.on) { l.on = false; l.brightness_pct = 0; broadcastLightState(l.entity_id); } }
    }
    return { speech: `Turned off ${target}.`, response_type: 'action_done' };
  }
  const onMatch = t.match(/(?:turn on|switch on)\s+(?:the\s+)?(.+?)(?:\s+lights?)?$/);
  if (onMatch || /^lights?\s+on$/.test(t)) {
    const target = onMatch && onMatch[1] && onMatch[1] !== 'all' ? onMatch[1] : 'all the lights';
    for (const r of lightsState.rooms) {
      const matchRoom = !onMatch || target === 'all the lights' || r.name.toLowerCase().includes(target);
      if (!matchRoom) continue;
      for (const l of r.lights) { if (!l.on) { l.on = true; l.brightness_pct = l.brightness_pct || 80; broadcastLightState(l.entity_id); } }
    }
    return { speech: `Turned on ${target}.`, response_type: 'action_done' };
  }
  const dimMatch = t.match(/(?:set|dim|change)\s+(?:the\s+)?(.+?)\s+(?:lights?\s+)?to\s+(\d{1,3})\s*%?/);
  if (dimMatch) {
    const target = dimMatch[1];
    const pct = Math.max(0, Math.min(100, parseInt(dimMatch[2], 10)));
    for (const r of lightsState.rooms) {
      if (!r.name.toLowerCase().includes(target)) continue;
      for (const l of r.lights) { l.on = pct > 0; l.brightness_pct = pct; broadcastLightState(l.entity_id); }
    }
    return { speech: `Set the ${target} lights to ${pct} percent.`, response_type: 'action_done' };
  }

  // Sensor-style queries
  if (/temperature|how (warm|hot|cold)/.test(t)) {
    const room = (t.match(/(living room|bedroom|kitchen|office|hallway|bathroom)/) || [])[1] || 'living room';
    const temp = (19 + Math.random() * 4).toFixed(1);
    return { speech: `It's ${temp}°C in the ${room}.`, response_type: 'query_answer' };
  }
  if (/weather|forecast/.test(t)) {
    return { speech: 'It\'s 14°C and partly cloudy. High of 17°C, low of 9°C tonight.', response_type: 'query_answer' };
  }
  if (/who('s| is) home|anyone home/.test(t)) {
    return { speech: 'You and one other person are home right now.', response_type: 'query_answer' };
  }
  if (/lights? (are )?on|how many lights/.test(t)) {
    const all = lightsState.rooms.flatMap((r) => r.lights);
    const onCount = all.filter((l) => l.on).length;
    return { speech: `${onCount} of ${all.length} lights are on.`, response_type: 'query_answer' };
  }

  // Generic LLM-style fallback
  if (session.turns === 1) {
    return { speech: 'Hi — I\'m the mock Assist agent. Try "turn off the living room lights" or "what\'s the temperature in the kitchen?"', response_type: 'action_done' };
  }
  return { speech: `(mock) I heard "${text}" but I don\'t have a real LLM in dev. Try a light command like "turn on the office".`, response_type: 'action_done' };
}

app.post('/api/chat', express.json({ limit: '64kb' }), (req, res) => {
  const { text, conversation_id } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text must be a non-empty string' });
  if (text.length > 4000) return res.status(400).json({ error: 'text exceeds 4000 chars' });
  const sessionId = conversation_id || `mock-${Math.random().toString(36).slice(2, 10)}`;
  setTimeout(() => {
    const reply = chatReply(text.trim(), sessionId);
    res.json({
      conversation_id: sessionId,
      speech: reply.speech,
      response_type: reply.response_type,
      raw: { mock: true },
    });
  }, CHAT_LATENCY_MS + Math.random() * 400);
});

// ── Alerts mock ────────────────────────────────────────
const mockActiveAlerts = [];
const mockAlertHistory = [
  { ts: Date.now() - 6 * 3600_000, kind: 'firing',   machine: 'proxmox-dmz', guest: 'val-srv',   metric: 'cpuPct',  value: 92, threshold: 85 },
  { ts: Date.now() - 5.5 * 3600_000, kind: 'resolved', machine: 'proxmox-dmz', guest: 'val-srv', metric: 'cpuPct',  value: 60, threshold: 85 },
  { ts: Date.now() - 26 * 3600_000, kind: 'firing',   machine: 'nas',         guest: null,        metric: 'diskPct', value: 88, threshold: 85 },
  { ts: Date.now() - 24 * 3600_000, kind: 'resolved', machine: 'nas',         guest: null,        metric: 'diskPct', value: 70, threshold: 85 },
];
app.get('/api/alerts/active', (_req, res) => res.json({ active: mockActiveAlerts }));
app.get('/api/alerts', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit ?? '100', 10) || 100));
  res.json({ events: mockAlertHistory.slice(0, limit) });
});

// ── Lights mock (Home Assistant emulation) ─────────────
const lightsState = {
  rooms: [
    { id: 'living-room', name: 'Living Room', lights: [
      { entity_id: 'light.living_room_main',  name: 'Living Room Main',  on: true,  reachable: true, brightness_pct: 80, rgb: [255, 184, 108], supports_color: true },
      { entity_id: 'light.living_room_lamp',  name: 'Living Room Lamp',  on: true,  reachable: true, brightness_pct: 45, rgb: [189, 147, 249], supports_color: true },
      { entity_id: 'light.tv_backlight',      name: 'TV Backlight',      on: false, reachable: true, brightness_pct: 0,  rgb: [80, 250, 123],  supports_color: true },
    ], scenes: [
      { entity_id: 'scene.living_room_movie',  name: 'Movie Night' },
      { entity_id: 'scene.living_room_bright', name: 'Bright' },
    ]},
    { id: 'bedroom', name: 'Bedroom', lights: [
      { entity_id: 'light.bedroom_ceiling',  name: 'Bedroom Ceiling',  on: false, reachable: true, brightness_pct: 0,  rgb: [255, 121, 198], supports_color: true },
      { entity_id: 'light.bedside_left',     name: 'Bedside Left',     on: false, reachable: true, brightness_pct: 0,  rgb: null,            supports_color: false },
      { entity_id: 'light.bedside_right',    name: 'Bedside Right',    on: false, reachable: true, brightness_pct: 0,  rgb: null,            supports_color: false },
    ], scenes: [
      { entity_id: 'scene.bedroom_wakeup',   name: 'Wake Up' },
      { entity_id: 'scene.bedroom_sleep',    name: 'Sleep' },
    ]},
    { id: 'kitchen', name: 'Kitchen', lights: [
      { entity_id: 'light.kitchen_main',    name: 'Kitchen Main',    on: true,  reachable: true, brightness_pct: 100, rgb: null,            supports_color: false },
      { entity_id: 'light.kitchen_under',   name: 'Under Cabinet',   on: false, reachable: true, brightness_pct: 0,   rgb: [139, 233, 253], supports_color: true },
    ], scenes: [
      { entity_id: 'scene.kitchen_cooking', name: 'Cooking' },
    ]},
    { id: 'office', name: 'Office', lights: [
      { entity_id: 'light.office_desk',     name: 'Desk Lamp',       on: true,  reachable: true, brightness_pct: 60, rgb: [139, 233, 253], supports_color: true },
      { entity_id: 'light.office_overhead', name: 'Office Overhead', on: false, reachable: false, brightness_pct: 0, rgb: null,            supports_color: false },
    ], scenes: [
      { entity_id: 'scene.office_focus',    name: 'Focus' },
    ]},
  ],
  unassigned: {
    lights: [
      { entity_id: 'light.hallway',   name: 'Hallway',   on: false, reachable: true, brightness_pct: 0, rgb: null, supports_color: false },
    ],
    scenes: [],
  },
};

const scenePresets = {
  'scene.living_room_movie':  [
    { entity_id: 'light.living_room_main', on: true, brightness_pct: 15, rgb: [255, 85, 85] },
    { entity_id: 'light.living_room_lamp', on: true, brightness_pct: 25, rgb: [189, 147, 249] },
    { entity_id: 'light.tv_backlight',     on: true, brightness_pct: 50, rgb: [80, 250, 123] },
  ],
  'scene.living_room_bright': [
    { entity_id: 'light.living_room_main', on: true, brightness_pct: 100, rgb: [255, 255, 255] },
    { entity_id: 'light.living_room_lamp', on: true, brightness_pct: 100, rgb: [255, 248, 220] },
    { entity_id: 'light.tv_backlight',     on: false },
  ],
  'scene.bedroom_wakeup': [
    { entity_id: 'light.bedroom_ceiling', on: true, brightness_pct: 70, rgb: [255, 184, 108] },
    { entity_id: 'light.bedside_left',    on: true, brightness_pct: 50 },
    { entity_id: 'light.bedside_right',   on: true, brightness_pct: 50 },
  ],
  'scene.bedroom_sleep': [
    { entity_id: 'light.bedroom_ceiling', on: false },
    { entity_id: 'light.bedside_left',    on: true, brightness_pct: 5 },
    { entity_id: 'light.bedside_right',   on: false },
  ],
  'scene.kitchen_cooking': [
    { entity_id: 'light.kitchen_main',  on: true, brightness_pct: 100 },
    { entity_id: 'light.kitchen_under', on: true, brightness_pct: 80, rgb: [255, 255, 255] },
  ],
  'scene.office_focus': [
    { entity_id: 'light.office_desk',     on: true, brightness_pct: 100, rgb: [255, 255, 255] },
    { entity_id: 'light.office_overhead', on: true, brightness_pct: 80 },
  ],
};

const lightsBroker = new SseBroker();

function findLight(entityId) {
  for (const r of lightsState.rooms) {
    const l = r.lights.find((x) => x.entity_id === entityId);
    if (l) return l;
  }
  return lightsState.unassigned.lights.find((x) => x.entity_id === entityId) || null;
}

function applyLightPatch(entityId, patch) {
  const l = findLight(entityId);
  if (!l) return null;
  if (patch.on === false) {
    l.on = false;
    l.brightness_pct = 0;
  } else {
    if (patch.on === true) l.on = true;
    if (typeof patch.brightness_pct === 'number') {
      l.brightness_pct = patch.brightness_pct;
      l.on = patch.brightness_pct > 0;
    }
    if (Array.isArray(patch.rgb_color) && patch.rgb_color.length === 3 && l.supports_color) {
      l.rgb = patch.rgb_color.slice();
      l.on = true;
      if (l.brightness_pct === 0) l.brightness_pct = 100;
    }
  }
  return l;
}

function broadcastLightState(entityId) {
  const l = findLight(entityId);
  if (!l) return;
  lightsBroker.broadcast('state', {
    kind: 'light',
    entity_id: entityId,
    state: {
      on: l.on,
      reachable: l.reachable,
      brightness_pct: l.brightness_pct,
      rgb: l.rgb,
      supports_color: l.supports_color,
    },
  });
}

app.get('/api/lights', (_req, res) => res.json(lightsState));

app.post('/api/lights/:entity_id', express.json({ limit: '64kb' }), (req, res) => {
  const entityId = req.params.entity_id;
  if (!entityId.startsWith('light.')) return res.status(400).json({ error: 'entity_id must be a light.* entity' });
  const allowed = new Set(['on', 'brightness_pct', 'rgb_color']);
  for (const k of Object.keys(req.body || {})) {
    if (!allowed.has(k)) return res.status(400).json({ error: `unknown field: ${k}` });
  }
  const updated = applyLightPatch(entityId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'unknown entity' });
  broadcastLightState(entityId);
  res.json({ ok: true });
});

app.post('/api/scenes/:entity_id/activate', (req, res) => {
  const entityId = req.params.entity_id;
  if (!entityId.startsWith('scene.')) return res.status(400).json({ error: 'entity_id must be a scene.* entity' });
  const preset = scenePresets[entityId];
  if (!preset) return res.status(404).json({ error: 'unknown scene' });
  for (const p of preset) {
    applyLightPatch(p.entity_id, p);
    broadcastLightState(p.entity_id);
  }
  res.json({ ok: true });
});

app.get('/api/lights/stream', (_req, res) => {
  lightsBroker.addClient(res);
  res.write(`event: snapshot\ndata: ${JSON.stringify(lightsState)}\n\n`);
});

app.use(express.static(path.join(__dirname, 'public')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[dev] homelab-dashboard dev server on http://localhost:${port}`);
  console.log(`[dev] mocked scrapers drifting every ${devConfig.server.pollIntervalMs}ms`);
  console.log(`[dev] storage at ${path.join(dataDir, 'dev.db')}`);
});
