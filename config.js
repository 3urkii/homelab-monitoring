module.exports = {
  server: {
    port: 3000,
    pollIntervalMs: 10_000,
    serviceTimeoutMs: 2_000,
    proxmoxTimeoutMs: 5_000,
    nodeExporterTimeoutMs: 5_000,
  },

  machines: [
    {
      name: "proxmox-dmz",
      type: "proxmox",
      host: "REPLACE_ME",        // e.g. "10.0.20.10"
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME", // paste from PVE UI
      rejectUnauthorized: false,
      primaryUrl: "https://REPLACE_ME:8006", // click the card name to open the PVE web UI
    },
    {
      name: "proxmox-internal",
      type: "proxmox",
      host: "REPLACE_ME",
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME",
      rejectUnauthorized: false,
      primaryUrl: "https://REPLACE_ME:8006",
    },
    {
      name: "nas",
      type: "node_exporter",
      host: "REPLACE_ME",
      port: 9100,
      primaryUrl: "http://REPLACE_ME", // TrueNAS web UI
    },
  ],

  // Each service shows on its host machine card.
  // Optional `guest`: set to the LXC/VM name to render as a launcher on that guest's row.
  //                   omit to render as a compact chip in the machine card header.
  services: [
    { name: "Mealie",      machine: "proxmox-dmz",      url: "http://REPLACE_ME:9000",      icon: "mealie-light.svg" /*, guest: "mealie-lxc" */ },
    { name: "Plex",        machine: "proxmox-internal", url: "http://REPLACE_ME:32400/web", icon: "plex-light.svg"   /*, guest: "plex-lxc"   */ },
    { name: "netboot.xyz", machine: "proxmox-internal", url: "http://REPLACE_ME:8080",      icon: "netboot.svg" },
    { name: "Dashboard",   machine: "proxmox-internal", url: "http://REPLACE_ME:3000",      icon: "dashboard.svg"    /*, guest: "dashboard"  */ },
  ],
};
