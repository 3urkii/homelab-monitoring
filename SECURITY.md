# Security

This dashboard is designed for **trusted LAN use only**. It has no built-in
authentication, authorization, or rate limiting. Treat it as you would a
plaintext admin panel.

## Threat model

- **Assumed safe**: every client that can reach `:3000` on the host running
  this server. Anyone on that network can read live Proxmox metrics, Home
  Assistant entity state, and (if `chat`/`lights` are configured) drive HA
  actions through the bundled Assist proxy.
- **Not assumed safe**: anything beyond the LAN. Do **not** expose port 3000
  to the public internet, a guest VLAN you don't trust, or a Tailscale/WG
  network with untrusted peers — full stop, or only behind a reverse proxy
  that adds authentication.

## What the server exposes if reachable

- `GET /api/stats` — live Proxmox/node-exporter metrics for every configured
  host and guest (CPU/mem/disk/net, hostnames, guest names).
- `GET /api/history` — historical samples backing the charts.
- `GET /api/alerts*` — alert event log and currently firing alerts.
- `GET /api/lights` + `POST /api/lights/:entity_id` — read state and toggle
  any HA light entity reachable to the long-lived token.
- `POST /api/scenes/:entity_id/activate` — activate any HA scene.
- `POST /api/chat` — proxies free-text into HA's `/api/conversation/process`.
  This runs through your full Assist pipeline (including any LLM agent you've
  wired up). Anyone who can reach `/api/chat` can issue commands as if they
  were the configured token.
- `GET /api/plan/*` — proxies to your Plan Player Analytics instance.
- `GET /api/weather` — proxies Open-Meteo (public, no auth).

## Hardening checklist

1. **Bind to localhost** if you only access the dashboard via reverse proxy:
   change `app.listen(config.server.port, ...)` in `server.js` to
   `app.listen(config.server.port, '127.0.0.1', ...)`.
2. **Put it behind a reverse proxy** (Caddy, Nginx, Traefik) with HTTP basic
   auth, OAuth2 proxy, Authelia, or your SSO of choice if you want to reach
   it from outside the LAN.
3. **Use a read-only Proxmox token** with the `PVEAuditor` role only — the
   README setup already does this. Never give the dashboard a token that can
   write.
4. **Scope the HA long-lived token** to a dedicated HA user with permissions
   limited to the entities you actually want exposed (HA per-user entity
   filtering or a bespoke `homeassistant` user with restricted areas).
5. **Keep `config.js` out of git**. It's tracked as a placeholder template.
   If you fork this repo, either commit your filled-in config to a private
   repo, or move it to `config.local.js` (already in `.gitignore`) and
   `require('./config.local.js')` from `server.js`.
6. **Don't expose ntfy URLs publicly**. ntfy topics are unauthenticated by
   default — knowing the URL is enough to read or post alerts. Use ntfy ACLs
   or a self-hosted ntfy with auth if the topic is sensitive.
7. **TLS to Proxmox is unverified** by default (`rejectUnauthorized: false`)
   to support self-signed PVE certs. Set it to `true` and pin a CA if you've
   deployed proper certs.

## Reporting a vulnerability

This is a personal homelab project, not a commercial product. If you find a
security issue, open a GitHub issue or DM the maintainer.
