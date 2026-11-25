// The four stops of the home flight. The text is pinned; scrolling moves the camera through the neuron.
import { features, type Stroke } from './core/features';
import type { Scene } from './scene';
import { clamp, devs, reduced, rng } from './util';

export const HELD = 'Only timing is measured, never which letters, and nothing leaves this computer.';
export const HONEST = 'A screening aid for adults, not a diagnosis. It misses many people, and most people it flags do not have Parkinson’s.';
export const homeHTML = () => `<main class="home">
<section><div class="panel"><h1>Every key press starts here</h1><p>This is the shape of a real dopamine cell, the kind Parkinson’s destroys. Press any key and watch it fire.</p><div class="row"><button class="go" data-go="about">Start typing</button><button class="alt" data-ch="1">See how it works</button></div><p class="fine">${HELD} ${HONEST} Cell traced from a mouse, NeuroMorpho.Org.</p></div></section>
<section><div class="panel"><h2>Keep a steady beat</h2><p>Hold any key, or the button, ten times. Try to make every hold the same length. A longer hold sends a longer pulse.</p><div class="ten" id="ten" role="img" aria-label="Your ten holds"></div><p class="say" id="tenSay" aria-live="polite"></p><div class="row"><button class="go" id="hold">Hold me</button><button class="alt" id="again" hidden>Start over</button></div></div></section>
<section class="right"><div class="panel"><h2>Three real people</h2><p>Each line is one key they held. The nerve is firing to their rhythm.</p><div class="pick" role="group" aria-label="Choose a person"><button data-p="2" aria-pressed="true">Without Parkinson’s</button><button data-p="0" aria-pressed="false">Parkinson’s, caught</button><button data-p="1" aria-pressed="false">Parkinson’s, missed</button></div><canvas id="strip" aria-hidden="true"></canvas><p class="say" id="pSay" aria-live="polite"></p><div class="row"><button class="alt" id="full">See the full result</button></div></div></section>
<section><div class="panel"><h2>What a flag means</h2><label for="prev">If <b id="prevN">1</b> in 100 people have Parkinson’s</label><input id="prev" type="range" min="1" max="10" value="1"><canvas id="dots" aria-hidden="true"></canvas><p class="say" id="dotSay" aria-live="polite"></p><div class="row"><button class="go" data-go="about">Start typing</button><button class="alt" data-watch="0">Watch a full test</button></div></div></section></main>`;

const $ = <E extends HTMLElement>(q: string) => document.querySelector<E>(q);
type Beat = { hold: number; d: number };
export function createHome(scene: Scene, person: (i: number) => Stroke[]) {
  let on = false, ch = 0, at = -1, who = 2, taps: number[] = [], downAt = 0, pick: Beat[] = [], pi = 0, hist: Beat[] = [], acc = 0, next = 0.3, ai = 0, gliding = 0, busy = false, quiet = 0, lastD = 0;
  const calm = person(2), calmD = devs(calm);

  // ---- stop 1: ten holds
  const drawTen = () => {
    const el = $('#ten'); if (!el) return;
    const top = Math.max(0.2, ...taps) * 1.12, ms = taps.map((t) => Math.round(t * 1000));
    el.innerHTML = Array.from({ length: 10 }, (_, i) => `<i${taps[i] === undefined ? ' class="no"' : ''} style="height:${taps[i] === undefined ? 4 : Math.max(5, (taps[i] / top) * 100)}%"></i>`).join('');
    $('#tenSay')!.textContent = !taps.length ? 'Start when you are ready.' : taps.length < 10 ? `${taps.length} of 10. That one was ${ms[ms.length - 1]} ms.` : `Your shortest was ${Math.min(...ms)} ms and your longest ${Math.max(...ms)} ms. Dwell does this with 300 presses while you type.`;
    $('#again')!.hidden = taps.length < 10;
  };
  const tap = (hold: number) => {
    const m = [...taps].sort((x, y) => x - y)[taps.length >> 1] ?? hold;
    scene.launch(taps.length > 2 ? (hold - m) / 0.03 : 0, hold);
    if (taps.length < 10) { taps.push(hold); drawTen(); }
  };
  // ---- stop 2: three people
  const choose = (n: number) => {
    const st = person(n), dv = devs(st), v = Math.round(features(st).wsd * 1000), say = $('#pSay');
    who = n; pick = st.map((k, i) => ({ hold: k.hold, d: dv[i] })); pi = 80; hist = pick.slice(0, 80); scene.clear();
    document.querySelectorAll<HTMLElement>('.pick button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.p === String(n))));
    if (say) say.textContent = `Their holds vary by ${v} ms${n === 1 ? ', inside the usual range, so Dwell missed them. It missed 28 of 42.' : `. Most people fall between 17 and 44.${n === 0 ? ' Dwell flagged them.' : ''}`}`;
  };
  const canvas = (q: string) => {
    const el = $<HTMLCanvasElement>(q); if (!el || !el.clientWidth) return null;
    const d = Math.min(2, devicePixelRatio || 1), w = el.clientWidth, h = el.clientHeight;
    if (el.width !== Math.round(w * d) || el.height !== Math.round(h * d)) { el.width = Math.round(w * d); el.height = Math.round(h * d); }
    const x = el.getContext('2d')!; x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h); return { x, w, h };
  };
  const strip = () => {
    const k = canvas('#strip'); if (!k) return;
    const step = 8, n = Math.floor(k.w / step), show = hist.slice(-n);
    show.forEach((s, i) => { const bh = clamp(s.hold / 0.36, 0.04, 1) * k.h, j = i + n - show.length; k.x.fillStyle = Math.abs(s.d) > 1.5 ? '#ff7a5e' : '#8df0d8'; k.x.globalAlpha = 0.35 + (0.65 * j) / n; k.x.beginPath(); k.x.roundRect(j * step, k.h - bh, 4.5, bh, 2.2); k.x.fill(); });
    k.x.globalAlpha = 1;
  };
  // ---- stop 3: 1,000 people. Caught 14 of 42 with it; flagged 5.5 in 100 without (README)
  const place = (() => { const o = Array.from({ length: 1000 }, (_, i) => i), q = rng(4); for (let i = 999; i > 0; i--) { const j = Math.floor(q() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; })();
  const dots = () => {
    const el = $<HTMLInputElement>('#prev'); if (!el) return;
    const pr = Number(el.value), have = pr * 10, hit = Math.round((have * 14) / 42), fa = Math.round((1000 - have) * 0.055), k = canvas('#dots');
    $('#prevN')!.textContent = String(pr);
    $('#dotSay')!.textContent = `Out of 1,000 people, Dwell would flag about ${hit + fa}. About ${hit} of them have Parkinson’s (red). ${have - hit} more have it and are missed (rings). A flag means test again and ask a doctor.`;
    if (!k) return;
    const cols = k.w < 420 ? 40 : 50, s = k.w / cols;
    for (let r = 0; r < 1000; r++) {
      const i = place[r], X = ((i % cols) + 0.5) * s, Y = (Math.floor(i / cols) + 0.5) * (k.h / (1000 / cols));
      k.x.beginPath(); k.x.arc(X, Y, r < have ? s * 0.4 : r < have + fa ? s * 0.34 : s * 0.15, 0, 6.3);
      if (r >= hit && r < have) { k.x.strokeStyle = '#ff6f52'; k.x.lineWidth = 1.5; k.x.stroke(); } else { k.x.fillStyle = r < hit ? '#ff6f52' : r < have + fa ? '#8df0d8' : '#3f8f8c'; k.x.fill(); }
    }
  };

  // ---- one flick, one stop: the page glides the camera to the next place and waits there
  const secs = () => document.querySelectorAll<HTMLElement>('.home section');
  const stopAt = () => { const s = secs()[0]; return s ? Math.round(scrollY / s.offsetHeight) : 0; };
  const glide = (k: number) => {
    const s = secs()[k]; if (!s) return;
    const a = scrollY, z = s.offsetTop, id = ++gliding, t0 = performance.now();
    if (reduced || matchMedia('(pointer:coarse)').matches) { scrollTo({ top: z, behavior: reduced ? 'instant' : 'smooth' }); return; }
    const step = (n: number) => { if (id !== gliding || !on) return; const u = clamp((n - t0) / 1150, 0, 1), e = u < 0.5 ? 4 * u ** 3 : 1 - (2 - 2 * u) ** 3 / 2; scrollTo({ top: a + (z - a) * e, behavior: 'instant' }); if (u < 1) requestAnimationFrame(step); else busy = false; };
    busy = true; requestAnimationFrame(step);
  };
  addEventListener('wheel', (e) => { if (!on || e.ctrlKey) return; e.preventDefault(); const d = Math.abs(e.deltaY), fresh = e.timeStamp - quiet > 160 || d > lastD * 1.6 + 12; quiet = e.timeStamp; lastD = d; if (busy || d < 4 || !fresh) return; glide(clamp(stopAt() + Math.sign(e.deltaY), 0, 3)); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!on) return;
    const t = e.target as HTMLElement;
    if (e.key === ' ' && !e.repeat && t.id === 'hold') { downAt = e.timeStamp; t.classList.add('on'); }
    if (t.tagName === 'INPUT') return;
    const dir = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 0;
    if (dir) { e.preventDefault(); if (!busy) glide(clamp(stopAt() + dir, 0, 3)); }
  });
  const release = (e: Event) => { const h = $('#hold'); if (!h?.classList.contains('on')) return; h.classList.remove('on'); if (e.type !== 'pointercancel') tap(clamp((e.timeStamp - downAt) / 1000, 0.02, 0.9)); };
  addEventListener('pointerdown', (e) => { const h = (e.target as HTMLElement).closest<HTMLElement>('#hold'); if (h) { downAt = e.timeStamp; h.classList.add('on'); } });
  addEventListener('pointerup', release); addEventListener('pointercancel', release);
  addEventListener('keyup', (e) => { if (e.key === ' ') release(e); });
  addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).closest?.('#hold')) e.preventDefault(); });
  addEventListener('input', (e) => { if ((e.target as HTMLElement).id === 'prev') dots(); });
  addEventListener('resize', () => requestAnimationFrame(dots));
  addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b || !on) return; if (b.dataset.ch) glide(Number(b.dataset.ch)); if (b.dataset.p) choose(Number(b.dataset.p)); if (b.id === 'again') { taps = []; drawTen(); $('#hold')?.focus({ preventScroll: true }); } });

  // ---- any key, or a tap on the cell, fires it
  const down = new Map<string, number>(); let recent: number[] = [];
  const fire = (hold: number) => { if (ch === 1) return tap(hold); recent = [...recent.slice(-30), hold]; const m = [...recent].sort((x, y) => x - y)[recent.length >> 1]; scene.send(recent.length > 6 ? clamp((hold - m) / 0.03, -4, 8) : 0, hold); };
  addEventListener('keydown', (e) => { if (!on || e.repeat || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || (e.key === ' ' && (e.target as HTMLElement).closest('button'))) return; if (e.key === ' ') e.preventDefault(); down.set(e.code, e.timeStamp); });
  addEventListener('keyup', (e) => { const t = down.get(e.code); if (t === undefined) return; down.delete(e.code); if (on) fire(clamp((e.timeStamp - t) / 1000, 0.02, 0.9)); });
  addEventListener('pointerdown', (e) => { if (on && (e.target as HTMLElement).closest('.stage')) down.set('p', e.timeStamp); });
  addEventListener('pointerup', (e) => { const t = down.get('p'); down.delete('p'); if (t !== undefined && on) fire(clamp((e.timeStamp - t) / 1000, 0.02, 0.9)); });
  addEventListener('pointercancel', () => down.delete('p')); addEventListener('blur', () => down.clear());

  const lay = () => {
    const s = secs(), p = s.length ? clamp(scrollY / s[0].offsetHeight, 0, s.length - 1) : 0;
    if (p === at) return; at = p; scene.fly(p);
    s.forEach((el, n) => { const g = p - n, k = clamp(1 - Math.abs(g) * 2.3, 0, 1), pn = el.firstElementChild as HTMLElement; pn.style.opacity = String(k); pn.style.transform = reduced ? '' : `translateX(${-g * 26}vw)`; pn.style.visibility = k > 0.01 ? 'visible' : 'hidden'; });
    const now = Math.round(p); if (now !== ch) { ch = now; acc = 0; }
  };
  return {
    who: () => who,
    open() { on = true; taps = []; ch = 0; at = -1; gliding++; busy = false; down.clear(); drawTen(); choose(2); lay(); requestAnimationFrame(dots); },
    close() { on = false; gliding++; },
    /** plays the waiting rhythm; `s` is whoever is on screen elsewhere */
    tick(dt: number, s?: { strokes: Stroke[]; d: number[] }) {
      acc += dt;
      if (on) lay();
      if (on && ch === 2) { if (acc > next) { acc = 0; const k = pick[pi++ % pick.length]; scene.send(k.d, k.hold); hist.push(k); if (hist.length > 160) hist.shift(); next = 0.26 + Math.max(0, Math.abs(k.d) - 1) * 0.12; } strip(); }
      else if (!(on && ch === 1) && acc > next) { acc = 0; const st = s?.strokes ?? calm, dv = s?.d ?? calmD, k = ai++ % st.length; scene.send(dv[k], st[k].hold); next = 0.34 + (s ? Math.max(0, Math.abs(dv[k]) - 1) * 0.16 : 0); }
    },
  };
}
