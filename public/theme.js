/* burkii.home theme switcher
 * Reads/writes localStorage('homelab.theme') and mounts a :colorscheme picker
 * into <header>. The pre-paint <script> in each page's <head> applies the
 * stored theme before first paint to avoid FOUC.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'homelab.theme';
  const DEFAULT_THEME = 'dracula';

  // To add a new theme: append entry, add palette block to theme.css.
  const THEMES = [
    { id: 'dracula',           label: 'dracula',          themeColor: '#282a36' },
    { id: 'catppuccin-latte',  label: 'catppuccin-latte', themeColor: '#e6e9ef' },
  ];

  function getStoredTheme() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }
  function storeTheme(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode etc */ }
  }
  function isKnown(id) { return THEMES.some((t) => t.id === id); }

  function applyTheme(id) {
    const theme = THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);
    if (theme.id === DEFAULT_THEME) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme.id);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.themeColor);
    storeTheme(theme.id);
    return theme;
  }

  function currentThemeId() {
    return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
  }

  function buildPicker() {
    const wrap = document.createElement('div');
    wrap.className = 'theme-picker';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-picker-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'change colorscheme');
    btn.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 21l4-1 11-11-3-3L4 17z"/>
    <path d="M14 6l4 4"/>
  </svg>
`;

    const menu = document.createElement('div');
    menu.className = 'theme-picker-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    THEMES.forEach((t) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'theme-picker-opt';
      opt.setAttribute('role', 'option');
      opt.dataset.themeId = t.id;
      opt.textContent = t.label;
      opt.addEventListener('click', () => {
        applyTheme(t.id);
        syncUI();
        closeMenu();
        btn.focus();
      });
      menu.appendChild(opt);
    });

    function syncUI() {
      const id = currentThemeId();
      menu.querySelectorAll('.theme-picker-opt').forEach((opt) => {
        if (opt.dataset.themeId === id) opt.setAttribute('aria-current', 'true');
        else opt.removeAttribute('aria-current');
      });
    }

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKeydown, true);
    }
    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKeydown, true);
    }
    function onDocClick(e) { if (!wrap.contains(e.target)) closeMenu(); }
    function onKeydown(e) { if (e.key === 'Escape') { closeMenu(); btn.focus(); } }

    btn.addEventListener('click', () => {
      if (menu.hidden) openMenu(); else closeMenu();
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    syncUI();
    return wrap;
  }

  function mount() {
    const stored = getStoredTheme();
    if (stored && isKnown(stored)) applyTheme(stored);
    // else: pre-paint script already set whatever was stored; if invalid/none, default Dracula renders.

    // Theme picker mounts only where a page explicitly requests it ([data-theme-mount]).
    // Sub-pages omit this so the header stays focused on page content.
    const target = document.querySelector('[data-theme-mount]');
    if (target) target.appendChild(buildPicker());

    mountClocks();
  }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
