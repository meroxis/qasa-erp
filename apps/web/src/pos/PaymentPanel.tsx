import type { ReactNode } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { AmountInput, ErrorBox, Icon } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import type { SplitMethod, TillMethod } from '../pages/pos-logic.ts';
import { TillEquivalent } from './TillEquivalent.tsx';
import { quickTenders } from './feedback.ts';

/** What a sale has paid towards it besides money handed over now: offers, a typed discount, points, gift vouchers. */
export interface PaySummary {
  subtotal: number;
  offers: { id: string; name: string; discount: number }[];
  offerTotal: number;
  discount: number | null;
  total: number;
  points: number;
  vouchers: { code: string; amount: number }[];
  /** what is left to pay after points and vouchers */
  due: number;
  /** the cash part, and as the drawer takes it (dinar rounding) */
  cashDue: number;
  cashRounded: number;
}

/**
 * The payment side of the till (2.0): the total big, what offers and the discount saved, then how it is paid. Cash
 * first: quick buttons for the exact amount and the notes that cover it (5,000 to 50,000 dinars), the dinars and dollar
 * notes handed over, and the change in dinars, big. Card and wallets beside it (when an admin gave them accounts), a
 * gift voucher, credit to a known customer, and one big Pay. Every amount here is a preview: the server books the sale.
 */
export function PaymentPanel(p: {
  currency: CurrencyCode; rateX100: number; sum: PaySummary;
  method: TillMethod; offered: readonly TillMethod[]; offline: boolean; needsCustomer: boolean; onCredit: boolean; onPick(m: TillMethod): void;
  cardMethods: readonly Exclude<SplitMethod, 'cash'>[]; split: Partial<Record<Exclude<SplitMethod, 'cash'>, number | null>>; splitBad: boolean;
  onSplit(m: Exclude<SplitMethod, 'cash'>, v: number | null): void;
  handed: number | null; onHanded(v: number | null): void; handedUsd: number | null; onHandedUsd(v: number | null): void;
  usdRateText: string; onUsdRate(v: string): void; usdOn: boolean; change: number | null;
  onDiscount(v: number | null): void;
  onVoucher: (() => void) | null; onRemoveVoucher(code: string): void;
  customer: ReactNode; loyalty: ReactNode; debt: ReactNode;
  canPay: boolean; busy: boolean; onPay(): void; onExact(): void; onClear(): void; onHold(): void; cartEmpty: boolean;
  keypad: ReactNode; notes: ReactNode; error: unknown; done: ReactNode;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { sum, currency } = p;
  const cashIQD = currency === 'IQD' && !p.onCredit && sum.cashRounded > 0;
  const saved = sum.offerTotal + (sum.discount ?? 0);
  return (
    <section className="pos-pay-panel card" aria-label={t('paymentMode')}>
      {p.done}
      <div className="pos-total-box" aria-live="polite">
        <span className="pos-total-label">{t('pos_total')}</span>
        <strong className="pos-total-big num">{i18n.money(sum.total, currency)}</strong>
        <TillEquivalent total={sum.total} currency={currency} rateX100={currency === 'USD' ? p.rateX100 : undefined} />
        {saved > 0 && <span className="pos-saved num">{t('tu_saved', { n: i18n.money(saved, currency) })}</span>}
      </div>

      <div className="pos-pay-scroll stack">
        <div className="track pos-methods" role="group" aria-label={t('paymentMode')}>
          <button type="button" aria-pressed={!p.onCredit} onClick={() => p.onPick('cash')}>{t('payCash')}</button>
          <button type="button" aria-pressed={p.onCredit} disabled={!p.offered.includes('account')} onClick={() => p.onPick('account')}>{t('payCredit')}</button>
        </div>
        {p.onCredit && <div className="small muted">{t('s14_payCreditHint')}</div>}
        {p.needsCustomer && <div className="small" role="alert" style={{ color: 'var(--bad)' }}>{t('s14_creditNeedsCustomer')}</div>}
        {p.offline && <div className="small muted">{t('pos_offlineNoAccount')}</div>}

        {!p.onCredit && p.cardMethods.length > 0 && (
          <div className="pos-wallets">
            {p.cardMethods.map((m) => (
              <label key={m} className="field pos-wallet"><span>{t(`pay_${m}` as Key)}</span>
                <AmountInput value={p.split[m] ?? null} currency={currency} onChange={(v) => p.onSplit(m, v)} ariaLabel={t(`pay_${m}` as Key)} />
              </label>
            ))}
            {p.splitBad && <div className="small" role="alert" style={{ color: 'var(--bad)' }}>{t('tl_splitTooMuch')}</div>}
          </div>
        )}
        {p.onVoucher && !p.onCredit && <button type="button" className="btn pos-touch" onClick={p.onVoucher}><Icon name="tag" size={16} />{t('tu_gvPay')}</button>}

        {cashIQD && (
          <div className="pos-cash stack">
            {sum.cashRounded !== sum.cashDue && (
              <div className="pos-r-row small"><span>{t('tu_rounding')}</span><span className="num">{sum.cashRounded > sum.cashDue ? '+' : '−'}{i18n.money(Math.abs(sum.cashRounded - sum.cashDue), 'IQD')}</span></div>
            )}
            <div className="pos-r-row"><span>{t('tu_cashToPay')}</span><strong className="num">{i18n.money(sum.cashRounded, 'IQD')}</strong></div>
            <div className="pos-tenders" role="group" aria-label={t('tl_handed')}>
              {quickTenders(sum.cashRounded).map((n, i) => (
                <button key={n} type="button" className={'btn pos-tender' + (p.handed === n ? ' on' : '')} onClick={() => p.onHanded(n)}>
                  {i === 0 && n === sum.cashRounded ? t('tu_exact') : i18n.money(n, 'IQD')}
                </button>
              ))}
            </div>
            <div className="grid-2 pos-handed">
              <label className="field"><span>{t('tl_handed')}</span><AmountInput value={p.handed} currency="IQD" onChange={p.onHanded} ariaLabel={t('tl_handed')} /></label>
              <label className="field"><span>{t('tl_handedUsd')}</span><AmountInput value={p.handedUsd} currency="USD" onChange={p.onHandedUsd} ariaLabel={t('tl_handedUsd')} /></label>
              {p.usdOn && <label className="field"><span>{t('tl_usdRate')}</span><input className="input num ltr" inputMode="decimal" value={p.usdRateText} onChange={(e) => p.onUsdRate(e.target.value)} /></label>}
            </div>
            {p.change !== null && (
              <div className={'pos-giveback' + (p.change < 0 ? ' short' : '')} role="status">
                <span>{p.change < 0 ? t('tl_short') : t('tl_change')}</span>
                <strong className="num">{i18n.money(Math.abs(p.change), 'IQD')}</strong>
              </div>
            )}
          </div>
        )}
        {p.customer}
        {p.debt}
        {p.loyalty}
        {sum.offers.map((o) => (
          <div key={o.id} className="pos-r-row pos-offer-row" role="status">
            <span><Icon name="tag" size={14} /> {o.name}</span>
            <span className="num">−{i18n.money(o.discount, currency)}</span>
          </div>
        ))}
        <label className="field pos-discount-field" id="pos-discount"><span>{t('pos_discount')} <span className="kbd">F8</span></span>
          <AmountInput value={sum.discount} currency={currency} onChange={p.onDiscount} ariaLabel={t('pos_discount')} />
        </label>
        {sum.points > 0 && <div className="pos-r-row"><span>{t('ly_title')}</span><span className="num">−{i18n.money(sum.points, currency)}</span></div>}
        {sum.vouchers.map((v) => (
          <div key={v.code} className="pos-r-row">
            <span><Icon name="tag" size={14} /> {t('tu_gvPaid')} <span className="ltr small muted">{v.code}</span></span>
            <span className="row" style={{ gap: 6 }}>
              <span className="num">−{i18n.money(v.amount, 'IQD')}</span>
              <button type="button" className="btn small" aria-label={t('pos_remove')} onClick={() => p.onRemoveVoucher(v.code)}><Icon name="x" size={14} /></button>
            </span>
          </div>
        ))}

        {p.keypad}
        {p.notes}
        <ErrorBox error={p.error} />
      </div>

      <div className="pos-actions">
        <button type="button" className="btn pos-touch" onClick={p.onClear} disabled={p.busy}><Icon name="x" size={18} />{t('pos_clear')} <span className="kbd">F4</span></button>
        <button type="button" className="btn pos-touch" onClick={p.onHold} disabled={p.busy || p.cartEmpty}><Icon name="clock" size={18} />{t('tl_hold')} <span className="kbd">F6</span></button>
        <button type="button" className="btn primary pos-touch pos-pay-btn" onClick={p.onPay} disabled={!p.canPay}>
          <Icon name="check" size={22} />{t('pos_pay')} <span className="kbd">F9</span>
        </button>
      </div>
      {cashIQD && <button type="button" className="link-btn small pos-exact" disabled={!p.canPay} onClick={p.onExact}>{t('tu_k_exact')} <span className="kbd ltr">Ctrl+Enter</span></button>}
    </section>
  );
}
