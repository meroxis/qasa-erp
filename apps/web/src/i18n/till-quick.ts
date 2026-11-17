/**
 * The till's quick buttons (every company that uses the till) and its big picture tiles (off by default; an admin turns them on in
 * Settings → Sales and point of sale → Big pictures on the till). Arabic, English and Kurdish (Sorani), in that
 * order, like i18n.ts.
 */
export const TILL_QUICK_TEXT = {
  // the row of quick buttons above the categories
  tq_quick: ['أزرار سريعة', 'Quick buttons', 'دوگمەی خێرا'],
  tq_edit: ['تعديل الأزرار', 'Edit buttons', 'دەستکاریی دوگمەکان'],
  tq_done: ['تم', 'Done', 'تەواو'],
  tq_editHint: [
    'اضغط على مادة في الأسفل لإضافتها إلى الأزرار السريعة أو إزالتها (★ = عليها). حتى {n} زراً.',
    'Tap an item below to put it on the quick buttons or take it off (★ = on them). The row holds {n} at most.',
    'کاڵایەک لە خوارەوە دابگرە بۆ دانانی لەسەر دوگمە خێراکان یان لابردنی (★ = لەسەریانە). تا {n} دوگمە.'
  ],
  tq_empty: [
    'لا أزرار سريعة بعد: ضع هنا ما يُباع طوال اليوم، ليُباع بضغطة واحدة.',
    'No quick buttons yet: put here what sells all day, to sell it with one tap.',
    'هێشتا دوگمەی خێرا نییە: ئەوەی بە درێژایی ڕۆژ دەفرۆشرێت لێرە دابنێ، بۆ ئەوەی بە یەک دوگمە بفرۆشرێت.'
  ],
  tq_full: [
    'الأزرار السريعة ممتلئة ({n}). أزل زراً قبل إضافة آخر.',
    'The quick buttons are full ({n}). Take one off before adding another.',
    'دوگمە خێراکان پڕن ({n}). یەکێک لاببە پێش زیادکردنی یەکێکی تر.'
  ],
  tq_moveBack: ['تحريك إلى الخلف', 'Move back', 'بردنە دواوە'],
  tq_moveForward: ['تحريك إلى الأمام', 'Move forward', 'بردنە پێشەوە'],
  tq_offlineEdit: [
    'تُعدَّل الأزرار السريعة حين يتصل هذا الحاسوب بالخادم.',
    'The quick buttons can be edited once this PC reaches the server.',
    'دوگمە خێراکان دەستکاری دەکرێن کاتێک ئەم کۆمپیوتەرە بە سێرڤەرەکە دەگات.'
  ],

  // Settings → Sales and point of sale
  tq_bigTitle: ['صور كبيرة في نقطة البيع', 'Big pictures on the till', 'وێنەی گەورە لە خاڵی فرۆشتن'],
  tq_bigHelp: [
    'للشركة كلها وعلى كل الحواسيب. مربعات المواد في نقطة البيع بصورة كبيرة وسعر واضح، حتى يشير الزبون إلى ما يريد. المواد بلا صورة تظهر بحروفها الأولى.',
    'For the whole company, on every PC. The till’s item tiles with a large picture and a clear price, so a customer can point at what they want. Items without a picture show their initials.',
    'بۆ هەموو کۆمپانیاکە و لەسەر هەموو کۆمپیوتەرەکان. چوارگۆشەی کاڵاکان لە خاڵی فرۆشتن بە وێنەیەکی گەورە و نرخێکی ڕوون، بۆ ئەوەی کڕیار ئاماژە بەوە بکات کە دەیەوێت. کاڵای بێ وێنە بە پیتە سەرەتاییەکانی دەردەکەوێت.'
  ],
  tq_bigOn: ['صور كبيرة', 'Big pictures', 'وێنەی گەورە'],
  tq_bigOff: ['مربعات عادية', 'Normal tiles', 'چوارگۆشەی ئاسایی'],
  tq_bigOldServer: [
    'حدّث قاصة ERP على حاسوب خادم المكتب لتغيير هذا الخيار.',
    'Update Qasa ERP on the office server PC to change this.',
    'قاسە ERP لەسەر کۆمپیوتەری سێرڤەری نووسینگە نوێ بکەرەوە بۆ گۆڕینی ئەمە.'
  ],

  // what the server answers to a list it refuses
  err_pos_quick_items_invalid: [
    'قائمة الأزرار السريعة غير صالحة (حتى 24 مادة، كل مادة مرة واحدة).',
    'That list of quick buttons can’t be saved (up to 24 items, each once).',
    'ئەم لیستەی دوگمە خێراکان پاشەکەوت ناکرێت (تا 24 کاڵا، هەر کاڵایەک یەک جار).'
  ],
  err_pos_quick_item_not_on_sale: [
    'إحدى المواد لم تعد موجودة أو صارت موقوفة. حدّث الصفحة واختر من جديد.',
    'One of the items no longer exists or was made inactive. Reload the page and choose again.',
    'یەکێک لە کاڵاکان ئیتر نییە یان ناچالاک کراوە. پەڕەکە نوێ بکەرەوە و دووبارە هەڵبژێرە.'
  ],
  err_pos_big_pictures_invalid: [
    'اختر صوراً كبيرة أو مربعات عادية.',
    'Choose big pictures or normal tiles.',
    'وێنەی گەورە یان چوارگۆشەی ئاسایی هەڵبژێرە.'
  ]
} as const satisfies Record<string, readonly [string, string, string]>;
