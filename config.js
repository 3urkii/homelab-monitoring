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
    },
    {
      name: "proxmox-internal",
      type: "proxmox",
      host: "REPLACE_ME",
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME",
      rejectUnauthorized: false,
    },
    {
      name: "nas",
      type: "node_exporter",
      host: "REPLACE_ME",
      port: 9100,
    },
  ],

  services: [
    { name: "Proxmox DMZ",      machine: "proxmox-dmz",      url: "https://REPLACE_ME:8006",     icon: "proxmox-light.svg"      },
    { name: "Mealie",           machine: "proxmox-dmz",      url: "http://REPLACE_ME:9000",      icon: "mealie-light.svg"       },
    { name: "Proxmox Internal", machine: "proxmox-internal", url: "https://REPLACE_ME:8006",     icon: "proxmox-light.svg"      },
    { name: "Plex",             machine: "proxmox-internal", url: "http://REPLACE_ME:32400/web", icon: "plex-light.svg"         },
    { name: "netboot.xyz",      machine: "proxmox-internal", url: "http://REPLACE_ME:8080",      icon: "netboot.svg"            },
    { name: "Dashboard",        machine: "proxmox-internal", url: "http://REPLACE_ME:3000",      icon: "dashboard.svg"          },
    { name: "TrueNAS",          machine: "nas",              url: "http://REPLACE_ME",           icon: "truenas-core-light.svg" },
  ],
};
