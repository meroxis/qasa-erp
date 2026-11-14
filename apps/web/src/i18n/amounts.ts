/**
 * Dinar and dollar on the screens (Settings → Language and display → "Show amounts in", Amount.tsx). Arabic, English
 * and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const AMOUNTS_TEXT = {
  am_show: ['عرض المبالغ', 'Show amounts in', 'پیشاندانی بڕی پارە'],
  am_showHelp: [
    'للشركة كلها وعلى كل الحواسيب. تظهر المجاميع أيضاً بالعملة الأخرى بسعر الدولار لليوم (≈)، ولا تتغير المبالغ المحفوظة.',
    'For the whole company, on every PC. Totals also show their value in the other currency at the day’s dollar rate (≈); stored amounts don’t change.',
    'بۆ هەموو کۆمپانیاکە و لەسەر هەموو کۆمپیوتەرەکان. کۆکان بە دراوەکەی تریش دەردەکەون بە نرخی دۆلاری ئەو ڕۆژە (≈)؛ بڕە پاشەکەوتکراوەکان ناگۆڕێن.'
  ],
  am_iqd: ['الدينار فقط', 'Dinar only', 'تەنها دینار'],
  am_iqdUsd: ['الدينار والدولار', 'Dinar and dollar', 'دینار و دۆلار'],
  am_usdIqd: ['الدولار والدينار', 'Dollar and dinar', 'دۆلار و دینار'],
  am_usdIqdHint: ['الدولار أولاً', 'Dollar first', 'دۆلار لە پێشەوە'],
  am_rateOn: [
    'بسعر الدولار ليوم {d}: 1 دولار = {r} دينار',
    'At the dollar rate of {d}: $1 = {r} IQD',
    'بە نرخی دۆلاری ڕۆژی {d}: 1 دۆلار = {r} دینار'
  ],
  am_rateToday: [
    'لا يوجد سعر مُدخل لذلك التاريخ، فاستُعمل آخر سعر ({d}): 1 دولار = {r} دينار',
    'No rate was entered for that date, so the latest rate is used ({d}): $1 = {r} IQD',
    'بۆ ئەو بەروارە نرخ دانەنراوە، بۆیە دوایین نرخ بەکارهاتووە ({d}): 1 دۆلار = {r} دینار'
  ],
  am_setRate: [
    'أدخل سعر الدولار لليوم لتظهر المبالغ بالدولار أيضاً',
    'Enter today’s dollar rate to see amounts in dollars too',
    'نرخی دۆلاری ئەمڕۆ دابنێ بۆ ئەوەی بڕی پارەکان بە دۆلاریش دەربکەون'
  ],
  am_tillEq: ['يعادل', 'About', 'نزیکەی']
} as const satisfies Record<string, readonly [string, string, string]>;
