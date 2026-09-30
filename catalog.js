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
