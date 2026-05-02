const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { Poller } = require('./lib/poller.js');
const { Storage, METRIC_COLUMNS } = require('./lib/storage.js');
const { SseBroker } = require('./lib/sse_broker.js');

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
  plan: {
    url: 'http://mock',
    machine: 'proxmox-dmz',
    guest: 'mc-server',
  },
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

// ── Plan mock API ──────────────────────────────────────
app.get('/plan', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'plan.html')));
app.get('/api/plan-config', (_req, res) => res.json({ machine: devConfig.plan.machine, guest: devConfig.plan.guest }));

function mockPlanGraph(type) {
  const now = Date.now();
  const points = [];
  var step = type === 'playersOnline' ? 300_000 : 300_000;
  for (let t = now - 7 * 24 * 3600_000; t <= now; t += step) {
    const hour = new Date(t).getHours();
    const activity = Math.sin((hour - 6) * Math.PI / 12);
    if (type === 'playersOnline') {
      points.push([t, Math.max(0, Math.round(3 + activity * 4 + (Math.random() - 0.5) * 2))]);
    } else {
      const tps = Math.min(20, Math.max(14, 19.8 - Math.random() * 0.6 + activity * 0.3));
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

app.use('/api/plan', (req, res) => {
  const p = req.path;
  if (p === '/v1/networkMetadata') {
    return res.json({
      currentServer: { serverName: 'Survival', serverUUID: 'mock-uuid-001' },
      servers: [{ serverName: 'Survival', serverUUID: 'mock-uuid-001' }],
    });
  }
  if (p === '/v1/serverOverview') {
    return res.json({
      numbers: { total_players: 42, regular_players: 12, online_players: 3 },
      last_7_days: { unique_players: 18, unique_players_day: '2.57/day', new_players: 4, new_players_day: '0.57/day', average_tps: '19.94', low_tps_spikes: 2, downtime: '0s' },
      last_30_days: { unique_players: 31, new_players: 9, average_tps: '19.91' },
    });
  }
  if (p === '/v1/performanceOverview') {
    return res.json({
      last_7_days: { average_tps: '19.94', low_tps_spikes: 2, average_players: '2.8', average_entities: '946', average_chunks: '4521' },
      last_30_days: { average_tps: '19.91', low_tps_spikes: 7, average_players: '2.3', average_entities: '912', average_chunks: '4380' },
    });
  }
  if (p === '/v1/playerbaseOverview') {
    return res.json({
      current_playerbase: { 'Very Active': 3, 'Active': 5, 'Regular': 4, 'Irregular': 8, 'New': 4, 'Inactive': 18 },
    });
  }
  if (p === '/v1/graph') {
    return res.json(mockPlanGraph(req.query.type));
  }
  if (p === '/v1/playersTable') {
    const now = Date.now();
    return res.json({ players: [
      { name: 'xXDragonSlayerXx', playtime: 432000000, sessions: 89,  last_seen: now - 3600000,    activity_group: 'Very Active' },
      { name: 'CraftQueen',       playtime: 310000000, sessions: 67,  last_seen: now - 7200000,    activity_group: 'Very Active' },
      { name: 'BlockMaster99',    playtime: 248000000, sessions: 52,  last_seen: now - 14400000,   activity_group: 'Active' },
      { name: 'RedstoneWiz',      playtime: 198000000, sessions: 41,  last_seen: now - 86400000,   activity_group: 'Active' },
      { name: 'SkyBuilder',       playtime: 156000000, sessions: 38,  last_seen: now - 43200000,   activity_group: 'Active' },
      { name: 'MinerJoe',         playtime: 124000000, sessions: 30,  last_seen: now - 172800000,  activity_group: 'Regular' },
      { name: 'EnderKnight',      playtime: 89000000,  sessions: 22,  last_seen: now - 259200000,  activity_group: 'Regular' },
      { name: 'PixelFarmer',      playtime: 67000000,  sessions: 15,  last_seen: now - 345600000,  activity_group: 'Irregular' },
      { name: 'NetherExplorer',   playtime: 45000000,  sessions: 9,   last_seen: now - 604800000,  activity_group: 'Irregular' },
      { name: 'newbie_steve',     playtime: 3600000,   sessions: 2,   last_seen: now - 86400000,   activity_group: 'New' },
    ]});
  }
  res.status(404).json({ error: 'unknown Plan endpoint' });
});

// ── Page routes (clean URLs) ───────────────────────────
app.get('/monitoring', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'monitoring.html')));
app.get('/lights', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'lights.html')));
app.get('/chat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

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
