// Timing features. Must match research/features.py exactly (tests/parity.ts).
// Input is only when each key went down and how long it was held. Never which key.

export interface Stroke {
  press: number; // seconds
  hold: number; // seconds
}

export interface Features {
  n: number;
  med: number; // typical hold
  iqr: number; // spread of the middle half of holds
  wsd: number; // unevenness inside short stretches
  adj: number; // change from one key to the next
  gap_med: number; // typical time between presses (typing speed)
}

export const MIN_HOLD = 0.01;
export const MAX_HOLD = 1.0;
export const WINDOW = 50;

export function clean(s: Stroke[]): Stroke[] {
  return s
    .filter((k) => Number.isFinite(k.press) && Number.isFinite(k.hold) && k.hold >= MIN_HOLD && k.hold < MAX_HOLD)
    .map((k, i) => ({ k, i }))
    .sort((a, b) => a.k.press - b.k.press || a.i - b.i)
    .map((x) => x.k);
}

/** Linear-interpolated percentile (numpy default). */
export function pct(x: number[], q: number): number {
  const a = [...x].sort((m, n) => m - n);
  const r = (q / 100) * (a.length - 1);
  const lo = Math.floor(r);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (r - lo);
}
const median = (x: number[]) => pct(x, 50);
const sd = (x: number[]) => {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
};

export function features(strokes: Stroke[]): Features {
  const s = clean(strokes);
  const h = s.map((k) => k.hold);
  const wins: number[][] = [];
  for (let i = 0; i + WINDOW <= h.length; i += WINDOW) wins.push(h.slice(i, i + WINDOW));
  if (!wins.length) wins.push(h);
  const diffs = h.slice(1).map((v, i) => Math.abs(v - h[i]));
  const gaps = s.slice(1).map((k, i) => k.press - s[i].press).filter((g) => g > 0.03 && g < 1);
  return {
    n: h.length,
    med: median(h),
    iqr: pct(h, 75) - pct(h, 25),
    wsd: median(wins.map(sd)),
    adj: diffs.length ? median(diffs) : 0,
    gap_med: gaps.length ? median(gaps) : 0,
  };
}
