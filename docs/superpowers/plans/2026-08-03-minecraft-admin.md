# Minecraft Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add console, whitelist management, and live-log sections to the `/plan` page, driven by RCON (console/whitelist) and a companion log agent (logs), all behind a `config.minecraft` block.

**Architecture:** New `lib/rcon.js` (pure packet codec + connect-per-command socket client) and `lib/minecraft.js` (config validation, command allowlisting, whitelist parsing, SSE parsing, `McLogRelay`). Server mounts `/api/mc/*` only when `config.minecraft` is set, mirroring the conditional mounting pattern of `config.plan` / `config.tv`. The relay holds one upstream connection to `tools/mc-log-agent` (a single-file zero-dep script installed on the Minecraft host) and fans lines out through `SseBroker`. Frontend sections are appended to `public/plan.html` and reveal themselves only after `GET /api/mc/config` succeeds.

**Tech Stack:** Node 20, Express 4, `node:net` for RCON, `EventSource` + `SseBroker` for logs, vanilla JS, `node --test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-minecraft-admin-design.md`

**File map:**
- `lib/rcon.js` (new) — `encodePacket`, `decodePackets`, `rconExec`
- `lib/minecraft.js` (new) — `validateMinecraftConfig`, `checkCommand`, `isValidUsername`, `stripColorCodes`, `parseWhitelistList`, `classifyWhitelistResponse`, `parseSseChunk`, `McLogRelay`
- `server.js` — config validation hook, `if (config.minecraft)` route block
- `tools/mc-log-agent/` (new) — `mc-log-agent.js`, `mc-log-agent.service`, `README.md`
- `public/plan.html` — CONSOLE / WHITELIST / LIVE LOGS sections + styles + admin IIFE
- `dev.js` — `/api/mc/*` mocks (real validators, canned responses, fake log stream)
- `test/rcon.test.js` (new) — codec vectors, fragmentation, fake-server integration
- `test/minecraft.test.js` (new) — validation/allowlist/parser matrix
- `config.example.js` — commented `minecraft:` block
- `README.md` — "Minecraft admin" section
- `SECURITY.md` — new endpoints + warning

---

### Task 1: RCON client

- [x] `encodePacket`/`decodePackets` pure codec with fragmentation support
- [x] `rconExec` — connect → auth (id −1 → `rcon_auth_failed`) → exec → 100 ms multi-packet grace window; timeouts/conn errors → `rcon_unreachable`; module-level serialization
- [x] `test/rcon.test.js` incl. in-process fake RCON server

### Task 2: minecraft lib

- [x] `validateMinecraftConfig(mc, hasPlan)` (requires `plan`)
- [x] `checkCommand` (first-word allowlist, slash strip, length/control-char caps)
- [x] `parseWhitelistList` / `classifyWhitelistResponse` / `stripColorCodes`
- [x] `parseSseChunk` + `McLogRelay` (backoff reconnect, broker fan-out)
- [x] `test/minecraft.test.js`

### Task 3: server routes

- [x] validateConfig hook + `if (config.minecraft)` block
- [x] `GET /api/mc/config`, `POST /api/mc/command`, whitelist GET/add/remove
- [x] `GET /api/mc/logs/recent` proxy + `GET /api/mc/logs/stream` SSE (only with `logAgent`)

### Task 4: log agent

- [x] `mc-log-agent.js` — 500 ms stat-poll tail, rotation/truncation handling, ring buffer, `/recent` `/stream` `/healthz`
- [x] systemd unit + install README

### Task 5: frontend

- [x] Three hidden sections on `/plan`, revealed by `/api/mc/config` probe
- [x] Console pane with history (ArrowUp/Down), inline errors
- [x] Whitelist chips with confirm-remove, client-side name validation
- [x] Log pane: recent preload + EventSource tail, pause + scroll-lock, WARN/ERROR coloring, offline status chip

### Task 6: dev mocks, config, docs

- [x] `dev.js` mocks using the real `checkCommand`/`isValidUsername`
- [x] `config.example.js` block, README section, SECURITY.md updates
