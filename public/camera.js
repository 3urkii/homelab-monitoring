(function () {
  const chip = document.getElementById('camChip');
  const dialog = document.getElementById('camFeed');
  if (!chip || !dialog) return;

  const frame = dialog.querySelector('[data-cam-frame]');
  const status = dialog.querySelector('[data-cam-status]');
  const statusText = dialog.querySelector('[data-cam-status-text]');
  const retryBtn = dialog.querySelector('[data-cam-retry]');
  const label = dialog.querySelector('[data-cam-label]');
  const closeBtn = dialog.querySelector('[data-cam-close]');
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  let img = null;

  async function init() {
    try {
      const r = await fetch('/api/landing-config');
      if (!r.ok) return;
      const cfg = await r.json();
      if (!cfg.camera || !cfg.camera.available) return;
      if (cfg.camera.label) label.textContent = cfg.camera.label;
      chip.hidden = false;
    } catch {}
  }

  function setStatus(text, { error = false } = {}) {
    if (!text) { status.hidden = true; return; }
    status.hidden = false;
    statusText.textContent = text;
    status.dataset.error = error ? 'true' : 'false';
    retryBtn.hidden = !error;
  }

  function startStream() {
    stopStream();
    setStatus('connecting…');
    img = document.createElement('img');
    img.className = 'cam-img';
    img.alt = 'live camera feed';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      setStatus(null);
      dialog.dataset.live = 'true';
    });
    img.addEventListener('error', onStreamError);
    frame.appendChild(img);
    // Cache-buster so the browser never reuses a finished stream response.
    img.src = `/api/camera/stream?t=${Date.now()}`;
  }

  function stopStream() {
    dialog.dataset.live = 'false';
    if (!img) return;
    img.removeEventListener('error', onStreamError);
    // Swap src before detaching so every browser aborts the MJPEG request.
    img.src = BLANK;
    img.remove();
    img = null;
  }

  async function onStreamError() {
    stopStream();
    let msg = 'camera offline';
    try {
      const r = await fetch('/api/camera/status');
      if (r.ok) {
        const s = await r.json();
        if (s.lastError) msg = s.lastError;
      }
    } catch {}
    if (dialog.open) setStatus(msg, { error: true });
  }

  function openSheet() {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    chip.setAttribute('aria-expanded', 'true');
    startStream();
  }

  function closeSheet() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  dialog.addEventListener('close', () => {
    chip.setAttribute('aria-expanded', 'false');
    stopStream();
  });
  // Click on the backdrop closes the sheet.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeSheet(); });

  // Don't hold the camera open from a backgrounded tab / locked phone.
  document.addEventListener('visibilitychange', () => {
    if (!dialog.open) return;
    if (document.hidden) stopStream();
    else startStream();
  });

  chip.addEventListener('click', openSheet);
  closeBtn.addEventListener('click', closeSheet);
  retryBtn.addEventListener('click', startStream);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
