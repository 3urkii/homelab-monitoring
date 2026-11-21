const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  validateCameraConfig, resolveCameraConfig, buildFfmpegArgs, JpegFrameSplitter, CameraStream, BOUNDARY,
} = require('../lib/camera.js');

const jpeg = (body) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(body), Buffer.from([0xff, 0xd9])]);

test('validateCameraConfig: empty object is valid (all defaults)', () => {
  assert.deepEqual(validateCameraConfig({}), []);
});

test('validateCameraConfig: rejects bad fields', () => {
  const errs = validateCameraConfig({ device: 'video0', fps: 0, width: 50, quality: 1, inputFormat: 'mj peg' });
  assert.ok(errs.some((e) => /device/.test(e)));
  assert.ok(errs.some((e) => /fps/.test(e)));
  assert.ok(errs.some((e) => /width/.test(e)));
  assert.ok(errs.some((e) => /quality/.test(e)));
  assert.ok(errs.some((e) => /inputFormat/.test(e)));
});

test('validateCameraConfig: non-object', () => {
  assert.deepEqual(validateCameraConfig(null), ['camera must be an object']);
});

test('resolveCameraConfig: fills defaults', () => {
  const c = resolveCameraConfig({ fps: 15 });
  assert.equal(c.device, '/dev/video0');
  assert.equal(c.fps, 15);
  assert.equal(c.label, 'camera');
});

test('buildFfmpegArgs: includes device, fps, input format', () => {
  const args = buildFfmpegArgs({ device: '/dev/video2', fps: 5, width: 640, inputFormat: 'mjpeg' });
  const s = args.join(' ');
  assert.match(s, /-f v4l2 -input_format mjpeg -i \/dev\/video2/);
  assert.match(s, /fps=5,scale='min\(640,iw\)':-2/);
  assert.equal(args.at(-1), 'pipe:1');
  assert.ok(!buildFfmpegArgs({}).includes('-input_format'));
});

test('JpegFrameSplitter: splits concatenated frames across chunk boundaries', () => {
  const sp = new JpegFrameSplitter();
  const a = jpeg('aaaa');
  const b = jpeg('bbbbbb');
  const all = Buffer.concat([a, b]);
  const out = [];
  // feed one byte at a time — worst case for boundary handling
  for (let i = 0; i < all.length; i++) out.push(...sp.push(all.subarray(i, i + 1)));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], a);
  assert.deepEqual(out[1], b);
});

test('JpegFrameSplitter: discards garbage before SOI', () => {
  const sp = new JpegFrameSplitter();
  const out = sp.push(Buffer.concat([Buffer.from('junk'), jpeg('x')]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], jpeg('x'));
});

function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.killed = false;
    proc.kill = (sig) => { proc.killed = sig; setImmediate(() => proc.emit('exit', null, sig)); };
    calls.push({ cmd, args, proc });
    return proc;
  };
  fn.calls = calls;
  return fn;
}

function fakeRes() {
  const res = new EventEmitter();
  res.chunks = [];
  res.ended = false;
  res.writableLength = 0;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.write = (c) => { res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; };
  res.end = () => { res.ended = true; };
  res.body = () => Buffer.concat(res.chunks);
  return res;
}

const tick = () => new Promise((r) => setImmediate(r));

test('CameraStream: starts ffmpeg on first viewer, shares it, fans out frames', async () => {
  const spawn = fakeSpawn();
  const cam = new CameraStream({}, { spawn, idleStopMs: 20 });
  const r1 = fakeRes();
  const r2 = fakeRes();
  cam.addClient(r1);
  cam.addClient(r2);
  assert.equal(spawn.calls.length, 1, 'single ffmpeg for both viewers');
  assert.match(r1.headers['Content-Type'], new RegExp(`multipart/x-mixed-replace; boundary=${BOUNDARY}`));

  spawn.calls[0].proc.stdout.write(jpeg('frame1'));
  await tick();
  for (const r of [r1, r2]) {
    const body = r.body();
    assert.ok(body.includes(Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg`)));
    assert.ok(body.includes(jpeg('frame1')));
  }
  cam.stop();
});

test('CameraStream: stops ffmpeg after last viewer leaves (after grace)', async () => {
  const spawn = fakeSpawn();
  const cam = new CameraStream({}, { spawn, idleStopMs: 20 });
  const r1 = fakeRes();
  cam.addClient(r1);
  r1.emit('close');
  assert.equal(cam.running, true, 'still running during grace period');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(cam.running, false);
  assert.equal(spawn.calls[0].proc.killed, 'SIGTERM');
});

test('CameraStream: viewer returning within grace reuses process', async () => {
  const spawn = fakeSpawn();
  const cam = new CameraStream({}, { spawn, idleStopMs: 50 });
  const r1 = fakeRes();
  cam.addClient(r1);
  spawn.calls[0].proc.stdout.write(jpeg('f'));
  await tick();
  r1.emit('close');
  const r2 = fakeRes();
  cam.addClient(r2);
  assert.equal(spawn.calls.length, 1);
  assert.ok(r2.body().includes(jpeg('f')), 'gets last frame immediately');
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(cam.running, true);
  cam.stop();
});

test('CameraStream: ffmpeg exit ends viewers and records error', async () => {
  const spawn = fakeSpawn();
  const cam = new CameraStream({}, { spawn });
  const r1 = fakeRes();
  cam.addClient(r1);
  const proc = spawn.calls[0].proc;
  proc.stderr.write('/dev/video0: No such file or directory\n');
  await tick();
  proc.emit('exit', 1, null);
  assert.equal(r1.ended, true);
  assert.equal(cam.running, false);
  assert.match(cam.status().lastError, /No such file/);
  // next viewer retries
  cam.addClient(fakeRes());
  assert.equal(spawn.calls.length, 2);
  cam.stop();
});

test('CameraStream: missing ffmpeg binary gives a helpful error', () => {
  const spawn = fakeSpawn();
  const cam = new CameraStream({}, { spawn });
  const r1 = fakeRes();
  cam.addClient(r1);
  const err = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
  spawn.calls[0].proc.emit('error', err);
  assert.equal(r1.ended, true);
  assert.match(cam.status().lastError, /apt install ffmpeg/);
});

test('CameraStream: skips frames for a backed-up client', async () => {
  const spawn = fakeSpawn();
  const cam = new CameraStream({}, { spawn });
  const slow = fakeRes();
  cam.addClient(slow);
  slow.writableLength = 5_000_000;
  spawn.calls[0].proc.stdout.write(jpeg('big'));
  await tick();
  assert.equal(slow.chunks.length, 0);
  cam.stop();
});
