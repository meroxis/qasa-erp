import type { Statement } from '../api';
import { dateText, isRtl, money, nameIn, qty, translate, type Key, type Lang } from '../i18n';
import { encodeQr, qrSvgPath } from '../qr';
import type { InvoiceDetail, InvoiceQr, PrintDesign, PrintProfile } from './api';

/**
 * A customer's invoice or statement as a page of HTML that the phone prints to an A4 PDF (expo-print), in the file's
 * language, with the company's print look as far as the phone can follow it: its name, address, phone, tax number,
 * footer and logo from Settings → Printing, and the sale invoice's design (the Classic ledger in black and white with
 * every cell ruled and a stamp box, or the classic look in the design's colour). Not on the phone: the amount in words,
 * item pictures, page numbers.
 *
 * The page is made only of what the office sent, every text escaped: no script, no address to load anything from (its
 * content security policy allows only the page's own styles and data: images and fonts).
 */

/** The bundled fonts, as base64 TrueType (the app's own Noto Sans Arabic and IBM Plex Sans; the OFL allows embedding). */
export interface PdfFonts { arabicRegular: string; arabicBold: string; latinRegular: string; latinBold: string }

export interface PdfLook {
  /** the company's name in the file's language */
  company: string;
  profile: Pick<PrintProfile, 'address' | 'phone' | 'taxNumber' | 'footer' | 'showLogo' | 'logo'> | null;
  /** the sale invoice's design (designFor: the sale design, else the program's) */
  design: PrintDesign | null;
  fonts?: PdfFonts | null | undefined;
}

export const DEFAULT_ACCENT = '#1f4e79';
export const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** The parts of the paper a design shows or hides (what the design leaves unsaid: as the program's design prints it). */
const SHOW_DEFAULTS: Record<string, boolean> = {
  logo: true, companyAddress: true, companyPhone: true, companyTax: true, partyPhone: true, notes: true, qr: true, exchangeRate: true, stamp: false
};

/** Every text that goes on the page: nothing in it is read as HTML. */
export function esc(text: unknown): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The design's colour, only when it is one (#rrggbb, the office's own check): it goes into the page's styles. */
export const accentOf = (design: PrintDesign | null): string => (design && /^#[0-9a-f]{6}$/i.test(design.accent) ? design.accent : DEFAULT_ACCENT);

/** The logo as a data: URL, only a PNG, JPEG or WebP the office sent as base64; anything else is left out. */
export function logoUrl(logo: { mime: string; data: string } | null | undefined): string | null {
  if (!logo || !/^image\/(png|jpeg|webp)$/.test(logo.mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(logo.data)) return null;
  return `data:${logo.mime};base64,${logo.data}`;
}

const isLedger = (design: PrintDesign | null) => design?.layout === 'ledger';

function shown(design: PrintDesign | null, field: string): boolean {
  const own = design?.show?.[field];
  if (typeof own === 'boolean') return own;
  // the Classic ledger has its stamp box
  if (field === 'stamp') return isLedger(design);
  return SHOW_DEFAULTS[field] ?? true;
}

/** The units the app has words for; any other unit is left unnamed rather than written in the office's code. */
const UNIT_WORDS: readonly string[] = ['piece', 'box', 'carton', 'kg', 'm', 'service'];
const unitWord = (lang: Lang, unit: string | null | undefined) => (unit && UNIT_WORDS.includes(unit) ? translate(lang, unit as Key) : '');

/** A dollar rate as stored (dinars per $1, × 100), as the desktop writes it: 1,475 or 1,475.5. */
export function rateText(rateX100: number): string {
  const whole = Math.floor(rateX100 / 100);
  const cents = String(rateX100 % 100).padStart(2, '0').replace(/0+$/, '');
  return `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cents ? `.${cents}` : ''}`;
}

function fontFaces(fonts: PdfFonts | null | undefined): string {
  if (!fonts) return '';
  const ok = (b: string) => /^[A-Za-z0-9+/]+={0,2}$/.test(b);
  if (![fonts.arabicRegular, fonts.arabicBold, fonts.latinRegular, fonts.latinBold].every(ok)) return '';
  const arabic = 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F';
  const face = (data: string, weight: number, range: string) =>
    `@font-face{font-family:'Qasa';src:url(data:font/ttf;base64,${data}) format('truetype');font-weight:${weight};unicode-range:${range};}`;
  return face(fonts.latinRegular, 400, 'U+0000-05FF, U+2000-206F, U+20A0-20CF, U+2100-214F')
    + face(fonts.latinBold, 700, 'U+0000-05FF, U+2000-206F, U+20A0-20CF, U+2100-214F')
    + face(fonts.arabicRegular, 400, arabic) + face(fonts.arabicBold, 700, arabic);
}

function styles(look: PdfLook): string {
  const accent = accentOf(look.design);
  const ledger = isLedger(look.design);
  const ink = ledger ? '#000000' : '#1b1f24';
  return `${fontFaces(look.fonts)}
@page{size:A4;margin:14mm;}
*{box-sizing:border-box;}
body{margin:0;font-family:'Qasa','Noto Sans Arabic','Noto Naskh Arabic',sans-serif;font-size:10pt;color:${ink};line-height:1.45;}
.head{display:flex;gap:12px;align-items:flex-start;padding-bottom:8px;margin-bottom:10px;border-bottom:${ledger ? '1.5px solid #000' : `3px solid ${accent}`};}
.head img{max-height:18mm;max-width:45mm;object-fit:contain;}
.company{flex:1;}
.company .name{font-size:15pt;font-weight:700;${ledger ? '' : `color:${accent};`}}
.muted{color:${ledger ? '#000' : '#5b6470'};font-size:9pt;}
h1{font-size:14pt;margin:4px 0 8px;${ledger ? 'text-align:center;border:1.5px solid #000;padding:4px;' : `color:${accent};`}}
.meta{display:flex;flex-wrap:wrap;gap:4px 18px;margin-bottom:8px;}
.meta div span{color:${ledger ? '#000' : '#5b6470'};}
table{width:100%;border-collapse:collapse;margin:6px 0;}
th{text-align:start;font-weight:700;padding:5px 6px;${ledger ? 'border:1px solid #000;background:#fff;color:#000;' : `background:${accent};color:#fff;`}}
td{padding:5px 6px;vertical-align:top;${ledger ? 'border:1px solid #000;' : 'border-bottom:1px solid #d9dde3;'}}
.num{text-align:end;white-space:nowrap;}
.totals{margin-inline-start:auto;width:55%;}
.totals td{${ledger ? 'border:1px solid #000;' : 'border-bottom:1px solid #d9dde3;'}}
.totals tr.grand td{font-weight:700;font-size:11.5pt;${ledger ? '' : `border-top:2px solid ${accent};`}}
.notes{margin-top:8px;}
.qr{display:flex;gap:10px;align-items:center;margin-top:12px;}
.qr svg{width:26mm;height:26mm;flex-shrink:0;background:#fff;}
.stamp{margin-top:14px;margin-inline-start:auto;width:60mm;height:30mm;border:1.5px ${ledger ? 'solid #000' : 'dashed #8a93a0'};padding:4px;font-size:9pt;}
.foot{margin-top:14px;padding-top:6px;border-top:1px solid ${ledger ? '#000' : '#d9dde3'};text-align:center;}`;
}

function page(lang: Lang, look: PdfLook, title: string, body: string): string {
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  return `<!DOCTYPE html><html lang="${lang === 'ku' ? 'ckb' : lang}" dir="${dir}"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${styles(look)}</style></head>`
    + `<body dir="${dir}">${body}</body></html>`;
}

function header(lang: Lang, look: PdfLook): string {
  const t = (k: Key) => translate(lang, k);
  const p = look.profile;
  const logo = p && p.showLogo && shown(look.design, 'logo') ? logoUrl(p.logo) : null;
  const lines = [
    p?.address && shown(look.design, 'companyAddress') ? `<div class="muted">${esc(p.address)}</div>` : '',
    p?.phone && shown(look.design, 'companyPhone') ? `<div class="muted">${esc(t('pdfPhone'))}: <bdi>${esc(p.phone)}</bdi></div>` : '',
    p?.taxNumber && shown(look.design, 'companyTax') ? `<div class="muted">${esc(t('pdfTax'))}: <bdi>${esc(p.taxNumber)}</bdi></div>` : ''
  ].join('');
  return `<div class="head">${logo ? `<img src="${logo}" alt="">` : ''}<div class="company"><div class="name">${esc(look.company)}</div>${lines}</div></div>`;
}

function footer(look: PdfLook): string {
  return look.profile?.footer ? `<div class="foot muted">${esc(look.profile.footer)}</div>` : '';
}

const row = (label: string, value: string, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;

/** The QR code of a posted sale invoice, as the PC prints it, with the caption its plan makes true (InvoiceQr.tsx). */
function qrBlock(lang: Lang, qr: InvoiceQr | null): string {
  if (!qr || !/^https:\/\/[^\s"'<>]{1,2000}$/.test(qr.url)) return '';
  const { path, size } = qrSvgPath(encodeQr(qr.url, 'M'), 2);
  return `<div class="qr"><svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"><path d="${path}" fill="#000"/></svg>`
    + `<div class="muted">${esc(translate(lang, qr.licensed ? 'pdfQrVerified' : 'pdfQrDetails'))}</div></div>`;
}

const stampBox = (lang: Lang, design: PrintDesign | null) => (shown(design, 'stamp') ? `<div class="stamp">${esc(translate(lang, 'pdfStamp'))}</div>` : '');

/** A posted sale invoice as a page for the PDF. */
export function invoiceHtml(lang: Lang, look: PdfLook, inv: InvoiceDetail, qr: InvoiceQr | null): string {
  const t = (k: Key, v?: Record<string, string | number>) => translate(lang, k, v);
  const m = (n: number) => money(n, inv.currency, lang);
  const meta = [
    `<div><span>${esc(t('pdfNumber'))}:</span> <b><bdi>${esc(inv.number ?? '—')}</bdi></b></div>`,
    `<div><span>${esc(t('date'))}:</span> <b>${esc(dateText(inv.date))}</b></div>`,
    `<div><span>${esc(t('payment'))}:</span> <b>${esc(t(inv.payment === 'credit' ? 'payCredit' : 'payCash'))}</b></div>`,
    inv.currency === 'USD' && shown(look.design, 'exchangeRate') ? `<div><span>${esc(t('pdfRate'))}:</span> <b>${esc(`$1 = ${rateText(inv.rateX100)}`)}</b></div>` : ''
  ].join('');
  const customer = inv.partyName
    ? `<div class="meta"><div><span>${esc(t('customer'))}:</span> <b>${esc(inv.partyName)}</b></div>`
      + (inv.partyPhone && shown(look.design, 'partyPhone') ? `<div><span>${esc(t('pdfPhone'))}:</span> <bdi>${esc(inv.partyPhone)}</bdi></div>` : '') + '</div>'
    : '';
  const lines = inv.lines.map((l, i) => {
    const typed = l.lineUnit && l.unitQtyMilli !== null;
    const quantity = `${qty(typed ? l.unitQtyMilli! : l.qtyMilli)} ${unitWord(lang, typed ? l.lineUnit : l.unit)}`.trim();
    const name = nameIn(lang, l.itemName) || l.description;
    return `<tr><td class="num">${i + 1}</td><td>${esc(name)}</td><td class="num">${esc(quantity)}</td><td class="num">${esc(m(l.unitPrice))}</td><td class="num">${esc(m(l.amount))}</td></tr>`;
  }).join('');
  const totals = [
    inv.discount > 0 ? row(t('pdfSubtotal'), m(inv.subtotal)) + row(t('pdfDiscount'), m(inv.discount)) : '',
    row(t('total'), m(inv.total), 'grand'),
    inv.payment === 'credit' && inv.settlement ? row(t('pdfPaid'), m(inv.settlement.received)) + row(t('pdfStillOwed'), m(inv.settlement.open)) : ''
  ].join('');
  const notes = inv.notes && shown(look.design, 'notes') ? `<div class="notes"><b>${esc(t('pdfNotes'))}:</b> ${esc(inv.notes)}</div>` : '';
  const body = header(lang, look)
    + `<h1>${esc(t('pdfSaleInvoice'))}</h1><div class="meta">${meta}</div>${customer}`
    + `<table><thead><tr><th class="num">#</th><th>${esc(t('pdfItem'))}</th><th class="num">${esc(t('qty'))}</th><th class="num">${esc(t('price'))}</th><th class="num">${esc(t('amount'))}</th></tr></thead><tbody>${lines}</tbody></table>`
    + `<table class="totals"><tbody>${totals}</tbody></table>`
    + notes + (shown(look.design, 'qr') ? qrBlock(lang, qr) : '') + stampBox(lang, look.design) + footer(look);
  return page(lang, look, `${t('pdfSaleInvoice')} ${inv.number ?? ''}`.trim(), body);
}

/** A customer's statement for a period as a page for the PDF (amounts in dinars, as the phone shows it). */
export function statementHtml(lang: Lang, look: PdfLook, s: Statement, period: { from: string | null; to: string }): string {
  const t = (k: Key, v?: Record<string, string | number>) => translate(lang, k, v);
  const m = (n: number) => money(n, 'IQD', lang);
  const meta = [
    `<div><span>${esc(t('customer'))}:</span> <b>${esc(s.party.name)}</b></div>`,
    s.party.phone && shown(look.design, 'partyPhone') ? `<div><span>${esc(t('pdfPhone'))}:</span> <bdi>${esc(s.party.phone)}</bdi></div>` : '',
    `<div>${esc(period.from ? t('pdfPeriod', { f: dateText(period.from), t: dateText(period.to) }) : dateText(period.to))}</div>`
  ].join('');
  const lines = s.lines.map((l) => `<tr><td class="num">${esc(dateText(l.date))}</td><td><bdi>${esc(l.number)}</bdi></td><td>${esc(l.description)}</td>`
    + `<td class="num">${l.debit ? esc(m(l.debit)) : ''}</td><td class="num">${l.credit ? esc(m(l.credit)) : ''}</td><td class="num">${esc(m(l.balance))}</td></tr>`).join('');
  const body = header(lang, look)
    + `<h1>${esc(t('pdfStatement'))}</h1><div class="meta">${meta}</div>`
    + `<table><thead><tr><th class="num">${esc(t('date'))}</th><th>${esc(t('pdfNumber'))}</th><th>${esc(t('pdfDescription'))}</th><th class="num">${esc(t('debit'))}</th><th class="num">${esc(t('credit'))}</th><th class="num">${esc(t('closing'))}</th></tr></thead>`
    + `<tbody><tr><td colspan="5">${esc(t('opening'))}</td><td class="num">${esc(m(s.opening))}</td></tr>${lines}</tbody></table>`
    + `<table class="totals"><tbody>${row(t('debit'), m(s.totalDebit))}${row(t('credit'), m(s.totalCredit))}${row(t('closing'), m(s.closing), 'grand')}</tbody></table>`
    + stampBox(lang, look.design) + footer(look);
  return page(lang, look, `${t('pdfStatement')} ${s.party.name}`, body);
}
