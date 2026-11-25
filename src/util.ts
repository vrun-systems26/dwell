import { pct, type Stroke } from './core/features';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rng = (s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How far each hold is from the person's own middle, in steps of 30 ms. Only used to draw pulses. */
export const devs = (s: Stroke[]) => { const m = s.length ? pct(s.map((k) => k.hold), 50) : 0.1; return s.map((k) => clamp((k.hold - m) / 0.03, -4, 8)); };
