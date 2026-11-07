import { LANGS, type Lang } from './lang.ts';

/**
 * How printed papers look (the print designer). Pure data, checked the same way on the server (before it is saved)
 * and in the app (before a design file is imported), so a design can never carry anything but these fields.
 *
 * Each kind of paper can have its own design; a kind without one prints like the sale invoice ("same as the sale
 * invoice"), except the POS receipt, which starts from the 80 mm receipt design because a receipt roll isn't A4.
 * Free text (field names, bank details, terms) is printed as text, never as HTML.
 */

export const PRINT_DOCS = ['sale', 'purchase', 'return', 'quote', 'voucher', 'pos'] as const;
export type PrintDoc = (typeof PRINT_DOCS)[number];

export const PRINT_LAYOUTS = ['classic', 'modern', 'compact', 'receipt80'] as const;
export type PrintLayout = (typeof PRINT_LAYOUTS)[number];

export const PRINT_PAPERS = ['A4', 'A5', '80mm'] as const;
export type PrintPaper = (typeof PRINT_PAPERS)[number];

export const LOGO_POSITIONS = ['left', 'center', 'right'] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

/** Parts of the paper that can be shown or hidden. */
export const PRINT_FIELDS = [
  'itemCode', 'barcode', 'itemImage', 'unit', 'discount', 'usdEquivalent', 'partyBalance', 'qr',
  'signatures', 'stamp', 'bankDetails', 'terms', 'pageNumbers'
] as const;
export type PrintField = (typeof PRINT_FIELDS)[number];

/** Headings that can be renamed (an empty or missing name keeps the program's own, in the paper's language). */
export const PRINT_LABELS = [
  'title', 'itemCode', 'barcode', 'item', 'unit', 'qty', 'price', 'discount', 'amount', 'total',
  'usdEquivalent', 'partyBalance', 'preparedBy', 'receivedBy', 'stamp', 'bankDetails', 'terms'
] as const;
export type PrintLabel = (typeof PRINT_LABELS)[number];

export interface PrintDesign {
  layout: PrintLayout;
  paper: PrintPaper;
  /** #rrggbb */
  accent: string;
  /** base text size in points */
  fontSize: number;
  /** page margins in millimetres */
  marginMm: number;
  logo: { position: LogoPosition; heightMm: number };
  show: Record<PrintField, boolean>;
  labels: Partial<Record<PrintLabel, string>>;
  /** a second language printed in small under each heading, or null */
  secondLang: Lang | null;
  bankDetails: string;
  terms: string;
}

export const PRINT_LIMITS = {
  fontSize: [8, 14] as const,
  marginMm: [0, 25] as const,
  logoHeightMm: [6, 40] as const,
  label: 40,
  bankDetails: 300,
  terms: 1000
};

const allShown = (on: PrintField[]): Record<PrintField, boolean> =>
  Object.fromEntries(PRINT_FIELDS.map((f) => [f, on.includes(f)])) as Record<PrintField, boolean>;

export const DEFAULT_PRINT_DESIGN: PrintDesign = {
  layout: 'classic',
  paper: 'A4',
  accent: '#1f4e79',
  fontSize: 10,
  marginMm: 14,
  logo: { position: 'right', heightMm: 18 },
  show: allShown(['itemCode', 'unit', 'discount', 'qr', 'signatures', 'terms', 'pageNumbers']),
  labels: {},
  secondLang: null,
  bankDetails: '',
  terms: ''
};

export const DEFAULT_RECEIPT_DESIGN: PrintDesign = {
  ...DEFAULT_PRINT_DESIGN,
  layout: 'receipt80',
  paper: '80mm',
  fontSize: 9,
  marginMm: 3,
  logo: { position: 'center', heightMm: 14 },
  show: allShown(['qr', 'terms'])
};

/** What is saved: the sale invoice's design, and each other kind's own design when it has one. */
export type PrintDesigns = Partial<Record<PrintDoc, PrintDesign>>;

/** The design a paper prints with: its own, else the sale invoice's (the POS receipt: else the receipt design). */
export function designFor(designs: PrintDesigns | null | undefined, doc: PrintDoc): PrintDesign {
  const own = designs?.[doc];
  if (own) return own;
  if (doc === 'pos') return DEFAULT_RECEIPT_DESIGN;
  return designs?.sale ?? DEFAULT_PRINT_DESIGN;
}

export interface DesignProblem { code: string; path: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const inRange = (v: unknown, [lo, hi]: readonly [number, number], step = 1): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && Math.abs(v / step - Math.round(v / step)) < 1e-9;

/** Control characters other than new lines can't be printed; they are refused rather than silently dropped. */
const PRINTABLE = /^[^\u0000-\u0009\u000b-\u001f\u007f]*$/;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && PRINTABLE.test(v);

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, out: DesignProblem[]): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) out.push({ code: 'pd_unknown_field', path: path ? `${path}.${key}` : key });
}

/**
 * Checks a design from outside (a request, an imported file). Every field must be there with an allowed value and
 * nothing else may be: a design is either entirely right or refused with each problem's path.
 */
export function checkPrintDesign(input: unknown): { design: PrintDesign } | { problems: DesignProblem[] } {
  const p: DesignProblem[] = [];
  if (!isRecord(input)) return { problems: [{ code: 'pd_not_a_design', path: '' }] };
  const top = ['layout', 'paper', 'accent', 'fontSize', 'marginMm', 'logo', 'show', 'labels', 'secondLang', 'bankDetails', 'terms'];
  unknownKeys(input, top, '', p);
  for (const key of top) if (!(key in input)) p.push({ code: 'pd_missing', path: key });
  const d = input;
  if ('layout' in d && !oneOf(PRINT_LAYOUTS, d.layout)) p.push({ code: 'pd_invalid', path: 'layout' });
  if ('paper' in d && !oneOf(PRINT_PAPERS, d.paper)) p.push({ code: 'pd_invalid', path: 'paper' });
  if (oneOf(PRINT_LAYOUTS, d.layout) && oneOf(PRINT_PAPERS, d.paper) && (d.layout === 'receipt80') !== (d.paper === '80mm')) {
    p.push({ code: 'pd_receipt_paper', path: 'paper' });
  }
  if ('accent' in d && !(typeof d.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent))) p.push({ code: 'pd_invalid_colour', path: 'accent' });
  if ('fontSize' in d && !inRange(d.fontSize, PRINT_LIMITS.fontSize, 0.5)) p.push({ code: 'pd_out_of_range', path: 'fontSize' });
  if ('marginMm' in d && !inRange(d.marginMm, PRINT_LIMITS.marginMm)) p.push({ code: 'pd_out_of_range', path: 'marginMm' });
  if ('logo' in d) {
    if (!isRecord(d.logo)) p.push({ code: 'pd_invalid', path: 'logo' });
    else {
      unknownKeys(d.logo, ['position', 'heightMm'], 'logo', p);
      if (!oneOf(LOGO_POSITIONS, d.logo.position)) p.push({ code: 'pd_invalid', path: 'logo.position' });
      if (!inRange(d.logo.heightMm, PRINT_LIMITS.logoHeightMm)) p.push({ code: 'pd_out_of_range', path: 'logo.heightMm' });
    }
  }
  if ('show' in d) {
    if (!isRecord(d.show)) p.push({ code: 'pd_invalid', path: 'show' });
    else {
      unknownKeys(d.show, PRINT_FIELDS, 'show', p);
      for (const f of PRINT_FIELDS) if (typeof d.show[f] !== 'boolean') p.push({ code: 'pd_invalid', path: `show.${f}` });
    }
  }
  if ('labels' in d) {
    if (!isRecord(d.labels)) p.push({ code: 'pd_invalid', path: 'labels' });
    else {
      unknownKeys(d.labels, PRINT_LABELS, 'labels', p);
      for (const [k, v] of Object.entries(d.labels)) {
        if ((PRINT_LABELS as readonly string[]).includes(k) && !(isText(v, PRINT_LIMITS.label) && !v.includes('\n'))) p.push({ code: 'pd_text_invalid', path: `labels.${k}` });
      }
    }
  }
  if ('secondLang' in d && d.secondLang !== null && !oneOf(LANGS, d.secondLang)) p.push({ code: 'pd_invalid', path: 'secondLang' });
  if ('bankDetails' in d && !isText(d.bankDetails, PRINT_LIMITS.bankDetails)) p.push({ code: 'pd_text_invalid', path: 'bankDetails' });
  if ('terms' in d && !isText(d.terms, PRINT_LIMITS.terms)) p.push({ code: 'pd_text_invalid', path: 'terms' });
  if (p.length) return { problems: p };
  const labels: Partial<Record<PrintLabel, string>> = {};
  for (const [k, v] of Object.entries(d.labels as Record<string, string>)) if (v.trim()) labels[k as PrintLabel] = v.trim();
  const logo = d.logo as { position: LogoPosition; heightMm: number };
  const show = d.show as Record<PrintField, boolean>;
  return {
    design: {
      layout: d.layout as PrintLayout,
      paper: d.paper as PrintPaper,
      accent: (d.accent as string).toLowerCase(),
      fontSize: d.fontSize as number,
      marginMm: d.marginMm as number,
      // rebuilt field by field, so nothing else rides along
      logo: { position: logo.position, heightMm: logo.heightMm },
      show: Object.fromEntries(PRINT_FIELDS.map((f) => [f, show[f]])) as Record<PrintField, boolean>,
      labels,
      secondLang: d.secondLang as Lang | null,
      bankDetails: d.bankDetails as string,
      terms: d.terms as string
    }
  };
}

/** The file a design is exported to and imported from. */
export interface PrintDesignFile { qasa: 'print-design'; version: 1; doc: PrintDoc; design: PrintDesign }

export function readPrintDesignFile(input: unknown): { doc: PrintDoc; design: PrintDesign } | { problems: DesignProblem[] } {
  if (!isRecord(input) || input.qasa !== 'print-design' || input.version !== 1) return { problems: [{ code: 'pd_not_a_design_file', path: '' }] };
  const checked = checkPrintDesign(input.design);
  if ('problems' in checked) return { problems: checked.problems.map((x) => ({ ...x, path: x.path ? `design.${x.path}` : 'design' })) };
  return { doc: oneOf(PRINT_DOCS, input.doc) ? input.doc : 'sale', design: checked.design };
}
