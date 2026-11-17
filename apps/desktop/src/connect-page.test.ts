import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The connect window's page (connect.html), run with a small stand-in for the browser's document: the remembered
// offices list, Connect and Forget, and the "Remember this office" box.
const html = readFileSync(new URL('./connect.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

class El {
  children: El[] = [];
  parent: El | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => unknown)[]> = {};
  dataset: Record<string, string> = {};
  className = '';
  hidden = false;
  disabled = false;
  open = true;
  value = '';
  checked = false;
  type = '';
  dir = '';
  id = '';
  text = '';
  constructor(public tag: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.text = String(v); this.children = []; }
  get classList() {
    return { toggle: (c: string, on: boolean) => { const set = new Set(this.className.split(' ').filter(Boolean)); if (on) set.add(c); else set.delete(c); this.className = [...set].join(' '); } };
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...items: (El | string)[]) {
    for (const item of items) {
      const el = typeof item === 'string' ? Object.assign(new El('#text'), { text: item }) : item;
      el.parent = this;
      this.children.push(el);
    }
  }
  replaceChildren(...items: El[]) { this.children = []; this.append(...items); }
  addEventListener(type: string, fn: (e: unknown) => unknown) { (this.listeners[type] ??= []).push(fn); }
  async fire(type: string) { for (const fn of this.listeners[type] ?? []) await fn({ preventDefault() {} }); }
  focus() { doc.focused = this; }
  scrollIntoView() {}
  all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel: string): El[] { return this.all().filter((e) => (sel === '[data-t]' ? 't' in e.dataset : e.tag === sel)); }
  querySelector(sel: string): El | null { return this.querySelectorAll(sel)[0] ?? null; }
}

let doc: ReturnType<typeof makeDocument>;
function makeDocument() {
  const root = new El('html');
  const byId: Record<string, El> = {};
  const add = (tag: string, id: string, t?: string) => {
    const el = new El(tag);
    el.id = id;
    if (t) el.dataset.t = t;
    byId[id] = el;
    root.append(el);
    return el;
  };
  for (const t of ['title', 'lead', 'savedTitle', 'savedHint', 'newTitle', 'address', 'addressHint', 'code', 'codeHint', 'remember', 'rememberHint', 'cancel', 'connect']) add('span', `t-${t}`, t);
  add('section', 'saved').hidden = true;
  add('ul', 'offices');
  add('div', 'listMsg');
  add('details', 'pairing').className = 'pairing solo';
  add('form', 'form');
  add('input', 'address');
  add('input', 'code');
  add('input', 'remember').checked = true;
  add('div', 'msg');
  add('button', 'cancel');
  add('button', 'go');
  return { root, byId, focused: null as El | null, title: '' };
}

const views = [
  { id: '0000000000000001', name: '192.168.1.20', address: '192.168.1.20', relay: false, lastUsed: '2026-11-17T09:40:00', current: false },
  { id: '0000000000000002', name: 'Qasa Relay · ABCDE-FGH23', address: 'ABCDE-FGH23', relay: true, lastUsed: '2026-11-15T18:05:00', current: false }
];

async function openPage(lang: string, opts: { offices?: typeof views; use?: unknown; pair?: unknown } = {}) {
  doc = makeDocument();
  let list = [...(opts.offices ?? [])];
  const calls = { use: [] as unknown[], forget: [] as unknown[], pair: [] as unknown[][] };
  const qasaConnect = {
    offices: async () => list,
    useOffice: async (id: unknown) => { calls.use.push(id); return opts.use ?? { ok: true }; },
    forgetOffice: async (id: unknown) => { calls.forget.push(id); list = list.filter((o) => o.id !== id); return list; },
    pair: async (...args: unknown[]) => { calls.pair.push(args); return opts.pair ?? { error: 'unreachable' }; },
    close: () => {}
  };
  const document = {
    documentElement: { lang: '', dir: '' },
    set title(v: string) { doc.title = v; },
    get title() { return doc.title; },
    querySelectorAll: (sel: string) => doc.root.querySelectorAll(sel),
    getElementById: (id: string) => doc.byId[id] ?? null,
    createElement: (tag: string) => new El(tag)
  };
  runInNewContext(script, { document, window: { qasaConnect }, location: { search: `?lang=${lang}` }, URLSearchParams, Number, String, Object, Array, Date });
  await new Promise((r) => setTimeout(r, 0));
  return { calls, document, $: (id: string) => doc.byId[id]! };
}

const rows = () => doc.byId.offices!.querySelectorAll('li');
const buttons = (li: El) => li.querySelectorAll('button');

describe('the connect window', () => {
  it('with no remembered office looks as before: the pairing form only, "Remember" ticked', async () => {
    const { $, document } = await openPage('en');
    expect($('saved').hidden).toBe(true);
    expect($('pairing').className).toContain('solo');
    expect($('pairing').open).toBe(true);
    expect($('remember').checked).toBe(true);
    expect(doc.focused).toBe($('address'));
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('lists the remembered offices with Connect and Forget, and the pairing form folded away', async () => {
    const { $ } = await openPage('en', { offices: views });
    expect($('saved').hidden).toBe(false);
    expect($('pairing').className).not.toContain('solo');
    expect($('pairing').open).toBe(false);
    expect(rows()).toHaveLength(2);
    const [first] = rows();
    expect(first!.querySelector('bdi')!.textContent).toBe('192.168.1.20');
    expect(first!.textContent).toContain('Last used: 2026-11-17 09:40');
    expect(buttons(first!).map((b) => b.textContent)).toEqual(['Connect', 'Forget']);
    expect(buttons(first!).map((b) => b.getAttribute('aria-label'))).toEqual(['Connect to 192.168.1.20', 'Forget 192.168.1.20 on this PC']);
    expect(doc.focused).toBe(buttons(first!)[0]);
  });

  it('is right to left in Arabic and Kurdish, with the addresses and dates left to right', async () => {
    for (const lang of ['ar', 'ku']) {
      const { document } = await openPage(lang, { offices: views });
      expect(document.documentElement.dir).toBe('rtl');
      for (const bdi of doc.byId.offices!.querySelectorAll('bdi')) expect(bdi.dir).toBe('ltr');
    }
  });

  it('Connect sends the office’s id only', async () => {
    const { calls, $ } = await openPage('en', { offices: views });
    await buttons(rows()[1]!)[0]!.fire('click');
    expect(calls.use).toEqual(['0000000000000002']);
    expect($('listMsg').textContent).toBe('Connected. Qasa ERP restarts on the office server…');
  });

  it('a changed certificate opens the pairing form with the address filled in, for the code', async () => {
    const { $ } = await openPage('en', { offices: views, use: { error: 'mismatch' } });
    $('code').value = 'old';
    await buttons(rows()[1]!)[0]!.fire('click');
    expect($('pairing').open).toBe(true);
    expect($('address').value).toBe('ABCDE-FGH23');
    expect($('code').value).toBe('');
    expect(doc.focused).toBe($('code'));
    expect($('msg').textContent).toMatch(/certificate has changed/);
    expect($('msg').className).toBe('msg bad');
  });

  it('other answers are said under the list', async () => {
    const { $ } = await openPage('ar', { offices: views, use: { error: 'offline' } });
    await buttons(rows()[0]!)[0]!.fire('click');
    expect($('listMsg').textContent).toContain('Qasa Relay');
    expect($('listMsg').className).toBe('msg bad');
  });

  it('Forget takes the office off the list and moves the focus on', async () => {
    const { calls, $ } = await openPage('en', { offices: views });
    await buttons(rows()[0]!)[1]!.fire('click');
    expect(calls.forget).toEqual(['0000000000000001']);
    expect(rows()).toHaveLength(1);
    expect($('listMsg').textContent).toBe('192.168.1.20 is no longer remembered on this PC. Connecting to it again needs the pairing code.');
    expect(doc.focused).toBe(buttons(rows()[0]!)[0]);
    await buttons(rows()[0]!)[1]!.fire('click');
    expect($('saved').hidden).toBe(true);
    expect($('pairing').open).toBe(true);
    expect(doc.focused).toBe($('address'));
  });

  it('the office in use shows "Connected now" and no Connect button', async () => {
    await openPage('en', { offices: [{ ...views[0]!, current: true }] });
    const [row] = rows();
    expect(row!.textContent).toContain('Connected now');
    expect(buttons(row!).map((b) => b.textContent)).toEqual(['Forget']);
  });

  it('pairing sends whether to remember the office', async () => {
    const { calls, $ } = await openPage('en');
    $('address').value = '192.168.1.20';
    $('code').value = 'CODE';
    await $('form').fire('submit');
    $('remember').checked = false;
    await $('form').fire('submit');
    expect(calls.pair).toEqual([['192.168.1.20', 'CODE', true], ['192.168.1.20', 'CODE', false]]);
  });

  it('has every new text in Arabic, English and Kurdish, all different', () => {
    for (const key of ['savedTitle', 'savedHint', 'newTitle', 'lastUsed', 'connectedNow', 'forget', 'connectTo', 'forgetName', 'forgotten', 'remember', 'rememberHint', 'back', 'e_changed', 'e_gone', 'e_current']) {
      const m = new RegExp(`\\n\\s+${key}: \\[('(?:[^'\\\\]|\\\\.)*'), ('(?:[^'\\\\]|\\\\.)*'), ('(?:[^'\\\\]|\\\\.)*')\\]`).exec(html);
      expect(m, key).not.toBeNull();
      expect(new Set(m!.slice(1, 4)).size, key).toBe(3);
    }
  });
});
