const METRICS = ['cpu', 'mem', 'disk'];

function metricValue(metric, host) {
  if (!host) return null;
  if (metric === 'cpu')  return host.cpuPct ?? null;
  if (metric === 'mem')  return host.memTotal ? (host.memUsed / host.memTotal) * 100 : null;
  if (metric === 'disk') return host.diskTotal ? (host.diskUsed / host.diskTotal) * 100 : null;
  return null;
}

function thresholdFor(rule, metric) {
  if (metric === 'cpu')  return rule.cpuPct;
  if (metric === 'mem')  return rule.memPct;
  if (metric === 'disk') return rule.diskPct;
  return null;
}

function keyFor(machine, guest, metric) {
  return `${machine}/${guest ?? '_host'}/${metric}`;
}

class AlertManager {
  #config;
  #storage;
  #fetch;
  #state = new Map(); // key -> { status, since, value }
  #lastSeenRunning = new Set(); // "${machine}/${guestName}" for guests observed running at least once

  constructor({ config, storage, fetch: fetchImpl = globalThis.fetch }) {
    this.#config = config;
    this.#storage = storage;
    this.#fetch = fetchImpl;
    this.#rehydrate();
  }

  #rehydrate() {
    const rows = this.#storage.listActiveFiring();
    for (const row of rows) {
      const key = keyFor(row.machine, row.guest, row.metric);
      this.#state.set(key, { status: 'firing', since: row.ts, value: row.value });
      if (row.metric === 'reachability' && row.guest) {
        this.#lastSeenRunning.add(`${row.machine}/${row.guest}`);
      }
    }
  }

  resolveRule(machine, guest) {
    const defaults = this.#config.defaults;
    const overrides = this.#config.overrides ?? [];
    const machineOnly = overrides.find((o) => o.machine === machine && o.guest == null);
    const guestMatch  = guest ? overrides.find((o) => o.machine === machine && o.guest === guest) : null;
    return { ...defaults, ...(machineOnly ?? {}), ...(guestMatch ?? {}) };
  }

  async evaluate(state, now = Date.now()) {
    const transitions = [];
    for (const [machine, m] of Object.entries(state.machines ?? {})) {
      const hostRule = this.resolveRule(machine, null);
      if (hostRule.reachability) {
        const hostDown = m.status !== 'up';
        const t = this.#stepReachability({ machine, guest: null, down: hostDown, now });
        if (t) transitions.push(t);
      }
      for (const g of (m.guests ?? [])) {
        const guestKey = `${machine}/${g.name}`;
        if (g.status === 'running') this.#lastSeenRunning.add(guestKey);
        const guestRule = this.resolveRule(machine, g.name);
        if (guestRule.reachability && (this.#lastSeenRunning.has(guestKey) || this.#state.has(keyFor(machine, g.name, 'reachability')))) {
          const t = this.#stepReachability({ machine, guest: g.name, down: g.status !== 'running', now });
          if (t) transitions.push(t);
        }
      }
      const hostTargets = m.host ? [{ guest: null, host: m.host }] : [];
      const guestTargets = (m.guests ?? []).map((g) => ({ guest: g.name, host: g }));
      for (const { guest, host } of [...hostTargets, ...guestTargets]) {
        const rule = this.resolveRule(machine, guest);
        for (const metric of METRICS) {
          const value = metricValue(metric, host);
          const threshold = thresholdFor(rule, metric);
          if (value == null || threshold == null) continue;
          const firing = value >= threshold;
          const t = this.#step({ machine, guest, metric, firing, value, threshold, forMs: rule.forMs, now });
          if (t) transitions.push(t);
        }
      }
    }
    for (const t of transitions) await this.#notify(t);
  }

  #step({ machine, guest, metric, firing, value, threshold, forMs, now }) {
    const key = keyFor(machine, guest, metric);
    const prev = this.#state.get(key);
    if (firing) {
      if (!prev || prev.status === 'ok') {
        this.#state.set(key, { status: 'pending', since: now, value });
        return null;
      }
      if (prev.status === 'pending') {
        if (now - prev.since >= forMs) {
          this.#state.set(key, { status: 'firing', since: now, value });
          return { kind: 'firing', machine, guest, metric, value, threshold, durationMs: now - prev.since, ts: now };
        }
        this.#state.set(key, { ...prev, value });
        return null;
      }
      // already firing
      this.#state.set(key, { ...prev, value });
      return null;
    }
    // not firing
    if (prev && prev.status === 'firing') {
      this.#state.set(key, { status: 'ok', since: now, value });
      return { kind: 'resolved', machine, guest, metric, value, threshold, durationMs: now - prev.since, ts: now };
    }
    this.#state.set(key, { status: 'ok', since: now, value });
    return null;
  }

  #stepReachability({ machine, guest, down, now }) {
    const key = keyFor(machine, guest, 'reachability');
    const prev = this.#state.get(key);
    if (down) {
      if (!prev || prev.status !== 'firing') {
        this.#state.set(key, { status: 'firing', since: now, value: null });
        return { kind: 'firing', machine, guest, metric: 'reachability', value: null, threshold: null, durationMs: 0, ts: now };
      }
      return null;
    }
    if (prev && prev.status === 'firing') {
      this.#state.set(key, { status: 'ok', since: now, value: null });
      return { kind: 'resolved', machine, guest, metric: 'reachability', value: null, threshold: null, durationMs: now - prev.since, ts: now };
    }
    this.#state.set(key, { status: 'ok', since: now, value: null });
    return null;
  }

  getActive() {
    const out = [];
    for (const [key, s] of this.#state.entries()) {
      if (s.status !== 'firing') continue;
      const [machine, guestPart, metric] = key.split('/');
      out.push({
        machine,
        guest: guestPart === '_host' ? null : guestPart,
        metric,
        since: s.since,
        value: s.value,
        threshold: thresholdFor(this.resolveRule(machine, guestPart === '_host' ? null : guestPart), metric),
      });
    }
    return out;
  }

  async #notify(t) {
    const n = this.#config.ntfy;
    const target = `${t.machine}${t.guest ? '/' + t.guest : ''}`;
    const pct = t.value == null ? '' : (Number.isFinite(t.value) ? ` ${t.value.toFixed(0)}%` : '');
    const title = t.kind === 'firing'
      ? `[FIRING] ${target} ${t.metric}${pct}`
      : `[OK] ${target} ${t.metric}${pct}`;
    const body = t.kind === 'firing'
      ? (t.threshold != null ? `${t.metric} at${pct} (threshold ${t.threshold}%)` : `${t.metric} unreachable`)
      : (t.threshold != null ? `${t.metric} recovered${pct}` : `${t.metric} reachable again`);
    const tags = (t.kind === 'firing' ? n.firingTags : n.resolvedTags) ?? [];
    const priority = t.kind === 'firing' ? n.firingPriority : n.resolvedPriority;

    try {
      this.#storage.insertAlertEvent({
        ts: t.ts ?? Date.now(),
        machine: t.machine,
        guest: t.guest,
        metric: t.metric,
        kind: t.kind,
        value: t.value,
        threshold: t.threshold,
        message: body,
      });
    } catch (err) {
      console.error(`[alerts] storage insert failed: ${err.message}`);
    }

    try {
      const res = await this.#fetch(n.url, {
        method: 'POST',
        headers: { Title: title, Priority: priority, Tags: tags.join(',') },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (res && !res.ok) {
        console.error(`[alerts] ntfy POST returned ${res.status}`);
      }
    } catch (err) {
      console.error(`[alerts] ntfy POST failed: ${err.message}`);
    }
  }
}

module.exports = { AlertManager };
