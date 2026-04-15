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

module.exports = { parseClusterResources };
