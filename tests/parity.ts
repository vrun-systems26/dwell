// The app's TypeScript must give the same numbers as the Python research code,
// and must refuse recordings it cannot judge.  npm test
import { readFileSync } from 'node:fs';
import { check, MIN_KEYS, Recorder } from '../src/core/capture';
import { features, type Stroke } from '../src/core/features';
import { band, HELDOUT, MAIN, percentile, score } from '../src/core/model';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { if (cond) pass++; else fail++; console.log(cond ? 'PASS' : 'FAIL', name, detail); };
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;

const fx = JSON.parse(readFileSync('tests/fixtures.json', 'utf8')) as { press: number[]; hold: number[]; f: Record<string, number>; score: number; pc: number; pc60: number }[];
let worst = 0;
for (const r of fx) {
  const s = r.press.map((p, i) => ({ press: p, hold: r.hold[i] }));
  const f = features(s);
  for (const k of ['n', 'med', 'iqr', 'wsd', 'adj', 'gap_med'] as const) worst = Math.max(worst, Math.abs(f[k] - r.f[k]));
  if (!near(score(f, HELDOUT), r.score, 2e-2) || !near(percentile(score(f, HELDOUT), 60, f.gap_med, HELDOUT), r.pc, 0.7) || !near(percentile(score(f, MAIN), 47, f.gap_med, MAIN), r.pc60, 0.7)) ok('score parity', false, JSON.stringify([score(f, HELDOUT), r.score]));
}
// fixtures keep 4 decimals (0.1 ms), so agreement is to about that
ok(`features match Python on ${fx.length} recordings`, worst < 2e-4, `largest difference ${worst.toExponential(1)} s`);
ok('scores and percentiles match Python', fail === 0);

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const norm = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(6.2832 * rnd());
const make = (n: number, gap: number, hold: number, sd: number, q = 0): Stroke[] => {
  let t = 0;
  return Array.from({ length: n }, () => { t += gap * (0.6 + 0.8 * rnd()); let h = Math.max(0.02, hold + sd * norm()); if (q) h = Math.max(q, Math.round(h / q) * q); return { press: t, hold: h }; });
};
const good = make(400, 0.2, 0.11, 0.025);
ok('ordinary typing accepted', check(good) === null);
ok('too short refused', check(good.slice(0, MIN_KEYS - 1)) === 'few');
ok('identical holds (script) refused', check(make(400, 0.2, 0.1, 0)) === 'robot');
ok('very coarse timer refused', check(make(400, 0.2, 0.11, 0.03, 0.05)) === 'coarse', String(check(make(400, 0.2, 0.11, 0.03, 0.05))));
ok('16 ms keyboard still accepted', check(make(400, 0.2, 0.11, 0.04, 0.016)) === null);
ok('mashing refused', check(make(400, 0.03, 0.08, 0.02)) === 'stuck');
ok('one finger, very slow refused', check(make(400, 0.9, 0.12, 0.03)) === 'slow');
ok('on-screen keyboard refused', check([], { ghost: 60, lost: 0, presses: 0 }) === 'touch');
ok('many lost releases refused', check(good, { ghost: 0, lost: 90, presses: 490 }) === 'broken');
ok('more uneven typing scores higher', [0.01, 0.02, 0.03, 0.05].map((x) => { seed = 7; return score(features(make(400, 0.2, 0.11, x))); }).every((v, i, a) => !i || v > a[i - 1]));
ok('same recording, same answer', score(features(good)) === score(features([...good])));
ok('bands', band(50) === 'usual' && band(80) === 'little' && band(94.9) === 'little' && band(95) === 'flag');
ok('percentile stays inside the table', percentile(-99, 50, 0.2) === 1 && percentile(99, 50, 0.2) === 99.5 && Number.isFinite(percentile(0, 5, 9)) && Number.isFinite(percentile(0, 120, 0.001)));

// the recorder: repeat, shortcuts, spaces and lost focus; nothing but timing is kept
const ev = (o: object) => ({ key: 'a', code: 'KeyA', keyCode: 65, repeat: false, ctrlKey: false, metaKey: false, altKey: false, timeStamp: 0, ...o }) as unknown as KeyboardEvent;
const r = new Recorder();
r.keydown(ev({ timeStamp: 1000 })); r.keydown(ev({ timeStamp: 1400, repeat: true })); r.keyup(ev({ timeStamp: 1110 }));
r.keydown(ev({ key: ' ', code: 'Space', timeStamp: 1200 })); r.keyup(ev({ key: ' ', code: 'Space', timeStamp: 1300 }));
r.keydown(ev({ key: 'Backspace', code: 'Backspace', timeStamp: 1400 })); r.keydown(ev({ ctrlKey: true, timeStamp: 1500 }));
r.keydown(ev({ key: 'b', code: 'KeyB', timeStamp: 1600 })); r.keydown(ev({ key: 'c', code: 'KeyC', timeStamp: 1650 })); r.keyup(ev({ key: 'b', code: 'KeyB', timeStamp: 1700 })); r.keyup(ev({ key: 'c', code: 'KeyC', timeStamp: 1760 }));
r.keydown(ev({ key: 'd', code: 'KeyD', timeStamp: 1800 })); r.blur();
ok('recorder: overlap kept, repeat/space/shortcut/backspace ignored, lost key counted', r.strokes.length === 3 && near(r.strokes[0].hold, 0.11, 1e-9) && near(r.strokes[2].hold, 0.11, 1e-9) && r.lost === 1);
ok('recorder keeps only two numbers per key', r.strokes.every((s) => Object.keys(s).sort().join() === 'hold,press' && typeof s.hold === 'number'));

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
