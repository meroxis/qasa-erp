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
  pay_paidOnline: ['مدفوعة إلكترونياً', 'Paid online', 'بە ئۆنلاین دراوە'],
  pay_payments: ['الدفعات', 'Payments', 'پارەدانەکان'],
  pay_reference: ['المرجع', 'Reference', 'سەرچاوە'],
  err_reference_taken: ['هذا المرجع مستعمل لدفعة أخرى.', 'That reference is already used by another payment.', 'ئەو سەرچاوەیە بۆ پارەدانێکی تر بەکارهاتووە.'],
  err_currency_mismatch: ['عملة الدفعة غير عملة الطلب.', 'The payment is not in the order’s currency.', 'دراوی پارەدانەکە دراوی داواکارییەکە نییە.'],
  err_overpayment: ['المبلغ أكبر مما تبقى على الطلب.', 'The amount is more than the order still owes.', 'بڕەکە زیاترە لەوەی لەسەر داواکارییەکە ماوە.'],
  err_order_cancelled: ['الطلب ملغى.', 'The order is cancelled.', 'داواکارییەکە هەڵوەشاوەتەوە.'],
  err_payment_account_missing: ['لا يوجد حساب لطريقة الدفع هذه.', 'There is no account for this payment method.', 'هیچ هەژمارێک بۆ ئەم ڕێگای پارەدانە نییە.']
} as const;
