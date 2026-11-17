import { useEffect, useMemo, useState } from 'react';
import { FUEL_SHIFTS, meterText, parseMeter, shiftCash, shiftTotals, todayIso, type FuelShift } from '@qasa/core';
import { ApiError } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, useData, useLoad, useMay, usePageNav, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { fuelApi, type FuelSettings, type FuelSetupView, type FuelTypeView, type ShiftSummary, type ShiftView } from '../industry/fuel-api.ts';
import { printDocument } from '../industry/printing.ts';
// the till's rows of expected and counted cash (.pos-r-row), shared by the shift's cash
import '../pos.css';

/**
 * محطات الوقود (prototype, Pro): the shifts with each attendant's short and over, the shift sheet (closing meter
 * readings → litres × price → expected cash against the cash handed in), and the pumps, nozzles and fuel prices.
 */

export type PetrolTab = 'shifts' | 'setup';
const NAV = { key: 'ps_title' as Key, group: 'gIndustry' as Key };
const thisMonth = () => todayIso().slice(0, 7);

function Unavailable({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) return <div className="alert info">{t('ps_needsPro')}</div>;
  return <ErrorBox error={error} />;
}

const fuelName = (i18n: I18n, types: readonly FuelTypeView[], id: string) => {
  const f = types.find((x) => x.id === id);
  return f ? i18n.name(f.name) : '';
};

/** A shift's difference as the till shows a drawer's: red when short or over, green when exact, with the word. */
export function DiffText({ d }: { d: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const text = d === 0 ? t('ps_exact') : t(d < 0 ? 'ps_shortBy' : 'ps_overBy', { a: i18n.money(Math.abs(d), 'IQD') });
  return <span style={{ color: d === 0 ? 'var(--ok)' : 'var(--bad)' }}>{text}</span>;
}

function ShiftChip({ s }: { s: Pick<ShiftSummary, 'status'> }) {
  const { t } = useI18n();
  return <span className={'chip ' + (s.status === 'open' ? 'warn' : 'ok')}>{t(s.status === 'open' ? 'ps_open' : 'ps_closed')}</span>;
}

/* ---------- the page ---------- */

export function PetrolStation({ tab = 'shifts' }: { tab?: PetrolTab }) {
  const { t } = useI18n();
  usePageNav(NAV);
  const setup = useLoad(() => fuelApi.setup(), []);
  if (setup.error) return <Unavailable error={setup.error} />;
  const s = setup.data;
  const tabs: [PetrolTab, Key][] = [['shifts', 'ps_tabShifts'], ['setup', 'ps_tabSetup']];
  return (
    <div className="stack">
      {s && !s.available && <div className="alert">{t('ps_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="row no-print">
        <div className="track" role="tablist">
          {tabs.map(([k, label]) => (
            <a key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="btn" style={{ border: 'none' }}
              href={href(k === 'shifts' ? 'petrol' : `petrol/${k}`)}>{t(label)}</a>
          ))}
        </div>
      </div>
      {s && tab === 'shifts' && <Shifts setup={s} />}
      {s && tab === 'setup' && <Setup setup={s} onChange={setup.reload} />}
    </div>
  );
}

/* ---------- shifts ---------- */

function Shifts({ setup }: { setup: FuelSetupView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const mayDo = useMay();
  const month = thisMonth();
  const list = useLoad(() => fuelApi.shifts(), []);
  const people = useLoad(() => fuelApi.attendants(`${month}-01`, `${month}-31`), [month]);
  const [opening, setOpening] = useState(false);
  const today = todayIso();
  const shifts = list.data ?? [];
  const todays = shifts.filter((x) => x.date === today && x.status === 'closed');
  const litresToday = useLoad(() => Promise.all(todays.map((x) => fuelApi.shift(x.id))).then((v) => v.reduce((sum, x) => sum + x.totals.milli, 0)), [todays.map((x) => x.id).join()]);
  const short = (people.data ?? []).reduce((sum, p) => sum + p.short, 0);
  const over = (people.data ?? []).reduce((sum, p) => sum + p.over, 0);
  const tiles = [
    { label: t('ps_tileOpen'), value: i18n.int(shifts.filter((x) => x.status === 'open').length), sub: '' },
    { label: t('ps_tileToday'), value: i18n.money(todays.reduce((sum, x) => sum + (x.sales ?? 0), 0), 'IQD'), sub: '' },
    { label: t('ps_tileLitres'), value: t('ps_litresN', { n: i18n.qty(litresToday.data ?? 0) }), sub: '' },
    { label: t('ps_tileShort'), value: i18n.money(short, 'IQD'), sub: t('ps_tileOver', { a: i18n.money(over, 'IQD') }) }
  ];
  return (
    <div className="stack">
      <div className="grid-4 no-print">
        {tiles.map((tile) => (
          <div key={tile.label} className="card pad tile">
            <div className="label">{tile.label}</div>
            <div className="value num">{tile.value}</div>
            {tile.sub && <div className="small muted">{tile.sub}</div>}
          </div>
        ))}
      </div>
      <div className="row">
        {setup.available && mayDo('fuelShift') && (
          <button type="button" className="btn primary" style={{ fontSize: 16, padding: '10px 22px' }} onClick={() => setOpening(true)}>
            <Icon name="plus" size={18} />{t('ps_openShift')}
          </button>
        )}
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && !shifts.length && <div className="pad muted">{t('ps_noShifts')}</div>}
        {!!shifts.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('ps_number')}</th><th>{t('date')}</th><th>{t('ps_shift')}</th><th>{t('ps_attendant')}</th><th>{t('ps_pumps')}</th>
                  <th className="amount">{t('ps_sales')}</th><th className="amount">{t('ps_handed')}</th><th>{t('ps_difference')}</th><th>{t('ps_entry')}</th><th />
                </tr>
              </thead>
              <tbody>
                {shifts.map((x) => (
                  <tr key={x.id} className="click" onClick={() => go(`fuel-shift/${x.id}`)}>
                    <td><a className="num ltr" href={href(`fuel-shift/${x.id}`)} onClick={(e) => e.stopPropagation()}>{x.number}</a></td>
                    <td className="num">{i18n.date(x.date)}</td>
                    <td>{t(`ps_shift_${x.shift}`)}</td>
                    <td>{x.attendant}</td>
                    <td className="num">{i18n.digitsOf(x.pumps.join(i18n.lang === 'en' ? ', ' : '، '))}</td>
                    <td className="amount num">{x.sales === null ? '—' : i18n.money(x.sales, 'IQD')}</td>
                    <td className="amount num">{x.handed === null || x.status === 'open' ? '—' : i18n.money(x.handed, 'IQD')}</td>
                    <td className="num">{x.difference === null ? '—' : <DiffText d={x.difference} />}</td>
                    <td>{x.entry ? <a className="num ltr" href={href(`entry/${x.entry.id}`)} onClick={(e) => e.stopPropagation()}>{x.entry.number ?? t('ps_entryWaiting')}</a> : '—'}</td>
                    <td><ShiftChip s={x} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card pad stack">
        <h3 style={{ margin: 0 }}>{t('ps_byAttendant')}</h3>
        <ErrorBox error={people.error} />
        {people.data && !!people.data.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('ps_attendant')}</th><th className="num">{t('ps_shiftsCount')}</th><th className="amount">{t('ps_sales')}</th><th className="amount">{t('ps_short')}</th><th className="amount">{t('ps_over')}</th><th className="amount">{t('ps_net')}</th></tr>
              </thead>
              <tbody>
                {people.data.map((p) => (
                  <tr key={p.attendant}>
                    <td>{p.attendant}</td>
                    <td className="num">{i18n.int(p.shifts)}</td>
                    <td className="amount num">{i18n.money(p.sales, 'IQD')}</td>
                    <td className="amount num" style={p.short ? { color: 'var(--bad)' } : undefined}>{p.short ? i18n.money(p.short, 'IQD') : '—'}</td>
                    <td className="amount num">{p.over ? i18n.money(p.over, 'IQD') : '—'}</td>
                    <td className="amount num"><DiffText d={p.over - p.short} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {opening && <OpenShiftModal setup={setup} attendants={[...new Set(shifts.map((x) => x.attendant))]} onClose={() => setOpening(false)} />}
    </div>
  );
}

function OpenShiftModal({ setup, attendants, onClose }: { setup: FuelSetupView; attendants: string[]; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [date, setDate] = useState(todayIso());
  const [shift, setShift] = useState<FuelShift>('morning');
  const [attendant, setAttendant] = useState('');
  const free = setup.pumps.filter((p) => p.active && p.nozzles.every((n) => !n.openShift));
  const [pumps, setPumps] = useState<string[]>(free.map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const made = await fuelApi.open({ date, shift, attendant, pumpIds: pumps });
      go(`fuel-shift/${made.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('ps_openTitle')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('ps_attendant')}</span>
            <input className="input" value={attendant} onChange={(e) => setAttendant(e.target.value)} list="ps-attendants" autoFocus />
            <datalist id="ps-attendants">{attendants.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
        </div>
        <div className="field">
          <span>{t('ps_shift')}</span>
          <div className="track" role="radiogroup">
            {FUEL_SHIFTS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={shift === s} aria-pressed={shift === s} className="btn" style={{ border: 'none' }} onClick={() => setShift(s)}>
                {t(`ps_shift_${s}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{t('ps_pumps')}</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {setup.pumps.filter((p) => p.active).map((p) => {
              const inShift = p.nozzles.find((n) => n.openShift)?.openShift;
              return (
                <label key={p.id} className="row" style={{ gap: 6 }}>
                  <input type="checkbox" disabled={!!inShift} checked={pumps.includes(p.id)}
                    onChange={(e) => setPumps((list) => (e.target.checked ? [...list, p.id] : list.filter((x) => x !== p.id)))} />
                  <span>{t('ps_pump', { n: p.number })}</span>
                  {inShift && <span className="chip warn">{t('ps_inShift', { n: inShift })}</span>}
                </label>
              );
            })}
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_openHelp')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !attendant.trim() || !pumps.length} onClick={() => void submit()}><Icon name="check" size={16} />{t('ps_openShift')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- the shift sheet ---------- */

export function FuelShiftSheet({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav(NAV);
  const mayDo = useMay();
  const loaded = useLoad(() => Promise.all([fuelApi.shift(id), fuelApi.setup()]), [id]);
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [credit, setCredit] = useState<number | null>(null);
  const [handed, setHanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const shift: ShiftView | null = loaded.data?.[0] ?? null;
  const setup = loaded.data?.[1] ?? null;

  useEffect(() => {
    if (!shift) return;
    setClosing(Object.fromEntries(shift.readings.map((r) => [r.nozzleId, r.closingMilli === null ? '' : meterText(r.closingMilli)])));
    setCredit(shift.credit || null);
    setHanded(shift.handed);
  }, [shift]);

  const editable = !!shift && shift.actions.includes('close') && mayDo('fuelShift');
  // the sheet as it stands on the screen: the readings typed, the litres and money they make
  const readings = useMemo(() => (shift ? shift.readings.map((r) => {
    const text = closing[r.nozzleId] ?? '';
    const parsed = editable ? (text.trim() ? parseMeter(text) : null) : r.closingMilli;
    return { ...r, closingMilli: parsed, text, bad: editable && text.trim() !== '' && parsed === null };
  }) : []), [shift, closing, editable]);
  if (loaded.error) return <Unavailable error={loaded.error} />;
  if (!shift || !setup) return null;

  const totals = shiftTotals(readings);
  const cash = shiftCash(totals.sales, credit ?? 0, handed ?? 0);
  const missing = readings.filter((r) => r.closingMilli === null).length;
  const below = readings.some((r) => r.closingMilli !== null && r.closingMilli < r.openingMilli);
  const body = () => ({
    readings: readings.filter((r) => !r.bad).map((r) => ({ nozzleId: r.nozzleId, closingMilli: r.closingMilli })),
    credit: credit ?? 0,
    handed
  });

  async function act(fn: () => Promise<unknown>, message: Key) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(t(message));
      loaded.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <a className="btn" href={href('petrol')}>{t('back')}</a>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
        {editable && (
          <>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void (async () => {
              setBusy(true);
              try { await fuelApi.cancel(shift.id); toast(t('ps_deleted')); go('petrol'); } catch (e) { setError(e); setBusy(false); }
            })()}>{t('ps_delete')}</button>
            <button type="button" className="btn" disabled={busy || below} onClick={() => void act(() => fuelApi.save(shift.id, body()), 'saved')}>{t('ps_save')}</button>
            <button type="button" className="btn primary" disabled={busy || below || missing > 0 || handed === null}
              onClick={() => void act(() => fuelApi.close(shift.id, { ...body(), handed: handed ?? 0, lang: i18n.lang }), 'ps_posted')}>
              <Icon name="check" size={16} />{t('ps_close')}
            </button>
          </>
        )}
      </div>
      <div className="card pad stack">
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{t('ps_sheetTitle', { n: shift.number })}</h2>
          <ShiftChip s={shift} />
          {shift.entry && <span className="muted">{t('ps_entry')} <a className="num ltr" href={href(`entry/${shift.entry.id}`)}>{shift.entry.number ?? t('ps_entryWaiting')}</a></span>}
        </div>
        <div className="row muted" style={{ flexWrap: 'wrap', gap: '6px 18px' }}>
          <span>{t('date')}: <span className="num">{i18n.date(shift.date)}</span></span>
          <span>{t('ps_shift')}: {t(`ps_shift_${shift.shift}`)}</span>
          <span>{t('ps_attendant')}: <strong>{shift.attendant}</strong></span>
          <span>{t('ps_pumps')}: <span className="num">{i18n.digitsOf(shift.pumps.join(i18n.lang === 'en' ? ', ' : '، '))}</span></span>
        </div>
        {editable && <p className="muted small" style={{ margin: 0 }}>{t('ps_sheetHelp')}</p>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('ps_pumpNozzle')}</th><th>{t('ps_fuel')}</th><th className="amount">{t('ps_price')}</th>
                <th className="amount">{t('ps_opening')}</th><th className="amount">{t('ps_closing')}</th><th className="amount">{t('ps_litres')}</th><th className="amount">{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r, i) => {
                const line = totals.lines[i]!;
                const wrong = r.bad || (r.closingMilli !== null && r.closingMilli < r.openingMilli);
                return (
                  <tr key={r.nozzleId}>
                    <td>{t('ps_pump', { n: r.pumpNumber })} · {t('ps_nozzle', { n: r.nozzleNumber })}</td>
                    <td>{fuelName(i18n, setup.types, r.fuelTypeId)}</td>
                    <td className="amount num">{i18n.money(r.price, 'IQD')}</td>
                    <td className="amount num ltr">{i18n.digitsOf(meterText(r.openingMilli))}</td>
                    <td className="amount">
                      {editable ? (
                        <>
                          <input className={'input amount ltr' + (wrong ? ' invalid' : '')} inputMode="decimal" style={{ maxInlineSize: 160 }}
                            aria-label={`${t('ps_closing')} — ${t('ps_pump', { n: r.pumpNumber })} · ${t('ps_nozzle', { n: r.nozzleNumber })}`}
                            aria-invalid={wrong} value={r.text} onChange={(e) => setClosing((c) => ({ ...c, [r.nozzleId]: e.target.value }))} />
                          {wrong && <div className="small" style={{ color: 'var(--bad)' }}>{t(r.bad ? 'ps_notNumber' : 'ps_belowOpening')}</div>}
                        </>
                      ) : (
                        <span className="num ltr">{r.closingMilli === null ? '—' : i18n.digitsOf(meterText(r.closingMilli))}</span>
                      )}
                    </td>
                    <td className="amount num">{line.milli ? i18n.qty(line.milli) : '—'}</td>
                    <td className="amount num">{line.amount ? i18n.money(line.amount, 'IQD') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2">
        <div className="card pad stack">
          <h3 style={{ margin: 0 }}>{t('ps_byFuel')}</h3>
          <div className="totals">
            {totals.byFuel.map((f) => (
              <FuelTotalRow key={`${f.fuelTypeId}@${f.price}`} name={fuelName(i18n, setup.types, f.fuelTypeId)} milli={f.milli} amount={f.amount} />
            ))}
            <strong>{t('total')} · {t('ps_litresN', { n: i18n.qty(totals.milli) })}</strong><strong>{i18n.money(totals.sales, 'IQD')}</strong>
          </div>
          {editable && missing > 0 && <div className="alert info small" role="status">{t('ps_missingN', { n: i18n.int(missing) })}</div>}
        </div>
        <div className="card pad stack">
          <h3 style={{ margin: 0 }}>{t('ps_cash')}</h3>
          <div className="pos-r-row"><span>{t('ps_sales')}</span><span className="num">{i18n.money(cash.sales, 'IQD')}</span></div>
          {editable ? (
            <label className="field"><span>{t('ps_credit')}</span><AmountInput value={credit} currency="IQD" onChange={setCredit} ariaLabel={t('ps_credit')} /></label>
          ) : (
            cash.credit > 0 && <div className="pos-r-row"><span>{t('ps_credit')}</span><span className="num">−{i18n.money(cash.credit, 'IQD')}</span></div>
          )}
          <div className="pos-r-row"><span>{t('ps_expected')}</span><strong className="num">{i18n.money(cash.expected, 'IQD')}</strong></div>
          {editable ? (
            <label className="field"><span>{t('ps_handed')}</span><AmountInput value={handed} currency="IQD" onChange={setHanded} ariaLabel={t('ps_handed')} /></label>
          ) : (
            <div className="pos-r-row"><span>{t('ps_handed')}</span><strong className="num">{shift.handed === null ? '—' : i18n.money(shift.handed, 'IQD')}</strong></div>
          )}
          {(editable ? handed !== null : shift.handed !== null) ? (
            <div className="pos-r-row"><span>{t('ps_difference')}</span><strong className="num"><DiffText d={editable ? cash.difference : shift.difference ?? cash.difference} /></strong></div>
          ) : null}
        </div>
      </div>
      <ErrorBox error={error} />
      {editable && <p className="muted small" style={{ margin: 0 }}>{t('ps_postingHelp')}</p>}
    </div>
  );
}

function FuelTotalRow({ name, milli, amount }: { name: string; milli: number; amount: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <>
      <span>{name} · {t('ps_litresN', { n: i18n.qty(milli) })}</span><span>{i18n.money(amount, 'IQD')}</span>
    </>
  );
}

/* ---------- pumps, nozzles and prices ---------- */

function Setup({ setup, onChange }: { setup: FuelSetupView; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const admin = useMay()('fuelSetup') && setup.available;
  const { accounts: chart } = useData();
  const accountText = (code: string) => { const a = chart.find((x) => x.code === code); return a ? `${code} · ${i18n.name(a.name)}` : code; };
  const [prices, setPrices] = useState<Record<string, number | null>>(() => Object.fromEntries(setup.types.map((f) => [f.id, f.price])));
  const [accounts, setAccounts] = useState<FuelSettings>(setup.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const changed = setup.types.filter((f) => prices[f.id] !== f.price);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(t('saved'));
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const accountField = (k: keyof FuelSettings, label: Key, filter: (code: string) => boolean) => (
    <label className="field"><span>{t(label)}</span>
      {admin
        ? <AccountCombo value={accounts[k]} onChange={(code) => setAccounts((a) => ({ ...a, [k]: code }))} filter={(a) => filter(a.code)} ariaLabel={t(label)} />
        : <span>{accountText(accounts[k])}</span>}
    </label>
  );

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <div className="card pad stack">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{t('ps_fuels')}</h3>
          <span className="spacer" />
          {admin && <button type="button" className="btn primary" disabled={busy || !changed.length || changed.some((f) => !prices[f.id])}
            onClick={() => void act(async () => { for (const f of changed) await fuelApi.updateType(f.id, { code: f.code, name: f.name, price: prices[f.id]!, revenueAccount: f.revenueAccount }); })}>
            <Icon name="check" size={16} />{t('ps_savePrices')}
          </button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('code')}</th><th>{t('ps_fuel')}</th><th className="amount">{t('ps_price')}</th><th>{t('ps_revenueAccount')}</th></tr></thead>
            <tbody>
              {setup.types.map((f) => (
                <tr key={f.id}>
                  <td className="num ltr">{f.code}</td>
                  <td>{i18n.name(f.name)}</td>
                  <td className="amount" style={{ inlineSize: 200 }}>
                    {admin ? <AmountInput value={prices[f.id] ?? null} currency="IQD" onChange={(v) => setPrices((p) => ({ ...p, [f.id]: v }))} ariaLabel={`${t('ps_price')} — ${i18n.name(f.name)}`} />
                      : <span className="num">{i18n.money(f.price, 'IQD')}</span>}
                  </td>
                  <td>{accountText(f.revenueAccount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_pricesHelp')}</p>
      </div>
      <div className="card pad stack">
        <h3 style={{ margin: 0 }}>{t('ps_pumpsTitle')}</h3>
        <div className="grid-4">
          {setup.pumps.map((p) => (
            <div key={p.id} className="card pad stack" style={{ gap: 10 }}>
              <div className="row" style={{ alignItems: 'center' }}>
                <Icon name="fuel" size={20} />
                <strong>{t('ps_pump', { n: p.number })}</strong>
              </div>
              {p.nozzles.map((n) => (
                <div key={n.id} className="stack" style={{ gap: 2, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span>{t('ps_nozzle', { n: n.number })} · {fuelName(i18n, setup.types, n.fuelTypeId)}</span>
                    <span className={'chip ' + (n.openShift ? 'warn' : '')}>{n.openShift ? t('ps_inShift', { n: n.openShift }) : t('ps_free')}</span>
                  </div>
                  <div className="small muted">{t('ps_lastReading')}: <span className="num ltr">{i18n.digitsOf(meterText(n.meterMilli))}</span></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="card pad stack">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{t('ps_accounts')}</h3>
          <span className="spacer" />
          {admin && <button type="button" className="btn" disabled={busy || JSON.stringify(accounts) === JSON.stringify(setup.settings)}
            onClick={() => void act(() => fuelApi.updateSettings(accounts))}>{t('ps_saveAccounts')}</button>}
        </div>
        <div className="grid-4">
          {accountField('cashAccount', 'ps_cashAccount', (c) => c.startsWith('18'))}
          {accountField('shortAccount', 'ps_shortAccount', (c) => c.startsWith('16') || c.startsWith('3'))}
          {accountField('overAccount', 'ps_overAccount', (c) => c.startsWith('4'))}
          {accountField('creditAccount', 'ps_creditAccount', (c) => c.startsWith('16'))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_postingHelp')}</p>
      </div>
    </div>
  );
}
