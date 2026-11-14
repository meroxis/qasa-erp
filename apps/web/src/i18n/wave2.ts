/**
 * Reservation deposits on real estate units, sharing on WhatsApp, and cheques in the Daily Brief and on the home page.
 * Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const WAVE2_TEXT = {
  // ——— reservation deposits (عربون الحجز) ———
  dep_title: ['عربون الحجز', 'Reservation deposit', 'عەرەبوونی گرتنی یەکە'],
  dep_held: ['محتفظ به', 'Held', 'لای کۆمپانیایە'],
  dep_st_held: ['محتفظ به', 'Held', 'لای کۆمپانیایە'],
  dep_st_applied: ['محسوب في البيع', 'Counted in the sale', 'لە فرۆشتنەکەدا هەژمار کرا'],
  dep_st_refunded: ['مُعاد للزبون', 'Refunded', 'گەڕێندرایەوە'],
  dep_st_forfeited: ['محتفظ به للشركة', 'Kept by the company', 'کۆمپانیا هێشتییەوە'],
  dep_reversed: ['سند القبض معكوس', 'Receipt reversed', 'سەنەدی وەرگرتن پێچەوانە کرایەوە'],
  dep_none: ['لم يُستلم عربون على هذه الوحدة.', 'No deposit has been taken on this unit.', 'هیچ عەرەبوونێک لەسەر ئەم یەکەیە وەرنەگیراوە.'],
  dep_take: ['استلام عربون', 'Take a deposit', 'وەرگرتنی عەرەبوون'],
  dep_takeTitle: ['استلام عربون على الوحدة {n}', 'Take a deposit on unit {n}', 'وەرگرتنی عەرەبوون لەسەر یەکەی {n}'],
  dep_amount: ['مبلغ العربون', 'Deposit amount', 'بڕی عەرەبوون'],
  dep_takeHelp: [
    'يُرحَّل سند قبض فوراً باسم الزبون، وتُحجز الوحدة له حتى التاريخ المحدد. يُحسب العربون من ثمن البيع لاحقاً.',
    'A receipt voucher is posted at once in the customer’s name, and the unit is reserved for them until the date given. The deposit counts toward the price when the unit is sold.',
    'سەنەدی وەرگرتن یەکسەر بە ناوی کڕیارەوە تۆمار دەکرێت و یەکەکە تا ئەو بەروارە بۆی دەگیرێت. عەرەبوونەکە لە کاتی فرۆشتندا لە نرخەکە دەبڕدرێت.'
  ],
  dep_taken: ['تم استلام العربون وحُجزت الوحدة.', 'Deposit taken and the unit reserved.', 'عەرەبوون وەرگیرا و یەکەکە گیرا.'],
  dep_refund: ['إعادة العربون', 'Refund', 'گەڕاندنەوەی عەرەبوون'],
  dep_refundTitle: ['إعادة عربون الوحدة {n}', 'Refund the deposit on unit {n}', 'گەڕاندنەوەی عەرەبوونی یەکەی {n}'],
  dep_refundHelp: [
    'يُعدّ سند صرف مسودة بمبلغ {a} إلى {p}، يمر بالتدقيق والمصادقة قبل خروج المال، وتعود الوحدة متاحة.',
    'A draft payment voucher of {a} to {p} is prepared; it is checked and approved before the money leaves, and the unit goes back on sale.',
    'ڕەشنووسی سەنەدی پارەدان بە بڕی {a} بۆ {p} ئامادە دەکرێت؛ پێش دەرچوونی پارەکە وردبینی و پەسەند دەکرێت، و یەکەکە دەگەڕێتەوە بۆ فرۆشتن.'
  ],
  dep_refundDrafted: ['أُعدّ سند صرف مسودة لإعادة العربون.', 'A draft payment voucher for the refund is ready for checking.', 'ڕەشنووسی سەنەدی پارەدان بۆ گەڕاندنەوەی عەرەبوون ئامادەیە بۆ وردبینی.'],
  dep_forfeit: ['الاحتفاظ بالعربون', 'Keep the deposit', 'هێشتنەوەی عەرەبوون'],
  dep_forfeitTitle: ['الاحتفاظ بعربون الوحدة {n}', 'Keep the deposit on unit {n}', 'هێشتنەوەی عەرەبوونی یەکەی {n}'],
  dep_forfeitHelp: [
    'الزبون {p} تراجع: يُعدّ قيد مسودة يحوّل {a} إلى الإيرادات الأخرى، يمر بالتدقيق والمصادقة، وتعود الوحدة متاحة.',
    '{p} walked away: a draft entry moves {a} to other revenue; it is checked and approved, and the unit goes back on sale.',
    '{p} پاشگەزبووەوە: قەیدێکی ڕەشنووس {a} دەگوازێتەوە بۆ داهاتەکانی تر؛ وردبینی و پەسەند دەکرێت، و یەکەکە دەگەڕێتەوە بۆ فرۆشتن.'
  ],
  dep_forfeitAccount: ['حساب الإيراد', 'Revenue account', 'هەژماری داهات'],
  dep_forfeitDrafted: ['أُعدّ قيد مسودة للاحتفاظ بالعربون.', 'A draft entry keeping the deposit is ready for checking.', 'قەیدێکی ڕەشنووس بۆ هێشتنەوەی عەرەبوون ئامادەیە بۆ وردبینی.'],
  dep_reopen: ['تراجع', 'Take back', 'پاشگەزبوونەوە'],
  dep_reopened: ['أُلغيت المسودة وعاد العربون محتفظاً به.', 'The draft is gone and the deposit is held again.', 'ڕەشنووسەکە سڕایەوە و عەرەبوونەکە دووبارە لای کۆمپانیایە.'],
  dep_closeDraft: ['القيد مسودة', 'Entry still a draft', 'قەیدەکە هێشتا ڕەشنووسە'],
  dep_closeEntry: ['القيد', 'Entry', 'قەید'],
  dep_draftHelp: [
    'لا يتحرك شيء في الدفاتر حتى تتم المصادقة على القيد في صفحة السندات. يمكن التراجع من هنا ما دام مسودة.',
    'Nothing moves in the books until the entry is approved on the vouchers page. While it is a draft it can be taken back here.',
    'هیچ شتێک لە دەفتەرەکاندا ناجووڵێت تا قەیدەکە لە پەڕەی سەنەدەکاندا پەسەند دەکرێت. هەتا ڕەشنووس بێت لێرەوە دەتوانیت لێی پاشگەز ببیتەوە.'
  ],
  dep_releaseHelp: [
    'على الوحدة عربون: لإلغاء الحجز أعِد العربون أو احتفظ به.',
    'This unit has a deposit: to end the reservation, refund the deposit or keep it.',
    'ئەم یەکەیە عەرەبوونی لەسەرە: بۆ کۆتایی هێنان بە گرتنەکەی، عەرەبوونەکە بگەڕێنەوە یان بیهێڵەوە.'
  ],
  dep_inSaleCash: [
    'العربون {a} محسوب من الثمن: تُرحَّل الفاتورة آجلة ويُقبض الباقي فقط في الصندوق.',
    'The deposit of {a} counts toward the price: the invoice is posted on credit and only the rest is collected into the safe.',
    'عەرەبوونی {a} لە نرخەکە هەژمار دەکرێت: پسوولەکە بە قەرز تۆمار دەکرێت و تەنها ماوەکەی وەردەگیرێت و دەخرێتە قاسە.'
  ],
  dep_inSaleInstallments: [
    'العربون {a} محسوب من الثمن: عقد الأقساط يقسّط الباقي فقط.',
    'The deposit of {a} counts toward the price: the installment contract schedules only what is left.',
    'عەرەبوونی {a} لە نرخەکە هەژمار دەکرێت: گرێبەستی قیست تەنها ماوەکە دەکاتە قیست.'
  ],
  e_re_deposit: ['عربون حجز', 'Reservation deposit', 'عەرەبوونی گرتنی یەکە'],
  a_deposit: ['استلام عربون', 'Deposit taken', 'عەرەبوون وەرگیرا'],
  a_deposit_refund: ['إعادة عربون', 'Deposit refunded', 'عەرەبوون گەڕێندرایەوە'],
  a_deposit_forfeit: ['احتفاظ بعربون', 'Deposit kept', 'عەرەبوون هێشترایەوە'],
  a_deposit_reopen: ['تراجع عن إعادة عربون', 'Deposit held again', 'عەرەبوون دووبارە لای کۆمپانیایە'],
  err_deposit_held: [
    'على الوحدة عربون؛ أعِده أو احتفظ به أولاً.',
    'The unit has a deposit; refund it or keep it first.',
    'یەکەکە عەرەبوونی لەسەرە؛ سەرەتا بیگەڕێنەوە یان بیهێڵەوە.'
  ],
  err_deposit_over_price: ['العربون أكبر من ثمن البيع.', 'The deposit is more than the sale price.', 'عەرەبوونەکە لە نرخی فرۆشتن زیاترە.'],
  err_deposit_covers_price: [
    'العربون يغطي الثمن كله؛ بِع نقداً بدل الأقساط.',
    'The deposit covers the whole price; sell for cash instead of installments.',
    'عەرەبوونەکە هەموو نرخەکە دەگرێتەوە؛ بە نەقد بفرۆشە نەک بە قیست.'
  ],
  err_refund_before_deposit: ['التاريخ قبل تاريخ استلام العربون.', 'The date is before the deposit was taken.', 'بەروارەکە پێش وەرگرتنی عەرەبوونەکەیە.'],
  err_deposit_forfeit_account: ['اختر حساب إيراد يقبل القيود.', 'Choose a revenue account that takes entries.', 'هەژمارێکی داهات هەڵبژێرە کە قەید وەربگرێت.'],
  err_entry_belongs_to_deposit: [
    'هذا القيد لعربون حجز؛ تراجع عنه من صفحة الوحدة.',
    'This entry belongs to a reservation deposit; take it back from the unit’s page.',
    'ئەم قەیدە هی عەرەبوونی گرتنی یەکەیە؛ لە پەڕەی یەکەکەوە لێی پاشگەز ببەوە.'
  ],

  // ——— WhatsApp ———
  sh_whatsapp: ['واتساب', 'WhatsApp', 'واتسئاپ'],
  sh_toNumber: ['يفتح واتساب على رقم الزبون مع رسالة جاهزة', 'Opens WhatsApp to the customer’s number with a ready message', 'واتسئاپ لەسەر ژمارەی کڕیار بە نامەیەکی ئامادەوە دەکاتەوە'],
  sh_pickChat: ['يفتح واتساب مع رسالة جاهزة؛ اختر المحادثة', 'Opens WhatsApp with a ready message; pick the chat', 'واتسئاپ بە نامەیەکی ئامادەوە دەکاتەوە؛ گفتوگۆکە هەڵبژێرە'],
  sh_verify: ['تحقق من الفاتورة', 'Check the invoice', 'پشکنینی پسوولە'],
  sh_quote: ['عرض سعر رقم {n} بتاريخ {d}', 'Quotation {n} of {d}', 'عەرزی نرخی ژمارە {n} لە {d}'],
  sh_validUntil: ['ساري حتى {d}', 'Valid until {d}', 'تا {d} بەردەوامە'],

  // ——— cheques in the Brief and on the home page ———
  chq_title: ['الصكوك', 'Cheques', 'چەکەکان'],
  chq_dueWeek: ['صكوك تستحق خلال أسبوع', 'Cheques due within a week', 'ئەو چەکانەی وادەیان لە ماوەی هەفتەیەکدایە'],
  chq_lateN: ['{n} متأخر', '{n} late', '{n} دواکەوتوو'],
  chq_bounced: ['صكوك مرتجعة (30 يوماً)', 'Bounced cheques (30 days)', 'چەکی گەڕاوە (30 ڕۆژ)'],
  chq_bouncedOne: ['مرتجع', 'Bounced', 'گەڕاوە'],
  chq_received: ['مستلم', 'Received', 'وەرگیراو'],
  chq_issued: ['صادر منا', 'Written by us', 'دەرکراوی خۆمان'],
  chq_lateDays: ['متأخر {n} يوم', '{n} days late', '{n} ڕۆژ دواکەوتوو'],
  chq_dueOn: ['يستحق {d}', 'Due {d}', 'وادەی {d}']
} as const satisfies Record<string, readonly [string, string, string]>;
