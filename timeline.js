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
