# Lights Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `public/lights.html` with a glow-card grid (overview) + native `<dialog>` room sheet (drill-in) per the design at `docs/superpowers/specs/2026-05-01-lights-page-redesign-design.md`.

**Architecture:** Single self-contained file (`public/lights.html`) with inline `<style>` + `<script>` — matches the pattern of every other page in `public/`. Data layer (SSE state map, optimistic updates, debounce) is preserved. Only the render path, DOM structure, CSS, and event wiring change.

**Tech Stack:** Plain HTML/CSS/ES2022. No build step. Server APIs untouched (`GET /api/lights/stream`, `POST /api/lights/:id`, `POST /api/scenes/:id/activate`).

**Verification model:** This codebase has `node:test` for `lib/*` modules but no frontend test framework. Frontend changes are verified by running `npm run dev` (uses mock fixtures via `dev.js`) and exercising interactions in the browser. Each task ends with manual verification steps and a commit.

---

## File Structure

- **Modify:** `public/lights.html` — only file changed. Existing structure preserved at the data-layer level (`state`, `applySnapshot`, `applyStateChange`, `connect`, `postLight`, `activateScene`, debounce helpers, `rgbToHex`, `hexToRgb`); render & DOM completely replaced.

No new files. No new endpoints. No package.json changes.

---

## Reference: data shapes (from `lib/home_assistant.js`)

```js
// Snapshot from SSE 'snapshot' event
{ rooms: [{ id, name, lights: Light[], scenes: Scene[] }],
  unassigned: { lights: Light[], scenes: Scene[] } }

// Light
{ entity_id, name, on, reachable, brightness_pct, rgb, supports_color }
// rgb is [r,g,b] or null. brightness_pct is 0..100 (0 when off).

// Scene
{ entity_id, name }

// SSE 'state' event
{ entity_id, kind: 'light'|'scene', state: <light fields>|undefined }
```

Server commands (preserved):
- `POST /api/lights/:entity_id` body `{ on?, brightness_pct?, rgb_color? }`
- `POST /api/scenes/:entity_id/activate`

---

## Task 1: Set up dev environment & baseline

**Files:**
- Read: `public/lights.html`, `dev.js`, `package.json`

- [ ] **Step 1: Confirm dev server runs**

Run: `npm run dev`
Expected: Server listens on a port (default 3000). `dev.js` provides mock Home Assistant fixtures so the lights endpoints return data even without a real HA install.

- [ ] **Step 2: Open current page in browser**

Open `http://localhost:3000/lights.html`. Confirm the existing page renders rooms and lights from mock data. This is your visual baseline — keep this tab open through the whole plan to compare.

- [ ] **Step 3: Confirm `git status` is clean before starting**

Run: `git status`
Expected: branch is clean, or only the spec/plan docs are modified. Stash anything else.

No commit for this task.

---

## Task 2: Replace CSS with new tokens & layout

**Files:**
- Modify: `public/lights.html` (the `<style>` block, lines ~15–224)

- [ ] **Step 1: Replace the `<style>` block**

Open `public/lights.html`. Replace everything between `<style>` and `</style>` with the CSS below. Keep the `:root` Dracula tokens (they exist in other pages too); add new component CSS for room-grid, room-card, room-sheet, light-row, scene-chip.

```css
:root {
  --bg: #282a36;
  --bg-alt: #1e1f29;
  --surface: #343746;
  --current-line: #44475a;
  --fg: #f8f8f2;
  --comment: #6272a4;
  --green: #50fa7b;
  --yellow: #f1fa8c;
  --orange: #ffb86c;
  --red: #ff5555;
  --pink: #ff79c6;
  --purple: #bd93f9;
  --cyan: #8be9fd;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--fg);
  font-family: Rajdhani, "JetBrains Mono", monospace;
  min-height: 100vh; color-scheme: dark; overflow-x: hidden;
}
body::after {
  content: ""; position: fixed; inset: 0;
  background: repeating-linear-gradient(to bottom, transparent 0, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px);
  pointer-events: none; z-index: 9999;
}

header {
  border-bottom: 1px solid var(--current-line);
  background: linear-gradient(180deg, var(--bg-alt) 0%, var(--bg) 100%);
  padding: 1.5rem 2rem;
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
}
.back-link {
  font-family: "JetBrains Mono", monospace; font-size: 0.85rem;
  color: var(--comment); text-decoration: none;
  border: 1px solid var(--current-line); padding: 0.3rem 0.7rem; border-radius: 4px;
  transition: color 140ms var(--ease-out), border-color 140ms var(--ease-out);
}
.back-link:hover { color: var(--purple); border-color: var(--purple); }
h1 {
  font-family: "JetBrains Mono", monospace;
  font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em;
}
h1 .bracket { color: var(--comment); }
h1 .domain  { color: var(--purple); text-shadow: 0 0 24px rgba(189,147,249,0.45); }
h1 .tld     { color: var(--pink);   text-shadow: 0 0 24px rgba(255,121,198,0.45); }
h1 .sub     { color: var(--cyan); font-size: 0.85em; margin-left: 0.4ch; }

.header-actions { display: flex; align-items: center; gap: 0.75rem; margin-left: auto; }
.count-chip {
  font-family: "JetBrains Mono", monospace; font-size: 0.78rem;
  color: var(--comment); letter-spacing: 0.06em;
}
.count-chip strong { color: var(--purple); font-weight: 700; }
.all-off-btn {
  background: transparent; border: 1px solid var(--red); color: var(--red);
  font-family: "JetBrains Mono", monospace; font-size: 0.78rem;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.4rem 0.9rem; border-radius: 4px; cursor: pointer;
  transition: background 140ms var(--ease-out);
}
.all-off-btn:hover { background: rgba(255,85,85,0.1); }
.all-off-btn:active { transform: scale(0.97); }
.all-off-btn[disabled] { opacity: 0.4; cursor: default; }
.status-chip {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--comment);
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.status-chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--comment); }
.status-chip[data-status="up"]   .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.status-chip[data-status="down"] .dot { background: var(--red);   box-shadow: 0 0 6px var(--red); }

main {
  max-width: 1100px; margin: 0 auto; padding: 2rem;
  display: flex; flex-direction: column; gap: 1.25rem;
}
.section-title {
  font-family: Rajdhani, monospace;
  font-size: 0.85rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.15em; color: var(--comment);
}
.section-title .accent { color: var(--pink); margin-right: 0.5ch; }

.error-banner {
  background: rgba(255,85,85,0.08); border: 1px solid var(--red); border-radius: 4px;
  padding: 0.7rem 1rem; color: var(--red);
  font-family: "JetBrains Mono", monospace; font-size: 0.85rem;
  display: none;
}
.error-banner[data-show="true"] { display: block; }

/* Room grid */
.room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}
.room-card {
  position: relative; overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--current-line);
  border-radius: 8px;
  padding: 1.1rem 1.1rem 1rem;
  min-height: 160px;
  display: flex; flex-direction: column; gap: 0.6rem;
  animation: cardEntry 360ms var(--ease-out) both;
  transition: border-color 200ms var(--ease-out);
}
.room-card[data-disconnected="true"] { opacity: 0.55; }
@keyframes cardEntry {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.room-card .glow {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 30% 30%, var(--glow-color, transparent) 0%, transparent 60%);
  pointer-events: none; transition: background 300ms var(--ease-out);
}
.room-card-head { display: flex; align-items: flex-start; gap: 0.75rem; position: relative; }
.power-orb {
  width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
  background: transparent;
  border: 1.5px solid var(--current-line);
  color: var(--comment);
  font-size: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: border-color 200ms var(--ease-out), color 200ms var(--ease-out), box-shadow 200ms var(--ease-out);
}
.room-card[data-on="true"] .power-orb {
  border-color: var(--green); color: var(--green);
  box-shadow: 0 0 12px rgba(80,250,123,0.35);
}
.power-orb:active { transform: scale(0.94); }
.room-card-info { flex: 1; min-width: 0; cursor: pointer; }
.room-name {
  font-family: Rajdhani, monospace; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em; font-size: 1.05rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.room-meta {
  font-family: "JetBrains Mono", monospace; font-size: 0.74rem;
  color: var(--comment); letter-spacing: 0.04em; margin-top: 0.15rem;
}
.scene-strip {
  margin-top: auto; display: flex; flex-wrap: wrap; gap: 0.35rem;
  position: relative;
}
.scene-chip {
  background: transparent; border: 1px solid var(--current-line);
  color: var(--cyan);
  font-family: "JetBrains Mono", monospace; font-size: 0.7rem;
  text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.3rem 0.6rem; border-radius: 4px; cursor: pointer;
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}
.scene-chip:hover { border-color: var(--cyan); background: rgba(139,233,253,0.08); }
.scene-chip:active { transform: scale(0.97); }
.scene-chip[data-more="true"] { color: var(--comment); cursor: pointer; }

/* Room sheet (dialog) */
.room-sheet {
  background: var(--bg-alt);
  color: var(--fg);
  border: 1px solid var(--current-line);
  border-top: 2px solid var(--purple);
  border-radius: 12px;
  padding: 0;
  max-height: 85vh;
  width: min(420px, calc(100vw - 2rem));
  margin: auto;
  position: relative; overflow: hidden;
}
.room-sheet::backdrop { background: rgba(20, 20, 30, 0.55); backdrop-filter: blur(2px); }
.room-sheet .sheet-glow {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 0%, var(--glow-color, transparent) 0%, transparent 50%);
  pointer-events: none;
}
.sheet-inner { position: relative; padding: 1rem 1.1rem 1.2rem; max-height: 85vh; overflow-y: auto; }
.sheet-head {
  display: flex; align-items: center; gap: 0.75rem;
  padding-bottom: 0.75rem; border-bottom: 1px dashed var(--current-line);
}
.sheet-close {
  background: transparent; border: 0; color: var(--comment);
  font-size: 1.2rem; cursor: pointer; margin-left: auto; padding: 0.3rem 0.5rem;
}
.sheet-close:hover { color: var(--fg); }

.sheet-section-label {
  font-family: "JetBrains Mono", monospace; font-size: 0.7rem;
  color: var(--comment); letter-spacing: 0.15em;
  margin: 1rem 0 0.5rem;
}
.sheet-section-label .accent { color: var(--pink); margin-right: 0.4ch; }

.master-row, .light-row {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.45rem 0;
}
.light-row + .light-row { border-top: 1px dashed var(--current-line); }
.light-row[data-reachable="false"] { opacity: 0.45; pointer-events: none; }
.master-row .label, .light-row .light-name {
  font-family: "JetBrains Mono", monospace; font-size: 0.78rem;
  min-width: 5.5rem;
}
.master-row .label { color: var(--comment); text-transform: uppercase; letter-spacing: 0.06em; }
.light-status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--comment); flex-shrink: 0; }
.light-row[data-on="true"] .light-status-dot {
  background: var(--green); box-shadow: 0 0 6px var(--green);
}
.light-row[data-reachable="false"] .light-status-dot { background: var(--red); }
input[type=range].brightness {
  flex: 1; min-width: 80px; accent-color: var(--purple); height: 32px;
}
.brightness-value {
  font-family: "JetBrains Mono", monospace; font-size: 0.74rem;
  min-width: 2.8rem; text-align: right; color: var(--fg);
}
.swatch {
  width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid var(--current-line);
  cursor: pointer; padding: 0; position: relative; overflow: hidden;
  flex-shrink: 0;
}
.swatch input[type=color] {
  position: absolute; inset: 0; opacity: 0; cursor: pointer;
  width: 100%; height: 100%; border: none;
}
.swatch[hidden] { display: none; }
.badge {
  font-family: "JetBrains Mono", monospace; font-size: 0.65rem;
  letter-spacing: 0.06em; padding: 2px 6px; border-radius: 3px;
  border: 1px solid; flex-shrink: 0;
}
.badge.unreachable { color: var(--orange); border-color: var(--orange); }
.badge.dim { color: var(--comment); border-color: var(--comment); }

.scene-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.scene-list .scene-chip { font-size: 0.72rem; }
.empty-note {
  font-family: "JetBrains Mono", monospace; font-size: 0.78rem;
  color: var(--comment); font-style: italic; padding: 0.5rem 0;
}

.empty {
  font-family: "JetBrains Mono", monospace; font-size: 0.85rem;
  color: var(--comment); padding: 2rem; text-align: center;
}

/* Toggle button (used inside sheet for per-light on/off) */
.toggle {
  background: transparent; border: 1px solid var(--current-line);
  color: var(--comment); font-family: "JetBrains Mono", monospace;
  font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em;
  padding: 0.3rem 0.7rem; border-radius: 4px; cursor: pointer;
  min-height: 32px; min-width: 50px;
  transition: border-color 140ms var(--ease-out), color 140ms var(--ease-out);
}
.toggle[data-on="true"] { border-color: var(--green); color: var(--green); }
.toggle:active { transform: scale(0.97); }

@media (max-width: 600px) {
  header { padding: 1rem 1.25rem; }
  main { padding: 1.25rem; gap: 1rem; }
  .room-grid { grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
  .room-card { padding: 0.85rem; min-height: 130px; }
  .power-orb { width: 36px; height: 36px; font-size: 14px; }
  .room-name { font-size: 0.9rem; letter-spacing: 0.05em; }
  .room-sheet { max-height: 90vh; width: 100vw; margin: 0; margin-top: auto; border-radius: 12px 12px 0 0; }
  .sheet-inner { max-height: 90vh; }
}
@media (max-width: 380px) {
  .room-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Reload `lights.html`**

Existing JS still references the old class names (`.room`, `.light`, etc.) so the old CSS classes won't apply. Page will look broken — that's expected; the next tasks rebuild the DOM.

- [ ] **Step 3: Commit**

```bash
git add public/lights.html
git commit -m "refactor(lights): replace stylesheet for grid + sheet layout"
```

---

## Task 3: Replace top-level HTML scaffold

**Files:**
- Modify: `public/lights.html` `<body>` block (lines ~227–238 in original)

- [ ] **Step 1: Replace the `<body>` markup**

Replace from `<body>` opening tag to `<script>` opening tag (everything in between) with:

```html
<body>
<header>
  <a href="/" class="back-link">&larr; home</a>
  <h1><span class="bracket">[</span><span class="domain">burkii</span><span class="tld">.home</span><span class="bracket">]</span> <span class="sub">/ lights</span></h1>
  <div class="header-actions">
    <span class="count-chip"><strong id="onCount">0</strong> on / <span id="totalCount">0</span></span>
    <button class="all-off-btn" id="allOffBtn" type="button" disabled>ALL OFF</button>
    <div class="status-chip" id="connStatus" data-status="down"><span class="dot"></span><span id="connLabel">connecting</span></div>
  </div>
</header>
<main>
  <div class="error-banner" id="errorBanner">home-assistant offline — reconnecting…</div>
  <section>
    <div class="section-title"><span class="accent">&gt;</span>ROOMS</div>
    <div id="rooms" class="room-grid"></div>
  </section>
</main>

<dialog class="room-sheet" id="roomSheet">
  <div class="sheet-glow" aria-hidden="true"></div>
  <div class="sheet-inner" id="sheetInner"></div>
</dialog>
```

- [ ] **Step 2: Reload page**

Page now shows header + empty grid + a hidden `<dialog>`. JS will throw because `renderRoom` etc. expects classes that no longer exist.

No commit yet — Task 4 wires the JS. Keep the diff staged in your editor.

---

## Task 4: Replace render path with new card structure

**Files:**
- Modify: `public/lights.html` `<script>` block, specifically `render()`, `renderRoom()`, `renderLight()`, `updateLightDom()`, `updateRoomSummary()`, `updateRoomSummaryDom()`. Also add `updateGlobalCounts()`.

- [ ] **Step 1: Replace render functions**

In the `<script>` block, replace the existing `render`, `renderRoom`, `renderLight`, `updateLightDom`, `updateRoomSummary`, `updateRoomSummaryDom` functions (and any of their helpers) with:

```js
function render() {
  const container = document.getElementById('rooms');
  if (!state.rooms.length && !state.unassigned.lights.length && !state.unassigned.scenes.length) {
    container.innerHTML = '<div class="empty">no lights discovered</div>';
    updateGlobalCounts();
    return;
  }
  const all = [...state.rooms];
  if (state.unassigned.lights.length || state.unassigned.scenes.length) {
    all.push({
      id: '__unassigned',
      name: 'Unassigned',
      lights: state.unassigned.lights,
      scenes: state.unassigned.scenes,
    });
  }
  container.innerHTML = '';
  for (const room of all) container.appendChild(renderRoomCard(room));
  updateGlobalCounts();
}

function renderRoomCard(room) {
  const card = document.createElement('article');
  card.className = 'room-card';
  card.dataset.roomId = room.id;
  card.dataset.on = String(roomAnyOn(room));
  card.style.setProperty('--glow-color', glowFor(room));

  const top3 = room.scenes.slice(0, 3);
  const more = room.scenes.length - top3.length;

  card.innerHTML = `
    <div class="glow" aria-hidden="true"></div>
    <div class="room-card-head">
      ${room.lights.length
        ? `<button class="power-orb" data-room-power type="button" aria-label="toggle ${escapeHtml(room.name)}">⏻</button>`
        : ''}
      <div class="room-card-info" data-room-open tabindex="0" role="button">
        <div class="room-name">${escapeHtml(room.name)}</div>
        <div class="room-meta" data-room-meta>${roomMetaText(room)}</div>
      </div>
    </div>
    ${room.scenes.length ? `
      <div class="scene-strip">
        ${top3.map((s) => `<button class="scene-chip" data-scene-id="${escapeAttr(s.entity_id)}" type="button">${escapeHtml(s.name)}</button>`).join('')}
        ${more > 0 ? `<button class="scene-chip" data-more="true" data-room-open type="button">+${more}</button>` : ''}
      </div>` : ''}
  `;
  return card;
}

function roomAnyOn(room) {
  return room.lights.some((l) => l.on && l.reachable);
}
function roomOnCount(room) {
  return room.lights.filter((l) => l.on && l.reachable).length;
}
function roomAvgPct(room) {
  const onLights = room.lights.filter((l) => l.on && l.reachable);
  if (!onLights.length) return 0;
  return Math.round(onLights.reduce((s, l) => s + (l.brightness_pct ?? 0), 0) / onLights.length);
}
function roomMetaText(room) {
  if (!room.lights.length) {
    return room.scenes.length ? `${room.scenes.length} scenes` : '';
  }
  const onCount = roomOnCount(room);
  if (onCount === 0) return 'all off';
  return `${onCount} of ${room.lights.length} on · ${roomAvgPct(room)}%`;
}
function glowFor(room) {
  const onColor = room.lights.find((l) => l.on && l.reachable && l.rgb);
  if (onColor) return `rgba(${onColor.rgb.join(',')}, 0.22)`;
  if (roomAnyOn(room)) return 'rgba(255, 184, 108, 0.18)'; // warm white fallback
  return 'transparent';
}

function updateRoomCardDom(roomId) {
  const room = findRoom(roomId);
  if (!room) return;
  const card = document.querySelector(`.room-card[data-room-id="${cssEscape(roomId)}"]`);
  if (!card) return;
  card.dataset.on = String(roomAnyOn(room));
  card.style.setProperty('--glow-color', glowFor(room));
  const meta = card.querySelector('[data-room-meta]');
  if (meta) meta.textContent = roomMetaText(room);
}

function findRoom(roomId) {
  if (roomId === '__unassigned') {
    return { id: '__unassigned', name: 'Unassigned', lights: state.unassigned.lights, scenes: state.unassigned.scenes };
  }
  return state.rooms.find((r) => r.id === roomId);
}

function updateGlobalCounts() {
  let on = 0, total = 0;
  for (const room of state.rooms) {
    total += room.lights.length;
    on += roomOnCount(room);
  }
  total += state.unassigned.lights.length;
  on += state.unassigned.lights.filter((l) => l.on && l.reachable).length;
  document.getElementById('onCount').textContent = String(on);
  document.getElementById('totalCount').textContent = String(total);
  document.getElementById('allOffBtn').disabled = on === 0;
}

function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
```

- [ ] **Step 2: Replace `applyStateChange` to use the new update path**

Find the existing `applyStateChange` function and replace its body with:

```js
function applyStateChange(evt) {
  if (evt.kind !== 'light' || !evt.state) return;
  const ref = state.byEntity.get(evt.entity_id);
  if (!ref) return;
  Object.assign(ref.light, evt.state);
  updateLightRowDom(evt.entity_id);     // no-op until Task 7 builds the sheet rows
  if (ref.room) updateRoomCardDom(ref.room.id);
  updateGlobalCounts();
}

function updateLightRowDom(_entityId) {
  // Filled in once per-light rows exist (Task 7).
}
```

- [ ] **Step 3: Reload page**

Open `http://localhost:3000/lights.html`. Cards should now appear with room name, power orb (no behavior yet), meta text, and up to 3 scene chips. Glow tints when at least one light is on.

- [ ] **Step 4: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): render room glow-card grid (no interactions yet)"
```

---

## Task 5: Wire power-orb tap → toggle every reachable light

**Files:**
- Modify: `public/lights.html` `<script>` — replace existing `click` listener body on `#rooms`.

- [ ] **Step 1: Replace the rooms click handler**

Find `document.getElementById('rooms').addEventListener('click', ...)` and replace with:

```js
document.getElementById('rooms').addEventListener('click', (e) => {
  // Scene chip on card.
  const sceneBtn = e.target.closest('.scene-chip[data-scene-id]');
  if (sceneBtn && !sceneBtn.dataset.more) {
    activateScene(sceneBtn.dataset.sceneId);
    return;
  }

  // Power orb → toggle all reachable lights in room.
  const orb = e.target.closest('[data-room-power]');
  if (orb) {
    const card = orb.closest('.room-card');
    const room = findRoom(card.dataset.roomId);
    if (!room) return;
    const newOn = !roomAnyOn(room);
    // Optimistic.
    card.dataset.on = String(newOn);
    for (const l of room.lights) {
      if (!l.reachable) continue;
      l.on = newOn;
      if (newOn && !l.brightness_pct) l.brightness_pct = 100;
      postLight(l.entity_id, { on: newOn });
    }
    updateRoomCardDom(room.id);
    updateGlobalCounts();
    return;
  }

  // Room name or "+N" → opens sheet (wired in Task 6).
  const opener = e.target.closest('[data-room-open]');
  if (opener) {
    const card = opener.closest('.room-card');
    if (card) openSheet(card.dataset.roomId);
    return;
  }
});
```

- [ ] **Step 2: Add stub `openSheet` so the call doesn't throw**

Above `connect()` near the bottom of the script, add:

```js
function openSheet(_roomId) {
  // Filled in by Task 6.
}
```

- [ ] **Step 3: Test in browser**

Reload. Click a power orb on a room with at least one reachable light. Expected:
- Orb border + icon flips from gray→green (or green→gray)
- Card glow appears/disappears
- Meta text updates ("X of N on" / "all off")
- Network tab shows one `POST /api/lights/:entity_id` per reachable bulb in the room

Click a scene chip. Expected: `POST /api/scenes/:entity_id/activate` fires once.

- [ ] **Step 4: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): wire power-orb room toggle and scene chip activate"
```

---

## Task 6: Open + close room sheet on room-name tap

**Files:**
- Modify: `public/lights.html` `<script>` — implement `openSheet`, `closeSheet`, render the sheet head only.

- [ ] **Step 1: Implement `openSheet` / `closeSheet`**

Replace the stub `openSheet` with:

```js
let sheetRoomId = null;

function openSheet(roomId) {
  const room = findRoom(roomId);
  if (!room) return;
  sheetRoomId = roomId;
  const dialog = document.getElementById('roomSheet');
  dialog.style.setProperty('--glow-color', glowFor(room));
  document.getElementById('sheetInner').innerHTML = renderSheetHtml(room);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeSheet() {
  const dialog = document.getElementById('roomSheet');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  sheetRoomId = null;
}

function renderSheetHtml(room) {
  return `
    <div class="sheet-head">
      ${room.lights.length
        ? `<button class="power-orb" data-sheet-power type="button" aria-label="toggle ${escapeHtml(room.name)}">⏻</button>`
        : ''}
      <div>
        <div class="room-name">${escapeHtml(room.name)}</div>
        <div class="room-meta" data-sheet-meta>${roomMetaText(room)}</div>
      </div>
      <button class="sheet-close" data-sheet-close type="button" aria-label="close">✕</button>
    </div>
    <!-- master + lights + scenes filled in by tasks 7–9 -->
  `;
}
```

- [ ] **Step 2: Reflect data-on on the sheet's power orb**

After `renderSheetHtml`, add:

```js
function updateSheetHead() {
  if (!sheetRoomId) return;
  const room = findRoom(sheetRoomId);
  if (!room) return;
  const dialog = document.getElementById('roomSheet');
  const head = dialog.querySelector('.sheet-head');
  if (!head) return;
  head.querySelector('[data-sheet-power]')?.parentElement?.classList.toggle('room-card', false);
  // The orb shares the .room-card[data-on] CSS hook; replicate it locally:
  const orb = head.querySelector('[data-sheet-power]');
  if (orb) {
    orb.style.borderColor = roomAnyOn(room) ? 'var(--green)' : 'var(--current-line)';
    orb.style.color = roomAnyOn(room) ? 'var(--green)' : 'var(--comment)';
    orb.style.boxShadow = roomAnyOn(room) ? '0 0 12px rgba(80,250,123,0.35)' : 'none';
  }
  const meta = head.querySelector('[data-sheet-meta]');
  if (meta) meta.textContent = roomMetaText(room);
  dialog.style.setProperty('--glow-color', glowFor(room));
}
```

Call `updateSheetHead()` at the end of `applyStateChange` before `updateGlobalCounts()`.

- [ ] **Step 3: Wire sheet close events**

Below `closeSheet`, add:

```js
document.getElementById('roomSheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
  // Backdrop click: dialog reports e.target === dialog itself.
  if (e.target.id === 'roomSheet') closeSheet();
});
document.getElementById('roomSheet').addEventListener('close', () => { sheetRoomId = null; });
```

(Native `<dialog>` Escape-to-close is automatic.)

- [ ] **Step 4: Test**

Reload. Tap a room name → dialog opens with the room name, meta, power orb, ✕. Tap ✕ → closes. Press Escape → closes. Tap outside the sheet (backdrop) → closes.

- [ ] **Step 5: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): open room sheet on tap, close via ✕/Escape/backdrop"
```

---

## Task 7: Render per-light rows in sheet

**Files:**
- Modify: `public/lights.html` `<script>` — extend `renderSheetHtml`, fill in `updateLightRowDom`, handle slider/toggle/color inside the sheet.

- [ ] **Step 1: Extend `renderSheetHtml`**

Replace `renderSheetHtml` with:

```js
function renderSheetHtml(room) {
  return `
    <div class="sheet-head">
      ${room.lights.length
        ? `<button class="power-orb" data-sheet-power type="button" aria-label="toggle ${escapeHtml(room.name)}">⏻</button>`
        : ''}
      <div>
        <div class="room-name">${escapeHtml(room.name)}</div>
        <div class="room-meta" data-sheet-meta>${roomMetaText(room)}</div>
      </div>
      <button class="sheet-close" data-sheet-close type="button" aria-label="close">✕</button>
    </div>
    ${room.lights.length ? renderMasterRowHtml(room) : ''}
    ${room.lights.length ? renderLightsListHtml(room) : ''}
    ${renderScenesListHtml(room)}
  `;
}

function renderMasterRowHtml(room) {
  const avg = roomAvgPct(room);
  const anyColor = room.lights.some((l) => l.supports_color);
  const sample = room.lights.find((l) => l.supports_color && l.rgb);
  const swatchColor = sample ? rgbToHex(sample.rgb) : '#ffffff';
  return `
    <div class="sheet-section-label"><span class="accent">&gt;</span>ALL</div>
    <div class="master-row">
      <span class="label">all</span>
      <input type="range" class="brightness" data-sheet-master-brightness min="0" max="100" value="${avg}">
      <span class="brightness-value" data-sheet-master-value>${roomAnyOn(room) ? `${avg}%` : '—'}</span>
      ${anyColor ? `
        <button class="swatch" data-sheet-master-swatch style="background:${swatchColor}" type="button">
          <input type="color" data-sheet-master-color value="${swatchColor}">
        </button>` : ''}
    </div>
  `;
}

function renderLightsListHtml(room) {
  const rows = room.lights.map((l) => renderLightRowHtml(l)).join('');
  return `
    <div class="sheet-section-label"><span class="accent">&gt;</span>LIGHTS</div>
    <div class="light-list">${rows}</div>
  `;
}

function renderLightRowHtml(light) {
  const reachable = light.reachable;
  const swatchColor = light.rgb ? rgbToHex(light.rgb) : '#ffffff';
  const swatchHtml = light.supports_color && reachable
    ? `<button class="swatch" data-light-swatch style="background:${swatchColor}" type="button">
         <input type="color" data-light-color value="${swatchColor}">
       </button>`
    : (light.supports_color ? '' : '<span class="badge dim">DIM</span>');
  const valueHtml = !reachable
    ? '<span class="badge unreachable">UNREACHABLE</span>'
    : `<span class="brightness-value" data-light-brightness-value>${light.on ? `${light.brightness_pct ?? 0}%` : 'off'}</span>`;
  const sliderHtml = reachable
    ? `<input type="range" class="brightness" data-light-brightness min="0" max="100" value="${light.brightness_pct ?? 0}">`
    : '<span style="flex:1"></span>';
  return `
    <div class="light-row" data-entity-id="${escapeAttr(light.entity_id)}" data-on="${light.on}" data-reachable="${reachable}">
      <span class="light-status-dot"></span>
      <span class="light-name">${escapeHtml(light.name)}</span>
      <button class="toggle" data-light-toggle data-on="${light.on}" type="button">${light.on ? 'on' : 'off'}</button>
      ${sliderHtml}
      ${valueHtml}
      ${swatchHtml}
    </div>
  `;
}

function renderScenesListHtml(room) {
  if (!room.scenes.length) {
    return `
      <div class="sheet-section-label"><span class="accent">&gt;</span>SCENES</div>
      <div class="empty-note">no scenes defined for this room</div>
    `;
  }
  const chips = room.scenes
    .map((s) => `<button class="scene-chip" data-scene-id="${escapeAttr(s.entity_id)}" type="button">${escapeHtml(s.name)}</button>`)
    .join('');
  return `
    <div class="sheet-section-label"><span class="accent">&gt;</span>SCENES</div>
    <div class="scene-list">${chips}</div>
  `;
}
```

- [ ] **Step 2: Implement `updateLightRowDom`**

Replace the stub from Task 4 with:

```js
function updateLightRowDom(entityId) {
  const row = document.querySelector(`.light-row[data-entity-id="${cssEscape(entityId)}"]`);
  if (!row) return;
  const ref = state.byEntity.get(entityId);
  if (!ref) return;
  const l = ref.light;
  row.dataset.on = String(l.on);
  row.dataset.reachable = String(l.reachable);
  const toggle = row.querySelector('[data-light-toggle]');
  if (toggle) {
    toggle.dataset.on = String(l.on);
    toggle.textContent = l.on ? 'on' : 'off';
  }
  const slider = row.querySelector('[data-light-brightness]');
  if (slider && document.activeElement !== slider) slider.value = String(l.brightness_pct ?? 0);
  const val = row.querySelector('[data-light-brightness-value]');
  if (val) val.textContent = l.on ? `${l.brightness_pct ?? 0}%` : 'off';
  const swatch = row.querySelector('[data-light-swatch]');
  if (swatch && l.rgb) {
    swatch.style.background = rgbToHex(l.rgb);
    const input = swatch.querySelector('[data-light-color]');
    if (input) input.value = rgbToHex(l.rgb);
  }
  // Master row also needs to reflect changes:
  if (sheetRoomId && ref.room && ref.room.id === sheetRoomId) updateMasterRow();
}

function updateMasterRow() {
  if (!sheetRoomId) return;
  const room = findRoom(sheetRoomId);
  if (!room) return;
  const slider = document.querySelector('[data-sheet-master-brightness]');
  const val = document.querySelector('[data-sheet-master-value]');
  if (!slider || !val) return;
  const avg = roomAvgPct(room);
  if (document.activeElement !== slider) slider.value = String(avg);
  val.textContent = roomAnyOn(room) ? `${avg}%` : '—';
}
```

- [ ] **Step 3: Reload + test**

Open a room sheet. Expected: master row, per-light list with toggle + slider + % + swatch (only for color-supporting bulbs), scenes section. Read-only at this stage; clicking does nothing inside the sheet yet.

- [ ] **Step 4: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): render per-light rows, master row, scenes inside sheet"
```

---

## Task 8: Wire sheet interactions (light toggle, brightness, color, scene)

**Files:**
- Modify: `public/lights.html` `<script>` — add a single delegated listener on the sheet.

- [ ] **Step 1: Add delegated listeners on the sheet**

Below the existing `roomSheet` click listener (the one that handles ✕ + backdrop), add:

```js
document.getElementById('sheetInner').addEventListener('click', (e) => {
  // Sheet power orb → toggle whole room.
  if (e.target.closest('[data-sheet-power]')) {
    const room = findRoom(sheetRoomId); if (!room) return;
    const newOn = !roomAnyOn(room);
    for (const l of room.lights) {
      if (!l.reachable) continue;
      l.on = newOn;
      if (newOn && !l.brightness_pct) l.brightness_pct = 100;
      postLight(l.entity_id, { on: newOn });
      updateLightRowDom(l.entity_id);
    }
    updateRoomCardDom(room.id);
    updateSheetHead();
    updateMasterRow();
    updateGlobalCounts();
    return;
  }

  // Per-light toggle.
  const tgl = e.target.closest('[data-light-toggle]');
  if (tgl) {
    const row = tgl.closest('.light-row'); if (!row) return;
    const entityId = row.dataset.entityId;
    const ref = state.byEntity.get(entityId); if (!ref) return;
    const newOn = !ref.light.on;
    ref.light.on = newOn;
    if (newOn && !ref.light.brightness_pct) ref.light.brightness_pct = 100;
    postLight(entityId, { on: newOn });
    updateLightRowDom(entityId);
    if (ref.room) updateRoomCardDom(ref.room.id);
    updateSheetHead();
    updateMasterRow();
    updateGlobalCounts();
    return;
  }

  // Sheet scene chip.
  const sceneBtn = e.target.closest('.scene-chip[data-scene-id]');
  if (sceneBtn) {
    activateScene(sceneBtn.dataset.sceneId);
    return;
  }
});

document.getElementById('sheetInner').addEventListener('input', (e) => {
  // Per-light brightness.
  const slider = e.target.closest('[data-light-brightness]');
  if (slider) {
    const row = slider.closest('.light-row');
    const entityId = row.dataset.entityId;
    const pct = Number(slider.value);
    const valNode = row.querySelector('[data-light-brightness-value]');
    if (valNode) valNode.textContent = pct > 0 ? `${pct}%` : 'off';
    const ref = state.byEntity.get(entityId);
    if (ref) {
      ref.light.brightness_pct = pct;
      ref.light.on = pct > 0;
    }
    debounceCall(`light:${entityId}`, () => postLight(entityId, { on: pct > 0, brightness_pct: pct }));
    return;
  }

  // Master brightness.
  const master = e.target.closest('[data-sheet-master-brightness]');
  if (master) {
    const room = findRoom(sheetRoomId); if (!room) return;
    const pct = Number(master.value);
    document.querySelector('[data-sheet-master-value]').textContent = pct > 0 ? `${pct}%` : '—';
    debounceCall(`room:${room.id}`, () => {
      for (const l of room.lights) {
        if (l.reachable) postLight(l.entity_id, { on: pct > 0, brightness_pct: pct });
      }
    });
    return;
  }
});

document.getElementById('sheetInner').addEventListener('change', (e) => {
  // Per-light color.
  const lc = e.target.closest('[data-light-color]');
  if (lc) {
    const row = lc.closest('.light-row');
    const entityId = row.dataset.entityId;
    const rgb = hexToRgb(lc.value); if (!rgb) return;
    row.querySelector('[data-light-swatch]').style.background = lc.value;
    postLight(entityId, { on: true, rgb_color: rgb });
    return;
  }
  // Master color.
  const mc = e.target.closest('[data-sheet-master-color]');
  if (mc) {
    const rgb = hexToRgb(mc.value); if (!rgb) return;
    document.querySelector('[data-sheet-master-swatch]').style.background = mc.value;
    const room = findRoom(sheetRoomId); if (!room) return;
    for (const l of room.lights) {
      if (l.reachable && l.supports_color) postLight(l.entity_id, { on: true, rgb_color: rgb });
    }
    return;
  }
});
```

- [ ] **Step 2: Test each interaction**

In one room sheet, verify:
- Per-light toggle: tap "on/off" button → state flips, network shows POST `{ on: bool }`
- Per-light brightness slider: drag → % updates immediately, debounced POST after 200ms
- Per-light color swatch: tap → native picker opens; pick a color → swatch updates, POST with `rgb_color: [r,g,b]`
- Master "all" brightness: drag → POST per reachable bulb, debounced
- Master color swatch: pick → POST per color-supporting reachable bulb
- Sheet power orb: tap → toggles entire room
- Sheet scene chip: tap → activates scene

- [ ] **Step 3: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): wire sheet interactions — toggle, brightness, color, scene"
```

---

## Task 9: ALL OFF header button

**Files:**
- Modify: `public/lights.html` `<script>`

- [ ] **Step 1: Wire the button**

Below the existing event listeners, add:

```js
document.getElementById('allOffBtn').addEventListener('click', () => {
  const buckets = [...state.rooms, { lights: state.unassigned.lights }];
  for (const room of buckets) {
    for (const l of room.lights) {
      if (l.reachable && l.on) {
        l.on = false;
        postLight(l.entity_id, { on: false });
        updateLightRowDom(l.entity_id);
      }
    }
  }
  for (const room of state.rooms) updateRoomCardDom(room.id);
  if (state.unassigned.lights.length) updateRoomCardDom('__unassigned');
  updateSheetHead();
  updateMasterRow();
  updateGlobalCounts();
});
```

- [ ] **Step 2: Test**

With at least one light on, click "ALL OFF" in the header. Expected:
- Every reachable on-light receives `POST { on: false }`
- Cards flip to off state, glow fades, count chip updates to `0 on / N`
- Button becomes disabled until something is turned back on

- [ ] **Step 3: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): wire header ALL OFF button"
```

---

## Task 10: Connection status — disconnect dimming + offline-on-mount

**Files:**
- Modify: `public/lights.html` `<script>` — extend `setConnected`.

- [ ] **Step 1: Replace `setConnected`**

```js
function setConnected(ok) {
  connected = ok;
  const chip = document.getElementById('connStatus');
  chip.dataset.status = ok ? 'up' : 'down';
  document.getElementById('connLabel').textContent = ok ? 'connected' : 'offline';
  document.getElementById('errorBanner').dataset.show = ok ? 'false' : 'true';
  for (const card of document.querySelectorAll('.room-card')) {
    card.dataset.disconnected = ok ? 'false' : 'true';
  }
}
```

- [ ] **Step 2: Test by killing the dev server**

While the page is open, stop `npm run dev` (Ctrl-C). Cards should dim to ~55% opacity, status chip turns red "offline", error banner appears. Restart dev server — page reconnects, dimming clears.

- [ ] **Step 3: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): dim cards and surface banner when SSE disconnects"
```

---

## Task 11: Manual responsive + accessibility verification

**Files:** none (verification only)

- [ ] **Step 1: Mobile breakpoint check**

In Chrome DevTools, toggle device toolbar. Test at:
- 375px (iPhone): 2-column grid, smaller orbs (36px), sheet docks to bottom of screen, full-width
- 320px: single-column grid
- 600–1100px: 2–4 columns based on `auto-fit minmax(260px, 1fr)`

If any layout breaks, fix the relevant media query in CSS and recommit.

- [ ] **Step 2: Keyboard check**

Tab through the page. Expected reachable in this order: back link → ALL OFF → power orbs → room name (focusable via `tabindex="0"`) → scene chips. Pressing Enter on a focused room-card-info opens the sheet. Inside the sheet: focus stays trapped (native `<dialog>`); Escape closes.

If Enter on `[data-room-open]` doesn't open the sheet, add a `keydown` handler:

```js
document.getElementById('rooms').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const opener = e.target.closest('[data-room-open]');
  if (opener) {
    e.preventDefault();
    const card = opener.closest('.room-card');
    if (card) openSheet(card.dataset.roomId);
  }
});
```

- [ ] **Step 3: Empty/edge state check**

Use the dev fixtures (or temporarily edit `dev.js` to omit lights) to verify:
- "no lights discovered" message renders when there are zero rooms and zero unassigned
- Room with no scenes hides the card scene strip and shows the "no scenes defined" empty note in the sheet
- Room with no lights but has scenes shows scenes-only meta and no power orb
- Unreachable bulb: appears with red dot, UNREACHABLE badge, slider disabled (already handled by `pointer-events: none` and `data-reachable="false"` opacity)

- [ ] **Step 4: Commit any fixes from steps 1–3 (only if needed)**

```bash
git add public/lights.html
git commit -m "fix(lights): responsive + a11y polish from manual QA"
```

(Skip this commit if no fixes were needed.)

---

## Task 12: Final cleanup pass

**Files:**
- Modify: `public/lights.html` (remove dead code if any survived from the old render path)

- [ ] **Step 1: Search for orphan symbols**

Run: `grep -n "renderRoom\|renderLight\|updateRoomSummary" public/lights.html`
Expected: only the new functions (`renderRoomCard`, `updateRoomCardDom`) appear. If any old function names linger as dead code, delete them.

Run: `grep -n "data-light-toggle\|data-room-toggle\|data-room-brightness\|data-room-swatch\|data-room-color" public/lights.html`
Expected: all hits are inside the sheet rendering / sheet listeners (not in card markup). The card no longer has `data-room-toggle` or `data-room-brightness` — those moved to the sheet under different `data-sheet-*` names.

- [ ] **Step 2: Diff against the spec**

Open `docs/superpowers/specs/2026-05-01-lights-page-redesign-design.md`. Walk each component bullet against the implemented page. Fix any mismatches. Confirm "Out of scope" items (active-scene detection, server changes) were not silently included.

- [ ] **Step 3: Final commit (only if step 1 or 2 produced changes)**

```bash
git add public/lights.html
git commit -m "chore(lights): remove dead code from old render path"
```

---

## Self-review notes

- Spec coverage walked: header (Task 3, 9), room card (Tasks 3–5), room sheet (Tasks 6–8), color picker (Task 8), interaction model (Tasks 5, 8, 9), edge cases (Task 7 markup + Task 11), connection states (Task 10), out-of-scope items not implemented (active-scene tracking explicitly skipped).
- No placeholders: every step shows the exact code or command. Manual verification steps are explicit.
- Type consistency: `findRoom`, `roomAnyOn`, `roomMetaText`, `glowFor`, `updateRoomCardDom`, `updateSheetHead`, `updateMasterRow`, `updateLightRowDom` are defined once and reused. `data-room-id`, `data-entity-id`, `data-room-open`, `data-room-power`, `data-sheet-power`, `data-light-toggle`, `data-light-brightness`, `data-light-color`, `data-light-swatch`, `data-sheet-master-*`, `data-sheet-close` are used consistently between markup and listeners.
- `state.byEntity`, `applySnapshot`, `connect`, `postLight`, `activateScene`, `debounceCall`, `rgbToHex`, `hexToRgb`, `cssEscape`, `escapeHtml` are preserved from the existing file and referenced as-is.
