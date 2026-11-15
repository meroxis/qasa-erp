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
  iq_pricesCurrency: ['عملة السعرين', 'Currency of the prices', 'دراوی نرخەکان'],
  iq_addScale: ['إضافة مادة موزونة لملصق الميزان {code}', 'Add a weighed item for scale label {code}', 'کاڵایەکی کێشراو بۆ لەیبڵی تەرازووی {code} زیاد بکە'],
  iq_scaleHint: [
    'ملصق ميزان: باركود المادة أول سبعة أرقام منه ({p}) ووحدتها الكيلوغرام، فكل ملصق لها يجدها بوزنه.',
    'A scale label: the item’s barcode is its first seven digits ({p}) and its unit the kilogram, so every label of it finds it, with its own weight.',
    'لەیبڵی تەرازوو: بارکۆدی کاڵاکە حەوت ژمارەی یەکەمیەتی ({p}) و یەکەکەی کیلۆگرامە، بۆیە هەموو لەیبڵێکی بە کێشی خۆیەوە دەیدۆزێتەوە.'
  ],
  iq_sameItem: ['توجد مادة بالاسم نفسه أو الرمز أو الباركود نفسه:', 'An item with the same name, code or barcode already exists:', 'کاڵایەک بە هەمان ناو، کۆد یان بارکۆد پێشتر هەیە:'],
  iq_sameStock: [
    'باختيار إحداها يصبح رصيدها في هذا المخزن ما كتبته في «الموجود الآن».',
    'Choosing one sets its stock in this warehouse to what you entered in “In stock now”.',
    'بە هەڵبژاردنی یەکێکیان، بڕی کۆگای لەم کۆگایەدا دەبێتە ئەوەی لە «ئێستا لە کۆگادا» نووسیوتە.'
  ],
  iq_inCategory:['في {c}', 'in {c}', 'لە {c}'],
  iq_stockNow: ['الموجود الآن (اختياري)', 'In stock now (optional)', 'ئێستا لە کۆگادا (ئارەزوومەندانە)'],
  iq_stockNowHint: [
    'ما على الرف الآن: يُدخَل بضاعةَ أول المدة (رأس المال) بسعر الشراء، فتُباع المادة فوراً.',
    'What is on the shelf now: it is entered as opening stock (capital) at the purchase price, so the item can be sold at once.',
    'ئەوەی ئێستا لەسەر ڕەفەکەیە: وەک کاڵای سەرەتا (سەرمایە) بە نرخی کڕین دەنووسرێت، بۆیە کاڵاکە یەکسەر دەفرۆشرێت.'
  ],
  // an office server before 1.4.2 (no stock correction there): the item goes on the line without the stock typed
  iq_stockOldServer: [
    'وُضعت المادة في السطر، لكن الكمية المكتوبة لم تُدخَل في المخزون: حاسوب خادم المكتب على إصدار أقدم من 1.4.2. حدّثه ثم صحّح مخزون المادة من صفحتها.',
    'The item goes on the line, but the stock typed wasn’t entered: the office server PC is on a version before 1.4.2. Update it, then correct the item’s stock from its page.',
    'کاڵاکە خرایە سەر ڕیزەکە، بەڵام بڕە نووسراوەکە لە کۆگادا نەنووسرا: کۆمپیوتەری سێرڤەری نووسینگە لەسەر وەشانێکی پێش 1.4.2 یە. نوێی بکەرەوە، ئینجا کۆگای کاڵاکە لە پەڕەکەیەوە ڕاست بکەرەوە.'
  ],
  iq_stockNeedsPrice: ['اكتب سعر الشراء: به يُدخَل الرصيد.', 'Enter the purchase price: the stock is entered at it.', 'نرخی کڕین بنووسە: بڕی کۆگا بەو نرخە دەنووسرێت.'],
  iq_stockWaiting: [
    'أُضيفت المادة. رصيدها مسودة تنتظر المصادقة (يرحّلها مصادق آخر من صفحة مستندات المخزن)، ولا تُباع قبل ذلك.',
    'The item was added. Its stock is a draft that waits for approval (another approver posts it on the Stock documents page); it cannot be sold before that.',
    'کاڵاکە زیادکرا. بڕی کۆگاکەی ڕەشنووسێکە و چاوەڕێی پەسەندکردنە (پەسەندکەرێکی تر لە پەڕەی بەڵگەنامەکانی کۆگاوە تەرحیلی دەکات)؛ پێش ئەوە نافرۆشرێت.'
  ],
  iq_stockFailed: ['أُضيفت المادة، لكن رصيدها لم يُحفظ. حاول مرة أخرى.', 'The item was added, but its stock was not saved. Try again.', 'کاڵاکە زیادکرا، بەڵام بڕی کۆگاکەی پاشەکەوت نەکرا. دووبارە هەوڵ بدەرەوە.'],
  // the stock entry's try got no answer: the same entry is sent again with its key (the button is sc_tryAgain)
  iq_stockUnsure: [
    'لم يؤكّد الخادم إدخال الرصيد، فربما أُدخل من قبل. اضغط «أعد المحاولة» عند عودة الاتصال: الإدخال نفسه لا يُعمل إلا مرة واحدة. ولا يمكن تغيير شيء في هذا النموذج قبل ذلك؛ وإن أغلقته فراجع حركات المادة والمسودات التي تنتظر المصادقة قبل أن تُدخل رصيدها مرة أخرى.',
    'The server didn’t confirm the stock entry, so it may already be made. Press Try again once the link is back: the same entry is made only once. Until then nothing in this form can be changed; if you close it, check the item’s stock moves and the drafts waiting for approval before you enter its stock again.',
    'سێرڤەرەکە نووسینی بڕی کۆگای پشتڕاست نەکردەوە، بۆیە لەوانەیە پێشتر نووسرابێت. کاتێک پەیوەندی گەڕایەوە «دووبارە هەوڵ بدەرەوە» دابگرە: هەمان نووسین تەنها یەک جار دەکرێت. تا ئەو کاتە هیچ شتێک لەم فۆڕمەدا ناگۆڕدرێت؛ ئەگەر دایبخەیت، پێش ئەوەی دووبارە بڕی کۆگاکەی بنووسیت جووڵەکانی کاڵاکە و ئەو ڕەشنووسانەی چاوەڕێی پەسەندکردنن ببینە.'
  ],
  iq_continue: ['متابعة', 'Continue', 'بەردەوامبوون'],
  iq_expiryNeeded: ['اكتب تاريخ الانتهاء لما على الرف.', 'Enter the expiry date of what is on the shelf.', 'بەرواری بەسەرچوونی ئەوەی لەسەر ڕەفەکەیە بنووسە.'],
  pos_noItemNamed: ['لا توجد مادة تطابق «{n}»', 'No item matches “{n}”', 'هیچ کاڵایەک لەگەڵ «{n}» ناگونجێت'],

  // correcting an item's stock from its page
  sc_title: ['تصحيح المخزون', 'Correct stock', 'ڕاستکردنەوەی کۆگا'],
  sc_help: [
    'قل كم يوجد الآن، أو كم تضيف أو تُخرج، ولماذا. يُعمل المستند المناسب ويُرحَّل (وحيث يصادق شخص آخر، ينتظر مصادقته)، فتبقى الحسابات ومتوسط الكلفة والتقارير صحيحة.',
    'Say how much is there now, or how much to add or take out, and why. The matching document is made and posted (where another person approves, it waits for their approval), so the books, the average cost and the reports stay right.',
    'بڵێ ئێستا چەندی لێیە، یان چەند زیاد یان دەر دەکەیت، و بۆچی. بەڵگەنامەی گونجاو دروست و تەرحیل دەکرێت (لە شوێنێک کە کەسێکی تر پەسەندی دەکات، چاوەڕێی پەسەندکردنی ئەو دەکات)، بۆیە هەژمارەکان و تێکڕای تێچوو و ڕاپۆرتەکان ڕاست دەمێننەوە.'
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
    'بضاعة اشتُريت ولم تُدخَل: تُعمل لها فاتورة شراء كما في صفحة المشتريات. اختر كيف دُفع ثمنها.',
    'Goods that were bought and never entered: a purchase invoice is made for them, as on the Purchases page. Choose how they were paid for.',
    'کاڵایەک کە کڕدراوە و نەنووسراوە: پسوولەی کڕینی بۆ دروست دەکرێت، وەک لە پەڕەی کڕین. هەڵبژێرە چۆن پارەکەی دراوە.'
  ],
  sc_x_supplier: [
    'تُعمل فاتورة شراء آجلة: يصبح هذا المبلغ ديناً عليك للمجهز.',
    'A credit purchase invoice is made: you owe the supplier this amount.',
    'پسوولەی کڕینی قەرز دروست دەکرێت: ئەم بڕە پارەیە قەرزی دابینکەرە لەسەرت.'
  ],
  sc_x_cash: [
    'تُعمل فاتورة شراء نقدية: يخرج هذا المبلغ من القاصة التي تختارها.',
    'A cash purchase invoice is made: this amount leaves the safe you choose.',
    'پسوولەی کڕینی نەقد دروست دەکرێت: ئەم بڕە پارەیە لەو قاسەیە دەردەچێت کە هەڵیدەبژێریت.'
  ],
  sc_x_found: [
    'ما عُدّ على الرف. الزيادة تُحسب دخلاً إضافياً بمتوسط الكلفة فيرتفع ربحك، والنقص خسارةَ جرد فينخفض ربحك.',
    'What was counted on the shelf. More than the books counts as extra income at the average cost (your profit goes up); fewer counts as a count shortage (your profit goes down).',
    'ئەوەی لەسەر ڕەفەکە ژمێردرا. زیاتر لە هەژمارەکان وەک داهاتی زیادە بە تێکڕای تێچوو دەژمێردرێت (قازانجت زیاد دەبێت)؛ کەمتر وەک کەمیی جەرد دەژمێردرێت (قازانجت کەم دەبێت).'
  ],
  sc_x_damaged: [
    'إخراج فقط، بمتوسط الكلفة، ويُحسب خسارة فينخفض ربحك.',
    'Taking out only, at the average cost; it counts as a loss (your profit goes down).',
    'تەنها دەرکردن، بە تێکڕای تێچوو؛ وەک زیان دەژمێردرێت (قازانجت کەم دەبێت).'
  ],
  sc_x_lost: [
    'إخراج فقط، بمتوسط الكلفة، ويُحسب خسارة فينخفض ربحك.',
    'Taking out only, at the average cost; it counts as a loss (your profit goes down).',
    'تەنها دەرکردن، بە تێکڕای تێچوو؛ وەک زیان دەژمێردرێت (قازانجت کەم دەبێت).'
  ],
  sc_x_opening: [
    'تُحسب بضاعةً كانت لديك حين بدأت (رأس المال)، بالكلفة التي تكتبها. إدخال فقط، ولا يتغير ربحك.',
    'Counted as goods you had when you started (capital), at the cost you write. Adding only; your profit does not change.',
    'وەک کاڵایەک دەژمێردرێت کە کاتی دەستپێکردن هەتبوو (سەرمایە)، بەو تێچووەی دەینووسیت. تەنها زیادکردن؛ قازانجت ناگۆڕێت.'
  ],
  sc_x_other: [
    'اكتب السبب. الإخراج يُحسب خسارة، والإدخال دخلاً إضافياً، بمتوسط الكلفة.',
    'Write why. Taking out counts as a loss, adding as extra income, at the average cost.',
    'بنووسە بۆچی. دەرکردن وەک زیان دەژمێردرێت، زیادکردن وەک داهاتی زیادە، بە تێکڕای تێچوو.'
  ],
  sc_unitCost: ['كلفة الوحدة', 'Unit cost', 'تێچووی یەکە'],
  sc_costAverage: ['فارغة: بمتوسط كلفة هذا المخزن', 'Empty: at this warehouse’s average cost', 'بەتاڵ: بە تێکڕای تێچووی ئەم کۆگایە'],
  sc_costPrice: ['سعر شراء المادة: غيّره إن اشتُريت بغيره.', 'The item’s purchase price: change it if it was bought for another.', 'نرخی کڕینی کاڵاکە: بیگۆڕە ئەگەر بە نرخێکی تر کڕدراوە.'],
  sc_costNone: ['هذا المخزن لا يحوي منها شيئاً: اكتب الكلفة.', 'This warehouse holds none of it: write the cost.', 'ئەم کۆگایە هیچی لێ نییە: تێچووەکە بنووسە.'],
  sc_oldServer: [
    'حاسوب خادم المكتب على إصدار أقدم من 1.4.2، فلا يُصحَّح المخزون من هنا. حدّث قاصة ERP عليه أولاً.',
    'The office server PC is on a version before 1.4.2, so stock can’t be corrected from here. Update Qasa ERP on it first.',
    'کۆمپیوتەری سێرڤەری نووسینگە لەسەر وەشانێکی پێش 1.4.2 یە، بۆیە لێرەوە کۆگا ڕاست ناکرێتەوە. سەرەتا قاسە ERP لەسەری نوێ بکەرەوە.'
  ],
  // someone who sees no cost, when the warehouse has no average to value a surplus at
  sc_noAverageNoCost: [
    'هذا المخزن لا يحوي منها شيئاً، فلا متوسط كلفة لها فيه: يُدخلها من يرى الكلف.',
    'This warehouse holds none of it, so it has no average cost there: someone who sees costs enters it.',
    'ئەم کۆگایە هیچی لێ نییە، بۆیە تێکڕای تێچووی تێیدا نییە: ئەو کەسەی تێچوو دەبینێت دەینووسێت.'
  ],
  sc_howPaid: ['كيف دُفع ثمنها', 'How it was paid for', 'چۆن پارەکەی دراوە'],
  sc_howCredit: ['آجل (مجهز)', 'On credit (supplier)', 'قەرز (دابینکەر)'],
  sc_howCash: ['نقداً', 'Paid in cash', 'نەقد دراوە'],
  sc_supplier: ['المجهز', 'Supplier', 'دابینکەر'],
  sc_purchaseNeedsPurchases: [
    'الشراء يُدخله من يُدخل المشتريات (صفحة المشتريات): اطلبه منه. وبضاعة وُجدت على الرف في الجرد هي «وُجد في الجرد».',
    'A purchase is entered by someone who enters purchases (the Purchases page): ask them. Goods found on the shelf in a count are “Found in a count”.',
    'کڕین ئەو کەسە دەینووسێت کە کڕین دەنووسێت (پەڕەی کڕین): داوای لێ بکە. کاڵایەک کە لە جەرددا لەسەر ڕەفەکە دۆزرایەوە «لە جەرددا دۆزرایەوە»یە.'
  ],
  sc_loading: ['جارٍ التحميل…', 'Loading…', 'باردەکرێت…'],
  sc_note: ['ملاحظة', 'Note', 'تێبینی'],
  sc_noteOther: ['ملاحظة (السبب)', 'Note (why)', 'تێبینی (بۆچی)'],
  sc_save: ['تصحيح', 'Correct', 'ڕاستکردنەوە'],
  // a try whose answer never came: the same correction is sent again with its key, never a changed one
  sc_tryAgain: ['أعد المحاولة', 'Try again', 'دووبارە هەوڵ بدەرەوە'],
  sc_unsure: [
    'لم يؤكّد الخادم هذا التصحيح، فربما عُمل من قبل. اضغط «أعد المحاولة» عند عودة الاتصال: التصحيح نفسه لا يُعمل إلا مرة واحدة. ولا يمكن تغييره قبل ذلك؛ وإن أغلقته فراجع حركات المادة والمسودات التي تنتظر المصادقة قبل أن تصحّحه مرة أخرى.',
    'The server didn’t confirm this correction, so it may already be made. Press Try again once the link is back: the same correction is made only once. Until then it can’t be changed; if you close it, check the item’s stock moves and the drafts waiting for approval before you correct it again.',
    'سێرڤەرەکە ئەم ڕاستکردنەوەیەی پشتڕاست نەکردەوە، بۆیە لەوانەیە پێشتر کرابێت. کاتێک پەیوەندی گەڕایەوە «دووبارە هەوڵ بدەرەوە» دابگرە: هەمان ڕاستکردنەوە تەنها یەک جار دەکرێت. تا ئەو کاتە ناگۆڕدرێت؛ ئەگەر دایبخەیت، پێش ئەوەی دووبارە ڕاستی بکەیتەوە جووڵەکانی کاڵاکە و ئەو ڕەشنووسانەی چاوەڕێی پەسەندکردنن ببینە.'
  ],
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
  err_party_invalid_supplierId: ['اختر مجهزاً فعّالاً.', 'Choose an active supplier.', 'دابینکەرێکی چالاک هەڵبژێرە.'],
  err_purchase_how_required: ['اختر المجهز، أو القاصة التي دُفع منها.', 'Choose the supplier, or the safe it was paid from.', 'دابینکەر هەڵبژێرە، یان ئەو قاسەیەی پارەکەی لێدراوە.'],
  err_purchase_how_required_supplierId: ['اختر المجهز، أو القاصة التي دُفع منها.', 'Choose the supplier, or the safe it was paid from.', 'دابینکەر هەڵبژێرە، یان ئەو قاسەیەی پارەکەی لێدراوە.'],
  err_cash_account_invalid_cashAccountCode: ['اختر قاصة فعّالة.', 'Choose an active safe.', 'قاسەیەکی چالاک هەڵبژێرە.'],
  err_barcode_scale_label: [
    'هذا الباركود يتعارض مع ملصقات ميزان مادة موزونة (أول سبعة أرقام منه باركود تلك المادة).',
    'This barcode clashes with a weighed item’s scale labels (their first seven digits are that item’s barcode).',
    'ئەم بارکۆدە لەگەڵ لەیبڵەکانی تەرازووی کاڵایەکی کێشراو یەک دەگرێتەوە (حەوت ژمارەی یەکەمیان بارکۆدی ئەو کاڵایەیە).'
  ]
} as const;
