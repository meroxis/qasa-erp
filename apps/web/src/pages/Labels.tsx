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

/**
 * Barcode labels (every plan): choose items and how many of each, a label size, and print — on a label printer
 * (one label per page) or on A4 label sheets. The barcode is the item's EAN-13 when it has one, else Code 128 of its
 * barcode or code, drawn as SVG so it prints sharp on any printer.
 */

export const LABEL_SIZES = {
  '38x25': { w: 38, h: 25, cols: 1, rows: 1, sheet: false },
  '50x30': { w: 50, h: 30, cols: 1, rows: 1, sheet: false },
  a4_3x8: { w: 70, h: 37, cols: 3, rows: 8, sheet: true },
  a4_4x10: { w: 52.5, h: 29.6, cols: 4, rows: 10, sheet: true }
} as const;
export type LabelSize = keyof typeof LABEL_SIZES;
export const MAX_LABELS = 2000;

/** unit (1.1): a label for one of the item's other units (a box), with that unit's barcode and price; null: the item's own. */
interface Row { itemId: string; copies: number; unit?: UnitCode | null }

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

/** The barcode text and price of a label: the unit's own when the row is for one of the item's units. */
export function labelFace(item: ItemView, unit: UnitCode | null | undefined): { barcode: string; price: number } {
  const u = unit ? item.units.find((x) => x.unit === unit) : undefined;
  if (!u) return { barcode: item.barcode || item.code, price: item.salePrice };
  return { barcode: u.barcode || item.barcode || item.code, price: unitPrice({ price: item.salePrice }, { factorMilli: u.factorMilli, salePrice: u.salePrice }) };
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

  const printable = rows.filter((r) => codes.get(rowKey(r)) && r.copies > 0);
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
                        {it ? i18n.name(it.name) : ''}{!code && <div className="small" style={{ color: 'var(--bad)' }}>{t('lb_noCode')}</div>}
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
            </div>
          </div>
          {tooMany && <div className="alert bad">{t('lb_tooMany')}</div>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={printable.length === 0 || tooMany} onClick={() => void printDocument('label', { labelLayout: size })}><Icon name="printer" size={16} />{t('lb_print')}</button>
            <span className="muted">{t('lb_total', { n: run.filter(Boolean).length })}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('lb_printerTip')}</p>
        </div>
        {printable.length > 0 && <h3 style={{ margin: 0 }}>{t('lb_preview')}</h3>}
      </div>

      {printable.length > 0 && !tooMany && (
        <div className={`lb-sheet${spec.sheet ? ' lb-a4' : ' lb-roll'}`} style={{ '--lb-w': `${spec.w}mm`, '--lb-h': `${spec.h}mm`, '--lb-cols': spec.cols } as CSSProperties}>
          {run.map((r, i) => {
            const it = r ? byId.get(r.itemId) : undefined;
            const code = r ? codes.get(rowKey(r)) : null;
            const face = it ? labelFace(it, r?.unit) : null;
            const priceText = it && face ? i18n.money(face.price, it.saleCurrency) + (r?.unit ? ` / ${unitLabel(i18n, r.unit)}` : '') : null;
            return it && code
              ? <Label key={i} item={it} code={code} name={showName ? i18n.name(it.name) : null} price={showPrice ? priceText : null} company={showCompany ? company : null} />
              : <div key={i} className="lb-label lb-blank" />;
          })}
        </div>
      )}
    </div>
  );
}

function Label({ code, name, price, company }: { item: ItemView; code: Barcode; name: string | null; price: string | null; company: string | null }) {
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
      {price && <div className="lb-price">{price}</div>}
    </div>
  );
}
