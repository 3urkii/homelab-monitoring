const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { Poller } = require('./lib/poller.js');
const { AlertManager } = require('./lib/alerts.js');
const { Storage, METRIC_COLUMNS } = require('./lib/storage.js');
const proxmox = require('./lib/proxmox.js');
const nodeExporter = require('./lib/node_exporter.js');
const { HAClient, pctToBrightness } = require('./lib/home_assistant.js');
const { SseBroker } = require('./lib/sse_broker.js');

const ROLLUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const RANGE_PRESETS = {
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') errors.push('config.js must export an object');
  if (!cfg.server || typeof cfg.server.port !== 'number') errors.push('server.port must be a number');
  if (!Array.isArray(cfg.machines) || cfg.machines.length === 0) errors.push('machines must be a non-empty array');
  const machineNames = new Set();
  for (const [i, m] of (cfg.machines ?? []).entries()) {
    if (!m.name) errors.push(`machines[${i}].name is required`);
    if (!['proxmox', 'node_exporter'].includes(m.type)) errors.push(`machines[${i}].type must be 'proxmox' or 'node_exporter'`);
    if (!m.host || m.host === 'REPLACE_ME') errors.push(`machines[${i}].host must be set (not REPLACE_ME)`);
    if (m.type === 'proxmox') {
      if (!m.tokenId || m.tokenId === 'REPLACE_ME') errors.push(`machines[${i}].tokenId must be set`);
      if (!m.tokenSecret || m.tokenSecret === 'REPLACE_ME') errors.push(`machines[${i}].tokenSecret must be set`);
    }
    if (m.type === 'node_exporter' && !m.port) errors.push(`machines[${i}].port required for node_exporter`);
    if (m.label !== undefined && (typeof m.label !== 'string' || !m.label)) errors.push(`machines[${i}].label must be a non-empty string if set`);
    machineNames.add(m.name);
  }
  for (const [i, l] of (cfg.guestLinks ?? []).entries()) {
    if (!l.machine || !machineNames.has(l.machine)) errors.push(`guestLinks[${i}].machine '${l.machine}' not in machines`);
    if (!l.guest) errors.push(`guestLinks[${i}].guest is required`);
    if (!l.url) errors.push(`guestLinks[${i}].url is required`);
  }
  if (cfg.alerts !== undefined) {
    const a = cfg.alerts;
    if (!a || typeof a !== 'object') errors.push('alerts must be an object');
    if (!a.ntfy || typeof a.ntfy.url !== 'string' || !a.ntfy.url || a.ntfy.url.includes('REPLACE_ME')) {
      errors.push('alerts.ntfy.url must be a non-empty URL');
    }
    if (!a.defaults || typeof a.defaults !== 'object') {
      errors.push('alerts.defaults must be an object');
    } else {
      for (const k of ['cpuPct', 'memPct', 'diskPct']) {
        const v = a.defaults[k];
        if (typeof v !== 'number' || v < 0 || v > 100) errors.push(`alerts.defaults.${k} must be a number in [0,100]`);
      }
      if (typeof a.defaults.forMs !== 'number' || a.defaults.forMs <= 0) errors.push('alerts.defaults.forMs must be a positive number');
    }
    for (const [i, o] of (a.overrides ?? []).entries()) {
      if (!o.machine || !machineNames.has(o.machine)) errors.push(`alerts.overrides[${i}].machine '${o.machine}' not in machines`);
    }
  }
  if (cfg.plan !== undefined) {
    if (!cfg.plan || typeof cfg.plan !== 'object') {
      errors.push('plan must be an object');
    } else {
      if (!cfg.plan.url || typeof cfg.plan.url !== 'string' || cfg.plan.url.includes('REPLACE_ME')) {
        errors.push('plan.url must be a non-empty URL');
      }
      if (!cfg.plan.machine || cfg.plan.machine === 'REPLACE_ME') errors.push('plan.machine is required');
      if (!cfg.plan.guest || cfg.plan.guest === 'REPLACE_ME') errors.push('plan.guest is required');
    }
  }
  if (cfg.network !== undefined) {
    const n = cfg.network;
    if (!n || typeof n !== 'object') {
      errors.push('network must be an object');
    } else {
      if (!n.url || typeof n.url !== 'string' || n.url.includes('REPLACE_ME')) {
        errors.push('network.url must be a non-empty URL');
      }
      if (n.label !== undefined && (typeof n.label !== 'string' || !n.label)) {
        errors.push('network.label must be a non-empty string if set');
      }
      if (n.gateway !== undefined && (typeof n.gateway !== 'string' || !n.gateway)) {
        errors.push('network.gateway must be a non-empty string if set');
      }
    }
  }
  if (cfg.weather !== undefined) {
    const w = cfg.weather;
    if (!w || typeof w !== 'object') {
      errors.push('weather must be an object');
    } else {
      if (typeof w.latitude !== 'number' || w.latitude < -90 || w.latitude > 90) {
        errors.push('weather.latitude must be a number in [-90,90]');
      }
      if (typeof w.longitude !== 'number' || w.longitude < -180 || w.longitude > 180) {
        errors.push('weather.longitude must be a number in [-180,180]');
      }
      if (w.label !== undefined && (typeof w.label !== 'string' || !w.label)) {
        errors.push('weather.label must be a non-empty string if set');
      }
      if (w.unit !== undefined && !['celsius', 'fahrenheit'].includes(w.unit)) {
        errors.push("weather.unit must be 'celsius' or 'fahrenheit' if set");
      }
    }
  }
  if (cfg.homeAssistant !== undefined) {
    const ha = cfg.homeAssistant;
    if (!ha || typeof ha !== 'object') {
      errors.push('homeAssistant must be an object');
    } else {
      if (!ha.url || typeof ha.url !== 'string' || ha.url.includes('REPLACE_ME')) {
        errors.push('homeAssistant.url must be a non-empty URL');
      }
      if (!ha.token || typeof ha.token !== 'string' || ha.token.includes('REPLACE_ME')) {
        errors.push('homeAssistant.token must be a non-empty long-lived access token');
      }
      if (ha.conversationAgentId !== undefined && (typeof ha.conversationAgentId !== 'string' || !ha.conversationAgentId)) {
        errors.push('homeAssistant.conversationAgentId must be a non-empty string if set');
      }
      if (ha.conversationLanguage !== undefined && (typeof ha.conversationLanguage !== 'string' || !ha.conversationLanguage)) {
        errors.push('homeAssistant.conversationLanguage must be a non-empty string if set');
      }
    }
  }
  if (errors.length) {
    throw new Error('config.js validation failed:\n  - ' + errors.join('\n  - '));
  }
}

function main() {
  let config;
  try {
    config = require('./config.js');
    validateConfig(config);
  } catch (err) {
    console.error(`[fatal] ${err.message}`);
    process.exit(1);
  }

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const storage = new Storage(path.join(dataDir, 'dashboard.db'));
  setInterval(() => {
    try {
      storage.rollup();
      storage.pruneAlertEvents();
    } catch (err) {
      console.error(`[storage] rollup failed: ${err.message}`);
    }
  }, ROLLUP_INTERVAL_MS);

  const alertManager = config.alerts
    ? new AlertManager({ config: config.alerts, storage })
    : null;

  const poller = new Poller(config, {
    scrapers: {
      proxmox: (entry) => proxmox.fetch({ ...entry, proxmoxTimeoutMs: config.server.proxmoxTimeoutMs }),
      node_exporter: (entry) => nodeExporter.fetch({ ...entry, nodeExporterTimeoutMs: config.server.nodeExporterTimeoutMs }),
    },
    storage,
    alertManager,
  });
  poller.start();

  let haClient = null;
  let haBroker = null;
  if (config.homeAssistant) {
    haClient = new HAClient(config.homeAssistant);
    haBroker = new SseBroker();
    haClient.on('snapshot', (snap) => haBroker.broadcast('snapshot', snap));
    haClient.on('state', (evt) => haBroker.broadcast('state', evt));
    haClient.on('disconnect', () => haBroker.broadcast('offline', { connected: false }));
    haClient.start();
  }

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.get('/monitoring', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'monitoring.html')));
  app.get('/api/stats', (_req, res) => res.json(poller.getState()));

  app.get('/api/landing-config', (_req, res) => {
    res.json({
      network: config.network
        ? {
            url: config.network.url,
            label: config.network.label || 'unifi controller',
            gateway: config.network.gateway || null,
          }
        : null,
    });
  });

  app.get('/api/history', (req, res) => {
    try {
      const { machine, guest, range } = req.query;
      const metrics = String(req.query.metrics ?? 'cpu,memUsed,memTotal,diskUsed,diskTotal,netRx,netTx')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!machine) return res.status(400).json({ error: 'machine query param is required' });
      const rangeMs = RANGE_PRESETS[range] ?? RANGE_PRESETS['24h'];
      const toTs = Date.now();
      const fromTs = toTs - rangeMs;
      const result = {};
      for (const metric of metrics) {
        if (!METRIC_COLUMNS[metric]) {
          return res.status(400).json({ error: `unknown metric: ${metric}` });
        }
        result[metric] = storage.query({
          machine,
          guest: guest || null,
          metric,
          fromTs,
          toTs,
        });
      }
      res.json({ machine, guest: guest || null, range, fromTs, toTs, metrics: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/alerts', (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit ?? '100', 10) || 100));
      const machine = req.query.machine || null;
      const guest = req.query.guest || null;
      res.json({ events: storage.listAlertEvents({ limit, machine, guest }) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/alerts/active', (_req, res) => {
    try {
      res.json({ active: alertManager ? alertManager.getActive() : [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  if (config.homeAssistant) {
    app.get('/lights', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'lights.html')));

    app.get('/api/lights', (_req, res) => {
      if (!haClient.isConnected()) {
        return res.status(503).json({ error: 'Home Assistant offline' });
      }
      res.json(haClient.getSnapshot());
    });

    app.post('/api/lights/:entity_id', async (req, res) => {
      const entityId = req.params.entity_id;
      if (!entityId.startsWith('light.')) {
        return res.status(400).json({ error: 'entity_id must be a light.* entity' });
      }
      const { on, brightness_pct, rgb_color } = req.body || {};
      const allowed = new Set(['on', 'brightness_pct', 'rgb_color']);
      for (const k of Object.keys(req.body || {})) {
        if (!allowed.has(k)) return res.status(400).json({ error: `unknown field: ${k}` });
      }
      try {
        if (on === false && brightness_pct == null && rgb_color == null) {
          await haClient.callService('light', 'turn_off', { entity_id: entityId });
        } else {
          const data = { entity_id: entityId };
          if (brightness_pct != null) {
            if (typeof brightness_pct !== 'number' || brightness_pct < 0 || brightness_pct > 100) {
              return res.status(400).json({ error: 'brightness_pct must be 0..100' });
            }
            data.brightness = pctToBrightness(brightness_pct);
          }
          if (rgb_color != null) {
            if (
              !Array.isArray(rgb_color) || rgb_color.length !== 3 ||
              !rgb_color.every((c) => typeof c === 'number' && c >= 0 && c <= 255)
            ) {
              return res.status(400).json({ error: 'rgb_color must be [r,g,b] each 0..255' });
            }
            data.rgb_color = rgb_color;
          }
          await haClient.callService('light', 'turn_on', data);
        }
        res.json({ ok: true });
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });

    app.post('/api/scenes/:entity_id/activate', async (req, res) => {
      const entityId = req.params.entity_id;
      if (!entityId.startsWith('scene.')) {
        return res.status(400).json({ error: 'entity_id must be a scene.* entity' });
      }
      try {
        await haClient.callService('scene', 'turn_on', { entity_id: entityId });
        res.json({ ok: true });
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });

    app.get('/chat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

    let agentInfoCache = { at: 0, value: null };
    app.get('/api/chat/agent-info', async (_req, res) => {
      if (!haClient.isConnected()) {
        return res.status(503).json({ error: 'home assistant offline' });
      }
      const now = Date.now();
      if (agentInfoCache.value && now - agentInfoCache.at < 60_000) {
        return res.json(agentInfoCache.value);
      }
      try {
        const info = await haClient.getConversationAgentInfo(
          config.homeAssistant.conversationAgentId,
        );
        agentInfoCache = { at: now, value: info };
        res.json(info);
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });

    app.post('/api/chat', async (req, res) => {
      const { text, conversation_id } = req.body || {};
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text must be a non-empty string' });
      }
      if (text.length > 4000) {
        return res.status(400).json({ error: 'text exceeds 4000 chars' });
      }
      if (conversation_id !== undefined && (typeof conversation_id !== 'string' || conversation_id.length > 128)) {
        return res.status(400).json({ error: 'conversation_id must be a string up to 128 chars' });
      }
      try {
        const result = await haClient.conversationProcess({
          text: text.trim(),
          conversation_id: conversation_id || undefined,
          agent_id: config.homeAssistant.conversationAgentId,
          language: config.homeAssistant.conversationLanguage || 'en',
        });
        const speech = result?.response?.response?.speech?.plain?.speech
          ?? result?.response?.speech?.plain?.speech
          ?? '';
        const responseType = result?.response?.response_type
          ?? result?.response?.response?.response_type
          ?? null;
        res.json({
          conversation_id: result?.conversation_id || conversation_id || null,
          speech,
          response_type: responseType,
          raw: result,
        });
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });

    app.get('/api/lights/stream', (req, res) => {
      haBroker.addClient(res);
      if (haClient.isConnected()) {
        res.write(`event: snapshot\ndata: ${JSON.stringify(haClient.getSnapshot())}\n\n`);
      } else {
        res.write(`event: offline\ndata: ${JSON.stringify({ connected: false })}\n\n`);
      }
    });
  }

  if (config.plan) {
    app.get('/plan', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'plan.html')));

    app.get('/api/plan-config', (_req, res) => {
      res.json({ machine: config.plan.machine, guest: config.plan.guest });
    });

    app.use('/api/plan', async (req, res) => {
      const target = new URL(req.path, config.plan.url);
      for (const [k, v] of Object.entries(req.query)) target.searchParams.set(k, v);
      try {
        const resp = await globalThis.fetch(target.toString(), { signal: AbortSignal.timeout(10_000) });
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('json')) {
          res.status(resp.status).json(await resp.json());
        } else {
          res.status(resp.status).type(ct).send(await resp.text());
        }
      } catch (err) {
        res.status(502).json({ error: `Plan API: ${err.message}` });
      }
    });
  }

  if (config.weather) {
    const WEATHER_TTL_MS = 10 * 60 * 1000;
    let weatherCache = null;
    let weatherCacheAt = 0;
    let weatherInflight = null;

    async function fetchWeather() {
      const unit = config.weather.unit || 'celsius';
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(config.weather.latitude));
      url.searchParams.set('longitude', String(config.weather.longitude));
      url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day');
      url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset');
      url.searchParams.set('temperature_unit', unit);
      url.searchParams.set('wind_speed_unit', 'kmh');
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('forecast_days', '7');
      const resp = await globalThis.fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      const data = await resp.json();
      return {
        label: config.weather.label || null,
        unit,
        current: data.current || null,
        daily: data.daily || null,
        fetchedAt: Date.now(),
      };
    }

    app.get('/api/weather', async (_req, res) => {
      const now = Date.now();
      if (weatherCache && now - weatherCacheAt < WEATHER_TTL_MS) {
        return res.json(weatherCache);
      }
      try {
        if (!weatherInflight) {
          weatherInflight = fetchWeather().finally(() => { weatherInflight = null; });
        }
        const fresh = await weatherInflight;
        weatherCache = fresh;
        weatherCacheAt = Date.now();
        res.json(weatherCache);
      } catch (err) {
        if (weatherCache) {
          return res.json({ ...weatherCache, stale: true, error: err.message });
        }
        res.status(502).json({ error: err.message });
      }
    });
  }

  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(config.server.port, () => {
    console.log(`[dashboard] listening on http://0.0.0.0:${config.server.port}`);
    console.log(`[dashboard] polling every ${config.server.pollIntervalMs}ms`);
    console.log(`[dashboard] storage at ${path.join(dataDir, 'dashboard.db')}`);
  });
}

main();
