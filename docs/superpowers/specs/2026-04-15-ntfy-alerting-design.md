# ntfy alerting — design

## Goal

Push notifications to an ntfy topic when monitored machines/guests cross CPU/memory/disk thresholds or become unreachable, plus a dashboard section showing current and historical alerts. Homelab-scale: one user, one ntfy topic, SQLite persistence.

## Non-goals

- No UI editor for rules (config.js only)
- No re-notify / escalation timer (fire-once-on-transition only)
- No per-rule mute / snooze
- No Slack / email / other channels
- No alert routing / grouping

## Config shape (`config.js`)

```js
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
    // { machine: "nas", diskPct: 98 },
    // { machine: "proxmox-internal", guest: "plex-lxc", cpuPct: 95 },
  ],
}
```

Rule resolution per target: override matching `(machine, guest)` > override matching `(machine)` only > `defaults`. Missing `alerts` block disables the feature — no errors, no notifications, poller behaves as today.

Validation (extend `validateConfig` in `server.js`): if `alerts` present, require `alerts.ntfy.url` non-empty and not `REPLACE_ME`; thresholds numeric in `[0,100]`; `forMs` positive integer; each override `machine` must match a configured machine.

## Architecture

New module `lib/alerts.js` exporting `AlertManager`. Single class, constructed in `server.js` (skipped if `config.alerts` absent) and passed into `Poller`. `Poller` invokes `alertManager.evaluate(state)` at the end of each poll cycle, immediately after the storage write, where `state` is the same object returned by `poller.getState()`.

`AlertManager` owns in-memory rule state and writes transitions to a new `alert_events` SQLite table. DB write precedes the ntfy POST; ntfy failures are logged but never thrown.

## Rule evaluation

For each host and each guest in `state`, `AlertManager` checks four metrics:

- `cpu` — firing when `cpuPct >= rule.cpuPct`
- `mem` — firing when `memUsed / memTotal * 100 >= rule.memPct`
- `disk` — firing when `diskUsed / diskTotal * 100 >= rule.diskPct` (skipped if totals unavailable)
- `reachability` — firing when scrape failed for a host, or guest status is not `running` (only for guests whose last-known status was `running`, to avoid alerting on intentionally stopped guests)

Per-rule state key: `${machine}/${guest ?? '_host'}/${metric}`. State values:

- `ok` — condition false
- `pending` — condition true, `since` < now − `forMs`
- `firing` — condition true, held for at least `forMs`

Transitions and actions:

| From | To | Trigger | Action |
|---|---|---|---|
| ok | pending | condition becomes true | set `since = now` |
| pending | pending | condition still true, `now - since < forMs` | — |
| pending | firing | condition still true, `now - since >= forMs` | INSERT `firing` event, POST to ntfy |
| pending | ok | condition becomes false before `forMs` elapsed | — (no notification) |
| firing | ok | condition becomes false | INSERT `resolved` event, POST to ntfy |

Reachability rules skip the `forMs` gate — scrape failures transition straight `ok → firing`. Rationale: a machine being down is binary and immediate; a 5-minute hold would mask real outages.

## ntfy delivery

`POST <url>` with body = human-readable message, headers:

- `Title: [FIRING] proxmox-dmz/plex-lxc cpu 94%` / `[OK] proxmox-dmz/plex-lxc cpu 42%`
- `Priority: <firingPriority|resolvedPriority>`
- `Tags: <comma-separated>`

Body includes target, metric, observed value, threshold, and duration held (for firing events). Uses global `fetch`. Timeout via `AbortSignal.timeout(5000)`. Any non-2xx response or network error is logged via `console.error` with context; the DB event row is still written (source of truth).

## Persistence

New SQLite table in `lib/storage.js`:

```sql
CREATE TABLE alert_events (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  machine   TEXT    NOT NULL,
  guest     TEXT,
  metric    TEXT    NOT NULL,  -- 'cpu' | 'mem' | 'disk' | 'reachability'
  kind      TEXT    NOT NULL,  -- 'firing' | 'resolved'
  value     REAL,
  threshold REAL,
  message   TEXT
);
CREATE INDEX alert_events_ts ON alert_events(ts DESC);
CREATE INDEX alert_events_target ON alert_events(machine, guest, metric, ts DESC);
```

New `Storage` methods:

- `insertAlertEvent({ ts, machine, guest, metric, kind, value, threshold, message })`
- `listAlertEvents({ limit, machine, guest })` — newest first
- `listActiveFiring()` — for each `(machine, guest, metric)` key, returns the most recent event iff it is `kind='firing'`. Used once at startup to rehydrate `AlertManager` state.
- `pruneAlertEvents()` — keep the most recent 1000 events OR anything in the last 90 days, whichever set is larger. Called from the existing 5-minute rollup interval.

Startup rehydration: `AlertManager` constructor calls `storage.listActiveFiring()` and seeds its in-memory map with each key in `firing` state using the stored `ts` as `since`. No notifications are sent during rehydration. Result: a process restart during an active alert does not re-fire, and recoveries that happen during the restart window will send a resolved notification on the next poll (not perfect but acceptable — homelab-scale).

## HTTP API

Two new endpoints in `server.js`:

- `GET /api/alerts?limit=100&machine=&guest=` — most recent events first, default limit 100, max 500. Optional `machine` / `guest` filters.
- `GET /api/alerts/active` — currently-firing rules, derived from `AlertManager.getActive()` (in-memory). Each entry: `{ machine, guest, metric, since, value, threshold }`.

Both return JSON. Errors use the same `500 { error: msg }` pattern as `/api/history`.

## UI (`public/index.html`)

Add an **Alerts** section to the dashboard, above or below the existing machine cards (pick whichever fits the current layout — this is a single file so it'll be clear when editing).

- **Active** — styled-red list of currently-firing alerts (from `/api/alerts/active`). Empty state: "All clear." Each row: target, metric, value vs threshold, "firing for Xm".
- **History** — collapsible, last 50 events from `/api/alerts?limit=50`. Each row: timestamp, target, metric, kind (firing/resolved), value.

Both polled on the same interval as `/api/stats` (reuse existing refresh loop). No new UI libraries; match the existing vanilla-HTML/CSS style.

## Testing (`test/alerts.test.js`)

Unit tests for `AlertManager.evaluate` using a stub `fetch` (capture calls, return 200) and an in-memory `Storage` (or a temp-file DB):

1. Threshold transitions: `ok → pending → firing → ok` over a sequence of evaluate calls with controlled timestamps; verify exactly one firing POST and one resolved POST.
2. `forMs` gating: condition holds for less than `forMs` then clears → no notifications.
3. Override precedence: guest override beats machine override beats defaults.
4. Reachability firing on scrape error (host) and on guest status transition away from `running`.
5. No duplicate firing notification while state stays `firing`.
6. ntfy POST failure: `console.error` called, DB event still written, subsequent evaluate calls not blocked.
7. Startup rehydration: seed `alert_events` with a `firing` row having no later `resolved`, construct `AlertManager`, first evaluate with condition still true → no new notification; evaluate with condition false → resolved notification.

No live ntfy calls. No live Proxmox/node_exporter calls (stub `state`).

## Files touched

- `config.js` — add `alerts` block (committed with `REPLACE_ME` topic, matching existing pattern)
- `lib/alerts.js` — new
- `lib/storage.js` — new table + 4 methods + pruning
- `lib/poller.js` — invoke `alertManager.evaluate(state)` after storage write
- `server.js` — construct `AlertManager`, extend `validateConfig`, add two endpoints
- `public/index.html` — Alerts section (active + history)
- `test/alerts.test.js` — new
- `README.md` — short "Alerting" section pointing at the `alerts` config block
