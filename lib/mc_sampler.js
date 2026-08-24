// RCON-based metrics sampler for Minecraft servers that don't run Plan
// (e.g. Forge modpacks, which Plan has no native platform for). Polls the
// server over RCON for players online and TPS/tick time and persists the
// samples into the dashboard's SQLite store for charting.
const { rconExec } = require('./rcon.js');
const { stripColorCodes } = require('./minecraft.js');

const DEFAULT_INTERVAL_MS = 30_000;
// Probe order: Forge's built-in `forge tps`, then Paper/Spigot's `tps`.
// Vanilla has neither — the sampler then records player counts only.
const TPS_PROBE_COMMANDS = ['forge tps', 'tps'];

// "There are 3 of a max of 20 players online: a, b, c" (vanilla/Forge),
// "There are 3/20 players online:" (older) -> { players: 3 }.
function parseListResponse(response) {
  const text = stripColorCodes(response);
  let m = text.match(/There are\s+(\d+)/i);
  if (!m) m = text.match(/^\s*(\d+)\s*\/\s*\d+/);
  return m ? { players: parseInt(m[1], 10) } : null;
}

// Forge:  "Overall: Mean tick time: 4.104 ms. Mean TPS: 20.000"
// Paper:  "TPS from last 1m, 5m, 15m: 19.98, 19.99, 20.0" (values may carry
//         a leading '*' when above 20). Returns { tps, tickMs } or null when
//         the response doesn't look like TPS output (e.g. "Unknown command").
function parseTpsResponse(response) {
  const text = stripColorCodes(response);
  let m = text.match(/Overall:?\s*Mean tick time:\s*([\d]+[.,]?\d*)\s*ms\.?\s*Mean TPS:\s*([\d]+[.,]?\d*)/i);
  if (m) {
    return { tickMs: parseFloat(m[1].replace(',', '.')), tps: parseFloat(m[2].replace(',', '.')) };
  }
  m = text.match(/TPS from last[^:]*:\s*\*?([\d]+\.?\d*)/i);
  if (m) return { tps: parseFloat(m[1]), tickMs: null };
  return null;
}

class McSampler {
  #serverId;
  #rcon;
  #storage;
  #intervalMs;
  #tpsCommand;
  #probed;
  #timer = null;
  #stopped = true;
  #ticking = false;
  #connected = false;
  #offlineLogged = false;
  #lastSample = null;

  constructor({ serverId, rcon, storage, intervalMs, tpsCommand }) {
    this.#serverId = serverId;
    this.#rcon = rcon;
    this.#storage = storage;
    this.#intervalMs = intervalMs || DEFAULT_INTERVAL_MS;
    this.#tpsCommand = tpsCommand;
    this.#probed = tpsCommand !== undefined;
  }

  status() {
    return { online: this.#connected, sample: this.#lastSample };
  }

  start() {
    this.#stopped = false;
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
    if (this.#timer.unref) this.#timer.unref();
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #tick() {
    if (this.#stopped || this.#ticking) return;
    this.#ticking = true;
    try {
      const list = parseListResponse(await rconExec(this.#rcon, 'list'));
      const tps = await this.#fetchTps();
      const sample = {
        ts: Date.now(),
        players: list ? list.players : null,
        tps: tps?.tps ?? null,
        tickMs: tps?.tickMs ?? null,
      };
      this.#storage.insertMcSample({ serverId: this.#serverId, ...sample });
      this.#lastSample = sample;
      this.#connected = true;
      if (this.#offlineLogged) {
        console.log(`[minecraft] sampler '${this.#serverId}' reconnected`);
        this.#offlineLogged = false;
      }
    } catch (err) {
      this.#connected = false;
      if (!this.#offlineLogged) {
        console.error(`[minecraft] sampler '${this.#serverId}' offline: ${err.message} (retrying)`);
        this.#offlineLogged = true;
      }
    } finally {
      this.#ticking = false;
    }
  }

  // An unparseable response (e.g. "Unknown command") means the command isn't
  // supported — try the next probe. A thrown error means the server is
  // unreachable and propagates up so the tick is marked offline.
  async #fetchTps() {
    if (this.#probed) {
      if (!this.#tpsCommand) return null;
      return parseTpsResponse(await rconExec(this.#rcon, this.#tpsCommand));
    }
    for (const cmd of TPS_PROBE_COMMANDS) {
      const parsed = parseTpsResponse(await rconExec(this.#rcon, cmd));
      if (parsed) {
        this.#tpsCommand = cmd;
        this.#probed = true;
        console.log(`[minecraft] sampler '${this.#serverId}' using '${cmd}' for TPS`);
        return parsed;
      }
    }
    this.#tpsCommand = null;
    this.#probed = true;
    console.log(`[minecraft] sampler '${this.#serverId}' found no TPS command — recording player counts only`);
    return null;
  }
}

module.exports = {
  McSampler,
  parseListResponse,
  parseTpsResponse,
  DEFAULT_INTERVAL_MS,
  TPS_PROBE_COMMANDS,
};
