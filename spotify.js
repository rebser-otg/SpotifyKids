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

// Album order, no looping: the album must play straight through once.
export const shuffleRepeatOff = deviceId => Promise.all([
  api('PUT', `/me/player/shuffle?state=false&device_id=${deviceId}`),
  api('PUT', `/me/player/repeat?state=off&device_id=${deviceId}`),
]);

export const play = (deviceId, contextUri, index, positionMs) =>
  api('PUT', `/me/player/play?device_id=${deviceId}`, {
    context_uri: contextUri,
    offset: { position: index },
    position_ms: Math.round(positionMs),
  });
