/** Batches and expiry dates (1.1). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const BATCH_TEXT = {
  ex_title: ['الصلاحية والوجبات', 'Expiry & batches', 'بەسەرچوون و وەجبەکان'],
  ex_help: [
    'المواد التي تتبع الوجبات: ما قارب انتهاء صلاحيته، وما انتهت صلاحيته، ومخزون كل وجبة في كل مخزن.',
    'Items that track batches: what is near its expiry date, what is past it, and the stock of each batch in each warehouse.',
    'ئەو کاڵایانەی وەجبە بەدوادا دەچن: ئەوەی نزیکە لە بەسەرچوون، ئەوەی بەسەرچووە، و کۆگای هەر وەجبەیەک لە هەر کۆگایەک.'
  ],
  ex_near: ['قريبة الانتهاء', 'Near expiry', 'نزیک لە بەسەرچوون'],
  ex_expired: ['منتهية الصلاحية', 'Expired', 'بەسەرچووە'],
  ex_stock: ['مخزون الوجبات', 'Batch stock', 'کۆگای وەجبەکان'],
  ex_batch: ['الوجبة', 'Batch', 'وەجبە'],
  ex_noNumber: ['بدون رقم', 'No number', 'بێ ژمارە'],
  ex_expiry: ['تاريخ الانتهاء', 'Expiry date', 'بەرواری بەسەرچوون'],
  ex_daysLeft: ['الأيام المتبقية', 'Days left', 'ڕۆژی ماوە'],
  ex_daysAgo: ['منذ {n} يوم', '{n} days ago', 'پێش {n} ڕۆژ'],
  ex_none: ['لا توجد وجبات هنا.', 'No batches here.', 'هیچ وەجبەیەک لێرە نییە.'],
  ex_writeOff: ['شطب المنتهي', 'Write off expired', 'لابردنی بەسەرچوو'],
  ex_writeOffHelp: [
    'تُنشأ تسوية مخزنية بسبب «منتهية الصلاحية» كمسودة، بأسطر مثبتة على هذه الوجبات؛ راجعها ثم رحّلها.',
    'A stock adjustment for "Expired" is made as a draft, with lines pinned to these batches; check it, then post it.',
    'ڕێکخستنێکی کۆگا بە هۆی «بەسەرچووە» وەک ڕەشنووس دروست دەکرێت، بە هێڵی جێگیرکراو لەسەر ئەم وەجبانە؛ بیپشکنە و پاشان بینێرە.'
  ],
  ex_writeOffMade: ['أُنشئت مسودة الشطب', 'Write-off draft made', 'ڕەشنووسی لابردن دروستکرا'],
  ex_trackBatches: ['تتبع الوجبات', 'Track batches', 'بەدواداچوونی وەجبە'],
  ex_trackExpiry: ['تتبع تاريخ الانتهاء', 'Track expiry date', 'بەدواداچوونی بەرواری بەسەرچوون'],
  ex_trackHelp: [
    'تُحفظ الكمية لكل رقم وجبة؛ مع تاريخ الانتهاء يُطلب التاريخ عند الشراء ويُباع الأقرب انتهاءً أولاً.',
    'Quantities are kept per batch number; with expiry dates the date is asked on the way in and the earliest expiry sells first.',
    'بڕ بۆ هەر ژمارەی وەجبەیەک دەپارێزرێت؛ لەگەڵ بەرواری بەسەرچوون، بەروار لە کاتی کڕین دەپرسرێت و نزیکترین بەسەرچوون یەکەم دەفرۆشرێت.'
  ],
  ex_auto: ['تلقائي (الأقرب انتهاءً)', 'Automatic (earliest expiry)', 'خۆکار (نزیکترین بەسەرچوون)'],
  ex_batchNo: ['رقم الوجبة', 'Batch no.', 'ژمارەی وەجبە'],
  ex_confirmExpired: [
    'في الفاتورة مواد منتهية الصلاحية. هل تريد بيعها رغم ذلك؟ يُسجَّل ذلك في سجل التدقيق.',
    'This sale takes stock that is past its expiry date. Sell it anyway? This is written to the audit log.',
    'ئەم فرۆشتنە کاڵای بەسەرچوو دەبات. هەر بیفرۆشیت؟ ئەمە لە تۆماری چاودێری دەنووسرێت.'
  ],
  ex_sellAnyway: ['بِع رغم ذلك', 'Sell anyway', 'هەر بیفرۆشە'],
  ex_alert: ['{e} وجبات منتهية، و{n} تنتهي خلال {d} يوماً', '{e} batches expired, {n} expire within {d} days', '{e} وەجبە بەسەرچووە، {n} لە ماوەی {d} ڕۆژدا بەسەردەچن'],
  ex_settings: ['الصلاحية والوجبات', 'Expiry & batches', 'بەسەرچوون و وەجبەکان'],
  ex_nearDays: ['أيام التنبيه قبل الانتهاء', 'Days of warning before expiry', 'ڕۆژانی ئاگادارکردنەوە پێش بەسەرچوون'],
  ex_policy: ['بيع المنتهي الصلاحية', 'Selling expired stock', 'فرۆشتنی کاڵای بەسەرچوو'],
  ex_policyBlock: ['ممنوع', 'Not allowed', 'ڕێگەپێنەدراو'],
  ex_policyWarn: ['بعد التأكيد (يُسجَّل)', 'After a confirmation (recorded)', 'دوای پشتڕاستکردنەوە (تۆمار دەکرێت)'],
  ex_defaultExpiry: ['المواد الجديدة تتبع تاريخ الانتهاء', 'New items track expiry dates', 'کاڵا نوێیەکان بەرواری بەسەرچوون بەدوادا دەچن'],
  ex_state_expired: ['منتهية', 'Expired', 'بەسەرچووە'],
  ex_state_near: ['قريبة', 'Near', 'نزیکە'],
  ex_state_ok: ['سليمة', 'Good', 'باشە'],
  src_batch_start: ['بدء تتبع الوجبات', 'Batches switched on', 'دەستپێکردنی وەجبە'],
  err_expiry_required: ['السطر {n}: اكتب تاريخ الانتهاء.', 'Line {n}: enter the expiry date.', 'ڕیزی {n}: بەرواری بەسەرچوون بنووسە.'],
  err_expiry_invalid: ['السطر {n}: تاريخ الانتهاء غير صحيح.', 'Line {n}: the expiry date isn’t valid.', 'ڕیزی {n}: بەرواری بەسەرچوون دروست نییە.'],
  err_batch_expiry_differs: [
    'السطر {n}: رقم الوجبة هذا موجود بتاريخ انتهاء آخر.',
    'Line {n}: this batch number already has another expiry date.',
    'ڕیزی {n}: ئەم ژمارەی وەجبەیە پێشتر بەرواری بەسەرچوونی تری هەیە.'
  ],
  err_batch_expired: [
    'السطر {n}: المتوفر من غير المنتهي {a} فقط؛ الباقي منتهي الصلاحية.',
    'Line {n}: only {a} is within its expiry date; the rest has expired.',
    'ڕیزی {n}: تەنها {a} بەسەرنەچووە؛ ئەوانی تر بەسەرچوون.'
  ],
  err_batch_insufficient: ['السطر {n}: لا تكفي الكمية في الوجبة (المتوفر {a}).', 'Line {n}: not enough in the batch ({a} available).', 'ڕیزی {n}: بڕی وەجبەکە بەس نییە ({a} هەیە).'],
  err_batch_invalid: ['السطر {n}: الوجبة ليست لهذه المادة.', 'Line {n}: that batch isn’t this item’s.', 'ڕیزی {n}: ئەو وەجبەیە هی ئەم کاڵایە نییە.'],
  err_batch_no_invalid: ['السطر {n}: رقم الوجبة أطول من 40 حرفاً.', 'Line {n}: the batch number is longer than 40 characters.', 'ڕیزی {n}: ژمارەی وەجبە لە 40 پیت درێژترە.'],
  err_batch_in_use: ['خرجت كمية من هذه الوجبة؛ لا يتغير رقمها ولا تاريخها.', 'Stock has left this batch; its number and date no longer change.', 'بڕێک لەم وەجبەیە دەرچووە؛ ژمارە و بەروارەکەی ناگۆڕێن.'],
  err_batch_number_taken: ['رقم الوجبة موجود لهذه المادة.', 'That batch number is already used for this item.', 'ئەو ژمارەی وەجبەیە بۆ ئەم کاڵایە هەیە.'],
  err_batch_expiry_taken: ['للمخزون بلا رقم وجبة هذا التاريخ من قبل.', 'Stock with no batch number already has that expiry date.', 'کۆگای بێ ژمارەی وەجبە پێشتر ئەم بەروارەی هەیە.'],
  err_value_invalid: ['القيمة غير صحيحة.', 'The value isn’t valid.', 'بەهاکە دروست نییە.']
} as const;
