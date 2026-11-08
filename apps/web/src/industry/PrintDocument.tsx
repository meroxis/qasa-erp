import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { amountInWords, designFor, rateFromX100, roundHalfUp, toBase, type CurrencyCode, type Lang, type Names, type PrintDesign, type PrintDesigns, type PrintLabel } from '@qasa/core';
import { api } from '../api.ts';
import { useData } from '../components.tsx';
import { isKey, makeI18n, useI18n, type I18n, type Key } from '../i18n.ts';
import { qtyText, unitName } from '../pages/Items.tsx';
import { InvoiceQr } from './InvoiceQr.tsx';
import { ItemImage } from './ItemImage.tsx';
import { encodeQr, qrSvgPath } from './qr.ts';
import { barcodeFor, barsPath } from './barcode.ts';
import { logoUrl, usePrintSetup, type PrintProfileView } from './print-api.ts';
import type { PrintModel } from './print-model.ts';
import './print-design.css';

/**
 * Draws a paper the way its print design says: layout, paper, colour, sizes, logo, which parts show, renamed
 * headings and a second language. Every text from the design or the document is put in as text (React escapes it):
 * nothing is ever read as HTML. The page's own @page size and margins come from the design while it is printed.
 */

const noop = () => {};

export function paperI18n(lang: Lang, digits: I18n['digits']): I18n {
  return makeI18n(lang, digits, noop, noop);
}

const DEFAULT_LABEL: Record<PrintLabel, Key> = {
  title: 'pd_h_title', itemCode: 'pd_h_code', barcode: 'pd_h_barcode', item: 'pd_h_item', unit: 'pd_h_unit', qty: 'pd_h_qty',
  price: 'pd_h_price', discount: 'pd_h_discount', amount: 'pd_h_amount', total: 'pd_h_total', usdEquivalent: 'pd_h_usd',
  partyBalance: 'pd_h_balance', preparedBy: 'pd_h_preparedBy', receivedBy: 'pd_h_receivedBy', stamp: 'pd_h_stamp',
  bankDetails: 'pd_h_bank', terms: 'pd_h_terms'
};

export interface PrintDocumentProps {
  model: PrintModel;
  design: PrintDesign;
  profile: PrintProfileView | null;
  company: Names;
  /** the paper's main language (default: the app's) */
  lang?: Lang;
  /** Free plan: the "made with Qasa ERP" line (required by the licence there) */
  branding: boolean;
  /** IQD per USD × 100, for the dollar equivalent of a dinar paper */
  defaultRateX100?: number | undefined;
  /** true in the designer: a sample QR code, no @page rule */
  preview?: boolean;
}

export function PrintDocument({ model, design, profile, company, lang, branding, defaultRateX100, preview = false }: PrintDocumentProps) {
  const app = useI18n();
  const L = useMemo(() => paperI18n(lang ?? app.lang, app.digits), [lang, app.lang, app.digits]);
  const second = useMemo(() => (design.secondLang && design.secondLang !== L.lang ? paperI18n(design.secondLang, app.digits) : null), [design.secondLang, L.lang, app.digits]);
  const show = design.show;
  const receipt = design.layout === 'receipt80';

  /** a heading in the paper's language (or the design's own name for it), with the second language under it */
  const head = (label: PrintLabel, key: Key = DEFAULT_LABEL[label]): ReactNode => (
    <>
      {design.labels[label] || L.t(key)}
      {second && <span className="qd-second">{second.t(key)}</span>}
    </>
  );
  const plain = (key: string): ReactNode => (isKey(key) ? <>{L.t(key)}{second && <span className="qd-second">{second.t(key)}</span>}</> : key);

  const money = (amount: number, currency: CurrencyCode = model.currency) => L.money(amount, currency);
  const itemName = (n: Names | string) => (typeof n === 'string' ? n : L.name(n));
  const items = model.lines.length > 0;
  // the other currency: a USD paper in dinars at its rate, a dinar paper in dollars at the company's rate
  const usdLine = !show.usdEquivalent ? null : model.currency === 'USD'
    ? { currency: 'IQD' as CurrencyCode, amount: model.baseTotal || toBase(model.total, 'USD', model.rateX100) }
    : defaultRateX100 && defaultRateX100 > 0 ? { currency: 'USD' as CurrencyCode, amount: roundHalfUp((model.total * 10000) / defaultRateX100) } : null;
  const logo = profile?.showLogo ? logoUrl(profile.logo) : null;
  const terms = model.terms || design.terms;
  const partyKey: Key = model.partyRole === 'customer' ? 'pd_h_customer' : model.partyRole === 'supplier' ? 'pd_h_supplier' : 'pd_h_party';
  const style = {
    '--qd-accent': design.accent,
    '--qd-fs': `${design.fontSize}pt`,
    '--qd-margin': `${design.marginMm}mm`,
    '--qd-logo-h': `${design.logo.heightMm}mm`
  } as CSSProperties;

  const pageRule = preview ? null : [
    // a receipt roll has no page height: only the margin is set and the printer's own paper size is used
    `@page { ${design.paper === '80mm' ? '' : `size: ${design.paper}; `}margin: ${design.marginMm}mm;`,
    show.pageNumbers && !receipt ? ` @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #555; }` : '',
    ' }'
  ].join('');

  return (
    <div
      className={`qd-paper qd-${design.layout} qd-${design.paper.toLowerCase()} qd-logo-${design.logo.position}${preview ? ' qd-preview' : ''}`}
      style={style} dir={L.dir} lang={L.lang === 'ku' ? 'ckb' : L.lang} data-doc={model.doc}
    >
      {pageRule && <style>{pageRule}</style>}
      <header className="qd-head">
        {logo && <img className="qd-logo" src={logo} alt="" />}
        <div className="qd-company">
          <div className="qd-company-name">{L.name(company)}</div>
          {profile?.address && <div>{profile.address}</div>}
          {(profile?.phone || profile?.taxNumber) && (
            <div className="qd-company-meta">
              {profile?.phone && <span className="ltr">{profile.phone}</span>}
              {profile?.taxNumber && <span>{L.t('pp_taxShort')}: <span className="ltr">{profile.taxNumber}</span></span>}
            </div>
          )}
        </div>
      </header>

      <div className="qd-title-row">
        <div className="qd-title">
          {design.labels.title || L.t(isKey(model.titleKey) ? model.titleKey : 'pd_h_title')}
          {second && isKey(model.titleKey) && <span className="qd-second">{second.t(model.titleKey)}</span>}
          {model.status === 'cancelled' && <span className="qd-stamp-cancelled">{L.t('cancelled')}</span>}
          {model.status === 'draft' && <span className="qd-draft">{L.t('draft')}</span>}
        </div>
        <dl className="qd-meta">
          <dt>{plain('pd_h_number')}</dt><dd className="ltr">{model.number ?? L.t('draft')}</dd>
          <dt>{plain('pd_h_date')}</dt><dd className="num">{L.date(model.date)}</dd>
          {model.validUntil && <><dt>{plain('pd_h_validUntil')}</dt><dd className="num">{L.date(model.validUntil)}</dd></>}
          {model.currency === 'USD' && model.rateX100 !== 100 && <><dt>{plain('pd_h_rate')}</dt><dd className="num">{L.digitsOf(String(rateFromX100(model.rateX100)))}</dd></>}
        </dl>
      </div>

      {model.party && (
        <div className="qd-party">
          <div className="qd-party-label">{plain(partyKey)}</div>
          <div className="qd-party-name">{model.party.name}{model.party.code && <span className="qd-muted ltr"> · {model.party.code}</span>}</div>
          {(model.party.phone || model.party.address) && <div className="qd-muted">{[model.party.phone && L.digitsOf(model.party.phone), model.party.address].filter(Boolean).join(' · ')}</div>}
        </div>
      )}

      {items && !receipt && (
        <table className="qd-table">
          <thead>
            <tr>
              <th className="qd-n">#</th>
              {show.itemImage && <th className="qd-img" />}
              {show.itemCode && <th>{head('itemCode')}</th>}
              <th className="qd-name">{head('item')}</th>
              {show.barcode && <th>{head('barcode')}</th>}
              {show.unit && <th>{head('unit')}</th>}
              <th className="qd-num">{head('qty')}</th>
              <th className="qd-num">{head('price')}</th>
              {/* no discount column: lines have no discount of their own (an older design's show.discount is ignored) */}
              <th className="qd-num">{head('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.map((l, i) => (
              <tr key={i}>
                <td className="qd-n num">{L.int(i + 1)}</td>
                {show.itemImage && <td className="qd-img">{l.itemId && <ItemImage itemId={l.itemId} name={itemName(l.name)} size={28} />}</td>}
                {show.itemCode && <td className="ltr">{l.code ?? ''}</td>}
                <td className="qd-name">{itemName(l.name)}{l.description && <div className="qd-muted">{l.description}</div>}</td>
                {show.barcode && <td>{l.barcode && <MiniBarcode code={l.barcode} />}</td>}
                {show.unit && <td>{l.unit ? unitName(L, l.unit) : ''}</td>}
                <td className="qd-num num">{qtyText(L, l.qtyMilli)}</td>
                <td className="qd-num num">{money(l.unitPrice)}</td>
                <td className="qd-num num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {items && receipt && (
        <div className="qd-receipt-lines">
          {model.lines.map((l, i) => (
            <div className="qd-rline" key={i}>
              <div className="qd-rname">{itemName(l.name)}{show.itemCode && l.code && <span className="qd-muted ltr"> {l.code}</span>}</div>
              <div className="qd-rcalc num">
                <span>{qtyText(L, l.qtyMilli)}{show.unit && l.unit ? ` ${unitName(L, l.unit)}` : ''} × {money(l.unitPrice)}</span>
                <strong>{money(l.amount)}</strong>
              </div>
            </div>
          ))}
        </div>
      )}

      {model.accountLines.length > 0 && (
        <table className="qd-table">
          <thead>
            <tr>
              <th>{plain('pd_h_accountCode')}</th><th className="qd-name">{plain('pd_h_account')}</th>
              <th className="qd-num">{plain('pd_h_debit')}</th><th className="qd-num">{plain('pd_h_credit')}</th>
            </tr>
          </thead>
          <tbody>
            {model.accountLines.map((l, i) => (
              <tr key={i}>
                <td className="ltr">{l.accountCode}</td>
                <td className="qd-name">{L.name(l.accountName)}{l.description && <div className="qd-muted">{l.description}</div>}</td>
                <td className="qd-num num">{l.debit ? money(l.debit) : ''}</td>
                <td className="qd-num num">{l.credit ? money(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="qd-bottom">
        <div className="qd-words">
          {L.digitsOf(amountInWords(model.total, model.currency, L.lang))}
        </div>
        <dl className="qd-totals">
          {items && model.discount > 0 && <><dt>{plain('pd_h_subtotal')}</dt><dd className="num">{money(model.subtotal)}</dd></>}
          {items && model.discount > 0 && <><dt>{head('discount')}</dt><dd className="num">{money(model.discount)}</dd></>}
          <dt className="qd-grand">{head('total')}</dt><dd className="qd-grand num">{money(model.total)}</dd>
          {usdLine && <><dt>{head('usdEquivalent')}</dt><dd className="num">{money(usdLine.amount, usdLine.currency)}</dd></>}
          {show.partyBalance && model.partyBalance !== null && <><dt>{head('partyBalance')}</dt><dd className="num">{money(model.partyBalance, 'IQD')}</dd></>}
        </dl>
      </div>

      {model.notes && <div className="qd-notes">{model.notes}</div>}
      {show.terms && terms && <div className="qd-terms"><div className="qd-block-title">{head('terms')}</div>{terms}</div>}
      {show.bankDetails && design.bankDetails && <div className="qd-bank"><div className="qd-block-title">{head('bankDetails')}</div>{design.bankDetails}</div>}

      {(show.signatures || show.stamp || (show.qr && model.verifyInvoiceId)) && (
        <div className="qd-sign-row">
          {show.qr && model.verifyInvoiceId && (preview || model.verifyInvoiceId === 'sample' ? <SampleQr /> : <InvoiceQr invoiceId={model.verifyInvoiceId} size={receipt ? 84 : 96} />)}
          {show.signatures && (
            <>
              <div className="qd-sig"><div className="qd-muted">{head('preparedBy')}</div><div className="qd-sig-name">{model.preparedBy}</div></div>
              <div className="qd-sig"><div className="qd-muted">{head('receivedBy')}</div><div className="qd-sig-name">&nbsp;</div></div>
            </>
          )}
          {show.stamp && <div className="qd-stamp">{head('stamp')}</div>}
        </div>
      )}

      {(profile?.footer || branding) && (
        <footer className="qd-foot">
          {profile?.footer && <div>{profile.footer}</div>}
          {/* Required on Free by the license (NOTICE, additional term 1); Pro and Business remove it. */}
          {branding && <div className="qd-made">{L.t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
        </footer>
      )}
    </div>
  );
}

function SampleQr() {
  const qr = useMemo(() => qrSvgPath(encodeQr('https://qasaerp.com/v/sample', 'M'), 2), []);
  return <svg className="qd-qr" width={84} height={84} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" aria-hidden="true"><path d={qr.path} fill="#000" /></svg>;
}

function MiniBarcode({ code }: { code: string }) {
  const b = useMemo(() => barcodeFor(code), [code]);
  if (!b) return <span className="ltr">{code}</span>;
  return (
    <span className="qd-barcode">
      <svg viewBox={`0 0 ${b.modules} 20`} preserveAspectRatio="none" aria-hidden="true"><path d={barsPath(b.widths, 20)} fill="#000" /></svg>
      <span className="ltr">{b.text}</span>
    </span>
  );
}

/**
 * What a page puts in its print-only area: the paper drawn with the design saved for its kind (or the one it
 * follows), the company's header and the app's language. Shown only when printed; the screen keeps its own view.
 */
export function DesignedPrint({ model, designs, balanceOf }: {
  model: PrintModel;
  designs?: PrintDesigns;
  /** the party whose balance (as of the paper's date) prints when the design shows it */
  balanceOf?: { partyId: string; date: string } | null;
}) {
  const setup = usePrintSetup();
  const { settings, plan } = useData();
  const design = designFor(designs ?? setup.designs, model.doc);
  const [balance, setBalance] = useState<number | null>(null);
  const [barcodes, setBarcodes] = useState<Map<string, string> | null>(null);
  const wantBalance = design.show.partyBalance && balanceOf ? `${balanceOf.partyId}@${balanceOf.date}` : '';
  const wantBarcodes = design.show.barcode && model.lines.some((l) => l.itemId && !l.barcode);

  useEffect(() => {
    if (!wantBalance || !balanceOf) { setBalance(null); return; }
    let live = true;
    api.partyStatement(balanceOf.partyId, undefined, balanceOf.date).then((st) => { if (live) setBalance(st.closing); }, () => { if (live) setBalance(null); });
    return () => { live = false; };
  }, [wantBalance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wantBarcodes || barcodes) return;
    let live = true;
    api.items().then((list) => { if (live) setBarcodes(new Map(list.filter((it) => it.barcode).map((it) => [it.id, it.barcode]))); }, () => undefined);
    return () => { live = false; };
  }, [wantBarcodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const filled: PrintModel = {
    ...model,
    partyBalance: model.partyBalance ?? balance,
    lines: barcodes ? model.lines.map((l) => (l.barcode || !l.itemId ? l : { ...l, barcode: barcodes.get(l.itemId) ?? null })) : model.lines
  };
  return (
    <div className="print-only qd-print-host">
      <PrintDocument
        model={filled} design={design} profile={setup.profile} company={settings?.companyName ?? { ar: '', en: '', ku: '' }}
        branding={!plan?.features.includes('noBranding')} defaultRateX100={settings?.defaultRateX100}
      />
    </div>
  );
}

/**
 * The company's header alone (logo, name, address, phone, tax number) and its footer line, for papers that aren't
 * designed documents — account statements and reports — so every printed paper carries the same letterhead.
 */
export function CompanyPrintHeader({ title, children }: { title?: string; children?: ReactNode }) {
  const i18n = useI18n();
  const setup = usePrintSetup();
  const { settings } = useData();
  const design = designFor(setup.designs, 'sale');
  const profile = setup.profile;
  const logo = profile?.showLogo ? logoUrl(profile.logo) : null;
  return (
    <div className="print-only"><div className={`qd-paper qd-${design.layout} qd-logo-${design.logo.position} qd-letterhead`} dir={i18n.dir}
      style={{ '--qd-accent': design.accent, '--qd-logo-h': `${design.logo.heightMm}mm` } as CSSProperties}>
      <header className="qd-head">
        {logo && <img className="qd-logo" src={logo} alt="" />}
        <div className="qd-company">
          <div className="qd-company-name">{settings ? i18n.name(settings.companyName) : ''}</div>
          {profile?.address && <div>{profile.address}</div>}
          {(profile?.phone || profile?.taxNumber) && (
            <div className="qd-company-meta">
              {profile?.phone && <span className="ltr">{profile.phone}</span>}
              {profile?.taxNumber && <span>{i18n.t('pp_taxShort')}: <span className="ltr">{profile.taxNumber}</span></span>}
            </div>
          )}
        </div>
      </header>
      {title && <div className="qd-title">{title}</div>}
      {children}
    </div></div>
  );
}

export function CompanyPrintFooter() {
  const setup = usePrintSetup();
  const footer = setup.profile?.footer;
  return footer ? <div className="print-only qd-foot qd-letterfoot">{footer}</div> : null;
}
