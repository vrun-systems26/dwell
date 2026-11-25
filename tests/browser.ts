// Drives the built app with real key events.  npx vite preview --port 5190 & npx tsx tests/browser.ts [url]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = 'tests/shots';
mkdirSync(out, { recursive: true });
const R: { check: string; ok: boolean; detail: string }[] = [];
const log = (check: string, ok: boolean, detail = '') => { R.push({ check, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', check, detail); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript('globalThis.__name = (f) => f');
const hosts = new Set<string>(); let writes = 0;
ctx.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); if (r.method() !== 'GET') writes++; });
const p = await ctx.newPage(); const errs: string[] = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('dialog', (d) => d.accept());
const go = (v: string) => p.locator(`[data-go="${v}"]`).first().click();
const start = async (age: number, hands = false) => { await p.goto(url); await p.locator('.btn.big').click(); await p.fill('#age', String(age)); if (hands) await p.check('#hands'); await p.locator('form .btn').click(); await p.waitForSelector('#pad'); };
const issues = (q: Page) => q.evaluate(() => {
  const lum = (c: number[]) => { const a = c.map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  const pc = (s: string) => { const m = s.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const bad: string[] = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('overflow ' + document.documentElement.scrollWidth);
  const w = document.createTreeWalker(document.querySelector('#app')!, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const e = w.currentNode.parentElement!, t = w.currentNode.textContent!.trim(); if (!t || e.closest('svg,.fill,:disabled') || !e.getClientRects().length) continue; const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize); let bg = [251, 250, 242]; for (let n: Element | null = e; n; n = n.parentElement) { const c = pc(getComputedStyle(n).backgroundColor); if (c[3] > 0.9) { bg = c; break; } } const f = lum(pc(cs.color).slice(0, 3)), g = lum(bg.slice(0, 3)), cr = (Math.max(f, g) + 0.05) / (Math.min(f, g) + 0.05); if (cr < (fs >= 24 ? 3 : 4.5)) bad.push(`${cr.toFixed(1)} ${t.slice(0, 18)}`); if (fs < 17) bad.push('small ' + t.slice(0, 14)); }
  for (const e of document.querySelectorAll('button')) { const r = e.getBoundingClientRect(); if (r.width && r.height < 43.5) bad.push('tap ' + e.textContent!.trim().slice(0, 14)); }
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

await p.goto(url); await p.waitForTimeout(2600);
await p.screenshot({ path: `${out}/home.png` });
log('home: no layout, contrast or size issues', !(await issues(p)).length, (await issues(p)).join('; '));
await p.screenshot({ path: `${out}/home-full.png`, fullPage: true });

// example people (held-out model)
await go('examples'); await p.waitForTimeout(500); await p.screenshot({ path: `${out}/examples.png`, fullPage: true });
log('examples: no issues', !(await issues(p)).length, (await issues(p)).join('; '));
for (const [i, want] of [[0, 'flag'], [1, 'usual'], [2, 'usual']] as const) {
  await p.locator('button[data-ex]').nth(i).click(); await p.waitForTimeout(400);
  log(`example ${i}: ${['flagged patient', 'missed patient', 'person without'][i]}`, (await p.locator('main.result').getAttribute('class'))!.includes(want), await p.locator('h1').innerText());
  if (i === 0) { await p.screenshot({ path: `${out}/result-flag.png`, fullPage: true }); log('result: no issues', !(await issues(p)).length, (await issues(p)).join('; ')); }
  await go('examples');
}
await p.goto(url); await go('how'); log('how it works: no issues', !(await issues(p)).length, (await issues(p)).join('; ')); await p.screenshot({ path: `${out}/how.png`, fullPage: true });

// ordinary typing, real key events
await start(55);
log('cannot finish early', await p.locator('#finish').isDisabled());
await type(120, () => Math.max(0.05, 0.11 + 0.022 * nrm()), () => 0.14 + 0.07 * rnd());
await p.screenshot({ path: `${out}/typing.png` });
log('typing: no issues', !(await issues(p)).length, (await issues(p)).join('; '));
await p.evaluate(() => { const d = new DataTransfer(); d.setData('text', 'x'); document.querySelector('#pad')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })); });
log('paste refused with a message', /Pasting/.test(await p.locator('#tip').innerText()));
await type(185, () => Math.max(0.05, 0.11 + 0.022 * nrm()), () => 0.14 + 0.07 * rnd());
await p.locator('#finish').click(); await p.waitForTimeout(400);
const a = await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!));
log('ordinary typing: scored and saved', (await p.locator('main.result').count()) === 1 && a.length === 1, `percentile ${a[0]?.pc}, spread ${(a[0]?.f.wsd * 1000).toFixed(1)} ms (typed with 22.0)`);
log('saved session holds no keystrokes or text', JSON.stringify(a).length < 400 && !/press|hold|text/.test(JSON.stringify(a)), JSON.stringify(a[0]).slice(0, 120));
await p.screenshot({ path: `${out}/result-usual.png`, fullPage: true });

// uneven typing
await start(55);
await type(305, () => Math.min(0.5, Math.max(0.03, 0.14 * Math.exp(0.6 * nrm()))), () => 0.16 + 0.08 * rnd());
await p.locator('#finish').click(); await p.waitForTimeout(400);
const c = await p.evaluate(() => JSON.parse(localStorage.getItem('dwell')!));
log('very uneven typing: flagged', c.length === 2 && c[1].pc >= 95, `percentile ${c[1]?.pc}`);
await p.reload(); log('sessions kept after reload', (await p.locator('.hist circle').count()) === 2);
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
await p.evaluate(() => localStorage.setItem('dwell', '{oops')); await p.goto(url); log('damaged saved data does not crash', (await p.locator('.btn.big').count()) === 1);
await p.evaluate((v) => localStorage.setItem('dwell', JSON.stringify(v)), c); await p.reload(); await p.locator('#wipe').click(); log('delete my sessions', (await p.evaluate(() => localStorage.getItem('dwell'))) === null);
// phone layout
await p.setViewportSize({ width: 390, height: 844 });
const bad: string[] = [];
for (const v of ['home', 'examples', 'how']) { await p.goto(url); if (v !== 'home') await go(v); await p.waitForTimeout(500); bad.push(...(await issues(p))); await p.screenshot({ path: `${out}/m-${v}.png`, fullPage: true }); }
await p.goto(url); await go('examples'); await p.locator('button[data-ex]').first().click(); await p.waitForTimeout(400); bad.push(...(await issues(p))); await p.screenshot({ path: `${out}/m-result.png`, fullPage: true });
log('phone layout: no issues', !bad.length, bad.join('; '));
log('network: only its own files, nothing sent', hosts.size === 1 && writes === 0, [...hosts].join(' '));
log('no page errors', !errs.length, errs.slice(0, 2).join('; '));
writeFileSync('tests/browser-results.json', JSON.stringify({ when: new Date().toISOString(), results: R, hosts: [...hosts] }, null, 1));
console.log(`${R.filter((x) => x.ok).length}/${R.length} passed`);
await b.close();
void readFileSync;
