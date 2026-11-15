import { useEffect, useRef, useState } from 'react';
import { formatAmount, roundHalfUp, UNITS } from '@qasa/core';
import {
  api, ApiError, CORRECTION_REASONS, isNetworkError, newIdempotencyKey,
  type CorrectionReason, type ItemDetail, type SendOptions, type StockCorrectionInput, type StockCorrectionResult
} from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useMay, useToast, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { BatchInFields } from './BatchFields.tsx';

/**
 * "Correct stock" on an item's page (and a row of the Items list): what is there now, or what to add or take out, in
 * one warehouse, and why. The server makes the document that reason has (a stock adjustment, opening stock, or for a
 * purchase never entered the purchase invoice itself, on credit or paid in cash: packages/server/src/stock-correction.ts)
 * and posts it where the company's rules let this person; the item's page shows the result at once.
 */

/** What a reason allows: out only, in only, or either way. */
export const REASON_WAY: Record<CorrectionReason, 'out' | 'in' | 'both'> = {
  purchase_missing: 'in', found: 'both', damaged: 'out', lost: 'out', opening: 'in', other: 'both'
};

/** The difference a correction makes (base thousandths), from what the books hold and what was typed. */
export function correctionDiff(mode: 'set' | 'change', way: 'in' | 'out', qtyMilli: number | null, onBooksMilli: number): number | null {
  if (qtyMilli === null) return null;
  if (mode === 'set') return qtyMilli - onBooksMilli;
  return way === 'out' ? -qtyMilli : qtyMilli;
}

/**
 * The average cost of the item in one warehouse (IQD per base unit), as the server values what comes in or goes out
 * there; null when that warehouse holds none of it (or the cost is not shown to this person).
 */
export function warehouseAverage(item: Pick<ItemDetail, 'stock'>, warehouseId: string): number | null {
  const s = item.stock.find((x) => x.warehouseId === warehouseId);
  return s && s.value !== undefined && s.qtyMilli > 0 ? roundHalfUp((s.value * 1000) / s.qtyMilli) : null;
}

/** The item's purchase price in IQD per base unit (a dollar price at the company rate); null when it has none. */
export function purchaseCost(item: Pick<ItemDetail, 'purchasePrice' | 'purchaseCurrency'>, rateX100: number | undefined): number | null {
  if (item.purchasePrice === null || item.purchasePrice === undefined) return null;
  if (item.purchaseCurrency === 'USD') return rateX100 ? roundHalfUp((item.purchasePrice * rateX100) / 10000) : null;
  return item.purchasePrice;
}

/**
 * The unit cost the form starts with for a reason. A purchase or opening stock comes in at what it was bought for: the
 * item's purchase price (the warehouse's average when it has none). A count surplus or "other" is left empty, so the
 * server values it at the chosen warehouse's own average; only when that warehouse holds none is the purchase price
 * offered.
 */
export function startingCost(reason: CorrectionReason, average: number | null, price: number | null): number | null {
  if (reason === 'purchase_missing' || reason === 'opening') return price ?? average;
  if (reason === 'found' || reason === 'other') return average !== null ? null : price;
  return null;
}

/** What the person is refused before anything is sent (the server says the same). */
export function correctionProblem(
  reason: CorrectionReason, diff: number | null, note: string, unitCost: number | null,
  more: { average?: number | null; paidBy?: boolean } = {}
): Key | null {
  if (diff === null) return 'err_line_qty_invalid_qtyMilli';
  if (diff === 0) return 'err_correction_no_change';
  if (REASON_WAY[reason] === 'out' && diff > 0) return 'err_correction_out_only_reason';
  if (REASON_WAY[reason] === 'in' && diff < 0) return 'err_correction_in_only_reason';
  if (reason === 'other' && !note.trim()) return 'err_note_required_note';
  if (diff > 0 && (reason === 'purchase_missing' || reason === 'opening') && unitCost === null) return 'err_line_price_invalid_unitCost';
  // a surplus with no cost typed is valued at the warehouse's average: none there, a cost is needed
  if (diff > 0 && (reason === 'found' || reason === 'other') && unitCost === null && more.average === null) return 'err_line_price_invalid_unitCost';
  if (reason === 'purchase_missing' && more.paidBy === false) return 'err_purchase_how_required';
  return null;
}

/**
 * A correction whose try got no answer that says what happened (the link went, or the server failed on its way): it
 * may be made already. It is held, as the very request that was sent, until the server answers it.
 */
export interface HeldCorrection { key: string; itemId: string; input: StockCorrectionInput }

export type CorrectionSent =
  | { status: 'done'; result: StockCorrectionResult }
  /** maybe made, maybe not: held, and sent again only as it was */
  | { status: 'unsure'; held: HeldCorrection; error: unknown }
  /** the server said no: nothing was made, and the form may be changed */
  | { status: 'refused'; error: unknown };

/** Whether a try's outcome is unknown: the server was not reached, did not answer in time, or failed (5xx). */
export const outcomeUnknown = (error: unknown): boolean => !(error instanceof ApiError) || isNetworkError(error) || error.status >= 500;

/**
 * Sends a correction so that it is made once. While one is held (a try of it got no answer), that very request goes
 * again with its key, whatever the form shows now: the server makes it then, or answers with the document the first
 * try made (packages/server/src/idempotency.ts), never a second one. Another correction with a key of its own could
 * be a second document beside the first, so it waits until the held one is answered. A new correction gets a new key.
 */
export async function sendCorrection(
  held: HeldCorrection | null, itemId: string, input: StockCorrectionInput,
  send: (itemId: string, input: StockCorrectionInput, options: SendOptions) => Promise<StockCorrectionResult>,
  make: () => string = newIdempotencyKey
): Promise<CorrectionSent> {
  const request = held ?? { key: make(), itemId, input };
  try {
    return { status: 'done', result: await send(request.itemId, request.input, { key: request.key }) };
  } catch (error) {
    return outcomeUnknown(error) ? { status: 'unsure', held: request, error } : { status: 'refused', error };
  }
}

/** The same, opened from a row of the Items list: the item's stock per warehouse is read first. */
export function StockCorrectionFor({ itemId, onClose, onDone }: { itemId: string; onClose(): void; onDone(result: StockCorrectionResult): void }) {
  const { t } = useI18n();
  const { data, error } = useLoad(() => api.item(itemId), [itemId]);
  if (error) return <Modal title={t('sc_title')} onClose={onClose}><ErrorBox error={error} /></Modal>;
  if (!data) return <Modal title={t('sc_title')} onClose={onClose}><p className="muted" role="status" style={{ margin: 0 }}>{t('sc_loading')}</p></Modal>;
  return <StockCorrection item={data} onClose={onClose} onDone={onDone} />;
}

export function StockCorrection({ item, initialReason = 'found', onClose, onDone }: {
  item: ItemDetail;
  initialReason?: CorrectionReason;
  onClose(): void;
  onDone(result: StockCorrectionResult): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const can = useMay();
  const { settings } = useData();
  const warehouses = useLoad(() => api.warehouses(), []);
  const active = (warehouses.data ?? []).filter((w) => w.active);
  // the first warehouse that holds the item and can be chosen (an inactive one can't take a document)
  const [warehouseId, setWarehouseId] = useState(() => item.stock[0]?.warehouseId ?? '');
  useEffect(() => {
    if (!warehouses.data || active.some((w) => w.id === warehouseId)) return;
    setWarehouseId(item.stock.find((s) => active.some((w) => w.id === s.warehouseId))?.warehouseId ?? active[0]?.id ?? '');
  }, [warehouses.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownWarehouse = warehouseId;
  const onBooks = item.stock.find((s) => s.warehouseId === shownWarehouse)?.qtyMilli ?? 0;
  const [mode, setMode] = useState<'set' | 'change'>('set');
  const [reason, setReason] = useState<CorrectionReason>(initialReason);
  const [way, setWay] = useState<'in' | 'out'>(REASON_WAY[initialReason] === 'out' ? 'out' : 'in');
  const [qtyMilli, setQtyMilli] = useState<number | null>(null);
  const average = warehouseAverage(item, shownWarehouse);
  const price = purchaseCost(item, settings?.defaultRateX100);
  // the cost follows the reason and the warehouse until the person types one
  const [typedCost, setTypedCost] = useState<{ value: number | null } | null>(null);
  const unitCost = typedCost ? typedCost.value : startingCost(reason, average, price);
  // a purchase never entered: on credit from its supplier, or paid in cash from a safe
  const [paid, setPaid] = useState<'credit' | 'cash'>('credit');
  const [supplierId, setSupplierId] = useState('');
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [note, setNote] = useState('');
  const [batch, setBatch] = useState({ batchNo: '', expiry: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<Key | null>(null);
  // a try that got no answer may have made the document already: until the server answers it, the form is that very
  // request, its fields locked, and "Try again" sends it once more with its key (made once, or answered from the first)
  const [held, setHeld] = useState<HeldCorrection | null>(null);
  // one try at a time, also when the button is pressed twice before the dialog has drawn "saving"
  const running = useRef(false);
  const buys = can('purchase');
  const suppliers = useLoad(() => (buys ? api.parties({ type: 'supplier', active: 'true' }) : Promise.resolve([])), [buys]);
  const supplierOptions: PickOption[] = (suppliers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));

  const diff = correctionDiff(mode, way, qtyMilli, onBooks);
  const comesIn = diff !== null && diff > 0;
  const unit = i18n.name(UNITS[item.unit]);
  const purchase = reason === 'purchase_missing';
  // a purchase is entered by someone who enters purchases (the server says the same)
  const blocked = purchase && !buys;
  const explain: Key = purchase && buys ? (paid === 'cash' ? 'sc_x_cash' : supplierId ? 'sc_x_supplier' : 'sc_x_purchase_missing') : `sc_x_${reason}`;
  const surplus = reason === 'found' || reason === 'other';
  const costHint: Key | null = surplus ? (average !== null ? 'sc_costAverage' : 'sc_costNone') : !typedCost && price !== null && unitCost === price ? 'sc_costPrice' : null;

  /** The correction the form says now, or the refusal said before anything is sent. */
  function typedCorrection(): { input: StockCorrectionInput } | { wrong: Key } {
    const paidBy = paid === 'cash' ? !!cashAccount : !!supplierId;
    const wrong = correctionProblem(reason, diff, note, unitCost, { average, paidBy });
    if (wrong) return { wrong };
    return {
      input: {
        warehouseId: shownWarehouse, mode, qtyMilli: mode === 'set' ? qtyMilli! : diff!, reason, lang: i18n.lang,
        ...(comesIn && unitCost !== null ? { unitCost } : {}),
        ...(purchase ? (paid === 'cash' ? { cashAccountCode: cashAccount } : { supplierId }) : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(comesIn && item.trackBatches && batch.batchNo.trim() ? { batchNo: batch.batchNo.trim() } : {}),
        ...(comesIn && item.trackExpiry && batch.expiry ? { expiry: batch.expiry } : {})
      }
    };
  }

  async function save() {
    if (busy || blocked || running.current) return;
    // a held correction goes again as it was sent (sendCorrection), not as the form reads now
    let input: StockCorrectionInput;
    if (held) input = held.input;
    else {
      const typed = typedCorrection();
      if ('wrong' in typed) { setProblem(typed.wrong); return; }
      input = typed.input;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const sent = await sendCorrection(held, item.id, input, (id, body, options) => api.correctStock(id, body, options));
      if (sent.status !== 'done') {
        // no answer: held until the server answers it; a refusal: nothing was made, and the form may be changed
        setHeld(sent.status === 'unsure' ? sent.held : null);
        setError(sent.error);
        return;
      }
      setHeld(null);
      const { result } = sent;
      const doc = result.document.number ?? '';
      toast(result.posted ? t('sc_done', { doc }) : t(result.document.type === 'stock_doc' ? 'sc_waitingOpening' : 'sc_waiting'));
      onDone(result);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const change = (fn: () => void) => { fn(); setProblem(null); };
  // a reason that goes one way only turns the direction to it
  const pickReason = (next: CorrectionReason) => change(() => {
    setReason(next);
    if (REASON_WAY[next] !== 'both') setWay(REASON_WAY[next] === 'out' ? 'out' : 'in');
  });

  return (
    <Modal title={`${t('sc_title')} — ${i18n.name(item.name)}`} onClose={onClose}>
      <div className="stack stock-correction">
        <p className="muted small" style={{ margin: 0 }}>{t('sc_help')}</p>
        {/* held (a try got no answer): nothing here can change until the server answers that very correction */}
        <fieldset disabled={!!held} style={{ display: 'contents' }}>
          <div className="grid-2">
            {active.length > 1 ? (
              <label className="field">
                <span>{t('warehouse')}</span>
                <select className="input" value={shownWarehouse} onChange={(e) => change(() => setWarehouseId(e.target.value))}>
                  {active.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
                </select>
              </label>
            ) : <div className="field"><span>{t('warehouse')}</span><div className="input" aria-readonly="true">{active[0] ? i18n.name(active[0].name) : ''}</div></div>}
            <div className="field">
              <span>{t('sc_onBooks')}</span>
              <div className="input num" aria-readonly="true"><strong>{i18n.qty(onBooks)}</strong> <span className="muted small">{unit}</span></div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="track" role="group" aria-label={t('sc_title')}>
              <button type="button" aria-pressed={mode === 'set'} onClick={() => change(() => setMode('set'))}>{t('sc_modeSet')}</button>
              <button type="button" aria-pressed={mode === 'change'} onClick={() => change(() => setMode('change'))}>{t('sc_modeChange')}</button>
            </div>
            {mode === 'change' && REASON_WAY[reason] === 'both' && (
              <div className="track" role="group" aria-label={t('adj_direction')}>
                <button type="button" aria-pressed={way === 'in'} onClick={() => change(() => setWay('in'))}>{t('adj_in')}</button>
                <button type="button" aria-pressed={way === 'out'} onClick={() => change(() => setWay('out'))}>{t('adj_out')}</button>
              </div>
            )}
          </div>
          <div className="grid-2">
            <div className="field">
              <span>{mode === 'set' ? t('sc_counted') : t('sc_qty')}</span>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                <QtyInput value={qtyMilli} onChange={(v) => change(() => setQtyMilli(v))} ariaLabel={mode === 'set' ? t('sc_counted') : t('sc_qty')} />
                <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{unit}</span>
              </div>
            </div>
            <div className="field">
              <span>{t('sc_after')}</span>
              <div className="input num" aria-readonly="true">
                {diff === null ? '—' : <><strong>{i18n.qty(onBooks + diff)}</strong> <span className="muted small">({diff > 0 ? '+' : diff < 0 ? '−' : ''}{i18n.qty(Math.abs(diff))})</span></>}
              </div>
            </div>
          </div>
          <label className="field">
            <span>{t('adj_reason')}</span>
            <select className="input" value={reason} onChange={(e) => pickReason(e.target.value as CorrectionReason)}>
              {CORRECTION_REASONS.map((r) => <option key={r} value={r}>{t(`sc_r_${r}`)}</option>)}
            </select>
          </label>
          <div className="alert info small">{t(explain)}</div>
          {purchase && (buys ? (
            <>
              <div className="field">
                <span>{t('sc_howPaid')}</span>
                <div className="track" role="group" aria-label={t('sc_howPaid')} style={{ alignSelf: 'flex-start' }}>
                  <button type="button" aria-pressed={paid === 'credit'} onClick={() => change(() => setPaid('credit'))}>{t('sc_howCredit')}</button>
                  <button type="button" aria-pressed={paid === 'cash'} onClick={() => change(() => setPaid('cash'))}>{t('sc_howCash')}</button>
                </div>
              </div>
              {paid === 'credit' ? (
                <div className="field">
                  <span>{t('sc_supplier')}</span>
                  <SearchCombo value={supplierId} options={supplierOptions} onChange={(v) => change(() => setSupplierId(v))} placeholder={t('chooseSupplier')} ariaLabel={t('sc_supplier')}
                    invalid={problem === 'err_purchase_how_required'} />
                </div>
              ) : (
                <div className="field">
                  <span>{t('s14_safe')}</span>
                  <AccountCombo value={cashAccount} onChange={(v) => change(() => setCashAccount(v))} ariaLabel={t('s14_safe')} filter={(a) => a.code.startsWith('18')} />
                </div>
              )}
            </>
          ) : <div className="alert warn small" role="note">{t('sc_purchaseNeedsPurchases')}</div>)}
          {!blocked && (comesIn || (diff === null && (mode === 'set' || way === 'in'))) && reason !== 'damaged' && reason !== 'lost' && (
            <>
              <div className="grid-2">
                <div className="field">
                  <span>{t('sc_unitCost')} <span className="muted small">/ {unit}</span></span>
                  <AmountInput value={unitCost} currency="IQD" onChange={(v) => change(() => setTypedCost({ value: v }))} ariaLabel={t('sc_unitCost')}
                    placeholder={surplus && average !== null ? formatAmount(average, 'IQD') : undefined} />
                  {costHint && <span className="muted small">{t(costHint)}</span>}
                </div>
              </div>
              {item.trackBatches && (
                <div className="field">
                  <span>{t('ex_batch')}</span>
                  <BatchInFields item={item} batchNo={batch.batchNo} expiry={batch.expiry} onChange={(v) => change(() => setBatch(v))} />
                </div>
              )}
            </>
          )}
          <label className="field">
            <span>{reason === 'other' ? t('sc_noteOther') : t('sc_note')}</span>
            <input className={'input' + (problem === 'err_note_required_note' ? ' invalid' : '')} maxLength={400} value={note} onChange={(e) => change(() => setNote(e.target.value))} />
          </label>
        </fieldset>
        {problem && <div className="alert bad" role="alert">{t(problem)}</div>}
        {held && <div className="alert warn" role="alert">{t('sc_unsure')}</div>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !shownWarehouse || blocked} onClick={() => void save()}>
            <Icon name="check" size={16} />{busy ? t('saving') : held ? t('sc_tryAgain') : t('sc_save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
