/** Slow sellers and dead stock, profit by category and brand, and shelf labels to reprint (1.7). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const SMR_TEXT = {
  // the report tabs
  smr_tabSlow: ['البضاعة الراكدة وبطيئة البيع', 'Slow sellers & dead stock', 'کاڵای ڕاوەستاو و هێواش فرۆشراو'],
  smr_tabProfitCategories: ['الربح حسب التصنيف', 'Profit by category', 'قازانج بەپێی پۆل'],
  smr_tabProfitBrands: ['الربح حسب الماركة', 'Profit by brand', 'قازانج بەپێی براند'],

  // slow sellers and dead stock
  smr_mode: ['ما يُعرض', 'Show', 'پیشاندان'],
  smr_mode_dead: ['راكدة: لم يُبع منها شيء', 'Dead stock: nothing sold', 'ڕاوەستاو: هیچی لێ نەفرۆشراوە'],
  smr_mode_slow: ['بطيئة البيع: تكفي مدة طويلة', 'Slow sellers: stock lasts too long', 'هێواش فرۆشراو: کاتێکی زۆر بەس دەکات'],
  smr_days: ['خلال آخر', 'In the last', 'لە ماوەی دوایین'],
  smr_daysN: ['{n} يوماً', '{n} days', '{n} ڕۆژ'],
  smr_daysN__one: ['يوم واحد', '{n} day', '{n} ڕۆژ'],
  smr_daysCustom: ['مدة أخرى…', 'Other…', 'ماوەیەکی تر…'],
  smr_daysCount: ['عدد الأيام', 'Number of days', 'ژمارەی ڕۆژەکان'],
  smr_cover: ['تكفي أكثر من (يوم)', 'Lasts more than (days)', 'زیاتر لە (ڕۆژ) بەس دەکات'],
  smr_allWarehouses: ['كل المخازن', 'All warehouses', 'هەموو کۆگاکان'],
  smr_allCategories: ['كل التصنيفات', 'All categories', 'هەموو پۆلەکان'],
  smr_includeNew: ['مع الأصناف الجديدة (دخلت خلال المدة)', 'Include new items (first stocked in the period)', 'لەگەڵ کاڵا نوێکان (لەم ماوەیەدا هاتوون)'],
  smr_onHand: ['الرصيد', 'On hand', 'بڕی بەردەست'],
  smr_valueTied: ['قيمة المخزون', 'Stock value', 'نرخی کۆگا'],
  smr_soldIn: ['المباع في المدة', 'Sold in period', 'فرۆشراو لەم ماوەیەدا'],
  smr_lastSale: ['آخر بيع', 'Last sale', 'دوایین فرۆشتن'],
  smr_never: ['لم يُبع', 'Never sold', 'هەرگیز نەفرۆشراوە'],
  smr_idle: ['أيام بلا بيع', 'Days without a sale', 'ڕۆژ بێ فرۆشتن'],
  smr_coverDays: ['يكفي (يوم)', 'Days of cover', 'بەس دەکات (ڕۆژ)'],
  smr_category: ['التصنيف', 'Category', 'پۆل'],
  smr_totalTied: ['{n} صنفاً، قيمتها {v}', '{n} items, worth {v}', '{n} کاڵا، بە نرخی {v}'],
  smr_totalTied__one: ['صنف واحد، قيمته {v}', '{n} item, worth {v}', '{n} کاڵا، بە نرخی {v}'],
  smr_totalItems__one: ['صنف واحد', '{n} item', '{n} کاڵا'],
  smr_totalItems: ['{n} صنفاً', '{n} items', '{n} کاڵا'],
  smr_slowHelp: [
    'الراكدة: أصناف في المخزن لم يُبع منها شيء خلال المدة (بعد طرح المرتجعات). بطيئة البيع: بِيع منها شيء، لكن الرصيد بسرعة البيع هذه يكفي أكثر من الأيام المختارة. القيمة بمتوسط الكلفة. الصنف الذي دخل المخزن أول مرة خلال المدة لا يظهر إلا إذا طلبته.',
    'Dead stock: items in stock with nothing sold in the period (returns taken off). Slow sellers: something sold, but at that pace what is held lasts longer than the days chosen. Value is at average cost. An item first stocked during the period is left out unless you ask for it.',
    'ڕاوەستاو: ئەو کاڵایانەی لە کۆگادان و لەم ماوەیەدا هیچیان لێ نەفرۆشراوە (دوای لابردنی گەڕاوەکان). هێواش فرۆشراو: شتێکیان لێ فرۆشراوە، بەڵام بەم خێراییە بڕی بەردەست زیاتر لە ڕۆژە هەڵبژێردراوەکان بەس دەکات. نرخ بە تێکڕای تێچووە. کاڵایەک کە یەکەمجار لەم ماوەیەدا هاتۆتە کۆگا دەرناکەوێت مەگەر داوای بکەیت.'
  ],
  smr_sortBy: ['الترتيب حسب', 'Sort by', 'ڕیزکردن بەپێی'],
  smr_sort_profit: ['الربح', 'Profit', 'قازانج'],
  smr_sort_margin: ['هامش الربح', 'Margin', 'ڕێژەی قازانج'],
  smr_sort_sales: ['المبيعات', 'Sales', 'فرۆشتن'],

  // shelf labels to reprint (the labels page)
  smr_changedTitle: ['أسعار تغيّرت: ملصقات الرفوف', 'Prices changed: shelf labels', 'نرخی گۆڕاو: لێبڵی ڕەفەکان'],
  smr_changedHelp: [
    'كل صنف تغيّر سعره، أو أُضيف جديداً، يبقى هنا حتى تطبع ملصق رفّه وتؤكد ذلك.',
    'Every item whose price changed, or that is new, waits here until its shelf label is printed and you confirm it.',
    'هەر کاڵایەک کە نرخی گۆڕاوە، یان نوێ زیادکراوە، لێرە دەمێنێتەوە تا لێبڵی ڕەفەکەی چاپ دەکەیت و پشتڕاستی دەکەیتەوە.'
  ],
  smr_changedCount: ['{n} ملصق بانتظار الطباعة', '{n} labels waiting to be printed', '{n} لێبڵ چاوەڕێی چاپن'],
  smr_changedCount__one: ['ملصق واحد بانتظار الطباعة', '{n} label waiting to be printed', '{n} لێبڵ چاوەڕێی چاپە'],
  smr_changedNone: ['كل ملصقات الرفوف مطابقة للأسعار.', 'Every shelf label matches its price.', 'هەموو لێبڵی ڕەفەکان لەگەڵ نرخەکان یەکدەگرنەوە.'],
  smr_addChanged: ['أضفها كلها للطباعة', 'Add them all to print', 'هەموویان بۆ چاپ زیاد بکە'],
  smr_markPrinted: ['طُبعت: أزلها من القائمة', 'Printed: take them off the list', 'چاپکران: لە لیستەکە لایانبە'],
  smr_printedDone: ['أُزيل {n} من القائمة.', '{n} taken off the list.', '{n} لە لیستەکە لابران.'],
  smr_new: ['جديد', 'New', 'نوێ'],
  smr_was: ['كان', 'Was', 'پێشتر'],
  smr_showOld: ['اطبع السعر القديم مشطوباً', 'Print the old price crossed out', 'نرخی کۆن بە هێڵ لێدراوی چاپ بکە'],
  // the audit log: labels marked printed
  e_shelf_labels: ['ملصقات الرفوف', 'Shelf labels', 'لێبڵی ڕەفەکان'],
  lb_size_a4_shelf_3x7: ['ورقة A4، ‏21 ملصق رف (3 × 7)', 'A4 sheet, 21 shelf labels (3 × 7)', 'پەڕەی A4، ‏21 لێبڵی ڕەف (3 × 7)']
} as const;
