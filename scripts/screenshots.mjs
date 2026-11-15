// Screenshots for the README and the website, taken from the running app with the demo company.
//   npm run seed:demo      (fresh data/qasa.sqlite)
//   npm run dev            (API :4417 and app :5173)
//   node scripts/screenshots.mjs           (add --art to re-render only the branded images)
// Uses a local Edge or Chrome in headless mode. It only runs against the Meroxis demo company, because it starts the
// free month, adds a few sales this month, and for the users page adds a user and switches sign-in on for a moment,
// with throwaway passwords made up for this run (sign-in is switched off again at the end).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
const APP = 'http://localhost:5173/';
const API = 'http://127.0.0.1:4417';
const PORT = 9333;
const SCALE = 1.5;

const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].find(existsSync);
if (!browser) throw new Error('No Edge or Chrome found');

// ——— the app's API, for ids and the Pro setup ———
let cookie = '';
const api = async (method, url, body) => {
  const headers = { 'content-type': 'application/json', 'x-qasa-client': '1', ...(cookie ? { cookie } : {}) };
  const res = await fetch(API + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (url === '/api/auth/login' && res.ok) cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
};
const settings = await api('GET', '/api/settings');
if (settings.companyName.en !== 'Meroxis Company') throw new Error('This script only runs against the demo company (npm run seed:demo).');
// a company that hasn't said what it does opens on that question (1.1): the demo company trades
if (settings.businessTypes === null) await api('PUT', '/api/settings', { businessTypes: ['trade'] });
// the welcome tour opens once for each person on the home page: these pictures are taken as if they had seen it
const people = ['owner', ...(await api('GET', '/api/users')).map((u) => u.name)];
// the free month, as a new install starts it on its first run: every page, and invoices without the "Made with Qasa
// ERP" line (the users page needs it too)
if ((await api('GET', '/api/plan')).trialAvailable) await api('POST', '/api/plan/trial', {});

/** A few sales this month (once), so Home has this month's sales and profit: the sample company's own trade is older. */
async function thisMonthsSales() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if ((await api('GET', '/api/invoices?kind=sale&status=posted')).some((v) => v.date.startsWith(month))) return;
  const day = (d) => `${month}-${String(Math.min(d, now.getDate())).padStart(2, '0')}`;
  const [main] = await api('GET', '/api/warehouses');
  const items = Object.fromEntries((await api('GET', '/api/items')).map((i) => [i.code, i]));
  const customers = Object.fromEntries((await api('GET', '/api/parties?type=customer')).map((p) => [p.name, p]));
  // a credit sale to one of the sample customers, or a cash sale into the main safe
  const sell = async (date, customer, lines) => {
    const sale = await api('POST', '/api/invoices', {
      kind: 'sale', date, warehouseId: main.id, currency: 'IQD', rateX100: 100, discount: 0,
      ...(customer ? { partyId: customers[customer].id, payment: 'credit' } : { payment: 'cash', cashAccountCode: '1811' }),
      lines: lines.map(([code, n]) => ({ itemId: items[code].id, qtyMilli: n * 1000, unitPrice: items[code].salePrice }))
    });
    await api('POST', `/api/invoices/${sale.id}/post`, {});
  };
  await sell(day(3), 'Raz', [['PV-550', 6], ['INV-5K', 1]]);
  await sell(day(8), null, [['CU-PIPE', 15], ['SRV-INST', 1]]);
  await sell(day(12), 'Mer', [['AC-18', 1], ['SRV-INST', 1]]);
  await sell(day(now.getDate()), null, [['PV-550', 2]]);
}
await thisMonthsSales();

const invoice = (await api('GET', '/api/invoices?kind=sale&status=posted')).find((v) => v.number === 'INV-2026-0002');
const receipt = (await api('GET', '/api/entries?type=receipt&status=approved')).find((e) => e.currency === 'IQD');
const ac = (await api('GET', '/api/items')).find((i) => i.code === 'AC-18');
if (!invoice || !receipt || !ac) throw new Error('Demo data is missing; run npm run seed:demo first.');

/** The users page as an office sees it: two people signed in, with separate duties. */
async function proSetup() {
  const password = { owner: randomUUID(), raz: randomUUID() };
  let users = await api('GET', '/api/users');
  if (!users.some((u) => u.username === 'raz')) await api('POST', '/api/users', { username: 'raz', name: 'Raz', roles: ['checker', 'approver'] });
  users = await api('GET', '/api/users');
  const owner = users[0];
  await api('POST', `/api/users/${owner.id}/password`, { password: password.owner });
  await api('POST', `/api/users/${users.find((u) => u.username === 'raz').id}/password`, { password: password.raz });
  const me = await api('GET', '/api/auth/me');
  if (!me.separateDuties) await api('PUT', '/api/auth/separate-duties', { on: true });
  await api('PUT', '/api/auth/signin', { on: true });
  await api('POST', '/api/auth/login', { username: 'raz', password: password.raz });
  await api('POST', '/api/auth/login', { username: owner.username, password: password.owner });
  // the browser takes the owner's session on the app's own address, where the page asks the API (through the dev
  // server's proxy, which may not pass a sign-in sent from the page)
  const at = cookie.indexOf('=');
  await send('Network.setCookie', { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: APP, httpOnly: true, sameSite: 'Strict' });
  await send('Page.navigate', { url: APP });
  await sleep(800);
  const ok = await evaluate(`fetch('/api/auth/me', { headers: { 'x-qasa-client': '1' } }).then((r) => r.json()).then((m) => !!m.user)`);
  if (!ok) throw new Error('The browser could not sign in');
}

const SHOTS = [
  { file: 'dashboard.png', lang: 'en', path: '' },
  { file: 'dashboard-ar.png', lang: 'ar', path: '' },
  { file: 'dashboard-ku.png', lang: 'ku', path: '' },
  { file: 'invoice-ar.png', lang: 'ar', path: `invoice/${invoice.id}`, height: 1040 },
  { file: 'voucher-ku.png', lang: 'ku', path: `entry/${receipt.id}`, height: 1000 },
  { file: 'invoice-ku.png', lang: 'ku', path: `invoice/${invoice.id}`, height: 1040 },
  { file: 'trial-balance-ar.png', lang: 'ar', path: 'trial-balance' },
  { file: 'final-accounts.png', lang: 'en', path: 'final-accounts', height: 1320 },
  { file: 'stock-card.png', lang: 'en', path: `item/${ac.id}` },
  { setup: proSetup },
  { file: 'users.png', lang: 'en', path: 'users', height: 980 }
];

// ——— a headless browser over the DevTools protocol ———
// a browser left from an earlier run on the same port would take these pictures with its own settings
const stale = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false);
if (stale) throw new Error(`A browser already listens on port ${PORT}: close it first`);
const profile = mkdtempSync(join(tmpdir(), 'qasa-shots-'));
const proc = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run',
  '--disable-extensions', '--force-color-profile=srgb', '--window-size=1440,900', 'about:blank'
], { stdio: 'ignore' });

let page;
for (let i = 0; i < 50 && !page; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
  } catch { /* not up yet */ }
}
if (!page) throw new Error('The browser did not start');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) => new Promise((resolveMsg, reject) => {
  const id = ++seq;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolveMsg(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function size(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
}

async function capture(file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(out, file), Buffer.from(data, 'base64'));
  console.log(`docs/screenshots/${file}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
mkdirSync(out, { recursive: true });

const artOnly = process.argv.includes('--art');
let lang = '';
for (const shot of artOnly ? [] : SHOTS) {
  if (shot.setup) { await shot.setup(); continue; }
  await size(1440, shot.height ?? 900);
  if (shot.lang !== lang) {
    // the app keeps its language and digits on the computer (localStorage)
    await send('Page.navigate', { url: APP });
    await sleep(800);
    // (the light theme whatever Windows uses, and no first-steps card: these are a working company's screens)
    await evaluate(`localStorage.setItem('qasa.lang', '${shot.lang}'); localStorage.setItem('qasa.digits', 'western'); localStorage.removeItem('qasa.user');
      localStorage.setItem('qasa.theme', 'light'); localStorage.setItem('qasa.firstSteps.hidden', '1');
      ${JSON.stringify(people)}.forEach((p) => localStorage.setItem('qasa.tour.done.' + p, '1')); true`);
    lang = shot.lang;
  }
  await send('Page.navigate', { url: `${APP}#/${shot.path}` });
  await evaluate('location.reload(); true');
  await sleep(600);
  // wait for the page's data and fonts, then let it settle
  await evaluate(`new Promise((done) => { const t0 = Date.now(); (function wait() {
    const main = document.querySelector('main');
    if ((main && main.innerText.trim().length > 40) || Date.now() - t0 > 8000) document.fonts.ready.then(() => setTimeout(done, 900)); else setTimeout(wait, 150);
  })(); })`);
  await capture(shot.file);
}

// ——— the branded images, from HTML templates next to this script ———
// social images: GitHub's preview (English) and, when the website repository sits next to this one, a share image
// per language for the site (WhatsApp, Facebook and the rest show these)
const website = join(root, 'website', 'assets');
const ARTS = [
  { file: 'hero.png', page: 'hero.html', width: 1280, height: 720, scale: 2 },
  { file: 'languages.png', page: 'languages.html', width: 1280, height: 500, scale: 2 },
  { file: 'social-preview.png', page: 'social.html?lang=en', width: 1280, height: 640, scale: 1 },
  ...(existsSync(website) ? ['ar', 'en', 'ku'].map((l) => ({ file: `og-${l}.png`, page: `social.html?lang=${l}`, width: 1200, height: 630, scale: 1, dir: website })) : [])
];
for (const art of ARTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: art.width, height: art.height, deviceScaleFactor: art.scale, mobile: false });
  const [page, query] = art.page.split('?');
  await send('Page.navigate', { url: pathToFileURL(join(root, 'scripts', 'screenshot-art', page)).href + (query ? `?${query}` : '') });
  await sleep(500);
  await evaluate('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(art.dir ?? out, art.file), Buffer.from(data, 'base64'));
  console.log(art.dir ? `website/assets/${art.file}` : `docs/screenshots/${art.file}`);
}

// the website's galleries: light WebP copies, 1200 wide, in the app's 16:10 proportions
if (existsSync(website)) {
  const shots = join(website, 'shots');
  mkdirSync(shots, { recursive: true });
  const GALLERY = ['dashboard', 'final-accounts', 'stock-card', 'dashboard-ar', 'invoice-ar', 'trial-balance-ar', 'dashboard-ku', 'voucher-ku', 'invoice-ku'];
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 750, deviceScaleFactor: 1, mobile: false });
  for (const name of GALLERY) {
    await send('Page.navigate', { url: pathToFileURL(join(root, 'scripts', 'screenshot-art', 'frame.html')).href + `?img=${name}.png` });
    await sleep(400);
    await evaluate(`new Promise((r) => { const i = document.getElementById('shot'); i.complete ? r() : i.onload = r; })`);
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 80, fromSurface: true });
    writeFileSync(join(shots, `${name}.webp`), Buffer.from(data, 'base64'));
    console.log(`website/assets/shots/${name}.webp`);
  }
}

// leave the demo company as it was: no sign-in
if (cookie) await api('PUT', '/api/auth/signin', { on: false });

ws.close();
const exited = new Promise((r) => proc.once('exit', r));
// the browser is closed through its own DevTools address: Edge may start itself again as another process, which
// proc.kill() would leave running (and listening on the port)
try {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const whole = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => whole.addEventListener('open', r, { once: true }));
  whole.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
} catch { /* already gone */ }
proc.kill();
await Promise.race([exited, sleep(5000)]);
// the browser may hold its profile a moment longer; a leftover temp folder does no harm
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch { /* left in the temp folder */ }
