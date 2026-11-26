import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isKey, makeI18n, type Key } from '../i18n.ts';
import { MKX_TEXT } from '../i18n/market-extras.ts';
import { deliveryMessage, reminderAmount, reminderMessage } from './market-messages.ts';
import { deviceGet, PRICE_CHECKER_HEADER } from './market-extras-api.ts';
import { draftFromBasket } from './DeliveryFromTill.tsx';
import { inputOf, linesOf } from './DeliveryOrderForm.tsx';
import { waited } from '../pages/Delivery.tsx';
import { deviceLink } from '../pages/PriceCheckers.tsx';
import { PriceCheckerScreen, tokenFrom } from '../pages/PriceCheckerScreen.tsx';

// The market extras on the screens: the words in the three languages, the WhatsApp messages in the customer's own
// language, the till's basket as a delivery order, and the price checker's link and screen (its token only).

const noop = () => {};
const en = makeI18n('en', 'western', noop, noop);
const ku = makeI18n('ku', 'western', noop, noop);
const ar = makeI18n('ar', 'western', noop, noop);
const company = { ar: 'سوق رزگار', en: 'Rizgar Market', ku: 'مارکێتی ڕزگار' };

describe('the market extras’ words', () => {
  it('has every text in Arabic, English and Kurdish, each its own', () => {
    for (const [key, texts] of Object.entries(MKX_TEXT)) {
      expect(isKey(key), key).toBe(true);
      expect(texts).toHaveLength(3);
      expect(texts.every((x) => x.trim().length > 0), key).toBe(true);
    }
    for (const s of ['new', 'preparing', 'out', 'delivered', 'cancelled']) {
      for (const k of [`mx_st_${s}`, `mx_to_${s}`, `mx_wa_${s}`]) expect(isKey(k as Key), k).toBe(true);
    }
  });
});

describe('WhatsApp messages', () => {
  const order = { number: 'DLV-2026-0007', customerName: 'Rizgar', total: 8_000, driverName: 'Hemin', payment: 'cod' as const, cancelReason: null };

  it('tells a delivery customer each step in their language, with the cash to have ready when it is out', () => {
    const out = deliveryMessage(ku, order, 'out', company, '0770 111 2233');
    expect(out).toContain('DLV-2026-0007');
    expect(out).toContain('Hemin');
    expect(out).toContain('0770 111 2233');
    expect(out).toContain(ku.money(8_000, 'IQD'));
    expect(out).toContain('مارکێتی ڕزگار');
    expect(deliveryMessage(en, { ...order, payment: 'account' }, 'out', company)).not.toContain(en.t('mx_wa_payCod', { total: en.money(8_000, 'IQD') }));
    expect(deliveryMessage(en, { ...order, cancelReason: 'No answer' }, 'cancelled', null)).toContain('(No answer)');
    expect(deliveryMessage(ar, order, 'delivered', company)).toContain('سوق رزگار');
  });

  it('reminds a customer of what they owe in each currency they owe in, and keeps one amount for the log', () => {
    const row = { name: 'Rizgar', owed: { IQD: 250_000, USD: 12_000 }, balance: 430_000, oldestDays: 45 };
    const text = reminderMessage(en, row, company);
    expect(text).toContain(en.money(250_000, 'IQD'));
    expect(text).toContain(en.money(12_000, 'USD'));
    expect(text).toContain('45');
    expect(text).toContain('Rizgar Market');
    expect(reminderAmount(row)).toEqual({ amount: 250_000, currency: 'IQD' });
    expect(reminderAmount({ owed: { IQD: 0, USD: 5_000 }, balance: 70_000 })).toEqual({ amount: 5_000, currency: 'USD' });
    expect(reminderMessage(ku, row, null)).toContain('Rizgar');
  });
});

describe('the till’s basket as a delivery order', () => {
  it('keeps the filled lines at the till’s prices, the customer, and an empty line to add more', () => {
    const draft = draftFromBasket([{ itemId: 'milk', qtyMilli: 4_000, unitPrice: 1_500 }, { itemId: '', qtyMilli: 0, unitPrice: 0 }], 'w1', 'c1');
    expect(draft).toMatchObject({ warehouseId: 'w1', partyId: 'c1', payment: 'cod' });
    expect(draft.lines).toHaveLength(2);
    expect(linesOf(draft.lines)).toEqual([{ itemId: 'milk', qtyMilli: 4_000, unitPrice: 1_500 }]);
    const input = inputOf({ ...draft, customerName: ' Rizgar ', address: ' Ankawa ', fee: null });
    expect(input).toMatchObject({ customerName: 'Rizgar', address: 'Ankawa', fee: 0, partyId: 'c1', driverId: null, lang: null });
  });

  it('says how long an order has waited, in minutes', () => {
    expect(waited('2026-11-20T09:00:00Z', new Date('2026-11-20T09:45:30Z'))).toBe(45);
    expect(waited('2026-11-20T09:00:00Z', new Date('2026-11-20T08:00:00Z'))).toBe(0);
  });
});

describe('price checkers', () => {
  it('gives the device its link with the token after #, and the screen reads it back (and nothing that is not a token)', () => {
    const token = 'qpc_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const link = deviceLink(token, 'http://192.168.1.10:47420/');
    expect(link).toBe(`http://192.168.1.10:47420/#/price-checker?token=${token}`);
    expect(tokenFrom(`#/price-checker?token=${token}`, null)).toBe(token);
    expect(tokenFrom('#/price-checker', 'qpc_kept_kept_kept_kept_1')).toBe('qpc_kept_kept_kept_kept_1');
    expect(tokenFrom('#/price-checker?token=<script>', null)).toBeNull();
  });

  it('asks with the device token and no cookie', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ found: false }), { status: 200 })) as unknown as typeof fetch;
    expect(await deviceGet('/api/price-check?code=1', 'qpc_x', fetcher)).toEqual({ found: false });
    const [, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(init.headers).toEqual({ [PRICE_CHECKER_HEADER]: 'qpc_x' });
    expect(init.credentials).toBe('omit');
    const refused = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(deviceGet('/api/price-check?code=1', 'qpc_x', refused)).rejects.toMatchObject({ status: 401 });
  });

  it('shows a screen with no token as not set up, and one with a token ready to scan', () => {
    const blank = renderToStaticMarkup(<PriceCheckerScreen fetcher={vi.fn() as unknown as typeof fetch} hash="#/price-checker" />);
    expect(blank).toContain(ar.t('mx_pcScreenNoToken').replace(/"/g, '&quot;'));
    const ready = renderToStaticMarkup(<PriceCheckerScreen fetcher={vi.fn() as unknown as typeof fetch} hash="#/price-checker?token=qpc_AbCdEfGhIjKlMnOpQrStUvWxYz012345" />);
    expect(ready).toContain(ar.t('mx_pcScan'));
    expect(ready).not.toContain('qpc_');
  });
});
