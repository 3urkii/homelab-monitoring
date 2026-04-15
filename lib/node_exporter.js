const EXCLUDED_FSTYPES = new Set([
  'tmpfs', 'overlay', 'squashfs', 'devtmpfs', 'nsfs', 'ramfs', 'autofs', 'proc', 'sysfs',
]);

function parseMetrics(text) {
  const lines = text.split('\n');
  const out = {
    memTotal: 0,
    memAvailable: 0,
    diskTotal: 0,
    diskAvailable: 0,
    netRxBytes: 0,
    netTxBytes: 0,
    cpuIdleSeconds: 0,
    cpuTotalSeconds: 0,
  };
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, labels, value } = parsed;
    if (name === 'node_memory_MemTotal_bytes') out.memTotal = value;
    else if (name === 'node_memory_MemAvailable_bytes') out.memAvailable = value;
    else if (name === 'node_filesystem_size_bytes' && labels.mountpoint === '/' && !EXCLUDED_FSTYPES.has(labels.fstype)) {
      out.diskTotal = value;
    } else if (name === 'node_filesystem_avail_bytes' && labels.mountpoint === '/' && !EXCLUDED_FSTYPES.has(labels.fstype)) {
      out.diskAvailable = value;
    } else if (name === 'node_network_receive_bytes_total' && labels.device !== 'lo') {
      out.netRxBytes += value;
    } else if (name === 'node_network_transmit_bytes_total' && labels.device !== 'lo') {
      out.netTxBytes += value;
    } else if (name === 'node_cpu_seconds_total') {
      out.cpuTotalSeconds += value;
      if (labels.mode === 'idle') out.cpuIdleSeconds += value;
    }
  }
  return out;
}

function parseLine(line) {
  const match = line.match(/^([a-z_:][a-z0-9_:]*)(?:\{([^}]*)\})?\s+(.+)$/i);
  if (!match) return null;
  const [, name, labelsStr, valueStr] = match;
  const value = Number(valueStr);
  if (Number.isNaN(value)) return null;
  const labels = {};
  if (labelsStr) {
    for (const pair of labelsStr.matchAll(/([a-z_][a-z0-9_]*)="([^"]*)"/gi)) {
      labels[pair[1]] = pair[2];
    }
  }
  return { name, labels, value };
}

module.exports = { parseMetrics, parseLine };
