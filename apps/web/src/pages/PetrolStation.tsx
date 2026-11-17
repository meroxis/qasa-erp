import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_METER_MAX_MILLI, dipLitres, FUEL_SHIFTS, meterText, parseDipCm, parseMeter, readingProblem, shiftCash, shiftTotals, todayIso,
  type ChartRow, type FuelShift, type Names
} from '@qasa/core';
import { api, ApiError } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useMay, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import {
  fuelApi, type DeliveryView, type DipView, type FuelSettings, type FuelSetupView, type FuelTypeView, type NozzleView, type PumpView, type ShiftSummary, type ShiftView, type TankView
} from '../industry/fuel-api.ts';
import { printDocument } from '../industry/printing.ts';
// the till's rows of expected and counted cash (.pos-r-row), shared by the shift's cash
import '../pos.css';

/**
 * محطات الوقود (Pro): the shifts with each attendant's short and over, the shift sheet (closing meter readings →
 * litres × price → expected cash against the cash handed in), the tanks with their book stock, tanker deliveries, dips,
 * the reports, and the setup (fuels and prices, tanks, pumps and nozzles, the posting accounts). Cost, average cost and
 * profit come from the server only to someone who may see cost; the page shows them when they are there.
 */

export type PetrolTab = 'shifts' | 'tanks' | 'deliveries' | 'dips' | 'reports' | 'setup';
export const PETROL_TABS: readonly PetrolTab[] = ['shifts', 'tanks', 'deliveries', 'dips', 'reports', 'setup'];
const TAB_LABEL: Record<PetrolTab, Key> = {
  shifts: 'ps_tabShifts', tanks: 'ps_tabTanks', deliveries: 'ps_tabDeliveries', dips: 'ps_tabDips', reports: 'ps_tabReports', setup: 'ps_tabSetup'
};
const NAV = { key: 'ps_title' as Key, group: 'gIndustry' as Key };
const thisMonth = () => todayIso().slice(0, 7);
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

function Unavailable({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) return <div className="alert info">{t('ps_needsPro')}</div>;
  return <ErrorBox error={error} />;
}

const fuelName = (i18n: I18n, types: readonly FuelTypeView[], id: string) => {
  const f = types.find((x) => x.id === id);
  return f ? i18n.name(f.name) : '';
};
const tankName = (tanks: readonly TankView[], id: string) => {
  const tk = tanks.find((x) => x.id === id);
  return tk ? `${tk.code} · ${tk.name}` : '';
};
const litres = (i18n: I18n, milli: number) => i18n.t('ps_litresN', { n: i18n.qty(milli) });
const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part * 100) / whole))) : 0);

/** A shift's difference as the till shows a drawer's: red when short or over, green when exact, with the word. */
export function DiffText({ d }: { d: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const text = d === 0 ? t('ps_exact') : t(d < 0 ? 'ps_shortBy' : 'ps_overBy', { a: i18n.money(Math.abs(d), 'IQD') });
  return <span style={{ color: d === 0 ? 'var(--ok)' : 'var(--bad)' }}>{text}</span>;
}

function StatusChip({ status }: { status: ShiftSummary['status'] | DeliveryView['status'] }) {
  const { t } = useI18n();
  const [cls, key]: [string, Key] = status === 'open' ? ['warn', 'ps_open'] : status === 'closed' ? ['ok', 'ps_closed'] : status === 'posted' ? ['ok', 'ps_posted'] : ['', 'ps_reversed'];
  return <span className={'chip ' + cls}>{t(key)}</span>;
}

function EntryLink({ entry }: { entry: { id: string; number: string | null } | null }) {
  const { t } = useI18n();
  if (!entry) return <>—</>;
  return <a className="num ltr" href={href(`entry/${entry.id}`)} onClick={(e) => e.stopPropagation()}>{entry.number ?? t('ps_entryWaiting')}</a>;
}

/** A form's busy state, its error and a run that toasts and reloads on success. */
function useAction(onDone: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>, message: Key = 'saved') => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(t(message));
      onDone();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

/** The reason asked before any reversal (an admin's), with what the reversal does. */
function ReverseModal({ title, help, onReverse, onClose }: { title: string; help: Key[]; onReverse(reason: string): Promise<unknown>; onClose(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onClose);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {help.map((k) => <p key={k} className="muted small" style={{ margin: 0 }}>{t(k)}</p>)}
        <Field label={t('ps_reason')}><input className="input" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" disabled={busy || reason.trim().length < 3} onClick={() => void run(() => onReverse(reason.trim()), 'ps_reversedToast')}>{t('ps_reverse')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- the page ---------- */

export function PetrolStation({ tab = 'shifts' }: { tab?: PetrolTab }) {
  const { t } = useI18n();
  usePageNav(NAV);
  const setup = useLoad(() => fuelApi.setup(), []);
  if (setup.error) return <Unavailable error={setup.error} />;
  const s = setup.data;
  return (
    <div className="stack">
      {s && !s.available && <div className="alert">{t('ps_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <div className="track" role="tablist">
          {PETROL_TABS.map((k) => (
            <a key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="btn" style={{ border: 'none' }}
              href={href(k === 'shifts' ? 'petrol' : `petrol/${k}`)}>{t(TAB_LABEL[k])}</a>
          ))}
        </div>
      </div>
      {s && tab === 'shifts' && <Shifts setup={s} />}
      {s && tab === 'tanks' && <Tanks setup={s} onChange={setup.reload} />}
      {s && tab === 'deliveries' && <Deliveries setup={s} onChange={setup.reload} />}
      {s && tab === 'dips' && <Dips setup={s} onChange={setup.reload} />}
      {s && tab === 'reports' && <Reports setup={s} />}
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
  const people = useLoad(() => fuelApi.attendants(`${month}-01`, monthEnd(month)), [month]);
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
    { label: t('ps_tileLitres'), value: litres(i18n, litresToday.data ?? 0), sub: '' },
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
                    <td><EntryLink entry={x.entry} /></td>
                    <td><StatusChip status={x.status} /></td>
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

function OpenShiftModal({ setup, attendants, initial, onClose }: {
  setup: FuelSetupView; attendants: string[]; initial?: { date: string; shift: FuelShift; attendant: string; pumpIds: string[] }; onClose(): void;
}) {
  const { t } = useI18n();
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [shift, setShift] = useState<FuelShift>(initial?.shift ?? 'morning');
  const [attendant, setAttendant] = useState(initial?.attendant ?? '');
  const free = setup.pumps.filter((p) => p.active && p.nozzles.every((n) => !n.openShift));
  const [pumps, setPumps] = useState<string[]>(initial ? initial.pumpIds.filter((id) => free.some((p) => p.id === id)) : free.map((p) => p.id));
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
          <Field label={t('date')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <label className="field"><span>{t('ps_attendant')}</span>
            <input className="input" value={attendant} maxLength={100} onChange={(e) => setAttendant(e.target.value)} list="ps-attendants" autoFocus />
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
  const { seesCost } = useData();
  const loaded = useLoad(() => Promise.all([fuelApi.shift(id), fuelApi.setup()]), [id]);
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [rollover, setRollover] = useState<Record<string, boolean>>({});
  const [credit, setCredit] = useState<number | null>(null);
  const [handed, setHanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reversing, setReversing] = useState(false);
  const [again, setAgain] = useState(false);
  const shift: ShiftView | null = loaded.data?.[0] ?? null;
  const setup = loaded.data?.[1] ?? null;

  useEffect(() => {
    if (!shift) return;
    setClosing(Object.fromEntries(shift.readings.map((r) => [r.nozzleId, r.closingMilli === null ? '' : meterText(r.closingMilli)])));
    setRollover(Object.fromEntries(shift.readings.map((r) => [r.nozzleId, r.rollover])));
    setCredit(shift.credit || null);
    setHanded(shift.handed);
  }, [shift]);

  const editable = !!shift && shift.actions.includes('close') && mayDo('fuelShift');
  // the sheet as it stands on the screen: the readings typed, the litres and money they make
  const readings = useMemo(() => (shift ? shift.readings.map((r) => {
    const text = closing[r.nozzleId] ?? '';
    const parsed = editable ? (text.trim() ? parseMeter(text) : null) : r.closingMilli;
    const row = { ...r, closingMilli: parsed, rollover: editable ? !!rollover[r.nozzleId] : r.rollover };
    const problem = parsed === null ? null : readingProblem(row);
    return { ...row, text, bad: editable && text.trim() !== '' && parsed === null, problem: problem === 'closing_missing' ? null : problem };
  }) : []), [shift, closing, rollover, editable]);
  if (loaded.error) return <Unavailable error={loaded.error} />;
  if (!shift || !setup) return null;

  const totals = shiftTotals(readings);
  const cash = shiftCash(totals.sales, credit ?? 0, handed ?? 0);
  const missing = readings.filter((r) => r.closingMilli === null).length;
  const wrong = readings.some((r) => r.bad || r.problem);
  const body = () => ({
    readings: readings.filter((r) => !r.bad).map((r) => ({ nozzleId: r.nozzleId, closingMilli: r.closingMilli, ...(r.rollover && r.closingMilli !== null ? { rollover: true } : {}) })),
    credit: credit ?? 0,
    handed
  });
  const problemText = (p: string | null, bad: boolean, label: string) => (bad ? t('ps_notNumber') : p === 'closing_below_opening' ? t('ps_belowOpening') : p ? t(`err_fuel_${p}` as Key, { n: label }) : '');

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
            <button type="button" className="btn" disabled={busy || wrong} onClick={() => void act(() => fuelApi.save(shift.id, body()), 'saved')}>{t('ps_save')}</button>
            <button type="button" className="btn primary" disabled={busy || wrong || missing > 0 || handed === null}
              onClick={() => void act(() => fuelApi.close(shift.id, { ...body(), handed: handed ?? 0, lang: i18n.lang }), 'ps_postedToast')}>
              <Icon name="check" size={16} />{t('ps_close')}
            </button>
          </>
        )}
        {shift.actions.includes('reverse') && mayDo('fuelReverse') && (
          <button type="button" className="btn danger" onClick={() => setReversing(true)}>{t('ps_reverseShift')}</button>
        )}
        {shift.status === 'reversed' && mayDo('fuelShift') && setup.available && (
          <button type="button" className="btn primary" onClick={() => setAgain(true)}>{t('ps_openAgain')}</button>
        )}
      </div>
      <div className="card pad stack">
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{t('ps_sheetTitle', { n: shift.number })}</h2>
          <StatusChip status={shift.status} />
          {shift.entry && <span className="muted">{t('ps_entry')} <EntryLink entry={shift.entry} /></span>}
          {shift.reversal && <span className="muted">{t('ps_reversal')} <EntryLink entry={shift.reversal} /></span>}
        </div>
        <div className="row muted" style={{ flexWrap: 'wrap', gap: '6px 18px' }}>
          <span>{t('date')}: <span className="num">{i18n.date(shift.date)}</span></span>
          <span>{t('ps_shift')}: {t(`ps_shift_${shift.shift}`)}</span>
          <span>{t('ps_attendant')}: <strong>{shift.attendant}</strong></span>
          <span>{t('ps_pumps')}: <span className="num">{i18n.digitsOf(shift.pumps.join(i18n.lang === 'en' ? ', ' : '، '))}</span></span>
        </div>
        {shift.status === 'reversed' && <div className="alert info small">{t('ps_reversedBy', { u: shift.reversedBy ?? '', r: shift.reverseReason ?? '' })}</div>}
        {editable && <p className="muted small" style={{ margin: 0 }}>{t('ps_sheetHelp')}</p>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('ps_pumpNozzle')}</th><th>{t('ps_fuel')}</th><th>{t('ps_tank')}</th><th className="amount">{t('ps_price')}</th>
                <th className="amount">{t('ps_opening')}</th><th className="amount">{t('ps_closing')}</th><th className="amount">{t('ps_litres')}</th><th className="amount">{t('amount')}</th>
                {seesCost && !editable && <th className="amount">{t('ps_cost')}</th>}
              </tr>
            </thead>
            <tbody>
              {readings.map((r, i) => {
                const line = totals.lines[i]!;
                const bad = r.bad || !!r.problem;
                const label = `${t('ps_pump', { n: r.pumpNumber })} · ${t('ps_nozzle', { n: r.nozzleNumber })}`;
                return (
                  <tr key={r.nozzleId}>
                    <td>{label}</td>
                    <td>{fuelName(i18n, setup.types, r.fuelTypeId)}</td>
                    <td className="small">{tankName(setup.tanks, r.tankId)}</td>
                    <td className="amount num">{i18n.money(r.price, 'IQD')}</td>
                    <td className="amount num ltr">{i18n.digitsOf(meterText(r.openingMilli))}</td>
                    <td className="amount">
                      {editable ? (
                        <>
                          <input className={'input amount ltr' + (bad ? ' invalid' : '')} inputMode="decimal" style={{ maxInlineSize: 160 }}
                            aria-label={`${t('ps_closing')} — ${label}`} aria-invalid={bad} value={r.text}
                            onChange={(e) => setClosing((c) => ({ ...c, [r.nozzleId]: e.target.value }))} />
                          {(r.rollover || (r.closingMilli !== null && r.closingMilli < r.openingMilli)) && (
                            <label className="row small" style={{ gap: 6, justifyContent: 'flex-end' }} title={t('ps_rolloverHelp')}>
                              <input type="checkbox" checked={r.rollover} onChange={(e) => setRollover((x) => ({ ...x, [r.nozzleId]: e.target.checked }))} />
                              {t('ps_rollover')}
                            </label>
                          )}
                          {bad && <div className="small" style={{ color: 'var(--bad)' }}>{problemText(r.problem, r.bad, `${r.pumpNumber}/${r.nozzleNumber}`)}</div>}
                        </>
                      ) : (
                        <span className="num ltr">{r.closingMilli === null ? '—' : i18n.digitsOf(meterText(r.closingMilli))}{r.rollover ? ' ↻' : ''}</span>
                      )}
                    </td>
                    <td className="amount num">{line.milli ? i18n.qty(line.milli) : '—'}</td>
                    <td className="amount num">{line.amount ? i18n.money(line.amount, 'IQD') : '—'}</td>
                    {seesCost && !editable && <td className="amount num">{r.cost === undefined || r.cost === null ? '—' : i18n.money(r.cost, 'IQD')}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && readings.some((r) => r.closingMilli !== null && r.closingMilli < r.openingMilli) && <p className="muted small pad" style={{ margin: 0 }}>{t('ps_rolloverHelp')}</p>}
      </div>
      <div className="grid-2">
        <div className="card pad stack">
          <h3 style={{ margin: 0 }}>{t('ps_byFuel')}</h3>
          <div className="totals">
            {totals.byFuel.map((f) => (
              <FuelTotalRow key={`${f.fuelTypeId}@${f.price}`} name={fuelName(i18n, setup.types, f.fuelTypeId)} milli={f.milli} amount={f.amount} />
            ))}
            <strong>{t('total')} · {litres(i18n, totals.milli)}</strong><strong>{i18n.money(totals.sales, 'IQD')}</strong>
            {typeof shift.cost === 'number' && <><span>{t('ps_cost')}</span><span>{i18n.money(shift.cost, 'IQD')}</span></>}
            {typeof shift.profit === 'number' && <><strong>{t('ps_profit')}</strong><strong>{i18n.money(shift.profit, 'IQD')}</strong></>}
          </div>
          {editable && missing > 0 && <div className="alert info small" role="status">{t('ps_missingN', { n: i18n.int(missing) })}</div>}
        </div>
        <div className="card pad stack">
          <h3 style={{ margin: 0 }}>{t('ps_cash')}</h3>
          <div className="pos-r-row"><span>{t('ps_sales')}</span><span className="num">{i18n.money(cash.sales, 'IQD')}</span></div>
          {editable ? (
            <Field label={t('ps_credit')}><AmountInput value={credit} currency="IQD" onChange={setCredit} ariaLabel={t('ps_credit')} /></Field>
          ) : (
            cash.credit > 0 && <div className="pos-r-row"><span>{t('ps_credit')}</span><span className="num">−{i18n.money(cash.credit, 'IQD')}</span></div>
          )}
          <div className="pos-r-row"><span>{t('ps_expected')}</span><strong className="num">{i18n.money(cash.expected, 'IQD')}</strong></div>
          {editable ? (
            <Field label={t('ps_handed')}><AmountInput value={handed} currency="IQD" onChange={setHanded} ariaLabel={t('ps_handed')} /></Field>
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
      {reversing && (
        <ReverseModal title={t('ps_reverseTitle', { n: shift.number })} help={['ps_reverseHelp', 'ps_reverseShiftHelp']}
          onReverse={(reason) => fuelApi.reverseShift(shift.id, reason)} onClose={() => { setReversing(false); loaded.reload(); }} />
      )}
      {again && (
        <OpenShiftModal setup={setup} attendants={[shift.attendant]} onClose={() => setAgain(false)}
          initial={{ date: shift.date, shift: shift.shift, attendant: shift.attendant, pumpIds: setup.pumps.filter((p) => shift.pumps.includes(p.number)).map((p) => p.id) }} />
      )}
    </div>
  );
}

function FuelTotalRow({ name, milli, amount }: { name: string; milli: number; amount: number }) {
  const i18n = useI18n();
  return (
    <>
      <span>{name} · {litres(i18n, milli)}</span><span>{i18n.money(amount, 'IQD')}</span>
    </>
  );
}

/* ---------- tanks ---------- */

function TankCard({ tank, setup }: { tank: TankView; setup: FuelSetupView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const full = pct(tank.bookMilli, tank.capacityMilli);
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Icon name="fuel" size={20} />
        <strong>{tank.code} · {tank.name}</strong>
        <span className="spacer" />
        {!tank.active && <span className="chip">{t('inactive')}</span>}
        {tank.inOpenShift && <span className="chip warn">{t('ps_inUse')}</span>}
      </div>
      <div className="muted small">{fuelName(i18n, setup.types, tank.fuelTypeId)}</div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <span className="fs-meter" style={{ maxInlineSize: 'none' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={full} aria-label={t('ps_fullPct', { p: full })}>
          <span style={{ inlineSize: `${full}%` }} />
        </span>
        <span className="num small">{t('ps_fullPct', { p: full })}</span>
      </div>
      <div className="totals small">
        <span>{t('ps_book')}</span><strong className="num">{litres(i18n, tank.bookMilli)}</strong>
        <span>{t('ps_capacity')}</span><span className="num">{litres(i18n, tank.capacityMilli)}</span>
        <span>{t('ps_lastDip')}</span>
        <span className="num">{tank.lastDip ? `${litres(i18n, tank.lastDip.measuredMilli)} · ${i18n.date(tank.lastDip.date)}` : t('ps_noDip')}</span>
        {typeof tank.avgCost === 'number' && <><span>{t('ps_avgCost')}</span><span className="num">{i18n.money(tank.avgCost, 'IQD')}</span></>}
        {typeof tank.value === 'number' && <><span>{t('ps_stockValue')}</span><span className="num">{i18n.money(tank.value, 'IQD')}</span></>}
      </div>
    </div>
  );
}

function Tanks({ setup, onChange }: { setup: FuelSetupView; onChange(): void }) {
  const { t } = useI18n();
  const mayDo = useMay();
  const [delivering, setDelivering] = useState(false);
  const [dipping, setDipping] = useState(false);
  return (
    <div className="stack">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        {setup.available && mayDo('fuelDelivery') && <button type="button" className="btn primary" onClick={() => setDelivering(true)}><Icon name="plus" size={16} />{t('ps_newDelivery')}</button>}
        {setup.available && mayDo('fuelDip') && <button type="button" className="btn" onClick={() => setDipping(true)}>{t('ps_newDip')}</button>}
      </div>
      {!setup.tanks.length && <div className="card pad muted">{t('ps_noTanks')}</div>}
      <div className="grid-3">
        {setup.tanks.map((tank) => <TankCard key={tank.id} tank={tank} setup={setup} />)}
      </div>
      {delivering && <DeliveryModal setup={setup} onClose={() => setDelivering(false)} onDone={onChange} />}
      {dipping && <DipModal setup={setup} onClose={() => setDipping(false)} onDone={onChange} />}
    </div>
  );
}

/* ---------- deliveries ---------- */

function DeliveryModal({ setup, onClose, onDone }: { setup: FuelSetupView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const mayDo = useMay();
  const suppliers = useLoad(() => api.parties({ type: 'supplier', active: '1' }), []);
  const tanks = setup.tanks.filter((x) => x.active);
  const [date, setDate] = useState(todayIso());
  const [tankId, setTankId] = useState(tanks[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [noteNo, setNoteNo] = useState('');
  const [qty, setQty] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [payment, setPayment] = useState<'cash' | 'credit'>('credit');
  const [cashAccount, setCashAccount] = useState(setup.settings.cashAccount);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction(() => { onDone(); onClose(); });
  const tank = tanks.find((x) => x.id === tankId);
  const room = tank ? tank.capacityMilli - Math.max(0, tank.bookMilli) : 0;
  const options: PickOption[] = (suppliers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));
  const admin = mayDo('fuelSetup');
  return (
    <Modal title={t('ps_newDelivery')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <Field label={t('date')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t('ps_tank')}>
            <select className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>
              {tanks.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name} — {fuelName(i18n, setup.types, x.fuelTypeId)}</option>)}
            </select>
          </Field>
          <div className="field"><span>{t('supplier')}</span><SearchCombo value={supplierId} options={options} onChange={setSupplierId} placeholder={t('supplier')} /></div>
          <Field label={t('ps_noteNo')}><input className="input ltr" value={noteNo} maxLength={40} onChange={(e) => setNoteNo(e.target.value)} /></Field>
          <Field label={t('ps_litres')}><QtyInput value={qty} onChange={setQty} ariaLabel={t('ps_litres')} /></Field>
          <Field label={t('ps_costPerLitre')}><AmountInput value={price} currency="IQD" onChange={setPrice} ariaLabel={t('ps_costPerLitre')} /></Field>
        </div>
        {tank && <div className="muted small">{t('ps_room', { n: litres(i18n, Math.max(0, room)) })}</div>}
        {qty !== null && price !== null && <div className="pos-r-row"><span>{t('total')}</span><strong className="num">{i18n.money(Math.round((qty * price) / 1000), 'IQD')}</strong></div>}
        <div className="field">
          <span>{t('ps_payment')}</span>
          <div className="track" role="radiogroup">
            {(['credit', 'cash'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={payment === p} aria-pressed={payment === p} className="btn" style={{ border: 'none' }} onClick={() => setPayment(p)}>
                {t(p === 'cash' ? 'ps_payCash' : 'ps_payCredit')}
              </button>
            ))}
          </div>
        </div>
        {payment === 'cash' && <Field label={t('ps_cashAccount')}><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('ps_cashAccount')} /></Field>}
        {admin && qty !== null && qty > room && (
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />{t('ps_overCapacity')}</label>
        )}
        <Field label={t('notes')}><input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_deliveryPosting')}</p>
        <ErrorBox error={error ?? suppliers.error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !tankId || !supplierId || !noteNo.trim() || !qty || !price}
            onClick={() => void run(() => fuelApi.deliver({
              date, tankId, supplierId, noteNo: noteNo.trim(), qtyMilli: qty!, costPerLitre: price!, payment, lang: i18n.lang,
              ...(payment === 'cash' ? { cashAccount } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), ...(over ? { overCapacity: true } : {})
            }), 'ps_delivered')}>
            <Icon name="check" size={16} />{t('ps_delivery')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Deliveries({ setup, onChange }: { setup: FuelSetupView; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const mayDo = useMay();
  const { seesCost } = useData();
  const list = useLoad(() => fuelApi.deliveries(), []);
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<DeliveryView | null>(null);
  const reload = () => { list.reload(); onChange(); };
  const rows = list.data ?? [];
  return (
    <div className="stack">
      <div className="row no-print">
        {setup.available && mayDo('fuelDelivery') && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t('ps_newDelivery')}</button>}
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && !rows.length && <div className="pad muted">{t('ps_noDeliveries')}</div>}
        {!!rows.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('code')}</th><th>{t('date')}</th><th>{t('ps_tank')}</th><th>{t('supplier')}</th><th>{t('ps_noteNo')}</th><th className="amount">{t('ps_litres')}</th>
                  {seesCost && <th className="amount">{t('ps_costPerLitre')}</th>}{seesCost && <th className="amount">{t('total')}</th>}
                  <th>{t('ps_payment')}</th><th>{t('ps_entry')}</th><th /><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="num ltr">{d.number}</td>
                    <td className="num">{i18n.date(d.date)}</td>
                    <td>{tankName(setup.tanks, d.tankId)}</td>
                    <td>{d.supplierName}</td>
                    <td className="num ltr">{d.noteNo}</td>
                    <td className="amount num">{i18n.qty(d.qtyMilli)}</td>
                    {seesCost && <td className="amount num">{typeof d.costPerLitre === 'number' ? i18n.money(d.costPerLitre, 'IQD') : '—'}</td>}
                    {seesCost && <td className="amount num">{typeof d.cost === 'number' ? i18n.money(d.cost, 'IQD') : '—'}</td>}
                    <td>{t(d.payment === 'cash' ? 'ps_payCash' : 'ps_payCredit')}</td>
                    <td><EntryLink entry={d.reversal ?? d.entry} /></td>
                    <td><StatusChip status={d.status} />{d.reverseReason && <div className="small muted">{d.reverseReason}</div>}</td>
                    <td className="no-print">{d.actions.includes('reverse') && mayDo('fuelReverse') && <button type="button" className="btn small" onClick={() => setReversing(d)}>{t('ps_reverse')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <DeliveryModal setup={setup} onClose={() => setCreating(false)} onDone={reload} />}
      {reversing && <ReverseModal title={t('ps_reverseTitle', { n: reversing.number })} help={['ps_reverseHelp']} onReverse={(r) => fuelApi.reverseDelivery(reversing.id, r)}
        onClose={() => { setReversing(null); reload(); }} />}
    </div>
  );
}

/* ---------- dips ---------- */

function DipModal({ setup, onClose, onDone }: { setup: FuelSetupView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const tanks = setup.tanks.filter((x) => x.active);
  const [date, setDate] = useState(todayIso());
  const [tankId, setTankId] = useState(tanks.find((x) => !x.inOpenShift)?.id ?? tanks[0]?.id ?? '');
  const tank = tanks.find((x) => x.id === tankId);
  const [byStick, setByStick] = useState(true);
  const stick = byStick && !!tank?.chart;
  const [cm, setCm] = useState('');
  const [measured, setMeasured] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction(() => { onDone(); onClose(); });
  const mm = stick && cm.trim() ? parseDipCm(cm) : null;
  const fromChart = mm !== null && tank?.chart ? dipLitres(tank.chart, mm) : null;
  const value = stick ? fromChart : measured;
  const variance = value !== null && tank ? value - tank.bookMilli : null;
  const tolerance = setup.settings.dipToleranceBp;
  return (
    <Modal title={t('ps_newDip')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <Field label={t('date')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t('ps_tank')}>
            <select className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>
              {tanks.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}{x.inOpenShift ? ` — ${t('ps_inUse')}` : ''}</option>)}
            </select>
          </Field>
        </div>
        {tank?.chart && (
          <div className="track" role="radiogroup">
            {([true, false] as const).map((v) => (
              <button key={String(v)} type="button" role="radio" aria-checked={byStick === v} aria-pressed={byStick === v} className="btn" style={{ border: 'none' }} onClick={() => setByStick(v)}>
                {t(v ? 'ps_byStick' : 'ps_byLitres')}
              </button>
            ))}
          </div>
        )}
        {stick
          ? <Field label={t('ps_dipCm')}><input className={'input amount ltr' + (cm.trim() && (mm === null || fromChart === null) ? ' invalid' : '')} inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)} /></Field>
          : <Field label={t('ps_dipLitres')}><QtyInput value={measured} onChange={setMeasured} ariaLabel={t('ps_dipLitres')} /></Field>}
        {tank && (
          <div className="totals small">
            <span>{t('ps_book')}</span><span className="num">{litres(i18n, tank.bookMilli)}</span>
            <span>{t('ps_measured')}</span><span className="num">{value === null ? '—' : litres(i18n, value)}</span>
            <span>{t('ps_variance')}</span>
            <span className="num">{variance === null ? '—' : <>{i18n.qty(variance, { plus: true })} · {variance === 0 ? '' : t(variance > 0 ? 'ps_gain' : 'ps_loss')}</>}</span>
          </div>
        )}
        {variance !== null && tank && variance !== 0 && (
          <div className="small muted">{Math.abs(variance) * 10_000 <= tolerance * Math.abs(tank.bookMilli) ? t('ps_normal', { p: i18n.digitsOf(String(tolerance / 100)) }) : t('ps_notNormal')}</div>
        )}
        <Field label={t('notes')}><input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_dipPosting')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !tank || value === null}
            onClick={() => void run(() => fuelApi.dip({
              date, tankId, lang: i18n.lang, ...(stick ? { dipMm: mm! } : { measuredMilli: measured! }), ...(notes.trim() ? { notes: notes.trim() } : {})
            }), 'ps_dipped')}>
            <Icon name="check" size={16} />{t('ps_newDip')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Dips({ setup, onChange }: { setup: FuelSetupView; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const mayDo = useMay();
  const { seesCost } = useData();
  const list = useLoad(() => fuelApi.dips(), []);
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<DipView | null>(null);
  const reload = () => { list.reload(); onChange(); };
  const rows = list.data ?? [];
  const tolerance = i18n.digitsOf(String(setup.settings.dipToleranceBp / 100));
  return (
    <div className="stack">
      <div className="row no-print">
        {setup.available && mayDo('fuelDip') && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t('ps_newDip')}</button>}
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && !rows.length && <div className="pad muted">{t('ps_noDips')}</div>}
        {!!rows.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('code')}</th><th>{t('date')}</th><th>{t('ps_tank')}</th><th className="amount">{t('ps_dipCm')}</th><th className="amount">{t('ps_measured')}</th>
                  <th className="amount">{t('ps_book')}</th><th className="amount">{t('ps_variance')}</th>{seesCost && <th className="amount">{t('ps_dipValue')}</th>}<th>{t('ps_entry')}</th><th /><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="num ltr">{d.number}</td>
                    <td className="num">{i18n.date(d.date)}</td>
                    <td>{tankName(setup.tanks, d.tankId)}</td>
                    <td className="amount num">{d.dipMm === null ? '—' : i18n.digitsOf(String(d.dipMm / 10))}</td>
                    <td className="amount num">{i18n.qty(d.measuredMilli)}</td>
                    <td className="amount num">{i18n.qty(d.bookMilli)}</td>
                    <td className="amount num">
                      <span style={{ color: d.varianceMilli === 0 || d.normal ? undefined : 'var(--bad)' }}>{i18n.qty(d.varianceMilli, { plus: true })}</span>
                      {d.varianceMilli !== 0 && <div className="small muted">{d.normal ? t('ps_normal', { p: tolerance }) : t('ps_notNormal')}</div>}
                    </td>
                    {seesCost && <td className="amount num">{typeof d.value === 'number' ? i18n.money(d.value, 'IQD', { plus: true }) : '—'}</td>}
                    <td><EntryLink entry={d.reversal ?? d.entry} /></td>
                    <td><StatusChip status={d.status} />{d.reverseReason && <div className="small muted">{d.reverseReason}</div>}</td>
                    <td className="no-print">{d.actions.includes('reverse') && mayDo('fuelReverse') && <button type="button" className="btn small" onClick={() => setReversing(d)}>{t('ps_reverse')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <DipModal setup={setup} onClose={() => setCreating(false)} onDone={reload} />}
      {reversing && <ReverseModal title={t('ps_reverseTitle', { n: reversing.number })} help={['ps_reverseHelp']} onReverse={(r) => fuelApi.reverseDip(reversing.id, r)}
        onClose={() => { setReversing(null); reload(); }} />}
    </div>
  );
}

/* ---------- reports ---------- */

function Reports({ setup }: { setup: FuelSetupView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { seesCost } = useData();
  const month = thisMonth();
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(monthEnd(month));
  const report = useLoad(() => (from && to && from <= to ? fuelApi.report(from, to) : Promise.resolve(null)), [from, to]);
  const r = report.data;
  const sum = (key: 'milli' | 'sales' | 'cost' | 'profit') => (r?.fuels ?? []).reduce((s, f) => s + (f[key] ?? 0), 0);
  return (
    <div className="stack">
      <div className="row no-print" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <Field label={t('from')}><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('to')}><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={report.error} />
      <div className="card pad stack">
        <h3 style={{ margin: 0 }}>{t('ps_reportFuels')} <span className="muted small num">{i18n.date(from)} — {i18n.date(to)}</span></h3>
        {r && !r.fuels.length && <div className="muted">{t('ps_noReport')}</div>}
        {r && !!r.fuels.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('ps_fuel')}</th><th className="amount">{t('ps_litres')}</th><th className="amount">{t('ps_sales')}</th>
                  {seesCost && <th className="amount">{t('ps_cost')}</th>}{seesCost && <th className="amount">{t('ps_profit')}</th>}
                </tr>
              </thead>
              <tbody>
                {r.fuels.map((f) => (
                  <tr key={f.fuelTypeId}>
                    <td>{fuelName(i18n, setup.types, f.fuelTypeId)}</td>
                    <td className="amount num">{i18n.qty(f.milli)}</td>
                    <td className="amount num">{i18n.money(f.sales, 'IQD')}</td>
                    {seesCost && <td className="amount num">{typeof f.cost === 'number' ? i18n.money(f.cost, 'IQD') : '—'}</td>}
                    {seesCost && <td className="amount num">{typeof f.profit === 'number' ? i18n.money(f.profit, 'IQD') : '—'}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t('total')}</th><th className="amount num">{i18n.qty(sum('milli'))}</th><th className="amount num">{i18n.money(sum('sales'), 'IQD')}</th>
                  {seesCost && <th className="amount num">{i18n.money(sum('cost'), 'IQD')}</th>}{seesCost && <th className="amount num">{i18n.money(sum('profit'), 'IQD')}</th>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <div className="card pad stack">
        <h3 style={{ margin: 0 }}>{t('ps_reportTanks')}</h3>
        {r && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('ps_tank')}</th><th className="amount">{t('ps_openingL')}</th><th className="amount">{t('ps_deliveredL')}</th><th className="amount">{t('ps_soldL')}</th>
                  <th className="amount">{t('ps_adjustedL')}</th><th className="amount">{t('ps_closingL')}</th>{seesCost && <th className="amount">{t('ps_stockValue')}</th>}
                </tr>
              </thead>
              <tbody>
                {r.tanks.map((x) => (
                  <tr key={x.tankId}>
                    <td>{tankName(setup.tanks, x.tankId)}</td>
                    <td className="amount num">{i18n.qty(x.openingMilli)}</td>
                    <td className="amount num">{i18n.qty(x.deliveredMilli)}</td>
                    <td className="amount num">{i18n.qty(x.soldMilli)}</td>
                    <td className="amount num">{i18n.qty(x.adjustedMilli, { plus: true })}</td>
                    <td className="amount num"><strong>{i18n.qty(x.closingMilli)}</strong></td>
                    {seesCost && <td className="amount num">{typeof x.value === 'number' ? i18n.money(x.value, 'IQD') : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- setup: fuels and prices, tanks, pumps and nozzles, accounts ---------- */

function FuelModal({ fuel, onClose, onDone }: { fuel: FuelTypeView | null; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(fuel?.code ?? '');
  const [name, setName] = useState<Names>(fuel?.name ?? { ar: '', en: '', ku: '' });
  const [price, setPrice] = useState<number | null>(fuel?.price ?? null);
  const [revenue, setRevenue] = useState(fuel?.revenueAccount ?? '42');
  const [active, setActive] = useState(fuel?.active ?? true);
  const { busy, error, run } = useAction(() => { onDone(); onClose(); });
  const body = { code: code.trim(), name, price: price ?? 0, revenueAccount: revenue };
  return (
    <Modal title={t(fuel ? 'ps_editFuel' : 'ps_newFuel')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <Field label={t('code')}><input className="input ltr" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={t('ps_price')}><AmountInput value={price} currency="IQD" onChange={setPrice} ariaLabel={t('ps_price')} /></Field>
          {(['ar', 'en', 'ku'] as const).map((l) => (
            <Field key={l} label={t(l === 'ar' ? 'ps_nameAr' : l === 'en' ? 'ps_nameEn' : 'ps_nameKu')}>
              <input className="input" dir={l === 'en' ? 'ltr' : 'rtl'} value={name[l]} maxLength={100} onChange={(e) => setName((n) => ({ ...n, [l]: e.target.value }))} />
            </Field>
          ))}
          <Field label={t('ps_revenueAccount')}><AccountCombo value={revenue} onChange={setRevenue} filter={(a) => a.code.startsWith('4')} ariaLabel={t('ps_revenueAccount')} /></Field>
        </div>
        {fuel && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('active')}</label>}
        <p className="muted small" style={{ margin: 0 }}>{t('ps_pricesHelp')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !code.trim() || !name.ar.trim() || !name.en.trim() || !name.ku.trim() || !price}
            onClick={() => void run(() => (fuel ? fuelApi.updateType(fuel.id, { ...body, active }) : fuelApi.createType(body)))}>
            <Icon name="check" size={16} />{t('save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** A chart as text, a row per line: the dip in cm (one decimal), then the litres. */
const chartText = (chart: ChartRow[] | null) => (chart ?? []).map((r) => `${r.mm / 10} ${meterText(r.milli)}`).join('\n');
function parseChart(text: string): { rows: ChartRow[]; badLine: number | null } {
  const rows: ChartRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const [cm, l, extra] = line.split(/[\s;\t]+|,(?=\s)/).filter(Boolean);
    const mm = cm ? parseDipCm(cm) : null;
    const milli = l ? parseMeter(l) : null;
    if (mm === null || milli === null || extra !== undefined) return { rows, badLine: i + 1 };
    rows.push({ mm, milli });
  }
  return { rows, badLine: null };
}

function TankModal({ setup, tank, onClose, onDone }: { setup: FuelSetupView; tank: TankView | null; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const fuels = setup.types.filter((f) => f.active || f.id === tank?.fuelTypeId);
  const [code, setCode] = useState(tank?.code ?? '');
  const [name, setName] = useState(tank?.name ?? '');
  const [fuelTypeId, setFuelTypeId] = useState(tank?.fuelTypeId ?? fuels[0]?.id ?? '');
  const [capacity, setCapacity] = useState<number | null>(tank?.capacityMilli ?? null);
  const [chart, setChart] = useState(chartText(tank?.chart ?? null));
  const [active, setActive] = useState(tank?.active ?? true);
  const [opening, setOpening] = useState<number | null>(null);
  const [openingCost, setOpeningCost] = useState<number | null>(null);
  const { busy, error, run } = useAction(() => { onDone(); onClose(); });
  const parsed = parseChart(chart);
  const body = { code: code.trim(), name: name.trim(), fuelTypeId, capacityMilli: capacity ?? 0, chart: parsed.rows.length ? parsed.rows : null };
  return (
    <Modal title={t(tank ? 'ps_editTank' : 'ps_newTank')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <Field label={t('code')}><input className="input ltr" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={t('name')}><input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('ps_fuel')}>
            <select className="input" value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)}>
              {fuels.map((f) => <option key={f.id} value={f.id}>{i18n.name(f.name)}</option>)}
            </select>
          </Field>
          <Field label={`${t('ps_capacity')} (${t('ps_litres')})`}><QtyInput value={capacity} onChange={setCapacity} ariaLabel={t('ps_capacity')} /></Field>
          {!tank && <Field label={t('ps_openingStock')}><QtyInput value={opening} onChange={setOpening} ariaLabel={t('ps_openingStock')} /></Field>}
          {!tank && <Field label={t('ps_openingCost')}><AmountInput value={openingCost} currency="IQD" onChange={setOpeningCost} ariaLabel={t('ps_openingCost')} /></Field>}
        </div>
        {!tank && <p className="muted small" style={{ margin: 0 }}>{t('ps_openingHelp')}</p>}
        <label className="field"><span>{t('ps_chart')}</span>
          <textarea className={'input ltr' + (parsed.badLine ? ' invalid' : '')} rows={6} value={chart} onChange={(e) => setChart(e.target.value)} aria-invalid={!!parsed.badLine} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>{parsed.badLine ? <span style={{ color: 'var(--bad)' }}>{t('ps_chartBadLine', { n: parsed.badLine })}</span> : t('ps_chartHelp')}</p>
        {tank && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('active')}</label>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !body.code || !body.name || !fuelTypeId || !capacity || !!parsed.badLine || (!!opening && !openingCost)}
            onClick={() => void run(() => (tank
              ? fuelApi.updateTank(tank.id, { ...body, active })
              : fuelApi.createTank({ ...body, lang: i18n.lang, ...(opening ? { openingMilli: opening, openingCost: openingCost ?? 0 } : {}) })))}>
            <Icon name="check" size={16} />{t('save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function NozzleFields({ setup, tankId, setTankId, meter, setMeter, max, setMax }: {
  setup: FuelSetupView; tankId: string; setTankId(v: string): void; meter: string; setMeter(v: string): void; max: string; setMax(v: string): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <>
      <Field label={t('ps_tank')}>
        <select className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>
          {setup.tanks.filter((x) => x.active || x.id === tankId).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name} — {fuelName(i18n, setup.types, x.fuelTypeId)}</option>)}
        </select>
      </Field>
      <Field label={t('ps_lastReading')}><input className={'input amount ltr' + (meter.trim() && parseMeter(meter) === null ? ' invalid' : '')} inputMode="decimal" value={meter} onChange={(e) => setMeter(e.target.value)} /></Field>
      <Field label={t('ps_meterMax')}><input className={'input amount ltr' + (max.trim() && parseMeter(max) === null ? ' invalid' : '')} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
    </>
  );
}

/** A new pump with its first nozzle, a nozzle added to a pump, or a nozzle changed. */
function NozzleModal({ setup, pump, nozzle, onClose, onDone }: { setup: FuelSetupView; pump: PumpView | null; nozzle: NozzleView | null; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const nextPump = Math.max(0, ...setup.pumps.map((p) => p.number)) + 1;
  const [pumpNumber, setPumpNumber] = useState(String(pump?.number ?? nextPump));
  const [number, setNumber] = useState(String(nozzle?.number ?? Math.max(0, ...(pump?.nozzles ?? []).map((n) => n.number)) + 1));
  const [tankId, setTankId] = useState(nozzle?.tankId ?? setup.tanks.find((x) => x.active)?.id ?? '');
  const [meter, setMeter] = useState(meterText(nozzle?.meterMilli ?? 0));
  const [max, setMax] = useState(meterText(nozzle?.meterMaxMilli ?? DEFAULT_METER_MAX_MILLI));
  const [active, setActive] = useState(nozzle?.active ?? true);
  const { busy, error, run } = useAction(() => { onDone(); onClose(); });
  const meterMilli = parseMeter(meter);
  const maxMilli = parseMeter(max);
  const ok = !!tankId && meterMilli !== null && maxMilli !== null && maxMilli > 0 && Number(number) >= 1 && Number(pumpNumber) >= 1;
  const title = t(nozzle ? 'ps_editNozzle' : pump ? 'ps_addNozzle' : 'ps_newPump');
  const save = () => {
    if (nozzle) return fuelApi.updateNozzle(nozzle.id, { tankId, meterMilli: meterMilli!, meterMaxMilli: maxMilli!, active });
    const n = { number: Number(number), tankId, meterMilli: meterMilli!, meterMaxMilli: maxMilli! };
    return pump ? fuelApi.addNozzle(pump.id, n) : fuelApi.createPump({ number: Number(pumpNumber), nozzles: [n] });
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          {!pump && !nozzle && <Field label={t('ps_pumpNumber')}><input className="input amount" inputMode="numeric" value={pumpNumber} onChange={(e) => setPumpNumber(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>}
          {!nozzle && <Field label={t('ps_nozzleNumber')}><input className="input amount" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>}
          <NozzleFields setup={setup} tankId={tankId} setTankId={setTankId} meter={meter} setMeter={setMeter} max={max} setMax={setMax} />
        </div>
        {nozzle && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('active')}</label>}
        <p className="muted small" style={{ margin: 0 }}>{t('ps_meterHelp')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ok} onClick={() => void run(save)}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function PumpModal({ pump, onClose, onDone }: { pump: PumpView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [number, setNumber] = useState(String(pump.number));
  const [active, setActive] = useState(pump.active);
  const { busy, error, run } = useAction(() => { onDone(); onClose(); });
  return (
    <Modal title={t('ps_editPump')} onClose={onClose}>
      <div className="stack">
        <Field label={t('ps_pumpNumber')}><input className="input amount" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('active')}</label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || Number(number) < 1} onClick={() => void run(() => fuelApi.updatePump(pump.id, { number: Number(number), active }))}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

type SetupDialog =
  | { kind: 'fuel'; fuel: FuelTypeView | null }
  | { kind: 'tank'; tank: TankView | null }
  | { kind: 'nozzle'; pump: PumpView | null; nozzle: NozzleView | null }
  | { kind: 'pump'; pump: PumpView };

function Setup({ setup, onChange }: { setup: FuelSetupView; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const admin = useMay()('fuelSetup') && setup.available;
  const { accounts: chart } = useData();
  const accountText = (code: string) => { const a = chart.find((x) => x.code === code); return a ? `${code} · ${i18n.name(a.name)}` : code; };
  const [accounts, setAccounts] = useState<FuelSettings>(setup.settings);
  const [tolerance, setTolerance] = useState(String(setup.settings.dipToleranceBp / 100));
  const [dialog, setDialog] = useState<SetupDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toleranceBp = Math.round(Number(tolerance.replace('٫', '.')) * 100);
  const toleranceOk = Number.isFinite(toleranceBp) && toleranceBp >= 0 && toleranceBp <= 1000;
  const changed = JSON.stringify({ ...accounts, dipToleranceBp: toleranceBp }) !== JSON.stringify(setup.settings);

  async function saveAccounts() {
    setBusy(true);
    setError(null);
    try {
      await fuelApi.updateSettings({ ...accounts, dipToleranceBp: toleranceBp });
      toast(t('saved'));
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const accountField = (k: Exclude<keyof FuelSettings, 'dipToleranceBp'>, label: Key, filter: (code: string) => boolean) => (
    <label className="field" key={k}><span>{t(label)}</span>
      {admin
        ? <AccountCombo value={accounts[k]} onChange={(code) => setAccounts((a) => ({ ...a, [k]: code }))} filter={(a) => filter(a.code)} ariaLabel={t(label)} />
        : <span>{accountText(accounts[k])}</span>}
    </label>
  );
  const head = (title: Key, add?: () => void, addLabel?: Key) => (
    <div className="row" style={{ alignItems: 'baseline' }}>
      <h3 style={{ margin: 0 }}>{t(title)}</h3>
      <span className="spacer" />
      {admin && add && addLabel && <button type="button" className="btn" onClick={add}><Icon name="plus" size={16} />{t(addLabel)}</button>}
    </div>
  );

  return (
    <div className="stack">
      <div className="card pad stack">
        {head('ps_fuels', () => setDialog({ kind: 'fuel', fuel: null }), 'ps_newFuel')}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('code')}</th><th>{t('ps_fuel')}</th><th className="amount">{t('ps_price')}</th><th>{t('ps_revenueAccount')}</th><th /></tr></thead>
            <tbody>
              {setup.types.map((f) => (
                <tr key={f.id} className={admin ? 'click' : undefined} onClick={admin ? () => setDialog({ kind: 'fuel', fuel: f }) : undefined}>
                  <td className="num ltr">{f.code}</td>
                  <td>{i18n.name(f.name)}</td>
                  <td className="amount num">{i18n.money(f.price, 'IQD')}</td>
                  <td>{accountText(f.revenueAccount)}</td>
                  <td>{!f.active && <span className="chip">{t('inactive')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_pricesHelp')}</p>
      </div>
      <div className="card pad stack">
        {head('ps_tanks', setup.types.some((f) => f.active) ? () => setDialog({ kind: 'tank', tank: null }) : undefined, 'ps_newTank')}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('code')}</th><th>{t('name')}</th><th>{t('ps_fuel')}</th><th className="amount">{t('ps_capacity')}</th><th className="amount">{t('ps_book')}</th><th>{t('ps_chart')}</th><th /></tr></thead>
            <tbody>
              {setup.tanks.map((x) => (
                <tr key={x.id} className={admin ? 'click' : undefined} onClick={admin ? () => setDialog({ kind: 'tank', tank: x }) : undefined}>
                  <td className="num ltr">{x.code}</td>
                  <td>{x.name}</td>
                  <td>{fuelName(i18n, setup.types, x.fuelTypeId)}</td>
                  <td className="amount num">{i18n.qty(x.capacityMilli)}</td>
                  <td className="amount num">{i18n.qty(x.bookMilli)}</td>
                  <td className="small">{x.chart ? t('ps_chartRows', { n: x.chart.length }) : t('ps_noChart')}</td>
                  <td>{!x.active && <span className="chip">{t('inactive')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card pad stack">
        {head('ps_pumpsTitle', setup.tanks.some((x) => x.active) ? () => setDialog({ kind: 'nozzle', pump: null, nozzle: null }) : undefined, 'ps_newPump')}
        <div className="grid-4">
          {setup.pumps.map((p) => (
            <div key={p.id} className="card pad stack" style={{ gap: 10, opacity: p.active ? 1 : 0.6 }}>
              <div className="row" style={{ alignItems: 'center' }}>
                <Icon name="fuel" size={20} />
                <strong>{t('ps_pump', { n: p.number })}</strong>
                <span className="spacer" />
                {!p.active && <span className="chip">{t('inactive')}</span>}
                {admin && <button type="button" className="btn small" onClick={() => setDialog({ kind: 'pump', pump: p })}>{t('actEdit')}</button>}
              </div>
              {p.nozzles.map((n) => (
                <div key={n.id} className="stack" style={{ gap: 2, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 8, opacity: n.active ? 1 : 0.6 }}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span>{t('ps_nozzle', { n: n.number })} · {fuelName(i18n, setup.types, n.fuelTypeId)}</span>
                    <span className={'chip ' + (n.openShift ? 'warn' : '')}>{n.openShift ? t('ps_inShift', { n: n.openShift }) : n.active ? t('ps_free') : t('inactive')}</span>
                  </div>
                  <div className="small muted">{t('ps_tank')}: {tankName(setup.tanks, n.tankId)}</div>
                  <div className="small muted">{t('ps_lastReading')}: <span className="num ltr">{i18n.digitsOf(meterText(n.meterMilli))}</span></div>
                  {admin && !n.openShift && <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setDialog({ kind: 'nozzle', pump: p, nozzle: n })}>{t('actEdit')}</button>}
                </div>
              ))}
              {admin && <button type="button" className="btn small" onClick={() => setDialog({ kind: 'nozzle', pump: p, nozzle: null })}><Icon name="plus" size={14} />{t('ps_addNozzle')}</button>}
            </div>
          ))}
        </div>
      </div>
      <div className="card pad stack">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{t('ps_accounts')}</h3>
          <span className="spacer" />
          {admin && <button type="button" className="btn" disabled={busy || !changed || !toleranceOk} onClick={() => void saveAccounts()}>{t('ps_saveAccounts')}</button>}
        </div>
        <ErrorBox error={error} />
        <div className="grid-4">
          {accountField('cashAccount', 'ps_cashAccount', (c) => c.startsWith('18'))}
          {accountField('shortAccount', 'ps_shortAccount', (c) => c.startsWith('16') || c.startsWith('3'))}
          {accountField('overAccount', 'ps_overAccount', (c) => c.startsWith('4'))}
          {accountField('creditAccount', 'ps_creditAccount', (c) => c.startsWith('16'))}
          {accountField('stockAccount', 'ps_stockAccount', (c) => c.startsWith('13'))}
          {accountField('costAccount', 'ps_costAccount', (c) => c.startsWith('3'))}
          {accountField('lossAccount', 'ps_lossAccount', (c) => c.startsWith('3'))}
          {accountField('openingAccount', 'ps_openingAccount', (c) => c.startsWith('21') || c.startsWith('22'))}
          <label className="field"><span>{t('ps_tolerance')}</span>
            {admin
              ? <input className={'input amount' + (toleranceOk ? '' : ' invalid')} inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
              : <span className="num">{i18n.digitsOf(String(setup.settings.dipToleranceBp / 100))}</span>}
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_accountsHelp')}</p>
        <p className="muted small" style={{ margin: 0 }}>{t('ps_postingHelp')}</p>
      </div>
      {dialog?.kind === 'fuel' && <FuelModal fuel={dialog.fuel} onClose={() => setDialog(null)} onDone={onChange} />}
      {dialog?.kind === 'tank' && <TankModal setup={setup} tank={dialog.tank} onClose={() => setDialog(null)} onDone={onChange} />}
      {dialog?.kind === 'nozzle' && <NozzleModal setup={setup} pump={dialog.pump} nozzle={dialog.nozzle} onClose={() => setDialog(null)} onDone={onChange} />}
      {dialog?.kind === 'pump' && <PumpModal pump={dialog.pump} onClose={() => setDialog(null)} onDone={onChange} />}
    </div>
  );
}
