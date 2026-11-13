import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import { SplitButton, type SplitChoice } from '../components.tsx';
import { makeI18n, type Key } from '../i18n.ts';
import { whenQuiet, type PrintResult } from './printing.ts';
import {
  isSaveChoice, mayPostInvoice, planOf, printedOk, rememberChoice, rememberedChoice, runSaveFlow, SAVE_CHOICES, saveChoices,
  type ChoiceStore, type SaveChoice, type SaveFlowDeps
} from './save-flow.ts';

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const textOf = (lang: Lang, key: Key) => makeI18n(lang, 'western', () => {}, () => {}).t(key);

interface Doc { id: string; actions?: string[]; status: string }

/** The editor's side of the flow, recording the order things happen in. */
function deps(over: Partial<SaveFlowDeps<Doc>> = {}, steps: string[] = []): { steps: string[]; deps: SaveFlowDeps<Doc> } {
  return {
    steps,
    deps: {
      confirmPost: () => { steps.push('confirm'); return true; },
      saveDraft: async () => { steps.push('draft'); return { id: 'inv', actions: ['edit', 'delete', 'post'], status: 'draft' }; },
      onDraft: (d) => { steps.push(`kept:${d.id}`); },
      post: async (d) => { steps.push('post'); return { ...d, status: 'posted', actions: ['cancel'] }; },
      afterPost: () => { steps.push('balances'); },
      print: async () => { steps.push('print'); return 'printed'; },
      ...over
    }
  };
}

describe('the ways of saving an invoice', () => {
  it('offers save, print and next first on a sale, and save and next first on a purchase', () => {
    expect(saveChoices('sale', true)).toEqual(['print_next', 'print', 'next', 'whatsapp', 'post', 'draft']);
    // a purchase is not sent to its supplier on WhatsApp
    expect(saveChoices('purchase', true)).toEqual(['next', 'print_next', 'print', 'post', 'draft']);
    for (const c of [...saveChoices('sale', true), ...saveChoices('purchase', true)]) expect(isSaveChoice(c)).toBe(true);
  });

  it('offers only the two that keep a draft to someone who may only prepare', () => {
    expect(saveChoices('sale', false)).toEqual(['next', 'draft']);
    expect(saveChoices('purchase', false)).toEqual(['next', 'draft']);
  });

  it('follows the server\'s rule for who posts: sales the sales, purchasing the purchases', () => {
    expect(mayPostInvoice(['sales'], 'sale')).toBe(true);
    expect(mayPostInvoice(['sales'], 'purchase')).toBe(false);
    expect(mayPostInvoice(['purchases'], 'purchase')).toBe(true);
    expect(mayPostInvoice(['entries.prepare'], 'sale')).toBe(false);
    // not known yet: the server decides
    expect(mayPostInvoice(undefined, 'sale')).toBe(true);
  });

  it('says what each way does', () => {
    expect(planOf('print_next', true)).toEqual({ post: true, print: true, next: true, whatsapp: false });
    expect(planOf('print', true)).toEqual({ post: true, print: true, next: false, whatsapp: false });
    expect(planOf('next', true)).toEqual({ post: true, print: false, next: true, whatsapp: false });
    expect(planOf('whatsapp', true)).toEqual({ post: true, print: false, next: false, whatsapp: true });
    // the Post button as it was: posted, then the invoice's own page
    expect(planOf('post', true)).toEqual({ post: true, print: false, next: false, whatsapp: false });
    expect(planOf('draft', true)).toEqual({ post: false, print: false, next: false, whatsapp: false });
    // without the right to post, nothing is posted, printed or sent
    for (const c of SAVE_CHOICES) expect(planOf(c, false)).toMatchObject({ post: false, print: false, whatsapp: false });
    expect(planOf('next', false).next).toBe(true);
  });

  it('has a name and a line of help for every way, in the three languages', () => {
    const keys: Key[] = ['sv_print_next', 'sv_print', 'sv_next', 'sv_whatsapp', 'saveDraft', 'sv_more', 'sv_hint_print_next', 'sv_hint_print', 'sv_hint_next',
      'sv_hint_next_draft', 'sv_hint_whatsapp', 'sv_hint_post', 'actPost', 'sv_hint_draft', 'sv_remembered', 'sv_onlyDraft', 'sv_lastPosted', 'sv_lastDraft', 'sv_notPrinted', 'sv_printing', 'sv_open', 'sv_hide'];
    for (const lang of LANGS) for (const key of keys) expect(textOf(lang, key), `${lang} ${key}`).toBeTruthy();
    expect(textOf('en', 'sv_print_next')).toBe('Save, print and next');
    expect(textOf('ar', 'sv_print_next')).toBe('حفظ وطباعة والتالية');
    expect(textOf('ku', 'sv_print_next')).toBe('پاشەکەوت، چاپ و داهاتوو');
    // the number of the invoice has its place in each language
    for (const lang of LANGS) for (const key of ['sv_lastPosted', 'sv_notPrinted'] as Key[]) expect(textOf(lang, key)).toContain('{n}');
  });
});

describe('the way used last', () => {
  const memory = (): ChoiceStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  };

  it('is remembered per person and per kind of invoice, on this PC', () => {
    const store = memory();
    const sale = saveChoices('sale', true);
    expect(rememberedChoice('user:mer', 'sale', sale, store)).toBe('print_next');
    rememberChoice('user:mer', 'sale', 'next', store);
    expect(rememberedChoice('user:mer', 'sale', sale, store)).toBe('next');
    // someone else, and the purchases, keep their own
    expect(rememberedChoice('user:las', 'sale', sale, store)).toBe('print_next');
    expect(rememberedChoice('user:mer', 'purchase', saveChoices('purchase', true), store)).toBe('next');
  });

  it('falls back to the first way offered when the remembered one is not offered any more, or is not one', () => {
    const store = memory();
    rememberChoice('user:mer', 'sale', 'print_next', store);
    // they may only prepare now
    expect(rememberedChoice('user:mer', 'sale', saveChoices('sale', false), store)).toBe('next');
    store.data.set('qasa.invoiceSave.sale.user:mer', '<script>');
    expect(rememberedChoice('user:mer', 'sale', saveChoices('sale', true), store)).toBe('print_next');
  });

  it('works without storage (a private window): the default, and nothing thrown', () => {
    const broken: ChoiceStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(rememberedChoice('user:mer', 'sale', saveChoices('sale', true), broken)).toBe('print_next');
    expect(() => rememberChoice('user:mer', 'sale', 'next', broken)).not.toThrow();
    expect(rememberedChoice('user:mer', 'sale', saveChoices('sale', true), null)).toBe('print_next');
  });
});

describe('save, print and next', () => {
  it('asks, saves, posts, prints, then says the next invoice may open: in that order', async () => {
    const d = deps();
    const done = await runSaveFlow('print_next', true, d.deps);
    expect(d.steps).toEqual(['confirm', 'draft', 'kept:inv', 'post', 'balances', 'print']);
    expect(done).toMatchObject({ status: 'posted', printed: 'printed', next: true, whatsapp: false, invoice: { id: 'inv', status: 'posted' } });
  });

  it('prints nothing and opens no next invoice when posting is refused; the draft is kept for another try', async () => {
    const refusal = new Error('stock_insufficient');
    const d = deps({ post: async () => { d.steps.push('post'); throw refusal; } });
    await expect(runSaveFlow('print_next', true, d.deps)).rejects.toBe(refusal);
    expect(d.steps).toEqual(['confirm', 'draft', 'kept:inv', 'post']);
  });

  it('stops before anything is saved when saving the draft is refused', async () => {
    const refusal = new Error('lines_required');
    const d = deps({ saveDraft: async () => { throw refusal; } });
    await expect(runSaveFlow('print_next', true, d.deps)).rejects.toBe(refusal);
    expect(d.steps).toEqual(['confirm']);
  });

  it('keeps the invoice posted when the paper does not print, and says how the print went', async () => {
    for (const result of ['failed', 'busy'] as PrintResult[]) {
      const d = deps({ print: async () => result });
      const done = await runSaveFlow('print_next', true, d.deps);
      expect(done).toMatchObject({ status: 'posted', printed: result, next: true });
      expect(printedOk(result)).toBe(false);
    }
    // a print that throws is a print that failed, never a posting that failed
    const d = deps({ print: async () => { throw new Error('printer on fire'); } });
    expect(await runSaveFlow('print', true, d.deps)).toMatchObject({ status: 'posted', printed: 'failed', next: false });
    expect(printedOk('printed')).toBe(true);
    expect(printedOk('dialog')).toBe(true);
    expect(printedOk(null)).toBe(false);
  });

  it('does not take a failed reload of the balances for a failed posting', async () => {
    const d = deps({ afterPost: async () => { throw new Error('network'); } });
    expect(await runSaveFlow('next', true, d.deps)).toMatchObject({ status: 'posted', printed: null, next: true });
  });

  it('does nothing at all when the Post question is answered No', async () => {
    const d = deps({ confirmPost: () => false });
    expect(await runSaveFlow('print_next', true, d.deps)).toEqual({ status: 'cancelled' });
    expect(d.steps).toEqual([]);
  });

  it('"Save and next" posts without a paper; "Save and send on WhatsApp" posts and asks for the dialog', async () => {
    const next = deps();
    expect(await runSaveFlow('next', true, next.deps)).toMatchObject({ status: 'posted', printed: null, next: true, whatsapp: false });
    expect(next.steps).not.toContain('print');
    const wa = deps();
    expect(await runSaveFlow('whatsapp', true, wa.deps)).toMatchObject({ status: 'posted', printed: null, next: false, whatsapp: true });
  });

  it('"Save as draft" asks nothing and posts nothing', async () => {
    const d = deps();
    expect(await runSaveFlow('draft', true, d.deps)).toMatchObject({ status: 'draft', next: false, held: false, invoice: { id: 'inv' } });
    expect(d.steps).toEqual(['draft', 'kept:inv']);
  });

  it('keeps a draft for someone who may only prepare: no question, no posting, no paper, then the next invoice', async () => {
    const d = deps();
    for (const way of ['next', 'print_next', 'print', 'whatsapp', 'post'] as SaveChoice[]) {
      d.steps.length = 0;
      const done = await runSaveFlow(way, false, d.deps);
      expect(done).toMatchObject({ status: 'draft', held: false });
      expect(d.steps).toEqual(['draft', 'kept:inv']);
    }
    expect(await runSaveFlow('next', false, d.deps)).toMatchObject({ status: 'draft', next: true });
  });

  it('keeps a draft, and says it was held back, when the server does not list "post" for this person', async () => {
    const d = deps({ saveDraft: async () => ({ id: 'inv', actions: ['edit', 'delete'], status: 'draft' }) });
    const done = await runSaveFlow('print_next', true, d.deps);
    expect(done).toMatchObject({ status: 'draft', held: true, next: true });
    expect(d.steps).toEqual(['confirm', 'kept:inv']);
  });
});

describe('waiting for the paper to be ready', () => {
  it('prints once nothing has been waiting on the server for a moment', async () => {
    const waiting = [2, 2, 1, 0, 0, 0, 0, 0, 0];
    let waits = 0;
    const quiet = await whenQuiet(() => waiting.shift() ?? 0, { quietMs: 100, stepMs: 50, wait: async () => { waits++; } });
    expect(quiet).toBe(true);
    // three busy looks, then quiet for longer than 100 ms
    expect(waits).toBe(5);
  });

  it('gives up after a while and prints anyway, rather than never', async () => {
    let waits = 0;
    expect(await whenQuiet(() => 1, { maxMs: 500, stepMs: 50, wait: async () => { waits++; } })).toBe(false);
    expect(waits).toBe(10);
  });
});

describe('the split button', () => {
  const choices: SplitChoice[] = [
    { key: 'print_next', label: 'Save, print and next', hint: 'Posts, prints, opens a new one', icon: 'printer' },
    { key: 'next', label: 'Save and next' },
    { key: 'draft', label: 'Save as draft' }
  ];
  const html = (props: Partial<Parameters<typeof SplitButton>[0]> = {}) =>
    renderToStaticMarkup(<SplitButton choices={choices} current="print_next" onRun={vi.fn()} menuLabel="Other ways to save" shortcut="F9" {...props} />);

  it('shows the current way on its main part with its shortcut, and an arrow for the others', () => {
    const out = html();
    expect(out).toContain('Save, print and next');
    expect(out).toContain('<kbd class="ltr">F9</kbd>');
    expect(out).toContain('aria-keyshortcuts="F9"');
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-label="Other ways to save"');
    // the list stays closed until the arrow is pressed
    expect(out).not.toContain('role="menu"');
    expect(html({ current: 'next' })).toMatch(/split-main[^>]*>.*Save and next/s);
  });

  it('falls back to the first way when the current one is not offered, and needs no arrow for a single way', () => {
    expect(html({ current: 'whatsapp' })).toContain('Save, print and next');
    const one = html({ choices: [choices[2]!], current: 'draft' });
    expect(one).toContain('Save as draft');
    expect(one).not.toContain('split-arrow');
  });

  it('is switched off as a whole while it works, and says what it is doing', () => {
    const out = html({ disabled: true, busyLabel: 'Sending the invoice to the printer…' });
    expect(out.match(/disabled=""/g)).toHaveLength(2);
    expect(out).toContain('Sending the invoice to the printer…');
  });
});
