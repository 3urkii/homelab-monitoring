# TV remote

Date: 2026-05-27
Status: Approved

## Context

Dashboard exposes Home Assistant control today through `/lights` and `/chat`. No TV control surface exists. User wants a quick-access TV remote reachable from the top bar — power, volume, and one-tap shortcuts to Plex plus three HDMI inputs.

TV is already in HA across two `media_player` entities:

- `media_player.da_tele_2` — Android/Google TV controller. Handles power and app launching (Plex via `select_source` "Plex").
- `media_player.vizio_tv_2545_television` — Vizio panel. Handles volume (up/down/mute) and HDMI input switching via `select_source` ("scenescapes", "win-pc", "Nintendo Switch").

Dashboard's only outbound integration is HA (`HAClient.callService` REST + WebSocket state subscription). No new external dependency.

## Goals

- TV icon in top bar of landing + `/lights` pages. Hidden if `config.tv` absent.
- Click opens centered `<dialog>` remote: power orb, vol −/mute/+, 2×2 shortcut grid (plex, scenes, pc, switch).
- Live state from HA via SSE — power button reflects on/off, mute button reflects muted, active source highlighted.
- Match existing app vocabulary: JetBrains Mono + Rajdhani, dracula/catppuccin CSS vars, `--current-line` borders, `--ease-out` transitions, lowercase labels.

## Non-goals

- Channel/number pad, transport controls (play/pause/skip), keyboard input.
- Per-app launching beyond Plex.
- Remote-on-every-page (only landing + lights for now).
- Auth/permission model (dashboard ships open on LAN; TV remote inherits same trust as `/lights`).

## Configuration

Add optional `tv` block to `config.js`. Absent block = feature disabled, icon hidden, routes not mounted.

```js
tv: {
  powerEntity:  "media_player.da_tele_2",
  volumeEntity: "media_player.vizio_tv_2545_television",
  shortcuts: [
    { id: "plex",   label: "plex",   icon: "plex.svg",   entity: "media_player.da_tele_2",                source: "Plex" },
    { id: "scenes", label: "scenes", icon: "scenes.svg", entity: "media_player.vizio_tv_2545_television", source: "scenescapes" },
    { id: "pc",     label: "pc",     icon: "pc.svg",     entity: "media_player.vizio_tv_2545_television", source: "win-pc" },
    { id: "switch", label: "switch", icon: "switch.svg", entity: "media_player.vizio_tv_2545_television", source: "Nintendo Switch" },
  ],
}
```

`config.example.js`: ship commented block above with `REPLACE_ME` placeholders, mirroring `homeAssistant` / `network` pattern.

### Validation (in `validateConfig`, `server.js`)

- `tv` must be object if present.
- `powerEntity`, `volumeEntity`: non-empty strings starting with `media_player.`.
- `shortcuts`: non-empty array.
- Each shortcut: `id` (non-empty string, unique within array), `label` (non-empty string), `entity` (starts with `media_player.`), `source` (non-empty string). `icon` optional.
- If `config.homeAssistant` absent, `tv` block triggers validation error: "tv requires homeAssistant".

## Backend

### `lib/home_assistant.js`

Widen state cache from lights+scenes only to also include configured media_players.

- Constructor accepts optional `trackedMediaPlayers: Set<string>`.
- Replace `isLightOrScene(entity_id)` with `isTracked(entity_id, trackedMediaPlayers)`:
  ```
  domain === 'light' || domain === 'scene' || (domain === 'media_player' && trackedMediaPlayers.has(entity_id))
  ```
  Update all 4 call sites (`#bootstrap` filter, `#onEvent` filter, event emit branch).
- Add `parseMediaPlayerState(state)`:
  ```
  { entity_id, state, on: state === 'on' || state === 'playing' || state === 'paused',
    source: attrs.source || null, source_list: attrs.source_list || [],
    volume_level: attrs.volume_level ?? null, is_volume_muted: !!attrs.is_volume_muted,
    name: attrs.friendly_name || entity_id }
  ```
- Add `getMediaPlayerState(entity_id)`: returns parsed state or `null` if entity absent from cache.
- `#onEvent` for media_player state_changed emits `media-state` event: `{ entity_id, state: parsed }`. Lights/scenes keep existing `state` event channel — no breaking change.

Export `parseMediaPlayerState` alongside existing parsers.

### `server.js`

Compute `trackedMediaPlayers` set from `config.tv` (powerEntity + volumeEntity + every `shortcut.entity`) and pass to `HAClient` constructor. If `config.tv` absent, pass empty set / undefined.

Mount the following only when `config.tv` is set:

#### `GET /api/tv`

Returns current snapshot. 503 if HA disconnected.

Response:
```json
{
  "connected": true,
  "power": { "entity_id": "media_player.da_tele_2", "on": true, "source": "Plex" },
  "volume": { "entity_id": "media_player.vizio_tv_2545_television", "muted": false, "level": 0.32, "source": "scenescapes" },
  "shortcuts": [
    { "id": "plex", "label": "plex", "icon": "plex.svg", "active": true },
    { "id": "scenes", "label": "scenes", "icon": "scenes.svg", "active": false },
    ...
  ]
}
```

`active` computed server-side: for each shortcut, look up cached `source` on that shortcut's entity; mark active if string match.

#### `POST /api/tv/power`

Body `{ on?: boolean }`. If `on === true`, call `media_player.turn_on` on `powerEntity`. If `on === false`, `turn_off`. If `on` absent/null, toggle based on cached state (default to `turn_on` if state unknown). Unknown fields → 400.

#### `POST /api/tv/volume`

Body `{ action: "up" | "down" | "mute" }`. Strict allowlist; unknown action → 400.

- `up` → `media_player.volume_up` on `volumeEntity`
- `down` → `media_player.volume_down` on `volumeEntity`
- `mute` → `media_player.volume_mute` on `volumeEntity` with `is_volume_muted: !cached.is_volume_muted` (default to `true` if state unknown)

#### `POST /api/tv/source`

Body `{ id: string }`. Resolve `id` against `config.tv.shortcuts`. Unknown id → 400. Call `media_player.select_source` on the shortcut's `entity` with `source` from config. Client never sends raw entity_ids or source strings.

#### `GET /api/tv/stream`

SSE endpoint. New `SseBroker` instance dedicated to TV (separate from `haBroker` used by `/api/lights/stream` — keeps streams single-purpose).

- On client connect: emit `snapshot` event with same payload as `GET /api/tv`. If HA offline, emit `offline { connected: false }`.
- On HA `media-state` event for any tracked media_player: rebuild and broadcast `snapshot` (cheap, ≤4 entities). Simpler than diff events; consumer always replaces local state.
- On HA disconnect: broadcast `offline { connected: false }`.

#### `/api/landing-config`

Extend response with `tv` field when `config.tv` set:
```json
"tv": {
  "available": true,
  "shortcuts": [
    { "id": "plex", "label": "plex", "icon": "plex.svg" },
    ...
  ]
}
```
Entity IDs and source strings stay server-side. Client only learns id/label/icon for rendering.

### Security model

Same trust boundary as existing `/api/lights/:entity_id`:

- Client supplies a small allowlist of action verbs (`up`/`down`/`mute`, `on?: boolean`) and shortcut ids.
- Server resolves verbs/ids to fixed entity+service pairs from config.
- No path lets the client choose an arbitrary entity_id or service.

## Frontend

### Top-bar icon

New chip injected into `.header-chrome` on `index.html` and `lights.html`, sitting next to the weather chip.

```html
<button class="tv-chip" id="tvChip" type="button" aria-haspopup="dialog"
        aria-expanded="false" aria-controls="tvRemote" hidden>
  <span class="tv-icon" aria-hidden="true"><!-- inline 16px SVG, currentColor --></span>
  <span class="sr-only">tv remote</span>
</button>
```

- Styled in `theme.css` adjacent to `.weather-chip`. Same border, padding, hover transitions.
- Color states: `var(--comment)` at rest, `var(--pink)` on hover / `aria-expanded="true"`, `var(--green)` when TV is on (data attribute `data-tv-on="true"`).
- Hidden until `/api/landing-config` returns `tv.available === true`.

### Remote sheet

New `<dialog>` markup, same anchor pattern as `roomSheet` in `lights.html`. Mounted once on each host page (index.html, lights.html).

```html
<dialog class="tv-remote-sheet" id="tvRemote" aria-label="tv remote">
  <div class="sheet-glow" aria-hidden="true"></div>
  <div class="sheet-inner">
    <div class="sheet-head">
      <span class="sheet-section-label"><span class="accent">&gt;</span>tv remote</span>
      <button class="sheet-close" data-tv-close aria-label="close">×</button>
    </div>
    <div class="tv-status" data-tv-status hidden></div>

    <button class="tv-power" data-tv-power aria-pressed="false">
      <span class="tv-power-glyph">⏻</span>
    </button>
    <div class="tv-power-label" data-tv-power-label>—</div>

    <div class="tv-volume-row">
      <button class="tv-vol-btn" data-tv-vol="down" aria-label="volume down">−</button>
      <button class="tv-vol-btn tv-vol-mute" data-tv-vol="mute" aria-pressed="false" aria-label="mute">
        <span class="tv-mute-glyph"></span>
      </button>
      <button class="tv-vol-btn" data-tv-vol="up" aria-label="volume up">+</button>
    </div>

    <div class="sheet-section-label"><span class="accent">&gt;</span>shortcuts</div>
    <div class="tv-shortcut-grid" data-tv-shortcuts>
      <!-- buttons rendered client-side from /api/landing-config -->
    </div>
  </div>
</dialog>
```

Shortcut order in the 2×2 grid matches the order of `config.tv.shortcuts` (top-left → top-right → bottom-left → bottom-right). With the sample config that yields: plex, scenes, pc, switch.

Shortcut button template:
```html
<button class="tv-shortcut" data-tv-shortcut="<id>" aria-current="false">
  <span class="tv-shortcut-icon"><!-- <img src="/icons/<icon>" if present, else empty --></span>
  <span class="tv-shortcut-label"><label></span>
</button>
```

### Styling rules (theme.css)

All new styles use existing tokens. No hardcoded colors.

- `.tv-chip`: clone `.weather-chip` sizing/border/hover. Width fits 16px icon + chrome padding.
- `.tv-remote-sheet`: clone `.room-sheet` (centered `<dialog>`, `::backdrop` blur, `sheet-glow`, max-width sized for remote, not room). Width target: ~320px desktop, 92vw mobile via existing `room-sheet` media query.
- `.tv-power`: 72px circular button, `border: 1px solid var(--current-line)`. Off: glyph color `var(--comment)`. On (`aria-pressed="true"`): glyph color `var(--green)`, border `var(--green)`, soft `box-shadow: 0 0 12px rgba(var(--green-rgb), 0.35)`. `transition: 200ms var(--ease-out)`. Active scale 0.96.
- `.tv-power-label`: `color: var(--comment)`, JetBrains Mono 0.72rem, centered. Shows "tv is on" / "tv is off" / "—" (when unknown).
- `.tv-volume-row`: 3-col grid, gap 0.5rem. Each `.tv-vol-btn`: 56px square, `border: 1px solid var(--current-line)`, glyph color `var(--fg)`. Hover (where `(hover: hover)`): `border-color: var(--purple)`, `background: rgba(var(--purple-rgb), 0.06)`. Active scale 0.95. Mute button when `aria-pressed="true"`: `color: var(--pink)`, `border-color: var(--pink)`.
- `.tv-shortcut-grid`: `grid-template-columns: repeat(2, 1fr)`, gap 0.6rem.
- `.tv-shortcut`: 2-row flex-col, icon 28px above label. `border: 1px solid var(--current-line)`. Hover: pink accent. Active source (`aria-current="true"`): `border-color: var(--pink)`, `box-shadow: 0 0 10px rgba(var(--pink-rgb), 0.25)`, label color `var(--pink)`.
- `.tv-status`: thin strip under header, color `var(--red)`, JetBrains Mono 0.72rem, shows "home assistant offline" when streaming offline.
- All transitions `200ms var(--ease-out)` to match existing buttons. Respect `@media (prefers-reduced-motion: reduce)`: drop glow box-shadow and scale transforms.

### Client logic

Single small module (inline `<script>` in each host page, or shared `public/tv.js`). Recommendation: extract `public/tv.js` since both index.html and lights.html will need it — avoids duplication.

```
public/tv.js exports nothing; auto-inits on DOMContentLoaded if #tvChip exists.
```

Flow:

1. On load: fetch `/api/landing-config`. If `tv.available`, render shortcut buttons into `[data-tv-shortcuts]` from config-supplied list (id/label/icon), then unhide `#tvChip`.
2. On chip click: open `<dialog>` via `showModal()`. Fetch `/api/tv` once and paint initial state. Open `EventSource('/api/tv/stream')`. On dialog close (Esc, backdrop click, ×): close EventSource.
3. SSE `snapshot` event → replace local state, repaint power/volume/shortcuts.
4. SSE `offline` event → show `.tv-status` strip "home assistant offline", set all buttons to `disabled`.
5. Button clicks → corresponding POST. Buttons set `aria-busy="true"` while in flight (CSS dims them). On 502/503: brief shake animation on the clicked button via a one-shot CSS class (`.tv-err`, 400ms keyframe), then revert. Don't optimistically flip state — wait for SSE.
6. Power button toggle: send `POST /api/tv/power` with `{ on: !currentState.power.on }` (server also handles toggle if `on` omitted, but explicit is cleaner).

### Icon assets

Four new SVGs in `public/icons/`:

- `plex.svg` — Plex chevron mark, single path, `fill: currentColor`.
- `scenes.svg` — abstract landscape (mountain triangles + sun), single path.
- `pc.svg` — desktop tower silhouette.
- `switch.svg` — Joy-Con silhouette (two rounded rectangles + center band).

All 24×24 viewBox, currentColor, no embedded fill colors. Sized 28px in the shortcut button.

Existing `icons/` directory already hosts brand-style SVGs (`mealie-light.svg`, `plex-light.svg`); these new ones live alongside but use the simpler monochrome-currentColor convention so they tint correctly under theme switches.

## Error & edge handling

- **Config absent:** `/api/landing-config` returns no `tv` field. `.tv-chip` stays hidden. `/api/tv/*` routes not mounted.
- **HA offline at request time:** `/api/tv` returns 503 `{ error: "home assistant offline" }`. Each `POST /api/tv/*` returns 503 before attempting service call. Frontend shows offline strip, disables buttons.
- **HA drops mid-session:** SSE broker emits `offline` event. Sheet shows offline strip, buttons disable. On HA reconnect, broker re-broadcasts `snapshot`.
- **Stale state on toggle:** Power toggle reads last cached state; if unknown, default to `turn_on` (the action user most likely wants when reaching for the remote on a dark TV).
- **HA rejects select_source:** 502 bubbles to client, shortcut button gets `.tv-err` shake class for 400ms. Active highlight does not flip until SSE confirms.
- **Concurrent calls:** No debounce. HA tolerates rapid `volume_up` calls; user expects them.
- **Reduced motion:** `prefers-reduced-motion: reduce` disables power-orb glow animation, button scale transforms, and `.tv-err` shake (still shows error via temporary border color).
- **Keyboard:** Native `<dialog>` provides Esc-to-close + focus trap. Chip is focusable. Power button gets `aria-pressed`. Mute button gets `aria-pressed`. Active shortcut gets `aria-current="true"`.
- **Mobile:** Sheet inherits `room-sheet` mobile sizing. Shortcut grid stays 2-wide (44px+ touch targets via 56px button height).

## Testing

Repo's `test/` directory is sparse — keep proportional.

### Unit (`test/`)

- `parseMediaPlayerState`: on/off/playing states, missing attrs, source/source_list shape, mute/level edge cases.
- Shortcut-id resolver helper (the small fn each POST handler shares for id → {entity, source} lookup): unknown id → throws, duplicate id (caught at validation, but defensive), happy path.
- Config validation: missing powerEntity, non-`media_player.` prefix, empty shortcuts, duplicate shortcut ids, missing icon (allowed).

### Manual smoke checklist

- [ ] Chip appears on landing + `/lights` when `tv:` block configured.
- [ ] Chip stays hidden when `tv:` removed from `config.js`.
- [ ] Sheet opens via click; closes via Esc, backdrop, ×.
- [ ] Power button reflects TV state (on/off) from HA logbook.
- [ ] Power toggle reaches `media_player.da_tele_2` (verify in HA logbook).
- [ ] Vol −/+/mute reaches `media_player.vizio_tv_2545_television` (verify in HA logbook).
- [ ] Each shortcut reaches the right entity with the right source string.
- [ ] Active source highlights in shortcut grid as TV input changes (use TV remote to change input, observe sheet update via SSE).
- [ ] Restart HA server while sheet open — offline strip appears, buttons disable, then snapshot returns on reconnect.
- [ ] Reduced-motion: glow + transforms removed.

### Out of scope

- No Playwright/browser-driver tests (project doesn't use them; adding a dependency for one feature is disproportionate).
- No load testing of SSE (≤4 tracked entities, polling-rate dominated by HA WebSocket cadence).

## File touch list

- `config.example.js` — add commented `tv:` block.
- `lib/home_assistant.js` — broaden state tracking, add `parseMediaPlayerState`, add `media-state` event channel.
- `server.js` — validation, route mounting (`/api/tv`, `/api/tv/power`, `/api/tv/volume`, `/api/tv/source`, `/api/tv/stream`), `/api/landing-config` extension, second `SseBroker` instance.
- `public/index.html` — `.tv-chip` markup, `<dialog id="tvRemote">` markup, `<script src="/tv.js" defer>`.
- `public/lights.html` — same `.tv-chip` + dialog markup, same script include.
- `public/tv.js` — new file. Init, fetch landing-config, open/close sheet, EventSource subscription, button handlers, render.
- `public/theme.css` — `.tv-chip`, `.tv-remote-sheet`, `.tv-power`, `.tv-volume-row`, `.tv-shortcut-grid`, `.tv-shortcut`, `.tv-status`, `.tv-err` styles.
- `public/icons/plex.svg`, `scenes.svg`, `pc.svg`, `switch.svg` — new.
- `test/home_assistant.test.js` — extend with `parseMediaPlayerState` cases.
- `test/tv.test.js` — new file for shortcut-id resolver + `tv` config validation cases.
- `README.md` — short note under HA integration: TV remote requires `tv` block.

## Open questions

None at design-approval time.
