import { useMemo, useState, type CSSProperties } from 'react';
import { api, type ItemView } from '../api.ts';
import { EmptyState, ErrorBox, Icon, SearchCombo, useData, useLoad, usePageNav, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { barcodeFor, barsPath, type Barcode } from '../industry/barcode.ts';
import '../industry/print-design.css';
import { printDocument } from '../industry/printing.ts';
import { unitPrice, type UnitCode } from '@qasa/core';
import { UnitPicker } from '../industry/UnitPicker.tsx';
import { unitLabel } from '../industry/units.ts';
import { supermarketReportsApi, type ShelfFlagView } from '../industry/supermarket-reports-api.ts';

/**
 * Barcode labels (every plan): choose items and how many of each, a label size, and print — on a label printer
 * (one label per page) or on A4 label sheets. The barcode is the item's EAN-13 when it has one, else Code 128 of its
 * barcode or code, drawn as SVG so it prints sharp on any printer.
 */

export const LABEL_SIZES = {
  '38x25': { w: 38, h: 25, cols: 1, rows: 1, sheet: false },
  '50x30': { w: 50, h: 30, cols: 1, rows: 1, sheet: false },
  a4_3x8: { w: 70, h: 37, cols: 3, rows: 8, sheet: true },
  a4_4x10: { w: 52.5, h: 29.6, cols: 4, rows: 10, sheet: true },
  // 1.7: shelf labels (a big price) on an A4 sheet of 3 × 7
  a4_shelf_3x7: { w: 70, h: 42.4, cols: 3, rows: 7, sheet: true }
} as const;
/** The layouts printed as shelf labels: the price large, the barcode small. */
export const SHELF_SIZES: ReadonlySet<string> = new Set(['a4_shelf_3x7']);
export type LabelSize = keyof typeof LABEL_SIZES;
export const MAX_LABELS = 2000;

/** unit (1.1): a label for one of the item's other units (a box), with that unit's barcode and price; null: the item's own. */
interface Row {
  itemId: string; copies: number; unit?: UnitCode | null;
  /** 1.7: from the shelf labels to reprint: the price the shelf shows now (null: a new item), and when it changed */
  oldPrice?: number | null; changedAt?: string;
}

/**
 * The rows for the shelf labels to reprint: one label of each, after the rows already chosen (a row already there takes
 * the old price, so it can print crossed out).
 */
export function rowsWithChanged(rows: readonly Row[], flags: readonly ShelfFlagView[]): Row[] {
  const out = [...rows];
  for (const f of flags) {
    const unit = (f.unit ?? null) as UnitCode | null;
    const at = out.findIndex((r) => r.itemId === f.itemId && (r.unit ?? null) === unit);
    const row: Row = { itemId: f.itemId, unit, copies: at >= 0 ? out[at]!.copies : 1, oldPrice: f.oldPrice, changedAt: f.changedAt };
    if (at >= 0) out[at] = row;
    else out.push(row);
  }
  return out;
}

const rowKey = (r: Pick<Row, 'itemId' | 'unit'>) => `${r.itemId}|${r.unit ?? ''}`;

/** The labels in print order: each item as many times as asked, after the blank places skipped on a used sheet. */
export function labelRun(rows: Row[], skip: number): (string | null)[] {
  return labelRows(rows, skip).map((r) => r?.itemId ?? null);
}

/** labelRun with each label's row (its unit). */
export function labelRows<R extends Row>(rows: R[], skip: number): (R | null)[] {
  const out: (R | null)[] = Array.from({ length: Math.max(0, skip) }, () => null);
  for (const r of rows) for (let i = 0; i < r.copies; i++) out.push(r);
  return out;
}

/**
 * The barcode text and price of a label: the unit's own when the row is for one of the item's units. A unit with no
 * barcode of its own gets none (the label can't be printed): the item's barcode would add one base unit at the counter.
 */
export function labelFace(item: ItemView, unit: UnitCode | null | undefined): { barcode: string; price: number } {
  const u = unit ? item.units.find((x) => x.unit === unit) : undefined;
  if (!u) return { barcode: item.barcode || item.code, price: item.salePrice };
  return { barcode: u.barcode ?? '', price: unitPrice({ price: item.salePrice }, { factorMilli: u.factorMilli, salePrice: u.salePrice }) };
}

/** The @page rule for the chosen size: a label printer gets one label per page; sheets are A4 with no margin. */
export function labelPageRule(size: LabelSize): string {
  const s = LABEL_SIZES[size];
  return s.sheet ? '@page { size: A4; margin: 0; }' : `@page { size: ${s.w}mm ${s.h}mm; margin: 0; }`;
}

export function Labels() {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  usePageNav({ key: 'lb_title', group: 'gStock' });
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [size, setSize] = useState<LabelSize>('38x25');
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCompany, setShowCompany] = useState(false);
  const [skip, setSkip] = useState(0);
  const [pick, setPick] = useState('');
  // 1.7: the shelf labels to reprint, and those added to this print run (taken off the list once printed)
  const changed = useLoad(() => supermarketReportsApi.shelfFlags(), []);
  const [added, setAdded] = useState<ShelfFlagView[]>([]);
  const [printedRun, setPrintedRun] = useState(false);
  const [showOld, setShowOld] = useState(true);
  const [cleared, setCleared] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<unknown>(null);

  const byId = useMemo(() => new Map((items.data ?? []).map((it) => [it.id, it])), [items.data]);
  const codes = useMemo(() => {
    const m = new Map<string, Barcode | null>();
    for (const it of items.data ?? []) {
      m.set(rowKey({ itemId: it.id, unit: null }), barcodeFor(it.barcode || it.code));
      for (const u of it.units ?? []) m.set(rowKey({ itemId: it.id, unit: u.unit }), barcodeFor(labelFace(it, u.unit).barcode));
    }
    return m;
  }, [items.data]);

  const options: PickOption[] = (items.data ?? []).map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}`, hint: it.barcode
  }));

  const add = (itemId: string) => {
    if (!itemId) return;
    setRows((rs) => (rs.some((r) => r.itemId === itemId && !r.unit) ? rs.map((r) => (r.itemId === itemId && !r.unit ? { ...r, copies: r.copies + 1 } : r)) : [...rs, { itemId, copies: 1, unit: null }]));
    setPick('');
  };
  const addAll = () => setRows((items.data ?? []).filter((it) => codes.get(rowKey({ itemId: it.id }))).map((it) => ({ itemId: it.id, copies: 1, unit: null })));
  const setCopies = (key: string, copies: number) => setRows((rs) => rs.map((r) => (rowKey(r) === key ? { ...r, copies: Math.max(0, Math.min(500, Math.floor(copies) || 0)) } : r)));
  const setUnit = (key: string, unit: UnitCode | null) => setRows((rs) => rs.map((r) => (rowKey(r) === key ? { ...r, unit } : r)));
  const remove = (key: string) => setRows((rs) => rs.filter((r) => rowKey(r) !== key));

  const addChanged = () => {
    const flags = changed.data?.rows ?? [];
    setRows((rs) => rowsWithChanged(rs, flags));
    setAdded(flags);
    setPrintedRun(false);
    setCleared(null);
    setSize('a4_shelf_3x7');
  };
  const markPrinted = async () => {
    setBusy(true);
    setMarkError(null);
    try {
      const r = await supermarketReportsApi.shelfPrinted(added);
      setCleared(r.cleared);
      setAdded([]);
      setPrintedRun(false);
      changed.reload();
    } catch (e) {
      setMarkError(e);
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    const result = await printDocument('label', { labelLayout: size });
    if (added.length && (result === 'printed' || result === 'dialog')) setPrintedRun(true);
  };

  const printable = rows.filter((r) => codes.get(rowKey(r)) && r.copies > 0);
  const shelf = SHELF_SIZES.has(size);
  const spec = LABEL_SIZES[size];
  const run = labelRows(printable, spec.sheet ? skip : 0);
  const tooMany = run.length > MAX_LABELS;
  const company = settings ? i18n.name(settings.companyName) : '';

  if (items.error) return <ErrorBox error={items.error} />;

  return (
    <div className="stack lb-page">
      <style>{labelPageRule(size)}</style>
      <div className="stack no-print" style={{ maxWidth: 1100 }}>
        <p className="muted" style={{ margin: 0 }}>{t('lb_help')}</p>
        <div className="card pad stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Icon name="tag" size={18} />
            <strong>{t('smr_changedTitle')}</strong>
            <span className="muted">{changed.data ? (changed.data.count ? t('smr_changedCount', { n: i18n.int(changed.data.count) }) : t('smr_changedNone')) : ''}</span>
            <span className="spacer" />
            {!!changed.data?.count && <button type="button" className="btn" onClick={addChanged}><Icon name="plus" size={16} />{t('smr_addChanged')}</button>}
            {added.length > 0 && printedRun && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void markPrinted()}><Icon name="check" size={16} />{t('smr_markPrinted')}</button>
            )}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('smr_changedHelp')}</p>
          {cleared !== null && <div className="alert ok">{t('smr_printedDone', { n: i18n.int(cleared) })}</div>}
          <ErrorBox error={changed.error ?? markError} />
        </div>
        <div className="card pad stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div style={{ minWidth: 280, flex: 1 }}>
              <SearchCombo value={pick} options={options} onChange={add} placeholder={t('lb_addItem')} ariaLabel={t('lb_addItem')} />
            </div>
            <button type="button" className="btn" onClick={addAll}><Icon name="plus" size={16} />{t('lb_addAll')}</button>
            {rows.length > 0 && <button type="button" className="btn" onClick={() => setRows([])}><Icon name="x" size={16} />{t('lb_clear')}</button>}
          </div>

          {rows.length === 0 ? <EmptyState icon="tag" title={t('lb_empty')} text={t('lb_emptyText')} compact /> : (
            <table className="table">
              <thead><tr><th>{t('pd_h_code')}</th><th>{t('pd_h_item')}</th><th>{t('pd_h_barcode')}</th><th className="amount">{t('lb_copies')}</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const it = byId.get(r.itemId);
                  const key = rowKey(r);
                  const code = codes.get(key);
                  return (
                    <tr key={key}>
                      <td className="ltr">{it?.code}</td>
                      <td>
                        {it ? i18n.name(it.name) : ''}
                        {r.changedAt && <span className="badge" style={{ marginInlineStart: 6 }}>{r.oldPrice === null || r.oldPrice === undefined ? t('smr_new') : `${t('smr_was')} ${i18n.money(r.oldPrice, it?.saleCurrency ?? 'IQD')}`}</span>}
                        {!code && <div className="small" style={{ color: 'var(--bad)' }}>{t(r.unit ? 'lb_noUnitCode' : 'lb_noCode')}</div>}
                        {it && it.units.length > 0 && <UnitPicker item={it} value={r.unit ?? null} onChange={(unit) => setUnit(key, unit)} />}
                      </td>
                      <td className="ltr">{code?.text ?? '—'}</td>
                      <td className="amount"><input className="input num" type="number" min={0} max={500} value={r.copies} style={{ width: 90 }} onChange={(e) => setCopies(key, Number(e.target.value))} aria-label={t('lb_copies')} /></td>
                      <td><button type="button" className="btn small" onClick={() => remove(key)} aria-label="×"><Icon name="x" size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card pad stack">
          <div className="grid-3">
            <label className="field"><span>{t('lb_size')}</span>
              <select className="input" value={size} onChange={(e) => setSize(e.target.value as LabelSize)}>
                {(Object.keys(LABEL_SIZES) as LabelSize[]).map((s) => <option key={s} value={s}>{t(`lb_size_${s}` as Key)}</option>)}
              </select>
            </label>
            {spec.sheet && (
              <label className="field"><span>{t('lb_skip')}</span>
                <input className="input num" type="number" min={0} max={spec.cols * spec.rows - 1} value={skip} onChange={(e) => setSkip(Math.max(0, Math.min(spec.cols * spec.rows - 1, Math.floor(Number(e.target.value)) || 0)))} />
                <span className="muted small">{t('lb_skipHint')}</span>
              </label>
            )}
            <div className="stack" style={{ gap: 6 }}>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />{t('lb_showName')}</label>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />{t('lb_showPrice')}</label>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={showCompany} onChange={(e) => setShowCompany(e.target.checked)} />{t('lb_showCompany')}</label>
              {rows.some((r) => r.changedAt) && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />{t('smr_showOld')}</label>}
            </div>
          </div>
          {tooMany && <div className="alert bad">{t('lb_tooMany')}</div>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={printable.length === 0 || tooMany} onClick={() => void print()}><Icon name="printer" size={16} />{t('lb_print')}</button>
            <span className="muted">{t('lb_total', { n: run.filter(Boolean).length })}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('lb_printerTip')}</p>
        </div>
        {printable.length > 0 && <h3 style={{ margin: 0 }}>{t('lb_preview')}</h3>}
      </div>

      {printable.length > 0 && !tooMany && (
        <div className={`lb-sheet${spec.sheet ? ' lb-a4' : ' lb-roll'}${shelf ? ' lb-shelf' : ''}`} style={{ '--lb-w': `${spec.w}mm`, '--lb-h': `${spec.h}mm`, '--lb-cols': spec.cols } as CSSProperties}>
          {run.map((r, i) => {
            const it = r ? byId.get(r.itemId) : undefined;
            const code = r ? codes.get(rowKey(r)) : null;
            const face = it ? labelFace(it, r?.unit) : null;
            const priceText = it && face ? i18n.money(face.price, it.saleCurrency) + (r?.unit ? ` / ${unitLabel(i18n, r.unit)}` : '') : null;
            // the price the shelf showed, crossed out (only when it differs from the price printed now)
            const old = it && face && showPrice && showOld && r?.oldPrice !== null && r?.oldPrice !== undefined && r.oldPrice !== face.price ? i18n.money(r.oldPrice, it.saleCurrency) : null;
            return it && code
              ? <Label key={i} item={it} code={code} name={showName ? i18n.name(it.name) : null} price={showPrice ? priceText : null} old={old} company={showCompany ? company : null} />
              : <div key={i} className="lb-label lb-blank" />;
          })}
        </div>
      )}
    </div>
  );
}

function Label({ code, name, price, old, company }: { item: ItemView; code: Barcode; name: string | null; price: string | null; old?: string | null; company: string | null }) {
  // ten modules of quiet zone each side, so scanners find the edges
  const quiet = 10;
  return (
    <div className="lb-label">
      {company && <div className="lb-company">{company}</div>}
      {name && <div className="lb-name">{name}</div>}
      <svg className="lb-bars" viewBox={`${-quiet} 0 ${code.modules + quiet * 2} 40`} preserveAspectRatio="none" role="img" aria-label={code.text}>
        <path d={barsPath(code.widths, 40)} fill="#000" />
      </svg>
      <div className="lb-code ltr">{code.text}</div>
      {old && <div className="lb-old"><s>{old}</s></div>}
      {price && <div className="lb-price">{price}</div>}
    </div>
  );
}
