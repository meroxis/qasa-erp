import { useEffect, useMemo, useRef, useState } from 'react';
import {
  checkPrintDesign, DEFAULT_PRINT_DESIGN, DEFAULT_RECEIPT_DESIGN, designFor, galleryIdOf, LANGS, LOGO_POSITIONS, PRINT_DOCS, PRINT_FIELDS,
  PRINT_FONT_SIZES, PRINT_GALLERY, PRINT_LABELS, PRINT_LIMITS, PRINT_PAPERS, printFieldApplies, readPrintDesignFile, withGalleryDesign,
  type DesignProblem, type Lang, type PrintDesign, type PrintDoc, type PrintDesignFile, type PrintField, type PrintFontSizeName,
  type PrintGalleryId, type PrintKind, type PrintLayout
} from '@qasa/core';
import { printDocument } from '../industry/printing.ts';
import { ErrorBox, Icon, useData, usePageNav, useToast } from '../components.tsx';
import { href } from '../router.ts';
import { isKey, useI18n, type Key } from '../i18n.ts';
import { PrintDocument } from '../industry/PrintDocument.tsx';
import { sampleModel } from '../industry/print-model.ts';
import { logoUrl, printApi, refreshPrintSetup, setPrintSetup, usePrintSetup, type PrintProfile } from '../industry/print-api.ts';

/**
 * Print design (admin, every plan): how each kind of paper looks, beside a live preview of a sample in the chosen
 * language. No canvas to drag things around on: a few clear choices, so anyone can get a good-looking invoice.
 */

const LANG_NAMES: Record<Lang, string> = { ar: 'عربي', en: 'English', ku: 'کوردی' };
const LABEL_DEFAULT_KEY: Record<(typeof PRINT_LABELS)[number], Key> = {
  title: 'pd_h_title', itemCode: 'pd_h_code', barcode: 'pd_h_barcode', item: 'pd_h_item', unit: 'pd_h_unit', qty: 'pd_h_qty',
  price: 'pd_h_price', discount: 'pd_h_discount', amount: 'pd_h_amount', total: 'pd_h_total', usdEquivalent: 'pd_h_usd',
  partyBalance: 'pd_h_balance', preparedBy: 'pd_h_preparedBy', receivedBy: 'pd_h_receivedBy', stamp: 'pd_h_stamp',
  bankDetails: 'pd_h_bank', terms: 'pd_h_terms', previousBalance: 'pd_h_previousBalance'
};

/**
 * The parts the designer offers to show or hide. Not the discount column: invoice and quotation lines have no discount
 * of their own (a discount is on the whole paper and prints under the subtotal), so it would always print empty. A
 * design saved with it keeps the field, which the paper ignores.
 */
export const DESIGNER_FIELDS = PRINT_FIELDS.filter((f) => f !== 'discount');

/** The same parts in the order and the groups the designer shows them in (every one of DESIGNER_FIELDS, once). */
export const FIELD_GROUPS: readonly { title: Key; fields: readonly PrintField[] }[] = [
  { title: 'pd_grp_company', fields: ['logo', 'companyAddress', 'companyPhone', 'companyTax'] },
  { title: 'pd_grp_party', fields: ['partyPhone', 'partyAddress', 'previousBalance', 'partyBalance'] },
  { title: 'pd_grp_lines', fields: ['itemCode', 'barcode', 'itemImage', 'unit'] },
  { title: 'pd_grp_totals', fields: ['subtotal', 'amountWords', 'usdEquivalent', 'exchangeRate'] },
  { title: 'pd_grp_foot', fields: ['notes', 'terms', 'bankDetails', 'signatures', 'stamp', 'qr', 'pageNumbers'] }
];

/**
 * The groups with only the parts this kind of paper and this layout can print: a switch that would change nothing on
 * the paper is not offered (item columns on a voucher, the verify code on a purchase, page numbers on a receipt roll).
 */
export function designerGroups(doc: PrintDoc, layout: PrintLayout): { title: Key; fields: PrintField[] }[] {
  return FIELD_GROUPS
    .map((g) => ({ title: g.title, fields: g.fields.filter((f) => printFieldApplies(f, doc, layout)) }))
    .filter((g) => g.fields.length > 0);
}

/** A part's name in the designer: on a voucher the balance after the paper is what is left to pay. */
export function fieldLabelKey(field: PrintField, doc: PrintDoc): Key {
  return field === 'partyBalance' && doc === 'voucher' ? 'pd_f_remainingBalance' : (`pd_f_${field}` as Key);
}

/** The named text size a design has (small, normal, large), or null for a size of its own. */
export function fontSizeName(size: number): PrintFontSizeName | null {
  return (Object.keys(PRINT_FONT_SIZES) as PrintFontSizeName[]).find((k) => PRINT_FONT_SIZES[k] === size) ?? null;
}

export function problemText(t: (k: Key) => string, p: DesignProblem): string {
  const key = `err_${p.code}`;
  return (isKey(key) ? t(key) : p.code) + (p.path ? ` (${p.path})` : '');
}

/** The printer a design's kind of paper prints on (Settings → Printers). */
export function printKindOf(doc: PrintDoc): PrintKind {
  return doc === 'pos' ? 'receipt' : doc === 'quote' ? 'quote' : doc === 'voucher' ? 'voucher' : 'invoice';
}

/** Choosing the thermal receipt puts it on 80 mm paper, and leaving it puts the paper back on A4. */
export function withLayout(d: PrintDesign, layout: PrintLayout): PrintDesign {
  if (layout === 'receipt80') return { ...d, layout, paper: '80mm', marginMm: Math.min(d.marginMm, 5) };
  return { ...d, layout, paper: d.paper === '80mm' ? 'A4' : d.paper, marginMm: d.paper === '80mm' ? DEFAULT_PRINT_DESIGN.marginMm : d.marginMm };
}

export function PrintDesignPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, plan } = useData();
  usePageNav({ key: 'pd_title', group: 'gSystem' });
  const setup = usePrintSetup();
  const [doc, setDoc] = useState<PrintDoc>('sale');
  const [lang, setLang] = useState<Lang>(i18n.lang);
  // the design being edited; null = this kind follows the sale invoice (or the default receipt)
  const [draft, setDraft] = useState<PrintDesign | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fileProblems, setFileProblems] = useState<DesignProblem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // load what is saved for this kind whenever the kind (or what is saved) changes, unless edits are pending
  useEffect(() => {
    if (dirty) return;
    setDraft(doc === 'sale' ? designFor(setup.designs, 'sale') : setup.designs[doc] ?? null);
  }, [doc, setup.designs]); // eslint-disable-line react-hooks/exhaustive-deps

  const followed = doc === 'pos' ? DEFAULT_RECEIPT_DESIGN : designFor(setup.designs, 'sale');
  const shown = draft ?? followed;
  const own = doc === 'sale' || draft !== null;

  const edit = (patch: Partial<PrintDesign>) => { setDraft({ ...shown, ...patch }); setDirty(true); };
  const switchDoc = (next: PrintDoc) => {
    if (dirty && !window.confirm(t('pd_unsaved'))) return;
    setDirty(false);
    setFileProblems(null);
    setError(null);
    setDoc(next);
    setDraft(next === 'sale' ? designFor(setup.designs, 'sale') : setup.designs[next] ?? null);
  };

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (draft === null) {
        setPrintSetup({ designs: await printApi.resetDesign(doc) });
      } else {
        const checked = checkPrintDesign(draft);
        if ('problems' in checked) { setFileProblems(checked.problems); return; }
        setPrintSetup({ designs: await printApi.saveDesign(doc, checked.design) });
      }
      setDirty(false);
      toast(t('pd_saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError(null);
    setBusy(true);
    try {
      const designs = await printApi.resetDesign(doc);
      setPrintSetup({ designs });
      setDirty(false);
      setDraft(doc === 'sale' ? designFor(designs, 'sale') : null);
      toast(t('pd_resetDone'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function exportFile() {
    const file: PrintDesignFile = { qasa: 'print-design', version: 1, doc, design: shown };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qasa-print-design-${doc}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setFileProblems(null);
    try {
      // a design file is small; anything big isn't one
      if (file.size > 64 * 1024) { setFileProblems([{ code: 'pd_not_a_design_file', path: '' }]); return; }
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { setFileProblems([{ code: 'pd_not_a_design_file', path: '' }]); return; }
      const read = readPrintDesignFile(parsed);
      if ('problems' in read) { setFileProblems(read.problems); return; }
      setDraft(read.design);
      setDirty(true);
      toast(t('pd_imported'));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const model = useMemo(() => sampleModel(doc), [doc]);
  const zoom = shown.paper === '80mm' ? 1 : shown.paper === 'A5' ? 0.8 : 0.62;

  const company = settings?.companyName ?? { ar: 'شركتي', en: 'My company', ku: 'کۆمپانیاکەم' };

  return (
    <div className="stack pd-page no-print-content">
      {/* "Print the sample": the paper as the design draws it, alone, on the printer chosen for its kind (Settings → Printers) */}
      <div className="print-only">
        <PrintDocument
          model={model} design={shown} profile={setup.profile} company={company}
          lang={lang} branding={!plan?.features.includes('noBranding')} defaultRateX100={settings?.defaultRateX100}
        />
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('pd_help')}</p>
      <div className="tabs" role="tablist">
        {PRINT_DOCS.map((d) => (
          <button key={d} type="button" role="tab" aria-pressed={doc === d} aria-selected={doc === d} onClick={() => switchDoc(d)}>{t(`pd_doc_${d}` as Key)}</button>
        ))}
      </div>

      <div className="pd-layout">
        <div className="stack pd-panel">
          {doc !== 'sale' && (
            <div className="card pad stack">
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="pd-own" checked={!own} onChange={() => { setDraft(null); setDirty(true); }} />
                {doc === 'pos' ? t('pd_defaultReceipt') : t('pd_sameAsSale')}
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="pd-own" checked={own} onChange={() => { setDraft({ ...followed }); setDirty(true); }} />
                {t('pd_ownDesign')}
              </label>
            </div>
          )}

          <fieldset className="card pad stack pd-fields" disabled={!own}>
            <div className="pd-group">
              <h3 style={{ margin: 0 }}>{t('pd_gallery')}</h3>
              <p className="muted small" style={{ margin: 0 }}>{t('pd_galleryHint')}</p>
              <div className="pd-gallery">
                {PRINT_GALLERY.map((g) => {
                  const sample = withGalleryDesign(shown, g.id);
                  return (
                    <button key={g.id} type="button" className="pd-card" aria-pressed={galleryIdOf(shown) === g.id}
                      onClick={() => { setDraft(sample); setDirty(true); }}>
                      <div className="pd-thumb" aria-hidden="true">
                        <div style={{ zoom: THUMB_ZOOM[g.paper] }}>
                          <PrintDocument
                            model={model} design={sample} profile={setup.profile} company={company}
                            lang={lang} branding={false} defaultRateX100={settings?.defaultRateX100} preview
                          />
                        </div>
                      </div>
                      <span className="pd-card-name">{t(`pd_g_${g.id}` as Key)}</span>
                      <span className="pd-card-hint muted">{t(`pd_g_${g.id}_d` as Key)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid-2">
              <label className="field"><span>{t('pd_paper')}</span>
                <select className="input" value={shown.paper} onChange={(e) => edit({ paper: e.target.value as PrintDesign['paper'] })}>
                  {PRINT_PAPERS.filter((p) => (shown.layout === 'receipt80') === (p === '80mm')).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="field"><span>{t('pd_accent')}</span>
                <input className="input" type="color" value={shown.accent} onChange={(e) => edit({ accent: e.target.value.toLowerCase() })} />
              </label>
              <label className="field"><span>{t('pd_textSize')}</span>
                <select className="input" value={fontSizeName(shown.fontSize) ?? 'custom'}
                  onChange={(e) => { if (e.target.value in PRINT_FONT_SIZES) edit({ fontSize: PRINT_FONT_SIZES[e.target.value as PrintFontSizeName] }); }}>
                  {(Object.keys(PRINT_FONT_SIZES) as PrintFontSizeName[]).map((k) => <option key={k} value={k}>{t(`pd_size_${k}` as Key)}</option>)}
                  {/* a design saved or imported with a size of its own keeps it until another is chosen */}
                  {fontSizeName(shown.fontSize) === null && <option value="custom">{t('pd_size_custom', { n: String(shown.fontSize) })}</option>}
                </select>
              </label>
              <label className="field"><span>{t('pd_margin')}</span>
                <input className="input num" type="number" min={PRINT_LIMITS.marginMm[0]} max={PRINT_LIMITS.marginMm[1]} value={shown.marginMm}
                  onChange={(e) => edit({ marginMm: clamp(Number(e.target.value), PRINT_LIMITS.marginMm, 1) })} />
              </label>
              <label className="field"><span>{t('pd_secondLang')}</span>
                <select className="input" value={shown.secondLang ?? ''} onChange={(e) => edit({ secondLang: (e.target.value || null) as Lang | null })}>
                  <option value="">{t('pd_none')}</option>
                  {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t('pd_logoPos')}</span>
                <select className="input" value={shown.logo.position} onChange={(e) => edit({ logo: { ...shown.logo, position: e.target.value as PrintDesign['logo']['position'] } })}>
                  {LOGO_POSITIONS.map((p) => <option key={p} value={p}>{t(`pd_logo_${p}` as Key)}</option>)}
                </select>
              </label>
              <label className="field"><span>{t('pd_logoHeight')}</span>
                <input className="input num" type="number" min={PRINT_LIMITS.logoHeightMm[0]} max={PRINT_LIMITS.logoHeightMm[1]} value={shown.logo.heightMm}
                  onChange={(e) => edit({ logo: { ...shown.logo, heightMm: clamp(Number(e.target.value), PRINT_LIMITS.logoHeightMm, 1) } })} />
              </label>
            </div>

            <h3 style={{ margin: '6px 0 0' }}>{t('pd_showSection')}</h3>
            {designerGroups(doc, shown.layout).map((g) => (
              <div key={g.title} className="pd-group">
                <div className="pd-group-title muted">{t(g.title)}</div>
                <div className="pd-checks">
                  {g.fields.map((f) => (
                    <label key={f} className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={shown.show[f]} onChange={(e) => edit({ show: { ...shown.show, [f]: e.target.checked } })} />
                      {t(fieldLabelKey(f, doc))}
                    </label>
                  ))}
                </div>
                {g.title === 'pd_grp_party' && (shown.show.partyBalance || shown.show.previousBalance) && <span className="muted small">{t('pd_balanceHint')}</span>}
              </div>
            ))}

            {shown.show.bankDetails && (
              <label className="field"><span>{t('pd_bankText')}</span>
                <textarea className="input" rows={2} maxLength={PRINT_LIMITS.bankDetails} value={shown.bankDetails} onChange={(e) => edit({ bankDetails: e.target.value })} />
              </label>
            )}
            {shown.show.terms && (
              <label className="field"><span>{t('pd_termsText')}</span>
                <textarea className="input" rows={3} maxLength={PRINT_LIMITS.terms} value={shown.terms} onChange={(e) => edit({ terms: e.target.value })} />
              </label>
            )}

            <details>
              <summary>{t('pd_rename')}</summary>
              <p className="muted small">{t('pd_renameHint')}</p>
              <div className="grid-2">
                {PRINT_LABELS.map((k) => (
                  <label key={k} className="field"><span>{t(LABEL_DEFAULT_KEY[k])}</span>
                    <input className="input" maxLength={PRINT_LIMITS.label} value={shown.labels[k] ?? ''} placeholder={t(LABEL_DEFAULT_KEY[k])}
                      onChange={(e) => edit({ labels: { ...shown.labels, [k]: e.target.value } })} />
                  </label>
                ))}
              </div>
            </details>
          </fieldset>

          <ErrorBox error={error} />
          {fileProblems && (
            <div className="alert bad" role="alert">
              {t('pd_badFile')}
              <ul>{fileProblems.slice(0, 8).map((p, i) => <li key={i}>{problemText(t, p)}</li>)}</ul>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}><Icon name="check" size={16} />{t('pd_save')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void reset()}><Icon name="undo" size={16} />{t('pd_reset')}</button>
            <button type="button" className="btn" onClick={exportFile}><Icon name="download" size={16} />{t('pd_export')}</button>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
            <button type="button" className="btn" disabled={!own} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />{t('pd_import')}</button>
            {dirty && <span className="chip warn">{t('pd_unsaved')}</span>}
          </div>

          <PrintHeaderCard />
        </div>

        <div className="stack pd-preview-col">
          <div className="row">
            <strong>{t('pp_preview')}</strong>
            <span className="spacer" />
            <button type="button" className="btn small" onClick={() => void printDocument(printKindOf(doc))}><Icon name="printer" size={14} />{t('prn_printSample')}</button>
            <label className="row small" style={{ gap: 6 }}>{t('pd_previewLang')}
              <select className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
              </select>
            </label>
          </div>
          <div className="pd-preview-scroll">
            <div style={{ zoom }}>
              <PrintDocument
                model={model} design={shown} profile={setup.profile} company={company}
                lang={lang} branding={!plan?.features.includes('noBranding')} defaultRateX100={settings?.defaultRateX100} preview
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** How small a sheet is drawn on a gallery card (the card shows the top of the paper). */
const THUMB_ZOOM: Record<PrintDesign['paper'], number> = { A4: 0.16, A5: 0.225, '80mm': 0.4 };

function clamp(v: number, [lo, hi]: readonly [number, number], step: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v / step) * step));
}

/* ---------- the company's header: logo, address, phone, tax number, footer line ---------- */

const MAX_LOGO_SIDE = 600;
const TARGET_LOGO_BYTES = 180 * 1024;

/**
 * The picture drawn again as a new PNG (transparency kept), or as WebP when the PNG is too big, at most 600 pixels a
 * side. Always redrawn, never sent as the file was: what goes to the server is only the picture, without anything else
 * the file carried (the camera's place and time, comments, data stuck on after the picture).
 */
export async function prepareLogo(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, MAX_LOGO_SIDE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const [type, q] of [['image/png', 1], ['image/webp', 0.9], ['image/webp', 0.75]] as const) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
        if (blob && blob.type === type && blob.size <= TARGET_LOGO_BYTES) return blob;
      }
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('too_large');
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function PrintHeaderCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { plan } = useData();
  const setup = usePrintSetup();
  const [form, setForm] = useState<PrintProfile>({ address: '', phone: '', taxNumber: '', footer: '', showLogo: true });
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = setup.profile;
    if (p) setForm({ address: p.address, phone: p.phone, taxNumber: p.taxNumber, footer: p.footer, showLogo: p.showLogo });
  }, [setup.profile]);

  const run = async (fn: () => Promise<void>, done: Key) => {
    setError(null);
    setLocalError(null);
    setBusy(true);
    try { await fn(); toast(t(done)); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const chooseLogo = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      let small: Blob;
      try { small = await prepareLogo(file); } catch { setLocalError(t('pp_logoUnreadable')); throw null; }
      await printApi.setLogo(await base64Of(small));
      refreshPrintSetup();
    }, 'pp_logoSaved').finally(() => { if (input.current) input.current.value = ''; });
  };

  const logo = logoUrl(setup.profile?.logo);
  // the company's logo is part of the paid plans (and the free month); the server refuses it otherwise, whatever shows here
  const canLogo = !!plan?.features.includes('companyLogo');
  const kept = !!setup.profile?.logoKept;
  return (
    <div className="card pad stack">
      <h2>{t('pp_title')}</h2>
      <p className="muted small" style={{ margin: 0 }}>{t('pp_help')}</p>
      <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="pp-logo-box">{logo ? <img src={logo} alt={t('pp_logo')} /> : <span className="muted small">{t('pp_noLogo')}</span>}</div>
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 200 }}>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!canLogo} onChange={(e) => chooseLogo(e.target.files?.[0])} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={busy || !canLogo} onClick={() => input.current?.click()}><Icon name="upload" size={16} />{logo ? t('pp_changeLogo') : t('pp_chooseLogo')}</button>
            {(logo || kept) && <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { await printApi.deleteLogo(); refreshPrintSetup(); }, 'pp_logoRemoved')}><Icon name="x" size={16} />{t('pp_removeLogo')}</button>}
          </div>
          {canLogo ? (
            <>
              <span className="muted small">{t('pp_logoHint')}</span>
              <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={form.showLogo} onChange={(e) => setForm({ ...form, showLogo: e.target.checked })} />{t('pp_showLogo')}</label>
            </>
          ) : (
            <div className="alert info pd-locked" role="note">
              <Icon name="star" size={16} />
              <span>
                {t('pp_logoLocked')} {kept && <>{t('pp_logoKept')} </>}
                <a href={href('plans')}>{t('planLicense')}</a>
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="grid-3">
        <label className="field"><span>{t('pp_address')}</span><input className="input" maxLength={200} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label className="field"><span>{t('pp_phone')}</span><input className="input ltr" maxLength={80} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="field"><span>{t('pp_taxNumber')}</span><input className="input ltr" maxLength={40} value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} /></label>
      </div>
      <label className="field"><span>{t('pp_footer')}</span>
        <input className="input" maxLength={300} value={form.footer} placeholder={t('pp_footerHint')} onChange={(e) => setForm({ ...form, footer: e.target.value })} />
      </label>
      {localError && <div className="alert bad" role="alert">{localError}</div>}
      <ErrorBox error={error} />
      <div><button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { setPrintSetup({ profile: await printApi.saveProfile(form) }); }, 'pp_saved')}>{t('save')}</button></div>
    </div>
  );
}
