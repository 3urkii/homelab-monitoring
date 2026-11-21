const { spawn: nodeSpawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

// Live webcam feed. One ffmpeg process reads the V4L2 device and emits a
// stream of JPEG frames; every connected browser gets them as a
// multipart/x-mixed-replace (MJPEG) response that a plain <img> can render.
// ffmpeg only runs while at least one viewer is connected (plus a short grace
// period so quick close/reopen doesn't thrash the device). Nothing is recorded.

const DEFAULTS = Object.freeze({
  device: '/dev/video0',
  label: 'camera',
  width: 1280,
  fps: 10,
  quality: 7,
  inputFormat: undefined,
  ffmpegPath: 'ffmpeg',
});

const BOUNDARY = 'camframe';
const IDLE_STOP_MS = 5_000;
// A client whose socket buffer is above this is skipped for the current frame
// instead of queueing unbounded memory (slow phone on Wi-Fi, background tab).
const MAX_BUFFERED_BYTES = 1_000_000;
// Frames larger than this mean the splitter lost sync — drop the buffer.
const MAX_FRAME_BYTES = 8_000_000;

function validateCameraConfig(cam) {
  const errors = [];
  if (!cam || typeof cam !== 'object') {
    errors.push('camera must be an object');
    return errors;
  }
  if (cam.device !== undefined && (typeof cam.device !== 'string' || !cam.device.startsWith('/dev/'))) {
    errors.push('camera.device must be a /dev/... path (e.g. "/dev/video0")');
  }
  if (cam.label !== undefined && (typeof cam.label !== 'string' || !cam.label)) {
    errors.push('camera.label must be a non-empty string if set');
  }
  if (cam.width !== undefined && !(Number.isInteger(cam.width) && cam.width >= 160 && cam.width <= 3840)) {
    errors.push('camera.width must be an integer between 160 and 3840');
  }
  if (cam.fps !== undefined && !(Number.isInteger(cam.fps) && cam.fps >= 1 && cam.fps <= 30)) {
    errors.push('camera.fps must be an integer between 1 and 30');
  }
  if (cam.quality !== undefined && !(Number.isInteger(cam.quality) && cam.quality >= 2 && cam.quality <= 31)) {
    errors.push('camera.quality must be an integer between 2 (best) and 31 (worst)');
  }
  if (cam.inputFormat !== undefined && (typeof cam.inputFormat !== 'string' || !/^[a-z0-9_]+$/i.test(cam.inputFormat))) {
    errors.push('camera.inputFormat must be a v4l2 format name like "mjpeg" or "yuyv422"');
  }
  if (cam.ffmpegPath !== undefined && (typeof cam.ffmpegPath !== 'string' || !cam.ffmpegPath)) {
    errors.push('camera.ffmpegPath must be a non-empty string if set');
  }
  return errors;
}

function resolveCameraConfig(cam) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (cam && cam[k] !== undefined) out[k] = cam[k];
  }
  return out;
}

function buildFfmpegArgs(cfg) {
  const c = resolveCameraConfig(cfg);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'v4l2'];
  if (c.inputFormat) args.push('-input_format', c.inputFormat);
  args.push(
    '-i', c.device,
    '-an',
    '-vf', `fps=${c.fps},scale='min(${c.width},iw)':-2`,
    '-pix_fmt', 'yuvj420p',
    '-c:v', 'mjpeg',
    '-q:v', String(c.quality),
    '-f', 'mjpeg',
    'pipe:1',
  );
  return args;
}

// Splits a byte stream of concatenated JPEGs (ffmpeg `-f mjpeg`) into frames.
// Entropy-coded JPEG data byte-stuffs 0xFF, so FFD9 only appears as EOI.
class JpegFrameSplitter {
  #buf = Buffer.alloc(0);

  push(chunk) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    const frames = [];
    for (;;) {
      const start = this.#buf.indexOf(SOI);
      if (start === -1) {
        // Keep a trailing 0xFF in case it's the first half of a split SOI.
        this.#buf = this.#buf.length && this.#buf[this.#buf.length - 1] === 0xff
          ? this.#buf.subarray(this.#buf.length - 1)
          : Buffer.alloc(0);
        break;
      }
      const end = this.#buf.indexOf(EOI, start + 2);
      if (end === -1) {
        this.#buf = this.#buf.subarray(start);
        if (this.#buf.length > MAX_FRAME_BYTES) this.#buf = Buffer.alloc(0);
        break;
      }
      frames.push(Buffer.from(this.#buf.subarray(start, end + 2)));
      this.#buf = this.#buf.subarray(end + 2);
    }
    return frames;
  }
}
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

class CameraStream extends EventEmitter {
  #cfg;
  #spawn;
  #idleStopMs;
  #clients = new Set();
  #proc = null;
  #idleTimer = null;
  #lastFrame = null;
  #lastError = null;
  #stderrTail = '';

  constructor(cameraConfig, { spawn = nodeSpawn, idleStopMs = IDLE_STOP_MS } = {}) {
    super();
    this.#cfg = resolveCameraConfig(cameraConfig);
    this.#spawn = spawn;
    this.#idleStopMs = idleStopMs;
  }

  get running() { return !!this.#proc; }
  clientCount() { return this.#clients.size; }
  status() {
    return {
      label: this.#cfg.label,
      running: this.running,
      viewers: this.#clients.size,
      lastError: this.#lastError,
    };
  }

  addClient(res) {
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close',
      'X-Accel-Buffering': 'no',
    });
    this.#clients.add(res);
    res.on('close', () => this.#removeClient(res));

    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    // Reconnecting viewer during the grace period gets a frame immediately.
    if (this.#proc && this.#lastFrame) this.#writeFrame(res, this.#lastFrame);
    if (!this.#proc) this.#start();
  }

  stop() {
    if (this.#idleTimer) { clearTimeout(this.#idleTimer); this.#idleTimer = null; }
    for (const res of this.#clients) { try { res.end(); } catch {} }
    this.#clients.clear();
    this.#kill();
  }

  #removeClient(res) {
    if (!this.#clients.delete(res)) return;
    if (this.#clients.size === 0 && this.#proc && !this.#idleTimer) {
      this.#idleTimer = setTimeout(() => {
        this.#idleTimer = null;
        if (this.#clients.size === 0) this.#kill();
      }, this.#idleStopMs);
      this.#idleTimer.unref?.();
    }
  }

  #start() {
    const args = buildFfmpegArgs(this.#cfg);
    const splitter = new JpegFrameSplitter();
    this.#stderrTail = '';
    this.#lastFrame = null;
    let proc;
    try {
      proc = this.#spawn(this.#cfg.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.#fail(`failed to start ffmpeg: ${err.message}`);
      return;
    }
    this.#proc = proc;
    this.emit('start');

    proc.stdout.on('data', (chunk) => {
      if (this.#proc !== proc) return;
      for (const frame of splitter.push(chunk)) {
        this.#lastFrame = frame;
        this.#lastError = null;
        for (const res of this.#clients) this.#writeFrame(res, frame);
      }
    });
    proc.stderr.on('data', (chunk) => {
      this.#stderrTail = (this.#stderrTail + chunk.toString()).slice(-2000);
    });
    proc.on('error', (err) => {
      if (this.#proc !== proc) return;
      this.#proc = null;
      this.#fail(err.code === 'ENOENT'
        ? `ffmpeg not found (${this.#cfg.ffmpegPath}) — apt install ffmpeg`
        : `ffmpeg error: ${err.message}`);
    });
    proc.on('exit', (code, signal) => {
      if (this.#proc !== proc) return; // we killed it on purpose
      this.#proc = null;
      const detail = this.#stderrTail.trim().split('\n').pop() || `exit ${code ?? signal}`;
      this.#fail(`ffmpeg stopped: ${detail}`);
    });
  }

  #fail(message) {
    this.#lastError = message;
    this.emit('error-status', message);
    // End every viewer so the browser's <img> fires onerror and can offer retry.
    for (const res of this.#clients) { try { res.end(); } catch {} }
    this.#clients.clear();
  }

  #kill() {
    const proc = this.#proc;
    if (!proc) return;
    this.#proc = null;
    this.#lastFrame = null;
    try { proc.kill('SIGTERM'); } catch {}
    const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000);
    t.unref?.();
    proc.once?.('exit', () => clearTimeout(t));
    this.emit('stop');
  }

  #writeFrame(res, frame) {
    if (res.writableLength > MAX_BUFFERED_BYTES) return;
    try {
      res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    } catch {
      this.#removeClient(res);
    }
  }
}

module.exports = {
  validateCameraConfig,
  resolveCameraConfig,
  buildFfmpegArgs,
  JpegFrameSplitter,
  CameraStream,
  BOUNDARY,
  DEFAULTS,
};
