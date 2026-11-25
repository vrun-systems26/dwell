import '@fontsource/gochi-hand/400.css';
import '@fontsource/patrick-hand/400.css';
import '@fontsource/pangolin/400.css';
import './style.css';
import { MIN_KEYS, Recorder, type Problem } from './core/capture';
import { clean, features, type Features, type Stroke } from './core/features';
import { AGE_RANGE, band, FLAG, HELDOUT, MAIN, percentile, score, TYPICAL, type Model } from './core/model';
import examples from './data/examples.json';

// Public-domain openings. Copying a passage is the task the clinic studies used.
const PASSAGES = [
  "Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer's wife. Their house was small, for the lumber to build it had to be carried by wagon many miles. There were four walls, a floor and a roof, which made one room; and this room contained a rusty looking cookstove, a cupboard for the dishes, a table, three or four chairs, and the beds.",
  'The Mole had been working very hard all the morning, spring-cleaning his little home. First with brooms, then with dusters; then on ladders and steps and chairs, with a brush and a pail of whitewash; till he had dust in his throat and eyes, and splashes of whitewash all over his black fur, and an aching back and weary arms.',
  'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations?',
];

interface Session { t: number; age: number; n: number; pc: number; f: Features }
interface Outcome { pc: number; f: Features; strokes: Stroke[]; model: Model; age: number; who?: 'flagged' | 'missed' | 'without'; young?: boolean; note?: string }

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const load = (): Session[] => { try { const v = JSON.parse(localStorage.getItem('dwell') ?? '[]'); return Array.isArray(v) ? v.filter((s) => Number.isFinite(s?.pc) && Number.isFinite(s?.t) && s.f) : []; } catch { return []; } };
const save = (s: Session[]) => { try { localStorage.setItem('dwell', JSON.stringify(s.slice(-60))); } catch { /* private mode: results still show */ } };

let rec = new Recorder();
let age = Number(localStorage.getItem('dwell.age')) || 0;
let hands = false; // something else may affect the hands
let passage = load().length % PASSAGES.length;
let last: Outcome | null = null;
let raf = 0;

const icon = (d: string, s = 24) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  keys: '<path d="M3 7h18v11H3zM6.5 10.5h.1M10 10.5h.1M13.5 10.5h.1M17 10.5h.1M7.5 14.5h9"/>', lock: '<path d="M6 11h12v9H6zM8.6 11V8a3.4 3.4 0 0 1 6.8 0v3"/>', warn: '<path d="M12 4 21 20H3zM12 10v4.6M12 17.2v.2"/>',
  people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3.6 2.8-5.4 5.5-5.4s4.9 1.8 5.5 5.4M15.5 6.2a3 3 0 0 1 0 5.6M17 14c2 .5 3.2 2.200 3.600 5"/>', again: '<path d="M19 12a7 7 0 1 1-2.2-5.1M19 4v4.4h-4.4"/>', print: '<path d="M7 9V4h10v5M7 17H4V9h16v8h-3M7 14h10v6H7z"/>', book: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>', bin: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.500V12l3 2"/>',
};
const app = $('#app');
const top = (back = true) => `<header class="top"><button class="brand" data-go="home">Dwell</button>${back ? '' : `<nav><button data-go="examples">Example people</button><button data-go="how">How it works</button></nav>`}</header>`;

// ---------- drawings ----------
function strip(cv: HTMLCanvasElement, s: Stroke[], opt: { live?: boolean; color?: string } = {}) {
  const D = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * D; cv.height = H * D;
  const x = cv.getContext('2d')!;
  x.scale(D, D);
  const step = opt.live ? 7 : Math.max(2.2, W / Math.max(s.length, 1)), show = opt.live ? s.slice(-Math.floor(W / step)) : s;
  const y = (h: number) => H - 8 - Math.min(h, 0.32) / 0.32 * (H - 16);
  const [lo, hi] = [TYPICAL.med[0], TYPICAL.med[4]];
  x.fillStyle = '#dfe8f8'; x.fillRect(0, y(hi), W, y(lo) - y(hi));
  x.strokeStyle = opt.color ?? '#1c2f63'; x.lineCap = 'round'; x.lineWidth = Math.min(3, step * 0.55);
  show.forEach((k, i) => { const px = i * step + step / 2; x.beginPath(); x.moveTo(px, H - 6); x.lineTo(px, y(k.hold)); x.stroke(); });
}

/** 100 people of your age and speed, steadiest on the left; you are the red mark. */
function crowd(pc: number) {
  const n = 100, me = Math.min(99, Math.max(0, Math.round(pc) - 1));
  const p = Array.from({ length: n }, (_, i) => { const x = 8 + (i % 25) * 29.6, y = 22 + Math.floor(i / 25) * 46; return i === me ? `<g class="me"><circle cx="${x}" cy="${y}" r="8.5"/><path d="M${x - 10} ${y + 25}c1-11 5-15 10-15s9 4 10 15z"/></g>` : `<g class="${i >= FLAG ? 'zone' : i >= 80 ? 'mid' : ''}"><circle cx="${x}" cy="${y}" r="6"/><path d="M${x - 8} ${y + 20}c1-8 4-11 8-11s7 3 8 11z"/></g>`; }).join('');
  return `<svg class="crowd" viewBox="-6 4 740 188" role="img" aria-label="Among 100 people of your age and typing speed, about ${me} type more evenly than you">${p}</svg>`;
}
function ranges(f: Features, who = 'You') {
  const R: [keyof Features, string, string][] = [['wsd', 'Steadiness', 'how much key holds vary within a short stretch'], ['adj', 'Key to key', 'how much the hold changes from one key to the next'], ['iqr', 'Spread', 'the range covering the middle half of the holds']];
  return `<div class="ranges">${R.map(([k, t, d]) => {
    const [a, b, c, e, g] = TYPICAL[k], top = Math.max(g * 1.25, f[k] * 1.1), P = (v: number) => (v / top) * 100;
    return `<div class="range"><h3>${t}</h3><p>${d}</p><div class="track" role="img" aria-label="${who} ${(f[k] * 1000).toFixed(0)} milliseconds, most people aged 45 to 75 ${(a * 1000).toFixed(0)} to ${(g * 1000).toFixed(0)}"><i class="wide" style="left:${P(a)}%;width:${P(g) - P(a)}%"></i><i class="half" style="left:${P(b)}%;width:${P(e) - P(b)}%"></i><i class="mid" style="left:${P(c)}%"></i><b style="left:${P(f[k])}%"></b></div><small><strong>${who}: ${(f[k] * 1000).toFixed(0)} ms</strong> Most people aged 45 to 75: ${(a * 1000).toFixed(0)} to ${(g * 1000).toFixed(0)} ms</small></div>`;
  }).join('')}</div>`;
}
const hero = () => {
  // a hand-drawn row of key holds: even, then uneven
  const hs = [46, 50, 44, 52, 47, 49, 45, 51, 48, 46, 50, 47, 74, 31, 66, 40, 92, 28, 60, 83, 36, 70];
  return `<svg class="hero-art" viewBox="0 0 560 330" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><g class="wob"><path d="M20 300h520" stroke-width="2.4"/>${hs.map((h, i) => `<path class="bar" style="--i:${i}" ${i > 11 ? 'stroke="#b12c1e"' : ''} stroke-width="9" d="M${36 + i * 23.200} 292v${-h * 2.500}"/>`).join('')}<path d="M300 40v248" stroke-dasharray="3 9" stroke-width="2"/></g><g class="cap"><text x="80" y="150">steady</text><text x="372" y="34" class="r">uneven</text></g></svg>`;
};

// ---------- screens ----------
const screens: Record<string, () => string> = {
  home: () => `${top(false)}<main class="home"><section class="hero"><div><h1>Your typing has a rhythm. Dwell listens to it.</h1><p class="sub">Type for about two minutes. Dwell measures how long you hold each key and checks for the kind of unevenness seen in early Parkinson's disease.</p><button class="btn fill big" data-go="about">${icon(I.keys, 28)}Start typing</button><p class="fine">${icon(I.lock, 20)}<span>Only timing is measured, never which letters. Nothing leaves this computer.</span></p><p class="fine">${icon(I.warn, 20)}<span>A screening aid for adults, not a diagnosis. It misses many people, and most people it flags do not have Parkinson's.</span></p></div>${hero()}</section>${history()}</main>`,

  about: () => `${top()}<main class="narrow"><h1>Before you type</h1><form class="card box" id="about"><label>Your age<input id="age" type="number" inputmode="numeric" min="5" max="110" required value="${age || ''}"></label><p class="muted">Typing changes with age, so you are compared with people your age.</p><label class="tick"><input type="checkbox" id="hands" ${hands ? 'checked' : ''}><span>Something else affects my hands right now, such as an injury, arthritis, numbness, another condition, or a medicine that causes shaking</span></label><p class="muted">Use a real keyboard, sit as you normally would, and type at your own pace. Mistakes are fine, so leave them.</p><button class="btn fill" type="submit">${icon(I.keys)}Continue</button></form></main>`,

  type: () => `${top()}<main class="typing"><p class="passage" id="passage" aria-label="Passage to copy"></p><textarea id="pad" class="box" rows="5" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Type the passage here" placeholder="Click here and copy the passage"></textarea><div class="meter"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${MIN_KEYS}"><i id="prog"></i></div><span id="count">0 of ${MIN_KEYS} keys</span></div><canvas id="live" class="strip" aria-hidden="true"></canvas><p class="muted">Each line is one key. Its height is how long you held it. The shaded band is where most people's typical hold falls.</p><div class="row"><button class="btn fill" id="finish" disabled>See my result</button><button class="btn box" data-go="home">Stop</button></div><p class="warnline" id="tip" role="status"></p></main>`,

  result: () => last ? result(last) : screens.home(),

  examples: () => `${top()}<main class="narrow wide"><h1>Three real people</h1><p class="sub">Anonymous recordings from a clinic study of newly diagnosed, untreated Parkinson's and people without it. Each was scored by a version of the model that never saw their study.</p><div class="people">${examples.map((e, i) => `<article class="card box"><i class="tape"></i><h2>${{ flagged: 'Parkinson’s, flagged', missed: 'Parkinson’s, missed', without: 'No Parkinson’s' }[e.kind]}</h2><canvas class="strip" data-ex="${i}" aria-hidden="true"></canvas><p>${{ flagged: 'Their holds jump around from key to key.', missed: 'Their typing looks ordinary. Dwell does not catch everyone.', without: 'Their holds stay in a narrow band.' }[e.kind]}</p><button class="btn box" data-ex="${i}">Score this person</button></article>`).join('')}</div><p class="fine">Chosen by rule, not by looks: the middle person among those flagged, among those missed, and among those without Parkinson's. Data: neuroQWERTY MIT-CSXPD, Giancardo et al. 2016, ODC-By 1.0.</p></main>`,

  how: () => `${top()}<main class="narrow"><h1>How it works</h1><section class="card box"><h2>What it measures</h2><p>When a key goes down and when it comes up. Parkinson's affects small, repeated finger movements, and research since 2016 has found that key holds become more uneven. Dwell turns your holds into three numbers for unevenness.</p></section><section class="card box"><h2>How the AI decides</h2><p>A small model learned how to weigh those numbers from 85 people in two clinic studies. Its score is then compared with 9,145 people who typed in web browsers, choosing those closest to you in age and typing speed. A flag means you are in the most uneven 5 of 100.</p></section><section class="card box"><h2>How well it does</h2><table><tr><th>Test</th><th>Result</th></tr><tr><td>People with early or newly diagnosed Parkinson's it flagged</td><td>14 of 42</td></tr><tr><td>People without it, flagged by mistake in the clinic studies</td><td>0 of 43</td></tr><tr><td>Ordinary browser typists aged 40+, flagged</td><td>5.5 of 100</td></tr><tr><td>Ranking people with and without it, across studies (0.5 is chance)</td><td>0.80 and 0.79</td></tr><tr><td>Same, but for people typing at home on their own computers</td><td>0.60, not proven</td></tr></table></section><section class="card box"><h2>What that means for you</h2><p>If about 1 in 100 people your age have Parkinson's, about 6 of every 100 people Dwell flags would have it. A flag is a reason to repeat the test on other days, and to mention it to a doctor if it keeps happening or you have noticed changes. A clear result does not rule anything out.</p></section><section class="card box"><h2>When not to trust it</h2><ul><li>If you are under 40. The clinic studies were of older adults.</li><li>If an injury, arthritis, another condition, tiredness, alcohol or a medicine is affecting your hands.</li><li>On a new or unusual keyboard.</li><li>On a phone or tablet. Dwell will refuse.</li></ul></section></main>`,
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

function result(o: Outcome) {
  const b = band(o.pc), p = Math.round(o.pc), n = Math.min(99, Math.max(1, p));
  const ex = o.who;
  const title = b === 'flag' ? `More uneven than ${p >= 99 ? '99' : n} of 100` : b === 'little' ? 'A little more uneven than most' : 'Within the usual range';
  const body = ex
    ? { flagged: 'This person had newly diagnosed, untreated Parkinson’s, and Dwell flagged them.', missed: 'This person had newly diagnosed, untreated Parkinson’s, and Dwell missed them. In the clinic studies it missed 28 of 42.', without: 'This person did not have Parkinson’s, and Dwell did not flag them.' }[ex]
    : o.young ? 'The studies behind Dwell were of older adults, so this is only a demonstration at your age.'
    : b === 'flag' ? 'One uneven session has many ordinary causes, such as tiredness, cold hands or a new keyboard. Repeat it on two other days. If it keeps happening, or you have noticed changes in movement, show the printout to a doctor.'
    : b === 'little' ? 'This is common, and about 15 in 100 people fall here. Repeat it another day if you like.'
    : 'Your key holds are about as even as other people your age who type at your speed. This does not rule anything out.';
  return `${top()}<main class="result ${b}"><section class="lead"><h1>${title}</h1><p class="sub">${body}</p>${o.note ? `<p class="alert">${icon(I.warn, 22)}<span>${o.note}</span></p>` : ''}</section><section class="card box"><i class="tape"></i><h2>100 people ${ex ? "around 60 with the same speed" : "your age and speed"}, from most even to least</h2>${crowd(o.pc)}<p class="key"><span class="k-me">${ex ? "This person" : "You"}, at ${n}</span><span class="k-zone">The last 5 are flagged</span></p></section><div class="left"><section class="card box"><i class="tape"></i><h2>Every key ${ex ? "they" : "you"} held</h2><canvas id="full" class="strip tall" aria-hidden="true"></canvas><p class="muted">${o.f.n} keys. Height is how long each was held. The shaded band is where most people's typical hold falls.</p></section><section class="card box means"><i class="tape"></i><h2>What a flag means</h2><p>In the clinic studies, the same rule flagged <strong>14 of 42</strong> people with early Parkinson's and <strong>0 of 43</strong> without. Among ordinary browser typists over 40 it flags <strong>5.5 in 100</strong>. Parkinson's is uncommon, so <strong>most people who are flagged do not have it</strong>.</p></section></div><section class="card box"><i class="tape"></i><h2>What makes up the score</h2>${ranges(o.f, ex ? 'Them' : 'You')}</section><div class="row">${ex ? `<button class="btn fill" data-go="about">${icon(I.keys)}Try it yourself</button><button class="btn box" data-go="examples">${icon(I.people)}Other people</button>` : `<button class="btn fill" data-go="type">${icon(I.again)}Type again</button><button class="btn box" id="print">${icon(I.print)}Print for a doctor</button>`}</div>${ex ? '' : history()}</main>`;
}

function history() {
  const s = load();
  if (!s.length) return '';
  const W = 640, H = 190, X = (i: number) => 46 + (s.length === 1 ? 280 : (i * 560) / (s.length - 1)), Y = (p: number) => 14 + (1 - p / 100) * 140;
  const flagged = s.filter((x) => x.pc >= FLAG).length;
  return `<section class="card box hist"><i class="tape"></i><h2>Your sessions</h2><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${s.length} sessions, ${flagged} flagged"><rect x="40" y="${Y(100)}" width="580" height="${Y(95) - Y(100)}" class="fz"/><path d="M40 ${Y(95)}H620" class="fl"/><path d="M40 ${Y(0)}H620" class="ax"/><text x="0" y="${Y(95) + 6}">95</text><text x="0" y="${Y(50) + 6}">50</text>${s.length > 1 ? `<path class="ln" d="${s.map((x, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(x.pc)}`).join('')}"/>` : ''}${s.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.pc)}" r="6" class="${x.pc >= FLAG ? 'bad' : ''}"><title>${new Date(x.t).toLocaleDateString()}: ${Math.round(x.pc)}</title></circle>`).join('')}<text x="${X(0) - 10}" y="${H - 4}">${new Date(s[0].t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text></svg><p>${s.length < 3 ? `One session says little. Take it on ${3 - s.length} more ${s.length === 2 ? 'day' : 'days'} to see a pattern.` : flagged >= 3 && flagged / s.length > 0.5 ? 'Most of your sessions are flagged. That is worth mentioning to a doctor.' : 'Your sessions do not show a lasting pattern of flags.'}</p><button class="link" id="wipe">${icon(I.bin, 20)}Delete my sessions</button></section>`;
}

// ---------- wiring ----------
function go(v: string) {
  cancelAnimationFrame(raf);
  app.className = 'v-' + v;
  app.innerHTML = screens[v]();
  scrollTo(0, 0);
  if (v === 'type') startTyping();
  if (v === 'result' && last) requestAnimationFrame(() => strip($<HTMLCanvasElement>('#full'), last!.strokes));
  if (v === 'examples') requestAnimationFrame(() => document.querySelectorAll<HTMLCanvasElement>('canvas[data-ex]').forEach((c) => { const e = examples[Number(c.dataset.ex)]; strip(c, e.press.slice(0, 150).map((p, i) => ({ press: p, hold: e.hold[i] })), { color: e.pd ? '#b12c1e' : '#1c2f63' }); }));
  document.title = v === 'home' ? 'Dwell' : 'Dwell: ' + v;
}

function startTyping() {
  rec = new Recorder();
  const pad = $<HTMLTextAreaElement>('#pad'), text = PASSAGES[passage % PASSAGES.length] + ' ' + PASSAGES[(passage + 1) % PASSAGES.length];
  const draw = () => {
    const n = Math.min(pad.value.length, text.length);
    $('#passage').innerHTML = `<span class="past">${text.slice(0, n)}</span><mark>${text[n] ?? ''}</mark>${text.slice(n + 1)}`;
    const box = $('#passage'), m = box.querySelector('mark')!;
    box.scrollTop = Math.max(0, m.offsetTop - box.offsetTop - m.offsetHeight * 1.2);
    const k = clean(rec.strokes).length;
    $('#prog').style.width = Math.min(100, (k / MIN_KEYS) * 100) + '%';
    $('#count').textContent = `${Math.min(k, MIN_KEYS)} of ${MIN_KEYS} keys`;
    $<HTMLButtonElement>('#finish').disabled = k < MIN_KEYS;
    strip($<HTMLCanvasElement>('#live'), rec.strokes, { live: true });
  };
  pad.addEventListener('keydown', (e) => rec.keydown(e));
  pad.addEventListener('keyup', (e) => rec.keyup(e));
  pad.addEventListener('input', () => {
    if (rec.ghost > 20 && rec.ghost > rec.strokes.length) return show('touch');
    draw();
  });
  pad.addEventListener('blur', () => rec.blur());
  for (const t of ['paste', 'drop']) pad.addEventListener(t, (e) => { e.preventDefault(); $('#tip').textContent = 'Pasting does not count. Please type the passage.'; });
  rec.onStroke = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
  $('#finish').onclick = finish;
  draw();
  pad.focus();
}

function show(p: Problem) {
  app.className = 'v-problem';
  app.innerHTML = `${top()}<main class="narrow"><section class="card box problem" role="alert"><i class="tape"></i><h1>${icon(I.warn, 34)}${PROBLEMS[p][0]}</h1><p class="sub">${PROBLEMS[p][1]}</p><p class="muted">No result was made from this session${load().length ? ', and your earlier sessions are unchanged' : ''}.</p><div class="row">${p === 'touch' ? '' : `<button class="btn fill" data-go="type">${icon(I.again)}Try again</button>`}<button class="btn box" data-go="examples">${icon(I.people)}See example people</button></div></section></main>`;
}

function finish() {
  const p = rec.problem();
  if (p) return show(p);
  const strokes = clean(rec.strokes), f = features(strokes), pc = percentile(score(f), age, f.gap_med);
  const young = age < 40;
  const notes = [];
  if (hands) notes.push('You said something else affects your hands. That alone can make typing uneven, so do not read this as a sign of Parkinson’s.');
  if (age > AGE_RANGE[1] + 10) notes.push('Few people your age are in the reference, so you are compared with people around 70.');
  last = { pc, f, strokes, model: MAIN, age, young, note: notes.join(' ') };
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
  if (b.dataset.ex) {
    const x = examples[Number(b.dataset.ex)], s = clean(x.press.map((p, i) => ({ press: p, hold: x.hold[i] }))), f = features(s);
    last = { pc: percentile(score(f, HELDOUT), 60, f.gap_med, HELDOUT), f, strokes: s, model: HELDOUT, age: 60, who: x.kind as Outcome['who'] };
    return go('result');
  }
  if (b.id === 'print') print();
  if (b.id === 'wipe' && confirm('Delete all saved sessions on this computer?')) { localStorage.removeItem('dwell'); go('home'); }
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
addEventListener('resize', () => { clearTimeout(rz); rz = window.setTimeout(() => { const c = document.querySelector<HTMLCanvasElement>('#full'); if (c && last) strip(c, last.strokes); }, 150); });
go('home');
