import type { CurrencyCode } from './money.ts';
import type { Lang } from './lang.ts';

/** Amount in words (تفقيط) as printed on Iraqi vouchers, invoices and cheques. */
export function amountInWords(amountMinor: number, currency: CurrencyCode, lang: Lang): string {
  const abs = Math.abs(amountMinor);
  const whole = currency === 'USD' ? Math.floor(abs / 100) : abs;
  const cents = currency === 'USD' ? abs % 100 : 0;
  if (lang === 'ku') {
    let text = 'تەنها ' + wordsKu(whole) + ' ' + (currency === 'USD' ? 'دۆلاری ئەمریکی' : 'دیناری عێراقی');
    if (cents) text += ' و ' + wordsKu(cents) + ' سەنت';
    return text;
  }
  if (lang === 'ar') {
    let text = 'فقط ' + wordsAr(whole) + ' ' + (currency === 'USD' ? 'دولار أمريكي' : 'دينار عراقي');
    if (cents) text += ' و' + wordsAr(cents) + ' سنتاً';
    return text + ' لا غير';
  }
  let text = 'Only ' + wordsEn(whole) + ' ' + (currency === 'USD' ? 'US dollars' : 'Iraqi dinars');
  if (cents) text += ' and ' + wordsEn(cents) + ' cents';
  return text;
}

export function wordsEn(n: number): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const under1000 = (x: number): string => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    const parts: string[] = [];
    if (h) parts.push(ones[h] + ' hundred');
    if (r) parts.push(r < 20 ? ones[r]! : tens[Math.floor(r / 10)]! + (r % 10 ? '-' + ones[r % 10] : ''));
    return parts.join(' ');
  };
  if (n === 0) return 'zero';
  const out: string[] = [];
  let rest = n;
  for (const [value, word] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) {
    const count = Math.floor(rest / value);
    rest %= value;
    if (count) out.push(under1000(count) + ' ' + word);
  }
  if (rest) out.push(under1000(rest));
  return out.join(' ');
}

export function wordsAr(n: number): string {
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  const under1000 = (x: number): string => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    const parts: string[] = [];
    if (h) parts.push(hundreds[h]!);
    if (r) {
      if (r < 20) parts.push(ones[r]!);
      else {
        const u = r % 10;
        const t = Math.floor(r / 10);
        parts.push(u ? ones[u] + ' و' + tens[t] : tens[t]!);
      }
    }
    return parts.join(' و');
  };
  if (n === 0) return 'صفر';
  const out: string[] = [];
  let rest = n;
  for (const [value, one, two, plural] of [[1e9, 'مليار', 'ملياران', 'مليارات'], [1e6, 'مليون', 'مليونان', 'ملايين'], [1e3, 'ألف', 'ألفان', 'آلاف']] as const) {
    const count = Math.floor(rest / value);
    rest %= value;
    if (!count) continue;
    if (count === 1) out.push(one);
    else if (count === 2) out.push(two);
    else if (count <= 10) out.push(under1000(count) + ' ' + plural);
    else if (count === 200) out.push('مائتا ' + one);
    else out.push(under1000(count) + ' ' + one);
  }
  if (rest) out.push(under1000(rest));
  return out.join(' و');
}

export function wordsKu(n: number): string {
  const ones = ['', 'یەک', 'دوو', 'سێ', 'چوار', 'پێنج', 'شەش', 'حەوت', 'هەشت', 'نۆ', 'دە', 'یازدە', 'دوازدە', 'سیازدە', 'چواردە', 'پازدە', 'شازدە', 'حەڤدە', 'هەژدە', 'نۆزدە'];
  const tens = ['', '', 'بیست', 'سی', 'چل', 'پەنجا', 'شەست', 'حەفتا', 'هەشتا', 'نەوەد'];
  const under1000 = (x: number): string => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    const parts: string[] = [];
    if (h) parts.push(h === 1 ? 'سەد' : ones[h] + 'سەد');
    if (r) {
      if (r < 20) parts.push(ones[r]!);
      else {
        const u = r % 10;
        const t = Math.floor(r / 10);
        parts.push(u ? tens[t] + ' و ' + ones[u] : tens[t]!);
      }
    }
    return parts.join(' و ');
  };
  if (n === 0) return 'سفر';
  const out: string[] = [];
  let rest = n;
  for (const [value, word] of [[1e9, 'ملیار'], [1e6, 'ملیۆن'], [1e3, 'هەزار']] as const) {
    const count = Math.floor(rest / value);
    rest %= value;
    if (!count) continue;
    out.push(count === 1 && value === 1e3 ? word : under1000(count) + ' ' + word);
  }
  if (rest) out.push(under1000(rest));
  return out.join(' و ');
}
