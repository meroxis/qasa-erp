import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext, isKey, makeI18n } from '../i18n.ts';
import { DEFAULT_PREFS, padPress, quickTenders, readPrefs, writePrefs, TILL_PREFS_KEY } from './feedback.ts';
import { DEFAULT_SCALE, hexBytes, parseScaleText, readScaleSettings, validPattern } from './scale.ts';
import { PaymentPanel, type PaySummary } from './PaymentPanel.tsx';
import { Keypad, ShortcutsHelp, TILL_KEYS } from './Dialogs.tsx';
import { CartLines } from './Cart.tsx';
import { TILL_UI_TEXT } from '../i18n/till-ui.ts';
import { tillPart, tillSource } from '../till-source.ts';
import type { ItemView } from '../api.ts';

// 2.0: the till for supermarkets (src/pos/): quick cash, the keypad, the shortcuts, the cart's offer lines, the
// payment panel, this PC's preferences and the weighing scale.

const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>
);
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

describe('quick cash and the keypad', () => {
  it('offers the exact amount, then the notes that cover it, nearest first, at most four', () => {
    expect(quickTenders(0)).toEqual([]);
    expect(quickTenders(7_250)).toEqual([7_250, 10_000, 25_000, 50_000]);
    expect(quickTenders(10_000)).toEqual([10_000, 25_000, 50_000]);
    expect(quickTenders(63_000)).toEqual([63_000, 65_000, 70_000, 75_000]);
  });

  it('types whole numbers with the keypad, without a leading zero, and takes the last digit back', () => {
    expect(padPress('', '0')).toBe('0');
    expect(padPress('0', '5')).toBe('5');
    expect(padPress('25', '00')).toBe('2500');
    expect(padPress('2500', '⌫')).toBe('250');
    expect(padPress('123456789', '1')).toBe('123456789');
    const html = wrap(<Keypad value="2500" label="Keypad" onChange={() => {}} onDone={() => {}} />);
    expect(html).toContain('2500');
    expect(html.match(/btn (?:primary )?pos-key/g)?.length).toBe(13);
  });
});

describe("this PC's till preferences", () => {
  it('keeps touch mode and the beep, and falls back to the defaults on anything else', () => {
    const s = store();
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
    writePrefs({ touch: true, beep: false }, s);
    expect(readPrefs(s)).toEqual({ touch: true, beep: false });
    s.m.set(TILL_PREFS_KEY, '{"touch":"yes"}');
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
    s.m.set(TILL_PREFS_KEY, 'not json');
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
  });
});

describe('the weighing scale', () => {
  it('reads the last weight a scale sent, in kg or g, and nothing absurd', () => {
    expect(parseScaleText('ST,GS,  1.250kg\r\nST,GS,  1.255kg\r\n', DEFAULT_SCALE)).toBe(1.255);
    expect(parseScaleText('W 0,750', DEFAULT_SCALE)).toBe(0.75);
    expect(parseScaleText('1250', { pattern: '(\\d+)', unit: 'g' })).toBe(1.25);
    expect(parseScaleText('nothing here', { pattern: '(\\d+\\.\\d+)', unit: 'kg' })).toBeNull();
    expect(parseScaleText('5000.0', DEFAULT_SCALE)).toBeNull();
    expect(parseScaleText('1.0', { pattern: '([', unit: 'kg' })).toBeNull();
  });

  it('takes a request as hex bytes and a pattern that compiles; anything else falls back', () => {
    expect([...hexBytes('05')!]).toEqual([5]);
    expect([...hexBytes('57 0d')!]).toEqual([0x57, 0x0d]);
    expect(hexBytes('')!.length).toBe(0);
    expect(hexBytes('zz')).toBeNull();
    expect(validPattern('(\\d+)')).toBe(true);
    expect(validPattern('(')).toBe(false);
    const s = store();
    s.m.set('qasa.pos.scale', JSON.stringify({ on: true, baud: 12345, request: 'xx', pattern: '(', unit: 'g' }));
    expect(readScaleSettings(s)).toEqual({ on: true, baud: 9600, request: '', pattern: DEFAULT_SCALE.pattern, unit: 'g' });
  });
});

describe('the shortcuts', () => {
  it('lists every key the till answers, each with its words in three languages', () => {
    const till = tillSource();
    for (const k of TILL_KEYS) {
      const key = k.key.replace('Ctrl+', '');
      if (key === 'Esc') continue;
      expect(till, k.key).toMatch(new RegExp(`e\\.key === '${key}'`));
      expect(isKey(k.label)).toBe(true);
    }
    const html = wrap(<ShortcutsHelp onClose={() => {}} />, 'ku');
    expect(html).toContain('F9');
    expect(html).toContain('پارەدان');
  });

  it('keeps the old keys a trained cashier knows: F2 search, F4 clear, F6 hold, F8 discount, F9 pay, F10 print', () => {
    expect(TILL_KEYS.map((k) => k.key)).toEqual(expect.arrayContaining(['F2', 'F4', 'F6', 'F8', 'F9', 'F10']));
  });
});

const tea = { id: 'i1', code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', units: [], trackStock: true, trackBatches: false } as unknown as ItemView;

describe('the cart', () => {
  it('shows an offer in green under its line, flashes the line just scanned, and lets a price be changed', () => {
    const html = wrap(
      <CartLines cart={[{ item: tea, qtyMilli: 2000, unitPrice: 1000, unit: null }]} currency="IQD" warehouseId="w" offerByLine={{ 1: 500 }} offerNames={{ 1: 'Two for 1,500' }}
        flash="i1|" rxItems={new Set()} onQty={() => {}} onUnit={() => {}} onLine={() => {}} onRemove={() => {}} onPrice={() => {}} />
    );
    expect(html).toContain('pos-line-flash');
    expect(html).toContain('Two for 1,500');
    expect(html).toMatch(/pos-line-offer[^>]*>.*500/);
    expect(html).toContain('Change price');
  });

  it('says so when empty', () => {
    expect(wrap(<CartLines cart={[]} currency="IQD" warehouseId="w" offerByLine={{}} offerNames={{}} flash={null} rxItems={new Set()}
      onQty={() => {}} onUnit={() => {}} onLine={() => {}} onRemove={() => {}} onPrice={null} />)).toContain('pos-empty');
  });
});

const sum = (over: Partial<PaySummary> = {}): PaySummary => ({
  subtotal: 7_500, offers: [{ id: 'o', name: 'Bread', discount: 250 }], offerTotal: 250, discount: 0, total: 7_250, points: 0, vouchers: [], due: 7_250,
  cashDue: 7_250, cashRounded: 7_250, ...over
});
const panel = (over: Partial<Parameters<typeof PaymentPanel>[0]> = {}) => wrap(
  <PaymentPanel currency="IQD" rateX100={100} sum={sum()} method="cash" offered={['cash', 'account']} offline={false} needsCustomer={false} onCredit={false} onPick={() => {}}
    cardMethods={['fib']} split={{}} splitBad={false} onSplit={() => {}} handed={null} onHanded={() => {}} handedUsd={null} onHandedUsd={() => {}}
    usdRateText="1420" onUsdRate={() => {}} usdOn={false} change={null} onDiscount={() => {}} onVoucher={() => {}} onRemoveVoucher={() => {}}
    customer={null} loyalty={null} debt={null} canPay onPay={() => {}} onExact={() => {}} onClear={() => {}} onHold={() => {}} cartEmpty={false} busy={false}
    keypad={null} notes={null} error={null} done={null} {...over} />
);

describe('the payment panel', () => {
  it('shows the total big, what offers saved, quick cash, the wallets and a gift voucher', () => {
    const html = panel();
    expect(html).toContain('pos-total-big');
    expect(html).toContain('You saved 250');
    expect(html).toContain('>Exact<');
    expect(html).toContain('10,000');
    expect(html).toContain('FIB');
    expect(html).toContain('Pay with a voucher');
  });

  it('shows the change big, or what is short, and the rounding of the cash', () => {
    expect(panel({ handed: 10_000, change: 2_750 })).toMatch(/pos-giveback[^"]*"[^>]*>.*Change.*2,750/);
    expect(panel({ handed: 5_000, change: -2_250 })).toMatch(/pos-giveback short/);
    const rounded = panel({ sum: sum({ cashDue: 7_250, cashRounded: 7_500 }) });
    expect(rounded).toContain('Rounding');
    expect(rounded).toContain('+250');
  });

  it('asks no cash on credit and names nothing as the old "Amount paid"', () => {
    const credit = panel({ onCredit: true, method: 'account' });
    expect(credit).not.toContain('pos-tenders');
    expect(tillPart('PaymentPanel.tsx')).not.toContain("t('pos_paid')");
  });
});

describe('the texts', () => {
  it('has every till text in Arabic, English and Kurdish', () => {
    for (const [key, v] of Object.entries(TILL_UI_TEXT)) {
      expect(v, key).toHaveLength(3);
      for (const text of v) expect(text.trim(), key).not.toBe('');
    }
  });
});

describe('the till reloads its own shift', () => {
  it('asks for this PC\u2019s till and keeps the shift only when it is still this one (after a gift voucher is sold, too)', () => {
    const register = tillPart('Register.tsx');
    expect(register).toContain('posApi.current(thisTill() || null).then((r) => { if (r.shift?.id === shift.id)');
    expect(register).not.toContain('posApi.current()');
    expect(register).toContain('onSold={() => { reloadShift();');
  });
});

describe('the customer screen pictures', () => {
  it('are made small in the browser before upload, as item pictures are (a 3 MB phone photo works)', () => {
    const settings = tillPart('TillRulesSettings.tsx');
    expect(settings).toContain('await preparePicture(file, { maxSide: 1280, targetBytes: 380 * 1024 })');
    expect(settings).not.toContain('await file.arrayBuffer()');
  });
});

describe('a return at the till (2.0.0)', () => {
  it('is made in a dialog on the till, sent to the till’s own return route with the supervisor’s approval when the rules ask', () => {
    const register = tillPart('Register.tsx');
    expect(register).not.toContain("location.hash = href('sales-returns')");
    // the supervisor approves this very return: the sale and the lines that come back
    expect(register).toContain("<TillReturnDialog shiftId={shift.id} needsSupervisor={rules.supervisor.refund} ask={(what) => supervisor.ask('refund', undefined, what)}");
    const dialog = tillPart('TillReturn.tsx');
    expect(dialog).toContain('await p.ask({ invoiceId: sale.id, lines: picked })');
    // sent once (send-once.ts, through posApi.giveBack): the same return again goes with the same key and approval
    expect(dialog).toContain('posApi.giveBack(p.shiftId, { invoiceId: sale.id, lines: picked, ...(approvals ? { approvals } : {}) })');
    expect(dialog).toContain('posApi.findSale(p.shiftId, q.trim())');
  });

  it('only lets back what is left of each line', async () => {
    const { returnable } = await import('./TillReturn.tsx');
    expect(returnable({ lines: [{ lineNo: 1, qtyMilli: 3_000, returnedQtyMilli: 1_000 }, { lineNo: 2, qtyMilli: 1_000, returnedQtyMilli: 1_000 }] } as never))
      .toEqual([{ lineNo: 1, leftMilli: 2_000 }, { lineNo: 2, leftMilli: 0 }]);
  });
});
