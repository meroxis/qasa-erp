import { useState } from 'react';
import { formatQty } from '@qasa/core';
import { api } from '../api.ts';
import { EmptyState, ErrorBox, Icon, Modal, SearchCombo, downloadCsv, useData, useLoad, useMay, useToast, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { DOSAGE_FORMS, pharmacyApi, type ControlledLine, type DosageForm, type MedicineView, type PharmaDetails } from '../industry/pharmacy-api.ts';
import { printDocument } from '../industry/printing.ts';
import { ExpiryChip } from './Expiry.tsx';
import { unitName } from './Items.tsx';

type Tab = 'medicines' | 'alternatives' | 'near' | 'controlled';

/** The tabs someone sees: the controlled-medicines log (patients and prescriptions) needs the sales permission, as on the server. */
export const pharmacyTabs = (sales: boolean): Tab[] => (sales ? ['medicines', 'alternatives', 'near', 'controlled'] : ['medicines', 'alternatives', 'near']);

/** What a line of the controlled log offers: Record until it is recorded, then Correct for an admin only (the server's rule). */
export const controlledAction = (line: Pick<ControlledLine, 'missing' | 'recordedAt'>, admin: boolean): 'record' | 'correct' | null =>
  line.missing && !line.recordedAt ? 'record' : admin ? 'correct' : null;

/** الصيدلية (Pro): medicines with their pharmacy details, alternatives by generic name, near expiry, and the controlled log. */
export function Pharmacy({ admin = false, sales = false }: { admin?: boolean; sales?: boolean }) {
  const { t } = useI18n();
  const { plan } = useData();
  const allowed = !!plan?.features.includes('pharmacy');
  const [tab, setTab] = useState<Tab>('medicines');
  const tabs = pharmacyTabs(sales);
  const shown = tabs.includes(tab) ? tab : 'medicines';
  return (
    <div className="stack">
      {!allowed && <div className="alert info">{t('phm_needsPro')} <a href={href('plans')}>Pro</a></div>}
      <div className="tabs no-print">
        {tabs.map((x) => (
          <button key={x} type="button" aria-pressed={shown === x} onClick={() => setTab(x)}>
            {t(x === 'medicines' ? 'ph_medicines' : x === 'alternatives' ? 'ph_alternatives' : x === 'near' ? 'ph_nearExpiry' : 'ph_controlledLog')}
          </button>
        ))}
      </div>
      {allowed && shown === 'medicines' && <Medicines />}
      {allowed && shown === 'alternatives' && <Alternatives />}
      {allowed && shown === 'near' && <NearExpiry />}
      {allowed && sales && shown === 'controlled' && <ControlledLog admin={admin} />}
    </div>
  );
}

const formKey = (f: DosageForm) => `ph_form_${f}` as Key;

function MedicineTable({ rows, onEdit }: { rows: MedicineView[]; onEdit?(m: MedicineView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('item')}</th><th>{t('ph_generic')}</th><th>{t('ph_form')}</th><th>{t('ph_strength')}</th><th>{t('ph_shelf')}</th>
          <th className="amount">{t('available')}</th><th>{t('ph_nearestExpiry')}</th><th className="amount">{t('salePrice')}</th>{onEdit && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.itemId}>
            <td>
              <a href={href(`item/${m.itemId}`)}>{i18n.name(m.name)}</a> <span className="muted small ltr">{m.code}</span>
              {m.rxOnly && <span className="chip warn" style={{ marginInlineStart: 6 }}>Rx</span>}
              {m.controlled && <span className="chip bad" style={{ marginInlineStart: 6 }}>{t('ph_controlled')}</span>}
            </td>
            <td>{m.genericName}</td>
            <td>{t(formKey(m.form))}</td>
            <td className="ltr">{m.strength}</td>
            <td className="ltr">{m.shelf}</td>
            <td className="amount">{i18n.qty(m.stockMilli)} <span className="muted small">{unitName(i18n, m.unit)}</span></td>
            <td>{m.nearestExpiry ? <span className="num">{i18n.date(m.nearestExpiry)}</span> : '—'}</td>
            <td className="amount">{i18n.money(m.price, m.currency)}</td>
            {onEdit && <td><button type="button" className="btn icon ghost" aria-label={t('actEdit')} title={t('actEdit')} onClick={() => onEdit(m)}><Icon name="edit" size={16} /></button></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Medicines() {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [form, setForm] = useState<DosageForm | ''>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const can = useMay()('medicine');
  const list = useLoad(() => pharmacyApi.medicines({ ...(q.trim() ? { q: q.trim() } : {}), ...(form ? { form } : {}) }), [q, form]);
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const options: PickOption[] = (items.data ?? []).filter((it) => it.trackStock).map((it) => ({ id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}` }));
  return (
    <div className="stack">
      <div className="row">
        {can && (
          <div style={{ minWidth: 260 }}>
            <SearchCombo value={pick} options={options} onChange={(v) => { if (v) setEditing(v); setPick(''); }} placeholder={t('ph_addMedicine')} ariaLabel={t('ph_addMedicine')} />
          </div>
        )}
        <span className="spacer" />
        <select className="input" style={{ width: 160 }} value={form} onChange={(e) => setForm(e.target.value as DosageForm | '')} aria-label={t('ph_form')}>
          <option value="">{t('all')}</option>
          {DOSAGE_FORMS.map((f) => <option key={f} value={f}>{t(formKey(f))}</option>)}
        </select>
        <input className="input" style={{ width: 220 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && (list.data.items.length ? <MedicineTable rows={list.data.items} {...(can ? { onEdit: (m: MedicineView) => setEditing(m.itemId) } : {})} /> : <EmptyState compact icon="pill" title={t('ph_noDetails')} text="" />)}
      </div>
      {editing && <MedicineForm itemId={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function MedicineForm({ itemId, onClose, onSaved }: { itemId: string; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const current = useLoad(() => pharmacyApi.medicine(itemId), [itemId]);
  const [form, setForm] = useState<PharmaDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  const m = current.data;
  const v = form ?? (m ? { genericName: m.genericName, form: m.form, strength: m.strength, manufacturer: m.manufacturer, rxOnly: m.rxOnly, controlled: m.controlled, shelf: m.shelf } : null);
  async function save() {
    if (!v) return;
    setError(null);
    try {
      await pharmacyApi.save(itemId, v);
      toast(t('saved'));
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal title={m ? `${m.code} — ${i18n.name(m.name)}` : t('phm_title')} onClose={onClose}>
      <ErrorBox error={current.error} />
      {v && (
        <div className="stack">
          <label className="field"><span>{t('ph_generic')}</span><input className="input" maxLength={200} value={v.genericName} onChange={(e) => setForm({ ...v, genericName: e.target.value })} autoFocus /></label>
          <div className="grid-2">
            <label className="field"><span>{t('ph_form')}</span>
              <select className="input" value={v.form} onChange={(e) => setForm({ ...v, form: e.target.value as DosageForm })}>
                {DOSAGE_FORMS.map((f) => <option key={f} value={f}>{t(formKey(f))}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('ph_strength')}</span><input className="input ltr" maxLength={60} placeholder="500 mg" value={v.strength} onChange={(e) => setForm({ ...v, strength: e.target.value })} /></label>
            <label className="field"><span>{t('ph_manufacturer')}</span><input className="input" maxLength={200} value={v.manufacturer} onChange={(e) => setForm({ ...v, manufacturer: e.target.value })} /></label>
            <label className="field"><span>{t('ph_shelf')}</span><input className="input ltr" maxLength={60} value={v.shelf} onChange={(e) => setForm({ ...v, shelf: e.target.value })} /></label>
          </div>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.rxOnly} onChange={(e) => setForm({ ...v, rxOnly: e.target.checked })} />{t('ph_rxOnly')}</label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.controlled} onChange={(e) => setForm({ ...v, controlled: e.target.checked })} />{t('ph_controlled')}</label>
          {m && m.alternatives.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <strong>{t('ph_alternatives')}</strong>
              {m.alternatives.slice(0, 8).map((a) => (
                <div key={a.itemId} className="row small" style={{ gap: 8 }}>
                  <span style={{ flex: 1 }}>{i18n.name(a.name)} <span className="muted ltr">{a.strength}</span></span>
                  <span className="num">{i18n.qty(a.stockMilli)}</span>
                  <span className="num">{i18n.money(a.price, a.currency)}</span>
                </div>
              ))}
            </div>
          )}
          <ErrorBox error={error} />
          <div className="row">
            <button type="button" className="btn primary" onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
            <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Alternatives() {
  const { t } = useI18n();
  const [generic, setGeneric] = useState('');
  const list = useLoad(() => (generic.trim() ? pharmacyApi.alternatives(generic.trim()) : Promise.resolve([])), [generic]);
  return (
    <div className="stack">
      <input className="input" style={{ maxWidth: 360 }} type="search" placeholder={t('ph_searchGeneric')} aria-label={t('ph_searchGeneric')} value={generic} onChange={(e) => setGeneric(e.target.value)} autoFocus />
      <ErrorBox error={list.error} />
      {(list.data?.length ?? 0) > 0 && <div className="card"><MedicineTable rows={list.data!} /></div>}
    </div>
  );
}

function NearExpiry() {
  const i18n = useI18n();
  const { t } = i18n;
  const list = useLoad(() => pharmacyApi.nearExpiry(), []);
  const rows = list.data ?? [];
  // 1.4: the value of the stock is not sent to someone who may not see cost: no such column
  const cost = useData().seesCost !== false && rows.every((r) => r.value !== undefined);
  return (
    <div className="stack">
      <div className="row no-print">
        <span className="spacer" />
        <a className="btn" href={href('expiry')}><Icon name="clock" size={16} />{t('ex_title')}</a>
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && rows.length === 0 && <EmptyState compact icon="clock" title={t('ex_none')} text="" />}
        {rows.length > 0 && (
          <table className="table">
            <thead><tr><th>{t('item')}</th><th>{t('ex_batch')}</th><th>{t('ex_expiry')}</th><th>{t('warehouse')}</th><th className="amount">{t('qty')}</th>{cost && <th className="amount">{t('stockValue')}</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.batchId}|${r.warehouseId}`}>
                  <td>{i18n.name(r.itemName)} <span className="muted small ltr">{r.itemCode}</span></td>
                  <td className="ltr">{r.batch || t('ex_noNumber')}</td>
                  <td><ExpiryChip state={r.state} expiry={r.expiry} i18n={i18n} /></td>
                  <td>{i18n.name(r.warehouseName)}</td>
                  <td className="amount">{i18n.qty(r.qtyMilli)}</td>
                  {cost && <td className="amount">{i18n.money(r.value ?? 0, 'IQD')}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ControlledLog({ admin }: { admin: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [missing, setMissing] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<ControlledLine | null>(null);
  const list = useLoad(() => pharmacyApi.controlled({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(missing ? { missing: '1' as const } : {}) }), [from, to, missing]);
  const rows = list.data ?? [];
  const exportCsv = () => downloadCsv('controlled.csv', [
    [t('date'), t('number'), t('item'), t('qty'), t('ex_batch'), t('ph_patient'), t('ph_prescriber'), t('ph_prescriptionNo')],
    ...rows.map((l) => [l.date, l.invoiceNumber ?? '', i18n.name(l.itemName), formatQty(l.qtyMilli), l.batches.join(' '), l.patient ?? '', l.prescriber ?? '', l.prescriptionNo ?? ''])
  ]);
  return (
    <div className="stack">
      <div className="row no-print">
        <label className="field"><span>{t('from')}</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>{t('to')}</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="row" style={{ gap: 8, alignSelf: 'end' }}><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />{t('ph_onlyMissing')}</label>
        <span className="spacer" />
        <button type="button" className="btn" disabled={!rows.length} onClick={exportCsv}><Icon name="download" size={16} />{t('exportExcel')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && rows.length === 0 && <EmptyState compact icon="pill" title={t('ph_controlledLog')} text="" />}
        {rows.length > 0 && (
          <table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('number')}</th><th>{t('item')}</th><th className="amount">{t('qty')}</th><th>{t('ex_batch')}</th><th>{t('ph_patient')}</th><th>{t('ph_prescriber')}</th><th>{t('ph_prescriptionNo')}</th><th className="no-print" /></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={`${l.invoiceId}|${l.lineNo}`}>
                  <td className="num">{i18n.date(l.date)}</td>
                  <td><a className="ltr num" href={href(`invoice/${l.invoiceId}`)} onClick={(e) => { e.preventDefault(); go(`invoice/${l.invoiceId}`); }}>{l.invoiceNumber}</a></td>
                  <td>{i18n.name(l.itemName)}</td>
                  <td className="amount">{i18n.qty(l.qtyMilli)}</td>
                  <td className="ltr">{l.batches.join(', ')}</td>
                  <td style={l.missing ? { color: 'var(--bad)' } : undefined}>{l.patient ?? t('ph_missing')}</td>
                  <td>{l.prescriber ?? ''}</td>
                  <td className="ltr">{l.prescriptionNo ?? ''}</td>
                  <td className="no-print">
                    {controlledAction(l, admin) && (
                      <button type="button" className="btn small" onClick={() => setEditing(l)}>{t(controlledAction(l, admin) === 'correct' ? 'ph_correct' : 'ph_record')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <ControlledRecord lines={[editing]} correcting={controlledAction(editing, admin) === 'correct'} onDone={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

/** The lines a Record press saves: those with a patient (the others stay missing in the log, for later). */
export const recordableLines = (values: readonly { patient: string }[]): number[] =>
  values.flatMap((v, i) => (v.patient.trim() ? [i] : []));

/** Asks for the patient (required), prescriber and prescription number of each controlled line; the POS opens it after a sale. */
export function ControlledRecord({ lines, correcting = false, onDone }: {
  lines: Pick<ControlledLine, 'invoiceId' | 'lineNo' | 'itemName' | 'patient' | 'prescriber' | 'prescriptionNo'>[]; correcting?: boolean; onDone(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [values, setValues] = useState(() => lines.map((l) => ({ patient: l.patient ?? '', prescriber: l.prescriber ?? '', prescriptionNo: l.prescriptionNo ?? '' })));
  const [error, setError] = useState<unknown>(null);
  const ready = recordableLines(values);
  async function save() {
    setError(null);
    // nothing to save: no "Saved" for nothing (the button is off until a patient is typed)
    if (ready.length === 0) return;
    try {
      for (const i of ready) {
        const v = values[i]!;
        await pharmacyApi.record(lines[i]!.invoiceId, lines[i]!.lineNo, { patient: v.patient, prescriber: v.prescriber, prescriptionNo: v.prescriptionNo });
      }
      toast(t('saved'));
      onDone();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal title={t(correcting ? 'ph_correctTitle' : 'ph_recordTitle')} onClose={onDone}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t(correcting ? 'ph_correctHelp' : 'ph_recordHelp')}</p>
        {lines.map((l, i) => (
          <fieldset key={`${l.invoiceId}|${l.lineNo}`} className="card pad stack" style={{ gap: 6 }}>
            <legend><strong>{i18n.name(l.itemName)}</strong></legend>
            <label className="field"><span>{t('ph_patient')}</span><input className="input" maxLength={200} value={values[i]!.patient} onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, patient: e.target.value } : x)))} /></label>
            <div className="grid-2">
              <label className="field"><span>{t('ph_prescriber')}</span><input className="input" maxLength={200} value={values[i]!.prescriber} onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, prescriber: e.target.value } : x)))} /></label>
              <label className="field"><span>{t('ph_prescriptionNo')}</span><input className="input ltr" maxLength={100} value={values[i]!.prescriptionNo} onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, prescriptionNo: e.target.value } : x)))} /></label>
            </div>
          </fieldset>
        ))}
        <ErrorBox error={error} />
        {ready.length === 0 && <div className="small" style={{ color: 'var(--bad)' }}>{t('err_ph_patient_required')}</div>}
        <div className="row">
          <button type="button" className="btn primary" disabled={ready.length === 0} onClick={() => void save()}><Icon name="check" size={16} />{t(correcting ? 'ph_correct' : 'ph_record')}</button>
          <button type="button" className="btn" onClick={onDone}>{t('ph_later')}</button>
        </div>
      </div>
    </Modal>
  );
}
