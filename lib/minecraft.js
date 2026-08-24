// Minecraft admin helpers: config validation, console command allowlisting,
// whitelist response parsing, and the log-agent SSE relay.

const DEFAULT_COMMAND_ALLOWLIST = [
  'whitelist', 'list', 'say', 'msg', 'tell', 'kick',
  'tps', 'seed', 'banlist', 'difficulty', 'time', 'weather', 'save-all',
];

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const SERVER_ID_RE = /^[a-z0-9_-]+$/;
const MAX_COMMAND_LENGTH = 256;

function validateMinecraftConfig(mc, prefix = 'minecraft') {
  const errors = [];
  if (!mc || typeof mc !== 'object') {
    errors.push(`${prefix} must be an object`);
    return errors;
  }
  if (!mc.rcon || typeof mc.rcon !== 'object') {
    errors.push(`${prefix}.rcon must be an object`);
  } else {
    const { host, port, password } = mc.rcon;
    if (typeof host !== 'string' || !host || host.includes('REPLACE_ME')) {
      errors.push(`${prefix}.rcon.host must be set (not REPLACE_ME)`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`${prefix}.rcon.port must be an integer between 1 and 65535`);
    }
    if (typeof password !== 'string' || !password || password.includes('REPLACE_ME')) {
      errors.push(`${prefix}.rcon.password must be set (not REPLACE_ME)`);
    }
  }
  if (mc.logAgent !== undefined) {
    if (!mc.logAgent || typeof mc.logAgent !== 'object') {
      errors.push(`${prefix}.logAgent must be an object`);
    } else if (
      typeof mc.logAgent.url !== 'string' || !mc.logAgent.url || mc.logAgent.url.includes('REPLACE_ME')
    ) {
      errors.push(`${prefix}.logAgent.url must be set (not REPLACE_ME)`);
    }
  }
  if (mc.commandAllowlist !== undefined) {
    if (!Array.isArray(mc.commandAllowlist) || mc.commandAllowlist.length === 0) {
      errors.push(`${prefix}.commandAllowlist must be a non-empty array if set`);
    } else {
      for (const [i, c] of mc.commandAllowlist.entries()) {
        if (typeof c !== 'string' || !c || /[\s/]/.test(c)) {
          errors.push(`${prefix}.commandAllowlist[${i}] must be a single command word (no spaces or slashes)`);
        }
      }
    }
  }
  return errors;
}

// Migrates the legacy single-server `plan` + `minecraft` top-level blocks into
// a one-element `servers` array so the rest of the app only deals with the
// multi-server shape. No-op when `servers` is already present or there is no
// legacy `plan` object to migrate.
function normalizeServersConfig(config) {
  if (!config || typeof config !== 'object') return config;
  if (config.servers !== undefined) return config;
  if (!config.plan || typeof config.plan !== 'object') return config;
  config.servers = [{
    id: 'default',
    label: config.plan.guest,
    plan: config.plan,
    minecraft: config.minecraft || undefined,
  }];
  delete config.plan;
  delete config.minecraft;
  return config;
}

function validateServersConfig(servers) {
  const errors = [];
  if (!Array.isArray(servers) || servers.length === 0) {
    errors.push('servers must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  for (const [i, s] of servers.entries()) {
    const prefix = `servers[${i}]`;
    if (!s || typeof s !== 'object') {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof s.id !== 'string' || !SERVER_ID_RE.test(s.id)) {
      errors.push(`${prefix}.id must be a URL-safe slug (lowercase letters, digits, '_', '-')`);
    } else if (seen.has(s.id)) {
      errors.push(`${prefix}.id '${s.id}' is duplicated — server ids must be unique`);
    } else {
      seen.add(s.id);
    }
    if (s.label !== undefined && (typeof s.label !== 'string' || !s.label)) {
      errors.push(`${prefix}.label must be a non-empty string if set`);
    }
    if (!s.plan || typeof s.plan !== 'object') {
      errors.push(`${prefix}.plan must be an object`);
    } else {
      if (!s.plan.url || typeof s.plan.url !== 'string' || s.plan.url.includes('REPLACE_ME')) {
        errors.push(`${prefix}.plan.url must be a non-empty URL`);
      }
      if (!s.plan.machine || s.plan.machine === 'REPLACE_ME') errors.push(`${prefix}.plan.machine is required`);
      if (!s.plan.guest || s.plan.guest === 'REPLACE_ME') errors.push(`${prefix}.plan.guest is required`);
    }
    if (s.minecraft !== undefined) {
      for (const e of validateMinecraftConfig(s.minecraft, `${prefix}.minecraft`)) errors.push(e);
    }
  }
  return errors;
}

// Normalizes a console command and checks its first word against the
// allowlist. Returns { ok: true, command } or { ok: false, error }.
function checkCommand(command, allowlist) {
  if (typeof command !== 'string') return { ok: false, error: 'command must be a string' };
  let cmd = command.trim();
  if (cmd.startsWith('/')) cmd = cmd.slice(1).trim();
  if (!cmd) return { ok: false, error: 'command must not be empty' };
  if (cmd.length > MAX_COMMAND_LENGTH) {
    return { ok: false, error: `command too long (max ${MAX_COMMAND_LENGTH} chars)` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(cmd)) {
    return { ok: false, error: 'command must not contain control characters' };
  }
  const first = cmd.split(/\s+/, 1)[0].toLowerCase();
  const allowed = new Set((allowlist || DEFAULT_COMMAND_ALLOWLIST).map((c) => c.toLowerCase()));
  if (!allowed.has(first)) {
    return { ok: false, error: `command '${first}' is not in the allowlist` };
  }
  return { ok: true, command: cmd };
}

function isValidUsername(name) {
  return typeof name === 'string' && USERNAME_RE.test(name);
}

function stripColorCodes(s) {
  return String(s ?? '').replace(/§./g, '');
}

// "There are 3 whitelisted player(s): alpha, bravo, charlie" -> names.
// Wording varies across versions, so: split on the first colon, comma-split,
// keep only tokens that look like usernames.
function parseWhitelistList(response) {
  const text = stripColorCodes(response);
  if (/no whitelisted players/i.test(text)) return [];
  const colon = text.indexOf(':');
  if (colon === -1) return [];
  return text
    .slice(colon + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => USERNAME_RE.test(s));
}

function classifyWhitelistResponse(response) {
  const text = stripColorCodes(response);
  if (/added .* to the whitelist/i.test(text)) return 'added';
  if (/removed .* from the whitelist/i.test(text)) return 'removed';
  if (/already whitelisted/i.test(text)) return 'already';
  if (/(does not exist|unknown player|not whitelisted)/i.test(text)) return 'not_found';
  return 'unknown';
}

// Minimal incremental SSE parser. `state` carries a partial line and the
// fields of an unfinished event across chunks; a blank line dispatches.
function parseSseChunk(state, chunk) {
  const events = [];
  let { buffer = '', eventName = null, dataLines = [] } = state || {};
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') {
      if (dataLines.length) {
        events.push({ event: eventName || 'message', data: dataLines.join('\n') });
      }
      eventName = null;
      dataLines = [];
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  }
  return { events, state: { buffer, eventName, dataLines } };
}

// Holds one always-on connection to the mc-log-agent's /stream endpoint and
// fans incoming lines out to browser SSE clients via the shared broker, so N
// dashboard tabs cost the Minecraft host a single connection.
class McLogRelay {
  #url;
  #broker;
  #stopped = true;
  #abort = null;
  #reconnectTimer = null;
  #attempt = 0;
  #connected = false;
  #offlineLogged = false;

  constructor({ url, broker }) {
    this.#url = url.replace(/\/$/, '');
    this.#broker = broker;
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
    if (this.#abort) {
      try { this.#abort.abort(); } catch {}
    }
  }

  async #connect() {
    if (this.#stopped) return;
    this.#abort = new AbortController();
    try {
      const resp = await globalThis.fetch(`${this.#url}/stream`, { signal: this.#abort.signal });
      if (!resp.ok || !resp.body) throw new Error(`log agent HTTP ${resp.status}`);
      this.#attempt = 0;
      this.#connected = true;
      if (this.#offlineLogged) {
        console.log('[minecraft] log relay reconnected');
        this.#offlineLogged = false;
      }
      let state = { buffer: '', eventName: null, dataLines: [] };
      const decoder = new TextDecoder();
      for await (const chunk of resp.body) {
        const parsed = parseSseChunk(state, decoder.decode(chunk, { stream: true }));
        state = parsed.state;
        for (const ev of parsed.events) {
          if (ev.event !== 'line') continue;
          let data;
          try { data = JSON.parse(ev.data); } catch { continue; }
          this.#broker.broadcast('line', data);
        }
      }
      throw new Error('log agent stream ended');
    } catch (err) {
      if (this.#stopped) return;
      this.#connected = false;
      if (!this.#offlineLogged) {
        console.error(`[minecraft] log relay offline: ${err.message} (retrying)`);
        this.#offlineLogged = true;
      }
      this.#broker.broadcast('offline', { connected: false });
      const delay = Math.min(30_000, 1000 * 2 ** this.#attempt) + Math.random() * 500;
      this.#attempt = Math.min(this.#attempt + 1, 5);
      this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
    }
  }
}

module.exports = {
  DEFAULT_COMMAND_ALLOWLIST,
  USERNAME_RE,
  SERVER_ID_RE,
  validateMinecraftConfig,
  normalizeServersConfig,
  validateServersConfig,
  checkCommand,
  isValidUsername,
  stripColorCodes,
  parseWhitelistList,
  classifyWhitelistResponse,
  parseSseChunk,
  McLogRelay,
};
