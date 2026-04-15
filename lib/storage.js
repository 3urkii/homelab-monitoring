const Database = require('better-sqlite3');

const HOT_MS = 24 * 60 * 60 * 1000;          // 24h at 10s granularity
const WARM_MS = 7 * 24 * 60 * 60 * 1000;     // 7d at 1min granularity
const COLD_MS = 30 * 24 * 60 * 60 * 1000;    // 30d at 10min granularity

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine TEXT NOT NULL,
    guest TEXT,
    UNIQUE(machine, guest)
  );

  CREATE TABLE IF NOT EXISTS samples_10s (
    entity_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    cpu_pct REAL,
    mem_used INTEGER,
    mem_total INTEGER,
    disk_used INTEGER,
    disk_total INTEGER,
    net_rx REAL,
    net_tx REAL,
    PRIMARY KEY (entity_id, ts)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS samples_1m (
    entity_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    cpu_pct REAL,
    mem_used INTEGER,
    mem_total INTEGER,
    disk_used INTEGER,
    disk_total INTEGER,
    net_rx REAL,
    net_tx REAL,
    PRIMARY KEY (entity_id, ts)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS samples_10m (
    entity_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    cpu_pct REAL,
    mem_used INTEGER,
    mem_total INTEGER,
    disk_used INTEGER,
    disk_total INTEGER,
    net_rx REAL,
    net_tx REAL,
    PRIMARY KEY (entity_id, ts)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS alert_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    machine    TEXT    NOT NULL,
    guest      TEXT,
    metric     TEXT    NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('firing', 'resolved')),
    value      REAL,
    threshold  REAL,
    message    TEXT
  );
  CREATE INDEX IF NOT EXISTS alert_events_ts_idx     ON alert_events(ts DESC);
  CREATE INDEX IF NOT EXISTS alert_events_target_idx ON alert_events(machine, guest, metric, ts DESC);
`;

const METRIC_COLUMNS = {
  cpu: 'cpu_pct',
  memUsed: 'mem_used',
  memTotal: 'mem_total',
  diskUsed: 'disk_used',
  diskTotal: 'disk_total',
  netRx: 'net_rx',
  netTx: 'net_tx',
};

class Storage {
  #db;
  #entityCache = new Map();
  #insertStmt;
  #findEntityStmt;
  #createEntityStmt;
  #queryStmts = {};
  #insertAlertStmt;
  #listAlertsAllStmt;
  #listAlertsMachineStmt;
  #listActiveFiringStmt;

  constructor(pathOrMemory = ':memory:') {
    this.#db = new Database(pathOrMemory);
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('synchronous = NORMAL');
    this.#db.exec(SCHEMA);
    this.#prepareStatements();
  }

  #prepareStatements() {
    this.#findEntityStmt = this.#db.prepare(
      'SELECT id FROM entities WHERE machine = ? AND guest IS ?',
    );
    this.#createEntityStmt = this.#db.prepare(
      'INSERT INTO entities (machine, guest) VALUES (?, ?)',
    );
    this.#insertStmt = this.#db.prepare(`
      INSERT OR REPLACE INTO samples_10s
      (entity_id, ts, cpu_pct, mem_used, mem_total, disk_used, disk_total, net_rx, net_tx)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
    for (const table of ['samples_10s', 'samples_1m', 'samples_10m']) {
      this.#queryStmts[table] = {};
      for (const [metric, col] of Object.entries(METRIC_COLUMNS)) {
        this.#queryStmts[table][metric] = this.#db.prepare(
          `SELECT ts, ${col} AS v FROM ${table} WHERE entity_id = ? AND ts >= ? AND ts <= ? ORDER BY ts`,
        );
      }
    }
  }

  getOrCreateEntityId(machine, guest) {
    const key = `${machine}\x00${guest ?? ''}`;
    if (this.#entityCache.has(key)) return this.#entityCache.get(key);
    const guestKey = guest ?? null;
    const existing = this.#findEntityStmt.get(machine, guestKey);
    let id;
    if (existing) {
      id = existing.id;
    } else {
      const result = this.#createEntityStmt.run(machine, guestKey);
      id = result.lastInsertRowid;
    }
    this.#entityCache.set(key, id);
    return id;
  }

  insertBatch(samples) {
    const insertMany = this.#db.transaction((rows) => {
      for (const s of rows) {
        const entityId = this.getOrCreateEntityId(s.machine, s.guest);
        this.#insertStmt.run(
          entityId,
          s.ts,
          s.cpuPct ?? null,
          s.memUsed ?? null,
          s.memTotal ?? null,
          s.diskUsed ?? null,
          s.diskTotal ?? null,
          s.netRx ?? null,
          s.netTx ?? null,
        );
      }
    });
    insertMany(samples);
  }

  query({ machine, guest, metric, fromTs, toTs, tier = 'auto' }) {
    if (!METRIC_COLUMNS[metric]) {
      throw new Error(`unknown metric: ${metric}`);
    }
    const resolvedTier = tier === 'auto' ? this.#pickTier(fromTs, toTs) : tier;
    const table = this.#tierTable(resolvedTier);
    const entityId = this.getOrCreateEntityId(machine, guest);
    const rows = this.#queryStmts[table][metric].all(entityId, fromTs, toTs);
    return rows.map((r) => [r.ts, r.v]);
  }

  #pickTier(fromTs, toTs) {
    const span = toTs - fromTs;
    if (span <= HOT_MS) return '10s';
    if (span <= WARM_MS) return '1m';
    return '10m';
  }

  #tierTable(tier) {
    if (tier === '10s') return 'samples_10s';
    if (tier === '1m') return 'samples_1m';
    if (tier === '10m') return 'samples_10m';
    throw new Error(`unknown tier: ${tier}`);
  }

  rollup(now = Date.now()) {
    const cutoffHotToWarm = now - HOT_MS;
    const cutoffWarmToCold = now - WARM_MS;
    const cutoffColdDrop = now - COLD_MS;

    this.#db.exec(`
      INSERT OR REPLACE INTO samples_1m
      (entity_id, ts, cpu_pct, mem_used, mem_total, disk_used, disk_total, net_rx, net_tx)
      SELECT
        entity_id,
        (ts / 60000) * 60000 AS bucket,
        AVG(cpu_pct),
        AVG(mem_used),
        MAX(mem_total),
        AVG(disk_used),
        MAX(disk_total),
        AVG(net_rx),
        AVG(net_tx)
      FROM samples_10s
      WHERE ts < ${cutoffHotToWarm}
      GROUP BY entity_id, bucket
    `);
    this.#db.prepare('DELETE FROM samples_10s WHERE ts < ?').run(cutoffHotToWarm);

    this.#db.exec(`
      INSERT OR REPLACE INTO samples_10m
      (entity_id, ts, cpu_pct, mem_used, mem_total, disk_used, disk_total, net_rx, net_tx)
      SELECT
        entity_id,
        (ts / 600000) * 600000 AS bucket,
        AVG(cpu_pct),
        AVG(mem_used),
        MAX(mem_total),
        AVG(disk_used),
        MAX(disk_total),
        AVG(net_rx),
        AVG(net_tx)
      FROM samples_1m
      WHERE ts < ${cutoffWarmToCold}
      GROUP BY entity_id, bucket
    `);
    this.#db.prepare('DELETE FROM samples_1m WHERE ts < ?').run(cutoffWarmToCold);

    this.#db.prepare('DELETE FROM samples_10m WHERE ts < ?').run(cutoffColdDrop);
  }

  stats() {
    const row10s = this.#db.prepare('SELECT COUNT(*) AS n FROM samples_10s').get();
    const row1m = this.#db.prepare('SELECT COUNT(*) AS n FROM samples_1m').get();
    const row10m = this.#db.prepare('SELECT COUNT(*) AS n FROM samples_10m').get();
    const rowEntities = this.#db.prepare('SELECT COUNT(*) AS n FROM entities').get();
    return {
      entities: rowEntities.n,
      samples10s: row10s.n,
      samples1m: row1m.n,
      samples10m: row10m.n,
    };
  }

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

  listActiveFiring() {
    return this.#listActiveFiringStmt.all();
  }

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

  close() {
    this.#db.close();
  }
}

module.exports = { Storage, HOT_MS, WARM_MS, COLD_MS, METRIC_COLUMNS };
