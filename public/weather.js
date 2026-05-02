/* Shared weather chip + panel logic.
 * Mounts only if #weatherChip exists on the page. Each consuming page
 * supplies the chip + panel markup; this script wires fetching, rendering,
 * and the open/close toggle. Refreshes every 10 minutes.
 */
(function () {
  'use strict';

  const REFRESH_MS = 10 * 60 * 1000;

  const WMO = {
    0:  { label: 'clear',           icon: 'sun' },
    1:  { label: 'mainly clear',    icon: 'sun' },
    2:  { label: 'partly cloudy',   icon: 'sun-cloud' },
    3:  { label: 'overcast',        icon: 'cloud' },
    45: { label: 'fog',              icon: 'fog' },
    48: { label: 'rime fog',         icon: 'fog' },
    51: { label: 'light drizzle',    icon: 'drizzle' },
    53: { label: 'drizzle',          icon: 'drizzle' },
    55: { label: 'heavy drizzle',    icon: 'drizzle' },
    56: { label: 'freezing drizzle', icon: 'drizzle' },
    57: { label: 'freezing drizzle', icon: 'drizzle' },
    61: { label: 'light rain',       icon: 'rain' },
    63: { label: 'rain',             icon: 'rain' },
    65: { label: 'heavy rain',       icon: 'rain' },
    66: { label: 'freezing rain',    icon: 'rain' },
    67: { label: 'freezing rain',    icon: 'rain' },
    71: { label: 'light snow',       icon: 'snow' },
    73: { label: 'snow',             icon: 'snow' },
    75: { label: 'heavy snow',       icon: 'snow' },
    77: { label: 'snow grains',      icon: 'snow' },
    80: { label: 'rain showers',     icon: 'rain' },
    81: { label: 'rain showers',     icon: 'rain' },
    82: { label: 'heavy showers',    icon: 'rain' },
    85: { label: 'snow showers',     icon: 'snow' },
    86: { label: 'snow showers',     icon: 'snow' },
    95: { label: 'thunderstorm',     icon: 'thunder' },
    96: { label: 'thunder + hail',   icon: 'thunder' },
    99: { label: 'thunder + hail',   icon: 'thunder' },
  };

  const ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M5.2 18.8l1.7-1.7M17.1 6.9l1.7-1.7"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    'sun-cloud': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 13v1.6M1.5 8h1.6M13 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/><path d="M9 16.5h7.5a3.5 3.5 0 1 0-.6-6.95A5.5 5.5 0 0 0 6.5 12.5a3 3 0 1 0 0 6H9"/></svg>',
    'moon-cloud': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4a5 5 0 0 0 6 7 6 6 0 0 1-9-7z"/><path d="M9 18.5h7.5a3.5 3.5 0 1 0-.6-6.95A5.5 5.5 0 0 0 6.5 14.5a3 3 0 1 0 0 6H9"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 1 0-.7-7.95A6 6 0 0 0 4.5 12.5 3.5 3.5 0 0 0 7 18z"/></svg>',
    fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a4 4 0 1 0-.7-7.95A6 6 0 0 0 4.5 8.5 3.5 3.5 0 0 0 7 14z"/><path d="M3 18h18M5 21h14"/></svg>',
    drizzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a4 4 0 1 0-.7-7.95A6 6 0 0 0 4.5 8.5 3.5 3.5 0 0 0 7 14z"/><path d="M9 17v2M13 17v2M17 17v2"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a4 4 0 1 0-.7-7.95A6 6 0 0 0 4.5 7.5 3.5 3.5 0 0 0 7 13z"/><path d="M8 17l-1.5 4M12 17l-1.5 4M16 17l-1.5 4"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a4 4 0 1 0-.7-7.95A6 6 0 0 0 4.5 7.5 3.5 3.5 0 0 0 7 13z"/><path d="M8 18l.001.01M12 19l.001.01M16 18l.001.01M10 21l.001.01M14 21l.001.01"/></svg>',
    thunder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a4 4 0 1 0-.7-7.95A6 6 0 0 0 4.5 7.5 3.5 3.5 0 0 0 7 13z"/><path d="M12 14l-2.5 4h3L11 22"/></svg>',
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function weatherIcon(code, isDay = true) {
    const entry = WMO[code] || { label: 'unknown', icon: 'cloud' };
    let key = entry.icon;
    if (!isDay) {
      if (key === 'sun') key = 'moon';
      else if (key === 'sun-cloud') key = 'moon-cloud';
    }
    return { svg: ICONS[key] || ICONS.cloud, label: entry.label };
  }

  function tempUnitSymbol(unit) { return unit === 'fahrenheit' ? '°F' : '°C'; }

  function fmtTemp(t, unit) {
    if (typeof t !== 'number' || !isFinite(t)) return '--' + tempUnitSymbol(unit);
    return Math.round(t) + tempUnitSymbol(unit);
  }

  function fmtTime(iso) {
    if (!iso) return '--:--';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function fmtDayName(iso, idx) {
    if (idx === 0) return 'today';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
  }

  function renderWeather(w) {
    const chip = document.getElementById('weatherChip');
    const unit = w.unit || 'celsius';
    const cur = w.current || {};
    const isDay = cur.is_day !== 0;
    const { svg, label } = weatherIcon(cur.weather_code, isDay);
    document.getElementById('weatherChipIcon').innerHTML = svg;
    document.getElementById('weatherChipTemp').textContent = fmtTemp(cur.temperature_2m, unit);
    document.getElementById('weatherChipCond').textContent = label;
    chip.classList.toggle('stale', !!w.stale);
    chip.hidden = false;

    document.getElementById('weatherPanelIcon').innerHTML = svg;
    document.getElementById('weatherPanelTemp').textContent = fmtTemp(cur.temperature_2m, unit);
    document.getElementById('weatherPanelCond').textContent = label;
    document.getElementById('weatherPanelLabel').textContent = w.label || 'home';
    document.getElementById('weatherPanelFeels').textContent = fmtTemp(cur.apparent_temperature, unit);
    document.getElementById('weatherPanelHumidity').textContent =
      typeof cur.relative_humidity_2m === 'number' ? `${Math.round(cur.relative_humidity_2m)}%` : '--%';
    document.getElementById('weatherPanelWind').textContent =
      typeof cur.wind_speed_10m === 'number' ? `${Math.round(cur.wind_speed_10m)} km/h` : '-- km/h';

    const daily = w.daily || {};
    const days = Array.isArray(daily.time) ? daily.time : [];
    document.getElementById('weatherPanelSunrise').textContent = fmtTime((daily.sunrise || [])[0]);
    document.getElementById('weatherPanelSunset').textContent = fmtTime((daily.sunset || [])[0]);

    let minLo = Infinity, maxHi = -Infinity;
    for (let i = 0; i < days.length; i++) {
      const lo = (daily.temperature_2m_min || [])[i];
      const hi = (daily.temperature_2m_max || [])[i];
      if (typeof lo === 'number') minLo = Math.min(minLo, lo);
      if (typeof hi === 'number') maxHi = Math.max(maxHi, hi);
    }
    const span = (isFinite(minLo) && isFinite(maxHi) && maxHi > minLo) ? (maxHi - minLo) : 1;

    const forecastEl = document.getElementById('weatherForecast');
    forecastEl.innerHTML = days.map((iso, i) => {
      const code = (daily.weather_code || [])[i];
      const { svg: dsvg, label: dlabel } = weatherIcon(code, true);
      const lo = (daily.temperature_2m_min || [])[i];
      const hi = (daily.temperature_2m_max || [])[i];
      const fillLeft = isFinite(minLo) && typeof lo === 'number' ? ((lo - minLo) / span) * 100 : 0;
      const fillWidth = (typeof lo === 'number' && typeof hi === 'number')
        ? Math.max(6, ((hi - lo) / span) * 100)
        : 100;
      return `
        <div class="w-day" title="${escapeHtml(dlabel)}">
          <span class="w-day-name">${escapeHtml(fmtDayName(iso, i))}</span>
          <span class="w-day-icon">${dsvg}</span>
          <span class="w-day-bar"><span class="w-day-bar-fill" style="left:${fillLeft.toFixed(1)}%;width:${fillWidth.toFixed(1)}%"></span></span>
          <span class="w-day-temps"><span class="lo">${fmtTemp(lo, unit)}</span><span class="sep">·</span>${fmtTemp(hi, unit)}</span>
        </div>`;
    }).join('');

    document.getElementById('weatherStale').hidden = !w.stale;
  }

  async function refreshWeather() {
    try {
      const res = await fetch('/api/weather');
      if (res.status === 404) {
        document.getElementById('weatherChip').hidden = true;
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderWeather(data);
      return true;
    } catch {
      document.getElementById('weatherChip').hidden = true;
      return false;
    }
  }

  function setupWeatherToggle() {
    const chip = document.getElementById('weatherChip');
    const panel = document.getElementById('weatherPanel');
    function close() { panel.hidden = true; chip.setAttribute('aria-expanded', 'false'); }
    function open()  { panel.hidden = false; chip.setAttribute('aria-expanded', 'true'); }
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });
    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || chip.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) close();
    });
  }

  function init() {
    if (!document.getElementById('weatherChip')) return;
    setupWeatherToggle();
    refreshWeather();
    setInterval(refreshWeather, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
