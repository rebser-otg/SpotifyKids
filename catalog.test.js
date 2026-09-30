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
