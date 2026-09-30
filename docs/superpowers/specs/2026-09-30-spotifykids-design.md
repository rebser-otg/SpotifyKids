# SpotifyKids — Design

Date: 2026-09-30
Status: approved in conversation, pending written-spec review

## Purpose

A kid-friendly web player for Spotify radio plays / audiobooks. Kids use it
themselves on a laptop. Its defining feature: **an album behaves like one
long track** — one continuous timeline with elapsed and remaining time across
all tracks; track boundaries are invisible to the user.

## Constraints (verified 2026-09-30)

- Playback via the **Spotify Web Playback SDK** → desktop Chrome, Firefox,
  Edge only. iOS browsers lack Widevine; Android mobile is unsupported.
  Tablets are out of scope (possible later extension: control the Spotify app
  via Connect).
- **Spotify Premium** required for the account that plays. The app owner
  needs Premium for Development Mode.
- **Development Mode**: max 5 users. Other accounts (e.g. kids' Family
  accounts) must be added as users in the Spotify dashboard.
- February 2026 API changes: playlist contents only via
  `GET /playlists/{id}/items`, and only for playlists the user **owns or
  collaborates on**; items use the field `item` (not `track`). Batch
  `GET /albums?ids=` is removed → fetch album tracks individually via
  `GET /albums/{id}/tracks`. Search is limited, but not used.
- Auth: Authorization Code + **PKCE**, no client secret. The Client ID is public.
- Redirect URIs: `http://127.0.0.1:8888/` (local) and
  `https://rebser-otg.github.io/SpotifyKids/` (deployed). Spotify does not
  accept `localhost`. The app derives the redirect URI from `location`.
- One Spotify account streams on one device at a time.

## UI (German, minimal text, icons preferred)

### Setup / Settings (parent)
- Not logged in → single button "Mit Spotify verbinden".
- Settings: text field for the playlist link (`https://open.spotify.com/playlist/<id>…`
  or `spotify:playlist:<id>`), save button, logout button.
- Opened by **holding the gear icon for 3 seconds** (parent gate). With no
  playlist configured, the settings screen opens automatically after login.

### Cover wall (main screen)
- Grid of large album covers derived from the configured playlist.
- A search field at the top filters the wall by album name and artist name
  (case-insensitive substring, live while typing). No Spotify-wide search.
- In-progress album: thin progress bar under the cover (position / total).
- Listened album: ✓ badge.

### Player
- Large cover, album title.
- **One continuous timeline** over the whole album: elapsed time (left),
  remaining time (right), draggable/clickable to seek anywhere.
- Five buttons: **⏮ · ⏪30s · ▶/⏸ (large) · 30s⏩ · ⏭**
  - ⏮: if more than 3 s into the current track → start of the current track;
    otherwise → start of the previous track (first track: start of album).
  - ⏭: start of the next track; on the last track → end of album (triggers
    completion).
  - ±30 s: global position ± 30 000 ms, clamped to [0, total].
- "↺ Von vorne" button: seek to 0.
- ← back to the wall (pauses playback).
- No sleep timer.

### Automatic behaviour
- Opening an album resumes at its saved position (0 if listened or new).
- Tracks always play in album order; shuffle is switched off on start.
- Position saved per album every 5 s while playing, and on pause/back.
- **Completion**: when the global position reaches `total − 1 s`, or when
  Spotify reports a current track that isn't in the album (autoplay/radio
  continuation), the app pauses, marks the album listened, and sets its
  saved position to 0.

## Architecture

Plain HTML/CSS/JS with ES modules, no build step, no runtime dependencies.
Served locally with `python3 -m http.server 8888 --bind 127.0.0.1`; deployed via GitHub
Pages from the `main` branch root.

| File | Responsibility |
|---|---|
| `index.html`, `style.css` | Markup for the three screens, layout |
| `app.js` | UI wiring: screens, buttons, search, timeline rendering |
| `auth.js` | PKCE login, token storage, refresh; `getToken()` |
| `spotify.js` | Web API wrapper: playlist items (paged), album tracks (paged), play, pause, seek, shuffle |
| `player.js` | Loads the SDK, creates the device, emits state, reports init/account errors |
| `timeline.js` | **Pure** album-timeline math |
| `catalog.js` | **Pure**: playlist items → unique albums; playlist link → id; search filter |
| `store.js` | localStorage: tokens, playlist id, progress `{[albumId]: {ms, done}}` |

### `timeline.js` (pure, from an array of track durations in ms)
- `total(durations)`
- `toGlobal(durations, index, offsetMs)` → global ms
- `locate(durations, globalMs)` → `{index, offsetMs}`. Clamped. A position
  exactly on a boundary belongs to the later track.
- `prevTarget(durations, globalMs)` → global ms (3 s rule above)
- `nextTarget(durations, globalMs)` → global ms (start of next track, or `total`)
- `skip(durations, globalMs, deltaMs)` → clamped global ms

### Playback data flow
1. Open album → `GET /albums/{id}/tracks` (all pages) → durations + URIs.
2. Shuffle off → `PUT /me/player/play` on the SDK device with
   `context_uri = album URI`, `offset.position = index`,
   `position_ms = offsetMs` from `locate(saved)`.
3. SDK `player_state_changed` → find current track index by URI in the album
   (fallback: match by name + duration; not found → completion rule) →
   global = `toGlobal(index, state.position)`. Between events the UI
   interpolates with elapsed wall time while playing (updates ~4×/s).
4. Seek/skip to target global ms → `locate` → same track: SDK `seek(offset)`;
   other track: `PUT /me/player/play` with the new offset and position.

## Error handling (German messages)

| Situation | Behaviour |
|---|---|
| SDK `initialization_error` / unsupported browser | "Funktioniert nur am Laptop in Chrome, Firefox oder Edge." |
| SDK `account_error` | "Braucht Spotify Premium." |
| Token expired | Silent refresh; on failure → back to "Mit Spotify verbinden" |
| Playlist 403/404 | In settings: "Die Playlist muss dir gehören (oder du musst mitarbeiten)." |
| Album not playable | Short message, back to the wall |
| Network / other API error | "Das hat nicht geklappt." with a retry button |

## Testing

- `node --test` unit tests (TDD) for `timeline.js` and `catalog.js`: boundaries,
  3 s rule, clamping at 0/total, multi-track jumps, duplicate albums, link
  parsing, filter.
- Everything that doesn't need a login is verified by the implementer (tests,
  page loads without console errors, login redirect built correctly).
- Final click-through with a real Spotify Premium account by the user, following
  a checklist in the README.

## Out of scope

Tablets/mobile playback, sleep timer, Spotify-wide search, sync of progress
across devices, multiple playlists, backend.
