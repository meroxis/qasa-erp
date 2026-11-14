/** The item form of 1.4: one name, the picture, the purchase price, units by trade, and the market. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const ITEMS14_TEXT = {
  it_name: ['اسم المادة', 'Item name', 'ناوی کاڵا'],
  it_namesDiffer: [
    'لهذه المادة اسم مختلف في كل لغة — عرض الأسماء',
    'This item has a different name in each language — show them',
    'ئەم کاڵایە لە هەر زمانێکدا ناوێکی جیاوازی هەیە — پیشانیان بدە'
  ],
  it_namesOne: ['اسم واحد لكل اللغات', 'One name for every language', 'یەک ناو بۆ هەموو زمانەکان'],
  it_purchasePrice: ['سعر الشراء', 'Purchase price', 'نرخی کڕین'],
  it_margin: ['الربح: {a} ({p}٪)', 'Profit: {a} ({p}%)', 'قازانج: {a} ({p}٪)'],
  it_marginLoss: ['خسارة: {a} ({p}٪)', 'Loss: {a} ({p}%)', 'زیان: {a} ({p}٪)'],
  it_picture: ['صورة المادة', 'Item picture', 'وێنەی کاڵا'],
  it_pictureTooBig: [
    'ملف الصورة كبير جداً (الحد {n} ميغابايت).',
    'The picture file is too large ({n} MB at most).',
    'فایلی وێنەکە زۆر گەورەیە (زۆرترین {n} مێگابایت).'
  ],
  it_pictureNotSaved: [
    'حُفظت المادة، لكن صورتها لم تُحفظ. أضفها من بطاقة المادة.',
    'The item was saved, but its picture was not. Add it from the item’s page.',
    'کاڵاکە پاشەکەوت کرا، بەڵام وێنەکەی نا. لە پەڕەی کاڵاکەوە زیادی بکە.'
  ],
  un_showAll: ['عرض كل الوحدات', 'Show all units', 'هەموو یەکەکان پیشان بدە'],
  un_showMine: ['وحدات نشاطي فقط', 'Only my trade’s units', 'تەنها یەکەکانی کارەکەم'],
  un_choose: ['اختر الوحدة…', 'Choose the unit…', 'یەکە هەڵبژێرە…'],
  un_equals: ['1 {u} = {q} {b}', '1 {u} = {q} {b}', '1 {u} = {q} {b}'],
  un_added: ['الوحدات المضافة', 'Units added', 'یەکە زیادکراوەکان'],
  un_incomplete: [
    'أكمل الوحدة: اختر الوحدة واكتب كم {b} فيها، أو احذف السطر.',
    'Finish the unit: choose the unit and enter how many {b} it holds, or remove the line.',
    'یەکەکە تەواو بکە: یەکە هەڵبژێرە و بنووسە چەند {b}ی تێدایە، یان ڕیزەکە لابە.'
  ],
  it_scaleHint: [
    'للبيع بالوزن من ملصق الميزان: اجعل باركود المادة 7 أرقام تبدأ بـ 2 (مثل 2100017)، فتقرأ نقطة البيع الوزن من الملصق.',
    'To sell by weight from a scale label: give the item a 7-digit barcode starting with 2 (such as 2100017); the till then reads the weight from the label.',
    'بۆ فرۆشتن بە کێش لە لێبڵی تەرازووەوە: بارکۆدی کاڵاکە بکە بە 7 ژمارە کە بە 2 دەست پێدەکات (وەک 2100017)، ئینجا خاڵی فرۆشتن کێشەکە لە لێبڵەکە دەخوێنێتەوە.'
  ],
  bt_market: ['ماركت / سوبرماركت', 'Market / Supermarket', 'مارکێت / سوپەرمارکێت'],
  bt_marketText: [
    'البيع بالباركود من نقطة البيع، مواد بالوزن (كغم)، تواريخ الصلاحية، والكارتون والباكيت والقطعة.',
    'Selling by barcode at the till, items by weight (kg), expiry dates, and cartons, packs and pieces.',
    'فرۆشتن بە بارکۆد لە خاڵی فرۆشتن، کاڵا بە کێش (کیلۆ)، بەرواری بەسەرچوون، و کارتۆن و پاکەت و دانە.'
  ],
  err_purchase_price_invalid: ['سعر الشراء غير صحيح', 'Invalid purchase price', 'نرخی کڕین دروست نییە']
} as const;
