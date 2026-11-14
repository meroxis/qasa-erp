import { useCallback, useState, type ReactNode } from 'react';
import { addDays, todayIso } from '@qasa/core';
import { dayCloseApi, type DayCloseView, type DayMethod, type Money2 } from '../industry/brief-api.ts';
import { ErrorBox, Icon, downloadCsv, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { copyText } from '../share.ts';
import { WhatsAppSendButton } from '../industry/WhatsAppSend.tsx';
import { printDocument } from '../industry/printing.ts';
import { itemStyle, listStyle, moneyBoth, Section, Stat } from './Brief.tsx';

/**
 * The end-of-day close: what the owner checks when the shop shuts. The day's sales by how they were paid (and what was
 * paid back), each register's drawer (cash expected, counted, the difference), the expenses, debts collected and the
 * new ones, how many items are running out and the best sellers. Printed, exported to Excel, or sent on WhatsApp.
 */

const good = 'var(--ok, #1F7A52)';
const bad = 'var(--bad, #A4271A)';

const METHOD_KEY: Record<DayMethod, Key> = {
  cash: 'pay_cash', bank: 'dc_m_bank', card: 'pay_card', fib: 'pay_fib', zaincash: 'pay_zaincash', qi: 'pay_qi', credit: 'pay_account', loyalty: 'dc_m_loyalty'
};

export const methodLabel = (i18n: I18n, m: DayMethod): string => i18n.t(METHOD_KEY[m]);

/** A drawer's difference in words and colour: short (red), over (amber) or matching (green). */
export function differenceOf(d: Money2): { key: Key; color: string } {
  const total = d.IQD !== 0 ? d.IQD : d.USD;
  if (total < 0) return { key: 'dc_short', color: bad };
  if (total > 0) return { key: 'dc_over', color: 'var(--warn, #9A6200)' };
  return { key: 'dc_balanced', color: good };
}

/** The short WhatsApp version of the close, in the language of `i18n`. */
export function dayCloseText(i18n: I18n, c: DayCloseView): string {
  const { t } = i18n;
  const company = i18n.name(c.company);
  const lines = [
    `*${t('dc_title')}${company ? ` — ${company}` : ''}*`,
    i18n.date(c.date),
    '',
    `💰 ${t('dc_netSales')}: ${i18n.money(c.sales.net, 'IQD')} (${t('br_invoicesCount', { n: i18n.int(c.sales.invoices) })})`
  ];
  if (c.sales.returns) lines.push(`↩️ ${t('dc_returns')}: ${i18n.money(c.sales.returns, 'IQD')}`);
  if (c.methods.length) {
    lines.push('', `💳 ${t('dc_byMethod')}:`);
    for (const m of c.methods) lines.push(`• ${methodLabel(i18n, m.method)}: ${i18n.money(m.amount, 'IQD')}`);
  }
  if (c.drawers) {
    const d = differenceOf(c.drawers.difference);
    lines.push('', `🧾 ${t('pos_expected')}: ${moneyBoth(i18n, c.drawers.expected)} · ${t('pos_counted')}: ${moneyBoth(i18n, c.drawers.counted)}`);
    lines.push(`${t('pos_difference')}: ${moneyBoth(i18n, c.drawers.difference)} (${t(d.key)})`);
  }
  const open = c.registers.filter((r) => r.status === 'open').length;
  if (open) lines.push(`⏳ ${t('dc_stillOpen')}: ${i18n.int(open)}`);
  // the expenses (and the money in and out below) are not sent to someone who may not read the books
  lines.push('');
  if (c.expenses) lines.push(`📉 ${t('dc_expenses')}: ${i18n.money(c.expenses.total, 'IQD')}`);
  lines.push(`✅ ${t('dc_debtsCollected')}: ${i18n.money(c.debts.collected, 'IQD')}   📝 ${t('dc_debtsNew')}: ${i18n.money(c.debts.added, 'IQD')}`);
  if (c.lowStock.count) lines.push(`📦 ${t('dc_lowStockCount', { n: i18n.int(c.lowStock.count) })}`);
  if (c.topItems.length) {
    lines.push('', `⭐ ${t('dc_topItems')}:`);
    for (const it of c.topItems.slice(0, 3)) lines.push(`• ${i18n.name(it.name)} — ${i18n.money(it.sales, 'IQD')}`);
  }
  lines.push('', `— ${t('appName')}`);
  return lines.join('\n');
}

/**
 * The close as spreadsheet rows (section, item, count, amount): amounts are plain numbers in dinars (whole units for IQD,
 * dollars with cents), so Excel adds them up.
 */
export function dayCloseRows(i18n: I18n, c: DayCloseView): (string | number)[][] {
  const { t } = i18n;
  const iqd = (n: number) => n;
  const usd = (cents: number) => cents / 100;
  const rows: (string | number)[][] = [[t('dc_csvSection'), t('dc_csvItem'), t('dc_csvCount'), t('dc_amount')]];
  rows.push([t('dc_title'), c.date, '', '']);
  rows.push([t('dc_sales'), t('dc_sales'), c.sales.invoices, iqd(c.sales.gross)]);
  rows.push([t('dc_sales'), t('dc_returns'), c.sales.returnsCount, -iqd(c.sales.returns)]);
  rows.push([t('dc_sales'), t('dc_netSales'), '', iqd(c.sales.net)]);
  for (const m of c.methods) rows.push([t('dc_byMethod'), methodLabel(i18n, m.method), m.invoices, iqd(m.amount)]);
  for (const r of c.refunds) rows.push([t('dc_refunds'), methodLabel(i18n, r.method), '', -iqd(r.amount)]);
  for (const r of c.registers) {
    const label = `${r.register} (${r.number})`;
    rows.push([t('dc_registers'), `${label} — ${t('pos_expected')} IQD`, r.count, iqd(r.expected.IQD)]);
    if (r.expected.USD || r.counted?.USD) rows.push([t('dc_registers'), `${label} — ${t('pos_expected')} USD`, '', usd(r.expected.USD)]);
    if (r.counted) {
      rows.push([t('dc_registers'), `${label} — ${t('pos_counted')} IQD`, '', iqd(r.counted.IQD)]);
      if (r.counted.USD || r.expected.USD) rows.push([t('dc_registers'), `${label} — ${t('pos_counted')} USD`, '', usd(r.counted.USD)]);
      rows.push([t('dc_registers'), `${label} — ${t('pos_difference')} IQD`, '', iqd(r.difference?.IQD ?? 0)]);
    } else {
      rows.push([t('dc_registers'), `${label} — ${t('dc_stillOpen')}`, '', '']);
    }
  }
  if (c.expenses) {
    for (const e of c.expenses.rows) rows.push([t('dc_expenses'), [e.number ?? '', e.description].filter(Boolean).join(' — '), '', iqd(e.base)]);
    rows.push([t('dc_expenses'), t('pos_total'), c.expenses.rows.length, iqd(c.expenses.total)]);
  }
  for (const d of c.debts.collectedRows) rows.push([t('dc_debtsCollected'), d.name, '', iqd(d.amount)]);
  for (const d of c.debts.addedRows) rows.push([t('dc_debtsNew'), d.name, '', iqd(d.amount)]);
  if (c.flow) {
    rows.push([t('dc_moneyIn'), '', '', iqd(c.flow.in)]);
    rows.push([t('dc_moneyOut'), '', '', -iqd(c.flow.out)]);
  }
  rows.push([t('br_lowStock'), t('dc_lowStockCount', { n: c.lowStock.count }), c.lowStock.count, '']);
  for (const it of c.topItems) rows.push([t('dc_topItems'), `${it.code} — ${i18n.name(it.name)}`, it.qtyMilli / 1000, iqd(it.sales)]);
  return rows;
}

function MoneyCell({ children, color }: { children: ReactNode; color?: string | undefined }) {
  return <td className="num" style={{ whiteSpace: 'nowrap', ...(color ? { color, fontWeight: 600 } : {}) }}>{children}</td>;
}

export function DayClose() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'dc_title', group: 'gOverview' });
  const [date, setDate] = useState(todayIso());
  const { data: c, error } = useLoad(() => dayCloseApi.get(date), [date]);

  // the message in the language picked in the dialog (the owner's number from the Daily Brief's settings)
  const message = useCallback((m: I18n) => (c ? dayCloseText(m, c) : ''), [c]);
  const copy = async () => {
    if (c) toast(await copyText(dayCloseText(i18n, c)) ? t('br_copied') : t('br_copyFailed'));
  };
  const exportCsv = () => { if (c) downloadCsv(`end-of-day-${c.date}.csv`, dayCloseRows(i18n, c)); };

  const methodTotal = c ? c.methods.reduce((s, m) => s + m.amount, 0) : 0;
  const drawerDiff = c?.drawers ? differenceOf(c.drawers.difference) : null;

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
        <WhatsAppSendButton kind="dayclose" docRef={date} phone={c?.ownerPhone} message={message} label="br_sendWhatsApp" primary disabled={!c} />
        <button type="button" className="btn" onClick={() => void copy()} disabled={!c}><Icon name="doc" size={16} />{t('br_copy')}</button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!c}><Icon name="download" size={16} />{t('dc_export')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')} disabled={!c}><Icon name="printer" size={16} />{t('br_print')}</button>
      </div>
      <ErrorBox error={error} />
      {c && (
        <>
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 26 }}>{t('dc_title')}</h1>
            <span className="muted">{i18n.name(c.company)}{i18n.name(c.company) ? ' · ' : ''}{i18n.date(c.date)}</span>
          </header>

          <div className="grid-4">
            <Stat icon="trend" label={t('dc_netSales')} value={i18n.money(c.sales.net, 'IQD')} color="var(--accent, #1D5FD1)"
              sub={<>{t('br_invoicesCount', { n: i18n.int(c.sales.invoices) })}{c.sales.returns ? <> · {t('dc_returns')}: <span className="num">{i18n.money(c.sales.returns, 'IQD')}</span></> : null}</>} />
            <Stat icon="wallet" label={t('pos_expected')} value={c.drawers ? moneyBoth(i18n, c.drawers.expected) : '—'}
              sub={c.drawers ? <>{t('pos_counted')}: <span className="num">{moneyBoth(i18n, c.drawers.counted)}</span></> : t('dc_noRegisters')} />
            <Stat icon="scale" label={t('pos_difference')} value={c.drawers ? moneyBoth(i18n, c.drawers.difference) : '—'} color={drawerDiff?.color}
              sub={drawerDiff ? t(drawerDiff.key) : undefined} />
            {c.flow && <Stat icon="plus" label={t('dc_moneyIn')} value={i18n.money(c.flow.in, 'IQD')} color={good} sub={`${t('dc_moneyOut')}: ${i18n.money(c.flow.out, 'IQD')}`} />}
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <Section title={t('dc_byMethod')} icon="wallet" empty={!c.methods.length && !c.refunds.length}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('dc_method')}</th><th className="num">{t('dc_invoices')}</th><th className="num">{t('dc_amount')}</th></tr></thead>
                  <tbody>
                    {c.methods.map((m) => (
                      <tr key={m.method}>
                        <td>{methodLabel(i18n, m.method)}</td>
                        <td className="num">{i18n.int(m.invoices)}</td>
                        <MoneyCell>{i18n.money(m.amount, 'IQD')}</MoneyCell>
                      </tr>
                    ))}
                    {c.methods.length > 0 && <tr><td><strong>{t('dc_sales')}</strong></td><td /><MoneyCell><strong>{i18n.money(methodTotal, 'IQD')}</strong></MoneyCell></tr>}
                    {c.refunds.map((r) => (
                      <tr key={'r' + r.method}>
                        <td>{t('dc_refunds')} — {methodLabel(i18n, r.method)}</td>
                        <td />
                        <MoneyCell color={bad}>−{i18n.money(r.amount, 'IQD')}</MoneyCell>
                      </tr>
                    ))}
                    <tr><td><strong>{t('dc_netSales')}</strong></td><td /><MoneyCell><strong>{i18n.money(c.sales.net, 'IQD')}</strong></MoneyCell></tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={t('dc_registers')} icon="receipt" empty={!c.registers.length}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('pos_register')}</th><th className="num">{t('pos_expected')}</th><th className="num">{t('pos_counted')}</th><th className="num">{t('pos_difference')}</th></tr></thead>
                  <tbody>
                    {c.registers.map((r) => {
                      const d = r.difference ? differenceOf(r.difference) : null;
                      return (
                        <tr key={r.shiftId}>
                          <td>
                            <a href={href(`pos-shift/${r.shiftId}`)}>{r.register}</a>
                            <span className="small muted" style={{ display: 'block' }}><span className="ltr">{r.number}</span> · {r.openedBy}</span>
                          </td>
                          <MoneyCell>{moneyBoth(i18n, r.expected)}</MoneyCell>
                          <MoneyCell>{r.counted ? moneyBoth(i18n, r.counted) : <span className="chip info">{t('dc_stillOpen')}</span>}</MoneyCell>
                          <MoneyCell color={d?.color}>{r.difference ? moneyBoth(i18n, r.difference) : '—'}</MoneyCell>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            {c.expenses && <Section title={t('dc_expenses')} icon="wallet" empty={!c.expenses.rows.length}
              action={<strong className="num">{i18n.money(c.expenses.total, 'IQD')}</strong>}>
              <ul style={listStyle}>
                {c.expenses.rows.map((e) => (
                  <li key={e.entryId + e.accountCode} style={itemStyle}>
                    <span style={{ flex: 1, minWidth: 140 }}>
                      <a href={href(`entry/${e.entryId}`)}>{e.description || e.number || '—'}</a>
                      {e.status !== 'approved' && <span className="chip" style={{ marginInlineStart: 6 }}>{t(e.status === 'draft' ? 'draft' : 'checked')}</span>}
                    </span>
                    <strong className="num">{i18n.money(e.base, 'IQD')}</strong>
                  </li>
                ))}
              </ul>
            </Section>}

            <Section title={t('dc_debts')} icon="contact" empty={!c.debts.collectedRows.length && !c.debts.addedRows.length}>
              <div className="grid-2" style={{ padding: '0 16px 12px', gap: 16 }}>
                {([['dc_debtsCollected', c.debts.collected, c.debts.collectedRows, good], ['dc_debtsNew', c.debts.added, c.debts.addedRows, undefined]] as const).map(([key, total, rows, color]) => (
                  <div key={key}>
                    <div className="small muted">{t(key)}</div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 700, color }}>{i18n.money(total, 'IQD')}</div>
                    <ul style={{ ...listStyle, padding: 0 }}>
                      {rows.slice(0, 8).map((r) => (
                        <li key={r.partyId} style={itemStyle}>
                          <a href={href(`party/${r.partyId}`)} style={{ flex: 1 }}>{r.name}</a>
                          <span className="num">{i18n.money(r.amount, 'IQD')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={t('dc_topItems')} icon="star" empty={!c.topItems.length}>
              <ul style={listStyle}>
                {c.topItems.map((it, n) => (
                  <li key={it.itemId} style={itemStyle}>
                    <span className="count" style={{ minWidth: 24, textAlign: 'center' }}>{i18n.int(n + 1)}</span>
                    <span style={{ flex: 1 }}><a href={href(`item/${it.itemId}`)}>{i18n.name(it.name)}</a> <span className="small muted">×{i18n.qty(it.qtyMilli)}</span></span>
                    <strong className="num">{i18n.money(it.sales, 'IQD')}</strong>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t('br_lowStock')} icon="box" empty={!c.lowStock.count}
              action={c.lowStock.count ? <span className="chip bad num">{i18n.int(c.lowStock.count)}</span> : undefined}>
              <p style={{ margin: '0 16px 8px' }}>{t('dc_lowStockCount', { n: i18n.int(c.lowStock.count) })}</p>
              <ul style={listStyle}>
                {c.lowStock.top.map((s) => (
                  <li key={s.itemId} style={itemStyle}>
                    <span style={{ flex: 1 }}><a href={href(`item/${s.itemId}`)}>{i18n.name(s.name)}</a> <span className="small muted">{i18n.digitsOf(s.code)}</span></span>
                    <strong className="num" style={{ color: s.qtyMilli <= 0 ? bad : undefined }}>{i18n.qty(s.qtyMilli)}</strong>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          <p className="small muted">{t('dc_notes')}</p>
        </>
      )}
    </div>
  );
}
