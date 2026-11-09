/** Item categories and what Qasa Store needs from the website API (1.1). Arabic, English and Kurdish (Sorani), in that order. */
export const STORE_TEXT = {
  cat_title: ['التصنيفات', 'Categories', 'پۆلەکان'],
  cat_category: ['التصنيف', 'Category', 'پۆل'],
  cat_none: ['بلا تصنيف', 'No category', 'بێ پۆل'],
  cat_all: ['كل التصنيفات', 'All categories', 'هەموو پۆلەکان'],
  cat_new: ['تصنيف جديد', 'New category', 'پۆلی نوێ'],
  cat_help: [
    'تُرتَّب المواد في تصنيفات بالعربية والكردية والإنكليزية؛ المتجر الإلكتروني يعرض التصنيفات الفعّالة.',
    'Items are grouped in categories named in Arabic, Kurdish and English; an online shop shows the active ones.',
    'کاڵاکان لە پۆلدا ڕێکدەخرێن بە ناوی عەرەبی و کوردی و ئینگلیزی؛ دوکانی ئۆنلاین پۆلە چالاکەکان پیشان دەدات.'
  ],
  cat_order: ['الترتيب', 'Order', 'ڕیزبەندی'],
  cat_items: ['المواد', 'Items', 'کاڵاکان'],
  cat_setFor: ['تعيين التصنيف للمحدد ({n})', 'Set the category of the selected ({n})', 'دانانی پۆل بۆ هەڵبژێردراوەکان ({n})'],
  cat_set: ['تعيين', 'Set', 'دانان'],
  cat_deactivate: ['إيقاف', 'Switch off', 'ناچالاککردن'],
  cat_activate: ['تفعيل', 'Switch on', 'چالاککردن'],
  cat_saved: ['حُفظ التصنيف', 'Category saved', 'پۆلەکە پاشەکەوت کرا'],
  cat_updated: ['تغيّر تصنيف {n} مادة', '{n} items moved', 'پۆلی {n} کاڵا گۆڕا'],
  err_category_invalid: ['التصنيف غير موجود أو متوقف.', 'That category doesn’t exist or is switched off.', 'ئەو پۆلە نییە یان ناچالاکە.'],
  err_md_category_unknown: ['السطر {n}: لا يوجد تصنيف بهذا الرمز.', 'Line {n}: no category has that code.', 'ڕیزی {n}: هیچ پۆلێک ئەو کۆدەی نییە.'],
  // the website API: payments
  wa_scope_payments: ['تسجيل الدفعات الإلكترونية', 'Record online payments', 'تۆمارکردنی پارەدانی ئۆنلاین'],
  wa_scope_paymentsHelp: [
    'سند قبض مسودة لطلب الموقع، يراجعه شخص ويعتمده؛ لا يتجاوز ما تبقى على الطلب',
    'a draft receipt voucher for a website order, which a person checks and approves; never more than the order still owes',
    'سەنەدی وەرگرتنی ڕەشنووس بۆ داواکاریی ماڵپەڕ، کەسێک دەیپشکنێت و پەسەندی دەکات؛ هەرگیز زیاتر لە قەرزی ماوەی داواکارییەکە نییە'
  ],
  wa_storePreset: ['لمتجر قاصة', 'For Qasa Store', 'بۆ دوکانی قاسە'],
  wa_payAccounts: ['حسابات الدفع الإلكتروني', 'Online payment accounts', 'هەژمارەکانی پارەدانی ئۆنلاین'],
  wa_payAccountsHelp: [
    'القاصة أو المصرف (تحت 18) الذي تدخله كل طريقة دفع؛ طريقة بلا حساب تُرفض.',
    'The safe or bank (under 18) each payment method goes into; a method without one is refused.',
    'ئەو قاسە یان بانکەی (لە ژێر 18) هەر ڕێگایەکی پارەدان دەچێتە ناوی؛ ڕێگایەک بێ هەژمار ڕەت دەکرێتەوە.'
  ],
  pay_cash: ['نقداً', 'Cash', 'نەختینە'],
  pay_card: ['بطاقة', 'Card', 'کارت'],
  pay_fib: ['FIB', 'FIB', 'FIB'],
  pay_zaincash: ['زين كاش', 'ZainCash', 'زەین کاش'],
  pay_qi: ['كي كارد', 'Qi Card', 'کی کارد'],
  pay_account: ['على الحساب', 'On account', 'لەسەر هەژمار'],
  pay_other: ['أخرى', 'Other', 'هی تر'],
  pay_online: ['دفعات إلكترونية', 'Online payments', 'پارەدانی ئۆنلاین'],
  pos_left: ['المتبقي', 'Left to pay', 'ماوە بۆ دان'],
  pos_payAccounts: ['حسابات الدفع في نقطة البيع', 'Point of sale payment accounts', 'هەژمارەکانی پارەدان لە خاڵی فرۆشتن'],
  pos_payAccountsHelp: [
    'الحساب (قاصة أو مصرف تحت 18) الذي تدخله البطاقة وFIB وزين كاش وكي كارد. طريقة بلا حساب لا تظهر عند الكاشير؛ النقد يدخل قاصة الوردية، و«على الحساب» حساب الزبون.',
    'The account (a safe or bank under 18) card, FIB, ZainCash and Qi Card payments go into. A method without one is not offered at the counter; cash goes into the shift’s safe, and on account to the customer.',
    'ئەو هەژمارەی (قاسە یان بانکی ژێر 18) کە کارت و FIB و زەین کاش و کی کارد دەچێتە ناوی. ڕێگایەک بێ هەژمار لە کاشێر پیشان نادرێت؛ نەختینە دەچێتە قاسەی شیفتەکە، و «لەسەر هەژمار» بۆ هەژماری کڕیار.'
  ],
  err_payments_total_mismatch: ['مجموع الدفعات لا يساوي المبلغ الكلي.', 'The payments don’t add up to the total.', 'کۆی پارەدانەکان یەکسان نییە بە کۆی گشتی.'],
  err_pos_method_unavailable: ['طريقة الدفع هذه بلا حساب؛ يحدده المدير في الإعدادات.', 'This payment method has no account; an admin sets it in Settings.', 'ئەم ڕێگای پارەدانە هەژماری نییە؛ بەڕێوەبەر لە ڕێکخستنەکان دیاری دەکات.'],
  err_payment_invalid: ['دفعة غير صحيحة.', 'A payment isn’t valid.', 'پارەدانێک دروست نییە.'],
  err_payments_too_many: ['أربع طرق دفع على الأكثر.', 'At most four payment methods.', 'زۆرترین چوار ڕێگای پارەدان.'],
  pay_paidOnline: ['مدفوعة إلكترونياً', 'Paid online', 'بە ئۆنلاین دراوە'],
  pay_payments: ['الدفعات', 'Payments', 'پارەدانەکان'],
  pay_reference: ['المرجع', 'Reference', 'سەرچاوە'],
  err_reference_taken: ['هذا المرجع مستعمل لدفعة أخرى.', 'That reference is already used by another payment.', 'ئەو سەرچاوەیە بۆ پارەدانێکی تر بەکارهاتووە.'],
  err_currency_mismatch: ['عملة الدفعة غير عملة الطلب.', 'The payment is not in the order’s currency.', 'دراوی پارەدانەکە دراوی داواکارییەکە نییە.'],
  err_overpayment: ['المبلغ أكبر مما تبقى على الطلب.', 'The amount is more than the order still owes.', 'بڕەکە زیاترە لەوەی لەسەر داواکارییەکە ماوە.'],
  err_order_cancelled: ['الطلب ملغى.', 'The order is cancelled.', 'داواکارییەکە هەڵوەشاوەتەوە.'],
  usd_statementHint: [
    'هذه أسطر هذه العملة فقط وبمبالغها. الوصل بالدينار عن دين بالدولار يُنقص عمود الدينار ولا يغيّر عمود الدولار؛ المجموع بأسعار القيود هو المرجع.',
    'These are this currency’s lines only, in their own amounts. A receipt in dinars against a dollar debt lowers the dinar figure and leaves the dollar one; the total at the book rates is the reference.',
    'ئەمانە تەنها هێڵەکانی ئەم دراوەن، بە بڕی خۆیان. وەرگرتنێک بە دینار بۆ قەرزێکی دۆلار ستوونی دینار کەم دەکاتەوە و ستوونی دۆلار وەک خۆی دەهێڵێت؛ کۆی گشتی بە نرخی تۆمارەکان سەرچاوەیە.'
  ],
  err_payment_account_missing: ['لا يوجد حساب لطريقة الدفع هذه.', 'There is no account for this payment method.', 'هیچ هەژمارێک بۆ ئەم ڕێگای پارەدانە نییە.']
} as const;
