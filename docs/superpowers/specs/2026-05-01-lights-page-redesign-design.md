# Lights page redesign — design spec

Date: 2026-05-01
Scope: `public/lights.html` (frontend only — server APIs unchanged)

## Goal

Replace the current list-style lights page with a room-card grid optimized for the dominant interaction pattern: room-level on/off and scene activation in one tap, per-light fiddling tucked one tap deeper.

## Why redesign

Current `lights.html` problems:
- Pure top-to-bottom list of `<details>` rooms — long scroll, no spatial metaphor
- Master "all lights" controls + per-light list both visible — duplicates the same controls
- Scenes buried under per-light scroll — slowest path despite being the second-most-used action
- Color picker is a 36×36 swatch hiding native `<input type="color">` — generic, no quick palette
- No "ALL OFF" affordance for leaving home / going to bed
- Mobile: cramped, labels collapse, long rooms become endless scroll

Server work (`/api/lights/stream`, `POST /api/lights/:id`, `POST /api/scenes/:id/activate`) stays as-is. This is a frontend reshape.

## Architecture

Single-page progressive disclosure:

1. **Overview grid** — every room rendered as a glow card. Always visible. Two states per card: on (color-tinted glow) / off (flat).
2. **Room sheet** — bottom sheet (mobile) / right drawer (desktop) opens on room-name tap. Per-light controls, color picker, full scene list. Closes via ✕, Escape, or backdrop tap.

State is driven by the existing SSE snapshot/state events. No new server endpoints.

## Page structure

```
<header>
  back-link · [burkii.home] / lights · counts · ALL OFF · conn-status
<main>
  <div id="rooms" class="room-grid">
    <article class="room-card" data-room-id>
      <button class="power-orb">⏻</button>
      <div class="room-name">
      <div class="room-meta">
      <div class="scene-strip">  // top 3 scenes inline
        <button class="scene-chip" data-scene-id>
  </div>
<dialog class="room-sheet">  // hidden until tap
  <header>
  <div class="all-controls">  // master brightness + master color
  <ul class="light-list">     // per-light rows
  <div class="scene-list">    // all scenes
```

Use `<dialog>` for the sheet — built-in backdrop, Escape-to-close, focus trap.

## Components

### Header
- Back link, page title (matches existing `[burkii.home] / lights` treatment)
- **Aggregate count** — `N on / M total` in muted text
- **ALL OFF** button (red border, terminal style) — turns off every reachable light in one fetch loop
- **Connection chip** — preserved from current implementation

### Room card (glow card direction A)
- **Power orb** (44×44, top-left) — circular button. Green glow + ⏻ icon when any light on; gray border + dim icon when all off. Tap = toggle every reachable light in the room.
- **Room name** — Rajdhani uppercase, tap opens sheet
- **Meta line** — `2 of 3 on · 65%` when on; `all off` when off
- **Glow background** — `radial-gradient` from top-left tinted by the dominant on-light's color (or warm white if no color bulbs are on). When all off: flat surface, no glow.
- **Scene strip** (bottom of card) — first 3 scene chips. Active scene highlighted cyan. If more than 3 exist, show `+N`. Tap chip = activate scene. Tap `+N` = open sheet.
- **No per-light visible** — saved for the sheet.

Card grid:
- Desktop: `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`
- Phone: `repeat(2, 1fr)` below 600px, single column below 380px
- Card height fixed enough that all cards align (`min-height: 160px`)

### Room sheet
- Mobile: `<dialog>` styled as bottom sheet (slides up, ~85vh max)
- Desktop: same `<dialog>` styled as right-side drawer (~420px wide)
- Backdrop dim via `::backdrop`
- Header inside sheet: power orb, room name, meta, ✕ close button
- **All-lights row**: ALL label, master brightness slider, brightness %, master color swatch (if room has any color bulbs)
- **Light list**: one row per light
- **Scene list** (separator above): full set of scenes, active one highlighted

### Light row
- Status dot (8px) — green w/ glow if on, gray if off, **red if unreachable**
- Light name (monospace)
- Brightness slider (or empty space if unreachable / off-only state)
- Brightness % or `off` / `—`
- Color swatch (hidden if `supports_color === false`)
- Unreachable rows: opacity 0.45, controls disabled, `UNREACHABLE` badge in orange

### Color picker (popover)
Tap a swatch → small popover anchored to the swatch:
- 8 quick presets: red, orange, yellow, green, cyan, purple, pink, white (Dracula palette)
- **Warmth slider** — gradient from warm-orange to cool-blue (drives `color_temp` if bulb supports it; else maps to RGB approximation)
- **Custom**: native `<input type="color">` for fine control

For tunable-white-only bulbs, show only the warmth slider. For RGB bulbs, all three sections.

### Scene chip
- Border, cyan text, monospace, uppercase
- Active state: cyan border + faint cyan background
- Tap = `POST /api/scenes/:id/activate`
- Active-scene tracking: not currently exposed by the server. **Out of scope for this redesign** — show no active state until the server side adds it. (Note in plan: investigate `STATE`-event sniffing on `scene.*` entities as a follow-up.)

## Interaction model

| Action | Result |
|---|---|
| Tap power orb | Toggle every reachable light in room (`on` flips for all). Optimistic UI. |
| Tap scene chip on card | Activate scene. No sheet opened. |
| Tap room name / `+N` | Open room sheet. |
| Tap ALL OFF in header | Loop `POST /api/lights/:id { on: false }` for every reachable on-light. Confirm? **No** — fast undo by tapping any orb back on. |
| Drag slider in sheet | Optimistic %, debounced 200ms post (preserved from current impl). |
| Tap swatch in sheet | Open color popover. Choose preset / drag warmth / pick custom → close popover, post `rgb_color`. |
| Tap ✕, Escape, backdrop | Close sheet. |

## Visual language

Reuse existing tokens from `lights.html` / `index.html`:
- Dracula palette (`--bg`, `--surface`, `--current-line`, `--purple`, `--pink`, `--cyan`, `--green`, `--orange`, `--red`, `--comment`, `--fg`)
- JetBrains Mono for data, Rajdhani for headings/room names
- Scanline overlay (`body::after`) preserved
- Bracket/dot-prefix headings preserved (`[burkii.home] / lights`, `> ROOMS`)
- Card border-radius: 8px (slightly softer than current 4px to read as "tile")

New touch:
- **Glow gradient** on active room cards — `radial-gradient(circle at 30% 30%, rgba(R,G,B,0.22), transparent 60%)` over `--surface`. Color sourced from first on-light's `rgb`, falling back to `--orange` (warm white).
- **Power orb glow** — green box-shadow when on, none when off
- Subtle entry animation on card mount (mirroring tile entry on index.html)

## Edge cases

- **No rooms** → preserve existing `<div class="empty">no lights discovered</div>`
- **Unassigned bucket** → still rendered, named "Unassigned", same card treatment
- **Room with only scenes, no lights** → card shows scene strip + "no lights" meta, power orb hidden
- **Room with no scenes** → scene strip omitted on card; in sheet, scene section shows "no scenes defined for this room"
- **Connection lost** → existing red error banner preserved at top of `<main>`; cards become slightly dimmed but still rendered (last-known state)
- **Bulb unreachable** → red dot + UNREACHABLE badge in sheet; on card, doesn't count toward "on" total but isn't called out (would clutter the card)

## Out of scope

- **Active scene detection** — server doesn't expose it; chip "active" state will appear only after a follow-up phase.
- **Reordering rooms** — alphabetical stays for now.
- **Light grouping inside a room** — flat list per room.
- **Schedules / automations** — separate feature.
- **Server changes** — none. APIs and SSE stream stay identical.

## Success criteria

- Toggling a room takes one tap
- Activating a known scene takes one tap (when scene is in top 3)
- Per-light brightness/color reachable in two taps (open sheet → drag/tap)
- Layout works at 320px (phone) through 1400px (desktop) without horizontal scroll
- All controls reachable by keyboard (sheet uses native `<dialog>` for built-in focus trap + Escape)
- No regression in existing SSE reconnect/optimistic-update behaviour
