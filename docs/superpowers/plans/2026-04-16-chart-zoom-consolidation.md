# Chart Zoom & Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-to-zoom with reset across all charts, and consolidate plan.html's two chart panels into one unified multi-metric chart with preset groups and legend toggles.

**Architecture:** Both pages use uPlot v1.6.31 via CDN. All code is inline in the HTML files (no build step, no shared JS modules). index.html gets a reset button added to its existing chart modal. plan.html gets a full rewrite of its chart section — two panels become one, with a toolbar for presets/range/reset, and a single `renderUnifiedChart` function replacing `renderOnlineChart` + `renderTpsChart`.

**Tech Stack:** uPlot 1.6.31, vanilla JS, inline CSS, Dracula color palette.

**Spec:** `docs/superpowers/specs/2026-04-16-chart-zoom-consolidation-design.md`

---

### Task 1: Add zoom reset to index.html

**Files:**
- Modify: `public/index.html:447` (CSS — after `.chart-range-picker`)
- Modify: `public/index.html:584-589` (HTML — chart modal header)
- Modify: `public/index.html:853-977` (JS — chart rendering)

- [ ] **Step 1: Add reset button CSS**

In `public/index.html`, after the `.chart-range-btn:hover` rule block (line ~467), add:

```css
.chart-reset-btn {
  background: transparent;
  border: 1px solid var(--red);
  color: var(--red);
  padding: 0.3rem 0.7rem;
  border-radius: 3px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms var(--ease-out), border-color 140ms var(--ease-out), background 140ms var(--ease-out), transform 160ms var(--ease-out);
}
.chart-reset-btn.visible { opacity: 1; pointer-events: auto; }
.chart-reset-btn:active { transform: scale(0.96); }
@media (hover: hover) and (pointer: fine) {
  .chart-reset-btn:hover { background: rgba(255,85,85,0.1); }
}
```

- [ ] **Step 2: Add reset button HTML**

In `public/index.html`, find the chart modal header (line ~589):

```html
      </div>
      <button class="chart-modal-close" type="button" id="chartModalClose" title="Close (Esc)">✕</button>
```

Insert a reset button before the close button:

```html
      </div>
      <button class="chart-reset-btn" type="button" id="chartResetBtn" title="Reset zoom">RESET</button>
      <button class="chart-modal-close" type="button" id="chartModalClose" title="Close (Esc)">✕</button>
```

- [ ] **Step 3: Add zoom reset JS — store original bounds and hook setScale**

In `public/index.html`, find the `renderChart` function (line ~928). Replace the uPlot instantiation block:

Find:
```javascript
  chartInstance = new uPlot(opts, [timestamps, cpu, memPct, netRxMB, netTxMB], canvas);
```

Replace with:
```javascript
  var resetBtn = document.getElementById('chartResetBtn');
  resetBtn.classList.remove('visible');

  opts.hooks = {
    setScale: [function (u, key) {
      if (key !== 'x') return;
      var xData = u.data[0];
      var fullMin = xData[0];
      var fullMax = xData[xData.length - 1];
      var curMin = u.scales.x.min;
      var curMax = u.scales.x.max;
      var isZoomed = Math.abs(curMin - fullMin) > 1 || Math.abs(curMax - fullMax) > 1;
      resetBtn.classList.toggle('visible', isZoomed);
    }],
  };

  chartInstance = new uPlot(opts, [timestamps, cpu, memPct, netRxMB, netTxMB], canvas);

  canvas.addEventListener('dblclick', function () {
    if (!chartInstance) return;
    var xData = chartInstance.data[0];
    chartInstance.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
  });
```

- [ ] **Step 4: Add reset button click handler**

In `public/index.html`, find the chart range picker event listener (line ~988). Add before it:

```javascript
document.getElementById('chartResetBtn').addEventListener('click', function () {
  if (!chartInstance) return;
  var xData = chartInstance.data[0];
  chartInstance.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
});
```

- [ ] **Step 5: Verify in browser**

Run: open `http://localhost:3000` (or whatever port the dev server uses).

1. Click a chart button on any machine/guest card.
2. Set range to 7d or 30d.
3. Drag-select a region on the chart — it should zoom in, RESET button should appear.
4. Click RESET — chart should return to full range, RESET button should hide.
5. Drag-select again, then double-click the chart — same reset behavior.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add zoom reset button to index.html chart modal"
```

---

### Task 2: Restructure plan.html HTML — unified chart panel with toolbar

**Files:**
- Modify: `public/plan.html:391-411` (HTML — ACTIVITY section)

- [ ] **Step 1: Replace chart-grid HTML with unified panel**

In `public/plan.html`, find the ACTIVITY section (lines 391-411):

```html
  <section>
    <div class="section-header">
      <div class="section-title"><span class="accent">&gt;</span>ACTIVITY</div>
      <div class="range-picker" id="rangePicker">
        <button class="range-btn" type="button" data-range="1h">1h</button>
        <button class="range-btn" type="button" data-range="24h" data-active="true">24h</button>
        <button class="range-btn" type="button" data-range="7d">7d</button>
        <button class="range-btn" type="button" data-range="30d">30d</button>
      </div>
    </div>
    <div class="chart-grid">
      <div class="chart-panel">
        <div class="chart-panel-title">players / tps</div>
        <div class="chart-container" id="playersChart"><div class="chart-empty">loading&hellip;</div></div>
      </div>
      <div class="chart-panel">
        <div class="chart-panel-title">server performance</div>
        <div class="chart-container" id="perfChart"><div class="chart-empty">loading&hellip;</div></div>
      </div>
    </div>
  </section>
```

Replace with:

```html
  <section>
    <div class="section-header">
      <div class="section-title"><span class="accent">&gt;</span>ACTIVITY</div>
    </div>
    <div class="chart-panel">
      <div class="chart-toolbar">
        <div class="preset-picker" id="presetPicker">
          <button class="preset-btn" type="button" data-preset="all" data-active="true">ALL</button>
          <button class="preset-btn" type="button" data-preset="players">PLAYERS</button>
          <button class="preset-btn" type="button" data-preset="perf">PERF</button>
          <button class="preset-btn" type="button" data-preset="world">WORLD</button>
        </div>
        <div class="chart-toolbar-right">
          <div class="range-picker" id="rangePicker">
            <button class="range-btn" type="button" data-range="1h">1h</button>
            <button class="range-btn" type="button" data-range="24h" data-active="true">24h</button>
            <button class="range-btn" type="button" data-range="7d">7d</button>
            <button class="range-btn" type="button" data-range="30d">30d</button>
          </div>
          <div class="toolbar-divider"></div>
          <button class="chart-reset-btn" type="button" id="chartResetBtn" title="Reset zoom">RESET</button>
        </div>
      </div>
      <div class="chart-container" id="unifiedChart"><div class="chart-empty">loading&hellip;</div></div>
    </div>
  </section>
```

- [ ] **Step 2: Commit**

```bash
git add public/plan.html
git commit -m "refactor: replace plan.html chart-grid with unified chart panel HTML"
```

---

### Task 3: Update plan.html CSS — preset buttons, reset button, unified layout

**Files:**
- Modify: `public/plan.html:180-245` (CSS — range picker and chart panel styles)
- Modify: `public/plan.html:356-358` (CSS — responsive media query)

- [ ] **Step 1: Add toolbar and preset CSS**

In `public/plan.html`, find the range picker CSS section (lines 180-201). After the closing `}` of the `@media (hover: hover)` block for `.range-btn:hover` (line 201), add:

```css

/* ── Chart toolbar ── */
.chart-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;
}
.chart-toolbar-right { display: flex; align-items: center; gap: 0.35rem; }
.toolbar-divider { width: 1px; height: 16px; background: var(--current-line); margin: 0 0.25rem; }
.preset-picker { display: flex; gap: 0.35rem; }
.preset-btn {
  background: transparent;
  border: 1px solid var(--current-line);
  color: var(--comment);
  padding: 0.3rem 0.7rem;
  border-radius: 3px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition: border-color 140ms var(--ease-out), color 140ms var(--ease-out), background 140ms var(--ease-out), transform 160ms var(--ease-out);
}
.preset-btn:active { transform: scale(0.96); }
.preset-btn[data-active="true"] { border-color: var(--purple); color: var(--fg); background: var(--bg-alt); }
@media (hover: hover) and (pointer: fine) {
  .preset-btn:hover { border-color: var(--purple); color: var(--fg); }
}
.chart-reset-btn {
  background: transparent;
  border: 1px solid var(--red);
  color: var(--red);
  padding: 0.3rem 0.7rem;
  border-radius: 3px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms var(--ease-out), border-color 140ms var(--ease-out), background 140ms var(--ease-out), transform 160ms var(--ease-out);
}
.chart-reset-btn.visible { opacity: 1; pointer-events: auto; }
.chart-reset-btn:active { transform: scale(0.96); }
@media (hover: hover) and (pointer: fine) {
  .chart-reset-btn:hover { background: rgba(255,85,85,0.1); }
}
```

- [ ] **Step 2: Remove chart-grid CSS and update chart-container height**

In `public/plan.html`, find and remove the `.chart-grid` CSS block (lines 204-208):

```css
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}
```

Then find `.chart-container` (line 232) and change height from `260px` to `380px`:

```css
.chart-container {
  height: 380px;
```

- [ ] **Step 3: Update responsive CSS**

In `public/plan.html`, find the responsive rule (line 357):

```css
@media (max-width: 768px) {
  .chart-grid { grid-template-columns: 1fr; }
}
```

Replace with:

```css
@media (max-width: 768px) {
  .chart-toolbar { flex-direction: column; align-items: stretch; }
  .chart-toolbar-right { justify-content: flex-end; }
}
```

Also find the 520px breakpoint rule (line ~365):

```css
  .chart-container { height: 200px; }
```

Change to:

```css
  .chart-container { height: 280px; }
```

- [ ] **Step 4: Commit**

```bash
git add public/plan.html
git commit -m "style: add preset/reset button CSS, remove chart-grid, taller unified chart"
```

---

### Task 4: Implement unified chart JS — config, data merging, key resolution

**Files:**
- Modify: `public/plan.html:440-448` (JS — global variables)
- Modify: `public/plan.html:525-644` (JS — chart functions)

- [ ] **Step 1: Replace global chart variables**

In `public/plan.html`, find the globals block (lines 441-448):

```javascript
let serverName = null;
let onlineChart = null;
let tpsChart = null;
let rawOnlineData = null;
let rawPerfData = null;
let chartRange = '24h';
var RANGE_MS = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
```

Replace with:

```javascript
let serverName = null;
let unifiedChart = null;
let rawOnlineData = null;
let rawPerfData = null;
let chartRange = '24h';
let activePreset = 'all';
var RANGE_MS = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };

var METRIC_DEFS = [
  { key: 'playersOnline', label: 'players', color: '#50fa7b', fill: 'rgba(80,250,123,0.08)', width: 1.5, scale: 'count' },
  { key: 'tps',           label: 'TPS',     color: '#f1fa8c', fill: null,                    width: 1.5, scale: 'tps' },
  { key: 'cpu',           label: 'CPU %',   color: '#bd93f9', fill: null,                    width: 1.5, scale: 'pct', altKeys: ['cpu_usage', 'cpuUsage'] },
  { key: 'ram',           label: 'RAM (MB)',color: '#ff79c6', fill: null,                    width: 1.5, scale: 'aux' },
  { key: 'entities',      label: 'entities',color: '#ffb86c', fill: null,                    width: 1,   scale: 'count' },
  { key: 'chunks',        label: 'chunks',  color: '#8be9fd', fill: null,                    width: 1,   scale: 'count' },
  { key: 'disk',          label: 'disk',    color: '#ff5555', fill: null,                    width: 1,   scale: 'aux' },
  { key: 'ping',          label: 'ping',    color: '#f8f8f2', fill: null,                    width: 1,   scale: 'aux', altKeys: ['avgPing'] },
];

var PRESETS = {
  all:     METRIC_DEFS.map(function (m) { return m.key; }),
  players: ['playersOnline', 'tps'],
  perf:    ['tps', 'cpu', 'ram', 'disk'],
  world:   ['entities', 'chunks', 'playersOnline'],
};
```

- [ ] **Step 2: Add key resolution and data merge utilities**

In `public/plan.html`, find the `filterByRange` function (line ~526). After it, add:

```javascript
function findKeyIndex(keys, metricDef) {
  var idx = keys.indexOf(metricDef.key);
  if (idx >= 0) return idx;
  var alts = metricDef.altKeys || [];
  for (var i = 0; i < alts.length; i++) {
    idx = keys.indexOf(alts[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function mergePlayerData(perfPoints, perfKeys, onlineData) {
  var pIdx = perfKeys.indexOf('playersOnline');
  if (pIdx >= 0) return null;

  var onlineRaw = Array.isArray(onlineData) ? onlineData : (onlineData?.values || []);
  if (onlineRaw.length === 0) return null;

  var result = [];
  var oi = 0;
  for (var pi = 0; pi < perfPoints.length; pi++) {
    var perfTs = perfPoints[pi][0];
    while (oi < onlineRaw.length - 1 && Math.abs(onlineRaw[oi + 1][0] - perfTs) < Math.abs(onlineRaw[oi][0] - perfTs)) {
      oi++;
    }
    if (Math.abs(onlineRaw[oi][0] - perfTs) <= 30000) {
      result.push(onlineRaw[oi][1] ?? null);
    } else {
      result.push(null);
    }
  }
  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/plan.html
git commit -m "feat: add metric definitions, presets, and data merge utilities"
```

---

### Task 5: Implement renderUnifiedChart — replaces both old render functions

**Files:**
- Modify: `public/plan.html` (JS — replace `renderOnlineChart` + `renderTpsChart`)

- [ ] **Step 1: Delete old chart functions, add renderUnifiedChart**

In `public/plan.html`, find and delete the entire `renderOnlineChart` function (from `function renderOnlineChart(onlineData, perfData) {` through its closing `}`) and the entire `renderTpsChart` function (from `function renderTpsChart(data) {` through its closing `}`).

Replace both with:

```javascript
function renderUnifiedChart() {
  var container = document.getElementById('unifiedChart');
  var resetBtn = document.getElementById('chartResetBtn');
  var perfData = rawPerfData;
  var onlineData = rawOnlineData;

  var perfKeys = perfData?.keys || [];
  var allPoints = perfData?.values || [];
  var points = filterByRange(allPoints);

  if (points.length === 0 || typeof uPlot === 'undefined') {
    container.innerHTML = '<div class="chart-empty">' + (typeof uPlot === 'undefined' ? 'chart library unavailable' : 'no data available') + '</div>';
    return;
  }
  container.innerHTML = '';

  var mergedPlayers = mergePlayerData(points, perfKeys, onlineData);
  var presetKeys = PRESETS[activePreset] || PRESETS.all;

  var ts = points.map(function (p) { return Math.floor(p[0] / 1000); });
  var seriesData = [ts];
  var series = [{}];
  var scalesCfg = { x: { time: true } };
  var axesCfg = [
    { stroke: '#6272a4', grid: { stroke: '#44475a', width: 1 }, ticks: { stroke: '#44475a' } },
  ];
  var addedScales = {};

  for (var i = 0; i < METRIC_DEFS.length; i++) {
    var m = METRIC_DEFS[i];
    if (presetKeys.indexOf(m.key) < 0) continue;

    var dataCol = null;
    if (m.key === 'playersOnline' && mergedPlayers) {
      dataCol = mergedPlayers;
    } else {
      var kIdx = findKeyIndex(perfKeys, m);
      if (kIdx < 0) continue;
      dataCol = points.map(function (p) { return p[kIdx] ?? null; });
    }

    seriesData.push(dataCol);
    var seriesCfg = { label: m.label, stroke: m.color, width: m.width, scale: m.scale };
    if (m.fill) seriesCfg.fill = m.fill;
    series.push(seriesCfg);

    if (!addedScales[m.scale]) {
      addedScales[m.scale] = true;
      if (m.scale === 'pct') {
        scalesCfg.pct = { range: [0, 100] };
        axesCfg.push({ scale: 'pct', stroke: '#bd93f9', grid: { stroke: '#44475a', width: 1 }, ticks: { stroke: '#44475a' },
          values: function (u, vals) { return vals.map(function (v) { return v.toFixed(0) + '%'; }); } });
      } else if (m.scale === 'tps') {
        scalesCfg.tps = { range: [0, 22] };
        axesCfg.push({ side: 1, scale: 'tps', stroke: '#f1fa8c', grid: { show: false },
          values: function (u, vals) { return vals.map(function (v) { return v.toFixed(0); }); } });
      } else if (m.scale === 'count') {
        scalesCfg.count = { auto: true, range: function (u, lo, hi) { return [0, Math.max(hi, 1)]; } };
        axesCfg.push({ scale: 'count', stroke: '#6272a4', grid: { stroke: '#44475a', width: 1 }, ticks: { stroke: '#44475a' } });
      } else if (m.scale === 'aux') {
        scalesCfg.aux = { auto: true };
        axesCfg.push({ side: 1, scale: 'aux', stroke: '#6272a4', grid: { show: false } });
      }
    }
  }

  if (series.length <= 1) {
    container.innerHTML = '<div class="chart-empty">no data for this preset</div>';
    return;
  }

  if (unifiedChart) unifiedChart.destroy();
  resetBtn.classList.remove('visible');

  unifiedChart = new uPlot({
    width: container.clientWidth,
    height: container.clientHeight - 10,
    padding: [8, 16, 8, 8],
    cursor: { drag: { x: true, y: false, setScale: true } },
    scales: scalesCfg,
    axes: axesCfg,
    series: series,
    hooks: {
      setScale: [function (u, key) {
        if (key !== 'x') return;
        var xData = u.data[0];
        var fullMin = xData[0];
        var fullMax = xData[xData.length - 1];
        var curMin = u.scales.x.min;
        var curMax = u.scales.x.max;
        var isZoomed = Math.abs(curMin - fullMin) > 1 || Math.abs(curMax - fullMax) > 1;
        resetBtn.classList.toggle('visible', isZoomed);
      }],
    },
  }, seriesData, container);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/plan.html
git commit -m "feat: implement renderUnifiedChart with dynamic scales and zoom reset"
```

---

### Task 6: Wire up presets, range picker, resize, refresh, and reset

**Files:**
- Modify: `public/plan.html` (JS — event handlers and refresh function)

- [ ] **Step 1: Update the refresh function**

In `public/plan.html`, find the `refresh()` function (line ~713). Find these lines inside it:

```javascript
  if (onlineG) rawOnlineData = onlineG;
  if (perfG)   rawPerfData = perfG;
  if (onlineG || perfG)  renderOnlineChart(rawOnlineData, rawPerfData);
  if (perfG)             renderTpsChart(perfG);
```

Replace with:

```javascript
  if (onlineG) rawOnlineData = onlineG;
  if (perfG)   rawPerfData = perfG;
  if (onlineG || perfG)  renderUnifiedChart();
```

- [ ] **Step 2: Update the resize handler**

In `public/plan.html`, find the resize handler (line ~769):

```javascript
var resizeTimer;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    if (onlineChart) {
      var c1 = document.getElementById('playersChart');
      onlineChart.setSize({ width: c1.clientWidth, height: c1.clientHeight - 30 });
    }
    if (tpsChart) {
      var c2 = document.getElementById('perfChart');
      tpsChart.setSize({ width: c2.clientWidth, height: c2.clientHeight - 60 });
    }
  }, 200);
});
```

Replace with:

```javascript
var resizeTimer;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    if (unifiedChart) {
      var c = document.getElementById('unifiedChart');
      unifiedChart.setSize({ width: c.clientWidth, height: c.clientHeight - 10 });
    }
  }, 200);
});
```

- [ ] **Step 3: Update the range picker handler**

In `public/plan.html`, find the range picker handler (line ~784):

```javascript
document.getElementById('rangePicker').addEventListener('click', function (e) {
  var btn = e.target.closest('.range-btn');
  if (!btn || btn.dataset.range === chartRange) return;
  chartRange = btn.dataset.range;
  document.querySelectorAll('.range-btn').forEach(function (b) {
    b.dataset.active = b.dataset.range === chartRange ? 'true' : 'false';
  });
  if (rawOnlineData || rawPerfData) renderOnlineChart(rawOnlineData, rawPerfData);
  if (rawPerfData) renderTpsChart(rawPerfData);
});
```

Replace with:

```javascript
document.getElementById('rangePicker').addEventListener('click', function (e) {
  var btn = e.target.closest('.range-btn');
  if (!btn || btn.dataset.range === chartRange) return;
  chartRange = btn.dataset.range;
  document.querySelectorAll('.range-btn').forEach(function (b) {
    b.dataset.active = b.dataset.range === chartRange ? 'true' : 'false';
  });
  renderUnifiedChart();
});
```

- [ ] **Step 4: Add preset picker handler**

In `public/plan.html`, after the range picker event listener, add:

```javascript
document.getElementById('presetPicker').addEventListener('click', function (e) {
  var btn = e.target.closest('.preset-btn');
  if (!btn || btn.dataset.preset === activePreset) return;
  activePreset = btn.dataset.preset;
  document.querySelectorAll('.preset-btn').forEach(function (b) {
    b.dataset.active = b.dataset.preset === activePreset ? 'true' : 'false';
  });
  renderUnifiedChart();
});
```

- [ ] **Step 5: Add reset button handler**

After the preset picker handler, add:

```javascript
document.getElementById('chartResetBtn').addEventListener('click', function () {
  if (!unifiedChart) return;
  var xData = unifiedChart.data[0];
  unifiedChart.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
});

document.getElementById('unifiedChart').addEventListener('dblclick', function () {
  if (!unifiedChart) return;
  var xData = unifiedChart.data[0];
  unifiedChart.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
});
```

- [ ] **Step 6: Commit**

```bash
git add public/plan.html
git commit -m "feat: wire up preset picker, zoom reset, and update range/resize/refresh handlers"
```

---

### Task 7: Manual verification — both pages

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/burkii/homelab-monitoring && node server.js
```

- [ ] **Step 2: Test index.html zoom reset**

Open `http://localhost:3000` in a browser.

1. Click a chart button on any machine card to open the modal.
2. Set range to 30d.
3. Drag-select a horizontal region — chart should zoom in, RESET button appears.
4. Click RESET — chart returns to full range, button hides.
5. Drag-select again, double-click chart — same reset behavior.
6. Change range while zoomed — chart re-renders at full range for new window.

- [ ] **Step 3: Test plan.html unified chart**

Open `http://localhost:3000/plan` in a browser.

1. Verify single chart panel (not two columns).
2. Verify preset buttons: ALL, PLAYERS, PERF, WORLD.
3. Click each preset — chart should rebuild with only the relevant metrics.
4. Click ALL — all available metrics visible.
5. Click a legend item — that single series hides. Click again — it returns.
6. Switch presets — all legend toggles reset (all series visible).
7. Drag-select to zoom — RESET button appears. Click it — resets.
8. Double-click chart — also resets zoom.
9. Change range to 7d, drag-select a 1-day window — should be readable.
10. Test all 4 range options with each preset.

- [ ] **Step 4: Test responsive layout**

Resize browser to < 768px width:
1. Toolbar should wrap (presets on top, range/reset below).
2. Chart should remain functional.

Resize to < 520px:
1. Chart height should be 280px.
2. All controls should remain usable.

- [ ] **Step 5: Commit any fixes**

If any issues found during testing, fix and commit with descriptive messages.
