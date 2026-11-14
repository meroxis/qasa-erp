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
import { balanceLabelKey, balancesAround, type PrintBalanceOf, type PrintModel } from './print-model.ts';
import './print-design.css';

/**
 * Draws a paper the way its print design says: layout, paper, colour, sizes, logo, which parts show, renamed
 * headings and a second language. Every text from the design or the document is put in as text (React escapes it):
 * nothing is ever read as HTML. The page's own @page size and margins come from the design while it is printed.
 *
 * What the design shows but the page did not hand over is fetched here, for every page that prints: the party's
 * balance before and after the paper (from the party's statement) and the items' barcodes.
 */

const noop = () => {};

export function paperI18n(lang: Lang, digits: I18n['digits']): I18n {
  return makeI18n(lang, digits, noop, noop);
}

const DEFAULT_LABEL: Record<PrintLabel, Key> = {
  title: 'pd_h_title', itemCode: 'pd_h_code', barcode: 'pd_h_barcode', item: 'pd_h_item', unit: 'pd_h_unit', qty: 'pd_h_qty',
  price: 'pd_h_price', discount: 'pd_h_discount', amount: 'pd_h_amount', total: 'pd_h_total', usdEquivalent: 'pd_h_usd',
  partyBalance: 'pd_h_balance', preparedBy: 'pd_h_preparedBy', receivedBy: 'pd_h_receivedBy', stamp: 'pd_h_stamp',
  bankDetails: 'pd_h_bank', terms: 'pd_h_terms', previousBalance: 'pd_h_previousBalance'
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
  /** true in the designer: a sample QR code, no @page rule, nothing fetched */
  preview?: boolean;
}

/**
 * The paper with what its design shows filled in: the party's two balances when the design prints either and the
 * page left them empty, and the barcodes when the design prints them. Nothing is asked for in the designer's preview.
 */
export function usePaperData(model: PrintModel, design: PrintDesign, live: boolean): PrintModel {
  const of: PrintBalanceOf | null = model.balanceOf ?? null;
  const wantBalance = live && of && model.partyBalance === null && (design.show.partyBalance || design.show.previousBalance)
    ? `${of.partyId}@${of.date}@${of.invoiceId ?? ''}@${(of.entryIds ?? []).join(',')}@${of.rawEffect ?? ''}` : '';
  const wantBarcodes = live && design.show.barcode && design.layout !== 'receipt80' && model.lines.some((l) => l.itemId && !l.barcode);
  const [balance, setBalance] = useState<{ key: string; previous: number | null; after: number } | null>(null);
  const [barcodes, setBarcodes] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    if (!wantBalance || !of) { setBalance(null); return; }
    let on = true;
    api.partyStatement(of.partyId, undefined, of.date).then(
      (st) => { if (on) setBalance({ key: wantBalance, ...balancesAround(st, of) }); },
      () => { if (on) setBalance(null); }
    );
    return () => { on = false; };
  }, [wantBalance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wantBarcodes || barcodes) return;
    let on = true;
    api.items().then((list) => { if (on) setBarcodes(new Map(list.filter((it) => it.barcode).map((it) => [it.id, it.barcode]))); }, () => undefined);
    return () => { on = false; };
  }, [wantBarcodes]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const found = balance && balance.key === wantBalance ? balance : null;
    if (!found && !(barcodes && wantBarcodes)) return model;
    return {
      ...model,
      partyBalance: found ? found.after : model.partyBalance,
      previousBalance: found ? found.previous : model.previousBalance,
      lines: barcodes && wantBarcodes ? model.lines.map((l) => (l.barcode || !l.itemId ? l : { ...l, barcode: barcodes.get(l.itemId) ?? null })) : model.lines
    };
  }, [model, balance, barcodes, wantBalance, wantBarcodes]);
}

interface TotalRow { key: string; label: ReactNode; value: string; grand?: boolean; strong?: boolean }

export function PrintDocument({ model: given, design, profile, company, lang, branding, defaultRateX100, preview = false }: PrintDocumentProps) {
  const app = useI18n();
  const L = useMemo(() => paperI18n(lang ?? app.lang, app.digits), [lang, app.lang, app.digits]);
  const second = useMemo(() => (design.secondLang && design.secondLang !== L.lang ? paperI18n(design.secondLang, app.digits) : null), [design.secondLang, L.lang, app.digits]);
  const model = usePaperData(given, design, !preview);
  const show = design.show;
  const receipt = design.layout === 'receipt80';
  const band = design.layout === 'modernLines';
  const ledger = design.layout === 'ledger';

  /** a heading in the paper's language (or the design's own name for it), with the second language beside or under it */
  const head = (label: PrintLabel, key: Key = DEFAULT_LABEL[label]): ReactNode => (
    <>
      {design.labels[label] || L.t(key)}
      {second && <span className="qd-second" dir={second.dir}>{second.t(key)}</span>}
    </>
  );
  const plain = (key: string): ReactNode => (isKey(key) ? <>{L.t(key)}{second && <span className="qd-second" dir={second.dir}>{second.t(key)}</span>}</> : key);

  const money = (amount: number, currency: CurrencyCode = model.currency) => L.money(amount, currency);
  const itemName = (n: Names | string) => (typeof n === 'string' ? n : L.name(n));
  const items = model.lines.length > 0;
  // the other currency: a USD paper in dinars at its rate, a dinar paper in dollars at the company's rate
  const usdLine = !show.usdEquivalent ? null : model.currency === 'USD'
    ? { currency: 'IQD' as CurrencyCode, amount: model.baseTotal || toBase(model.total, 'USD', model.rateX100) }
    : defaultRateX100 && defaultRateX100 > 0 ? { currency: 'USD' as CurrencyCode, amount: roundHalfUp((model.total * 10000) / defaultRateX100) } : null;
  // the logo: the company's (a paid plan's; the server hands none out otherwise), printed when the header and the design both say so
  const logo = profile?.showLogo && show.logo ? logoUrl(profile.logo) : null;
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

  const address = show.companyAddress ? profile?.address : '';
  const phone = show.companyPhone ? profile?.phone : '';
  const taxNumber = show.companyTax ? profile?.taxNumber : '';
  const companyBlock = (
    <div className="qd-company">
      <div className="qd-company-name">{L.name(company)}</div>
      {address && <div>{address}</div>}
      {(phone || taxNumber) && (
        <div className="qd-company-meta">
          {phone && <span className="ltr">{phone}</span>}
          {taxNumber && <span>{L.t('pp_taxShort')}: <span className="ltr">{taxNumber}</span></span>}
        </div>
      )}
    </div>
  );

  const titleKey: Key = isKey(model.titleKey) ? model.titleKey : 'pd_h_title';
  const marks = (
    <>
      {model.status === 'cancelled' && <span className="qd-stamp-cancelled">{L.t('cancelled')}</span>}
      {model.status === 'draft' && <span className="qd-draft">{L.t('draft')}</span>}
    </>
  );
  const title = (
    <>
      {design.labels.title || L.t(titleKey)}
      {second && isKey(model.titleKey) && <span className="qd-second" dir={second.dir}>{second.t(model.titleKey)}</span>}
      {marks}
    </>
  );
  const number = model.number ?? L.t('draft');
  const rate = show.exchangeRate && model.currency === 'USD' && model.rateX100 !== 100 ? L.digitsOf(String(rateFromX100(model.rateX100))) : null;
  const partyPhone = show.partyPhone && model.party?.phone ? L.digitsOf(model.party.phone) : '';
  const partyAddress = show.partyAddress && model.party?.address ? model.party.address : '';

  /** number, date, valid until, rate: what stands beside the title (or in the ledger's box) */
  const meta: { key: string; label: ReactNode; value: ReactNode; cls: string }[] = [
    { key: 'number', label: plain('pd_h_number'), value: number, cls: 'ltr' },
    { key: 'date', label: plain('pd_h_date'), value: L.date(model.date), cls: 'num' },
    ...(model.validUntil ? [{ key: 'valid', label: plain('pd_h_validUntil'), value: L.date(model.validUntil), cls: 'num' }] : []),
    ...(rate ? [{ key: 'rate', label: plain('pd_h_rate'), value: rate, cls: 'num' }] : [])
  ];

  const balanceKey: Key = balanceLabelKey(model.doc);
  const previousRow: TotalRow | null = show.previousBalance && model.previousBalance !== null
    ? { key: 'previous', label: head('previousBalance'), value: money(model.previousBalance, 'IQD') } : null;
  const afterRow: TotalRow | null = show.partyBalance && model.partyBalance !== null
    ? { key: 'after', label: head('partyBalance', balanceKey), value: money(model.partyBalance, 'IQD'), strong: true } : null;
  const totals: TotalRow[] = [
    ...(items && show.subtotal && model.discount > 0 ? [
      { key: 'subtotal', label: plain('pd_h_subtotal'), value: money(model.subtotal) },
      { key: 'discount', label: head('discount'), value: money(model.discount) }
    ] : []),
    // a voucher reads: what was owed, what was received or paid, what is left
    ...(previousRow && model.doc === 'voucher' ? [previousRow] : []),
    { key: 'total', label: head('total'), value: money(model.total), grand: true },
    ...(usdLine ? [{ key: 'usd', label: head('usdEquivalent'), value: money(usdLine.amount, usdLine.currency) }] : []),
    // a till's cash sale: what the customer handed over and the change, on the first print and on every later one
    ...(model.tender ? [
      { key: 'tender-paid', label: plain('pos_paid'), value: money(model.tender.paid) },
      { key: 'tender-change', label: plain('pos_change'), value: money(model.tender.change) }
    ] : []),
    ...(previousRow && model.doc !== 'voucher' ? [previousRow] : []),
    ...(afterRow ? [afterRow] : [])
  ];
  const words = show.amountWords ? L.digitsOf(amountInWords(model.total, model.currency, L.lang)) : '';
  const notes = show.notes ? model.notes : '';

  return (
    <div
      className={`qd-paper qd-${design.layout} qd-${design.paper.toLowerCase()} qd-logo-${design.logo.position}${preview ? ' qd-preview' : ''}`}
      style={style} dir={L.dir} lang={L.lang === 'ku' ? 'ckb' : L.lang} data-doc={model.doc}
    >
      {pageRule && <style>{pageRule}</style>}

      {band ? (
        // Modern with lines: one band of colour carries the logo, the company and the paper's title and number
        <header className="qd-head qd-band">
          {logo && <img className="qd-logo" src={logo} alt="" />}
          {companyBlock}
          <div className="qd-band-title">
            <div className="qd-title">{title}</div>
            <div className="qd-band-no ltr">{number}</div>
          </div>
        </header>
      ) : (
        <header className="qd-head">
          {logo && <img className="qd-logo" src={logo} alt="" />}
          {companyBlock}
          {/* Classic ledger: the company's name again in the second language, on the other side */}
          {ledger && second && <div className="qd-company qd-company-2" dir={second.dir} lang={second.lang === 'ku' ? 'ckb' : second.lang}><div className="qd-company-name">{second.name(company)}</div></div>}
        </header>
      )}

      {band && (
        <div className="qd-info">
          {model.party && (
            <div className="qd-info-col qd-info-party">
              <div className="qd-info-label">{plain(partyKey)}</div>
              <div className="qd-party-name">{model.party.name}{model.party.code && <span className="qd-muted"> · <span className="ltr qd-nb">{model.party.code}</span></span>}</div>
              {partyPhone && <div className="qd-muted"><span className="ltr">{partyPhone}</span></div>}
              {partyAddress && <div className="qd-muted">{partyAddress}</div>}
            </div>
          )}
          {meta.filter((m) => m.key !== 'number').map((m) => (
            <div className="qd-info-col" key={m.key}>
              <div className="qd-info-label">{m.label}</div>
              <div className={`qd-info-value ${m.cls}`}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {ledger && (
        <>
          <div className="qd-title qd-title-center">{title}</div>
          <dl className="qd-box">
            {meta.map((m) => <div className="qd-box-row" key={m.key}><dt>{m.label}</dt><dd className={m.cls}>{m.value}</dd></div>)}
            {model.party && <div className="qd-box-row"><dt>{plain(partyKey)}</dt><dd>{model.party.name}{model.party.code && <span className="qd-muted"> · <span className="ltr qd-nb">{model.party.code}</span></span>}</dd></div>}
            {partyPhone && <div className="qd-box-row"><dt>{plain('pd_h_phone')}</dt><dd><span className="ltr">{partyPhone}</span></dd></div>}
            {partyAddress && <div className="qd-box-row"><dt>{plain('pd_h_address')}</dt><dd>{partyAddress}</dd></div>}
          </dl>
        </>
      )}

      {!band && !ledger && (
        <>
          <div className="qd-title-row">
            <div className="qd-title">{title}</div>
            <dl className="qd-meta">
              {meta.map((m) => <FragmentRow key={m.key} label={m.label} value={m.value} cls={m.cls} />)}
            </dl>
          </div>
          {model.party && (
            <div className="qd-party">
              <div className="qd-party-label">{plain(partyKey)}</div>
              <div className="qd-party-name">{model.party.name}{model.party.code && <span className="qd-muted"> · <span className="ltr qd-nb">{model.party.code}</span></span>}</div>
              {(partyPhone || partyAddress) && <div className="qd-muted">{partyPhone && <span className="ltr">{partyPhone}</span>}{partyPhone && partyAddress ? ' · ' : ''}{partyAddress}</div>}
            </div>
          )}
        </>
      )}

      {items && !receipt && (
        <table className="qd-table qd-items">
          <thead>
            <tr>
              <th className="qd-n">#</th>
              {show.itemImage && <th className="qd-img" />}
              {show.itemCode && <th className="qd-code">{head('itemCode')}</th>}
              <th className="qd-name">{head('item')}</th>
              {show.barcode && <th className="qd-bc">{head('barcode')}</th>}
              {show.unit && <th className="qd-unit">{head('unit')}</th>}
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
                {show.itemCode && <td className="qd-code"><span className="ltr">{l.code ?? ''}</span></td>}
                <td className="qd-name">{itemName(l.name)}{l.description && <div className="qd-muted">{l.description}</div>}</td>
                {show.barcode && <td className="qd-bc">{l.barcode && <MiniBarcode code={l.barcode} />}</td>}
                {show.unit && <td className="qd-unit">{l.unit ? unitName(L, l.unit) : ''}</td>}
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
              <div className="qd-rname">{itemName(l.name)}{show.itemCode && l.code && <span className="qd-muted"> · <span className="ltr qd-nb">{l.code}</span></span>}</div>
              <div className="qd-rcalc num">
                <span>{qtyText(L, l.qtyMilli)}{show.unit && l.unit ? ` ${unitName(L, l.unit)}` : ''} × {money(l.unitPrice)}</span>
                <strong>{money(l.amount)}</strong>
              </div>
            </div>
          ))}
        </div>
      )}

      {model.accountLines.length > 0 && (
        <table className="qd-table qd-accounts">
          <thead>
            <tr>
              <th className="qd-code">{plain('pd_h_accountCode')}</th><th className="qd-name">{plain('pd_h_account')}</th>
              <th className="qd-num">{plain('pd_h_debit')}</th><th className="qd-num">{plain('pd_h_credit')}</th>
            </tr>
          </thead>
          <tbody>
            {model.accountLines.map((l, i) => (
              <tr key={i}>
                <td className="qd-code"><span className="ltr">{l.accountCode}</span></td>
                <td className="qd-name">{L.name(l.accountName)}{l.description && <div className="qd-muted">{l.description}</div>}</td>
                <td className="qd-num num">{l.debit ? money(l.debit) : ''}</td>
                <td className="qd-num num">{l.credit ? money(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ledger ? (
        // Classic ledger: the totals are ruled like the table and joined to it, the amount in words beside them
        <table className="qd-table qd-tot-table">
          <tbody>
            {totals.map((r, i) => (
              <tr key={r.key} className={r.grand ? 'qd-grand' : r.strong ? 'qd-strong' : undefined}>
                {i === 0 && (
                  <td className="qd-words-cell" rowSpan={totals.length}>
                    {words && <><span className="qd-words-label">{plain('pd_h_words')}: </span>{words}</>}
                  </td>
                )}
                <td className="qd-tot-label">{r.label}</td>
                <td className="qd-num num">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="qd-bottom">
          {(words || !receipt) && (
            <div className="qd-words">
              {words && <><div className="qd-words-label">{plain('pd_h_words')}</div>{words}</>}
            </div>
          )}
          <dl className="qd-totals">
            {totals.map((r) => {
              const cls = r.grand ? 'qd-grand' : r.strong ? 'qd-strong' : '';
              return <FragmentRow key={r.key} label={r.label} value={r.value} cls={`num ${cls}`} labelCls={cls} />;
            })}
          </dl>
        </div>
      )}

      {notes && <div className="qd-notes">{notes}</div>}
      {show.terms && terms && <div className="qd-terms"><div className="qd-block-title">{head('terms')}</div>{terms}</div>}
      {show.bankDetails && design.bankDetails && <div className="qd-bank"><div className="qd-block-title">{head('bankDetails')}</div>{design.bankDetails}</div>}

      {(show.signatures || show.stamp || (show.qr && model.verifyInvoiceId)) && (
        <div className="qd-sign-row">
          {show.qr && model.verifyInvoiceId && (preview || model.verifyInvoiceId === 'sample' ? <SampleQr /> : <InvoiceQr invoiceId={model.verifyInvoiceId} size={receipt ? 84 : 96} />)}
          {show.signatures && (
            <>
              <div className="qd-sig qd-sig-1"><div className="qd-muted">{head('preparedBy')}</div><div className="qd-sig-name">{model.preparedBy}</div></div>
              <div className="qd-sig qd-sig-2"><div className="qd-muted">{head('receivedBy')}</div><div className="qd-sig-name">&nbsp;</div></div>
            </>
          )}
          {show.stamp && <div className="qd-stamp"><span>{head('stamp')}</span></div>}
        </div>
      )}

      {(profile?.footer || branding) && (
        <footer className="qd-foot">
          {profile?.footer && <div>{profile.footer}</div>}
          {/* Required on Free by the license (NOTICE, additional term 1); the paid plans remove it. */}
          {branding && <div className="qd-made">{L.t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
        </footer>
      )}
    </div>
  );
}

/** A heading and its value as a <dt>/<dd> pair. */
function FragmentRow({ label, value, cls, labelCls }: { label: ReactNode; value: ReactNode; cls: string; labelCls?: string }) {
  return <><dt className={labelCls || undefined}>{label}</dt><dd className={cls.trim() || undefined}>{value}</dd></>;
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
  /** the party whose balance prints when the design shows it, for a model that does not say so itself */
  balanceOf?: { partyId: string; date: string } | null;
}) {
  const setup = usePrintSetup();
  const { settings, plan } = useData();
  const design = designFor(designs ?? setup.designs, model.doc);
  const filled: PrintModel = model.balanceOf === undefined && balanceOf ? { ...model, balanceOf } : model;
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
  const show = design.show;
  const logo = profile?.showLogo && show.logo ? logoUrl(profile.logo) : null;
  const address = show.companyAddress ? profile?.address : '';
  const phone = show.companyPhone ? profile?.phone : '';
  const taxNumber = show.companyTax ? profile?.taxNumber : '';
  return (
    <div className="print-only"><div className={`qd-paper qd-${design.layout} qd-logo-${design.logo.position} qd-letterhead`} dir={i18n.dir}
      style={{ '--qd-accent': design.accent, '--qd-logo-h': `${design.logo.heightMm}mm` } as CSSProperties}>
      <header className="qd-head">
        {logo && <img className="qd-logo" src={logo} alt="" />}
        <div className="qd-company">
          <div className="qd-company-name">{settings ? i18n.name(settings.companyName) : ''}</div>
          {address && <div>{address}</div>}
          {(phone || taxNumber) && (
            <div className="qd-company-meta">
              {phone && <span className="ltr">{phone}</span>}
              {taxNumber && <span>{i18n.t('pp_taxShort')}: <span className="ltr">{taxNumber}</span></span>}
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
