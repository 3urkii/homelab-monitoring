const https = require('node:https');

function parseClusterResources(data, nodeName) {
  let host = null;
  const guests = [];
  for (const item of data) {
    if (item.type === 'node' && item.node === nodeName) {
      host = {
        cpuPct: (item.cpu ?? 0) * 100,
        memUsed: item.mem ?? 0,
        memTotal: item.maxmem ?? 0,
        diskUsed: item.disk ?? 0,
        diskTotal: item.maxdisk ?? 0,
        uptime: item.uptime ?? 0,
        loadavg: null,
        _cumulative: {
          netRxBytes: item.netin ?? 0,
          netTxBytes: item.netout ?? 0,
        },
      };
    } else if ((item.type === 'lxc' || item.type === 'qemu') && item.node === nodeName) {
      guests.push({
        vmid: item.vmid,
        name: item.name ?? `vm-${item.vmid}`,
        type: item.type,
        status: item.status ?? 'unknown',
        cpuPct: (item.cpu ?? 0) * 100,
        memUsed: item.mem ?? 0,
        memTotal: item.maxmem ?? 0,
        diskUsed: item.disk ?? 0,
        diskTotal: item.maxdisk ?? 0,
        uptime: item.uptime ?? 0,
      });
    }
  }
  if (!host) {
    throw new Error(`proxmox ${nodeName}: node not found in cluster/resources (check the config "name" field matches the PVE node hostname)`);
  }
  return { host, guests };
}

function parseNodeStatus(data) {
  return {
    loadavg: (data.loadavg ?? []).map(Number),
  };
}

function httpsRequest(options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`parse failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}

async function fetch(entry) {
  const commonOptions = {
    host: entry.host,
    port: entry.port ?? 8006,
    method: 'GET',
    headers: {
      Authorization: `PVEAPIToken=${entry.tokenId}=${entry.tokenSecret}`,
    },
    rejectUnauthorized: entry.rejectUnauthorized ?? false,
  };
  const timeoutMs = entry.proxmoxTimeoutMs ?? 5000;
  try {
    const [clusterRes, statusRes] = await Promise.all([
      httpsRequest({ ...commonOptions, path: '/api2/json/cluster/resources' }, timeoutMs),
      httpsRequest({ ...commonOptions, path: `/api2/json/nodes/${encodeURIComponent(entry.name)}/status` }, timeoutMs),
    ]);
    const { host, guests } = parseClusterResources(clusterRes.data, entry.name);
    const { loadavg } = parseNodeStatus(statusRes.data);
    host.loadavg = loadavg;
    return { host, guests };
  } catch (err) {
    if (err.message.startsWith('proxmox ')) throw err;
    throw new Error(`proxmox ${entry.name}: ${err.message}`);
  }
}

module.exports = { parseClusterResources, parseNodeStatus, fetch };
