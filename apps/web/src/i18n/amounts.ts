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
  // the till's hint for a dollar sale: at the rate the cashier typed for this sale, which the sale is booked at
  am_rateSale: [
    'بسعر هذا البيع: 1 دولار = {r} دينار',
    'At this sale’s rate: $1 = {r} IQD',
    'بە نرخی ئەم فرۆشتنە: 1 دۆلار = {r} دینار'
  ],
  // Settings, against an office server not yet updated: it keeps no such choice, so the choice is shown but can't be changed
  am_oldServer: [
    'حدّث قاصة ERP على حاسوب خادم المكتب لتغيير هذا الخيار؛ حتى ذلك تظهر المبالغ بالدينار فقط.',
    'Update Qasa ERP on the office server PC to change this; until then amounts show in dinars only.',
    'قاسە ERP لەسەر کۆمپیوتەری سێرڤەری نووسینگە نوێ بکەرەوە بۆ گۆڕینی ئەمە؛ تا ئەو کاتە بڕی پارەکان تەنها بە دینار دەردەکەون.'
  ],
  // under a page whose note says "in dinars", once it also shows ≈ figures
  am_note: [
    'الأرقام المسبوقة بـ ≈ بالعملة الأخرى، بسعر الدولار لذلك اليوم (ولفترةٍ: بسعر آخر يوم فيها).',
    'Figures marked ≈ are in the other currency, at the dollar rate of that day (for a period: of its last day).',
    'ژمارەکانی نیشانەکراو بە ≈ بە دراوەکەی ترن، بە نرخی دۆلاری ئەو ڕۆژە (بۆ ماوەیەک: هی دوا ڕۆژەکەی).'
  ]
} as const satisfies Record<string, readonly [string, string, string]>;
