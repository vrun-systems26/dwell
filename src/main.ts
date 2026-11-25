import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './style.css';
import { MIN_KEYS, Recorder, type Problem } from './core/capture';
import { clean, features, type Features, type Stroke } from './core/features';
import { AGE_RANGE, band, FLAG, HELDOUT, percentile, score, TYPICAL } from './core/model';
import examples from './data/examples.json';
import { createHome, homeHTML } from './home';
import { createScene, type Scene } from './scene';
import { clamp, devs } from './util';

// Public-domain openings. Copying a passage is the task the clinic studies used.
const PASSAGES = [
  "Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer's wife. Their house was small, for the lumber to build it had to be carried by wagon many miles. There were four walls, a floor and a roof, which made one room; and this room contained a rusty looking cookstove, a cupboard for the dishes, a table, three or four chairs, and the beds.",
  'The Mole had been working very hard all the morning, spring-cleaning his little home. First with brooms, then with dusters; then on ladders and steps and chairs, with a brush and a pail of whitewash; till he had dust in his throat and eyes, and splashes of whitewash all over his black fur, and an aching back and weary arms.',
  'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations?',
];

interface Session { t: number; age: number; n: number; pc: number; f: Features }
interface Outcome { pc: number; f: Features; strokes: Stroke[]; d: number[]; who?: 'flagged' | 'missed' | 'without'; young?: boolean; note?: string }

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const load = (): Session[] => { try { const v = JSON.parse(localStorage.getItem('dwell') ?? '[]'); return Array.isArray(v) ? v.filter((s) => Number.isFinite(s?.pc) && Number.isFinite(s?.t) && s.f) : []; } catch { return []; } };
const save = (s: Session[]) => { try { localStorage.setItem('dwell', JSON.stringify(s.slice(-60))); } catch { /* private mode: results still show */ } };
const person = (i: number): Stroke[] => clean(examples[i].press.map((p, k) => ({ press: p, hold: examples[i].hold[k] })));

let rec = new Recorder();
let age = (() => { try { return Number(localStorage.getItem('dwell.age')) || 0; } catch { return 0; } })();
let hands = false; // something else may affect the hands
let passage = load().length % PASSAGES.length;
let last: Outcome | null = null;
let raf = 0, view = 'home', timers: number[] = [];

const app = $('#app'), stage = $('#stage');
const top = () => `<header class="top"><button class="brand" data-go="home">Dwell</button><nav>${load().length ? '<button data-go="sessions">Your sessions</button>' : ''}<button data-go="how">How it works</button></nav></header>`;

// ---------- drawings ----------
function strip(cv: HTMLCanvasElement, s: Stroke[]) {
  const D = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * D; cv.height = H * D;
  const x = cv.getContext('2d')!, d = devs(s), step = W / Math.max(s.length, 1), y = (h: number) => H - (Math.min(h, 0.36) / 0.36) * (H - 4);
  x.scale(D, D);
  const [lo, hi] = [TYPICAL.med[0], TYPICAL.med[4]];
  x.fillStyle = '#8df0d81f'; x.fillRect(0, y(hi), W, y(lo) - y(hi));
  s.forEach((k, i) => { x.fillStyle = Math.abs(d[i]) > 1.5 ? '#ff7a5e' : '#8df0d8'; x.fillRect(i * step, y(k.hold), Math.max(0.7, step * 0.62), H - y(k.hold)); });
}
/** 100 people of your age and speed, steadiest first. */
function crowd(pc: number) {
  const me = clamp(Math.round(pc) - 1, 0, 99);
  return `<svg class="crowd" viewBox="-12 2 760 190" role="img" aria-label="Among 100 people of the same age and typing speed, about ${me} type more evenly">${Array.from({ length: 100 }, (_, i) => { const x = 8 + (i % 25) * 29.6, y = 22 + Math.floor(i / 25) * 46, m = i === me; return `<g class="${m ? 'me' : i >= FLAG ? 'zone' : i >= 80 ? 'mid' : ''}"><circle cx="${x}" cy="${y}" r="${m ? 8.5 : 6}"/><path d="${m ? `M${x - 10} ${y + 25}c1-11 5-15 10-15s9 4 10 15z` : `M${x - 8} ${y + 20}c1-8 4-11 8-11s7 3 8 11z`}"/></g>`; }).join('')}</svg>`;
}
function facts(f: Features) {
  const R: [keyof Features, string, string][] = [['wsd', 'Steadiness', 'how much holds vary within a short stretch'], ['adj', 'Key to key', 'how much the hold changes from one key to the next'], ['iqr', 'Spread', 'the range covering the middle half of the holds']];
  return `<dl class="facts">${R.map(([k, t, d]) => { const T = TYPICAL[k], mx = Math.max(T[4] * 1.3, f[k] * 1.12), P = (v: number) => (v / mx) * 100, ms = (v: number) => Math.round(v * 1000); return `<div><dt>${t}, <span>${d}</span></dt><dd><b>${ms(f[k])}</b> ms <span>most people aged 45 to 75: ${ms(T[0])} to ${ms(T[4])}</span><i class="tr" aria-hidden="true"><i style="left:${P(T[0])}%;width:${P(T[4]) - P(T[0])}%"></i><em style="left:${P(f[k])}%"></em></i></dd></div>`; }).join('')}</dl>`;
}

// ---------- screens ----------
const screens: Record<string, () => string> = {
  home: () => top() + homeHTML(),
  about: () => `${top()}<main class="sheet"><h1>Before you type</h1><form id="about"><label for="age">Your age</label><input id="age" type="number" inputmode="numeric" min="5" max="110" required value="${age || ''}"><p>Typing changes with age, so you are compared with people your age.</p><label class="tick"><input type="checkbox" id="hands" ${hands ? 'checked' : ''}><span>Something else affects my hands right now, such as an injury, arthritis, numbness, another condition, or a medicine that causes shaking</span></label><p>Use a real keyboard, sit as you normally would, and type at your own pace. Mistakes are fine, so leave them.</p><div class="row"><button class="go" type="submit">Continue</button></div></form></main>`,
  type: () => `${top()}<main class="deck"><p class="passage" id="passage" aria-label="Passage to copy"></p><textarea id="pad" rows="3" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Type the passage here" placeholder="Copy the passage here"></textarea><div class="meter"><div class="bar" role="progressbar" aria-label="Keys typed" aria-valuemin="0" aria-valuemax="${MIN_KEYS}"><i id="prog"></i></div><span id="count">0 of ${MIN_KEYS} keys</span></div><div class="row"><button class="go" id="finish" disabled>See my result</button><button class="alt" data-go="home">Stop</button></div><p class="tip" id="tip" role="status"></p></main>`,
  result: () => (last ? result(last) : homeHTML()),
  sessions: () => `${top()}<main class="sheet"><h1>Your sessions</h1>${history() || '<p>No sessions are saved on this computer.</p>'}<div class="row"><button class="go" data-go="type">Type again</button><button class="alt" data-go="home">Back to start</button></div></main>`,
  how: () => `${top()}<main class="sheet"><h1>How it works</h1>
<section><h2>What it measures</h2><p>When a key goes down and when it comes up. Parkinson’s affects small, repeated finger movements, and research since 2016 has found that key holds become more uneven. Dwell turns your holds into three numbers for unevenness.</p></section>
<section><h2>How the AI decides</h2><p>A small model learned how to weigh those numbers from 85 people in two clinic studies. Its score is then compared with 9,145 people who typed in web browsers, choosing those closest to you in age and typing speed. A flag means you are in the most uneven 5 of 100.</p></section>
<section><h2>How well it does</h2><table><tr><th>Test</th><th>Result</th></tr><tr><td>People with early or newly diagnosed Parkinson’s it flagged</td><td>14 of 42</td></tr><tr><td>People without it, flagged by mistake in the clinic studies</td><td>0 of 43</td></tr><tr><td>Ordinary browser typists aged 40 and over, flagged</td><td>5.5 of 100</td></tr><tr><td>Ranking people with and without it, across studies (0.5 is chance)</td><td>0.80 and 0.79</td></tr><tr><td>Same, but for people typing at home on their own computers</td><td>0.60, not proven</td></tr></table></section>
<section><h2>What that means for you</h2><p>If about 1 in 100 people your age have Parkinson’s, about 6 of every 100 people Dwell flags would have it. A flag is a reason to repeat the test on other days, and to mention it to a doctor if it keeps happening or you have noticed changes. A clear result does not rule anything out.</p></section>
<section><h2>When not to trust it</h2><ul><li>If you are under 40. The clinic studies were of older adults.</li><li>If an injury, arthritis, another condition, tiredness, alcohol or a medicine is affecting your hands.</li><li>On a new or unusual keyboard.</li><li>On a phone or tablet. Dwell will refuse.</li></ul></section>
<section><h2>The neuron</h2><p>Its shape is a real dopamine cell from the substantia nigra of a mouse, traced under a microscope and shared on NeuroMorpho.Org. The branches and their relative thickness are real. Thickness is exaggerated and small bumps are added so it can be seen. The pulses are a picture of your typing, not a recording of a brain.</p></section>
<div class="row"><button class="go" data-go="about">Start typing</button></div></main>`,
};

const PROBLEMS: Record<Problem, [string, string]> = {
  touch: ['This looks like a touch screen keyboard', 'On-screen keyboards do not report how long a key is held. Please use a computer with a real keyboard.'],
  few: ['Not enough typing yet', `Dwell needs at least ${MIN_KEYS} keys.`],
  broken: ['Too many keys could not be timed', 'Some key releases went missing, often because the window lost focus. Please type it again without switching windows.'],
  stuck: ['The keys came too fast to be typing', 'It looks like keys were held or mashed. Please copy the passage at your own pace.'],
  coarse: ['This keyboard or browser is too imprecise', 'Its timing comes in big steps, so unevenness cannot be measured. Try another browser or keyboard.'],
  robot: ['Every key was held for the same time', 'That is not how hands type, so there is nothing to measure. Please type it yourself.'],
  slow: ['Slower than anyone Dwell can compare you with', 'There are too few people at this pace in the reference, so a result would be a guess.'],
  fast: ['Faster than anyone Dwell can compare you with', 'There are too few people at this pace in the reference, so a result would be a guess.'],
};
const people = () => `<div class="pick people" role="group" aria-label="Real people from the study"><button data-watch="0">Parkinson’s, caught</button><button data-watch="1">Parkinson’s, missed</button><button data-watch="2">Without Parkinson’s</button></div>`;

function result(o: Outcome) {
  const b = band(o.pc), n = clamp(Math.round(o.pc), 1, 99), ex = o.who;
  const title = b === 'flag' ? `More uneven than ${n} of 100 people` : b === 'little' ? 'A little more uneven than most' : 'Within the usual range';
  const body = ex
    ? { flagged: 'This person had newly diagnosed, untreated Parkinson’s. Dwell flagged them.', missed: 'This person had newly diagnosed, untreated Parkinson’s. Dwell missed them, as it did 28 of 42.', without: 'This person did not have Parkinson’s. Dwell did not flag them.' }[ex]
    : o.young ? 'The studies behind Dwell were of older adults, so this is only a demonstration at your age.'
    : b === 'flag' ? 'One uneven session has many ordinary causes, such as tiredness, cold hands or a new keyboard. Repeat it on two other days. If it keeps happening, or you have noticed changes in movement, show the printout to a doctor.'
    : b === 'little' ? 'This is common, and about 15 in 100 people fall here. Repeat it another day if you like.'
    : 'Your key holds are about as even as other people your age who type at your speed. This does not rule anything out.';
  const acts = ex ? '<button class="go" data-go="about">Try it yourself</button><button class="alt" data-go="home">Back to start</button>' : '<button class="go" data-go="type">Type again</button><button class="alt" id="print">Print for a doctor</button>';
  return `${top()}<main class="read ${b}"><section class="lead"><h1>${title}</h1><p>${body}</p>${o.note ? `<p class="alert">${o.note}</p>` : ''}</section>${facts(o.f)}<p class="means">In the clinic studies, the same rule flagged 14 of 42 people with early Parkinson’s and 0 of 43 without. It also flags about 5 in 100 ordinary typists, so most people who are flagged do not have it.</p>${ex ? people() : ''}<div class="row">${acts}</div>
<section><h2>100 people ${ex ? 'around 60 with the same speed' : 'your age and speed'}, from most even to least</h2>${crowd(o.pc)}<p class="key"><span class="k-me">${ex ? 'This person' : 'You'}, at ${n}</span><span class="k-zone">The last 5 are flagged</span></p></section>
<section><h2>Every key ${ex ? 'they' : 'you'} held</h2><canvas id="full" class="strip" aria-hidden="true"></canvas><p>${o.f.n} keys. Height is how long each was held. The band is where most people’s typical hold falls. Coral keys are far from ${ex ? 'their' : 'your'} own middle.</p></section>${ex ? '' : (() => { const h = history(); return h ? `<section><h2>Your sessions</h2>${h}</section>` : ''; })()}</main>`;
}

function history() {
  const s = load();
  if (!s.length) return '';
  const W = 640, H = 190, X = (i: number) => 46 + (s.length === 1 ? 280 : (i * 560) / (s.length - 1)), Y = (p: number) => 14 + (1 - p / 100) * 140, flagged = s.filter((x) => x.pc >= FLAG).length;
  return `<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="${s.length} sessions, ${flagged} flagged"><rect x="40" y="${Y(100)}" width="580" height="${Y(95) - Y(100)}" class="fz"/><path d="M40 ${Y(95)}H620" class="fl"/><path d="M40 ${Y(0)}H620" class="ax"/><text x="0" y="${Y(95) + 6}">95</text><text x="0" y="${Y(50) + 6}">50</text>${s.length > 1 ? `<path class="ln" d="${s.map((x, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(x.pc)}`).join('')}"/>` : ''}${s.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.pc)}" r="7" class="${x.pc >= FLAG ? 'bad' : ''}"><title>${new Date(x.t).toLocaleDateString()}: ${Math.round(x.pc)}</title></circle>`).join('')}<text x="${X(0) - 10}" y="${H - 4}">${new Date(s[0].t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text></svg><p>${s.length < 3 ? `One session says little. Take it on ${3 - s.length} more ${s.length === 2 ? 'day' : 'days'} to see a pattern.` : flagged >= 3 && flagged / s.length > 0.5 ? 'Most of your sessions are flagged. That is worth mentioning to a doctor.' : 'Your sessions do not show a lasting pattern of flags.'}</p><button class="link" id="wipe">Delete my sessions</button>`;
}

// ---------- the neuron (the app works without it) ----------
let scene: Scene;
try { scene = createScene(stage); } catch { stage.classList.add('flat'); scene = { view() {}, fly() {}, send() {}, launch() {}, clear() {}, tick() {} }; let l = 0; const f = (t: number) => { scene.tick(t / 1000, Math.min(0.05, (t - l) / 1000)); l = t; requestAnimationFrame(f); }; requestAnimationFrame(f); }
const home = createHome(scene, person);
scene.tick = (_t, dt) => { if (view !== 'type') home.tick(dt, view === 'result' && last ? last : undefined); };

// ---------- wiring ----------
function paint(v: string, html: string) {
  cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = [];
  home.close(); scene.clear();
  view = v; app.className = 'v-' + v; app.innerHTML = html;
  scrollTo({ top: 0, behavior: 'instant' });
  scene.view(v === 'home' || v === 'type' || v === 'result' ? v : 'page');
  document.title = v === 'home' ? 'Dwell' : 'Dwell: ' + v;
}
function go(v: string) {
  paint(v, screens[v]());
  if (v === 'home') home.open();
  if (v === 'type') startTyping();
  if (v === 'result' && last) requestAnimationFrame(() => strip($<HTMLCanvasElement>('#full'), last!.strokes));
}
const passageText = () => PASSAGES[passage % PASSAGES.length] + ' ' + PASSAGES[(passage + 1) % PASSAGES.length];
function progress(text: string, at: number, k: number, of: number) {
  const box = $('#passage');
  box.innerHTML = `<span class="past">${text.slice(0, at)}</span><mark>${text[at] ?? ''}</mark>${text.slice(at + 1)}`;
  const m = box.querySelector('mark')!;
  box.scrollTop = Math.max(0, m.offsetTop - m.offsetHeight * 1.1);
  $('#prog').style.width = Math.min(100, (k / of) * 100) + '%';
  $('#prog').parentElement!.setAttribute('aria-valuenow', String(Math.min(k, of)));
  $('#count').textContent = `${Math.min(k, of)} of ${of} keys`;
}
let recent: number[] = [];
const pulse = (s: Stroke) => { recent = [...recent.slice(-59), s.hold]; const h = [...recent].sort((a, b) => a - b); scene.send(recent.length > 6 ? clamp((s.hold - h[h.length >> 1]) / 0.03, -4, 8) : 0, s.hold); };

function startTyping() {
  rec = new Recorder(); recent = [];
  const pad = $<HTMLTextAreaElement>('#pad'), text = passageText();
  const draw = () => { const k = clean(rec.strokes).length; progress(text, Math.min(pad.value.length, text.length), k, MIN_KEYS); $<HTMLButtonElement>('#finish').disabled = k < MIN_KEYS; };
  pad.addEventListener('keydown', (e) => rec.keydown(e));
  pad.addEventListener('keyup', (e) => rec.keyup(e));
  pad.addEventListener('input', () => { if (rec.ghost > 20 && rec.ghost > rec.strokes.length) return show('touch'); draw(); });
  pad.addEventListener('blur', () => rec.blur());
  for (const t of ['paste', 'drop']) pad.addEventListener(t, (e) => { e.preventDefault(); $('#tip').textContent = 'Pasting does not count. Please type the passage.'; });
  rec.onStroke = (s) => { pulse(s); cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
  $('#finish').onclick = finish;
  draw();
  pad.focus({ preventScroll: true });
}
/** Replays a real recording through the typing screen, sped up, then scores it. One key in five is drawn as a pulse, or they would blur together. */
function watch(i: number, now = false) {
  const s = person(i), f = features(s);
  const done = () => { last = { pc: percentile(score(f, HELDOUT), 60, f.gap_med, HELDOUT), f, strokes: s, d: devs(s), who: examples[i].kind as Outcome['who'] }; go('result'); };
  if (now) return done();
  paint('type', screens.type()); recent = [];
  const pad = $<HTMLTextAreaElement>('#pad'), text = passageText(), speed = (s[s.length - 1].press - s[0].press) / 11;
  pad.disabled = true; pad.placeholder = 'Replaying a real, anonymous recording';
  progress(text, 0, 0, s.length);
  s.forEach((k, n) => timers.push(window.setTimeout(() => { if (n % 5 === 0) pulse(k); progress(text, Math.min(text.length - 1, Math.round((n + 1) * 1.2)), n + 1, s.length); if (n === s.length - 1) timers.push(window.setTimeout(done, 700)); }, ((k.press - s[0].press) / speed) * 1000)));
}
function show(p: Problem) {
  paint('problem', `${top()}<main class="sheet problem" role="alert"><h1>${PROBLEMS[p][0]}</h1><p>${PROBLEMS[p][1]}</p><p>No result was made from this session${load().length ? ', and your earlier sessions are unchanged' : ''}.</p><div class="row">${p === 'touch' ? '' : '<button class="go" data-go="type">Try again</button>'}<button class="alt" data-watch="0">Watch a real person</button></div></main>`);
}
function finish() {
  const p = rec.problem();
  if (p) return show(p);
  const strokes = clean(rec.strokes), f = features(strokes), pc = percentile(score(f), age, f.gap_med), young = age < 40, notes = [];
  if (hands) notes.push('You said something else affects your hands. That alone can make typing uneven, so do not read this as a sign of Parkinson’s.');
  if (age > AGE_RANGE[1] + 10) notes.push('Few people your age are in the reference, so you are compared with people around 70.');
  last = { pc, f, strokes, d: devs(strokes), young, note: notes.join(' ') };
  passage++;
  // A session that cannot be judged fairly is shown but not kept in the trend.
  if (!young && !hands) save([...load(), { t: Date.now(), age, n: f.n, pc: Math.round(pc * 10) / 10, f }]);
  go('result');
}

document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.go === 'type' && !age) return go('about');
  if (b.dataset.go) return go(b.dataset.go);
  if (b.dataset.watch) return watch(Number(b.dataset.watch));
  if (b.id === 'full') return watch(home.who(), true);
  if (b.id === 'print') print();
  if (b.id === 'wipe' && confirm('Delete all saved sessions on this computer?')) { try { localStorage.removeItem('dwell'); } catch { /* nothing saved */ } go('home'); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const a = Number($<HTMLInputElement>('#age').value);
  if (!(a >= 5 && a <= 110)) return;
  age = a; hands = $<HTMLInputElement>('#hands').checked;
  try { localStorage.setItem('dwell.age', String(a)); } catch { /* not remembered */ }
  go('type');
});
let rz = 0;
addEventListener('resize', () => { clearTimeout(rz); rz = window.setTimeout(() => { const c = document.querySelector<HTMLCanvasElement>('canvas#full'); if (c && last) strip(c, last.strokes); }, 150); });
go('home');
