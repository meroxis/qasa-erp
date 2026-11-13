import { useEffect, useState } from 'react';
import { maxRedeemPoints, pointsFor, toWesternDigits, type LoyaltyEarnRule, type LoyaltyLedgerRow, type LoyaltyRules } from '@qasa/core';
import { AccountCombo, ErrorBox, Icon, Modal, useData, useLoad, useToast } from '../components.tsx';
import { ChoiceTiles } from '../ChoiceTiles.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { loyaltyApi, type InvoiceLoyaltyView, type PartyLoyaltyView } from './loyalty-api.ts';
import { branchesApi } from './branches-api.ts';

/**
 * Loyalty points (Pro) on the screens: the rules (Settings), a customer's points and their ledger (the customer page),
 * using points at the till and on a sale invoice, and the points on a receipt or an invoice.
 */

/** A whole number typed in any digits, or null. */
export function wholeOf(text: string): number | null {
  const s = toWesternDigits(text).replace(/[,\s٬]/g, '').trim();
  if (!/^-?\d{1,12}$/.test(s)) return null;
  return Number(s);
}

/**
 * The points a sale of `total` may use: from the fewest at once to the most (the share points may pay, within the
 * balance). Null when none can be used (points off, too few, a dollar sale).
 */
export function redeemRange(total: number, balance: number, rules: Pick<LoyaltyRules, 'on' | 'pointValue' | 'minRedeem' | 'maxRedeemPercent'>, currency: string): { min: number; max: number } | null {
  if (!rules.on || currency !== 'IQD') return null;
  const max = maxRedeemPoints(total, balance, rules);
  return max >= rules.minRedeem ? { min: rules.minRedeem, max } : null;
}

const KIND_KEY: Record<LoyaltyLedgerRow['kind'], Key> = {
  earn: 'ly_k_earn', redeem: 'ly_k_redeem', return_earn: 'ly_k_return_earn', return_redeem: 'ly_k_return_redeem', cancel: 'ly_k_cancel', adjust: 'ly_k_adjust', expire: 'ly_k_expire'
};
export const loyaltyKindLabel = (i18n: I18n, kind: LoyaltyLedgerRow['kind']): string => i18n.t(KIND_KEY[kind]);

/* ---------- Settings ---------- */

export function LoyaltySettingsCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error: loadError, reload } = useLoad(() => loyaltyApi.settings(), []);
  const branches = useLoad(() => branchesApi.list().catch(() => ({ available: false, branches: [] })), []);
  const [rules, setRules] = useState<LoyaltyRules | null>(null);
  const [account, setAccount] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setRules(data.rules); setAccount(data.accountCode); } }, [data]);
  if (!data || !rules) return loadError ? <ErrorBox error={loadError} /> : null;

  const num = (v: number | null) => (v === null ? '' : String(v));
  const setNum = (patch: (n: number | null) => Partial<LoyaltyRules>) => (e: { target: { value: string } }) => setRules({ ...rules, ...patch(wholeOf(e.target.value)) });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await loyaltyApi.saveSettings({ rules, ...(account && account !== data.accountCode ? { accountCode: account } : {}) });
      toast(t('saved'));
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const example = 100_000;
  const examplePoints = pointsFor(example, rules.earn);
  const branchRule = (id: string): 'same' | 'off' | 'own' => (rules.branches[id] === 'off' ? 'off' : rules.branches[id] ? 'own' : 'same');
  const setBranch = (id: string, value: LoyaltyEarnRule | 'off' | null) => {
    const next = { ...rules.branches };
    if (value === null) delete next[id]; else next[id] = value;
    setRules({ ...rules, branches: next });
  };

  return (
    <div className="card pad stack">
      <div className="card-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="star" size={18} />{t('ly_title')}</h2>
        <span className="chip info">Pro</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('ly_help')}</p>
      {!data.available && <div className="alert info">{t('ly_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={rules.on} disabled={!data.available && !rules.on} onChange={(e) => setRules({ ...rules, on: e.target.checked })} />
        {t('ly_on')}
      </label>
      <div className="grid-3">
        <label className="field"><span>{t('ly_earnPoints')}</span>
          <input className="input num ltr" inputMode="numeric" value={num(rules.earn.points)} onChange={setNum((n) => ({ earn: { ...rules.earn, points: n ?? 0 } }))} /></label>
        <label className="field"><span>{t('ly_earnPer')}</span>
          <input className="input num ltr" inputMode="numeric" value={num(rules.earn.per)} onChange={setNum((n) => ({ earn: { ...rules.earn, per: n ?? 0 } }))} /></label>
        <label className="field"><span>{t('ly_pointValue')}</span>
          <input className="input num ltr" inputMode="numeric" value={num(rules.pointValue)} onChange={setNum((n) => ({ pointValue: n ?? 0 }))} /></label>
        <label className="field"><span>{t('ly_minRedeem')}</span>
          <input className="input num ltr" inputMode="numeric" value={num(rules.minRedeem)} onChange={setNum((n) => ({ minRedeem: n ?? 0 }))} /></label>
        <label className="field"><span>{t('ly_maxPercent')}</span>
          <input className="input num ltr" inputMode="numeric" value={num(rules.maxRedeemPercent)} onChange={setNum((n) => ({ maxRedeemPercent: n ?? 0 }))} /></label>
        <label className="field"><span>{t('ly_expiry')}</span>
          <input className="input num ltr" inputMode="numeric" value={num(rules.expiryMonths)} placeholder="—" onChange={setNum((n) => ({ expiryMonths: n && n > 0 ? n : null }))} />
          <span className="small muted">{t('ly_expiryNever')}</span></label>
      </div>
      {rules.earn.per > 0 && rules.pointValue > 0 && (
        <div className="small muted">{t('ly_example', { a: i18n.money(example, 'IQD'), p: i18n.int(examplePoints), v: i18n.money(examplePoints * rules.pointValue, 'IQD') })}</div>
      )}
      <div className="field">
        <span>{t('ly_account')}</span>
        <AccountCombo value={account} onChange={setAccount} filter={(a) => /^[34]/.test(a.code)} ariaLabel={t('ly_account')} />
        <span className="small muted">{t('ly_accountHelp')}</span>
      </div>
      {(branches.data?.branches.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{t('ly_branches')}</h3>
          {branches.data!.branches.map((b) => {
            const mode = branchRule(b.id);
            const own = rules.branches[b.id];
            return (
              <div key={b.id} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ minWidth: 140 }}>{b.name}</span>
                <ChoiceTiles
                  label={`${t('ly_branches')} — ${b.name}`} value={mode}
                  onChange={(v) => setBranch(b.id, v === 'off' ? 'off' : v === 'own' ? { ...rules.earn } : null)}
                  options={[{ value: 'same', label: t('ly_branchSame') }, { value: 'off', label: t('ly_branchOff') }, { value: 'own', label: t('ly_branchOwn') }]}
                />
                {own && own !== 'off' && (
                  <>
                    <input className="input num ltr" style={{ width: 90 }} inputMode="numeric" aria-label={t('ly_earnPoints')} value={String(own.points)}
                      onChange={(e) => setBranch(b.id, { ...own, points: wholeOf(e.target.value) ?? 0 })} />
                    <span className="small muted">{t('ly_earnPer')}</span>
                    <input className="input num ltr" style={{ width: 120 }} inputMode="numeric" aria-label={t('ly_earnPer')} value={String(own.per)}
                      onChange={(e) => setBranch(b.id, { ...own, per: wholeOf(e.target.value) ?? 0 })} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ErrorBox error={error} />
      <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button></div>
    </div>
  );
}

/* ---------- the customer page ---------- */

export function LoyaltyCard({ partyId, admin }: { partyId: string; admin: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data: l, reload } = useLoad(() => loyaltyApi.party(partyId), [partyId]);
  const [adjusting, setAdjusting] = useState(false);
  // nothing to show while points are off and the customer never had any
  if (!l || (!l.rules.on && l.rows.length === 0)) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="star" size={18} />{t('ly_title')}</h3>
        <span className="spacer" />
        {admin && l.available && <button type="button" className="btn small no-print" onClick={() => setAdjusting(true)}><Icon name="edit" size={14} />{t('ly_adjust')}</button>}
      </div>
      <div className="grid-3" style={{ padding: '0 var(--card-pad-x, 16px) 12px' }}>
        <div>
          <div className="small muted">{t('ly_balance')}</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 700, color: l.balance < 0 ? 'var(--bad)' : 'var(--accent)' }}>{t('ly_points', { n: i18n.int(l.balance) })}</div>
          <div className="small muted">{t('ly_worth', { v: i18n.money(l.worth, 'IQD') })}</div>
        </div>
        {l.expiring && (
          <div>
            <div className="small muted">{t('ly_nextLapse')}</div>
            <div style={{ color: 'var(--warn)' }}>{t('ly_expiring', { p: i18n.int(l.expiring.points), d: i18n.date(l.expiring.on) })}</div>
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('ly_ledger')}</th><th className="num">{t('ly_earnPoints')}</th><th className="num">{t('balance')}</th></tr></thead>
          <tbody>
            {l.rows.length === 0 && <tr><td colSpan={4} className="muted">{t('ly_noMoves')}</td></tr>}
            {l.rows.slice(0, 200).map((r) => (
              <tr key={r.id}>
                <td className="num">{i18n.date(r.date)}</td>
                <td>
                  {loyaltyKindLabel(i18n, r.kind)}
                  {r.invoiceId && <> · <a href={href(`invoice/${r.invoiceId}`)}>{t('openInvoice')}</a></>}
                  {r.value > 0 && <span className="small muted"> · {i18n.money(r.value, 'IQD')}</span>}
                  {r.note && <span className="small muted" style={{ display: 'block' }}>{r.note}</span>}
                </td>
                <td className="num" style={{ color: r.points < 0 ? 'var(--bad)' : 'var(--ok)' }}>{i18n.int(r.points, { plus: true })}</td>
                <td className="num">{i18n.int(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adjusting && <AdjustModal partyId={partyId} onClose={() => setAdjusting(false)} onSaved={() => { setAdjusting(false); reload(); }} />}
    </div>
  );
}

function AdjustModal({ partyId, onClose, onSaved }: { partyId: string; onClose(): void; onSaved(view: PartyLoyaltyView): void }) {
  const { t } = useI18n();
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const n = wholeOf(points);
  const save = async () => {
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await loyaltyApi.adjust(partyId, { points: n, note: note.trim() }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('ly_adjust')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('ly_adjustPoints')}</span><input className="input num ltr" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} autoFocus /></label>
        <label className="field"><span>{t('ly_adjustNote')}</span><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || !n || !note.trim()} onClick={() => void save()}>{t('save')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- using points: the till and the sale invoice ---------- */

/**
 * The customer's points and a field for those used on this sale. Says what the points pay and what is left; `onChange`
 * gets the points (0: none) and their value. Nothing shows without a customer, while points are off, or for a dollar sale.
 */
export function LoyaltyUse({ partyId, total, currency, value: points, onChange }: {
  partyId: string | null | undefined; total: number; currency: string; value: number; onChange(points: number, value: number): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { plan } = useData();
  const [view, setView] = useState<PartyLoyaltyView | null>(null);
  const [text, setText] = useState(points ? String(points) : '');
  const on = !!plan?.features.includes('loyalty');
  useEffect(() => {
    setView(null);
    if (!on || !partyId) return;
    let live = true;
    loyaltyApi.party(partyId).then((v) => { if (live) setView(v); }, () => {});
    return () => { live = false; };
  }, [partyId, on]);
  useEffect(() => { if (!points) setText(''); }, [points]);
  if (!view || !view.rules.on || !partyId) return null;
  const range = redeemRange(total, view.balance, view.rules, currency);
  const pick = (n: number | null) => {
    const ok = n !== null && range && n >= range.min && n <= range.max ? n : 0;
    onChange(ok, ok * view.rules.pointValue);
  };
  const typed = wholeOf(text);
  const wrong = text.trim() !== '' && (!range || typed === null || typed < range.min || typed > range.max);
  return (
    <div className="stack loyalty-use" style={{ gap: 4 }}>
      <div className="small"><Icon name="star" size={14} /> {t('ly_available', { n: i18n.int(view.balance), v: i18n.money(view.worth, 'IQD') })}</div>
      {currency !== 'IQD' ? <div className="small muted">{t('ly_iqdOnly')}</div> : range ? (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input className="input num ltr" inputMode="numeric" aria-label={t('ly_use')} placeholder={t('ly_use')} value={text} aria-invalid={wrong}
              onChange={(e) => { setText(e.target.value); pick(wholeOf(e.target.value)); }} />
            <button type="button" className="btn small" onClick={() => { setText(String(range.max)); pick(range.max); }}>{t('ly_useMax', { n: i18n.int(range.max) })}</button>
          </div>
          <div className="small muted">{t('ly_limits', { min: i18n.int(range.min), max: i18n.int(range.max) })}</div>
          {points > 0 && <div className="small" style={{ color: 'var(--ok)' }}>{t('ly_pays', { v: i18n.money(points * view.rules.pointValue, 'IQD'), r: i18n.money(total - points * view.rules.pointValue, 'IQD') })}</div>}
          {wrong && <div className="small" style={{ color: 'var(--bad)' }}>{t('ly_limits', { min: i18n.int(range.min), max: i18n.int(range.max) })}</div>}
        </>
      ) : null}
    </div>
  );
}

/* ---------- on a receipt or an invoice ---------- */

/** The lines a receipt or an invoice shows for points: earned (or taken back), used (or given back), the balance now. */
export function loyaltyLines(i18n: I18n, l: InvoiceLoyaltyView | null | undefined): [string, string][] {
  if (!l) return [];
  const { t } = i18n;
  const lines: [string, string][] = [];
  if (l.redeemed > 0) lines.push([t('ly_used'), `${i18n.int(l.redeemed)} (−${i18n.money(l.value, 'IQD')})`]);
  if (l.redeemed < 0) lines.push([t('ly_given'), `${i18n.int(-l.redeemed)} (${i18n.money(l.value, 'IQD')})`]);
  if (l.earned > 0) lines.push([t('ly_earned'), i18n.int(l.earned)]);
  if (l.earned < 0) lines.push([t('ly_taken'), i18n.int(-l.earned)]);
  lines.push([t('ly_newBalance'), i18n.int(l.balance)]);
  return lines;
}
