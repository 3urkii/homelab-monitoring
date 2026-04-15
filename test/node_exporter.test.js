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
