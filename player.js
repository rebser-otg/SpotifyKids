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
      player.addListener('player_state_changed', onState); // null = moved to another device
      player.connect();
    };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => reject(new Error('network'));
    document.head.append(script);
  });
}
