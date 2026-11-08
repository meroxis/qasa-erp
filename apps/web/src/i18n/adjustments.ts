/** Stock adjustments and stock count. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const ADJ_TEXT = {
  adj_title: ['تسوية المخزون', 'Stock adjustments', 'ڕێکخستنی کۆگا'],
  adj_one: ['تسوية مخزون', 'Stock adjustment', 'ڕێکخستنی کۆگا'],
  adj_help: [
    'أخرج البضاعة التالفة أو المفقودة أو منتهية الصلاحية أو المستخدمة داخل الشركة بكلفتها، أو أدخل الزيادة. يُنشأ القيد تلقائياً.',
    'Take out goods that are damaged, lost, expired or used in the company at their cost, or add a surplus. The journal entry is made for you.',
    'کاڵای تێکچوو، ونبوو، بەسەرچوو یان بەکارهاتوو لە کۆمپانیا بە تێچووەکەی دەربهێنە، یان زیادە زیاد بکە. تۆمارەکە خۆکارانە دروست دەکرێت.'
  ],
  adj_new: ['تسوية جديدة', 'New adjustment', 'ڕێکخستنی نوێ'],
  adj_count: ['جرد المخزن', 'Stock count', 'ژماردنی کۆگا'],
  adj_none: ['لا توجد تسويات بعد.', 'No adjustments yet.', 'هێشتا هیچ ڕێکخستنێک نییە.'],
  adj_reason: ['السبب', 'Reason', 'هۆکار'],
  adj_r_damaged: ['تالف', 'Damaged', 'تێکچوو'],
  adj_r_lost: ['مفقود', 'Lost', 'ونبوو'],
  adj_r_expired: ['منتهي الصلاحية', 'Expired', 'بەسەرچوو'],
  adj_r_count: ['فرق جرد', 'Count difference', 'جیاوازیی ژماردن'],
  adj_r_internal_use: ['استخدام داخلي', 'Used in the company', 'بەکارهێنانی ناوخۆ'],
  adj_r_job: ['صرف لأمر عمل', 'Issued to a job', 'دەرکردن بۆ کار'],
  adj_r_other: ['أخرى', 'Other', 'هی تر'],
  adj_job: ['أمر العمل', 'Job', 'فەرمانی کار'],
  adj_chooseJob: ['اختر أمر العمل', 'Choose the job', 'فەرمانی کار هەڵبژێرە'],
  adj_noJobs: ['لا توجد أوامر عمل مفتوحة (الأعمال الهندسية - Pro).', 'No open jobs (Engineering works — Pro).', 'هیچ فەرمانی کارێکی کراوە نییە (کاری ئەندازیاری — Pro).'],
  adj_account: ['حساب الخسارة أو المصروف', 'Loss or expense account', 'هەژماری زیان یان خەرجی'],
  adj_accountHint: ['يُختار تلقائياً حسب السبب، ويمكنك تغييره.', 'Chosen for you by the reason; you can change it.', 'بەپێی هۆکارەکە خۆکارانە هەڵدەبژێردرێت، دەتوانیت بیگۆڕیت.'],
  adj_direction: ['الاتجاه', 'Direction', 'ئاراستە'],
  adj_out: ['إخراج (−)', 'Take out (−)', 'دەرکردن (−)'],
  adj_in: ['إدخال (+)', 'Add (+)', 'زیادکردن (+)'],
  adj_outShort: ['إخراج', 'Out', 'دەرچوو'],
  adj_inShort: ['إدخال', 'In', 'هاتوو'],
  adj_costHint: ['الكلفة: اتركها فارغة لاستخدام متوسط الكلفة الحالي', 'Cost: leave empty to use the current average cost', 'تێچوو: بەتاڵی بهێڵە بۆ بەکارهێنانی تێچووی ناوەندی ئێستا'],
  adj_avgCost: ['متوسط الكلفة', 'Average cost', 'تێچووی ناوەندی'],
  adj_onHand: ['الموجود', 'On hand', 'هەیە'],
  adj_after: ['بعد التسوية', 'After', 'دوای ڕێکخستن'],
  adj_valueOut: ['قيمة الخارج', 'Value out', 'بەهای دەرچوو'],
  adj_valueIn: ['قيمة الداخل', 'Value in', 'بەهای هاتوو'],
  adj_estimate: ['تقريبي — تُحسب الكلفة الفعلية عند الترحيل', 'Estimate — the exact cost is worked out on posting', 'نزیکەیی — تێچووی ڕاست لە کاتی تۆمارکردن دەژمێردرێت'],
  adj_postConfirm: [
    'ترحيل التسوية؟ ستتغير كميات المخزن ويُسجَّل القيد، ولا يمكن التعديل بعدها (يمكن الإلغاء بقيد عكسي).',
    'Post this adjustment? Stock quantities change and the entry is recorded; it can no longer be edited (it can be cancelled with a reversal).',
    'ئەم ڕێکخستنە تۆمار بکرێت؟ بڕی کۆگا دەگۆڕێت و تۆمارەکە دەنووسرێت؛ ئیتر دەستکاری ناکرێت (بە تۆماری پێچەوانە هەڵدەوەشێتەوە).'
  ],
  adj_post: ['ترحيل', 'Post', 'تۆمارکردن'],
  adj_cancel: ['إلغاء بقيد عكسي', 'Cancel (reverse)', 'هەڵوەشاندنەوە (پێچەوانە)'],
  adj_cancelHelp: [
    'يُعكس القيد وتعود الكميات كما كانت. البضاعة المُدخلة يجب أن تكون ما زالت في المخزن.',
    'The entry is reversed and quantities go back as they were. Goods that were added must still be in the warehouse.',
    'تۆمارەکە پێچەوانە دەکرێتەوە و بڕەکان وەک خۆیان دەگەڕێنەوە. کاڵای زیادکراو دەبێت هێشتا لە کۆگادا بێت.'
  ],
  adj_postedNote: ['التسوية مرحّلة: تم تحديث المخزن وتسجيل القيد.', 'Posted: stock updated and the entry recorded.', 'تۆمارکرا: کۆگا نوێکرایەوە و تۆمارەکە نووسرا.'],
  adj_lines: ['المواد', 'Items', 'کاڵاکان'],
  adj_noLines: ['أضف مادة واحدة على الأقل.', 'Add at least one item.', 'لانیکەم یەک کاڵا زیاد بکە.'],
  adj_settings: ['حسابات التسوية', 'Adjustment accounts', 'هەژمارەکانی ڕێکخستن'],
  adj_settingsHelp: [
    'الحساب الذي تذهب إليه قيمة البضاعة لكل سبب. الزيادة (الإدخال) تذهب إلى حساب الإيراد.',
    'Where the value of the goods goes for each reason. Additions go to the revenue account.',
    'بەهای کاڵاکە بۆ هەر هۆکارێک دەچێتە کام هەژمار. زیادکردن دەچێتە هەژماری داهات.'
  ],
  adj_gainAccount: ['حساب الزيادة (إيرادات أخرى)', 'Surplus account (other revenue)', 'هەژماری زیادە (داهاتی تر)'],
  adj_countShortage: ['نقص الجرد', 'Count shortage', 'کەمیی ژماردن'],
  adj_restoreDefaults: ['الافتراضي', 'Defaults', 'بنەڕەت'],
  // stock count
  adj_countHelp: [
    'اكتب الكمية التي عددتها لكل مادة، أو الصق قائمة (الرمز أو الباركود ثم الكمية) أو استورد ملف CSV. نصنع لك مسودة تسوية بالفروقات فقط.',
    'Enter what you counted for each item, or paste a list (code or barcode, then quantity) or import a CSV file. You get a draft adjustment with just the differences.',
    'ئەو بڕەی ژماردووتە بۆ هەر کاڵایەک بنووسە، یان لیستێک بلکێنە (کۆد یان بارکۆد، پاشان بڕ) یان فایلی CSV هاوردە بکە. ڕەشنووسێکی ڕێکخستن تەنها بە جیاوازییەکان دروست دەکرێت.'
  ],
  adj_countCostHelp: [
    'لمادة زائدة لا رصيد لها في الدفاتر: اكتب كلفة الوحدة ليُعرف كم تضيف إلى المخزن.',
    'For a surplus of an item the books show none of: enter its unit cost, so we know what it adds to stock.',
    'بۆ زیادەی کاڵایەک کە لە دەفتەردا هیچی نییە: تێچووی یەکەکەی بنووسە، تا بزانرێت چەند بۆ کۆگا زیاد دەکات.'
  ],
  adj_books: ['حسب الدفاتر', 'In the books', 'بەپێی دەفتەر'],
  adj_counted: ['المعدود', 'Counted', 'ژمێردراو'],
  adj_difference: ['الفرق', 'Difference', 'جیاوازی'],
  adj_searchCount: ['ابحث أو امسح الباركود', 'Search or scan a barcode', 'بگەڕێ یان بارکۆد بخوێنەوە'],
  adj_onlyCounted: ['المعدود فقط', 'Counted only', 'تەنها ژمێردراو'],
  adj_onlyDiff: ['الفروقات فقط', 'Differences only', 'تەنها جیاوازی'],
  adj_full: ['جرد كامل: المواد غير المعدودة تُعتبر صفراً', 'Full count: items not counted are taken as zero', 'ژماردنی تەواو: کاڵای نەژمێردراو بە سفر دادەنرێت'],
  adj_paste: ['لصق أو استيراد', 'Paste or import', 'لکاندن یان هاوردە'],
  adj_pasteHelp: ['سطر لكل مادة: الرمز أو الباركود، ثم الكمية (مثل: PIPE-1, 12).', 'One line per item: code or barcode, then quantity (e.g. PIPE-1, 12).', 'هەر کاڵایەک یەک دێڕ: کۆد یان بارکۆد، پاشان بڕ (وەک: PIPE-1, 12).'],
  adj_importCsv: ['استيراد ملف CSV', 'Import a CSV file', 'هاوردەکردنی فایلی CSV'],
  adj_apply: ['تطبيق', 'Apply', 'جێبەجێکردن'],
  adj_badRow: ['السطر {n} غير مفهوم.', 'Line {n} could not be read.', 'دێڕی {n} نەخوێندرایەوە.'],
  adj_unknownCodes: ['رموز غير معروفة: {c}', 'Unknown codes: {c}', 'کۆدی نەناسراو: {c}'],
  adj_applied: ['تمت قراءة {n} سطر.', '{n} lines read.', '{n} دێڕ خوێندرایەوە.'],
  adj_makeDraft: ['إنشاء مسودة الفروقات', 'Make the differences draft', 'دروستکردنی ڕەشنووسی جیاوازی'],
  adj_noDifferences: ['لا توجد فروقات — المخزن مطابق للدفاتر.', 'No differences — the stock matches the books.', 'هیچ جیاوازییەک نییە — کۆگا لەگەڵ دەفتەر یەکدەگرێتەوە.'],
  adj_countedSummary: ['{n} مادة معدودة', '{n} items counted', '{n} کاڵا ژمێردرا'],
  adj_diffSummary: ['{n} فرق', '{n} differences', '{n} جیاوازی'],
  adj_printSheet: ['طباعة ورقة الجرد', 'Print count sheet', 'چاپکردنی پەڕەی ژماردن'],
  adj_exportSheet: ['تنزيل ورقة الجرد', 'Download count sheet', 'داگرتنی پەڕەی ژماردن'],
  // audit log
  e_adjustment: ['تسوية مخزون', 'Stock adjustment', 'ڕێکخستنی کۆگا'],
  e_adjustment_settings: ['حسابات التسوية', 'Adjustment accounts', 'هەژمارەکانی ڕێکخستن'],
  // errors
  err_adj_cost_required: ['السطر {n}: اكتب كلفة الوحدة — لا يوجد مخزون لحساب المتوسط', 'Line {n}: enter the unit cost — there is no stock to take an average from', 'دێڕی {n}: تێچووی یەکە بنووسە — کۆگا نییە بۆ ناوەندی'],
  err_adj_reason_invalid: ['اختر سبب التسوية', 'Choose the reason', 'هۆکارەکە هەڵبژێرە'],
  err_adj_job_required: ['اختر أمر العمل', 'Choose the job', 'فەرمانی کار هەڵبژێرە'],
  err_adj_job_invalid: ['أمر العمل غير موجود أو ملغى', 'That job does not exist or is cancelled', 'ئەو فەرمانی کارە نییە یان هەڵوەشاوەتەوە'],
  err_adj_job_only_for_job: ['أمر العمل فقط لسبب «صرف لأمر عمل»', 'A job only goes with the reason "Issued to a job"', 'فەرمانی کار تەنها بۆ هۆکاری «دەرکردن بۆ کار»'],
  err_adj_job_outs_only: ['السطر {n}: الصرف لأمر عمل يكون إخراجاً فقط', 'Line {n}: issuing to a job only takes goods out', 'دێڕی {n}: دەرکردن بۆ کار تەنها دەرکردنە'],
  // stock adjustments: the loss account is an expense sub-account (under 3), the gain account a revenue one (under 4)
  err_account_invalid_accountCode: [
    'حساب الخسارة أو المصروف يجب أن يكون حساباً فرعياً تحت 3 (المصروفات). غيّره هنا أو في «حسابات التسوية».',
    'The loss or expense account must be a sub-account under 3 (expenses). Change it here or in Adjustment accounts.',
    'هەژماری زیان یان خەرجی دەبێت هەژمارێکی لاوەکی بێت لە ژێر 3 (خەرجییەکان). لێرە یان لە «هەژمارەکانی ڕێکخستن» بیگۆڕە.'
  ],
  err_account_invalid_gain: [
    'حساب زيادة الجرد يجب أن يكون حساباً فرعياً تحت 4 (الإيرادات). غيّره في «حسابات التسوية».',
    'The stock gain account must be a sub-account under 4 (revenue). Change it in Adjustment accounts.',
    'هەژماری زیادەی ژماردن دەبێت هەژمارێکی لاوەکی بێت لە ژێر 4 (داهاتەکان). لە «هەژمارەکانی ڕێکخستن» بیگۆڕە.'
  ],
  err_date_before_document: ['تاريخ الإلغاء قبل تاريخ المستند', 'The cancel date is before the document date', 'ڕێکەوتی هەڵوەشاندنەوە پێش ڕێکەوتی بەڵگەکەیە'],
} as const satisfies Record<string, readonly [string, string, string]>;
