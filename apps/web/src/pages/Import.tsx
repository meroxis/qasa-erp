import { useMemo, useState } from 'react';
import { normalizeForSearch, rateToX100, todayIso } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, downloadCsv, useLoad, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { MEDIA_TEXT } from '../i18n/media.ts';
import { mediaApi, type ImportKind, type ImportOptions, type ImportResult } from '../industry/media-api.ts';

/**
 * استيراد من Excel — import from Excel or CSV in three steps: choose the file, match its columns (found by themselves
 * from Arabic, English or Kurdish headers), then check and import. Nothing is saved until the check finds no problem,
 * and then everything is saved at once.
 */

interface Field { key: string; label: Key; required?: boolean; words: string[] }

const F = (key: string, label: Key, words: string[], required = false): Field => ({ key, label, words, required });
const NAME = ['name', 'full name', 'الاسم', 'اسم', 'ناو', 'ناوی تەواو'];
const PHONE = ['phone', 'mobile', 'tel', 'telephone', 'الهاتف', 'هاتف', 'موبايل', 'رقم الهاتف', 'تەلەفۆن', 'مۆبایل', 'ژمارەی تەلەفۆن'];
const ADDRESS = ['address', 'العنوان', 'عنوان', 'ناونیشان'];
const NOTES = ['notes', 'note', 'ملاحظات', 'ملاحظة', 'تێبینی', 'تێبینییەکان'];
const CURRENCY = ['currency', 'العملة', 'عملة', 'دراو', 'جۆری دراو'];

const FIELDS: Record<ImportKind, Field[]> = {
  customers: [
    F('name', 'md_fName', [...NAME, 'customer', 'customer name', 'الزبون', 'اسم الزبون', 'العميل', 'کڕیار', 'ناوی کڕیار'], true),
    F('phone', 'md_fPhone', PHONE), F('address', 'md_fAddress', ADDRESS),
    F('creditLimit', 'md_fCreditLimit', ['credit limit', 'سقف الائتمان', 'حد الائتمان', 'سقف الدين', 'سنووری قەرز']),
    F('notes', 'md_fNotes', NOTES)
  ],
  suppliers: [
    F('name', 'md_fName', [...NAME, 'supplier', 'supplier name', 'vendor', 'المجهز', 'اسم المجهز', 'المورد', 'دابینکەر', 'ناوی دابینکەر'], true),
    F('phone', 'md_fPhone', PHONE), F('address', 'md_fAddress', ADDRESS), F('notes', 'md_fNotes', NOTES)
  ],
  items: [
    F('code', 'md_fCode', ['code', 'item code', 'sku', 'الرمز', 'رمز', 'رمز المادة', 'كود', 'الكود', 'کۆد', 'کۆدی کاڵا']),
    F('nameAr', 'md_fNameAr', ['name ar', 'arabic name', 'name (arabic)', 'الاسم بالعربي', 'الاسم العربي', 'اسم المادة', 'المادة', 'ناوی عەرەبی']),
    F('nameEn', 'md_fNameEn', ['name en', 'english name', 'name (english)', 'name', 'item', 'item name', 'description', 'الاسم بالانكليزي', 'الاسم بالإنجليزي', 'ناوی ئینگلیزی']),
    F('nameKu', 'md_fNameKu', ['name ku', 'kurdish name', 'name (kurdish)', 'الاسم بالكردي', 'الاسم الكردي', 'ناوی کوردی', 'ناو', 'کاڵا', 'ناوی کاڵا']),
    F('unit', 'md_fUnit', ['unit', 'uom', 'الوحدة', 'وحدة', 'یەکە', 'یەکەی پێوانە']),
    F('price', 'md_fPrice', ['price', 'sale price', 'selling price', 'السعر', 'سعر البيع', 'نرخ', 'نرخی فرۆشتن']),
    F('currency', 'md_fCurrency', CURRENCY),
    F('barcode', 'md_fBarcode', ['barcode', 'bar code', 'ean', 'الباركود', 'باركود', 'بارکۆد'])
  ],
  opening_stock: [
    F('item', 'md_fItem', ['item', 'code', 'item code', 'barcode', 'name', 'المادة', 'الرمز', 'رمز المادة', 'اسم المادة', 'كاڵا', 'کاڵا', 'کۆد', 'ناو'], true),
    F('qty', 'md_fQty', ['qty', 'quantity', 'stock', 'الكمية', 'كمية', 'الرصيد', 'بڕ', 'ژمارە', 'بڕی کۆگا'], true),
    F('cost', 'md_fCost', ['cost', 'unit cost', 'cost price', 'الكلفة', 'كلفة', 'كلفة الوحدة', 'سعر الكلفة', 'تێچوو', 'تێچووی یەکە'])
  ],
  opening_balances: [
    F('party', 'md_fParty', ['party', 'customer', 'supplier', 'name', 'code', 'الزبون', 'المجهز', 'الاسم', 'الرمز', 'کڕیار', 'دابینکەر', 'ناو', 'کۆد'], true),
    F('amount', 'md_fAmount', ['amount', 'balance', 'opening balance', 'الرصيد', 'المبلغ', 'رصيد أول المدة', 'باڵانس', 'بڕ', 'باڵانسی سەرەتا'], true),
    F('currency', 'md_fCurrency', CURRENCY)
  ]
};

const KINDS: { kind: ImportKind; label: Key; help: Key; icon: string }[] = [
  { kind: 'customers', label: 'md_kCustomers', help: 'md_hCustomers', icon: 'contact' },
  { kind: 'suppliers', label: 'md_kSuppliers', help: 'md_hSuppliers', icon: 'truck' },
  { kind: 'items', label: 'md_kItems', help: 'md_hItems', icon: 'box' },
  { kind: 'opening_stock', label: 'md_kOpeningStock', help: 'md_hOpeningStock', icon: 'swap' },
  { kind: 'opening_balances', label: 'md_kOpeningBalances', help: 'md_hOpeningBalances', icon: 'wallet' }
];

/* ---------- reading the file ---------- */

/** Splits CSV text, with quotes, and a comma, semicolon or tab between cells (whichever the header uses most). */
export function parseCsv(textIn: string): string[][] {
  const text = textIn.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Reads the files of a .zip (an .xlsx is one), with the browser's own decompression. */
async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean, maxInflated: number): Promise<Map<string, string>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not_zip');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  let inflated = 0;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('not_zip');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    if (method === 0) {
      inflated += data.length;
      if (inflated > maxInflated) throw new Error('too_large');
      out.set(name, decoder.decode(data));
    } else if (method === 8) {
      // read the inflated bytes as they come, and stop a small file that inflates into gigabytes
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        inflated += value.length;
        if (inflated > maxInflated) { await reader.cancel(); throw new Error('too_large'); }
        parts.push(value);
      }
      out.set(name, await new Blob(parts as BlobPart[]).text());
    }
  }
  return out;
}

/** Excel's last column is XFD (16,384 columns); a cell reference past it is not a real sheet. */
export const MAX_COLUMNS = 16_384;
/** Files over this size are refused before reading (an item or customer list is far smaller). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** What an .xlsx may inflate to in all. */
export const MAX_INFLATED_BYTES = 100 * 1024 * 1024;

/** A cell reference's column (A → 0); throws 'format' past Excel's last column, so a crafted sheet can't exhaust memory. */
export function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(letters)) throw new Error('format');
  const i = [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  if (i >= MAX_COLUMNS) throw new Error('format');
  return i;
}

/**
 * The first sheet of an .xlsx as rows of text (shared strings, inline strings, numbers and booleans). maxInflated caps
 * what its files may inflate to (MAX_INFLATED_BYTES unless a test asks for less).
 */
export async function readXlsx(buffer: ArrayBuffer, { maxInflated = MAX_INFLATED_BYTES }: { maxInflated?: number } = {}): Promise<string[][]> {
  const files = await unzip(buffer, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n.startsWith('xl/worksheets/sheet'), maxInflated);
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  // the first sheet in the workbook's order, through its relationship
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheet = files.get(sheetPath);
  if (!sheet) throw new Error('no_sheet');
  const shared = [...xml(files.get('xl/sharedStrings.xml') ?? '<sst/>').getElementsByTagName('si')]
    .map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''));
  const rows: string[][] = [];
  for (const r of xml(sheet).getElementsByTagName('row')) {
    const row: string[] = [];
    for (const c of r.getElementsByTagName('c')) {
      const i = colIndex(c.getAttribute('r') ?? 'A1');
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const value = type === 's' ? shared[Number(v)] ?? ''
        : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('')
        : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : v;
      while (row.length < i) row.push('');
      row[i] = value;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => (v ?? '').trim() !== ''));
}

async function readFile(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('too_large');
  if (/\.csv$|\.txt$/i.test(file.name)) return parseCsv(await file.text());
  if (/\.xlsx$/i.test(file.name)) return readXlsx(await file.arrayBuffer());
  throw new Error('format');
}

const clean = (s: string) => normalizeForSearch(s).replace(/[()_:.\-*]/g, ' ').replace(/\s+/g, ' ').trim();

/** Which column of the file holds each field: by the words people use for it, in any of the three languages. */
function guessColumns(fields: Field[], headers: string[], labelOf: (k: Key) => string[]): Record<string, number> {
  const taken = new Set<number>();
  const map: Record<string, number> = {};
  const cleaned = headers.map(clean);
  // exact matches first (all fields), then a header that starts with one of the words
  for (const pass of ['exact', 'prefix'] as const) {
    for (const f of fields) {
      if (map[f.key] !== undefined) continue;
      const words = [...f.words, ...labelOf(f.label)].map(clean);
      const i = cleaned.findIndex((h, idx) => !taken.has(idx) && h !== '' && words.some((w) => (pass === 'exact' ? h === w : h.startsWith(w + ' '))));
      if (i >= 0) { map[f.key] = i; taken.add(i); }
    }
  }
  return map;
}

/* ---------- the page ---------- */

export function Import() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [kind, setKind] = useState<ImportKind>('customers');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [columns, setColumns] = useState<Record<string, number>>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [date, setDate] = useState(todayIso());
  const [warehouseId, setWarehouseId] = useState('');
  const [partyType, setPartyType] = useState<'customer' | 'supplier'>('customer');
  const [rate, setRate] = useState('');
  // the same opening stock or balances were imported before: importing again needs a clear yes
  const [again, setAgain] = useState(false);
  const warehouses = useLoad(() => api.warehouses(), []);

  const fields = FIELDS[kind];
  const headers = table[0] ?? [];
  const body = table.slice(1);
  // every language's word for each field, so a sheet made in another language still matches
  const labelOf = (k: Key) => [...((MEDIA_TEXT as Record<string, readonly string[]>)[k] ?? [t(k)])];

  const rows = useMemo(() => body.map((r) => {
    const o: Record<string, string> = {};
    for (const f of fields) {
      const i = columns[f.key];
      if (i !== undefined && i >= 0) o[f.key] = (r[i] ?? '').trim();
    }
    return o;
  }), [body, columns, fields]);

  const missing = fields.filter((f) => f.required && (columns[f.key] === undefined || columns[f.key]! < 0));

  const reset = (k: ImportKind) => {
    setKind(k); setStep(1); setTable([]); setFileName(''); setColumns({}); setCheck(null); setDone(null); setError(null); setReadError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null); setError(null); setCheck(null); setDone(null);
    try {
      const data = await readFile(file);
      if (data.length < 2) { setReadError(t('md_fileEmpty')); return; }
      setTable(data);
      setFileName(file.name);
      setColumns(guessColumns(fields, data[0]!, labelOf));
      setStep(2);
    } catch (e) {
      const why = (e as Error).message;
      setReadError(why === 'format' ? t('md_fileFormat') : why === 'too_large' ? t('md_fileTooLarge') : t('md_fileUnreadable'));
    }
  };

  const options = (): ImportOptions | undefined => {
    if (kind === 'opening_stock') return { date, ...(warehouseId ? { warehouseId } : {}), ...(again ? { again } : {}) };
    if (kind === 'opening_balances') {
      const r = Number(rate.replace(/[,\s]/g, ''));
      return { date, partyType, ...(r > 0 ? { rateX100: rateToX100(r) } : {}), ...(again ? { again } : {}) };
    }
    return undefined;
  };

  const run = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    if (dryRun) setAgain(false);
    try {
      const result = await mediaApi.import(kind, rows, dryRun, options(), i18n.lang);
      if (dryRun) { setCheck(result); setStep(3); }
      else { setDone(result); toast(t('md_imported')); }
    } catch (e) {
      setError(e);
      if (dryRun) { setCheck(null); setStep(3); }
    } finally {
      setBusy(false);
    }
  };

  const template = () => {
    const sample: Record<ImportKind, string[][]> = {
      customers: [['Raz', '0750 445 1290', 'Erbil — 100m road', '5000000', '']],
      suppliers: [['Zagros Trading', '0770 123 4567', 'Sulaymaniyah', '']],
      items: [['P-0001', 'فلتر زيت', 'Oil filter', 'فلتەری زەیت', 'piece', '15000', 'IQD', '6281000000012']],
      opening_stock: [['P-0001', '24', '9000']],
      opening_balances: [['C-0001', '1500000', 'IQD']]
    };
    downloadCsv(`qasa-${kind.replace('_', '-')}.csv`, [fields.map((f) => t(f.label)), ...sample[kind]]);
  };

  const stepChip = (n: 1 | 2 | 3, label: Key) => (
    <span className="chip" aria-current={step === n ? 'step' : undefined} style={step === n ? { background: 'var(--accent-soft)', color: 'var(--accent-soft-ink)', fontWeight: 600 } : undefined}>
      {i18n.int(n)} · {t(label)}
    </span>
  );

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <p className="muted" style={{ margin: 0 }}>{t('md_importHelp')}</p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {stepChip(1, 'md_step1')}{stepChip(2, 'md_step2')}{stepChip(3, 'md_step3')}
      </div>

      {/* 1 — what and which file */}
      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>{t('md_whatToImport')}</h2>
        <div className="grid-3" role="radiogroup" aria-label={t('md_whatToImport')}>
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className="card pad tile"
              style={{ textAlign: 'start', cursor: 'pointer', borderColor: kind === k.kind ? 'var(--accent)' : undefined, boxShadow: kind === k.kind ? '0 0 0 1px var(--accent)' : undefined, font: 'inherit', color: 'inherit' }}
              onClick={() => reset(k.kind)}>
              <div className="label"><span className="ico"><Icon name={k.icon} size={16} /></span><strong>{t(k.label)}</strong></div>
              <div className="muted small">{t(k.help)}</div>
            </button>
          ))}
        </div>

        {(kind === 'opening_stock' || kind === 'opening_balances') && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
            <label className="field" style={{ width: 180 }}>
              <span>{t('md_date')}</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {kind === 'opening_stock' && (warehouses.data?.length ?? 0) > 1 && (
              <label className="field" style={{ width: 220 }}>
                <span>{t('warehouse')}</span>
                <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">{i18n.name(warehouses.data![0]!.name)}</option>
                  {warehouses.data!.slice(1).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
                </select>
              </label>
            )}
            {kind === 'opening_balances' && (
              <>
                <label className="field" style={{ width: 200 }}>
                  <span>{t('md_balancesOf')}</span>
                  <select className="input" value={partyType} onChange={(e) => setPartyType(e.target.value as 'customer' | 'supplier')}>
                    <option value="customer">{t('md_kCustomers')}</option>
                    <option value="supplier">{t('md_kSuppliers')}</option>
                  </select>
                </label>
                <label className="field" style={{ width: 200 }}>
                  <span>{t('md_usdRate')}</span>
                  <input className="input ltr" inputMode="decimal" placeholder="1310" value={rate} onChange={(e) => setRate(e.target.value)} />
                </label>
              </>
            )}
          </div>
        )}
        {kind === 'opening_balances' && <p className="muted small" style={{ margin: 0 }}>{t(partyType === 'customer' ? 'md_signCustomers' : 'md_signSuppliers')}</p>}

        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className="btn primary" style={{ cursor: 'pointer' }}>
            <Icon name="plus" size={16} />{t('md_chooseFile')}
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
              onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button type="button" className="btn" onClick={template}><Icon name="download" size={16} />{t('md_template')}</button>
          {fileName && <span className="muted small ltr">{fileName} · {i18n.int(body.length)} {t('md_rows')}</span>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('md_fileHint')}</p>
        {readError && <div className="alert bad" role="alert">{readError}</div>}
      </div>

      {/* 2 — match the columns */}
      {step >= 2 && (
        <div className="card pad stack">
          <h2 style={{ margin: 0 }}>{t('md_matchColumns')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{t('md_matchHelp')}</p>
          <div className="grid-3">
            {fields.map((f) => (
              <label key={f.key} className="field">
                <span>{t(f.label)}{f.required && ' *'}</span>
                <select className="input" value={columns[f.key] ?? -1}
                  onChange={(e) => { setColumns({ ...columns, [f.key]: Number(e.target.value) }); setCheck(null); if (step === 3) setStep(2); }}>
                  <option value={-1}>{t('md_notInFile')}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && <div className="alert warn">{t('md_needColumns', { c: missing.map((f) => t(f.label)).join('، ') })}</div>}

          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th style={{ width: 60 }}>{t('md_row')}</th>{fields.map((f) => <th key={f.key}>{t(f.label)}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}><td className="muted">{i18n.int(i + 2)}</td>{fields.map((f) => <td key={f.key}>{r[f.key] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && <p className="muted small" style={{ margin: 0 }}>{t('md_andMore', { n: i18n.int(rows.length - 5) })}</p>}

          <div className="row">
            <button type="button" className="btn primary" disabled={busy || missing.length > 0} onClick={() => void run(true)}>
              <Icon name="check" size={16} />{t('md_check')}
            </button>
          </div>
        </div>
      )}

      {/* 3 — check, then import */}
      {step === 3 && (
        <div className="card pad stack">
          <h2 style={{ margin: 0 }}>{t('md_step3')}</h2>
          {error ? (
            <>
              <div className="alert warn">{t('md_fixAndRetry')}</div>
              <ErrorBox error={error} />
            </>
          ) : null}
          {check && !done && (
            <>
              <div className="alert ok">
                {t('md_checkOk', { n: i18n.int(check.created), s: i18n.int(check.skipped.length) })}
              </div>
              {check.skipped.length > 0 && (
                <p className="muted small" style={{ margin: 0 }}>
                  {t('md_skippedRows')}: {check.skipped.slice(0, 30).map((s) => i18n.int(s.line)).join('، ')}{check.skipped.length > 30 ? '…' : ''}
                </p>
              )}
              {(kind === 'opening_stock' || kind === 'opening_balances') && <p className="muted small" style={{ margin: 0 }}>{t('md_draftNote')}</p>}
              {(check.importedBefore?.length ?? 0) > 0 && (
                <div className="alert warn stack" role="alert">
                  <span>{t('md_importedBefore')}</span>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    {check.importedBefore!.map((d) => (
                      <a key={d.id} className="btn small" href={href(d.type === 'stock_doc' ? `stock-doc/${d.id}` : `entry/${d.id}`)}>
                        {t(d.type === 'stock_doc' ? 'md_openStockDoc' : 'md_openEntry')}{d.currency ? ` · ${d.currency}` : ''}
                      </a>
                    ))}
                  </div>
                  <label className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
                    <span>{t('md_importAgain')}</span>
                  </label>
                </div>
              )}
              <div className="row">
                <button type="button" className="btn primary" disabled={busy || ((check.importedBefore?.length ?? 0) > 0 && !again)} onClick={() => void run(false)}>
                  <Icon name="download" size={16} />{t('md_importNow', { n: i18n.int(check.created) })}
                </button>
              </div>
            </>
          )}
          {done && (
            <>
              <div className="alert ok">{t('md_doneText', { n: i18n.int(done.created) })}</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {done.documents.map((d) => (
                  <a key={d.id} className="btn" href={href(d.type === 'stock_doc' ? `stock-doc/${d.id}` : `entry/${d.id}`)}>
                    {t(d.type === 'stock_doc' ? 'md_openStockDoc' : 'md_openEntry')}{d.currency ? ` · ${d.currency}` : ''}
                  </a>
                ))}
                {kind === 'customers' && <a className="btn" href={href('customers')}>{t('md_kCustomers')}</a>}
                {kind === 'suppliers' && <a className="btn" href={href('suppliers')}>{t('md_kSuppliers')}</a>}
                {kind === 'items' && <a className="btn" href={href('items')}>{t('md_kItems')}</a>}
                <button type="button" className="btn ghost" onClick={() => reset(kind)}>{t('md_importAnother')}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
