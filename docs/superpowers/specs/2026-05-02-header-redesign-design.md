# Header redesign

Date: 2026-05-02
Status: Approved

## Context

Current header is a single flex-wrap row across `index.html`, `monitoring.html`, `lights.html`, `plan.html`, `chat.html`. Two variants:

- **Landing** (`page-header`): brand `[burkii.home]` + status chip + weather chip + clock + theme picker (`:dracula` text + dropdown)
- **Sub-pages** (`page-header--sub`): back button + compact brand `burkii/<page>` + page-specific tools. No theme picker, no clock, no weather.

Brand sizes today: landing `clamp(1.2rem, 0.95rem + 1.2vw, 1.85rem)`; sub-pages `clamp(1.05rem, 0.9rem + 0.6vw, 1.4rem)`.

## Problems

- Phone view feels cramped — landing fits 5 elements in one row; chip wrap is unpredictable
- Brand reads small relative to other chrome on phones
- Theme picker label `:dracula` consumes horizontal space; only mounted on landing (sub-pages can't change theme)
- Status chip on landing is redundant — service tiles already show per-service status
- Sub-page action buttons (refresh, ALL OFF, count, last-poll) jam in next to brand

## Solutions

1. Bigger landing brand with terminal cursor flourish; smaller chrome footprint
2. Drop landing status chip
3. Replace `:dracula` text label with paintbrush icon button; mount on every page
4. Move sub-page action buttons out of header into a sub-bar pinned beneath
5. Wrap header + sub-bar in single sticky container so they scroll together
6. Restyle clock as a pill with blinking colon (terminal feel); hide on landing mobile

## Implementation

### HTML structure

**Landing (`index.html`):**
```html
<div class="page-chrome">
  <header class="page-header">
    <a class="brand" href="/" aria-label="burkii.home">
      <span class="brand-mark">
        <span class="bracket">[</span><span class="domain">burkii</span><span class="tld">.home</span><span class="bracket">]</span><span class="brand-cursor" aria-hidden="true"></span>
      </span>
    </a>
    <div class="header-chrome">
      <button class="weather-chip" id="weatherChip" ...>...</button>
      <div class="clock">
        <span class="prompt">$</span><span data-clock-h>--</span><span class="colon">:</span><span data-clock-m>--</span>
      </div>
      <span data-theme-mount></span>
      <div class="weather-panel" id="weatherPanel" ...>...</div>
    </div>
  </header>
</div>
```

Removed: `<div class="header-tools">` block containing `#globalStatus` chip.

**Sub-pages (`monitoring.html`, `lights.html`, `plan.html`, `chat.html`):**
```html
<div class="page-chrome">
  <header class="page-header page-header--sub">
    <a class="back-btn" href="/">←</a>
    <span class="brand brand--compact">
      <span class="brand-mark">burkii</span><span class="brand-sub">/<page></span>
    </span>
    <div class="header-chrome">
      <span data-theme-mount></span>
    </div>
  </header>
  <div class="page-subbar">
    <!-- page-specific tools migrated from header-tools -->
  </div>
</div>
```

Per-page sub-bar contents:
- `monitoring`: `status-chip` + `last-poll` + `refresh-btn`
- `plan`: `status-chip` + `last-poll` + `refresh-btn`
- `lights`: `status-chip` + `count-chip` + spacer + `all-off-btn`
- `chat`: `status-chip` (sub-bar kept for visual consistency)

### CSS changes (`theme.css`)

**Brand size bump:**
```css
.brand { font-size: clamp(1.55rem, 1.2rem + 1.6vw, 2.2rem); }
/* .brand--compact stays as-is */
```

**Brand cursor:**
```css
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

`.brand--compact` does NOT get a cursor (sub-pages stay quiet).

**Sticky chrome wrapper:**
```css
.page-chrome {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--bg);
}
```

**Sub-bar:**
```css
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
}
```

**Clock pill:**
```css
.clock {
  padding: 0.22rem 0.55rem;
  border: 1px solid var(--current-line);
  border-radius: 999px;
}
.clock .colon {
  animation: brandBlink 1.2s steps(1) infinite;
  color: var(--green);
}
.clock .prompt { color: var(--green); margin-right: 0.4ch; }
@media (max-width: 640px) {
  .clock { display: none; }   /* drop on landing mobile — too tight */
}
```

**Status chip:** existing `.status-chip` rules in `theme.css` work as-is inside `.page-subbar` (inline-flex, neutral typography). No structural change needed. On mobile, drop the label text inside the sub-bar — dot only:
```css
@media (max-width: 640px) {
  .page-subbar .status-chip span:not(.dot) { display: none; }
}
```

**Theme picker icon button:** see JS section. Add CSS for SVG sizing:
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
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}
.theme-picker-btn svg { width: 16px; height: 16px; }
@media (hover: hover) and (pointer: fine) {
  .theme-picker-btn:hover { border-color: var(--purple); background: rgba(var(--purple-rgb), 0.08); }
}
.theme-picker-btn[aria-expanded="true"] { border-color: var(--purple); background: rgba(var(--purple-rgb), 0.08); }
```

(Existing menu styles for `.theme-picker-menu` stay; verify they still position correctly under the smaller button.)

**Keep existing mobile rules:** the `.status-chip` mobile letter-spacing/font-size rules still apply to sub-bar status chips on `monitoring`/`plan`/`lights`/`chat`. Do not remove them.

### JavaScript changes (`theme.js`)

**`buildPicker()`** — replace text content with SVG:
```js
btn.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 21l4-1 11-11-3-3L4 17z"/>
    <path d="M14 6l4 4"/>
  </svg>
`;
```
Drop the `nameEl` lookup and `nameEl.textContent` write in `syncUI()` (icon doesn't change per theme — current theme is indicated in the dropdown).

**`mountClocks()`** — read parts separately:
```js
function tick() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.querySelectorAll('[data-clock-h]').forEach(n => n.textContent = hh);
  document.querySelectorAll('[data-clock-m]').forEach(n => n.textContent = mm);
}
```

### Page-by-page diff

Each sub-page (`monitoring.html`, `lights.html`, `plan.html`, `chat.html`):
1. Wrap `<header>` and the sub-bar in `<div class="page-chrome">`
2. Move `<div class="header-tools">…</div>` content out of the header and into a new `<div class="page-subbar">` immediately after `</header>` but inside `.page-chrome`
3. Add `<div class="header-chrome"><span data-theme-mount></span></div>` to the header
4. For `lights`: insert `<div class="spacer"></div>` between count chip and ALL OFF in the sub-bar (matches mockup where ALL OFF aligns right)

Landing (`index.html`):
1. Wrap `<header>` in `<div class="page-chrome">`
2. Append `<span class="brand-cursor" aria-hidden="true"></span>` inside `.brand-mark`, after the closing `]` bracket
3. Remove the `<div class="header-tools">` block (status chip)
4. Update clock markup to split hour/colon/minute
5. Search for `globalStatus` and `globalStatusLabel` references in inline JS and remove

## Testing

Manual viewport checks (no test suite for HTML in this project):
- iPhone SE (375×667), iPhone 13 (390×844), iPad portrait (768×1024), desktop (1440×900)
- Each of the 5 pages
- Both themes (Dracula, Catppuccin Latte)
- `prefers-reduced-motion` toggled — cursor and colon should not animate

Behavioral checks:
- Sticky chrome stays pinned during long-page scroll (lights, monitoring)
- Theme picker opens/closes/cycles on each page; dropdown does not clip on small viewports
- No console errors after status chip removal on landing
- Weather chip + panel still works on landing

## Out of scope

- Auto-hide-on-scroll behavior (rejected in favor of simple sticky)
- Cross-page navigation menu (rejected — landing tiles handle it; sub-pages use back)
- Adding a 3rd theme (picker is ready for it; not part of this work)
- Bottom action bar pattern (rejected for now)
