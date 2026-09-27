// Screenshots for the README and the website, taken from the running app with the demo company.
//   npm run seed:demo      (fresh data/qasa.sqlite)
//   npm run dev            (API :4417 and app :5173)
//   node scripts/screenshots.mjs           (add --art to re-render only the branded images)
// Uses a local Edge or Chrome in headless mode. It only runs against the Meroxis demo company, because for the
// users page it starts the Pro trial, adds a user and switches sign-in on for a moment, with throwaway
// passwords made up for this run (sign-in is switched off again at the end).
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

const invoice = (await api('GET', '/api/invoices?kind=sale&status=posted')).find((v) => v.number === 'INV-2026-0002');
const receipt = (await api('GET', '/api/entries?type=receipt&status=approved')).find((e) => e.currency === 'IQD');
const ac = (await api('GET', '/api/items')).find((i) => i.code === 'AC-18');
if (!invoice || !receipt || !ac) throw new Error('Demo data is missing; run npm run seed:demo first.');

/** The users page as an office sees it: two people signed in, with separate duties. */
async function proSetup() {
  const password = { owner: randomUUID(), raz: randomUUID() };
  const plan = await api('GET', '/api/plan');
  if (plan.trialAvailable) await api('POST', '/api/plan/trial', {});
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
  // the browser signs in on the app's own address, so its cookie belongs there
  await send('Page.navigate', { url: APP });
  await sleep(800);
  const ok = await evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-qasa-client': '1' },
    body: JSON.stringify({ username: ${JSON.stringify(owner.username)}, password: ${JSON.stringify(password.owner)} }) }).then((r) => r.ok)`);
  if (!ok) throw new Error('The browser could not sign in');
}

const SHOTS = [
  { file: 'dashboard.png', lang: 'en', path: '' },
  { file: 'dashboard-ar.png', lang: 'ar', path: '' },
  { file: 'dashboard-ku.png', lang: 'ku', path: '' },
  { file: 'invoice-ar.png', lang: 'ar', path: `invoice/${invoice.id}`, height: 1040 },
  { file: 'voucher-ku.png', lang: 'ku', path: `entry/${receipt.id}`, height: 1000 },
  { file: 'trial-balance-ar.png', lang: 'ar', path: 'trial-balance' },
  { file: 'final-accounts.png', lang: 'en', path: 'final-accounts', height: 1320 },
  { file: 'stock-card.png', lang: 'en', path: `item/${ac.id}` },
  { setup: proSetup },
  { file: 'users.png', lang: 'en', path: 'users', height: 980 }
];

// ——— a headless browser over the DevTools protocol ———
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
    await evaluate(`localStorage.setItem('qasa.lang', '${shot.lang}'); localStorage.setItem('qasa.digits', 'western'); localStorage.removeItem('qasa.user'); true`);
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
for (const art of [{ file: 'hero.png', page: 'hero.html', width: 1280, height: 720 }, { file: 'languages.png', page: 'languages.html', width: 1280, height: 500 }]) {
  await send('Emulation.setDeviceMetricsOverride', { width: art.width, height: art.height, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(join(root, 'scripts', 'screenshot-art', art.page)).href });
  await sleep(500);
  await evaluate('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
  await capture(art.file);
}

// leave the demo company as it was: no sign-in
if (cookie) await api('PUT', '/api/auth/signin', { on: false });

ws.close();
const exited = new Promise((r) => proc.once('exit', r));
proc.kill();
await Promise.race([exited, sleep(5000)]);
// the browser may hold its profile a moment longer; a leftover temp folder does no harm
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch { /* left in the temp folder */ }
