import { useEffect, useMemo, useState } from 'react';
import { todayIso } from '@qasa/core';
import { api, ApiError } from '../api.ts';
import { AmountInput, EmptyState, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';
import { dailyApi, type DailyItem, type DailySheet } from '../industry/market-extras-api.ts';

/**
 * موردو التوريد اليومي — suppliers who deliver every day (bread, milk, eggs; every plan). Route: daily-suppliers, and
 * daily-suppliers/<supplier id> for one supplier's sheet. The sheet lists their usual items with what came last time:
 * type what came today and what goes back unsold, and save once (a purchase, and returns of the earlier days').
 */

export function DailySuppliers({ partyId }: { partyId?: string | undefined }) {
  usePageNav({ key: 'mx_dsTitle', group: 'gPurchases' });
  return partyId ? <Sheet partyId={partyId} /> : <SupplierList />;
}

function SupplierList() {
  const i18n = useI18n();
  const { t } = i18n;
  const { permissions } = useData();
  const may = !permissions || permissions.includes('purchases');
  const { data, error, reload } = useLoad(() => dailyApi.suppliers(), []);
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <p className="muted no-print" style={{ margin: 0 }}>{t('mx_dsHelp')}</p>
      <div className="row no-print"><span className="spacer" />
        {may && <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('mx_dsAdd')}</button>}
      </div>
      <ErrorBox error={error} />
      {data && (data.length === 0 ? <EmptyState icon="truck" title={t('mx_dsTitle')} text={t('mx_dsNone')} /> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>{t('supplier')}</th><th className="num">{t('mx_dsItems')}</th><th className="num">{t('mx_dsBalance')}</th><th>{t('mx_dsToday')}</th><th className="no-print" /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.partyId}>
                  <td><a href={href(`party/${s.partyId}`)}>{s.name}</a></td>
                  <td className="num">{i18n.int(s.items)}</td>
                  <td className="num">{i18n.money(s.balance, 'IQD')}</td>
                  <td>{s.doneToday ? <span className="chip ok">{t('mx_dsDone')}</span> : <span className="chip warn">{t('mx_dsWaiting')}</span>}</td>
                  <td className="no-print"><button type="button" className="btn small primary" onClick={() => go(`daily-suppliers/${s.partyId}`)}>{t('mx_dsOpen')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {adding && <AddSupplier onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); reload(); go(`daily-suppliers/${id}`); }} />}
    </div>
  );
}

function AddSupplier({ onClose, onDone }: { onClose(): void; onDone(partyId: string): void }) {
  const { t } = useI18n();
  const suppliers = useLoad(() => api.parties({ type: 'supplier', active: 'true' }), []);
  const [partyId, setPartyId] = useState('');
  const options = (suppliers.data ?? []).map((p): PickOption => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));
  return (
    <Modal title={t('mx_dsAdd')} onClose={onClose}>
      <div className="stack">
        <SearchCombo value={partyId} options={options} onChange={setPartyId} placeholder={t('chooseSupplier')} ariaLabel={t('supplier')} />
        <p className="muted small" style={{ margin: 0 }}>{t('mx_dsAddHelp')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!partyId} onClick={() => onDone(partyId)}>{t('mx_dsOpen')}</button>
        </div>
      </div>
    </Modal>
  );
}

interface Typed { received: number | null; returned: number | null; unitCost: number | null }

function Sheet({ partyId }: { partyId: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { permissions, seesCost } = useData();
  const may = !permissions || permissions.includes('purchases');
  const [date, setDate] = useState(todayIso());
  const sheet = useLoad(() => dailyApi.sheet(partyId, date), [partyId, date]);
  const warehouses = useLoad(() => api.warehouses(), []);
  const history = useLoad(() => dailyApi.receipts(partyId), [partyId]);
  const [warehouseId, setWarehouseId] = useState('');
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [editingItems, setEditingItems] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!warehouseId && warehouses.data?.length) setWarehouseId(warehouses.data.find((w) => w.active)?.id ?? ''); }, [warehouses.data, warehouseId]);
  // yesterday's quantities are the starting point for today's
  useEffect(() => {
    if (!sheet.data) return;
    setTyped(Object.fromEntries(sheet.data.items.map((it) => [it.itemId, { received: it.lastReceivedMilli, returned: null, unitCost: it.unitCost ?? null }])));
  }, [sheet.data]);

  const items = sheet.data?.items ?? [];
  const lineOf = (it: DailyItem) => typed[it.itemId] ?? { received: null, returned: null, unitCost: it.unitCost ?? null };
  const total = items.reduce((s, it) => {
    const l = lineOf(it);
    return s + Math.round(((l.received ?? 0) * (l.unitCost ?? 0)) / 1000) - Math.round(((l.returned ?? 0) * (l.unitCost ?? 0)) / 1000);
  }, 0);

  async function save(again = false) {
    setError(null);
    setBusy(true);
    try {
      await dailyApi.save({
        partyId, date, warehouseId, ...(again ? { again: true } : {}),
        // someone who may not see cost sends none: the server uses the cost agreed with the supplier
        lines: items.map((it) => {
          const l = lineOf(it);
          return { itemId: it.itemId, receivedMilli: l.received ?? 0, returnedMilli: l.returned ?? 0, ...(seesCost !== false && l.unitCost !== null ? { unitCost: l.unitCost } : {}) };
        })
          .filter((l) => l.receivedMilli > 0 || l.returnedMilli > 0)
      });
      toast(t('saved'));
      sheet.reload();
      history.reload();
    } catch (e) {
      // a sheet is already saved for this supplier and day: typed twice far more often than a second visit, so ask
      if (!again && e instanceof ApiError && e.code === 'ds_sheet_exists' && window.confirm(t('mx_dsAgainConfirm'))) { await save(true); return; }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => go('daily-suppliers')}><Icon name="chevron" size={16} />{t('mx_dsTitle')}</button>
        <h2 style={{ margin: 0 }}>{sheet.data?.partyName}</h2>
        <span className="spacer" />
        {sheet.data && <span className="muted">{t('mx_dsBalance')}: <strong className="num">{i18n.money(sheet.data.balance, 'IQD')}</strong></span>}
        {may && <button type="button" className="btn" onClick={() => setEditingItems(true)}><Icon name="edit" size={16} />{t('mx_dsUsual')}</button>}
      </div>
      <div className="row no-print">
        <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>
        {(warehouses.data ?? []).filter((w) => w.active).length > 1 && (
          <label className="field"><span>{t('warehouse')}</span>
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {(warehouses.data ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
        )}
        {sheet.data?.doneToday && <span className="chip ok">{t('mx_dsDoneDay')}</span>}
      </div>
      <ErrorBox error={sheet.error ?? error} />
      {sheet.data && (items.length === 0 ? <EmptyState icon="box" title={t('mx_dsUsual')} text={t('mx_dsNoItems')} /> : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>{t('item')}</th><th className="num">{t('mx_dsLast')}</th><th className="num">{t('mx_dsReceived')}</th>
                <th className="num">{t('mx_dsReturned')}</th>{seesCost !== false && <th className="num">{t('mx_dsCost')}</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const l = lineOf(it);
                const set = (patch: Partial<Typed>) => setTyped((x) => ({ ...x, [it.itemId]: { ...l, ...patch } }));
                return (
                  <tr key={it.itemId}>
                    <td>{i18n.name(it.name)} <span className="muted small ltr">{it.code}</span></td>
                    <td className="num small muted">
                      {it.lastReceivedMilli !== null ? `${i18n.qty(it.lastReceivedMilli)} / ↩ ${i18n.qty(it.lastReturnedMilli ?? 0)}` : '—'}
                      {it.returnableMilli > 0 && <div>{t('mx_dsCanReturn', { n: i18n.qty(it.returnableMilli) })}</div>}
                    </td>
                    <td style={{ width: 120 }}><QtyInput value={l.received} onChange={(v) => set({ received: v })} ariaLabel={`${t('mx_dsReceived')} ${i18n.name(it.name)}`} /></td>
                    <td style={{ width: 120 }}><QtyInput value={l.returned} onChange={(v) => set({ returned: v })} ariaLabel={`${t('mx_dsReturned')} ${i18n.name(it.name)}`} /></td>
                    {seesCost !== false && <td style={{ width: 140 }}><AmountInput value={l.unitCost} currency="IQD" onChange={(v) => set({ unitCost: v })} ariaLabel={`${t('mx_dsCost')} ${i18n.name(it.name)}`} /></td>}
                  </tr>
                );
              })}
            </tbody>
            {seesCost !== false && <tfoot><tr><td colSpan={4}>{t('mx_dsNet')}</td><td className="num"><strong>{i18n.money(total, 'IQD')}</strong></td></tr></tfoot>}
          </table>
        </div>
      ))}
      {may && items.length > 0 && (
        <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" disabled={busy || !warehouseId} onClick={() => void save()}><Icon name="check" size={16} />{t('mx_dsSave')}</button>
        </div>
      )}
      {history.data && history.data.length > 0 && (
        <section className="card">
          <h3 style={{ margin: '12px 16px' }}>{t('mx_dsHistory')}</h3>
          <table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('mx_dsPurchase')}</th><th>{t('mx_dsReturns')}</th>{seesCost !== false && <th className="num">{t('mx_dsNet')}</th>}</tr></thead>
            <tbody>
              {history.data.map((r) => (
                <tr key={r.id}>
                  <td>{i18n.date(r.date)}</td>
                  <td>{r.purchaseId ? <a className="ltr" href={href(`invoice/${r.purchaseId}`)}>{r.purchaseNumber}</a> : '—'}</td>
                  <td>{r.returns.map((x) => <a key={x.id} className="ltr" href={href(`invoice/${x.id}`)} style={{ marginInlineEnd: 6 }}>{x.number}</a>)}</td>
                  {seesCost !== false && <td className="num">{i18n.money((r.received ?? 0) - (r.returned ?? 0), 'IQD')}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {editingItems && sheet.data && <UsualItems sheet={sheet.data} onClose={() => setEditingItems(false)} onSaved={() => { setEditingItems(false); sheet.reload(); }} />}
    </div>
  );
}

/** The supplier's usual items in the sheet's order, each with the cost agreed with them. */
function UsualItems({ sheet, onClose, onSaved }: { sheet: DailySheet; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { seesCost } = useData();
  const all = useLoad(() => api.items({ active: 'true' }), []);
  const [list, setList] = useState(sheet.items.map((it) => ({ itemId: it.itemId, unitCost: it.unitCost ?? null })));
  const [pick, setPick] = useState('');
  const [error, setError] = useState<unknown>(null);
  const options = useMemo(() => (all.data ?? []).filter((it) => it.unit !== 'service' && !list.some((l) => l.itemId === it.id))
    .map((it): PickOption => ({ id: it.id, code: it.code, label: i18n.name(it.name), search: it.barcode })), [all.data, list, i18n]);
  const nameOf = (id: string) => { const it = all.data?.find((x) => x.id === id) ?? sheet.items.find((x) => x.itemId === id); return it ? i18n.name(it.name) : id; };
  return (
    <Modal title={t('mx_dsUsual')} onClose={onClose}>
      <div className="stack">
        <SearchCombo value={pick} options={options} placeholder={t('chooseItem')} ariaLabel={t('item')}
          onChange={(id) => { if (id) setList((x) => [...x, { itemId: id, unitCost: null }]); setPick(''); }} />
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
          {list.map((l, i) => (
            <li key={l.itemId} className="row" style={{ gap: 6 }}>
              <span style={{ flex: 1 }}>{nameOf(l.itemId)}</span>
              {seesCost !== false && <span style={{ width: 140 }}><AmountInput value={l.unitCost} currency="IQD" onChange={(v) => setList((x) => x.map((y, j) => (j === i ? { ...y, unitCost: v } : y)))} ariaLabel={t('mx_dsCost')} /></span>}
              <button type="button" className="btn small" disabled={i === 0} aria-label={t('mx_up')} onClick={() => setList((x) => { const y = [...x]; [y[i - 1], y[i]] = [y[i]!, y[i - 1]!]; return y; })}>↑</button>
              <button type="button" className="btn small" aria-label={t('actDelete')} onClick={() => setList((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" onClick={() => {
            setError(null);
            // without cost: the order and the items only, so the costs agreed stay as they are
            dailyApi.setItems(sheet.partyId, seesCost === false ? list.map((l) => ({ itemId: l.itemId })) : list).then(onSaved, setError);
          }}>{t('save')}</button>
        </div>
      </div>
    </Modal>
  );
}
