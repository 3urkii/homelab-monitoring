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

  // Home Assistant integration — powers the /lights and /chat pages.
  // Token: HA Profile → Long-lived Access Tokens → Create Token. Paste below.
  // /chat hits HA's /api/conversation/process which uses the same Assist pipeline
  // (and conversation agent, e.g. Ollama) as your voice assistant.
  // Optional: conversationAgentId pins a specific agent (e.g. an Ollama agent's
  //   entity id like "conversation.llama3"). Omit to use HA's default.
  // Optional: conversationLanguage defaults to "en".
  // homeAssistant: {
  //   url: "http://homeassistant.local:8123",
  //   token: "REPLACE_ME",
  //   conversationAgentId: undefined,
  //   conversationLanguage: "en",
  // },

  // Weather widget on the landing page. Powered by Open-Meteo (no API key).
  // Omit this block to hide the weather chip entirely. Coords don't need to be
  // exact — the nearest grid cell is used. unit defaults to "celsius".
  // weather: {
  //   latitude: 40.7128,
  //   longitude: -74.0060,
  //   label: "home",        // shown in the dropdown panel
  //   unit: "fahrenheit",   // "celsius" | "fahrenheit"
  // },

  // Plan Player Analytics integration — adds a Minecraft analytics page.
  // Set machine/guest to the VM or LXC running the Minecraft server.
  plan: {
    url: 'http://REPLACE_ME:8804',  // e.g. "http://10.0.20.87:8804"
    machine: 'REPLACE_ME',   // machines[].name of the Proxmox host
    guest: 'REPLACE_ME',     // guest name of the Minecraft VM/LXC
  },

  // Network tile on the landing page — clickable card that deep-links to the
  // UniFi mobile app on iOS/Android, falling back to the controller URL on desktop.
  // Omit this block to hide the network tile entirely.
  // network: {
  //   url: "https://192.168.1.1",  // UniFi controller / gateway URL
  //   label: "unifi controller",
  //   gateway: "192.168.1.1",      // shown on the tile
  // },

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
      // Dedicated-RAM guests: silence memory alerts (they're always near 100%)
      // { machine: "REPLACE_ME", guest: "REPLACE_ME_SURF",      memPct: 100 },
      // { machine: "REPLACE_ME", guest: "REPLACE_ME_MINECRAFT", memPct: 100 },
      // Mute all alerts (cpu/mem/disk/reachability) for guests you spin up on demand.
      // Any currently-firing alerts auto-resolve the next eval after `mute: true` is added.
      // { machine: "proxmox-internal", guest: "test-vm", mute: true },
      // Machine-level mute disables alerts for the host AND every guest on it:
      // { machine: "proxmox-dmz", mute: true },
    ],
  },
};
