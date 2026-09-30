# SpotifyKids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kid-friendly Spotify web player where a whole album behaves like one long track with one continuous timeline.

**Architecture:** A static site made of plain ES modules with no build step. Two pure modules (`timeline.js`, `catalog.js`) hold all the logic that can be tested, using `node --test`. Four thin browser modules (`store.js`, `auth.js`, `spotify.js`, `player.js`) talk to localStorage, Spotify login, the Web API and the Web Playback SDK. `app.js` wires the three screens together.

**Tech Stack:** HTML/CSS/JS (ES modules), Spotify Web API + Web Playback SDK, Authorization Code + PKCE, `node --test` (Node 22), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-30-spotifykids-design.md`

## Global Constraints

- No build step, no runtime dependencies, no `package.json`. `node --test` runs the `*.test.js` files as ES modules (verified on Node 22.22).
- All UI text is German.
- Playback works in desktop Chrome, Firefox and Edge only.
- Redirect URIs: `http://127.0.0.1:8888/` (local) and `https://rebser-otg.github.io/SpotifyKids/` (deployed). Never use `localhost`.
- Local server: `python3 -m http.server 8888 --bind 127.0.0.1`
- Playlist contents come from `GET /playlists/{id}/items`, where each item's field is `item` (not `track`). Album tracks come from `GET /albums/{id}/tracks` (paged). There is no batch `/albums?ids=`.
- Five player buttons, ⏮ · ⏪30 · ▶/⏸ · 30⏩ · ⏭, plus "↺ Von vorne" and ← back. No sleep timer.
- Completion: the position reaches `total − 1 s`, or the SDK reports a track outside the album. The app then pauses, marks the album listened and saves position 0.

## Deviations from the spec (small, deliberate)

- The progress entry is `{ms, total, done}`, not `{ms, done}`. The cover-wall progress bar needs the total.
- Pause and seek go through the SDK (`player.pause()` / `player.seek()`), not the Web API. `spotify.js` only has playlist items, album tracks, play and shuffle.
- ▶ always calls `PUT /me/player/play` at the current global position, instead of SDK `resume()`. This is robust after completion, after a paused seek, and when a stale context is still loaded.
- `findTrack` (URI → relinked URI → name + duration) lives in `catalog.js`, so it can be unit-tested.

## Review Focus

1. **A playlist containing removed tracks, local files or podcast episodes** (`item: null`, `is_local`, `type: 'episode'`): the wall must skip them without crashing. The test is in Task 2.
2. **A playlist link pasted with `?si=…`, an `intl-de/` path or surrounding whitespace**: it must parse. The test is in Task 2.
3. **The SDK reports a position slightly past the track's duration, or a relinked track URI**: the timeline must not overshoot and must not wrongly mark the album listened. Tests are in Task 1 (`toGlobal` clamp) and Task 2 (`findTrack` relink and name/duration fallback).
4. **A leftover SDK event from the previously played album or radio arrives right after opening a new album**: it must not mark the new album listened. The `started` flag handles this in Task 4, checked in the Task 6 click-through.
5. **The access token expires after 1 h while listening, and several calls refresh at once**: a single refresh must happen and playback controls must keep working. `refreshing` is shared in Task 3, checked in the Task 6 click-through.

---

### Task 1: `timeline.js`, the album-timeline math

**Files:**
- Create: `timeline.js`
- Test: `timeline.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (all pure; `d` = `number[]` of track durations in ms):
  - `total(d) → number`
  - `toGlobal(d, index, offsetMs) → number` (offset clamped to `[0, d[index]]`)
  - `locate(d, globalMs) → {index, offsetMs}` (clamped to `[0, total]`; a position on a boundary belongs to the later track; at `total` → last track, offset = its duration)
  - `prevTarget(d, globalMs) → number`, `nextTarget(d, globalMs) → number`, `skip(d, globalMs, deltaMs) → number`
  - `fmt(ms) → string`: `"1:05"`, `"1:02:03"`

- [ ] **Step 1: Write the failing test** as `timeline.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total, toGlobal, locate, prevTarget, nextTarget, skip, fmt } from './timeline.js';

const d = [10000, 20000, 30000]; // boundaries at 10 s and 30 s, total 60 s

test('total sums durations', () => {
  assert.equal(total(d), 60000);
  assert.equal(total([]), 0);
});

test('toGlobal adds previous tracks', () => {
  assert.equal(toGlobal(d, 0, 500), 500);
  assert.equal(toGlobal(d, 2, 1000), 31000);
});

test('toGlobal clamps an SDK position past the track end', () => {
  assert.equal(toGlobal(d, 0, 10400), 10000);
  assert.equal(toGlobal(d, 1, -5), 10000);
});

test('locate finds track and offset', () => {
  assert.deepEqual(locate(d, 0), { index: 0, offsetMs: 0 });
  assert.deepEqual(locate(d, 15000), { index: 1, offsetMs: 5000 });
  assert.deepEqual(locate(d, 59999), { index: 2, offsetMs: 29999 });
});

test('locate: exact boundary belongs to the later track', () => {
  assert.deepEqual(locate(d, 10000), { index: 1, offsetMs: 0 });
  assert.deepEqual(locate(d, 30000), { index: 2, offsetMs: 0 });
});

test('locate clamps to [0, total]', () => {
  assert.deepEqual(locate(d, -500), { index: 0, offsetMs: 0 });
  assert.deepEqual(locate(d, 60000), { index: 2, offsetMs: 30000 });
  assert.deepEqual(locate(d, 99999), { index: 2, offsetMs: 30000 });
});

test('locate round-trips with toGlobal', () => {
  for (const g of [0, 1, 9999, 10000, 25000, 59999]) {
    const { index, offsetMs } = locate(d, g);
    assert.equal(toGlobal(d, index, offsetMs), g);
  }
});

test('prevTarget: more than 3 s in → start of current track', () => {
  assert.equal(prevTarget(d, 14000), 10000);
});

test('prevTarget: 3 s or less in → start of previous track', () => {
  assert.equal(prevTarget(d, 13000), 0);
  assert.equal(prevTarget(d, 30000), 10000);
});

test('prevTarget on the first track → 0', () => {
  assert.equal(prevTarget(d, 2000), 0);
  assert.equal(prevTarget(d, 8000), 0);
});

test('prevTarget on a single-track album', () => {
  assert.equal(prevTarget([5000], 1000), 0);
  assert.equal(prevTarget([5000], 4000), 0);
});

test('nextTarget → start of next track, or total on the last track', () => {
  assert.equal(nextTarget(d, 0), 10000);
  assert.equal(nextTarget(d, 10000), 30000);
  assert.equal(nextTarget(d, 45000), 60000);
});

test('skip moves across tracks and clamps', () => {
  assert.equal(skip(d, 5000, 30000), 35000);
  assert.equal(skip(d, 35000, -30000), 5000);
  assert.equal(skip(d, 10000, -30000), 0);
  assert.equal(skip(d, 50000, 30000), 60000);
});

test('fmt formats minutes and hours', () => {
  assert.equal(fmt(0), '0:00');
  assert.equal(fmt(65000), '1:05');
  assert.equal(fmt(65999), '1:05');
  assert.equal(fmt(3723000), '1:02:03');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL with `Cannot find module '…/timeline.js'`

- [ ] **Step 3: Write the implementation** as `timeline.js`:

```js
// Pure album-timeline math. `d` is the array of track durations in ms.
export const total = d => d.reduce((a, b) => a + b, 0);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function toGlobal(d, index, offsetMs) {
  let g = 0;
  for (let i = 0; i < index; i++) g += d[i];
  return g + clamp(offsetMs, 0, d[index]);
}

// A position exactly on a boundary belongs to the later track.
export function locate(d, globalMs) {
  let rest = clamp(globalMs, 0, total(d));
  for (let i = 0; i < d.length; i++) {
    if (rest < d[i]) return { index: i, offsetMs: rest };
    rest -= d[i];
  }
  return { index: d.length - 1, offsetMs: d[d.length - 1] };
}

export function prevTarget(d, globalMs) {
  const { index, offsetMs } = locate(d, globalMs);
  if (offsetMs > 3000 || index === 0) return toGlobal(d, index, 0);
  return toGlobal(d, index - 1, 0);
}

export function nextTarget(d, globalMs) {
  const { index } = locate(d, globalMs);
  return index < d.length - 1 ? toGlobal(d, index + 1, 0) : total(d);
}

export const skip = (d, globalMs, deltaMs) => clamp(globalMs + deltaMs, 0, total(d));

// 65000 → "1:05", 3723000 → "1:02:03"
export function fmt(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: `# pass 14`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add timeline.js timeline.test.js
git commit -m "feat: album timeline math"
```

---

### Task 2: `catalog.js`, playlist to albums, search, track matching

**Files:**
- Create: `catalog.js`
- Test: `catalog.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (all pure):
  - `playlistId(link: string) → string | null`
  - `albumsFromItems(items) → Album[]`, where `Album = {id, uri, name, artists: string, image: string}`, unique by album id, in playlist order
  - `filterAlbums(albums: Album[], query: string) → Album[]`
  - `findTrack(tracks: {uri, name, duration_ms}[], cur: SDK current_track) → index | -1`

- [ ] **Step 1: Write the failing test** as `catalog.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playlistId, albumsFromItems, filterAlbums, findTrack } from './catalog.js';

test('playlistId parses web links, with and without ?si=', () => {
  assert.equal(playlistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), '37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(playlistId('  https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123 '), '37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(playlistId('https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M'), '37i9dQZF1DXcBWIGoYBM5M');
});

test('playlistId parses spotify: URIs', () => {
  assert.equal(playlistId('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), '37i9dQZF1DXcBWIGoYBM5M');
});

test('playlistId rejects other links', () => {
  assert.equal(playlistId('https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy'), null);
  assert.equal(playlistId(''), null);
});

const album = (id, name, artist) => ({
  id, uri: `spotify:album:${id}`, name,
  artists: [{ name: artist }], images: [{ url: `https://i.scdn.co/${id}` }],
});
const item = (a) => ({ item: { type: 'track', is_local: false, album: a } });

test('albumsFromItems dedupes albums, keeps playlist order', () => {
  const a = album('a1', 'Folge 1', 'Die drei ???');
  const b = album('b2', 'Folge 2', 'TKKG');
  assert.deepEqual(albumsFromItems([item(a), item(b), item(a)]), [
    { id: 'a1', uri: 'spotify:album:a1', name: 'Folge 1', artists: 'Die drei ???', image: 'https://i.scdn.co/a1' },
    { id: 'b2', uri: 'spotify:album:b2', name: 'Folge 2', artists: 'TKKG', image: 'https://i.scdn.co/b2' },
  ]);
});

test('albumsFromItems skips removed, local and episode items', () => {
  const a = album('a1', 'Folge 1', 'X');
  const items = [
    { item: null },
    { item: { type: 'track', is_local: true, album: { id: null, name: 'lokal', artists: [], images: [] } } },
    { item: { type: 'episode', show: { id: 's1' } } },
    item(a),
  ];
  assert.deepEqual(albumsFromItems(items).map(x => x.id), ['a1']);
});

test('albumsFromItems joins artists and tolerates missing images', () => {
  const a = { ...album('a1', 'F', 'A'), artists: [{ name: 'A' }, { name: 'B' }], images: [] };
  assert.deepEqual(albumsFromItems([item(a)])[0], { id: 'a1', uri: 'spotify:album:a1', name: 'F', artists: 'A, B', image: '' });
});

const list = [
  { id: '1', name: 'Der Grüffelo', artists: 'Axel Scheffler' },
  { id: '2', name: 'Folge 12: Der Fluch', artists: 'Die drei ???' },
];

test('filterAlbums: empty or blank query returns all', () => {
  assert.equal(filterAlbums(list, '').length, 2);
  assert.equal(filterAlbums(list, '   ').length, 2);
});

test('filterAlbums matches album name or artist, case-insensitive, trimmed', () => {
  assert.deepEqual(filterAlbums(list, 'grüff').map(a => a.id), ['1']);
  assert.deepEqual(filterAlbums(list, ' DREI ').map(a => a.id), ['2']);
  assert.deepEqual(filterAlbums(list, 'der').map(a => a.id), ['1', '2']);
  assert.deepEqual(filterAlbums(list, 'xyz'), []);
});

const tracks = [
  { uri: 'spotify:track:t1', name: 'Teil 1', duration_ms: 600000 },
  { uri: 'spotify:track:t2', name: 'Teil 2', duration_ms: 500000 },
];

test('findTrack matches by uri', () => {
  assert.equal(findTrack(tracks, { uri: 'spotify:track:t2', name: 'x', duration_ms: 1 }), 1);
});

test('findTrack matches a relinked track via linked_from', () => {
  assert.equal(findTrack(tracks, { uri: 'spotify:track:zz', linked_from: { uri: 'spotify:track:t1' }, name: 'x', duration_ms: 1 }), 0);
});

test('findTrack falls back to name + duration', () => {
  assert.equal(findTrack(tracks, { uri: 'spotify:track:zz', name: 'Teil 2', duration_ms: 501000 }), 1);
});

test('findTrack returns -1 for a track outside the album', () => {
  assert.equal(findTrack(tracks, { uri: 'spotify:track:other', name: 'Radio', duration_ms: 180000 }), -1);
  assert.equal(findTrack(tracks, { uri: 'spotify:track:zz', name: 'Teil 2', duration_ms: 400000 }), -1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL with `Cannot find module '…/catalog.js'` (the timeline tests still pass)

- [ ] **Step 3: Write the implementation** as `catalog.js`:

```js
// Pure: playlist link → id, playlist items → unique albums, search filter, track matching.

// Accepts https://open.spotify.com/playlist/<id>?si=… and spotify:playlist:<id>.
export function playlistId(link) {
  return link.trim().match(/playlist[/:]([A-Za-z0-9]+)/)?.[1] ?? null;
}

// Items from GET /playlists/{id}/items. Skips removed, local and non-track items.
export function albumsFromItems(items) {
  const seen = new Map();
  for (const it of items) {
    const t = it.item ?? it.track; // ponytail: `track` = pre-2026 field name
    const a = t?.type === 'track' && !t.is_local ? t.album : null;
    if (!a?.id || seen.has(a.id)) continue;
    seen.set(a.id, {
      id: a.id,
      uri: a.uri,
      name: a.name,
      artists: a.artists.map(x => x.name).join(', '),
      image: a.images?.[0]?.url ?? '',
    });
  }
  return [...seen.values()];
}

export function filterAlbums(albums, query) {
  const q = query.trim().toLowerCase();
  if (!q) return albums;
  return albums.filter(a => a.name.toLowerCase().includes(q) || a.artists.toLowerCase().includes(q));
}

// Index of the SDK's current track in the album's tracks, or -1.
// Matches by URI, relinked URI, then name + duration (±2 s).
export function findTrack(tracks, cur) {
  const uris = [cur.uri, cur.linked_from?.uri];
  const i = tracks.findIndex(t => uris.includes(t.uri));
  if (i >= 0) return i;
  return tracks.findIndex(t => t.name === cur.name && Math.abs(t.duration_ms - cur.duration_ms) <= 2000);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: `# pass 26`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add catalog.js catalog.test.js
git commit -m "feat: catalog from playlist, search filter, track matching"
```

---

### Task 3: Browser modules: `store.js`, `auth.js`, `spotify.js`, `player.js`

These need a browser and a Spotify login, so they have no unit tests. Task 4 and Task 6 verify them in the browser.

**Files:**
- Create: `store.js`, `auth.js`, `spotify.js`, `player.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `store.js`: `load(key, fallback = null)`, `save(key, value)` (`value == null` removes the key). Keys: `tokens`, `playlistId`, `progress`.
  - `auth.js`: `login()` (redirects to Spotify), `handleRedirect()` (call on load; exchanges `?code=`), `getToken() → Promise<string>` (refreshes when less than 60 s is left; throws `Error('auth')` and clears the tokens when refresh fails), `isLoggedIn() → boolean`, `logout()`
  - `spotify.js`: `playlistItems(id)`, `albumTracks(id)` (all pages), `shuffleOff(deviceId)`, `play(deviceId, contextUri, index, positionMs)`. Errors are `Error` with `.status`.
  - `player.js`: `initPlayer(getToken, onState) → Promise<deviceId>` (rejects with `Error('browser' | 'premium' | 'auth' | 'network')`), `sdk() → Spotify.Player | null`

- [ ] **Step 1: Write `store.js`**

```js
// localStorage keys: tokens, playlistId, progress ({[albumId]: {ms, total, done}}).
export function load(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  if (value == null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}
```

- [ ] **Step 2: Write `auth.js`.** `CLIENT_ID` stays as the literal `'SET_IN_TASK_6'` until the user supplies the real one.

```js
// Spotify login: Authorization Code + PKCE (no client secret).
import { load, save } from './store.js';

const CLIENT_ID = 'SET_IN_TASK_6';
const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state',
  'playlist-read-private', 'playlist-read-collaborative',
].join(' ');

// http://127.0.0.1:8888/ locally, https://rebser-otg.github.io/SpotifyKids/ deployed.
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const b64url = bytes =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem('verifier', verifier);
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: b64url(new Uint8Array(hash)),
    scope: SCOPES,
  });
}

// Call once on page load: turns ?code=… from Spotify into tokens.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  history.replaceState(null, '', redirectUri());
  if (!params.has('code')) return; // user cancelled on Spotify's page
  await tokenRequest({
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: sessionStorage.getItem('verifier'),
  });
}

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  if (!r.ok) {
    save('tokens', null); // back to "Mit Spotify verbinden"
    throw new Error('auth');
  }
  const t = await r.json();
  save('tokens', {
    access: t.access_token,
    refresh: t.refresh_token ?? load('tokens')?.refresh, // refresh may not return a new one
    expires: Date.now() + t.expires_in * 1000,
  });
}

let refreshing = null; // one refresh at a time; the refresh token is single-use

export async function getToken() {
  const t = load('tokens');
  if (!t) throw new Error('auth');
  if (Date.now() > t.expires - 60000) {
    refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })
      .finally(() => { refreshing = null; });
    await refreshing;
  }
  return load('tokens').access;
}

export const isLoggedIn = () => !!load('tokens');
export const logout = () => save('tokens', null);
```

- [ ] **Step 3: Write `spotify.js`**

```js
// Spotify Web API wrapper.
import { getToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + await getToken(),
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw Object.assign(new Error(`Spotify ${r.status}`), { status: r.status });
  const text = await r.text(); // play/shuffle answer 204 or an empty 200
  return text ? JSON.parse(text) : null;
}

async function allPages(path) {
  const out = [];
  for (let p = path; p; ) {
    const page = await api('GET', p);
    out.push(...page.items);
    p = page.next?.replace(BASE, '');
  }
  return out;
}

export const playlistItems = id => allPages(`/playlists/${id}/items?limit=50`);
export const albumTracks = id => allPages(`/albums/${id}/tracks?limit=50`);

export const shuffleOff = deviceId =>
  api('PUT', `/me/player/shuffle?state=false&device_id=${deviceId}`);

export const play = (deviceId, contextUri, index, positionMs) =>
  api('PUT', `/me/player/play?device_id=${deviceId}`, {
    context_uri: contextUri,
    offset: { position: index },
    position_ms: Math.round(positionMs),
  });
```

- [ ] **Step 4: Write `player.js`.** SDK event names were verified against `https://sdk.scdn.co/spotify-player.js` on 2026-09-30: `ready`, `initialization_error`, `account_error`, `authentication_error`, `player_state_changed`, `activateElement`.

```js
// Loads the Web Playback SDK and makes this browser tab a Spotify device.
let player = null;

export const sdk = () => player;

// Resolves with the device id. Rejects with Error('browser' | 'premium' | 'auth').
export function initPlayer(getToken, onState) {
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('browser')), 20000); // no-op once resolved
    window.onSpotifyWebPlaybackSDKReady = () => {
      player = new Spotify.Player({
        name: 'SpotifyKids',
        getOAuthToken: cb => getToken().then(cb, () => reject(new Error('auth'))),
        volume: 1,
      });
      player.addListener('ready', ({ device_id }) => resolve(device_id));
      player.addListener('initialization_error', () => reject(new Error('browser')));
      player.addListener('account_error', () => reject(new Error('premium')));
      player.addListener('authentication_error', () => reject(new Error('auth')));
      player.addListener('player_state_changed', s => s && onState(s));
      player.connect();
    };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => reject(new Error('network'));
    document.head.append(script);
  });
}
```

- [ ] **Step 5: Syntax check**

Run: `for f in store.js auth.js spotify.js player.js; do node --check $f || echo FAIL $f; done`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add store.js auth.js spotify.js player.js
git commit -m "feat: storage, PKCE auth, Web API wrapper, playback SDK loader"
```

---

### Task 4: UI: `index.html`, `style.css`, `app.js`

**Files:**
- Create: `index.html`, `style.css`, `app.js`

**Interfaces:**
- Consumes every export listed in Tasks 1–3 (see the import lines at the top of `app.js`).
- Produces: the running app.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SpotifyKids</title>
  <link rel="stylesheet" href="style.css">
  <script type="module" src="app.js"></script>
</head>
<body>
<main>
  <section id="login" hidden>
    <button id="connect" class="big">Mit Spotify verbinden</button>
  </section>

  <section id="settings" hidden>
    <h1>Einstellungen</h1>
    <label>Playlist-Link
      <input id="playlist" placeholder="https://open.spotify.com/playlist/…">
    </label>
    <p id="settings-msg" role="alert"></p>
    <div class="row">
      <button id="save">Speichern</button>
      <button id="logout">Abmelden</button>
    </div>
  </section>

  <section id="wall" hidden>
    <header>
      <input id="search" type="search" placeholder="🔍 Suchen" aria-label="Suchen">
      <button id="gear" aria-label="Einstellungen (3 Sekunden halten)">⚙</button>
    </header>
    <div id="grid"></div>
  </section>

  <section id="player" hidden>
    <button id="back" aria-label="Zurück">←</button>
    <img id="cover" alt="">
    <h1 id="title"></h1>
    <input id="seek" type="range" min="0" max="0" step="1000" value="0" aria-label="Position">
    <div class="times"><span id="elapsed">0:00</span><span id="remaining">−0:00</span></div>
    <div class="controls">
      <button id="prev" aria-label="Vorheriger Teil">⏮</button>
      <button id="back30" aria-label="30 Sekunden zurück">⏪30</button>
      <button id="toggle" class="big" aria-label="Abspielen oder Pause">▶</button>
      <button id="fwd30" aria-label="30 Sekunden vor">30⏩</button>
      <button id="next" aria-label="Nächster Teil">⏭</button>
    </div>
    <button id="restart">↺ Von vorne</button>
  </section>
</main>

<div id="error" role="alert" hidden>
  <p id="error-text"></p>
  <div class="row">
    <button id="retry">Nochmal</button>
    <button id="error-ok">OK</button>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`**

```css
:root {
  --bg: #1b1b2f;
  --fg: #fff;
  --accent: #1db954;
  --card: #2a2a45;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 18px/1.4 system-ui, sans-serif;
}
button {
  font: inherit;
  color: inherit;
  background: var(--card);
  border: 0;
  border-radius: 12px;
  padding: .6em 1em;
  cursor: pointer;
}
button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); }
input {
  font: inherit;
  padding: .6em .8em;
  border-radius: 12px;
  border: 0;
}
.big { font-size: 1.6em; background: var(--accent); color: #000; }
.row { display: flex; gap: 1em; }

main > section { padding: 24px; max-width: 1400px; margin: 0 auto; }
#login { display: grid; place-items: center; min-height: 100vh; }
#settings label { display: grid; gap: .4em; margin: 1em 0; }

#wall header { display: flex; gap: 1em; margin-bottom: 24px; }
#search { flex: 1; font-size: 1.3em; }
#gear { font-size: 1.5em; user-select: none; touch-action: none; }
#grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 20px;
}
.album { position: relative; padding: 0; overflow: hidden; aspect-ratio: 1; }
.album img { width: 100%; height: 100%; object-fit: cover; display: block; }
.album .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; background: #0008; }
.album .bar::after {
  content: ''; position: absolute; inset: 0 auto 0 0; width: var(--pct); background: var(--accent);
}
.album .done {
  position: absolute; top: 8px; right: 8px;
  width: 40px; height: 40px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--accent); color: #000; font-weight: bold; font-size: 1.4em;
}

#player { display: grid; justify-items: center; gap: 16px; max-width: 700px; }
#back { justify-self: start; font-size: 1.5em; }
#cover { width: min(60vh, 100%); aspect-ratio: 1; object-fit: cover; border-radius: 16px; }
#title { margin: 0; text-align: center; }
#seek { width: 100%; padding: 0; accent-color: var(--accent); height: 28px; }
.times { width: 100%; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
.controls { display: flex; gap: 16px; align-items: center; }
.controls button { font-size: 1.5em; min-width: 72px; min-height: 72px; }
.controls .big { font-size: 2.2em; min-width: 100px; min-height: 100px; border-radius: 50%; }

#error {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: #c0392b; padding: 16px 24px; border-radius: 16px;
  display: grid; gap: 8px; max-width: 90vw;
}
#error p { margin: 0; }
```

- [ ] **Step 3: Write `app.js`**

```js
// UI wiring: screens, cover wall, player, progress.
import { handleRedirect, isLoggedIn, login, logout, getToken } from './auth.js';
import { playlistItems, albumTracks, shuffleOff, play } from './spotify.js';
import { initPlayer, sdk } from './player.js';
import { total, toGlobal, locate, prevTarget, nextTarget, skip, fmt } from './timeline.js';
import { playlistId, albumsFromItems, filterAlbums, findTrack } from './catalog.js';
import { load, save } from './store.js';

const $ = sel => document.querySelector(sel);

const MSG = {
  browser: 'Funktioniert nur am Laptop in Chrome, Firefox oder Edge.',
  premium: 'Braucht Spotify Premium.',
  unplayable: 'Dieses Album geht gerade nicht.',
};

let albums = [];
let devicePromise = null;
// Open album: {album, tracks, durations, started, done}.
// `started`: the SDK has reported a track of this album since the last play()
// call; until then, foreign tracks are leftovers from before and are ignored.
// `done`: completed; SDK events are ignored until ▶ plays again.
let current = null;
let globalMs = 0, playing = false, stampedAt = 0, lastSave = 0, dragging = false;
let retryFn = null;

function show(id) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id;
}

function fail(e, retry = null) {
  console.error(e);
  if (!isLoggedIn()) return show('login');
  $('#error-text').textContent = MSG[e.message] ?? 'Das hat nicht geklappt.';
  retryFn = retry;
  $('#retry').hidden = !retry;
  $('#error').hidden = false;
}

// --- cover wall ---

async function loadWall() {
  try {
    albums = albumsFromItems(await playlistItems(load('playlistId')));
    renderWall();
    show('wall');
  } catch (e) {
    fail(e, loadWall);
  }
}

function renderWall() {
  const progress = load('progress', {});
  $('#grid').replaceChildren(...filterAlbums(albums, $('#search').value).map(a => {
    const b = document.createElement('button');
    b.className = 'album';
    b.title = `${a.name} – ${a.artists}`;
    b.setAttribute('aria-label', b.title);
    const img = document.createElement('img');
    img.src = a.image;
    img.alt = '';
    b.append(img);
    const p = progress[a.id];
    if (p?.ms > 0) {
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.setProperty('--pct', `${(100 * p.ms) / p.total}%`);
      b.append(bar);
    }
    if (p?.done) {
      const done = document.createElement('span');
      done.className = 'done';
      done.textContent = '✓';
      b.append(done);
    }
    b.onclick = () => openAlbum(a);
    return b;
  }));
}

// --- player ---

const now = () => Math.min(
  globalMs + (playing ? performance.now() - stampedAt : 0),
  total(current.durations),
);

function saveProgress(ms = now(), done = false) {
  const progress = load('progress', {});
  const id = current.album.id;
  progress[id] = { ms, total: total(current.durations), done: done || !!progress[id]?.done };
  save('progress', progress);
  lastSave = Date.now();
}

async function openAlbum(a) {
  sdk()?.activateElement(); // must run inside the click (browser autoplay rules)
  $('#cover').src = a.image;
  $('#title').textContent = a.name;
  current = null;
  show('player');
  try {
    const tracks = await albumTracks(a.id);
    if ($('#player').hidden) return; // kid already went back to the wall
    if (!tracks.length) throw new Error('unplayable');
    current = { album: a, tracks, durations: tracks.map(t => t.duration_ms), started: false, done: false };
    globalMs = load('progress', {})[a.id]?.ms ?? 0;
    playing = false;
    render();
    await playAt(globalMs);
    // After play: a fresh SDK device isn't active before its first play.
    shuffleOff(await devicePromise).catch(console.error);
  } catch (e) {
    current = null;
    show('wall');
    fail([403, 404].includes(e.status) ? new Error('unplayable') : e);
  }
}

async function playAt(ms) {
  const { index, offsetMs } = locate(current.durations, ms);
  current.started = false;
  current.done = false;
  const deviceId = await devicePromise;
  try {
    await play(deviceId, current.album.uri, index, offsetMs);
  } catch (e) {
    if (e.status !== 404) throw e;
    // A just-registered SDK device can be "not found" for a moment: retry once.
    await new Promise(r => setTimeout(r, 1500));
    await play(deviceId, current.album.uri, index, offsetMs);
  }
}

function onState(s) {
  if (!current || current.done) return;
  const i = findTrack(current.tracks, s.track_window.current_track);
  if (i < 0) {
    if (current.started) complete(); // autoplay/radio moved past the album
    return;
  }
  current.started = true;
  globalMs = toGlobal(current.durations, i, s.position);
  playing = !s.paused;
  stampedAt = performance.now();
  render();
}

function complete() {
  if (playing) sdk().pause();
  playing = false;
  current.done = true;
  globalMs = 0;
  saveProgress(0, true);
  render();
}

async function seekTo(ms) {
  const d = current.durations;
  if (ms >= total(d) - 1000) return complete();
  const from = locate(d, now()).index;
  const to = locate(d, ms);
  globalMs = ms;
  stampedAt = performance.now();
  render();
  if (!playing) return saveProgress(ms); // ▶ starts from here
  if (to.index === from) await sdk().seek(to.offsetMs);
  else await playAt(ms);
}

function render() {
  if (!current) return;
  const t = total(current.durations);
  const n = dragging ? +$('#seek').value : now();
  if (!dragging) {
    $('#seek').max = t;
    $('#seek').value = n;
  }
  $('#elapsed').textContent = fmt(n);
  $('#remaining').textContent = '−' + fmt(t - n);
  $('#toggle').textContent = playing ? '⏸' : '▶';
}

setInterval(() => {
  if (!current) return;
  if (playing && now() >= total(current.durations) - 1000) return complete();
  if (playing && Date.now() - lastSave > 5000) saveProgress();
  render();
}, 250);

// Wraps player button handlers: ignore clicks before the album has loaded, show errors.
const act = fn => () => current && fn().catch(e => fail(e));

$('#toggle').onclick = act(async () => {
  if (playing) {
    await sdk().pause();
    saveProgress();
  } else {
    sdk()?.activateElement();
    await playAt(now());
  }
});
$('#prev').onclick = act(() => seekTo(prevTarget(current.durations, now())));
$('#next').onclick = act(() => seekTo(nextTarget(current.durations, now())));
$('#back30').onclick = act(() => seekTo(skip(current.durations, now(), -30000)));
$('#fwd30').onclick = act(() => seekTo(skip(current.durations, now(), 30000)));
$('#restart').onclick = act(() => seekTo(0));
$('#seek').oninput = () => { dragging = true; render(); };
$('#seek').onchange = act(async () => { dragging = false; await seekTo(+$('#seek').value); });

$('#back').onclick = () => {
  if (current) {
    if (playing) sdk().pause();
    saveProgress();
  }
  current = null;
  playing = false;
  renderWall();
  show('wall');
};

// --- login, settings, errors ---

$('#connect').onclick = () => login().catch(e => fail(e));

let holdTimer = null;
$('#gear').onpointerdown = () => {
  holdTimer = setTimeout(openSettings, 3000); // parent gate: hold 3 s
};
$('#gear').onpointerup = $('#gear').onpointerleave = () => clearTimeout(holdTimer);

function openSettings() {
  const id = load('playlistId');
  $('#playlist').value = id ? `https://open.spotify.com/playlist/${id}` : '';
  $('#settings-msg').textContent = '';
  show('settings');
}

$('#save').onclick = async () => {
  const id = playlistId($('#playlist').value);
  if (!id) return ($('#settings-msg').textContent = 'Das ist kein Playlist-Link.');
  try {
    albums = albumsFromItems(await playlistItems(id));
  } catch (e) {
    if ([403, 404].includes(e.status)) {
      $('#settings-msg').textContent = 'Die Playlist muss dir gehören (oder du musst mitarbeiten).';
      return;
    }
    return fail(e);
  }
  save('playlistId', id);
  $('#search').value = '';
  renderWall();
  show('wall');
};

$('#logout').onclick = () => {
  logout();
  location.reload();
};

$('#search').oninput = renderWall;
$('#retry').onclick = () => {
  $('#error').hidden = true;
  retryFn?.();
};
$('#error-ok').onclick = () => { $('#error').hidden = true; };

// --- start ---

async function boot() {
  try {
    await handleRedirect();
  } catch (e) {
    return fail(e);
  }
  if (!isLoggedIn()) return show('login');
  devicePromise = initPlayer(getToken, onState);
  devicePromise.catch(e => fail(e));
  if (!load('playlistId')) return openSettings();
  await loadWall();
}

boot();
```

- [ ] **Step 4: Run the unit tests and syntax check**

Run: `node --test && node --check app.js`
Expected: `# pass 26`, `# fail 0`, no output from `--check`

- [ ] **Step 5: Browser check (no login needed).** Start `python3 -m http.server 8888 --bind 127.0.0.1` in the background, open `http://127.0.0.1:8888/` in Chrome (claude-in-chrome) and verify:
  - Only the "Mit Spotify verbinden" button is visible.
  - The console has no errors.
  - Clicking it navigates to `https://accounts.spotify.com/authorize?…`. The URL contains `client_id=SET_IN_TASK_6`, `redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2F`, `code_challenge_method=S256`, a `code_challenge` and a `scope` that includes `streaming`. Spotify showing "INVALID_CLIENT" is expected at this point.
  - Going back to `http://127.0.0.1:8888/?error=access_denied`: the URL is cleaned to `/` and the login button shows, with no console errors.
  - Wall styling with fake data: in the console, run `localStorage.setItem('tokens', JSON.stringify({access:'x', refresh:'x', expires: Date.now()+3600e3}))`, then reload. The page tries the SDK and Web API calls, which fail with 401, and shows the red "Das hat nicht geklappt." box or the settings screen. Nothing crashes. Afterwards run `localStorage.clear()`.
  - Stop the server.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: cover wall, player with continuous album timeline, settings"
```

---

### Task 5: README, GitHub repo, Pages

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# SpotifyKids

Kinderfreundlicher Spotify-Player für Hörspiele: ein Album verhält sich wie
ein einziger langer Titel, mit einer durchgehenden Zeitleiste.

Läuft am Laptop in Chrome, Firefox oder Edge. Braucht Spotify Premium.

## Einrichtung (einmalig, Eltern)

1. Auf <https://developer.spotify.com/dashboard> eine App anlegen.
   - APIs: **Web API** und **Web Playback SDK**
   - Redirect URIs: `http://127.0.0.1:8888/` und `https://rebser-otg.github.io/SpotifyKids/`
2. Unter **User Management** die Spotify-Konten der Kinder eintragen (max. 5).
3. Die **Client ID** in `auth.js` bei `CLIENT_ID` eintragen.
4. Eine Playlist anlegen (sie muss dir gehören) und Folgen hineinlegen.
   Ein Titel reicht: das ganze Album erscheint.
5. App öffnen → „Mit Spotify verbinden“ → Playlist-Link einfügen → Speichern.
   Einstellungen später: **Zahnrad 3 Sekunden gedrückt halten**.

## Lokal starten

```sh
python3 -m http.server 8888 --bind 127.0.0.1
```

Dann <http://127.0.0.1:8888/> öffnen (nicht `localhost`).

## Tests

```sh
node --test
```

## Test-Checkliste (mit echtem Premium-Konto)

- [ ] Verbinden → Spotify-Login → zurück in der App, Einstellungen öffnen sich
- [ ] Fremder Playlist-Link → Meldung „Die Playlist muss dir gehören …“
- [ ] Eigener Playlist-Link → Cover-Wand mit allen Alben (jedes nur einmal)
- [ ] Suche filtert nach Albumname und Künstler
- [ ] Album öffnen → spielt ab; Zeitleiste zeigt Gesamtzeit des Albums
- [ ] ⏪30 / 30⏩ über eine Titelgrenze hinweg → spielt ohne Sprung weiter
- [ ] ⏮ mitten im Titel → Titelanfang; nochmal innerhalb 3 s → voriger Titel
- [ ] Zeitleiste ziehen → springt an die Stelle, auch in einen anderen Titel
- [ ] ← zurück → Musik pausiert, Fortschrittsbalken unter dem Cover
- [ ] Album wieder öffnen → macht an der gespeicherten Stelle weiter
- [ ] Seite neu laden, Album öffnen → Stelle ist noch gespeichert
- [ ] ⏭ auf dem letzten Titel → pausiert, ✓ auf der Cover-Wand, Neustart bei 0
- [ ] ↺ Von vorne → Anfang des Albums
- [ ] Nach einer Stunde (Token läuft ab) funktionieren die Knöpfe noch
- [ ] Zahnrad kurz antippen → nichts; 3 s halten → Einstellungen
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup and test checklist"
```

- [ ] **Step 3: Create the public repo and push** (the user approved this in the brainstorming session)

Run: `gh repo create rebser-otg/SpotifyKids --public --source . --push`
Expected: the repo URL is printed and `main` is pushed.

- [ ] **Step 4: Enable Pages from `main` root**

Run: `gh api -X POST repos/rebser-otg/SpotifyKids/pages -f 'source[branch]=main' -f 'source[path]=/'`
Then poll until it's built: `gh api repos/rebser-otg/SpotifyKids/pages --jq .status` → `built`
Verify: `curl -s -o /dev/null -w '%{http_code}' https://rebser-otg.github.io/SpotifyKids/` → `200`, and `…/app.js` → `200`.

---

### Task 6: Client ID and the real click-through (with the user)

- [ ] **Step 1: The user registers the Spotify app** (README "Einrichtung" steps 1–2) and gives the Client ID.

- [ ] **Step 2: Set the Client ID** in `auth.js`: replace `'SET_IN_TASK_6'` with the real ID (it's public, since PKCE has no secret).

- [ ] **Step 3: Local smoke test with the user.** Start the local server. The user logs in at `http://127.0.0.1:8888/`, pastes their playlist link and plays an album. Watch the console (claude-in-chrome) for errors, especially a `404` from `/me/player/play` right after "ready". The one retry in `playAt` should cover that; if it doesn't, investigate the root cause before changing the code.

- [ ] **Step 4: The user works through the README "Test-Checkliste".** Fix anything that fails, with root-cause debugging (superpowers:systematic-debugging), and commit each fix separately. Pay special attention to Review Focus items 4 and 5.

- [ ] **Step 5: Commit and push**

```bash
git add auth.js
git commit -m "chore: set Spotify client ID"
git push
```

- [ ] **Step 6: The user repeats the login check on `https://rebser-otg.github.io/SpotifyKids/`.**
