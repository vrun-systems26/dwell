// Records timing from key events. It asks an event only "is this a character
// key?" (key length 1, not a space); the character itself is never stored.
import { clean, pct, type Stroke } from './features';

export const MIN_KEYS = 300;

/** Why a recording cannot be scored. Order matters: first match is shown. */
export type Problem = 'touch' | 'few' | 'stuck' | 'coarse' | 'robot' | 'slow' | 'fast' | 'broken';

export class Recorder {
  strokes: Stroke[] = [];
  presses = 0;
  ghost = 0; // key events without a usable key (on-screen keyboards)
  lost = 0; // presses whose release was never seen
  private down = new Map<string, number>();
  onStroke: (s: Stroke) => void = () => {};

  keydown(e: KeyboardEvent) {
    if (e.key === 'Unidentified' || e.keyCode === 229 || !e.code) { this.ghost++; return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    this.presses++;
    this.down.set(e.code, e.timeStamp / 1000);
  }
  keyup(e: KeyboardEvent) {
    const t = this.down.get(e.code);
    if (t === undefined) return;
    this.down.delete(e.code);
    const s = { press: t, hold: e.timeStamp / 1000 - t };
    this.strokes.push(s);
    this.onStroke(s);
  }
  /** Focus left the page: keys still down will never report their release. */
  blur() {
    this.lost += this.down.size;
    this.down.clear();
  }
  problem(): Problem | null {
    return check(this.strokes, { ghost: this.ghost, lost: this.lost, presses: this.presses });
  }
}

export function check(raw: Stroke[], c: { ghost: number; lost: number; presses: number } = { ghost: 0, lost: 0, presses: raw.length }): Problem | null {
  const s = clean(raw);
  if (c.ghost > 20 && c.ghost > raw.length) return 'touch';
  if (s.length < MIN_KEYS) return raw.length >= MIN_KEYS && s.length < raw.length * 0.9 ? 'broken' : 'few';
  if (c.lost > c.presses * 0.1 || s.length < raw.length * 0.9) return 'broken';
  const gaps = s.slice(1).map((k, i) => k.press - s[i].press).filter((g) => g > 0);
  // One key held down or mashed: presses far closer together than typing allows.
  const g = pct(gaps, 50);
  if (g < 0.06) return 'stuck';
  const h = s.map((k) => k.hold);
  const distinct = new Set(h.map((x) => Math.round(x * 1000))).size;
  // Timer or keyboard too coarse: only a handful of different hold times.
  if (distinct < 8) return pct(h, 90) - pct(h, 10) < 0.004 ? 'robot' : 'coarse';
  if (pct(h, 90) - pct(h, 10) < 0.008) return 'robot';
  if (g < 0.09) return 'fast';
  if (g > 0.6) return 'slow';
  return null;
}
