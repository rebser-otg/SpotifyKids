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
