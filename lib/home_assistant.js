const EventEmitter = require('node:events');
const WebSocket = require('ws');

const COLOR_MODES_WITH_COLOR = new Set(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);
const SCENE_LABEL = 'dashboard';

function pctToBrightness(pct) {
  if (pct == null) return null;
  const clamped = Math.max(0, Math.min(100, Number(pct)));
  return Math.round((clamped / 100) * 255);
}

function brightnessToPct(brightness) {
  if (brightness == null) return null;
  return Math.round((Number(brightness) / 255) * 100);
}

function lightSupportsColor(stateAttrs) {
  const modes = stateAttrs?.supported_color_modes;
  if (!Array.isArray(modes)) return false;
  return modes.some((m) => COLOR_MODES_WITH_COLOR.has(m));
}

function parseLightState(state) {
  const attrs = state.attributes || {};
  const on = state.state === 'on';
  const reachable = state.state !== 'unavailable';
  const rgb = Array.isArray(attrs.rgb_color) && attrs.rgb_color.length === 3
    ? attrs.rgb_color.map(Number)
    : null;
  return {
    entity_id: state.entity_id,
    name: attrs.friendly_name || state.entity_id,
    on,
    reachable,
    brightness_pct: on ? brightnessToPct(attrs.brightness) : 0,
    rgb,
    supports_color: lightSupportsColor(attrs),
  };
}

function parseSceneState(state) {
  const attrs = state.attributes || {};
  return {
    entity_id: state.entity_id,
    name: attrs.friendly_name || state.entity_id,
  };
}

function parseMediaPlayerState(state) {
  const attrs = state.attributes || {};
  const s = state.state;
  return {
    entity_id: state.entity_id,
    name: attrs.friendly_name || state.entity_id,
    state: s,
    on: s === 'on' || s === 'playing' || s === 'paused',
    source: attrs.source || null,
    source_list: Array.isArray(attrs.source_list) ? attrs.source_list : [],
    volume_level: typeof attrs.volume_level === 'number' ? attrs.volume_level : null,
    is_volume_muted: !!attrs.is_volume_muted,
  };
}

function buildEntityToAreaMap(entities, devices) {
  const deviceArea = new Map();
  for (const d of devices) deviceArea.set(d.id, d.area_id || null);
  const out = new Map();
  for (const e of entities) {
    const direct = e.area_id || null;
    const viaDevice = e.device_id ? deviceArea.get(e.device_id) || null : null;
    out.set(e.entity_id, direct || viaDevice);
  }
  return out;
}

function parseLights(states, areas, devices, entities) {
  const entityArea = buildEntityToAreaMap(entities, devices);
  const areaById = new Map(areas.map((a) => [a.area_id, a.name]));
  const dashboardScenes = new Set(
    entities
      .filter((e) => e.entity_id?.startsWith('scene.') && Array.isArray(e.labels) && e.labels.includes(SCENE_LABEL))
      .map((e) => e.entity_id),
  );

  const rooms = new Map();
  const ensureRoom = (id, name) => {
    if (!rooms.has(id)) rooms.set(id, { id, name, lights: [], scenes: [] });
    return rooms.get(id);
  };

  const unassigned = { lights: [], scenes: [] };

  for (const s of states) {
    if (!s?.entity_id) continue;
    const [domain] = s.entity_id.split('.');
    if (domain !== 'light' && domain !== 'scene') continue;
    const areaId = entityArea.get(s.entity_id) || null;
    if (domain === 'light') {
      const light = parseLightState(s);
      if (areaId && areaById.has(areaId)) {
        ensureRoom(areaId, areaById.get(areaId)).lights.push(light);
      } else {
        unassigned.lights.push(light);
      }
    } else {
      if (!dashboardScenes.has(s.entity_id)) continue;
      const scene = parseSceneState(s);
      if (areaId && areaById.has(areaId)) {
        ensureRoom(areaId, areaById.get(areaId)).scenes.push(scene);
      } else {
        unassigned.scenes.push(scene);
      }
    }
  }

  const roomList = [...rooms.values()]
    .map((r) => ({
      ...r,
      lights: r.lights.sort((a, b) => a.name.localeCompare(b.name)),
      scenes: r.scenes.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    rooms: roomList,
    unassigned: {
      lights: unassigned.lights.sort((a, b) => a.name.localeCompare(b.name)),
      scenes: unassigned.scenes.sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

function isLightOrScene(entity_id) {
  if (!entity_id) return false;
  const [domain] = entity_id.split('.');
  return domain === 'light' || domain === 'scene';
}

function isTracked(entity_id, trackedMediaPlayers) {
  if (!entity_id) return false;
  const [domain] = entity_id.split('.');
  if (domain === 'light' || domain === 'scene') return true;
  if (domain === 'media_player') return trackedMediaPlayers?.has(entity_id) ?? false;
  return false;
}

class HAClient extends EventEmitter {
  #url;
  #token;
  #wsUrl;
  #restUrl;
  #ws = null;
  #msgId = 1;
  #pending = new Map();
  #connected = false;
  #stopped = false;
  #reconnectAttempt = 0;
  #reconnectTimer = null;

  #states = new Map();
  #areas = [];
  #devices = [];
  #entities = [];

  constructor({ url, token }) {
    super();
    this.#url = url.replace(/\/$/, '');
    this.#token = token;
    const u = new URL(this.#url);
    const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
    this.#wsUrl = `${wsScheme}//${u.host}/api/websocket`;
    this.#restUrl = this.#url;
  }

  isConnected() {
    return this.#connected;
  }

  start() {
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#ws) {
      try { this.#ws.close(); } catch {}
    }
  }

  getSnapshot() {
    return parseLights(
      [...this.#states.values()],
      this.#areas,
      this.#devices,
      this.#entities,
    );
  }

  async getConversationAgentInfo(agent_id) {
    if (!agent_id) return null;
    const entity = this.#entities.find((e) => e.entity_id === agent_id);
    if (!entity) {
      return { agent_id, domain: null, model: null, name: null };
    }
    let domain = null;
    let entryTitle = null;
    if (entity.config_entry_id) {
      try {
        const entries = await this.#sendCommand('config_entries/get');
        const entry = entries.find((c) => c.entry_id === entity.config_entry_id);
        if (entry) {
          domain = entry.domain || null;
          entryTitle = entry.title || null;
        }
      } catch {}
    }
    let model = null;
    let deviceName = null;
    if (entity.device_id) {
      const device = this.#devices.find((d) => d.id === entity.device_id);
      if (device) {
        const base = typeof device.model === 'string' && device.model ? device.model : null;
        const ver = typeof device.sw_version === 'string' && device.sw_version ? device.sw_version : null;
        if (base) model = ver ? `${base}:${ver}` : base;
        deviceName = device.name_by_user || device.name || null;
      }
    }
    return {
      agent_id,
      domain,
      model,
      name: deviceName || entryTitle || entity.original_name || null,
    };
  }

  async conversationProcess({ text, conversation_id, agent_id, language }) {
    const url = `${this.#restUrl}/api/conversation/process`;
    const body = { text };
    if (conversation_id) body.conversation_id = conversation_id;
    if (agent_id) body.agent_id = agent_id;
    if (language) body.language = language;
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HA conversation/process HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return res.json();
  }

  async callService(domain, service, data = {}) {
    const target = data.entity_id ? { entity_id: data.entity_id } : undefined;
    const service_data = { ...data };
    delete service_data.entity_id;
    const url = `${this.#restUrl}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
    const body = target
      ? { ...service_data, entity_id: target.entity_id }
      : service_data;
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`HA service ${domain}.${service} failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  #connect() {
    if (this.#stopped) return;
    this.#ws = new WebSocket(this.#wsUrl);
    this.#ws.on('open', () => {
      // wait for auth_required, then send auth message
    });
    this.#ws.on('message', (data) => this.#onMessage(data));
    this.#ws.on('close', () => this.#onClose());
    this.#ws.on('error', (err) => {
      console.error(`[home_assistant] ws error: ${err.message}`);
    });
  }

  #onClose() {
    if (this.#connected) {
      this.#connected = false;
      this.emit('disconnect');
    }
    this.#pending.clear();
    if (this.#stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.#reconnectAttempt) + Math.random() * 500;
    this.#reconnectAttempt = Math.min(this.#reconnectAttempt + 1, 5);
    this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
  }

  #send(obj) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(obj));
  }

  #sendCommand(type, extra = {}) {
    const id = this.#msgId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ id, type, ...extra });
    });
  }

  #onMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    switch (msg.type) {
      case 'auth_required':
        this.#send({ type: 'auth', access_token: this.#token });
        return;
      case 'auth_ok':
        this.#reconnectAttempt = 0;
        this.#connected = true;
        this.#bootstrap().catch((err) => {
          console.error(`[home_assistant] bootstrap failed: ${err.message}`);
          try { this.#ws.close(); } catch {}
        });
        return;
      case 'auth_invalid':
        console.error(`[home_assistant] auth invalid: ${msg.message}`);
        this.#stopped = true;
        try { this.#ws.close(); } catch {}
        return;
      case 'result': {
        const p = this.#pending.get(msg.id);
        if (!p) return;
        this.#pending.delete(msg.id);
        if (msg.success) p.resolve(msg.result);
        else p.reject(new Error(msg.error?.message || 'HA result error'));
        return;
      }
      case 'event':
        this.#onEvent(msg.event);
        return;
    }
  }

  async #bootstrap() {
    const [states, areas, devices, entities] = await Promise.all([
      this.#sendCommand('get_states'),
      this.#sendCommand('config/area_registry/list'),
      this.#sendCommand('config/device_registry/list'),
      this.#sendCommand('config/entity_registry/list'),
    ]);
    this.#states.clear();
    for (const s of states) {
      if (isLightOrScene(s.entity_id)) this.#states.set(s.entity_id, s);
    }
    this.#areas = areas;
    this.#devices = devices;
    this.#entities = entities;

    await this.#sendCommand('subscribe_events', { event_type: 'state_changed' });
    // Re-bootstrap registries on changes (cheap, infrequent).
    for (const t of ['area_registry_updated', 'device_registry_updated', 'entity_registry_updated']) {
      await this.#sendCommand('subscribe_events', { event_type: t });
    }
    this.emit('snapshot', this.getSnapshot());
  }

  #onEvent(event) {
    if (!event) return;
    if (event.event_type === 'state_changed') {
      const data = event.data || {};
      if (!isLightOrScene(data.entity_id)) return;
      if (data.new_state) {
        this.#states.set(data.entity_id, data.new_state);
        const parsed = data.entity_id.startsWith('light.')
          ? parseLightState(data.new_state)
          : parseSceneState(data.new_state);
        this.emit('state', { entity_id: data.entity_id, kind: data.entity_id.split('.')[0], state: parsed });
      } else {
        this.#states.delete(data.entity_id);
        this.emit('state', { entity_id: data.entity_id, kind: data.entity_id.split('.')[0], state: null });
      }
      return;
    }
    if (
      event.event_type === 'area_registry_updated' ||
      event.event_type === 'device_registry_updated' ||
      event.event_type === 'entity_registry_updated'
    ) {
      this.#refreshRegistries().catch((err) => {
        console.error(`[home_assistant] registry refresh failed: ${err.message}`);
      });
    }
  }

  async #refreshRegistries() {
    const [areas, devices, entities] = await Promise.all([
      this.#sendCommand('config/area_registry/list'),
      this.#sendCommand('config/device_registry/list'),
      this.#sendCommand('config/entity_registry/list'),
    ]);
    this.#areas = areas;
    this.#devices = devices;
    this.#entities = entities;
    this.emit('snapshot', this.getSnapshot());
  }
}

module.exports = {
  HAClient,
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
};
