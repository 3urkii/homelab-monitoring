# mc-log-agent

A tiny zero-dependency log tail agent for the homelab dashboard's Minecraft
live-log view. It runs **on the Minecraft host**, tails `logs/latest.log`
(surviving log4j's daily rotation and truncation), keeps a ring buffer of
recent lines, and serves them over HTTP:

| Endpoint | Returns |
|---|---|
| `GET /recent?lines=N` | `{ file, lines }` — last N buffered lines (default 200) |
| `GET /stream` | SSE stream — `line` events with `{ts, line}` |
| `GET /healthz` | `{ ok, file, size, clients }` |

The dashboard connects once to `/stream` and fans lines out to any number of
browser tabs, so the Minecraft host only ever sees a single client.

## Install (on the Minecraft host)

Requires Node.js >= 18 (any version with `node:http`; no npm install needed).

```sh
# from the dashboard repo
scp tools/mc-log-agent/mc-log-agent.js tools/mc-log-agent/mc-log-agent.service mc-host:/tmp/

# on the Minecraft host
sudo mkdir -p /opt/mc-log-agent
sudo mv /tmp/mc-log-agent.js /opt/mc-log-agent/
sudo mv /tmp/mc-log-agent.service /etc/systemd/system/
```

Edit `/etc/systemd/system/mc-log-agent.service`:

- `User=`/`Group=` — the user that runs the Minecraft server (must be able to
  read `latest.log`)
- `Environment=MC_LOG_FILE=` — absolute path to your server's
  `logs/latest.log`

Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now mc-log-agent
curl http://localhost:8127/healthz
```

Finally point the dashboard at it in `config.js`:

```js
minecraft: {
  // ...
  logAgent: { url: "http://<mc-host>:8127" },
},
```

## Configuration

All via environment variables (set in the systemd unit):

| Variable | Default | Meaning |
|---|---|---|
| `MC_LOG_FILE` | — (required) | Path to `latest.log` |
| `MC_LOG_PORT` | `8127` | Listen port |
| `MC_LOG_BIND` | `0.0.0.0` | Bind address |
| `MC_LOG_MAX_LINES` | `2000` | Ring buffer size |

## Security

The agent has **no authentication** (same trusted-LAN model as the dashboard)
and Minecraft log lines include player IP addresses on join. Firewall the
agent port so only the dashboard host can reach it, e.g.:

```sh
sudo ufw allow from <dashboard-host-ip> to any port 8127 proto tcp
```
