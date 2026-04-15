function parseMetrics(text) {
  const lines = text.split('\n');
  const out = {
    memTotal: 0,
    memAvailable: 0,
  };
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, value } = parsed;
    if (name === 'node_memory_MemTotal_bytes') out.memTotal = value;
    else if (name === 'node_memory_MemAvailable_bytes') out.memAvailable = value;
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
