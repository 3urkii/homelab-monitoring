class Poller {
  #config;
  #scrapers;
  #servicePing;
  #state;
  #previousSamples = new Map();
  #timer = null;

  constructor(config, { scrapers, servicePing }) {
    this.#config = config;
    this.#scrapers = scrapers;
    this.#servicePing = servicePing;
    this.#state = {
      lastPoll: null,
      globalStatus: 'down',
      machines: Object.fromEntries(
        config.machines.map((m) => [
          m.name,
          { type: m.type, primaryUrl: m.primaryUrl ?? null, status: 'down', lastUpdated: null, error: null, host: null, guests: [] },
        ]),
      ),
      services: config.services.map((s) => ({
        name: s.name, url: s.url, machine: s.machine, icon: s.icon, guest: s.guest ?? null,
        status: 'down', responseTime: null, lastChecked: null,
      })),
    };
  }

  getState() {
    return this.#state;
  }

  start() {
    if (this.#timer) return;
    this.tick().catch(() => {});
    this.#timer = setInterval(() => { this.tick().catch(() => {}); }, this.#config.server.pollIntervalMs);
  }

  stop() {
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null; }
  }

  async tick() {
    const now = Date.now();
    const machineTasks = this.#config.machines.map((entry) => this.#scrapeMachine(entry, now));
    const serviceTasks = this.#config.services.map((svc) => this.#pingService(svc));
    await Promise.allSettled([...machineTasks, ...serviceTasks]);
    this.#state.lastPoll = new Date(now).toISOString();
    this.#updateGlobalStatus();
  }

  async #scrapeMachine(entry, now) {
    const scraper = this.#scrapers[entry.type];
    if (!scraper) {
      this.#markDown(entry.name, `unknown machine type: ${entry.type}`);
      return;
    }
    try {
      const raw = await scraper(entry);
      this.#applyScrapeResult(entry, raw, now);
    } catch (err) {
      this.#markDown(entry.name, err.message);
    }
  }

  #applyScrapeResult(entry, raw, now) {
    const prev = this.#previousSamples.get(entry.name);
    let host;
    let guests = [];
    if (entry.type === 'node_exporter') {
      const rates = prev
        ? this.#computeRates(prev, raw, now)
        : { netRx: null, netTx: null, cpuPct: null };
      const nowSec = Math.floor(now / 1000);
      host = {
        cpuPct: rates.cpuPct,
        memUsed: raw.memTotal - raw.memAvailable,
        memTotal: raw.memTotal,
        diskUsed: raw.diskTotal - raw.diskAvailable,
        diskTotal: raw.diskTotal,
        netRx: rates.netRx,
        netTx: rates.netTx,
        uptime: nowSec - raw.bootTimeSeconds,
        loadavg: raw.loadavg,
      };
      this.#previousSamples.set(entry.name, { ts: now, ...raw });
    } else if (entry.type === 'proxmox') {
      const rawHost = raw.host;
      const prevProxmox = this.#previousSamples.get(entry.name);
      let netRx = null, netTx = null;
      if (prevProxmox) {
        const elapsed = (now - prevProxmox.ts) / 1000;
        if (elapsed > 0) {
          netRx = Math.max(0, (rawHost._cumulative.netRxBytes - prevProxmox.netRxBytes) / elapsed);
          netTx = Math.max(0, (rawHost._cumulative.netTxBytes - prevProxmox.netTxBytes) / elapsed);
        }
      }
      host = {
        cpuPct: rawHost.cpuPct,
        memUsed: rawHost.memUsed,
        memTotal: rawHost.memTotal,
        diskUsed: rawHost.diskUsed,
        diskTotal: rawHost.diskTotal,
        netRx, netTx,
        uptime: rawHost.uptime,
        loadavg: rawHost.loadavg,
      };
      guests = raw.guests.map((g) => {
        const guestKey = `${entry.name}:guest:${g.vmid}`;
        const prevGuest = this.#previousSamples.get(guestKey);
        let guestRx = null, guestTx = null;
        if (prevGuest && g._cumulative) {
          const elapsed = (now - prevGuest.ts) / 1000;
          if (elapsed > 0) {
            guestRx = Math.max(0, (g._cumulative.netRxBytes - prevGuest.netRxBytes) / elapsed);
            guestTx = Math.max(0, (g._cumulative.netTxBytes - prevGuest.netTxBytes) / elapsed);
          }
        }
        if (g._cumulative) {
          this.#previousSamples.set(guestKey, {
            ts: now,
            netRxBytes: g._cumulative.netRxBytes,
            netTxBytes: g._cumulative.netTxBytes,
          });
        }
        const { _cumulative, ...rest } = g;
        return { ...rest, netRx: guestRx, netTx: guestTx };
      });
      this.#previousSamples.set(entry.name, {
        ts: now,
        netRxBytes: rawHost._cumulative.netRxBytes,
        netTxBytes: rawHost._cumulative.netTxBytes,
      });
    }
    this.#state.machines[entry.name] = {
      type: entry.type,
      primaryUrl: this.#state.machines[entry.name].primaryUrl,
      status: 'up',
      lastUpdated: new Date(now).toISOString(),
      error: null,
      host,
      guests,
    };
  }

  #computeRates(prev, raw, now) {
    const elapsed = (now - prev.ts) / 1000;
    if (elapsed <= 0) return { netRx: null, netTx: null, cpuPct: null };
    const netRx = Math.max(0, (raw.netRxBytes - prev.netRxBytes) / elapsed);
    const netTx = Math.max(0, (raw.netTxBytes - prev.netTxBytes) / elapsed);
    const idleDelta = raw.cpuIdleSeconds - prev.cpuIdleSeconds;
    const totalDelta = raw.cpuTotalSeconds - prev.cpuTotalSeconds;
    const cpuPct = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null;
    return { netRx, netTx, cpuPct };
  }

  #markDown(name, errorMessage) {
    this.#state.machines[name] = {
      ...this.#state.machines[name],
      status: 'down',
      lastUpdated: new Date().toISOString(),
      error: errorMessage,
      host: null,
      guests: [],
    };
  }

  async #pingService(svc) {
    try {
      const result = await this.#servicePing(svc);
      const target = this.#state.services.find((s) => s.name === svc.name && s.url === svc.url);
      if (target) {
        target.status = result.status;
        target.responseTime = result.responseTime ?? null;
        target.lastChecked = new Date().toISOString();
      }
    } catch {
      const target = this.#state.services.find((s) => s.name === svc.name && s.url === svc.url);
      if (target) {
        target.status = 'down';
        target.responseTime = null;
        target.lastChecked = new Date().toISOString();
      }
    }
  }

  #updateGlobalStatus() {
    const machineStatuses = Object.values(this.#state.machines).map((m) => m.status);
    const serviceStatuses = this.#state.services.map((s) => s.status);
    const all = [...machineStatuses, ...serviceStatuses];
    if (all.length === 0) { this.#state.globalStatus = 'down'; return; }
    if (all.every((s) => s === 'up')) this.#state.globalStatus = 'up';
    else if (all.every((s) => s === 'down')) this.#state.globalStatus = 'down';
    else this.#state.globalStatus = 'degraded';
  }
}

module.exports = { Poller };
