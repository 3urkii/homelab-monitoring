const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseMetrics } = require('../lib/node_exporter.js');

const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures/node-exporter-metrics.txt'),
  'utf8',
);

test('parseMetrics: memory fields', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.memTotal, 16_777_216_000);
  assert.equal(result.memAvailable, 8_388_608_000);
});

test('parseMetrics: filesystem fields (/ only, tmpfs excluded)', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.diskTotal, 107_374_182_400);
  assert.equal(result.diskAvailable, 53_687_091_200);
});

test('parseMetrics: network byte counters exclude loopback', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.netRxBytes, 1_234_567_000);
  assert.equal(result.netTxBytes, 567_800_000);
});

test('parseMetrics: cpu seconds (idle + total across all cores and modes)', () => {
  const result = parseMetrics(fixture);
  // idle = 12345.67 + 12400.12
  assert.equal(result.cpuIdleSeconds.toFixed(2), '24745.79');
  // total = idle + iowait + system + user = 24745.79 + 18.6 + 396.0 + 996.2 = 26156.59
  assert.equal(result.cpuTotalSeconds.toFixed(2), '26156.59');
});

test('parseMetrics: boot time and load averages', () => {
  const result = parseMetrics(fixture);
  assert.equal(result.bootTimeSeconds, 1_700_200_000);
  assert.deepEqual(result.loadavg, [0.15, 0.22, 0.18]);
});
