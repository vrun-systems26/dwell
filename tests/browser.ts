// Drives the built app with real key events.  npx vite preview --port 5190 & npx tsx tests/browser.ts [url]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = 'tests/shots';
mkdirSync(out, { recursive: true });
const R: { check: string; ok: boolean; detail: string }[] = [];
const log = (check: string, ok: boolean, detail = '') => { R.push({ check, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', check, detail); };
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript('globalThis.__name = (f) => f');
const hosts = new Set<string>(); let writes = 0;
ctx.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); if (r.method() !== 'GET') writes++; });
const p = await ctx.newPage(); const errs: string[] = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('dialog', (d) => d.accept());
const go = (v: string) => p.locator(`[data-go="${v}"]`).first().click();
const start = async (age: number, hands = false) => { await p.goto(url); await p.locator('.home [data-go=about]').first().click(); await p.fill('#age', String(age)); if (hands) await p.check('#hands'); await p.locator('form .go').click(); await p.waitForSelector('#pad'); };
const issues = (q: Page) => q.evaluate(() => {
  const lum = (c: number[]) => { const a = c.map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  const pc = (s: string) => { const m = s.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const bad: string[] = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('overflow ' + document.documentElement.scrollWidth);
  const w = document.createTreeWalker(document.querySelector('#app')!, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const e = w.currentNode.parentElement!, t = w.currentNode.textContent!.trim(); if (!t || e.closest('svg,:disabled') || !e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue; const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize); let bg = [2, 27, 35]; for (let n: Element | null = e; n; n = n.parentElement) { const c = pc(getComputedStyle(n).backgroundColor); if (c[3] > 0.9) { bg = c; break; } } const f = lum(pc(cs.color).slice(0, 3)), g = lum(bg.slice(0, 3)), cr = (Math.max(f, g) + 0.05) / (Math.min(f, g) + 0.05); if (cr < (fs >= 24 ? 3 : 4.5)) bad.push(`${cr.toFixed(1)} ${t.slice(0, 18)}`); if (fs < 17) bad.push('small ' + t.slice(0, 14)); }
  for (const e of document.querySelectorAll('button')) { const r = e.getBoundingClientRect(); if (r.width && !e.classList.contains('link') && r.height < 43.5) bad.push('tap ' + e.textContent!.trim().slice(0, 14)); }
  return [...new Set(bad)];
});
const LET = 'etaoinshrdlu';
/** type with the given holds and gaps (seconds); returns how far the captured holds are from the intended ones */
async function type(n: number, hold: (i: number) => number, gap: (i: number) => number) {
  await p.locator('#pad').focus();
  const wait = async (ms: number) => { const t = performance.now(); if (ms > 3) await new Promise((r) => setTimeout(r, ms - 2)); while (performance.now() - t < ms) { /* spin */ } };
  for (let i = 0; i < n; i++) { const k = LET[i % LET.length], h = hold(i); await p.keyboard.down(k); await wait(h * 1000); await p.keyboard.up(k); await wait(Math.max(15, (gap(i) - h) * 1000)); }
}
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const nrm = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(6.2832 * rnd());

const ready = (q: Page) => q.waitForSelector('#stage[data-ready="1"]', { state: 'attached', timeout: 30000 });
const stop = (q: Page) => q.evaluate(() => [...document.querySelectorAll<HTMLElement>('.panel')].findIndex((e) => Number(e.style.opacity) > 0.9));
const fits = (q: Page) => q.evaluate(() => { const e = [...document.querySelectorAll<HTMLElement>('.panel')].find((e) => Number(e.style.opacity) > 0.9)!, r = [...e.children].map((c) => c.getBoundingClientRect()), t = Math.min(...r.map((a) => a.top)), z = Math.max(...r.map((a) => a.bottom)); return t >= document.querySelector('.brand')!.getBoundingClientRect().bottom - 8 && z <= innerHeight ? '' : `${Math.round(t)} to ${Math.round(z)} of ${innerHeight}`; });
const jump = async (q: Page, k: number) => { await q.evaluate((k) => scrollTo({ top: k * document.querySelector<HTMLElement>('section')!.offsetHeight, behavior: 'instant' }), k); await q.waitForTimeout(900); };

await p.goto(url); await ready(p); await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}/home.png` });
log('home: no layout, contrast or size issues', !(await issues(p)).length, (await issues(p)).join('; '));
// the flight, used like a person would
for (const [dv, w, h] of [['computer', 1440, 900], ['small laptop', 1280, 640], ['phone', 390, 844], ['small phone', 360, 640]] as const) {
  const touch = dv.includes('phone'), cx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); await cx.addInitScript('globalThis.__name = (f) => f');
  const q = await cx.newPage(), bad: string[] = [], want = (c: unknown, m: string) => { if (!c) bad.push(m); }; q.on('pageerror', (e) => bad.push(e.message));
  await q.goto(url); await ready(q); await q.waitForTimeout(900);
  want((await stop(q)) === 0, 'start'); want(!(await fits(q)), 'start fits ' + (await fits(q)));
  if (!touch) { await q.mouse.move(w / 2, h / 2); await q.mouse.wheel(0, 100); } else { const c = await cx.newCDPSession(q); await c.send('Input.synthesizeScrollGesture', { x: 180, y: Math.round(h * 0.85), yDistance: -Math.round(h * 0.6), speed: 1600 }); }
  await q.waitForTimeout(2100); want((await stop(q)) === 1, 'one flick reaches stop 1, got ' + (await stop(q)));
  for (let i = 0; i < 10; i++) { if (!touch && i < 5) { await q.keyboard.down('k'); await q.waitForTimeout(90); await q.keyboard.up('k'); } else { const r = (await q.locator('#hold').boundingBox())!; await q.mouse.move(r.x + 40, r.y + 20); await q.mouse.down(); await q.waitForTimeout(100); await q.mouse.up(); } await q.waitForTimeout(50); }
  await q.waitForTimeout(150); want(/shortest was \d+ ms/.test(await q.locator('#tenSay').innerText()), 'ten holds'); want(!(await fits(q)), 'stop 1 fits ' + (await fits(q))); bad.push(...(await issues(q))); await q.screenshot({ path: `${out}/stop1-${dv.replace(' ', '')}.png` });
  await jump(q, 2); want(!(await fits(q)), 'stop 2 fits ' + (await fits(q)));
  for (const [i, re] of [[0, /flagged them/], [1, /missed 28 of 42/], [2, /24 ms/]] as const) { await q.locator(`[data-p="${i}"]`).click(); want(re.test(await q.locator('#pSay').innerText()), 'person ' + i); want(!(await fits(q)), `person ${i} fits ` + (await fits(q))); }
  bad.push(...(await issues(q))); await q.screenshot({ path: `${out}/stop2-${dv.replace(' ', '')}.png` });
  await jump(q, 3); await q.locator('#prev').focus(); for (let i = 0; i < 4; i++) await q.keyboard.press('ArrowRight'); want(/flag about 69\. About 17/.test(await q.locator('#dotSay').innerText()), 'slider'); want(!(await fits(q)), 'stop 3 fits ' + (await fits(q))); bad.push(...(await issues(q))); await q.screenshot({ path: `${out}/stop3-${dv.replace(' ', '')}.png` });
  await jump(q, 2); await q.locator('[data-p="0"]').click(); await q.locator('#full').click(); want((await q.locator('.read.flag').count()) === 1, 'full result'); await q.locator('.brand').click(); want((await stop(q)) === 0, 'brand goes home');
  log(`home flight: ${dv}`, !bad.length, [...new Set(bad)].join('; ')); await cx.close();
}
// example people (held-out model), with the replay
await p.goto(url); await p.waitForTimeout(400); await jump(p, 3); await p.locator('[data-watch="0"]').first().click(); await p.waitForTimeout(6000); await p.screenshot({ path: `${out}/replay.png` }); await p.waitForSelector('main.read', { timeout: 15000 });
for (const [i, want] of [[0, 'flag'], [1, 'usual'], [2, 'usual']] as const) {
  if (i) { await p.locator(`.people [data-watch="${i}"]`).click(); await p.waitForSelector('main.deck'); await p.waitForSelector('main.read', { timeout: 15000 }); }
  log(`example ${i}: ${['flagged patient', 'missed patient', 'person without'][i]}`, (await p.locator('main.read').getAttribute('class'))!.includes(want), await p.locator('h1').innerText());
  if (i === 0) { await p.waitForTimeout(3500); await p.screenshot({ path: `${out}/result-flag.png` }); await p.screenshot({ path: `${out}/result-flag-full.png`, fullPage: true }); log('result: no issues', !(await issues(p)).length, (await issues(p)).join('; ')); }
}
await p.goto(url); await go('how'); await p.waitForTimeout(2500); log('how it works: no issues', !(await issues(p)).length, (await issues(p)).join('; ')); await p.screenshot({ path: `${out}/how.png` }); await go('about'); await p.waitForTimeout(800); log('before you type: no issues', !(await issues(p)).length, (await issues(p)).join('; ')); await p.screenshot({ path: `${out}/about.png` });

// ordinary typing, real key events
await start(55);
log('cannot finish early', await p.locator('#finish').isDisabled()); await ready(p); await p.waitForTimeout(1500);
await type(120, () => Math.max(0.05, 0.11 + 0.022 * nrm()), () => 0.14 + 0.07 * rnd());
await p.screenshot({ path: `${out}/typing.png` });
log('typing: no issues', !(await issues(p)).length, (await issues(p)).join('; '));
await p.evaluate(() => { const d = new DataTransfer(); d.setData('text', 'x'); document.querySelector('#pad')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })); });
log('paste refused with a message', /Pasting/.test(await p.locator('#tip').innerText()));
await type(185, () => Math.max(0.05, 0.11 + 0.022 * nrm()), () => 0.14 + 0.07 * rnd());
await p.locator('#finish').click(); await p.waitForTimeout(400);
const a = await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!));
log('ordinary typing: scored and saved', (await p.locator('main.read').count()) === 1 && a.length === 1, `percentile ${a[0]?.pc}, spread ${(a[0]?.f.wsd * 1000).toFixed(1)} ms (typed with 22.0)`);
log('saved session holds no keystrokes or text', JSON.stringify(a).length < 400 && !/press|hold|text/.test(JSON.stringify(a)), JSON.stringify(a[0]).slice(0, 120));
await p.screenshot({ path: `${out}/result-usual.png`, fullPage: true });

// uneven typing
await start(55);
await type(305, () => Math.min(0.5, Math.max(0.03, 0.14 * Math.exp(0.6 * nrm()))), () => 0.16 + 0.08 * rnd());
await p.locator('#finish').click(); await p.waitForTimeout(400);
const c = await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!));
log('very uneven typing: flagged', c.length === 2 && c[1].pc >= 95, `percentile ${c[1]?.pc}`);
await p.reload(); await go('sessions'); log('sessions kept after reload', (await p.locator('.hist circle').count()) === 2); await p.waitForTimeout(700); log('sessions page: no issues', !(await issues(p)).length, (await issues(p)).join('; ')); await p.screenshot({ path: `${out}/sessions.png` });
// a young person and a hand problem are shown, not saved
await start(15); await p.evaluate(() => { const pad = document.querySelector('#pad')!; let t = 1000; for (let i = 0; i < 320; i++) { for (const [type, at] of [['keydown', t], ['keyup', t + 80 + (i * 37) % 60]] as const) { const e = new KeyboardEvent(type, { key: 'a', code: 'Key' + (i % 2 ? 'A' : 'B'), bubbles: true }); Object.defineProperty(e, 'timeStamp', { value: at }); pad.dispatchEvent(e); } t += 190; } });
await p.waitForTimeout(200); await p.locator('#finish').click(); log('under 40: demonstration only, not saved', /demonstration/.test(await p.locator('.lead').innerText()) && (await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!).length)) === 2);
const fake = (n: number, gap: number, hold: string, extra = '') => p.evaluate(`(() => { const pad = document.querySelector('#pad'); let t = 1000; for (let i = 0; i < ${n}; i++) { for (const [type, at] of [['keydown', t], ['keyup', t + (${hold})]]) { const e = new KeyboardEvent(type, { key: 'a', code: i % 2 ? 'KeyA' : 'KeyB', bubbles: true }); Object.defineProperty(e, 'timeStamp', { value: at }); pad.dispatchEvent(e); } t += ${gap}; } ${extra} })()`);
await start(60, true); await fake(320, 190, '80+(i*37)%60'); await p.waitForTimeout(200); await p.locator('#finish').click(); log('other hand condition: warned, not saved', /affects your hands/.test(await p.locator('.lead').innerText()) && (await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!).length)) === 2);
// failures
for (const [name, n, gap, hold, want] of [['identical holds', 320, 190, '100', /same time/], ['mashing', 320, 30, '20+(i*7)%9', /too fast to be typing/], ['too slow', 320, 900, '80+(i*37)%60', /Slower/], ['coarse timer', 320, 190, '50*(1+i%4)', /imprecise/]] as const) {
  await start(60); await fake(n, gap, hold); await p.waitForTimeout(200); await p.locator('#finish').click(); await p.waitForTimeout(150);
  log(`refused: ${name}`, want.test(await p.locator('.problem').innerText().catch(() => '')) && (await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!).length)) === 2);
}
await p.screenshot({ path: `${out}/refused.png` });
await start(60);
await p.evaluate(() => { const pad = document.querySelector<HTMLTextAreaElement>('#pad')!; for (let i = 0; i < 30; i++) { pad.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true } as any)); } pad.dispatchEvent(new Event('input', { bubbles: true })); });
log('refused: on-screen keyboard', /touch screen/.test(await p.locator('.problem').innerText().catch(() => '')));
await p.evaluate(() => localStorage.setItem('dwell', '{oops')); await p.goto(url); log('damaged saved data does not crash', (await p.locator('.home h1').count()) === 1);
await p.evaluate((v) => localStorage.setItem('dwell', JSON.stringify(v)), c); await p.reload(); await go('sessions'); await p.locator('#wipe').click(); log('delete my sessions', (await p.evaluate(() => localStorage.getItem('dwell'))) === null);
// phone layout
await p.setViewportSize({ width: 390, height: 844 });
const bad: string[] = [];
for (const v of ['home', 'how', 'about']) { await p.goto(url); if (v !== 'home') await go(v); await p.waitForTimeout(1500); bad.push(...(await issues(p))); await p.screenshot({ path: `${out}/m-${v}.png`, fullPage: v === 'how' }); }
await p.goto(url); await p.waitForTimeout(400); await jump(p, 2); await p.locator('[data-p="0"]').click(); await p.locator('#full').click(); await p.waitForTimeout(2500); bad.push(...(await issues(p))); await p.screenshot({ path: `${out}/m-result.png` });
log('phone layout: no issues', !bad.length, bad.join('; '));
// print, and a computer without 3D graphics
await p.setViewportSize({ width: 1280, height: 860 }); await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/print.png`, fullPage: true }); log('printout hides the scene and buttons', !(await p.locator('.stage').isVisible()) && !(await p.locator('.read .go').first().isVisible())); await p.emulateMedia({ media: 'screen' });
{ const cx = await b.newContext({ viewport: { width: 1280, height: 860 } }); await cx.addInitScript('globalThis.__name=(f)=>f;HTMLCanvasElement.prototype.getContext=new Proxy(HTMLCanvasElement.prototype.getContext,{apply(t,c,a){return String(a[0]).startsWith("webgl")?null:Reflect.apply(t,c,a)}})'); const q = await cx.newPage(), er: string[] = []; q.on('pageerror', (e) => er.push(e.message)); await q.goto(url); await q.waitForTimeout(800); await q.mouse.wheel(0, 100); await q.waitForTimeout(1800); await jump(q, 2); await q.locator('#full').click(); await q.waitForTimeout(300); log('works without 3D graphics', (await q.locator('.read').count()) === 1 && !er.length, er.join('; ')); await cx.close(); }
log('network: only its own files, nothing sent', hosts.size === 1 && writes === 0, [...hosts].join(' '));
log('no page errors', !errs.length, errs.slice(0, 2).join('; '));
writeFileSync('tests/browser-results.json', JSON.stringify({ when: new Date().toISOString(), results: R, hosts: [...hosts] }, null, 1));
console.log(`${R.filter((x) => x.ok).length}/${R.length} passed`);
await b.close();
void readFileSync;
