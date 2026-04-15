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
      // `name` MUST be the actual Proxmox node hostname (used in API paths + /cluster/resources filtering).
      // `label` is optional — a friendlier display name for the dashboard card and ntfy titles. Defaults to `name`.
      name: "REPLACE_ME",        // e.g. "pve01" — the PVE node hostname
      label: "proxmox-dmz",      // e.g. "proxmox-dmz" — shown on the card
      type: "proxmox",
      host: "REPLACE_ME",        // e.g. "10.0.20.10"
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME", // paste from PVE UI
      rejectUnauthorized: false,
      primaryUrl: "https://REPLACE_ME:8006", // click the card name to open the PVE web UI
    },
    {
      name: "REPLACE_ME",
      label: "proxmox-internal",
      type: "proxmox",
      host: "REPLACE_ME",
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME",
      rejectUnauthorized: false,
      primaryUrl: "https://REPLACE_ME:8006",
    },
  ],

  // Overlay clickable metadata onto auto-discovered guests. Each entry attaches a URL,
  // icon, and display label to a guest by (machine, guest name). Matched guests become
  // clickable rows in the UI that open the URL in a new tab.
  guestLinks: [
    // { machine: "proxmox-dmz",      guest: "mealie-lxc", url: "http://REPLACE_ME:9000",      icon: "mealie-light.svg" },
    // { machine: "proxmox-internal", guest: "plex-lxc",   url: "http://REPLACE_ME:32400/web", icon: "plex-light.svg"   },
    // { machine: "proxmox-internal", guest: "dashboard",  url: "http://REPLACE_ME:3000",      icon: "dashboard.svg"    },
  ],

  // Alerting via ntfy. Remove this block (or leave it out) to disable alerts.
  // ntfy topics are their own auth — keep the URL private.
  alerts: {
    ntfy: {
      url: "https://ntfy.sh/REPLACE_ME",
      firingPriority: "high",
      resolvedPriority: "default",
      firingTags: ["warning"],
      resolvedTags: ["white_check_mark"],
    },
    defaults: {
      cpuPct: 90,
      memPct: 90,
      diskPct: 90,
      forMs: 5 * 60 * 1000,
      reachability: true,
    },
    overrides: [
      // { machine: "proxmox-internal", guest: "plex-lxc", cpuPct: 95 },
    ],
  },
};
