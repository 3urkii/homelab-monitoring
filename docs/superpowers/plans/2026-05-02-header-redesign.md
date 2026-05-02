# Header Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the dashboard header for a bigger landing brand, sticky two-row layout on sub-pages with a sub-bar for page tools, and a paintbrush theme picker mounted on every page.

**Architecture:** Wrap header(s) in a single `.page-chrome` sticky container so the header and the new `.page-subbar` (sub-pages only) scroll together as one unit. Keep all CSS in `theme.css` and all behavior in `theme.js`. Pure additive CSS in Task 1 means earlier commits don't break the live site even before HTML migrations land.

**Tech Stack:** Vanilla HTML, CSS, JS. No framework. No frontend test harness — verify manually per page in a browser.

**Spec:** `docs/superpowers/specs/2026-05-02-header-redesign-design.md`

**Files touched:**
- `public/theme.css` — Task 1 (additive), Task 2 (clock split), Task 7 (cleanup)
- `public/theme.js` — Task 2 (icon button + split clock)
- `public/index.html` — Task 2 (landing page restructure + JS cleanup)
- `public/monitoring.html` — Task 3
- `public/plan.html` — Task 4
- `public/lights.html` — Task 5
- `public/chat.html` — Task 6

**Verification:** Each task ends with manual viewport checks at iPhone SE (375×667), iPhone 13 (390×844), and desktop (1440×900). Use `npm run dev` to serve the dashboard locally on http://localhost:3000.

---

### Task 1: Add additive CSS for new components

Pure additions to `theme.css`. Nothing breaks because no HTML uses these classes yet. Commit on its own so subsequent tasks can be reverted independently.

**Files:**
- Modify: `public/theme.css` (append at end of file, before any `@media` blocks if you want them grouped — order doesn't matter for these new selectors)

- [ ] **Step 1: Add `.page-chrome` sticky wrapper rule**

Append to `public/theme.css`:

```css
/* ============================================================
   Page chrome wrapper — sticks header (and sub-bar where present)
   to the top of the viewport so they scroll together.
   ============================================================ */
.page-chrome {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--bg);
}
```

- [ ] **Step 2: Add `.page-subbar` rule**

Append:

```css
/* ============================================================
   Sub-page tool bar — sits beneath header on sub-pages, holds
   page-specific controls (status, count, refresh, ALL OFF, etc).
   ============================================================ */
.page-subbar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.85rem;
  background: var(--bg-alt);
  border-bottom: 1px solid var(--current-line);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  color: var(--comment);
}
.page-subbar .spacer { flex: 1; }
@media (max-width: 640px) {
  .page-subbar { padding: 0.4rem 0.75rem; gap: 0.5rem; font-size: 0.68rem; }
  .page-subbar .status-chip span:not(.dot) { display: none; }
}
```

- [ ] **Step 3: Add `.brand-cursor` rule + keyframes**

Append:

```css
/* ============================================================
   Brand cursor — terminal-style blinking cursor after the
   landing brand only (not applied to .brand--compact).
   ============================================================ */
.brand-cursor {
  display: inline-block;
  width: 0.55ch;
  height: 0.95em;
  vertical-align: -2px;
  background: var(--green);
  margin-left: 3px;
  animation: brandBlink 1.05s steps(1) infinite;
  box-shadow: 0 0 6px rgba(var(--green-rgb), 0.6);
}
@keyframes brandBlink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .brand-cursor { animation: none; }
  .clock .colon { animation: none; }
}
```

- [ ] **Step 4: Override `.theme-picker-btn` to icon-only style**

Find the existing `.theme-picker-btn` rule in `theme.css` (search `theme-picker-btn`). Replace its entire selector block with:

```css
.theme-picker-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--current-line);
  border-radius: 6px;
  background: transparent;
  color: var(--purple);
  cursor: pointer;
  font-family: inherit;
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}
.theme-picker-btn svg { width: 16px; height: 16px; }
@media (hover: hover) and (pointer: fine) {
  .theme-picker-btn:hover {
    border-color: var(--purple);
    background: rgba(var(--purple-rgb), 0.08);
  }
}
.theme-picker-btn[aria-expanded="true"] {
  border-color: var(--purple);
  background: rgba(var(--purple-rgb), 0.08);
}
```

If there are existing rules for `.theme-picker-btn .tp-colon` or `.theme-picker-btn .tp-name`, delete them — those classes go away in Task 2.

- [ ] **Step 5: Bump landing brand size and add clock pill styling**

Find existing `.brand` rule (currently around line 269). Update its `font-size` line:

```css
/* Old: font-size: clamp(1.2rem, 0.95rem + 1.2vw, 1.85rem); */
font-size: clamp(1.55rem, 1.2rem + 1.6vw, 2.2rem);
```

Find existing `.clock` rule (around line 362). Replace its block with:

```css
.clock {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  color: var(--comment);
  letter-spacing: 0.02em;
  white-space: nowrap;
  padding: 0.22rem 0.55rem;
  border: 1px solid var(--current-line);
  border-radius: 999px;
}
.clock .prompt { color: var(--green); margin-right: 0.4ch; }
.clock .colon {
  animation: brandBlink 1.2s steps(1) infinite;
  color: var(--green);
}
```

Find the mobile clock rule in the `@media (max-width: 640px)` block (around line 418) and change it to hide entirely on mobile:

```css
/* Replace the existing .clock font-size + .clock .prompt display rules with: */
.clock { display: none; }
```

- [ ] **Step 6: Verify CSS parses without errors**

Run: `node -e "const fs=require('fs'); const css=fs.readFileSync('public/theme.css','utf8'); const open=(css.match(/{/g)||[]).length; const close=(css.match(/}/g)||[]).length; console.log('open:', open, 'close:', close); if (open!==close) process.exit(1);"`

Expected: `open: N close: N` (matching counts). Non-zero exit means a brace got dropped.

- [ ] **Step 7: Manual smoke check — landing page still renders**

Run: `npm run dev` (or check existing dev process). Open http://localhost:3000.

Expected:
- Landing renders without console errors
- Theme picker text label has shrunk to a small empty box (button has no innerHTML yet — that's fixed in Task 2)
- Brand `[burkii.home]` is bigger than before
- Clock has a rounded border (still text `--:--` for now)

This is a known half-broken state — Task 2 fixes the picker and clock markup. Continue.

- [ ] **Step 8: Commit**

```bash
git add public/theme.css
git commit -m "style(header): add page-chrome, sub-bar, brand-cursor, icon picker CSS"
```

---

### Task 2: Update theme.js + landing index.html (icon picker, split clock, drop status chip)

This task touches three files but they're tightly coupled — committing them separately would leave the landing page broken between commits.

**Files:**
- Modify: `public/theme.js` (buildPicker, mountClocks)
- Modify: `public/index.html` (page-chrome wrapper, brand cursor, split clock, remove status chip + JS)

- [ ] **Step 1: Update `buildPicker` in theme.js — replace text label with SVG**

Open `public/theme.js`. Find the line near top of `buildPicker`:

```js
btn.innerHTML = `<span class="tp-colon">:</span><span class="tp-name"></span>`;
const nameEl = btn.querySelector('.tp-name');
```

Replace with:

```js
btn.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 21l4-1 11-11-3-3L4 17z"/>
    <path d="M14 6l4 4"/>
  </svg>
`;
```

- [ ] **Step 2: Update `syncUI` in theme.js — drop nameEl write**

Inside `buildPicker`, find the `syncUI` function:

```js
function syncUI() {
  const id = currentThemeId();
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  nameEl.textContent = theme.label;
  menu.querySelectorAll('.theme-picker-opt').forEach((opt) => {
    if (opt.dataset.themeId === id) opt.setAttribute('aria-current', 'true');
    else opt.removeAttribute('aria-current');
  });
}
```

Remove the `nameEl.textContent = theme.label;` line. The current theme is now indicated only inside the dropdown menu (the option with `aria-current="true"`).

- [ ] **Step 3: Update `mountClocks` in theme.js — split hour/minute writes**

Find `mountClocks`:

```js
function mountClocks() {
  const nodes = document.querySelectorAll('[data-clock]');
  if (!nodes.length) return;
  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const text = `${hh}:${mm}`;
    nodes.forEach((n) => { n.textContent = text; });
  }
  tick();
  setInterval(tick, 30_000);
}
```

Replace with:

```js
function mountClocks() {
  const hNodes = document.querySelectorAll('[data-clock-h]');
  const mNodes = document.querySelectorAll('[data-clock-m]');
  if (!hNodes.length && !mNodes.length) return;
  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    hNodes.forEach((n) => { n.textContent = hh; });
    mNodes.forEach((n) => { n.textContent = mm; });
  }
  tick();
  setInterval(tick, 30_000);
}
```

- [ ] **Step 4: Apply four targeted edits to landing index.html**

Open `public/index.html`. The header markup spans roughly lines 352-388 — do NOT rewrite the whole block. Apply these four small edits in place:

**Edit 4a — open `<div class="page-chrome">` before the header.** Find this single line:

```html
<header class="page-header">
```

Replace with:

```html
<div class="page-chrome">
<header class="page-header">
```

**Edit 4b — close `</div>` after the header.** Find this single line:

```html
</header>
<main>
```

Replace with:

```html
</header>
</div>
<main>
```

**Edit 4c — append brand cursor to brand-mark.** Find this single line:

```html
    <span class="brand-mark"><span class="bracket">[</span><span class="domain">burkii</span><span class="tld">.home</span><span class="bracket">]</span></span>
```

Replace with:

```html
    <span class="brand-mark"><span class="bracket">[</span><span class="domain">burkii</span><span class="tld">.home</span><span class="bracket">]</span><span class="brand-cursor" aria-hidden="true"></span></span>
```

**Edit 4d — split clock markup and remove status chip.** Find these three consecutive lines:

```html
  <div class="header-tools">
    <div class="status-chip" id="globalStatus" data-status="down"><span class="dot"></span><span id="globalStatusLabel">booting</span></div>
  </div>
```

Delete all three lines (the entire `<div class="header-tools">…</div>` block).

Then find this single line:

```html
    <div class="clock"><span class="prompt">$</span><span data-clock>--:--</span></div>
```

Replace with:

```html
    <div class="clock"><span class="prompt">$</span><span data-clock-h>--</span><span class="colon">:</span><span data-clock-m>--</span></div>
```

The weather chip, weather panel, and theme mount span stay untouched.

- [ ] **Step 5: Remove `setGlobalStatus` function and its call sites in index.html**

Still in `public/index.html`. Apply these targeted deletions:

**Edit 5a — delete the `lastMonStatus` declaration.** Find this line (around line 462):

```js
let lastMonStatus = 'down';
```

Delete it. Keep the `let lastLightsAvail = null;` line beneath it — it's used elsewhere.

**Edit 5b — delete the `setGlobalStatus` function.** Find and delete this entire block (around lines 465-485):

```js
function setGlobalStatus() {
  const chip = document.getElementById('globalStatus');
  const label = document.getElementById('globalStatusLabel');
  if (lastMonStatus === 'down') {
    chip.dataset.status = 'down';
    label.textContent = 'attention needed';
    return;
  }
  if (lastMonStatus === 'degraded') {
    chip.dataset.status = 'degraded';
    label.textContent = 'degraded';
    return;
  }
  if (lastMonStatus === 'up') {
    chip.dataset.status = 'up';
    label.textContent = 'all systems normal';
    return;
  }
  chip.dataset.status = 'down';
  label.textContent = 'booting';
}
```

**Edit 5c — delete `lastMonStatus` write inside `refreshMonitoring`.** Find this line:

```js
    lastMonStatus = data.globalStatus || 'down';
```

Delete it. Note that the line above it sets `tile.dataset.status = data.globalStatus || 'down';` — keep that, it powers the tile color.

**Edit 5d — delete `lastMonStatus` reset in catch.** Find this line (in `refreshMonitoring`'s catch block):

```js
    lastMonStatus = 'down';
```

Delete it.

**Edit 5e — delete the trailing `setGlobalStatus()` call in `refreshMonitoring`.** Find this line at the end of `refreshMonitoring`:

```js
  setGlobalStatus();
```

Delete it.

**Edit 5f — delete the `setGlobalStatus()` call in `probeLights`'s `finally` block.** Find this:

```js
  } finally {
    setGlobalStatus();
  }
```

Replace with nothing (delete the entire `finally` block — it's now empty). The closing of the surrounding `try { ... } catch { ... }` should remain.

- [ ] **Step 6: Verify no lingering references**

Run: `grep -n "globalStatus\|lastMonStatus\|setGlobalStatus" public/index.html`

Expected: zero matches.

If any remain, return to Step 5 and remove them.

- [ ] **Step 7: Manual viewport verification — landing page**

Open http://localhost:3000 (refresh). Then resize/check:

**Desktop (1440×900):**
- Brand `[burkii.home]_` is large with green blinking cursor
- Weather chip + clock pill (with blinking colon) + paintbrush button on the right
- Click paintbrush — dropdown opens with `dracula` (current) and `catppuccin-latte` options
- Click `catppuccin-latte` — theme switches; reopen picker, current selection now shows `catppuccin-latte`

**iPhone 13 (390×844 in DevTools):**
- Brand still readable, fits one row with weather chip + paintbrush
- Clock is hidden
- No status chip visible

**Console:** no errors. `getElementById('globalStatus')` calls are gone.

- [ ] **Step 8: Commit**

```bash
git add public/theme.js public/index.html
git commit -m "feat(header): icon theme picker, split clock, remove landing status chip"
```

---

### Task 3: Convert monitoring.html to new structure

**Files:**
- Modify: `public/monitoring.html` (lines around 525-535)

- [ ] **Step 1: Restructure header markup**

Open `public/monitoring.html`. Find the header (around line 525):

```html
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/monitoring</span>
  </span>
  <div class="header-tools">
    <div class="status-chip" id="globalStatus" data-status="down"><span class="dot"></span><span id="globalStatusLabel">booting</span></div>
    <div class="last-poll"><span class="prompt">$</span><span id="lastPoll">waiting for first poll…</span></div>
    <button class="refresh-btn" id="refreshBtn" title="Force refresh">⟳</button>
  </div>
</header>
```

Replace with:

```html
<div class="page-chrome">
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/monitoring</span>
  </span>
  <div class="header-chrome">
    <span data-theme-mount></span>
  </div>
</header>
<div class="page-subbar">
  <div class="status-chip" id="globalStatus" data-status="down"><span class="dot"></span><span id="globalStatusLabel">booting</span></div>
  <div class="last-poll"><span class="prompt">$</span><span id="lastPoll">waiting for first poll…</span></div>
  <div class="spacer"></div>
  <button class="refresh-btn" id="refreshBtn" title="Force refresh">⟳</button>
</div>
</div>
```

Changes:
- Wrapped header + new sub-bar in `<div class="page-chrome">`
- Removed `<div class="header-tools">` from header
- Added `<div class="header-chrome"><span data-theme-mount></span></div>` to header
- Added new `<div class="page-subbar">` with status chip + last-poll + spacer + refresh button (all moved from header-tools, plus a spacer to push refresh right)

- [ ] **Step 2: Manual viewport verification — monitoring page**

Open http://localhost:3000/monitoring (refresh). Check:

**Desktop:**
- Header row: back arrow + `burkii/monitoring` + paintbrush button (right)
- Sub-bar row beneath: status dot + label, last-poll text, refresh button right-aligned
- Theme picker works (open/close/switch)
- Refresh button still triggers `#refreshBtn` handler

**iPhone 13:**
- Header same layout, brand readable
- Sub-bar shows: status dot only (no label), last-poll text, refresh button right
- Scroll the page — header + sub-bar stick at top together

**Console:** no errors.

- [ ] **Step 3: Commit**

```bash
git add public/monitoring.html
git commit -m "feat(monitoring): two-row sticky header with sub-bar + theme picker"
```

---

### Task 4: Convert plan.html to new structure

Mirrors Task 3 — same shape (status chip + last-poll + refresh).

**Files:**
- Modify: `public/plan.html` (lines around 334-344)

- [ ] **Step 1: Restructure header markup**

Open `public/plan.html`. Find the header:

```html
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/minecraft</span>
  </span>
  <div class="header-tools">
    <div class="status-chip" id="planStatus" data-status="loading"><span class="dot"></span><span id="planStatusLabel">connecting</span></div>
    <div class="last-poll"><span class="prompt">$</span><span id="lastRefresh">loading&hellip;</span></div>
    <button class="refresh-btn" id="refreshBtn" title="Refresh">&#x27F3;</button>
  </div>
</header>
```

Replace with:

```html
<div class="page-chrome">
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/minecraft</span>
  </span>
  <div class="header-chrome">
    <span data-theme-mount></span>
  </div>
</header>
<div class="page-subbar">
  <div class="status-chip" id="planStatus" data-status="loading"><span class="dot"></span><span id="planStatusLabel">connecting</span></div>
  <div class="last-poll"><span class="prompt">$</span><span id="lastRefresh">loading&hellip;</span></div>
  <div class="spacer"></div>
  <button class="refresh-btn" id="refreshBtn" title="Refresh">&#x27F3;</button>
</div>
</div>
```

- [ ] **Step 2: Manual viewport verification — plan page**

Open http://localhost:3000/plan (refresh). Check same expectations as Task 3 Step 2:

**Desktop:**
- Header: back + `burkii/minecraft` + paintbrush
- Sub-bar: status chip + last-poll + spacer + refresh button (right)
- Theme picker works

**iPhone 13:**
- Sub-bar status is dot-only
- Sticky chrome works on scroll

**Console:** no errors.

- [ ] **Step 3: Commit**

```bash
git add public/plan.html
git commit -m "feat(plan): two-row sticky header with sub-bar + theme picker"
```

---

### Task 5: Convert lights.html to new structure (with right-aligned ALL OFF)

**Files:**
- Modify: `public/lights.html` (lines around 258-267)

- [ ] **Step 1: Restructure header markup**

Open `public/lights.html`. Find the header:

```html
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/lights</span>
  </span>
  <div class="header-tools">
    <span class="count-chip"><strong id="onCount">0</strong> on / <span id="totalCount">0</span></span>
    <button class="all-off-btn" id="allOffBtn" type="button" disabled>ALL OFF</button>
    <div class="status-chip" id="connStatus" data-status="down"><span class="dot"></span><span id="connLabel">connecting</span></div>
  </div>
</header>
```

Replace with:

```html
<div class="page-chrome">
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/lights</span>
  </span>
  <div class="header-chrome">
    <span data-theme-mount></span>
  </div>
</header>
<div class="page-subbar">
  <div class="status-chip" id="connStatus" data-status="down"><span class="dot"></span><span id="connLabel">connecting</span></div>
  <span class="count-chip"><strong id="onCount">0</strong> on / <span id="totalCount">0</span></span>
  <div class="spacer"></div>
  <button class="all-off-btn" id="allOffBtn" type="button" disabled>ALL OFF</button>
</div>
</div>
```

Changes:
- Wrap in `.page-chrome`
- Header: back + brand + theme picker
- Sub-bar order: status chip first, count chip, spacer, ALL OFF (right)

- [ ] **Step 2: Manual viewport verification — lights page**

Open http://localhost:3000/lights (refresh). Check:

**Desktop:**
- Header: back + `burkii/lights` + paintbrush
- Sub-bar: status dot + label, count chip (`X on / Y`), ALL OFF button right-aligned
- Theme picker works
- ALL OFF button retains its disabled state from JS until lights load

**iPhone 13:**
- Sub-bar: status dot only, count chip, ALL OFF right
- Sticky chrome works on scroll
- ALL OFF stays reachable (sticky sub-bar)

**Console:** no errors. Click ALL OFF (when enabled) — handler still fires.

- [ ] **Step 3: Commit**

```bash
git add public/lights.html
git commit -m "feat(lights): two-row sticky header with sub-bar + theme picker"
```

---

### Task 6: Convert chat.html to new structure

**Files:**
- Modify: `public/chat.html` (lines around 247-253)

- [ ] **Step 1: Restructure header markup**

Open `public/chat.html`. Find the header:

```html
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/chat</span>
  </span>
  <div class="header-tools">
    <div class="status-chip" id="statusChip" data-status="ready"><span class="dot"></span><span id="statusLabel">ready</span></div>
  </div>
</header>
```

Replace with:

```html
<div class="page-chrome">
<header class="page-header page-header--sub">
  <a class="back-btn" href="/" aria-label="back to dashboard">&larr;</a>
  <span class="brand brand--compact">
    <span class="brand-mark">burkii</span><span class="brand-sub">/chat</span>
  </span>
  <div class="header-chrome">
    <span data-theme-mount></span>
  </div>
</header>
<div class="page-subbar">
  <div class="status-chip" id="statusChip" data-status="ready"><span class="dot"></span><span id="statusLabel">ready</span></div>
</div>
</div>
```

- [ ] **Step 2: Manual viewport verification — chat page**

Open http://localhost:3000/chat (refresh). Check:

**Desktop:**
- Header: back + `burkii/chat` + paintbrush
- Sub-bar: status chip with `● ready` label
- Theme picker works

**iPhone 13:**
- Sub-bar shows just the status dot
- Sticky chrome works on scroll
- Chat input remains usable (sticky chrome doesn't cover input area)

**Console:** no errors.

- [ ] **Step 3: Commit**

```bash
git add public/chat.html
git commit -m "feat(chat): two-row sticky header with sub-bar + theme picker"
```

---

### Task 7: Cross-page verification + cleanup

Final pass to make sure all five pages work consistently across themes and viewports, and to delete any orphaned CSS.

**Files:**
- Modify: `public/theme.css` (potential cleanup only)

- [ ] **Step 1: Run a full cross-page check**

Open each URL in turn, in DevTools at iPhone 13 (390×844) and desktop (1440×900):
- http://localhost:3000/
- http://localhost:3000/monitoring
- http://localhost:3000/lights
- http://localhost:3000/plan
- http://localhost:3000/chat

For each: verify header structure matches its mockup, theme picker works, sub-bar (where present) sticks on scroll, no console errors.

- [ ] **Step 2: Toggle Catppuccin Latte and re-verify all five pages**

Click the paintbrush picker on any page → select `catppuccin-latte`. Then revisit all five URLs and confirm:
- Brand colors render in light theme
- Cursor and clock colon still blink with appropriate color (`--green` becomes the Latte green `#40a02b`)
- Sub-bar background contrast is acceptable
- No element becomes invisible (e.g. theme picker icon should still be visible against `--bg-alt`)

- [ ] **Step 3: Test reduced-motion**

In macOS: System Settings → Accessibility → Display → Reduce motion = ON. (Or in DevTools: ⌘⇧P → "Emulate CSS prefers-reduced-motion" → reduce.)

Refresh landing page. The brand cursor and clock colon should NOT blink.

Toggle off when done.

- [ ] **Step 4: Search for orphaned CSS selectors**

Run: `grep -nE "\.tp-name|\.tp-colon|#globalStatus|#globalStatusLabel" public/theme.css public/theme.js public/*.html`

Expected: zero matches across all files. If any are found in `theme.css`, delete those rules. If any are found in `.html` or `.js`, return to the relevant task and complete the removal.

- [ ] **Step 5: Verify no JS errors on a single full session**

Open http://localhost:3000 with DevTools console open. Click each tile (monitoring, lights, plan, chat). Use the back arrow to return. Open and close the theme picker on every page. Switch themes once.

Expected: zero red console errors. Yellow warnings (e.g. for missing favicons) are fine.

- [ ] **Step 6: Final commit (if any cleanup happened in Step 4)**

If Step 4 found anything to remove:
```bash
git add public/theme.css
git commit -m "style(header): remove orphaned theme picker label selectors"
```

If nothing to remove, no commit needed.

- [ ] **Step 7: Push**

```bash
git push origin main
```

---

## Notes for the implementer

- **No frontend test framework.** Verification is manual viewport checks. Don't skip them — visual regressions in the header will be obvious to the user on next load.
- **Sticky behavior on iOS Safari** can be quirky with rubber-banding. The single `.page-chrome` wrapper avoids the worst of it (both rows scroll together rather than gapping).
- **Theme picker icon color** (`--purple`) was chosen for both themes. If it reads poorly on Catppuccin Latte, swap to `--fg` in theme.css.
- **Don't add a status chip back to the landing.** Per spec, the service tiles already convey status; the chip was redundant.
- **The `setGlobalStatus` function deletion in Task 2** is intentional. Confirm `lastMonStatus` is also gone (used only by `setGlobalStatus`). Keep `lastLightsAvail` — it's used independently.
