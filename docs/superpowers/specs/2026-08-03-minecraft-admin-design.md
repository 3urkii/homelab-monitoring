# Minecraft Admin Design (Console, Whitelist, Live Logs)

## Goals

Administer the Minecraft server from the dashboard's existing `/plan` page:

1. **Console** — run server commands and see their output.
2. **Whitelist** — list, add, and remove whitelisted players.
3. **Live logs** — tail the server log in the browser.

## Non-goals

- No free-form command execution: only an allowlisted set of first-words is
  accepted (default excludes `op`, `stop`, `ban`, `gamemode`, `execute`).
- No authentication layer (matches the project's trusted-LAN model; see
  SECURITY.md).
- No dedicated admin page — the sections extend `/plan`.
- No log history/search — a live tail plus a recent-lines ring buffer only.

## Context

The Minecraft server runs on a separate Proxmox guest, inside a screen session
launched by systemd. The dashboard only reaches it over the network. Two
transports are used:

- **RCON** (Source RCON protocol, TCP, default port 25575) for console and
  whitelist. The user enables it in `server.properties`. RCON is
  request/response only — it cannot stream logs.
- **mc-log-agent** (`tools/mc-log-agent/`), a single-file zero-dependency Node
  script installed on the Minecraft host, tails `logs/latest.log` and serves
  recent lines + an SSE stream. The dashboard relays it so browsers never
  talk to the Minecraft host directly.

```
browser (plan.html) ── fetch/EventSource ──▶ dashboard (if (config.minecraft))
    ├─ lib/rcon.js ── TCP :25575 ──▶ MC server RCON (connect-per-command)
    └─ McLogRelay ── HTTP :8127 ──▶ tools/mc-log-agent (tails latest.log)
         └─▶ SseBroker ──▶ N browsers (/api/mc/logs/stream)
```

## Protocol notes

**RCON** (`lib/rcon.js`): frames are `int32LE length | int32LE id | int32LE
type | UTF-8 body | 0x00 0x00`. Types: AUTH=3, EXEC=2, AUTH_RESPONSE=2,
RESPONSE_VALUE=0. Auth failure is signalled by response id `-1`.
Decisions:

- **Connect-per-command.** Admin actions are human-paced; a LAN
  connect+auth costs ~2 ms and eliminates stale-socket state after MC
  restarts.
- **100 ms grace window** after the first RESPONSE_VALUE to concatenate
  multi-packet responses (Paper splits long ones; vanilla truncates at 4096
  bytes and never splits).
- **Serialized** through a module-level promise chain — vanilla's RCON
  thread misbehaves under concurrent commands.

**Log agent** (`tools/mc-log-agent/mc-log-agent.js`): tails via 500 ms
stat-polling rather than `fs.watch` because log4j rotation renames
`latest.log`, which breaks inotify watchers. Inode change or size shrink →
reopen at offset 0. Ring buffer of the last 2000 lines. Endpoints:
`GET /recent?lines=N`, `GET /stream` (SSE `line` events `{ts, line}`),
`GET /healthz`.

**Relay** (`McLogRelay` in `lib/minecraft.js`): the dashboard holds one
always-on fetch-stream to the agent (HAClient-style exponential backoff,
1s → 30s jittered) and fans lines out to browser SSE clients via the shared
`SseBroker` — N tabs cost the Minecraft host one connection.

## Endpoints

All mounted inside `if (config.minecraft)`. Error bodies are `{ error }`.
RCON failures map to 503 (`rcon_unreachable`, `rcon_auth_failed`) or 502.

| Method/Path | Request → Response |
|---|---|
| `GET /api/mc/config` | → `{ console, whitelist, logs, allowlist }` (feature probe, no secrets) |
| `POST /api/mc/command` | `{ command }` → `{ command, response }` (color-stripped) |
| `GET /api/mc/whitelist` | → `{ players }` |
| `POST /api/mc/whitelist/add` | `{ name }` → `{ ok, result, response, players }` |
| `POST /api/mc/whitelist/remove` | `{ name }` → same shape |
| `GET /api/mc/logs/recent?lines=N` | → `{ file, lines }` (proxied; N clamped 1..1000) |
| `GET /api/mc/logs/stream` | SSE `line` / `offline` events |

Log routes are mounted only when `config.minecraft.logAgent` is set.

## Security model

- The RCON password lives in gitignored `config.js` and never reaches the
  browser; all RCON goes through the backend.
- The command allowlist is enforced **server-side** on the first word
  (case-insensitive, one leading `/` stripped, control chars rejected).
- Whitelist names are validated against `^[A-Za-z0-9_]{3,16}$` before being
  interpolated into RCON commands.
- The log agent is unauthenticated (LAN trust model); its README instructs
  firewalling the port to the dashboard host. Log lines include player IPs.
- SECURITY.md documents all new endpoints and warns against extending the
  allowlist with `op`/`stop`/`ban`/`gamemode`/`execute`.

## Known limitations

- Vanilla truncates RCON responses at 4096 bytes (long `whitelist list` gets
  cut; the parser degrades gracefully).
- `tps` is Paper/Spigot-only.
- `whitelist list` wording varies by version; the parser splits on the first
  colon and filters tokens by the username regex, tolerating known variants.
