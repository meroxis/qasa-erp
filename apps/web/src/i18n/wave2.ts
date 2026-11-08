/**
 * Reservation deposits on real estate units, sharing on WhatsApp, and cheques in the Daily Brief and on the home page.
 * Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const WAVE2_TEXT = {
  // ——— reservation deposits (عربون الحجز) ———
  dep_title: ['عربون الحجز', 'Reservation deposit', 'بەیعانەی گلدانەوە'],
  dep_held: ['محتفظ به', 'Held', 'لای کۆمپانیایە'],
  dep_st_held: ['محتفظ به', 'Held', 'لای کۆمپانیایە'],
  dep_st_applied: ['محسوب في البيع', 'Counted in the sale', 'لە فرۆشتنەکەدا حیسابکرا'],
  dep_st_refunded: ['مُعاد للزبون', 'Refunded', 'گەڕێندرایەوە'],
  dep_st_forfeited: ['محتفظ به للشركة', 'Kept by the company', 'کۆمپانیا هێشتییەوە'],
  dep_reversed: ['سند القبض معكوس', 'Receipt reversed', 'پسوولەی وەرگرتن هەڵگەڕێندرایەوە'],
  dep_none: ['لم يُستلم عربون على هذه الوحدة.', 'No deposit has been taken on this unit.', 'هیچ بەیعانەیەک لەسەر ئەم یەکەیە وەرنەگیراوە.'],
  dep_take: ['استلام عربون', 'Take a deposit', 'وەرگرتنی بەیعانە'],
  dep_takeTitle: ['استلام عربون على الوحدة {n}', 'Take a deposit on unit {n}', 'وەرگرتنی بەیعانە لەسەر یەکەی {n}'],
  dep_amount: ['مبلغ العربون', 'Deposit amount', 'بڕی بەیعانە'],
  dep_takeHelp: [
    'يُرحَّل سند قبض فوراً باسم الزبون، وتُحجز الوحدة له حتى التاريخ المحدد. يُحسب العربون من ثمن البيع لاحقاً.',
    'A receipt voucher is posted at once in the customer’s name, and the unit is reserved for them until the date given. The deposit counts toward the price when the unit is sold.',
    'پسوولەی وەرگرتن یەکسەر بە ناوی کڕیارەوە تۆمار دەکرێت و یەکەکە تا ئەو بەروارە بۆی دەگیرێت. بەیعانەکە لە کاتی فرۆشتندا لە نرخەکە دەبڕدرێت.'
  ],
  dep_taken: ['تم استلام العربون وحُجزت الوحدة.', 'Deposit taken and the unit reserved.', 'بەیعانە وەرگیرا و یەکەکە گیرا.'],
  dep_refund: ['إعادة العربون', 'Refund', 'گەڕاندنەوە'],
  dep_refundTitle: ['إعادة عربون الوحدة {n}', 'Refund the deposit on unit {n}', 'گەڕاندنەوەی بەیعانەی یەکەی {n}'],
  dep_refundHelp: [
    'يُعدّ سند صرف مسودة بمبلغ {a} إلى {p}، يمر بالتدقيق والمصادقة قبل خروج المال، وتعود الوحدة متاحة.',
    'A draft payment voucher of {a} to {p} is prepared; it is checked and approved before the money leaves, and the unit goes back on sale.',
    'پسوولەی پارەدانی ڕەشنووس بە بڕی {a} بۆ {p} ئامادە دەکرێت؛ پێش دەرچوونی پارەکە وردبینی و پەسەند دەکرێت، و یەکەکە دەگەڕێتەوە بۆ فرۆشتن.'
  ],
  dep_refundDrafted: ['أُعدّ سند صرف مسودة لإعادة العربون.', 'A draft payment voucher for the refund is ready for checking.', 'پسوولەی پارەدانی ڕەشنووس بۆ گەڕاندنەوە ئامادەیە بۆ وردبینی.'],
  dep_forfeit: ['الاحتفاظ بالعربون', 'Keep the deposit', 'هێشتنەوەی بەیعانە'],
  dep_forfeitTitle: ['الاحتفاظ بعربون الوحدة {n}', 'Keep the deposit on unit {n}', 'هێشتنەوەی بەیعانەی یەکەی {n}'],
  dep_forfeitHelp: [
    'الزبون {p} تراجع: يُعدّ قيد مسودة يحوّل {a} إلى الإيرادات الأخرى، يمر بالتدقيق والمصادقة، وتعود الوحدة متاحة.',
    '{p} walked away: a draft entry moves {a} to other revenue; it is checked and approved, and the unit goes back on sale.',
    '{p} پاشگەزبووەوە: تۆمارێکی ڕەشنووس {a} دەگوازێتەوە بۆ داهاتەکانی تر؛ وردبینی و پەسەند دەکرێت، و یەکەکە دەگەڕێتەوە بۆ فرۆشتن.'
  ],
  dep_forfeitAccount: ['حساب الإيراد', 'Revenue account', 'هەژماری داهات'],
  dep_forfeitDrafted: ['أُعدّ قيد مسودة للاحتفاظ بالعربون.', 'A draft entry keeping the deposit is ready for checking.', 'تۆمارێکی ڕەشنووس بۆ هێشتنەوەی بەیعانە ئامادەیە بۆ وردبینی.'],
  dep_reopen: ['تراجع', 'Take back', 'گەڕاندنەوە'],
  dep_reopened: ['أُلغيت المسودة وعاد العربون محتفظاً به.', 'The draft is gone and the deposit is held again.', 'ڕەشنووسەکە سڕایەوە و بەیعانەکە دووبارە لای کۆمپانیایە.'],
  dep_closeDraft: ['القيد مسودة', 'Entry still a draft', 'تۆمارەکە هێشتا ڕەشنووسە'],
  dep_closeEntry: ['القيد', 'Entry', 'تۆمار'],
  dep_draftHelp: [
    'لا يتحرك شيء في الدفاتر حتى تتم المصادقة على القيد في صفحة السندات. يمكن التراجع من هنا ما دام مسودة.',
    'Nothing moves in the books until the entry is approved on the vouchers page. While it is a draft it can be taken back here.',
    'هیچ شتێک لە دەفتەرەکاندا ناجووڵێت تا تۆمارەکە لە پەڕەی پسوولەکاندا پەسەند دەکرێت. هەتا ڕەشنووس بێت لێرەوە دەگەڕێندرێتەوە.'
  ],
  dep_releaseHelp: [
    'على الوحدة عربون: لإلغاء الحجز أعِد العربون أو احتفظ به.',
    'This unit has a deposit: to end the reservation, refund the deposit or keep it.',
    'ئەم یەکەیە بەیعانەی لەسەرە: بۆ کۆتایی هێنان بە گلدانەوەکە، بەیعانەکە بگەڕێنەوە یان بیهێڵەوە.'
  ],
  dep_inSaleCash: [
    'العربون {a} محسوب من الثمن: تُرحَّل الفاتورة آجلة ويُقبض الباقي فقط في الصندوق.',
    'The deposit of {a} counts toward the price: the invoice is posted on credit and only the rest is collected into the safe.',
    'بەیعانەی {a} لە نرخەکە حیساب دەکرێت: پسوولەکە بە قەرز تۆمار دەکرێت و تەنها ماوەکەی وەردەگیرێت.'
  ],
  dep_inSaleInstallments: [
    'العربون {a} محسوب من الثمن: عقد الأقساط يقسّط الباقي فقط.',
    'The deposit of {a} counts toward the price: the installment contract schedules only what is left.',
    'بەیعانەی {a} لە نرخەکە حیساب دەکرێت: گرێبەستی قیست تەنها ماوەکە دابەش دەکات.'
  ],
  e_re_deposit: ['عربون حجز', 'Reservation deposit', 'بەیعانەی گلدانەوە'],
  a_deposit: ['استلام عربون', 'Deposit taken', 'بەیعانە وەرگیرا'],
  a_deposit_refund: ['إعادة عربون', 'Deposit refunded', 'بەیعانە گەڕێندرایەوە'],
  a_deposit_forfeit: ['احتفاظ بعربون', 'Deposit kept', 'بەیعانە هێشترایەوە'],
  a_deposit_reopen: ['تراجع عن إعادة عربون', 'Deposit held again', 'بەیعانە دووبارە گیرایەوە'],
  err_deposit_held: [
    'على الوحدة عربون؛ أعِده أو احتفظ به أولاً.',
    'The unit has a deposit; refund it or keep it first.',
    'یەکەکە بەیعانەی لەسەرە؛ سەرەتا بیگەڕێنەوە یان بیهێڵەوە.'
  ],
  err_deposit_over_price: ['العربون أكبر من ثمن البيع.', 'The deposit is more than the sale price.', 'بەیعانەکە لە نرخی فرۆشتن زیاترە.'],
  err_deposit_covers_price: [
    'العربون يغطي الثمن كله؛ بِع نقداً بدل الأقساط.',
    'The deposit covers the whole price; sell for cash instead of installments.',
    'بەیعانەکە هەموو نرخەکە دەگرێتەوە؛ بە نەختی بفرۆشە نەک بە قیست.'
  ],
  err_refund_before_deposit: ['التاريخ قبل تاريخ استلام العربون.', 'The date is before the deposit was taken.', 'بەروارەکە پێش وەرگرتنی بەیعانەکەیە.'],
  err_deposit_forfeit_account: ['اختر حساب إيراد يقبل القيود.', 'Choose a revenue account that takes entries.', 'هەژمارێکی داهات هەڵبژێرە کە تۆمار وەربگرێت.'],
  err_entry_belongs_to_deposit: [
    'هذا القيد لعربون حجز؛ تراجع عنه من صفحة الوحدة.',
    'This entry belongs to a reservation deposit; take it back from the unit’s page.',
    'ئەم تۆمارە هی بەیعانەی گلدانەوەیە؛ لە پەڕەی یەکەکەوە بیگەڕێنەوە.'
  ],

  // ——— WhatsApp ———
  sh_whatsapp: ['واتساب', 'WhatsApp', 'واتساپ'],
  sh_toNumber: ['يفتح واتساب على رقم الزبون مع رسالة جاهزة', 'Opens WhatsApp to the customer’s number with a ready message', 'واتساپ لەسەر ژمارەی کڕیار بە نامەیەکی ئامادەوە دەکاتەوە'],
  sh_pickChat: ['يفتح واتساب مع رسالة جاهزة؛ اختر المحادثة', 'Opens WhatsApp with a ready message; pick the chat', 'واتساپ بە نامەیەکی ئامادەوە دەکاتەوە؛ گفتوگۆکە هەڵبژێرە'],
  sh_verify: ['تحقق من الفاتورة', 'Check the invoice', 'پشکنینی پسوولە'],
  sh_quote: ['عرض سعر رقم {n} بتاريخ {d}', 'Quotation {n} of {d}', 'نرخنامەی ژمارە {n} لە {d}'],
  sh_validUntil: ['ساري حتى {d}', 'Valid until {d}', 'تا {d} بەردەوامە'],

  // ——— cheques in the Brief and on the home page ———
  chq_title: ['الصكوك', 'Cheques', 'چەکەکان'],
  chq_dueWeek: ['صكوك تستحق خلال أسبوع', 'Cheques due within a week', 'چەکی کاتیان دێت لە ماوەی هەفتەیەکدا'],
  chq_lateN: ['{n} متأخر', '{n} late', '{n} دواکەوتوو'],
  chq_bounced: ['صكوك مرتجعة (30 يوماً)', 'Bounced cheques (30 days)', 'چەکی گەڕاوە (30 ڕۆژ)'],
  chq_bouncedOne: ['مرتجع', 'Bounced', 'گەڕاوە'],
  chq_received: ['مستلم', 'Received', 'وەرگیراو'],
  chq_issued: ['صادر منا', 'Written by us', 'دەرکراو لە لایەن ئێمە'],
  chq_lateDays: ['متأخر {n} يوم', '{n} days late', '{n} ڕۆژ دواکەوتوو'],
  chq_dueOn: ['يستحق {d}', 'Due {d}', 'کاتی دێت {d}']
} as const satisfies Record<string, readonly [string, string, string]>;
