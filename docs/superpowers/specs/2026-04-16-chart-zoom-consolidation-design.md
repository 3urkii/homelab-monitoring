# Chart Zoom & Consolidation Design

## Problem

1. Charts on 7d/30d ranges are unreadable — data is crammed with no way to inspect subregions.
2. plan.html has two separate chart panels (players/tps + server performance) that should be a single unified view matching the Plan plugin's performance page.

## Solution

Two changes:
1. **Drag-to-zoom with reset** on all charts across both pages.
2. **Consolidated unified chart** on plan.html with preset groups and individual legend toggles.

---

## 1. Zoom Behavior (Both Pages)

### Drag-to-Zoom
- `plan.html`: Add `setScale: true` to `cursor.drag` config (index.html already has it).
- User drags horizontally on the chart to select a time window. uPlot zooms the X axis to that window.

### Reset Mechanism
- **RESET button**: Hidden by default. Appears (un-dimmed) when the X scale differs from the original full range.
- **Double-click**: Also resets zoom to full range.
- Implementation: `hooks.setScale` callback on the uPlot instance detects zoom state. Reset calls `u.setScale('x', { min: originalMin, max: originalMax })`.

### Styling
- RESET button: Same size as range buttons, red accent (`#ff5555` border, `rgba(255,85,85,0.1)` background).
- Hidden via `opacity: 0; pointer-events: none` by default, transitions to visible when zoomed.

---

## 2. Consolidated Chart (plan.html)

### Layout Change
- Remove `.chart-grid` two-column layout with two `chart-panel` divs.
- Replace with single full-width chart panel, 380px chart container height (up from 260px).

### Toolbar
Left side: preset group buttons (ALL, PLAYERS, PERF, WORLD).
Right side: range picker (1h, 24h, 7d, 30d) + RESET button.

Preset button styling: same as range buttons. Active preset gets purple accent (`#bd93f9` border, `rgba(189,147,249,0.15)` background).

### Preset Groups

| Preset | Metrics Shown |
|--------|--------------|
| ALL | players, tps, cpu, ram, entities, chunks, disk, ping |
| PLAYERS | players, tps |
| PERF | tps, cpu, ram, disk |
| WORLD | entities, chunks, players |

Clicking a preset destroys and recreates the uPlot instance with only the relevant series/axes configured. This avoids orphaned axes from hidden series.

### Legend
uPlot built-in legend below the chart. Each legend item is clickable to toggle that individual series on/off via `setSeries`. Clicking a preset resets all individual toggles (all series in the new group start visible). Hidden series: dimmed + strikethrough text.

### Scales and Axes

Four scales, axes shown dynamically based on visible metrics:

| Scale | Range | Metrics | Axis |
|-------|-------|---------|------|
| `pct` | 0-100 | CPU | Left, "%" suffix |
| `count` | auto (0 to max) | players, entities, chunks | Left |
| `tps` | 0-22 | TPS | Right |
| `aux` | auto | RAM (MB), disk, ping | Right |

Only axes for series in the active preset are included in the uPlot config. Preset changes destroy and recreate the chart instance with the correct axes. Individual legend toggles use `setSeries` (axes remain, series line is hidden).

### Series Colors (Dracula Palette)

| Metric | Color | Hex |
|--------|-------|-----|
| Players | Green | `#50fa7b` (fill `rgba(80,250,123,0.08)`) |
| TPS | Yellow | `#f1fa8c` |
| CPU | Purple | `#bd93f9` |
| RAM | Pink | `#ff79c6` |
| Entities | Orange | `#ffb86c` |
| Chunks | Cyan | `#8be9fd` |
| Disk | Red | `#ff5555` |
| Ping | White/FG | `#f8f8f2` |

---

## 3. Data Merging

### Sources
- `optimizedPerformance` graph: TPS, CPU, RAM, entities, chunks, disk, ping (primary time axis).
- `playersOnline` graph: player count.

### Merge Strategy
- Use `optimizedPerformance` timestamps as primary.
- If `playersOnline` exists as a key in perfData, use directly (no merge).
- Otherwise, for each perfData timestamp, find nearest `playersOnline` value within 30s tolerance. No match = `null`.

### Key Resolution
Handles varying key names from Plan API:
- Players: `playersOnline`
- TPS: `tps`
- CPU: `cpu_usage` | `cpu` | `cpuUsage` (first found)
- RAM: `ram`
- Entities: `entities`
- Chunks: `chunks`
- Disk: `disk`
- Ping: `ping` | `avgPing`

Missing metrics are silently skipped — no empty series, no broken axes.

---

## 4. index.html Changes

Minimal — modal chart already has working drag-to-zoom.

### Additions
- RESET button in modal header area (same styling as plan.html).
- Double-click to reset handler.
- `hooks.setScale` callback to show/hide reset button.

No other changes to the modal chart (CPU, mem, rx, tx).

---

## Files Changed

| File | Changes |
|------|---------|
| `public/plan.html` HTML | Remove `chart-grid` + two panels, add single chart panel + toolbar |
| `public/plan.html` CSS | Remove `.chart-grid`, add preset/reset button styles, 380px container |
| `public/plan.html` JS | Replace `renderOnlineChart` + `renderTpsChart` with `renderUnifiedChart`, preset switching, legend toggle, zoom reset, data merge |
| `public/index.html` HTML | Add RESET button in chart modal |
| `public/index.html` CSS | Reset button styles |
| `public/index.html` JS | Add zoom reset handler + double-click reset |

No backend changes. No new dependencies.
