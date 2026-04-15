class Poller {
  #config;
  #scrapers;
  #storage;
  #alertManager;
  #state;
  #previousSamples = new Map();
  #timer = null;

  constructor(config, { scrapers, storage = null, alertManager = null }) {
    this.#config = config;
    this.#scrapers = scrapers;
    this.#storage = storage;
    this.#alertManager = alertManager;
    this.#state = {
      lastPoll: null,
      globalStatus: 'down',
      machines: Object.fromEntries(
        config.machines.map((m) => [
          m.name,
          { type: m.type, primaryUrl: m.primaryUrl ?? null, status: 'down', lastUpdated: null, error: null, host: null, guests: [] },
        ]),
      ),
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
    await Promise.allSettled(machineTasks);
    this.#state.lastPoll = new Date(now).toISOString();
    this.#updateGlobalStatus();
    if (this.#storage) this.#persist(now);
    if (this.#alertManager) {
      try {
        await this.#alertManager.evaluate(this.#state, now);
      } catch (err) {
        console.error(`[poller] alert evaluation failed: ${err.message}`);
      }
    }
  }

  #persist(now) {
    const samples = [];
    for (const [name, m] of Object.entries(this.#state.machines)) {
      if (m.status === 'up' && m.host) {
        samples.push({
          machine: name,
          guest: null,
          ts: now,
          cpuPct: m.host.cpuPct,
          memUsed: m.host.memUsed,
          memTotal: m.host.memTotal,
          diskUsed: m.host.diskUsed,
          diskTotal: m.host.diskTotal,
          netRx: m.host.netRx,
          netTx: m.host.netTx,
        });
      }
      for (const g of m.guests ?? []) {
        samples.push({
          machine: name,
          guest: g.name,
          ts: now,
          cpuPct: g.cpuPct,
          memUsed: g.memUsed,
          memTotal: g.memTotal,
          diskUsed: g.diskUsed,
          diskTotal: g.diskTotal,
          netRx: g.netRx,
          netTx: g.netTx,
        });
      }
    }
    if (samples.length > 0) {
      try {
        this.#storage.insertBatch(samples);
      } catch (err) {
        console.error(`[poller] storage insert failed: ${err.message}`);
      }
    }
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
      const guestLinks = this.#config.guestLinks ?? [];
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
        const link = guestLinks.find((l) => l.machine === entry.name && l.guest === g.name);
        return {
          ...rest,
          netRx: guestRx,
          netTx: guestTx,
          url: link?.url ?? null,
          icon: link?.icon ?? null,
        };
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

  #updateGlobalStatus() {
    const machineStatuses = Object.values(this.#state.machines).map((m) => m.status);
    if (machineStatuses.length === 0) { this.#state.globalStatus = 'down'; return; }
    if (machineStatuses.every((s) => s === 'up')) this.#state.globalStatus = 'up';
    else if (machineStatuses.every((s) => s === 'down')) this.#state.globalStatus = 'down';
    else this.#state.globalStatus = 'degraded';
  }
}

module.exports = { Poller };
