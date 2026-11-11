import { useState, type CSSProperties, type ReactNode } from 'react';
import { addDays, todayIso } from '@qasa/core';
import { briefApi, type BriefView, type Money2 } from '../industry/brief-api.ts';
import { ErrorBox, Icon, Modal, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import { href } from '../router.ts';
import { copyText, openWhatsApp, whatsappNumber, whatsappUrl } from '../share.ts';
import { chequeBriefLines, ChequesBriefSection } from '../industry/ChequesAhead.tsx';
import { printDocument } from '../industry/printing.ts';

/**
 * The Daily Brief: the whole business on one page for a day — sales against the same day last week, the cash in
 * each safe and bank, what came in and went out, the best sellers, who is late paying, installments due, what is
 * running out and what waits for approval. Made to be read on a phone, printed, or sent to the owner on WhatsApp.
 */

const accent = 'var(--accent, #1D5FD1)';
const good = 'var(--ok, #1F7A52)';
const bad = 'var(--bad, #A4271A)';

/** Two currencies side by side, leaving out the one that is zero. */
export function moneyBoth(i18n: I18n, m: Money2): string {
  const parts = [];
  if (m.IQD !== 0 || m.USD === 0) parts.push(i18n.money(m.IQD, 'IQD'));
  if (m.USD !== 0) parts.push(i18n.money(m.USD, 'USD'));
  return parts.join(' + ');
}

function change(today: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((today - before) / Math.abs(before)) * 100);
}

/** The short WhatsApp version of the brief. */
export function briefText(i18n: I18n, b: BriefView): string {
  const { t } = i18n;
  const company = i18n.name(b.company);
  const pct = change(b.sales.today, b.sales.sameDayLastWeek);
  const lines = [
    `*${t('br_title')}${company ? ` — ${company}` : ''}*`,
    i18n.date(b.date),
    '',
    `💰 ${t('br_salesToday')}: ${i18n.money(b.sales.today, 'IQD')}${pct !== null ? ` (${i18n.ltr(`${pct >= 0 ? '+' : '-'}${i18n.int(Math.abs(pct))}%`)} ${t('br_vsLastWeek')})` : ''}`,
    `🏦 ${t('br_cashNow')}: ${moneyBoth(i18n, b.cash.total)}`,
    `⬇️ ${t('br_moneyIn')}: ${i18n.money(b.flow.in, 'IQD')}   ⬆️ ${t('br_moneyOut')}: ${i18n.money(b.flow.out, 'IQD')}`,
    `📅 ${t('br_salesMonth')}: ${i18n.money(b.sales.month, 'IQD')}`
  ];
  if (b.topItems.length) {
    lines.push('', `⭐ ${t('br_topItems')}:`);
    for (const it of b.topItems.slice(0, 3)) lines.push(`• ${i18n.name(it.name)} — ${i18n.money(it.sales, 'IQD')}`);
  }
  if (b.lateCustomers.length) {
    lines.push('', `⏰ ${t('br_lateCustomers')}:`);
    for (const c of b.lateCustomers.slice(0, 5)) lines.push(`• ${c.name} — ${i18n.money(c.balance, 'IQD')} (${t('br_days', { n: i18n.int(c.oldestDays) })})`);
  }
  if (b.installments.overdue.length) lines.push('', `📌 ${t('br_installmentsLate')}: ${i18n.int(b.installments.overdue.length)} · ${moneyBoth(i18n, b.installments.overdueTotal)}`);
  if (b.installments.dueTomorrow.length) lines.push(`🗓️ ${t('br_dueTomorrow')}: ${i18n.int(b.installments.dueTomorrow.length)}`);
  lines.push(...chequeBriefLines(i18n, b.cheques));
  if (b.lowStock.length) lines.push('', `📦 ${t('br_lowStock')}: ${b.lowStock.slice(0, 5).map((s) => i18n.name(s.name)).join('، ')}`);
  const waiting = b.approvals.waitingCheck + b.approvals.waitingApproval;
  if (waiting) lines.push('', `✍️ ${t('br_waitingApprovals', { n: i18n.int(waiting) })}`);
  lines.push('', `— ${t('appName')}`);
  return lines.join('\n');
}

export function Stat({ label, value, sub, color, icon }: { label: string; value: string; sub?: ReactNode; color?: string; icon: string }) {
  return (
    <div className="card pad tile">
      <div className="label"><span className="ico"><Icon name={icon} size={18} /></span>{label}</div>
      <div className="value num" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="small muted" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function Section({ title, icon, children, empty, action }: { title: string; icon: string; children: ReactNode; empty?: boolean; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="card" style={{ breakInside: 'avoid' }}>
      <div className="card-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name={icon} size={18} />{title}</h2>
        <span className="spacer" />
        {action}
      </div>
      {empty ? <p className="muted" style={{ padding: '0 16px 16px', margin: 0 }}>{t('br_allClear')}</p> : children}
    </section>
  );
}

export const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: '0 16px 12px' };
export const itemStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line, #E4E1D8)', flexWrap: 'wrap' };

export function Brief() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'br_title', group: 'gOverview' });
  const [date, setDate] = useState(todayIso());
  const { data: b, error, reload } = useLoad(() => briefApi.brief(date), [date]);
  const [phoneModal, setPhoneModal] = useState(false);

  async function copy() {
    if (!b) return;
    toast(await copyText(briefText(i18n, b)) ? t('br_copied') : t('br_copyFailed'));
  }

  function send() {
    if (!b) return;
    if (!whatsappNumber(b.ownerPhone)) { setPhoneModal(true); return; }
    openWhatsApp(b.ownerPhone, briefText(i18n, b));
  }

  const pct = b ? change(b.sales.today, b.sales.sameDayLastWeek) : null;
  const waiting = b ? b.approvals.waitingCheck + b.approvals.waitingApproval : 0;

  return (
    <div className="stack" style={{ maxWidth: 1100, marginInline: 'auto', width: '100%' }}>
      <div className="row no-print" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <label className="field">
          <span>{t('date')}</span>
          <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button type="button" className="btn ghost" onClick={() => setDate(addDays(date, -1))} aria-label={t('br_prevDay')}><Icon name="chevron" size={16} className="flip" /></button>
        <button type="button" className="btn ghost" onClick={() => setDate(addDays(date, 1))} disabled={date >= todayIso()} aria-label={t('br_nextDay')}><Icon name="chevron" size={16} /></button>
        <span className="spacer" />
        <a className="btn" href={href('day-close')} title={t('dc_open')}><Icon name="check" size={16} />{t('dc_title')}</a>
        <button type="button" className="btn primary" onClick={send} disabled={!b}><Icon name="mail" size={16} />{t('br_sendWhatsApp')}</button>
        <button type="button" className="btn" onClick={() => void copy()} disabled={!b}><Icon name="doc" size={16} />{t('br_copy')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')} disabled={!b}><Icon name="printer" size={16} />{t('br_print')}</button>
        <button type="button" className="btn ghost" onClick={() => setPhoneModal(true)} aria-label={t('br_ownerPhone')}><Icon name="sliders" size={16} /></button>
      </div>
      <ErrorBox error={error} />
      {b && (
        <>
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 26 }}>{t('br_title')}</h1>
            <span className="muted">{i18n.name(b.company)}{i18n.name(b.company) ? ' · ' : ''}{i18n.date(b.date)}</span>
          </header>

          <div className="grid-4">
            <Stat icon="trend" label={t('br_salesToday')} value={i18n.money(b.sales.today, 'IQD')}
              color={accent}
              sub={<>
                {t('br_invoicesCount', { n: i18n.int(b.sales.invoices) })}
                {pct !== null && <> · <span style={{ color: pct >= 0 ? good : bad, fontWeight: 600 }}>{pct >= 0 ? '▲' : '▼'} {i18n.int(Math.abs(pct))}%</span> {t('br_vsLastWeek')}</>}
              </>} />
            <Stat icon="wallet" label={t('br_cashNow')} value={moneyBoth(i18n, b.cash.total)} sub={t('br_cashAccounts', { n: i18n.int(b.cash.accounts.length) })} />
            <Stat icon="plus" label={t('br_moneyIn')} value={i18n.money(b.flow.in, 'IQD')} color={good} sub={`${t('br_moneyOut')}: ${i18n.money(b.flow.out, 'IQD')}`} />
            <Stat icon="chart" label={t('br_salesMonth')} value={i18n.money(b.sales.month, 'IQD')} sub={`${t('br_receivables')}: ${i18n.money(b.receivables, 'IQD')}`} />
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <Section title={t('br_cashByAccount')} icon="wallet" empty={!b.cash.accounts.length}>
              <ul style={listStyle}>
                {b.cash.accounts.map((a) => (
                  <li key={a.code} style={itemStyle}>
                    <span className="tree-code">{i18n.digitsOf(a.code)}</span>
                    <span style={{ flex: 1 }}>{i18n.name(a.name)}</span>
                    <strong className="num">{moneyBoth(i18n, a.balance)}</strong>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t('br_topItems')} icon="star" empty={!b.topItems.length}>
              <ul style={listStyle}>
                {b.topItems.map((it, n) => (
                  <li key={it.itemId} style={itemStyle}>
                    <span className="count" style={{ minWidth: 24, textAlign: 'center' }}>{i18n.int(n + 1)}</span>
                    <span style={{ flex: 1 }}><a href={href(`item/${it.itemId}`)}>{i18n.name(it.name)}</a> <span className="small muted">×{i18n.digitsOf(String(it.qtyMilli / 1000))}</span></span>
                    <strong className="num">{i18n.money(it.sales, 'IQD')}</strong>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t('br_lateCustomers')} icon="contact" empty={!b.lateCustomers.length}>
              <ul style={listStyle}>
                {b.lateCustomers.map((c) => {
                  const wa = whatsappNumber(c.phone);
                  return (
                    <li key={c.partyId} style={itemStyle}>
                      <span style={{ flex: 1, minWidth: 140 }}>
                        <a href={href(`party/${c.partyId}`)}>{c.name}</a>
                        <span className="small" style={{ display: 'block', color: c.oldestDays > 90 ? bad : 'inherit' }}>{t('br_owesSince', { n: i18n.int(c.oldestDays) })}</span>
                      </span>
                      <strong className="num">{i18n.money(c.balance, 'IQD')}</strong>
                      {wa && (
                        <a className="btn small no-print" target="_blank" rel="noopener noreferrer"
                          href={whatsappUrl(c.phone, t('br_remindText', { company: i18n.name(b.company), amount: i18n.money(c.balance, 'IQD') }))}>
                          {t('br_remind')}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>

            <Section title={t('br_installments')} icon="cal" empty={!b.installments.overdue.length && !b.installments.dueTomorrow.length}
              action={b.installments.overdue.length ? <a className="btn ghost small no-print" href={href('installments-aging')}>{t('br_seeAll')}</a> : undefined}>
              <ul style={listStyle}>
                {b.installments.overdue.map((r) => (
                  <li key={'o' + r.contractId} style={itemStyle}>
                    <span style={{ flex: 1, minWidth: 140 }}>
                      <a href={href(`installment/${r.contractId}`)}>{r.party}</a> <span className="small muted">{i18n.digitsOf(r.number)}</span>
                      <span className="small" style={{ display: 'block', color: bad }}>{t('br_lateDays', { n: i18n.int(r.daysLate) })}</span>
                    </span>
                    <strong className="num">{i18n.money(r.amount, r.currency)}</strong>
                  </li>
                ))}
                {b.installments.dueTomorrow.map((r) => (
                  <li key={'t' + r.contractId} style={itemStyle}>
                    <span style={{ flex: 1, minWidth: 140 }}>
                      <a href={href(`installment/${r.contractId}`)}>{r.party}</a>
                      <span className="small muted" style={{ display: 'block' }}>{t('br_dueTomorrow')}</span>
                    </span>
                    <strong className="num">{i18n.money(r.amount, r.currency)}</strong>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t('br_lowStock')} icon="box" empty={!b.lowStock.length}>
              <ul style={listStyle}>
                {b.lowStock.map((s) => (
                  <li key={s.itemId} style={itemStyle}>
                    <span style={{ flex: 1 }}><a href={href(`item/${s.itemId}`)}>{i18n.name(s.name)}</a> <span className="small muted">{i18n.digitsOf(s.code)}</span></span>
                    <span className="small muted">{t('br_soldMonth', { n: i18n.digitsOf(String(s.soldMilli / 1000)) })}</span>
                    <strong className="num" style={{ color: s.qtyMilli <= 0 ? bad : undefined }}>{i18n.qty(s.qtyMilli)}</strong>
                  </li>
                ))}
              </ul>
            </Section>

            {b.expiry && (b.expiry.expired > 0 || b.expiry.near > 0) && (
              <Section title={t('ex_title')} icon="clock" empty={false}>
                <p style={{ margin: '0 0 8px' }}>
                  <a href={href('expiry')}>{t('ex_alert', { e: b.expiry.expired, n: b.expiry.near, d: b.expiry.days })}</a>
                </p>
                <ul style={listStyle}>
                  {b.expiry.top.map((r) => (
                    <li key={`${r.itemId}|${r.batch}|${r.expiry}`} style={itemStyle}>
                      <span style={{ flex: 1 }}><a href={href(`item/${r.itemId}`)}>{i18n.name(r.itemName)}</a> <span className="small muted ltr">{r.batch}</span></span>
                      <span className="small num" style={{ color: r.state === 'expired' ? bad : undefined }}>{r.expiry ? i18n.date(r.expiry) : ''}</span>
                      <strong className="num">{i18n.qty(r.qtyMilli)}</strong>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <ChequesBriefSection cheques={b.cheques} />

            <Section title={t('br_approvals')} icon="receipt" empty={!waiting}>
              <div style={{ display: 'flex', gap: 12, padding: '0 16px 16px', flexWrap: 'wrap' }}>
                <a className="btn" href={href('entries/draft')}>{t('br_waitingCheck', { n: i18n.int(b.approvals.waitingCheck) })}</a>
                <a className="btn" href={href('entries/checked')}>{t('br_waitingApproval', { n: i18n.int(b.approvals.waitingApproval) })}</a>
              </div>
            </Section>
          </div>
          <p className="small muted">{t('br_onlyPosted')}</p>
        </>
      )}
      {phoneModal && (
        <OwnerPhoneModal current={b?.ownerPhone ?? ''} onClose={() => setPhoneModal(false)}
          onSaved={(phone) => {
            setPhoneModal(false);
            reload();
            if (b && whatsappNumber(phone)) openWhatsApp(phone, briefText(i18n, b));
          }} />
      )}
    </div>
  );
}

function OwnerPhoneModal({ current, onClose, onSaved }: { current: string; onClose(): void; onSaved(phone: string): void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(current);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const valid = !!whatsappNumber(phone);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const s = await briefApi.saveSettings({ ownerPhone: phone.trim() });
      onSaved(s.ownerPhone);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('br_ownerPhone')} onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('br_ownerPhoneHelp')}</p>
        <label className="field">
          <span>{t('br_phone')}</span>
          <input className="input ltr" inputMode="tel" dir="ltr" value={phone} placeholder="0750 123 4567"
            onChange={(e) => setPhone(e.target.value)} autoFocus />
        </label>
        {phone && !valid && <div className="small" style={{ color: bad }}>{t('br_phoneInvalid')}</div>}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || (!!phone && !valid)}>{t('br_saveAndSend')}</button>
        </div>
      </div>
    </Modal>
  );
}
