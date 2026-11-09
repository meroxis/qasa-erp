/** Units with conversions (1.1). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. Unit names are in core UNITS. */
export const UNIT_TEXT = {
  un_title: ['الوحدات', 'Units', 'یەکەکان'],
  un_base: ['الوحدة الأساسية', 'Base unit', 'یەکەی بنەڕەتی'],
  un_baseHelp: [
    'المخزون والكلفة والتقارير بالوحدة الأساسية دائماً. أضف وحدات أكبر (كارتون، علبة، شريط) بعدد ما فيها من الوحدة الأساسية.',
    'Stock, cost and reports are always in the base unit. Add bigger units (carton, box, strip) by how many base units each holds.',
    'کۆگا و تێچوو و ڕاپۆرتەکان هەمیشە بە یەکەی بنەڕەتین. یەکەی گەورەتر زیاد بکە (کارتۆن، قوتوو، شریت) بەپێی ئەوەی چەند یەکەی بنەڕەتی تێدایە.'
  ],
  un_other: ['وحدات أخرى', 'Other units', 'یەکەکانی تر'],
  un_holds: ['تحتوي', 'Holds', 'تێدایە'],
  un_ownPrice: ['سعرها', 'Its price', 'نرخەکەی'],
  un_ownPriceHint: ['فارغ: سعر الوحدة الأساسية × العدد', 'Empty: base price × count', 'بەتاڵ: نرخی یەکەی بنەڕەتی × ژمارە'],
  un_add: ['إضافة وحدة', 'Add a unit', 'زیادکردنی یەکە'],
  un_remove: ['حذف الوحدة', 'Remove the unit', 'لابردنی یەکە'],
  un_saleUnit: ['وحدة البيع', 'Sale unit', 'یەکەی فرۆشتن'],
  un_purchaseUnit: ['وحدة الشراء', 'Purchase unit', 'یەکەی کڕین'],
  un_inUnits: ['بالوحدات', 'In units', 'بە یەکەکان'],
  un_lineUnit: ['وحدة السطر', 'Line unit', 'یەکەی ڕیز'],
  un_baseQty: ['= {q} {u}', '= {q} {u}', '= {q} {u}'],
  err_unit_qty_fraction: [
    'السطر {n}: هذه الكمية لا تُقسم على الوحدة الأساسية؛ غيّر الكمية أو الوحدة.',
    'Line {n}: this quantity doesn’t divide into the base unit; change the quantity or the unit.',
    'ڕیزی {n}: ئەم بڕە بەسەر یەکەی بنەڕەتیدا دابەش نابێت؛ بڕەکە یان یەکەکە بگۆڕە.'
  ],
  err_unit_repeated: ['هذه الوحدة مذكورة مرتين.', 'That unit is listed twice.', 'ئەم یەکەیە دوو جار نووسراوە.'],
  err_unit_is_base: ['الوحدة الأساسية لا تُضاف مرة ثانية.', 'The base unit isn’t added again.', 'یەکەی بنەڕەتی دووبارە زیاد ناکرێت.'],
  err_unit_factor_invalid: ['اكتب كم من الوحدة الأساسية في هذه الوحدة.', 'Enter how many base units this unit holds.', 'بنووسە چەند یەکەی بنەڕەتی لەم یەکەیەدایە.'],
  err_unit_barcode_repeated: ['الباركود نفسه على وحدتين.', 'The same barcode is on two units.', 'هەمان بارکۆد لەسەر دوو یەکەیە.'],
  err_unit_price_invalid: ['سعر الوحدة غير صحيح.', 'The unit’s price isn’t valid.', 'نرخی یەکەکە دروست نییە.'],
  err_units_too_many: ['عشر وحدات أخرى على الأكثر لكل مادة.', 'At most ten other units per item.', 'بۆ هەر کاڵایەک زۆرترین دە یەکەی تر.'],
  err_sale_unit_invalid: ['وحدة البيع ليست من وحدات المادة.', 'The sale unit isn’t one of the item’s units.', 'یەکەی فرۆشتن یەکێک نییە لە یەکەکانی کاڵاکە.'],
  err_purchase_unit_invalid: ['وحدة الشراء ليست من وحدات المادة.', 'The purchase unit isn’t one of the item’s units.', 'یەکەی کڕین یەکێک نییە لە یەکەکانی کاڵاکە.'],
  err_barcode_taken: ['هذا الباركود لمادة أخرى أو لإحدى وحداتها.', 'This barcode belongs to another item or one of its units.', 'ئەم بارکۆدە هی کاڵایەکی ترە یان یەکێک لە یەکەکانی.'],
  err_unit_in_use: [
    'وحدة تحذفها مستعملة في مسودة؛ احذف المسودة أو غيّر وحدتها أولاً.',
    'A unit you are removing is used in a draft; delete the draft or change its unit first.',
    'یەکەیەک کە لای دەبەیت لە ڕەشنووسێکدا بەکارهاتووە؛ سەرەتا ڕەشنووسەکە بسڕەوە یان یەکەکەی بگۆڕە.'
  ]
} as const;
