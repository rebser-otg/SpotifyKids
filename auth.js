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
