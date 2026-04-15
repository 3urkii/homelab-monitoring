# ntfy Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push ntfy notifications on fire/resolve transitions for CPU/memory/disk/reachability rules defined in `config.js`, persist events to SQLite, and surface active alerts + history in the dashboard.

**Architecture:** A new `AlertManager` (`lib/alerts.js`) evaluates rules against `Poller.getState()` on every poll tick, tracks per-rule state in memory, writes transitions to a new `alert_events` SQLite table, and POSTs to ntfy on transitions. The table acts as source-of-truth for rehydration across restarts. Two new Express endpoints expose active and historical events; a vanilla-JS section in `public/index.html` renders them.

**Tech Stack:** Node 20, Express, `better-sqlite3`, `node:test`, global `fetch`.

**Spec:** `docs/superpowers/specs/2026-04-15-ntfy-alerting-design.md`

---

## File Structure

- **Create** `lib/alerts.js` — `AlertManager` class (rule resolution, evaluation, transitions, ntfy delivery, rehydration).
- **Create** `test/alerts.test.js` — unit tests for `AlertManager`, using `:memory:` Storage and a stub `fetch`.
- **Modify** `lib/storage.js` — add `alert_events` table to schema, prepared statements, and four methods: `insertAlertEvent`, `listAlertEvents`, `listActiveFiring`, `pruneAlertEvents`.
- **Modify** `test/storage.test.js` — tests for the four new methods.
- **Modify** `lib/poller.js` — accept optional `alertManager` in constructor; call `alertManager.evaluate(state, now)` at the end of `tick()` after `#persist`.
- **Modify** `test/poller.test.js` — one test verifying `evaluate` is called per tick with the live state.
- **Modify** `server.js` — validate `config.alerts` if present; construct `AlertManager`; pass to `Poller`; add `GET /api/alerts` and `GET /api/alerts/active`; call `storage.pruneAlertEvents()` in rollup interval.
- **Modify** `config.js` — append commented-out `alerts` block template.
- **Modify** `public/index.html` — add Alerts section (active list + history list), polled alongside `/api/stats`.
- **Modify** `README.md` — short "Alerting" section.

---

## Task 1: Storage — schema + insertAlertEvent

**Files:**
- Modify: `lib/storage.js`
- Test: `test/storage.test.js`

- [ ] **Step 1: Extend the SCHEMA string in `lib/storage.js`**

Append to the existing `SCHEMA` template literal in `lib/storage.js` (after the `samples_10m` block, before the closing backtick):

```sql
  CREATE TABLE IF NOT EXISTS alert_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    machine    TEXT    NOT NULL,
    guest      TEXT,
    metric     TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    value      REAL,
    threshold  REAL,
    message    TEXT
  );
  CREATE INDEX IF NOT EXISTS alert_events_ts_idx     ON alert_events(ts DESC);
  CREATE INDEX IF NOT EXISTS alert_events_target_idx ON alert_events(machine, guest, metric, ts DESC);
```

- [ ] **Step 2: Write failing test for `insertAlertEvent` + `listAlertEvents`**

Append to `test/storage.test.js`:

```js
test('Storage: insert and list alert events', () => {
  const s = mkStorage();
  s.insertAlertEvent({ ts: 1000, machine: 'm1', guest: null,  metric: 'cpu',          kind: 'firing',   value: 95, threshold: 90, message: 'cpu hot' });
  s.insertAlertEvent({ ts: 2000, machine: 'm1', guest: 'g1',  metric: 'mem',          kind: 'firing',   value: 92, threshold: 90, message: 'mem hot' });
  s.insertAlertEvent({ ts: 3000, machine: 'm1', guest: null,  metric: 'cpu',          kind: 'resolved', value: 40, threshold: 90, message: 'cpu ok' });
  const all = s.listAlertEvents({ limit: 10 });
  assert.equal(all.length, 3);
  assert.equal(all[0].ts, 3000, 'newest first');
  assert.equal(all[2].ts, 1000);
  const filtered = s.listAlertEvents({ limit: 10, machine: 'm1', guest: 'g1' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].metric, 'mem');
  s.close();
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL — `s.insertAlertEvent is not a function`.

- [ ] **Step 4: Implement `insertAlertEvent` and `listAlertEvents`**

In `lib/storage.js`, inside the `Storage` class, add prepared statements in `#prepareStatements()`:

```js
this.#insertAlertStmt = this.#db.prepare(`
  INSERT INTO alert_events (ts, machine, guest, metric, kind, value, threshold, message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
this.#listAlertsAllStmt = this.#db.prepare(`
  SELECT id, ts, machine, guest, metric, kind, value, threshold, message
  FROM alert_events
  ORDER BY ts DESC
  LIMIT ?
`);
this.#listAlertsMachineStmt = this.#db.prepare(`
  SELECT id, ts, machine, guest, metric, kind, value, threshold, message
  FROM alert_events
  WHERE machine = ? AND guest IS ?
  ORDER BY ts DESC
  LIMIT ?
`);
```

Declare the new private fields at the top of the class next to `#insertStmt`:

```js
#insertAlertStmt;
#listAlertsAllStmt;
#listAlertsMachineStmt;
```

Add public methods:

```js
insertAlertEvent({ ts, machine, guest, metric, kind, value, threshold, message }) {
  this.#insertAlertStmt.run(
    ts, machine, guest ?? null, metric, kind,
    value ?? null, threshold ?? null, message ?? null,
  );
}

listAlertEvents({ limit = 100, machine = null, guest = null } = {}) {
  const cap = Math.min(Math.max(1, limit | 0), 500);
  const rows = machine
    ? this.#listAlertsMachineStmt.all(machine, guest ?? null, cap)
    : this.#listAlertsAllStmt.all(cap);
  return rows;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `node --test test/storage.test.js`
Expected: PASS (all existing storage tests + the new one).

- [ ] **Step 6: Commit**

```bash
git add lib/storage.js test/storage.test.js
git commit -m "feat(storage): alert_events table + insertAlertEvent/listAlertEvents"
```

---

## Task 2: Storage — listActiveFiring + pruneAlertEvents

**Files:**
- Modify: `lib/storage.js`
- Test: `test/storage.test.js`

- [ ] **Step 1: Write failing test for `listActiveFiring`**

Append to `test/storage.test.js`:

```js
test('Storage.listActiveFiring: returns keys whose latest event is firing', () => {
  const s = mkStorage();
  // key A: firing then resolved → should NOT appear
  s.insertAlertEvent({ ts: 100, machine: 'a', guest: null, metric: 'cpu', kind: 'firing',   value: 95, threshold: 90, message: '' });
  s.insertAlertEvent({ ts: 200, machine: 'a', guest: null, metric: 'cpu', kind: 'resolved', value: 40, threshold: 90, message: '' });
  // key B: firing only → should appear
  s.insertAlertEvent({ ts: 150, machine: 'b', guest: 'g', metric: 'mem',  kind: 'firing',   value: 95, threshold: 90, message: '' });
  // key C: firing, resolved, firing → should appear (latest is firing)
  s.insertAlertEvent({ ts: 300, machine: 'c', guest: null, metric: 'disk', kind: 'firing',   value: 95, threshold: 90, message: '' });
  s.insertAlertEvent({ ts: 400, machine: 'c', guest: null, metric: 'disk', kind: 'resolved', value: 40, threshold: 90, message: '' });
  s.insertAlertEvent({ ts: 500, machine: 'c', guest: null, metric: 'disk', kind: 'firing',   value: 95, threshold: 90, message: '' });

  const active = s.listActiveFiring();
  const keys = active.map((a) => `${a.machine}/${a.guest ?? '_host'}/${a.metric}`).sort();
  assert.deepEqual(keys, ['b/g/mem', 'c/_host/disk']);
  const bRow = active.find((a) => a.machine === 'b');
  assert.equal(bRow.ts, 150);
  assert.equal(bRow.value, 95);
  s.close();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL — `s.listActiveFiring is not a function`.

- [ ] **Step 3: Implement `listActiveFiring`**

Add a prepared statement in `#prepareStatements()`:

```js
this.#listActiveFiringStmt = this.#db.prepare(`
  SELECT a.ts, a.machine, a.guest, a.metric, a.kind, a.value, a.threshold, a.message
  FROM alert_events a
  JOIN (
    SELECT machine, guest, metric, MAX(ts) AS max_ts
    FROM alert_events
    GROUP BY machine, guest, metric
  ) latest
    ON a.machine = latest.machine
   AND (a.guest IS latest.guest)
   AND a.metric  = latest.metric
   AND a.ts      = latest.max_ts
  WHERE a.kind = 'firing'
`);
```

Declare the field: `#listActiveFiringStmt;`.

Add the public method:

```js
listActiveFiring() {
  return this.#listActiveFiringStmt.all();
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/storage.test.js`
Expected: PASS.

- [ ] **Step 5: Write failing test for `pruneAlertEvents`**

Append to `test/storage.test.js`:

```js
test('Storage.pruneAlertEvents: keeps last 1000 or last 90d, whichever is larger', () => {
  const s = mkStorage();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  // 5 ancient events (> 90d old, beyond the 1000 cap)
  for (let i = 0; i < 5; i++) {
    s.insertAlertEvent({ ts: now - 200 * day + i, machine: 'old', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: '' });
  }
  // 3 recent events
  for (let i = 0; i < 3; i++) {
    s.insertAlertEvent({ ts: now - i * 1000, machine: 'new', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: '' });
  }
  // Total rows = 8, well under 1000, so 1000-cap says keep all. But the 5 old ones are > 90d AND we have fewer than 1000 rows. Rule: keep last 1000 OR last 90d, whichever set is larger. 1000-cap keeps all 8; 90d-cap keeps only 3. Union = all 8. Nothing pruned.
  s.pruneAlertEvents(now);
  assert.equal(s.listAlertEvents({ limit: 1000 }).length, 8);

  // Now force the row count above 1000 by inserting many recent rows.
  for (let i = 0; i < 1200; i++) {
    s.insertAlertEvent({ ts: now - 10 * day - i, machine: 'bulk', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: '' });
  }
  s.pruneAlertEvents(now);
  const remaining = s.listAlertEvents({ limit: 5000 });
  // Rule: keep union of (last 1000 rows) and (last 90d). The 5 ancient rows are > 90d AND fall outside the 1000 newest → pruned.
  assert.ok(remaining.every((r) => r.machine !== 'old'), 'ancient rows should be pruned');
  assert.ok(remaining.length >= 1000, 'at least 1000 newest rows retained');
  s.close();
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL — `s.pruneAlertEvents is not a function`.

- [ ] **Step 7: Implement `pruneAlertEvents`**

Add to `Storage`:

```js
pruneAlertEvents(now = Date.now()) {
  const cutoff90d = now - 90 * 24 * 60 * 60 * 1000;
  // Delete rows that are BOTH older than 90d AND not in the 1000 newest.
  this.#db.prepare(`
    DELETE FROM alert_events
    WHERE ts < ?
      AND id NOT IN (
        SELECT id FROM alert_events ORDER BY ts DESC LIMIT 1000
      )
  `).run(cutoff90d);
}
```

- [ ] **Step 8: Run test, verify it passes**

Run: `node --test test/storage.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/storage.js test/storage.test.js
git commit -m "feat(storage): listActiveFiring + pruneAlertEvents"
```

---

## Task 3: AlertManager — rule resolution

**Files:**
- Create: `lib/alerts.js`
- Test: `test/alerts.test.js`

- [ ] **Step 1: Write failing test for rule resolution**

Create `test/alerts.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertManager } = require('../lib/alerts.js');
const { Storage } = require('../lib/storage.js');

function mkConfig(overrides = []) {
  return {
    ntfy: { url: 'https://ntfy.sh/fake', firingPriority: 'high', resolvedPriority: 'default', firingTags: ['warning'], resolvedTags: ['white_check_mark'] },
    defaults: { cpuPct: 90, memPct: 90, diskPct: 90, forMs: 60_000, reachability: true },
    overrides,
  };
}

test('AlertManager.resolveRule: guest override beats machine override beats defaults', () => {
  const mgr = new AlertManager({
    config: mkConfig([
      { machine: 'a',                       cpuPct: 80 },
      { machine: 'a', guest: 'g1', cpuPct: 70 },
    ]),
    storage: new Storage(':memory:'),
    fetch: async () => ({ ok: true }),
  });
  assert.equal(mgr.resolveRule('a', null).cpuPct, 80, 'machine-level override applies to host');
  assert.equal(mgr.resolveRule('a', 'g1').cpuPct, 70, 'guest override wins');
  assert.equal(mgr.resolveRule('a', 'g2').cpuPct, 80, 'fallback to machine override');
  assert.equal(mgr.resolveRule('b', null).cpuPct, 90, 'fallback to defaults');
  // Non-overridden fields come from defaults
  assert.equal(mgr.resolveRule('a', 'g1').memPct, 90);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/alerts.test.js`
Expected: FAIL — `Cannot find module '../lib/alerts.js'`.

- [ ] **Step 3: Create `lib/alerts.js` with enough to pass Task 3**

```js
class AlertManager {
  #config;
  #storage;
  #fetch;
  #state = new Map(); // key -> { status, since, value }

  constructor({ config, storage, fetch: fetchImpl = globalThis.fetch }) {
    this.#config = config;
    this.#storage = storage;
    this.#fetch = fetchImpl;
  }

  resolveRule(machine, guest) {
    const defaults = this.#config.defaults;
    const overrides = this.#config.overrides ?? [];
    const machineOnly = overrides.find((o) => o.machine === machine && o.guest == null);
    const guestMatch  = guest ? overrides.find((o) => o.machine === machine && o.guest === guest) : null;
    return { ...defaults, ...(machineOnly ?? {}), ...(guestMatch ?? {}) };
  }
}

module.exports = { AlertManager };
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/alerts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts.js test/alerts.test.js
git commit -m "feat(alerts): AlertManager skeleton + rule resolution"
```

---

## Task 4: AlertManager — threshold evaluation with forMs gate

**Files:**
- Modify: `lib/alerts.js`
- Test: `test/alerts.test.js`

- [ ] **Step 1: Write failing test — threshold ok→pending→firing→ok**

Append to `test/alerts.test.js`:

```js
function mkState(machine, host) {
  return { lastPoll: null, globalStatus: 'up', machines: { [machine]: { type: 'proxmox', status: 'up', host, guests: [] } } };
}

test('AlertManager.evaluate: cpu ok→pending→firing→resolved with forMs gate', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  const hot = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };

  // t=0: cpu hot, ok→pending, no POST
  await mgr.evaluate(mkState('m', hot), 0);
  assert.equal(calls.length, 0);
  // t=30s: still hot, still pending
  await mgr.evaluate(mkState('m', hot), 30_000);
  assert.equal(calls.length, 0);
  // t=60s: forMs elapsed, pending→firing, POST
  await mgr.evaluate(mkState('m', hot), 60_000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /FIRING.*m.*cpu/);
  assert.equal(calls[0].opts.headers.Priority, 'high');
  // t=70s: still firing, no new POST
  await mgr.evaluate(mkState('m', hot), 70_000);
  assert.equal(calls.length, 1);
  // t=80s: cool, firing→ok, resolved POST
  await mgr.evaluate(mkState('m', cold), 80_000);
  assert.equal(calls.length, 2);
  assert.match(calls[1].opts.headers.Title, /OK.*m.*cpu/);
  assert.equal(calls[1].opts.headers.Priority, 'default');
  storage.close();
});

test('AlertManager.evaluate: condition flaps below forMs → no notification', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot),  0);
  await mgr.evaluate(mkState('m', hot),  30_000);
  await mgr.evaluate(mkState('m', cold), 40_000);
  assert.equal(calls.length, 0);
  storage.close();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/alerts.test.js`
Expected: FAIL — `mgr.evaluate is not a function`.

- [ ] **Step 3: Implement `evaluate` (thresholds only, no persistence yet)**

In `lib/alerts.js`, add private helpers and the `evaluate` method:

```js
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
```

Put the helpers at the top of the file (module-scope). Then add to the class:

```js
async evaluate(state, now = Date.now()) {
  const transitions = [];
  for (const [machine, m] of Object.entries(state.machines ?? {})) {
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
        return { kind: 'firing', machine, guest, metric, value, threshold, durationMs: now - prev.since };
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
    return { kind: 'resolved', machine, guest, metric, value, threshold, durationMs: now - prev.since };
  }
  this.#state.set(key, { status: 'ok', since: now, value });
  return null;
}

async #notify(t) {
  const n = this.#config.ntfy;
  const target = `${t.machine}${t.guest ? '/' + t.guest : ''}`;
  const pct = Number.isFinite(t.value) ? `${t.value.toFixed(0)}%` : 'n/a';
  const title = t.kind === 'firing'
    ? `[FIRING] ${target} ${t.metric} ${pct}`
    : `[OK] ${target} ${t.metric} ${pct}`;
  const body = t.kind === 'firing'
    ? `${t.metric} at ${pct} (threshold ${t.threshold}%)`
    : `${t.metric} recovered at ${pct}`;
  const tags = (t.kind === 'firing' ? n.firingTags : n.resolvedTags) ?? [];
  const priority = t.kind === 'firing' ? n.firingPriority : n.resolvedPriority;
  try {
    await this.#fetch(n.url, {
      method: 'POST',
      headers: { Title: title, Priority: priority, Tags: tags.join(',') },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error(`[alerts] ntfy POST failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/alerts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts.js test/alerts.test.js
git commit -m "feat(alerts): threshold evaluation with forMs gate + ntfy delivery"
```

---

## Task 5: AlertManager — reachability (no forMs gate)

**Files:**
- Modify: `lib/alerts.js`
- Test: `test/alerts.test.js`

- [ ] **Step 1: Write failing test — scrape failure fires immediately**

Append to `test/alerts.test.js`:

```js
test('AlertManager.evaluate: reachability fires immediately on scrape failure', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  // up
  await mgr.evaluate(mkState('m', { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 }), 0);
  assert.equal(calls.length, 0);
  // down — fires with no forMs delay
  const downState = { lastPoll: null, globalStatus: 'down', machines: { m: { type: 'proxmox', status: 'down', host: null, guests: [], error: 'boom' } } };
  await mgr.evaluate(downState, 1000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /FIRING.*m.*reachability/);
  // still down, no new POST
  await mgr.evaluate(downState, 2000);
  assert.equal(calls.length, 1);
  // recovered
  await mgr.evaluate(mkState('m', { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 }), 3000);
  assert.equal(calls.length, 2);
  assert.match(calls[1].opts.headers.Title, /OK.*m.*reachability/);
  storage.close();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/alerts.test.js`
Expected: FAIL — no reachability POST is produced.

- [ ] **Step 3: Extend `evaluate` with reachability**

In `lib/alerts.js`, inside the `for (const [machine, m] of ...)` loop, *before* the threshold loop, add:

```js
const rule = this.resolveRule(machine, null);
if (rule.reachability) {
  const hostDown = m.status !== 'up';
  const t = this.#stepReachability({ machine, guest: null, down: hostDown, now });
  if (t) transitions.push(t);
}
```

Move the existing `const rule = this.resolveRule(machine, guest);` inside the per-target loop (rename the outer one or scope the inner). Simpler: inline the inner rule resolution. Replace the existing body of the outer `for` loop with:

```js
const hostRule = this.resolveRule(machine, null);
if (hostRule.reachability) {
  const hostDown = m.status !== 'up';
  const t = this.#stepReachability({ machine, guest: null, down: hostDown, now });
  if (t) transitions.push(t);
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
```

Add the reachability step method:

```js
#stepReachability({ machine, guest, down, now }) {
  const key = keyFor(machine, guest, 'reachability');
  const prev = this.#state.get(key);
  if (down) {
    if (!prev || prev.status !== 'firing') {
      this.#state.set(key, { status: 'firing', since: now, value: null });
      return { kind: 'firing', machine, guest, metric: 'reachability', value: null, threshold: null, durationMs: 0 };
    }
    return null;
  }
  if (prev && prev.status === 'firing') {
    this.#state.set(key, { status: 'ok', since: now, value: null });
    return { kind: 'resolved', machine, guest, metric: 'reachability', value: null, threshold: null, durationMs: now - prev.since };
  }
  this.#state.set(key, { status: 'ok', since: now, value: null });
  return null;
}
```

Update `#notify` to handle null values cleanly — replace the `pct` line with:

```js
const pct = t.value == null ? '' : (Number.isFinite(t.value) ? ` ${t.value.toFixed(0)}%` : '');
```

And update the title format:

```js
const title = t.kind === 'firing'
  ? `[FIRING] ${target} ${t.metric}${pct}`
  : `[OK] ${target} ${t.metric}${pct}`;
```

And the body:

```js
const body = t.kind === 'firing'
  ? (t.threshold != null ? `${t.metric} at${pct} (threshold ${t.threshold}%)` : `${t.metric} unreachable`)
  : (t.threshold != null ? `${t.metric} recovered${pct}` : `${t.metric} reachable again`);
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test test/alerts.test.js`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add lib/alerts.js
git commit -m "feat(alerts): reachability rule (no forMs gate)"
```

---

## Task 6: AlertManager — persist transitions to storage

**Files:**
- Modify: `lib/alerts.js`
- Test: `test/alerts.test.js`

- [ ] **Step 1: Write failing test — transitions write to alert_events**

Append to `test/alerts.test.js`:

```js
test('AlertManager.evaluate: transitions persist to storage', async () => {
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async () => ({ ok: true }),
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot),  0);
  await mgr.evaluate(mkState('m', hot),  60_000);
  await mgr.evaluate(mkState('m', cold), 120_000);
  const events = storage.listAlertEvents({ limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[1].kind, 'firing');
  assert.equal(events[0].kind, 'resolved');
  assert.equal(events[1].value, 95);
  assert.equal(events[1].threshold, 90);
  storage.close();
});

test('AlertManager.evaluate: ntfy failure does not prevent event row or block next call', async () => {
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async () => { throw new Error('network'); },
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot), 0);
  await mgr.evaluate(mkState('m', hot), 60_000);
  const events = storage.listAlertEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'firing');
  storage.close();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/alerts.test.js`
Expected: FAIL — events length is 0.

- [ ] **Step 3: Write event rows in `#notify` before POST**

In `lib/alerts.js`, edit `#notify` — insert a row *before* the `try { await this.#fetch(...) }` block:

```js
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
      ts: Date.now(),
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
    await this.#fetch(n.url, {
      method: 'POST',
      headers: { Title: title, Priority: priority, Tags: tags.join(',') },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error(`[alerts] ntfy POST failed: ${err.message}`);
  }
}
```

Note: `ts` uses `Date.now()` rather than the evaluation `now`. For tests, patch — actually, the tests don't check `ts` values, only count/kind/value. Leaving `Date.now()` is fine. If later we want deterministic timestamps, we can thread `now` through; not needed for correctness.

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/alerts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts.js
git commit -m "feat(alerts): persist transitions to alert_events before ntfy POST"
```

---

## Task 7: AlertManager — startup rehydration

**Files:**
- Modify: `lib/alerts.js`
- Test: `test/alerts.test.js`

- [ ] **Step 1: Write failing test — rehydrates firing state from DB**

Append to `test/alerts.test.js`:

```js
test('AlertManager: rehydrates firing state from storage on construct', async () => {
  const storage = new Storage(':memory:');
  // Seed: a firing event with no later resolved for m/_host/cpu
  storage.insertAlertEvent({ ts: 1000, machine: 'm', guest: null, metric: 'cpu', kind: 'firing', value: 95, threshold: 90, message: 'cpu hot' });

  const calls = [];
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });

  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };

  // First evaluate with condition still hot → must NOT re-fire
  await mgr.evaluate(mkState('m', hot), 10_000);
  assert.equal(calls.length, 0);

  // Cool down → resolved POST fires
  await mgr.evaluate(mkState('m', cold), 11_000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /OK.*m.*cpu/);
  storage.close();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/alerts.test.js`
Expected: FAIL — `calls.length` is 1 after first evaluate (it re-fires).

- [ ] **Step 3: Implement rehydration in constructor**

In `lib/alerts.js`, extend the constructor:

```js
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
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/alerts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts.js
git commit -m "feat(alerts): rehydrate firing state from alert_events on startup"
```

---

## Task 8: AlertManager — getActive accessor

**Files:**
- Modify: `lib/alerts.js`
- Test: `test/alerts.test.js`

- [ ] **Step 1: Write failing test for `getActive()`**

Append to `test/alerts.test.js`:

```js
test('AlertManager.getActive: returns currently-firing rules from in-memory state', async () => {
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async () => ({ ok: true }),
  });
  const hot = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot), 0);
  await mgr.evaluate(mkState('m', hot), 60_000);
  const active = mgr.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].machine, 'm');
  assert.equal(active[0].metric, 'cpu');
  assert.equal(active[0].value, 95);
  assert.equal(active[0].since, 60_000);
  storage.close();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/alerts.test.js`
Expected: FAIL — `mgr.getActive is not a function`.

- [ ] **Step 3: Implement `getActive`**

Add to the `AlertManager` class:

```js
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
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/alerts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts.js
git commit -m "feat(alerts): getActive() accessor for in-memory firing state"
```

---

## Task 9: Wire Poller → AlertManager

**Files:**
- Modify: `lib/poller.js`
- Test: `test/poller.test.js`

- [ ] **Step 1: Write failing test — poller calls alertManager.evaluate each tick**

Append to `test/poller.test.js`:

```js
test('Poller: invokes alertManager.evaluate(state) at end of tick', async () => {
  const calls = [];
  const fakeAlertManager = { evaluate: async (state, now) => { calls.push({ state, now }); } };
  const config = {
    server: { port: 0, pollIntervalMs: 60_000, proxmoxTimeoutMs: 1000, nodeExporterTimeoutMs: 1000, serviceTimeoutMs: 1000 },
    machines: [{ name: 'm', type: 'node_exporter', host: 'x', port: 9100 }],
  };
  const fakeScraper = async () => ({
    memTotal: 1000, memAvailable: 500, diskTotal: 10000, diskAvailable: 5000,
    netRxBytes: 0, netTxBytes: 0, cpuIdleSeconds: 0, cpuTotalSeconds: 1, bootTimeSeconds: 0, loadavg: [0,0,0],
  });
  const { Poller } = require('../lib/poller.js');
  const p = new Poller(config, { scrapers: { node_exporter: fakeScraper }, storage: null, alertManager: fakeAlertManager });
  await p.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].state.machines.m.status, 'up');
});
```

Ensure the test file already imports `test` and `assert` at the top — it does (see existing `test/poller.test.js`). You may need to avoid duplicate `const { Poller } = require(...)` if already imported at module scope; if so, drop the local require in the new test.

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/poller.test.js`
Expected: FAIL — `calls.length` is 0.

- [ ] **Step 3: Accept and invoke `alertManager` in `lib/poller.js`**

Modify the constructor signature and tick:

```js
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
```

Add field declaration at the top of the class next to `#storage`:

```js
#alertManager;
```

In `tick()`, after the `#persist` call, add:

```js
if (this.#alertManager) {
  try {
    await this.#alertManager.evaluate(this.#state, now);
  } catch (err) {
    console.error(`[poller] alert evaluation failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/poller.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/poller.js test/poller.test.js
git commit -m "feat(poller): invoke AlertManager.evaluate after persist"
```

---

## Task 10: server.js wiring — validation, construction, endpoints, pruning

**Files:**
- Modify: `server.js`
- Modify: `config.js`

- [ ] **Step 1: Extend `validateConfig` in `server.js`**

After the existing `guestLinks` validation loop in `validateConfig`, append:

```js
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
```

- [ ] **Step 2: Construct `AlertManager` and pass to `Poller` in `main()`**

At the top of `server.js`, add:

```js
const { AlertManager } = require('./lib/alerts.js');
```

In `main()`, after `const storage = new Storage(...)` and before `const poller = new Poller(...)`, add:

```js
const alertManager = config.alerts
  ? new AlertManager({ config: config.alerts, storage })
  : null;
```

Change the `Poller` construction to pass it:

```js
const poller = new Poller(config, {
  scrapers: {
    proxmox: (entry) => proxmox.fetch({ ...entry, proxmoxTimeoutMs: config.server.proxmoxTimeoutMs }),
    node_exporter: (entry) => nodeExporter.fetch({ ...entry, nodeExporterTimeoutMs: config.server.nodeExporterTimeoutMs }),
  },
  storage,
  alertManager,
});
```

- [ ] **Step 3: Prune alert events in the rollup interval**

In the existing rollup `setInterval(...)`, extend the try block:

```js
setInterval(() => {
  try {
    storage.rollup();
    storage.pruneAlertEvents();
  } catch (err) {
    console.error(`[storage] rollup failed: ${err.message}`);
  }
}, ROLLUP_INTERVAL_MS);
```

- [ ] **Step 4: Add `/api/alerts` and `/api/alerts/active` endpoints**

After the existing `/api/history` handler in `main()`, add:

```js
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
```

- [ ] **Step 5: Append template `alerts` block to `config.js`**

Append to `config.js` inside the exported object (after `guestLinks`, before the closing `}`):

```js
  // Alerting via ntfy. Remove this block (or leave it out) to disable alerts.
  // ntfy topics are their own auth — keep the URL private.
  alerts: {
    ntfy: {
      url: "https://ntfy.sh/REPLACE_ME",
      firingPriority: "high",
      resolvedPriority: "default",
      firingTags: ["warning"],
      resolvedTags: ["white_check_mark"],
    },
    defaults: {
      cpuPct: 90,
      memPct: 90,
      diskPct: 90,
      forMs: 5 * 60 * 1000,
      reachability: true,
    },
    overrides: [
      // { machine: "nas",              diskPct: 98 },
      // { machine: "proxmox-internal", guest: "plex-lxc", cpuPct: 95 },
    ],
  },
```

- [ ] **Step 6: Smoke-test the full suite**

Run: `node --test`
Expected: PASS. All existing + new tests green.

Also start the server once to confirm the validation path doesn't reject the `REPLACE_ME` template when the `alerts` block is *absent*:

Temporarily comment out the `alerts:` block in `config.js` and run `node -e "require('./server.js')"` — it should start and not throw about alerts. Stop it with Ctrl-C. Then restore the block, replace the URL with `https://ntfy.sh/REPLACE_ME` (still placeholder) and re-run — it should exit with `alerts.ntfy.url must be a non-empty URL`. Finally replace with a real-looking URL (`https://ntfy.sh/example`) and verify startup succeeds.

- [ ] **Step 7: Commit**

```bash
git add server.js config.js
git commit -m "feat(server): wire AlertManager + /api/alerts endpoints + validation"
```

---

## Task 11: Dashboard UI — alerts section

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add CSS for alerts section**

In `public/index.html`, inside the existing `<style>` block, append (before the closing `</style>`):

```css
.alerts-section {
  margin: 1.5rem 2rem;
  padding: 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--current-line);
  border-radius: 6px;
  font-family: "JetBrains Mono", monospace;
}
.alerts-section h2 {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--comment);
  margin-bottom: 0.75rem;
}
.alerts-active-list,
.alerts-history-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.alert-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  font-size: 0.85rem;
}
.alert-row.firing { background: rgba(255, 85, 85, 0.08); color: var(--red); }
.alert-row.resolved { color: var(--green); }
.alert-row .target { color: var(--fg); }
.alert-row .meta { color: var(--comment); font-size: 0.78rem; }
.alerts-empty { color: var(--comment); font-size: 0.85rem; font-style: italic; }
.alerts-history details > summary {
  cursor: pointer;
  color: var(--comment);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.5rem 0;
  user-select: none;
}
```

- [ ] **Step 2: Add HTML markup for alerts section**

In `public/index.html`, locate the existing `<main>` element (or the machines container — whatever the top-level layout wrapper is; find it via `grep -n 'id="machines"' public/index.html` or similar). Insert a new `<section>` immediately before the machines grid:

```html
<section class="alerts-section" id="alerts-section" hidden>
  <h2>Active Alerts</h2>
  <ul class="alerts-active-list" id="alerts-active"></ul>
  <div class="alerts-history">
    <details>
      <summary>History</summary>
      <ul class="alerts-history-list" id="alerts-history"></ul>
    </details>
  </div>
</section>
```

The section starts `hidden` — the fetch code below unhides it once the endpoints respond successfully (so dashboards with `alerts` disabled get no visual change).

- [ ] **Step 3: Add JS fetch + render logic**

In `public/index.html`, locate the existing `fetch('/api/stats')` refresh loop (search for `/api/stats`). Alongside it, add a parallel fetch for alerts. Inside the refresh function, after the stats fetch completes, add:

```js
async function refreshAlerts() {
  try {
    const [activeRes, historyRes] = await Promise.all([
      fetch('/api/alerts/active'),
      fetch('/api/alerts?limit=50'),
    ]);
    if (!activeRes.ok || !historyRes.ok) return;
    const { active } = await activeRes.json();
    const { events } = await historyRes.json();
    renderAlerts(active, events);
  } catch (err) {
    // silent — alerts are optional
  }
}

function renderAlerts(active, events) {
  const section = document.getElementById('alerts-section');
  const activeList = document.getElementById('alerts-active');
  const historyList = document.getElementById('alerts-history');
  section.hidden = false;

  activeList.innerHTML = '';
  if (!active || active.length === 0) {
    const li = document.createElement('li');
    li.className = 'alerts-empty';
    li.textContent = 'All clear.';
    activeList.appendChild(li);
  } else {
    for (const a of active) {
      const li = document.createElement('li');
      li.className = 'alert-row firing';
      const target = a.guest ? `${a.machine}/${a.guest}` : a.machine;
      const pct = a.value == null ? '' : `${Math.round(a.value)}%`;
      const thr = a.threshold == null ? '' : `≥ ${a.threshold}%`;
      const dur = a.since ? `firing for ${formatDuration(Date.now() - a.since)}` : '';
      li.innerHTML = `<span>●</span><span class="target">${target} ${a.metric} ${pct} ${thr}</span><span class="meta">${dur}</span>`;
      activeList.appendChild(li);
    }
  }

  historyList.innerHTML = '';
  for (const e of events) {
    const li = document.createElement('li');
    li.className = `alert-row ${e.kind}`;
    const target = e.guest ? `${e.machine}/${e.guest}` : e.machine;
    const pct = e.value == null ? '' : `${Math.round(e.value)}%`;
    const ts = new Date(e.ts).toLocaleString();
    const mark = e.kind === 'firing' ? '▲' : '▼';
    li.innerHTML = `<span>${mark}</span><span class="target">${target} ${e.metric} ${pct}</span><span class="meta">${ts}</span>`;
    historyList.appendChild(li);
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
```

Call `refreshAlerts()` alongside the existing stats refresh — find the existing refresh function (likely named `refresh`, `tick`, or similar) and add `refreshAlerts();` at its end. Also call `refreshAlerts()` once on initial load after the stats initial load.

- [ ] **Step 4: Manual browser test**

Run: `npm start` (or `node server.js`) with a real `alerts.ntfy.url` in `config.js`.

Open: `http://localhost:3000`

Expected:
- Alerts section visible above machine cards
- "Active Alerts: All clear." if no rules currently firing
- History collapsible empty on first run
- No console errors in browser devtools

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): alerts section with active + history lists"
```

---

## Task 12: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append an Alerting section to `README.md`**

Add a new section (placement: before any "Development" or at the end of the existing feature sections — whatever fits the current structure):

```markdown
## Alerting (ntfy)

The dashboard can push notifications to an [ntfy](https://ntfy.sh) topic when a rule fires or resolves. Add an `alerts` block to `config.js`:

    alerts: {
      ntfy: {
        url: "https://ntfy.sh/your-private-topic",
        firingPriority: "high",
        resolvedPriority: "default",
        firingTags: ["warning"],
        resolvedTags: ["white_check_mark"],
      },
      defaults: {
        cpuPct: 90,
        memPct: 90,
        diskPct: 90,
        forMs: 5 * 60 * 1000,
        reachability: true,
      },
      overrides: [
        { machine: "nas", diskPct: 98 },
        { machine: "proxmox-internal", guest: "plex-lxc", cpuPct: 95 },
      ],
    },

Rules: a condition must hold continuously for `forMs` before firing. Reachability (machine down) fires immediately. One notification on fire, one on resolve — no re-notify. Events are persisted to SQLite and surfaced in the dashboard's Alerts section. Omit the `alerts` block entirely to disable.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: ntfy alerting section"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full test suite**

Run: `node --test`
Expected: PASS, all tests green (storage, poller, alerts, proxmox, node_exporter).

- [ ] **Step 2: Start server, check /api/alerts endpoints with curl**

With `alerts` block configured and a valid topic:

```bash
node server.js &
sleep 3
curl -s http://localhost:3000/api/alerts | head -c 200
curl -s http://localhost:3000/api/alerts/active | head -c 200
kill %1
```

Expected: both endpoints return JSON. Active starts empty unless a machine is legitimately down.

- [ ] **Step 3: Send a real ntfy notification end-to-end**

Lower `cpuPct` to a value guaranteed to fire (e.g. 1) in `config.js`, lower `forMs` to `10_000`, start the server, wait ~20s, confirm a firing notification arrives on your ntfy subscription. Raise `cpuPct` back to 90, wait for the resolved notification. Restore original thresholds. Do NOT commit the temporary threshold changes.

- [ ] **Step 4: Final commit (only if any doc/config tidy-ups remain)**

If nothing new to commit, skip. Otherwise `git commit` any final cleanups.

---

## Spec coverage check

- [x] `alerts.ntfy.url` + priorities + tags — Tasks 4, 5, 10
- [x] `defaults` (cpu/mem/disk/forMs/reachability) + validation — Tasks 4, 10
- [x] `overrides` with (machine, guest) precedence — Task 3
- [x] Rule state machine (ok/pending/firing) — Tasks 4, 5
- [x] Reachability no-forMs shortcut — Task 5
- [x] `alert_events` table + 4 methods + retention — Tasks 1, 2
- [x] Startup rehydration — Task 7
- [x] Poller → AlertManager wiring — Task 9
- [x] `/api/alerts` + `/api/alerts/active` — Task 10
- [x] Dashboard UI section — Task 11
- [x] Test matrix from spec (transitions, forMs gating, override precedence, reachability, no-duplicate, ntfy failure resilience, rehydration) — Tasks 3–8
- [x] README — Task 12
