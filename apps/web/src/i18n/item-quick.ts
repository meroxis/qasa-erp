/**
 * 1.4.2: an item added from inside an item picker, and an item's stock corrected from its page. Arabic, English and
 * Kurdish (Sorani), in that order, like i18n.ts.
 */
export const ITEM_QUICK_TEXT = {
  // the quick add in an item picker (invoices, quotations, orders, the till)
  iq_addItem: ['إضافة مادة جديدة', 'Add a new item', 'زیادکردنی کاڵای نوێ'],
  iq_addNamed: ['إضافة «{name}» مادةً جديدة', 'Add “{name}” as a new item', '«{name}» وەک کاڵای نوێ زیاد بکە'],
  iq_addBarcode: ['إضافة مادة بالباركود {code}', 'Add an item with barcode {code}', 'کاڵایەک بە بارکۆدی {code} زیاد بکە'],
  iq_title: ['مادة جديدة', 'New item', 'کاڵای نوێ'],
  iq_category: ['الفئة (اختياري)', 'Category (optional)', 'پۆل (ئارەزوومەندانە)'],
  iq_later: [
    'هذا يكفي الآن. الوحدات الأخرى والصورة والعلامة التجارية تُضاف لاحقاً من صفحة المواد.',
    'This is enough for now. Other units, a picture and the brand can be added later on the Items page.',
    'ئەمە بۆ ئێستا بەسە. یەکەکانی تر و وێنە و براند دواتر لە پەڕەی کاڵاکان زیاد دەکرێن.'
  ],
  iq_noStockYet: [
    'المادة الجديدة لا رصيد لها في المخزن: أضِف رصيدها من صفحتها («تصحيح المخزون») أو بفاتورة شراء قبل بيعها.',
    'A new item has nothing in stock: add its stock on its page (“Correct stock”) or with a purchase before it is sold.',
    'کاڵای نوێ هیچ بڕێکی لە کۆگادا نییە: پێش فرۆشتنی، لە پەڕەکەیەوە («ڕاستکردنەوەی کۆگا») یان بە پسوولەی کڕین بڕی کۆگاکەی زیاد بکە.'
  ],
  iq_added: ['أُضيفت المادة {name} ({code})', 'Item {name} added ({code})', 'کاڵای {name} زیادکرا ({code})'],
  iq_pricesHint: ['بالوحدة الأساسية: {u}', 'Per base unit: {u}', 'بۆ یەکەی بنەڕەتی: {u}'],

  // correcting an item's stock from its page
  sc_title: ['تصحيح المخزون', 'Correct stock', 'ڕاستکردنەوەی کۆگا'],
  sc_help: [
    'قل كم يوجد الآن، أو كم تضيف أو تُخرج، ولماذا. يُعمل المستند المناسب ويُرحَّل، فتبقى الحسابات ومتوسط الكلفة والتقارير صحيحة.',
    'Say how much is there now, or how much to add or take out, and why. The matching document is made and posted, so the books, the average cost and the reports stay right.',
    'بڵێ ئێستا چەندی لێیە، یان چەند زیاد یان دەر دەکەیت، و بۆچی. بەڵگەنامەی گونجاو دروست و تەرحیل دەکرێت، بۆیە هەژمارەکان و تێکڕای تێچوو و ڕاپۆرتەکان ڕاست دەمێننەوە.'
  ],
  sc_onBooks: ['في الدفاتر الآن', 'On the books now', 'ئێستا لە هەژمارەکاندا'],
  sc_modeSet: ['العدد الموجود', 'Counted quantity', 'بڕی ژمێردراو'],
  sc_modeChange: ['إضافة أو إخراج', 'Add or take out', 'زیادکردن یان دەرکردن'],
  sc_counted: ['كم يوجد الآن', 'How many there are now', 'ئێستا چەندی لێیە'],
  sc_qty: ['الكمية', 'Quantity', 'بڕ'],
  sc_after: ['بعد التصحيح', 'After the correction', 'دوای ڕاستکردنەوە'],
  sc_r_purchase_missing: ['شراء لم يُدخَل', 'Purchase not entered', 'کڕینێک کە نەنووسراوە'],
  sc_r_found: ['وُجد في الجرد', 'Found in a count', 'لە جەرددا دۆزرایەوە'],
  sc_r_damaged: ['تالف', 'Damaged', 'تەلەف'],
  sc_r_lost: ['مفقود', 'Lost', 'ونبوو'],
  sc_r_opening: ['رصيد أول المدة', 'Opening stock', 'کاڵای سەرەتا'],
  sc_r_other: ['أخرى', 'Other', 'هی تر'],
  sc_x_purchase_missing: [
    'تدخل بالكلفة التي تكتبها، وقيمتها إلى حساب الزيادة (إيرادات أخرى). اختر المجهز لتُعمل بدلاً من ذلك فاتورة شراء آجلة على حسابه.',
    'Comes in at the cost you write, its value to the surplus account (other revenue). Pick the supplier to make a credit purchase invoice on their account instead.',
    'بەو تێچووەی دەینووسیت دێتە ژوورەوە، بەهاکەی بۆ هەژماری زیادە (داهاتی تر). دابینکەر هەڵبژێرە بۆ ئەوەی لە جیاتی ئەوە پسوولەی کڕینی قەرز لەسەر هەژمارەکەی دروست بکرێت.'
  ],
  sc_x_supplier: [
    'تُعمل فاتورة شراء آجلة على حساب المجهز وتُرحَّل: المخزن مدين والمجهز دائن.',
    'A credit purchase invoice on the supplier’s account is made and posted: the warehouse is debited, the supplier credited.',
    'پسوولەی کڕینی قەرز لەسەر هەژماری دابینکەر دروست و تەرحیل دەکرێت: کۆگا قەرزارە و دابینکەر بەستانکار.'
  ],
  sc_x_found: [
    'تسوية «فرق جرد»: الزيادة بمتوسط الكلفة إلى حساب الزيادة، والنقص إلى حساب نقص الجرد.',
    'A “Count difference” adjustment: a surplus at the average cost to the surplus account, a shortage to the count-shortage account.',
    'ڕاستکردنەوەی «جیاوازیی جەرد»: زیادە بە تێکڕای تێچوو بۆ هەژماری زیادە، کەمی بۆ هەژماری کەمیی جەرد.'
  ],
  sc_x_damaged: [
    'تسوية «تالف»: إخراج فقط، بمتوسط الكلفة إلى حساب الخسائر.',
    'A “Damaged” adjustment: taking out only, at the average cost, to the losses account.',
    'ڕاستکردنەوەی «تەلەف»: تەنها دەرکردن، بە تێکڕای تێچوو، بۆ هەژماری زیانەکان.'
  ],
  sc_x_lost: [
    'تسوية «مفقود»: إخراج فقط، بمتوسط الكلفة إلى حساب الخسائر.',
    'A “Lost” adjustment: taking out only, at the average cost, to the losses account.',
    'ڕاستکردنەوەی «ونبوو»: تەنها دەرکردن، بە تێکڕای تێچوو، بۆ هەژماری زیانەکان.'
  ],
  sc_x_opening: [
    'مستند «بضاعة أول المدة»: إدخال فقط، بالكلفة التي تكتبها، مقابل رأس المال (21).',
    'An “Opening stock” document: adding only, at the cost you write, against capital (21).',
    'بەڵگەنامەی «کاڵای سەرەتا»: تەنها زیادکردن، بەو تێچووەی دەینووسیت، بەرامبەر سەرمایە (21).'
  ],
  sc_x_other: [
    'تسوية «أخرى»: اكتب السبب. الإخراج إلى حساب الخسائر، والإدخال إلى حساب الزيادة.',
    'An “Other” adjustment: write why. Taking out goes to losses, adding to the surplus account.',
    'ڕاستکردنەوەی «هی تر»: بنووسە بۆچی. دەرکردن بۆ زیانەکان دەچێت، زیادکردن بۆ هەژماری زیادە.'
  ],
  sc_unitCost: ['كلفة الوحدة', 'Unit cost', 'تێچووی یەکە'],
  sc_costAverage: ['فارغة: بمتوسط الكلفة', 'Empty: at the average cost', 'بەتاڵ: بە تێکڕای تێچوو'],
  sc_supplier: ['المجهز', 'Supplier', 'دابینکەر'],
  sc_noSupplier: ['بلا مجهز (تسوية)', 'No supplier (an adjustment)', 'بێ دابینکەر (ڕاستکردنەوە)'],
  sc_supplierNeedsPurchases: [
    'فاتورة الشراء لمن يُدخل المشتريات: بلا مجهز تُعمل تسوية.',
    'A purchase invoice is for someone who enters purchases: without a supplier an adjustment is made.',
    'پسوولەی کڕین بۆ ئەو کەسەیە کە کڕین دەنووسێت: بێ دابینکەر ڕاستکردنەوە دروست دەکرێت.'
  ],
  sc_note: ['ملاحظة', 'Note', 'تێبینی'],
  sc_noteOther: ['ملاحظة (السبب)', 'Note (why)', 'تێبینی (بۆچی)'],
  sc_save: ['تصحيح', 'Correct', 'ڕاستکردنەوە'],
  sc_done: ['صُحِّح المخزون: {doc}', 'Stock corrected: {doc}', 'کۆگا ڕاستکرایەوە: {doc}'],
  sc_waiting: [
    'حُفظت مسودة تنتظر المصادقة: يرحّلها مصادق آخر من صفحة تسوية المخزون. لم يتغير المخزون بعد.',
    'Saved as a draft that waits for approval: another approver posts it on the Stock adjustments page. The stock has not changed yet.',
    'وەک ڕەشنووسێک پاشەکەوت کرا کە چاوەڕێی پەسەندکردنە: پەسەندکەرێکی تر لە پەڕەی ڕاستکردنەوەی کۆگاوە تەرحیلی دەکات. کۆگا هێشتا نەگۆڕاوە.'
  ],
  sc_waitingOpening: [
    'حُفظت مسودة تنتظر المصادقة: يرحّلها مصادق آخر من صفحة مستندات المخزن. لم يتغير المخزون بعد.',
    'Saved as a draft that waits for approval: another approver posts it on the Stock documents page. The stock has not changed yet.',
    'وەک ڕەشنووسێک پاشەکەوت کرا کە چاوەڕێی پەسەندکردنە: پەسەندکەرێکی تر لە پەڕەی بەڵگەنامەکانی کۆگاوە تەرحیلی دەکات. کۆگا هێشتا نەگۆڕاوە.'
  ],
  sc_lastDone: ['آخر تصحيح', 'Last correction', 'دوایین ڕاستکردنەوە'],
  sc_openDoc: ['فتح المستند', 'Open the document', 'کردنەوەی بەڵگەنامە'],
  src_adjustment: ['تسوية مخزون', 'Stock adjustment', 'ڕاستکردنەوەی کۆگا'],
  src_adjustment_cancel: ['إلغاء تسوية مخزون', 'Stock adjustment cancelled', 'هەڵوەشاندنەوەی ڕاستکردنەوەی کۆگا'],
  err_correction_no_change: ['لا تغيير: هذه هي الكمية في الدفاتر أصلاً.', 'No change: that is what the books already say.', 'هیچ گۆڕانێک نییە: ئەمە هەمان ئەو بڕەیە کە لە هەژمارەکاندایە.'],
  err_correction_out_only_reason: ['هذا السبب للإخراج فقط.', 'This reason is for taking out only.', 'ئەم هۆکارە تەنها بۆ دەرکردنە.'],
  err_correction_in_only_reason: ['هذا السبب للإدخال فقط.', 'This reason is for adding only.', 'ئەم هۆکارە تەنها بۆ زیادکردنە.'],
  err_note_required_note: ['اكتب السبب في الملاحظة.', 'Write the reason in the note.', 'هۆکارەکە لە تێبینیدا بنووسە.'],
  err_line_price_invalid_unitCost: ['اكتب كلفة الوحدة.', 'Enter the unit cost.', 'تێچووی یەکە بنووسە.'],
  err_line_qty_invalid_qtyMilli: ['اكتب كمية صحيحة.', 'Enter a valid quantity.', 'بڕێکی دروست بنووسە.'],
  err_party_invalid_supplierId: ['اختر مجهزاً فعّالاً.', 'Choose an active supplier.', 'دابینکەرێکی چالاک هەڵبژێرە.']
} as const;
