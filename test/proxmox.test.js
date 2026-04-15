const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseClusterResources } = require('../lib/proxmox.js');

const clusterFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/proxmox-cluster-resources.json'), 'utf8'));

test('parseClusterResources: extracts host stats for matching node', () => {
  const { host } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  assert.equal(host.cpuPct.toFixed(1), '14.3');
  assert.equal(host.memUsed, 8589934592);
  assert.equal(host.memTotal, 34359738368);
  assert.equal(host.diskUsed, 214748364800);
  assert.equal(host.diskTotal, 1099511627776);
  assert.equal(host.uptime, 864000);
  assert.equal(host._cumulative.netRxBytes, 1048576000);
  assert.equal(host._cumulative.netTxBytes, 524288000);
});

test('parseClusterResources: throws when node not found', () => {
  assert.throws(
    () => parseClusterResources(clusterFixture.data, 'nonexistent'),
    /node not found/,
  );
});

test('parseClusterResources: collects LXC and QEMU guests for the target node', () => {
  const { guests } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  assert.equal(guests.length, 2);

  const lxc = guests.find((g) => g.vmid === 101);
  assert.equal(lxc.type, 'lxc');
  assert.equal(lxc.name, 'mc-server');
  assert.equal(lxc.status, 'running');
  assert.equal(lxc.cpuPct.toFixed(1), '22.5');
  assert.equal(lxc.memUsed, 2147483648);
  assert.equal(lxc.memTotal, 4294967296);
  assert.equal(lxc.diskUsed, 10737418240);
  assert.equal(lxc.diskTotal, 21474836480);

  const qemu = guests.find((g) => g.vmid === 201);
  assert.equal(qemu.type, 'qemu');
  assert.equal(qemu.name, 'win-vm');
  assert.equal(qemu.status, 'stopped');
  assert.equal(qemu.diskTotal, 0);
});

test('parseClusterResources: filters out other nodes and storage entries', () => {
  const { guests } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  assert.equal(guests.length, 2);
  assert.ok(guests.every((g) => g.vmid !== undefined));
});
