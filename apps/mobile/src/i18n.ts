/** Every text of the phone app in Arabic, English and Kurdish (Sorani), in that order, like the desktop app. */
export type Lang = 'ar' | 'en' | 'ku';
export const LANGS: Lang[] = ['ar', 'en', 'ku'];
export const isRtl = (lang: Lang) => lang !== 'en';

const T = {
  appName: ['قاصة ERP', 'Qasa ERP', 'قاسە ERP'],
  welcome: ['امسح، اعرف السعر والمخزون، وأضف المواد — من هاتفك.', 'Scan, check prices and stock, and add items — from your phone.', 'بخوێنەوە، نرخ و کۆگا ببینە، و کاڵا زیاد بکە — لە مۆبایلەکەتەوە.'],
  pair: ['ربط بالحاسوب', 'Pair with a PC', 'بەستنەوە بە کۆمپیوتەر'],
  pairHelp: [
    'على حاسوب قاصة: الإعدادات ← الهواتف ← «إضافة هاتف»، ثم امسح الرمز الظاهر. يجب أن يكون الهاتف على شبكة Wi-Fi نفسها.',
    'On the Qasa PC: Settings → Phones → "Add a phone", then scan the code shown. The phone must be on the same Wi-Fi.',
    'لەسەر کۆمپیوتەری قاسە: ڕێکخستنەکان ← مۆبایلەکان ← «زیادکردنی مۆبایل»، پاشان ئەو کۆدە بخوێنەوە کە دەردەکەوێت. مۆبایلەکە دەبێت لەسەر هەمان Wi-Fi بێت.'
  ],
  scanPairCode: ['امسح رمز الربط', 'Scan the pairing code', 'کۆدی بەستنەوە بخوێنەوە'],
  notPairCode: ['هذا ليس رمز ربط من قاصة.', 'That isn\'t a Qasa pairing code.', 'ئەمە کۆدی بەستنەوەی قاسە نییە.'],
  phoneName: ['اسم هذا الهاتف', 'This phone\'s name', 'ناوی ئەم مۆبایلە'],
  connecting: ['جارٍ الاتصال…', 'Connecting…', 'پەیوەندی دەکرێت…'],
  online: ['متصل', 'Connected', 'پەیوەستە'],
  offline: ['غير متصل — تأكد من شبكة Wi-Fi ومن تشغيل حاسوب قاصة.', 'Not connected — check the Wi-Fi and that the Qasa PC is on.', 'پەیوەست نییە — Wi-Fi و هەڵکردنی کۆمپیوتەری قاسە بپشکنە.'],
  retry: ['إعادة المحاولة', 'Try again', 'دووبارە هەوڵبدەرەوە'],
  scan: ['مسح باركود', 'Scan a barcode', 'خوێندنەوەی بارکۆد'],
  search: ['بحث بالاسم', 'Search by name', 'گەڕان بە ناو'],
  count: ['جرد المخزن', 'Count stock', 'ژماردنی کۆگا'],
  cart: ['سلة البيع', 'Sale cart', 'سەبەتەی فرۆشتن'],
  settings: ['الإعدادات', 'Settings', 'ڕێکخستنەکان'],
  language: ['اللغة', 'Language', 'زمان'],
  unpair: ['فك الربط بهذا الحاسوب', 'Unpair from this PC', 'هەڵوەشاندنەوەی بەستنەوە'],
  unpairConfirm: ['سيتوقف الهاتف عن الاتصال بهذا الحاسوب. متأكد؟', 'The phone will stop connecting to this PC. Sure?', 'مۆبایلەکە چیتر پەیوەندی بەم کۆمپیوتەرەوە ناکات. دڵنیایت؟'],
  yes: ['نعم', 'Yes', 'بەڵێ'],
  no: ['لا', 'No', 'نەخێر'],
  back: ['رجوع', 'Back', 'گەڕانەوە'],
  close: ['إغلاق', 'Close', 'داخستن'],
  cameraNeeded: ['نحتاج إذن الكاميرا لمسح الباركود.', 'We need the camera to scan barcodes.', 'بۆ خوێندنەوەی بارکۆد پێویستمان بە کامێرایە.'],
  allowCamera: ['السماح بالكاميرا', 'Allow the camera', 'ڕێگەدان بە کامێرا'],
  pointCamera: ['وجّه الكاميرا إلى الباركود', 'Point the camera at a barcode', 'کامێرا ئاراستەی بارکۆد بکە'],
  notFound: ['لا توجد مادة بهذا الرمز:', 'No item with this code:', 'هیچ کاڵایەک بەم کۆدە نییە:'],
  addItem: ['إضافة مادة جديدة', 'Add a new item', 'زیادکردنی کاڵای نوێ'],
  price: ['السعر', 'Price', 'نرخ'],
  wholesale: ['سعر الجملة', 'Wholesale', 'نرخی کۆ'],
  stock: ['المخزون', 'Stock', 'کۆگا'],
  shelf: ['الرف', 'Shelf', 'ڕەف'],
  total: ['المجموع', 'Total', 'کۆ'],
  addToCart: ['أضف إلى السلة', 'Add to the cart', 'زیادکردن بۆ سەبەتە'],
  addToCount: ['أضف إلى الجرد', 'Add to the count', 'زیادکردن بۆ ژماردن'],
  scanNext: ['مسح التالي', 'Scan the next', 'دانەی داهاتوو'],
  name: ['الاسم', 'Name', 'ناو'],
  barcode: ['الباركود', 'Barcode', 'بارکۆد'],
  unit: ['الوحدة', 'Unit', 'یەکە'],
  currency: ['العملة', 'Currency', 'دراو'],
  takePhoto: ['التقاط صورة', 'Take a photo', 'وێنە گرتن'],
  retake: ['صورة أخرى', 'Retake', 'وێنەی تر'],
  save: ['حفظ', 'Save', 'پاشەکەوت'],
  saved: ['تم الحفظ', 'Saved', 'پاشەکەوت کرا'],
  cartEmpty: ['السلة فارغة. امسح مواد لإضافتها.', 'The cart is empty. Scan items to add them.', 'سەبەتەکە بەتاڵە. کاڵا بخوێنەوە بۆ زیادکردنیان.'],
  customer: ['الزبون (اختياري)', 'Customer (optional)', 'کڕیار (ئارەزوومەندانە)'],
  walkIn: ['زبون نقدي', 'Walk-in customer', 'کڕیاری نەقد'],
  warehouse: ['المخزن', 'Warehouse', 'کۆگا'],
  sendDraft: ['إرسال كمسودة فاتورة', 'Send as a draft invoice', 'ناردن وەک ڕەشنووسی پسوولە'],
  draftSent: ['أُرسلت مسودة الفاتورة. يرحّلها المحاسب من الحاسوب.', 'The draft invoice was sent. The accountant posts it on the PC.', 'ڕەشنووسی پسوولە نێردرا. ژمێریار لەسەر کۆمپیوتەر تۆماری دەکات.'],
  sendCount: ['إرسال الجرد إلى الحاسوب', 'Send the count to the PC', 'ناردنی ژماردن بۆ کۆمپیوتەر'],
  countSent: ['أُرسل الجرد؛ يجده المسؤول في الإعدادات ← الهواتف.', 'The count was sent; the admin finds it in Settings → Phones.', 'ژماردنەکە نێردرا؛ بەڕێوەبەر لە ڕێکخستنەکان ← مۆبایلەکان دەیبینێت.'],
  countEmpty: ['لم يُجرد شيء بعد. امسح مادة وأدخل الكمية.', 'Nothing counted yet. Scan an item and enter the quantity.', 'هێشتا هیچ نەژمێردراوە. کاڵایەک بخوێنەوە و بڕ بنووسە.'],
  qty: ['الكمية', 'Quantity', 'بڕ'],
  queued: ['محفوظ على الهاتف، سيُرسل عند الاتصال ({n})', 'Kept on the phone, sent when connected ({n})', 'لەسەر مۆبایل پاشەکەوتە، کاتی پەیوەندی دەنێردرێت ({n})'],
  forbidden: ['ليس لديك صلاحية لهذا. اطلبها من مدير قاصة.', 'You don\'t have permission for this. Ask the Qasa admin.', 'مۆڵەتی ئەمەت نییە. لە بەڕێوەبەری قاسە داوای بکە.'],
  planLimit: ['تطبيق الهاتف من مزايا Pro وBusiness.', 'The phone app is part of Pro and Business.', 'ئەپی مۆبایل بەشێکە لە Pro و Business.'],
  phoneLimit: ['وصل الحاسوب إلى عدد الهواتف المسموح به. احذف هاتفاً من الإعدادات ← الهواتف.', 'The PC has as many phones as its plan allows. Remove one in Settings → Phones.', 'کۆمپیوتەرەکە گەیشتۆتە ژمارەی مۆبایلی ڕێگەپێدراو. یەکێک لە ڕێکخستنەکان ← مۆبایلەکان لاببە.'],
  pairingInvalid: ['انتهت صلاحية الرمز أو استُخدم. اطلب رمزاً جديداً من الحاسوب.', 'The code expired or was used. Ask the PC for a new one.', 'کۆدەکە بەسەرچوو یان بەکارهات. داوای کۆدێکی نوێ لە کۆمپیوتەر بکە.'],
  unknownDevice: ['حُذف هذا الهاتف من الحاسوب. اربطه من جديد.', 'This phone was removed on the PC. Pair it again.', 'ئەم مۆبایلە لە کۆمپیوتەرەکەوە لابرا. دووبارە بیبەستەوە.'],
  stale: ['ساعة الهاتف غير مضبوطة. صحّح الوقت والتاريخ.', 'The phone\'s clock is off. Fix the time and date.', 'کاتژمێری مۆبایل ڕێک نییە. کات و بەروار ڕاست بکەرەوە.'],
  error: ['حدث خطأ:', 'Something went wrong:', 'هەڵەیەک ڕوویدا:'],
  piece: ['قطعة', 'piece', 'دانە'],
  service: ['خدمة', 'service', 'خزمەتگوزاری'],
  kg: ['كغم', 'kg', 'کگم'],
  m: ['متر', 'm', 'مەتر'],
  box: ['علبة', 'box', 'قوتوو'],
  carton: ['كارتون', 'carton', 'کارتۆن'],
  results: ['النتائج', 'Results', 'ئەنجامەکان'],
  nothing: ['لا شيء', 'Nothing found', 'هیچ نەدۆزرایەوە'],
  remove: ['حذف', 'Remove', 'لابردن'],
  company: ['الشركة', 'Company', 'کۆمپانیا']
} as const satisfies Record<string, readonly [string, string, string]>;

export type Key = keyof typeof T;

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let text: string = T[key][LANGS.indexOf(lang)] ?? T[key][1];
  for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{${k}}`, String(v));
  return text;
}

/** An item's name in the app's language, falling back to the other two. */
export function nameIn(lang: Lang, names: { ar?: string; en?: string; ku?: string } | undefined): string {
  if (!names) return '';
  return names[lang] || names.ar || names.en || names.ku || '';
}

/** Money as the desktop shows it: dinars whole, dollars with cents (amounts are in minor units). */
export function money(amountMinor: number, currency: 'IQD' | 'USD'): string {
  const value = currency === 'USD' ? amountMinor / 100 : amountMinor;
  const text = value.toLocaleString('en-US', { minimumFractionDigits: currency === 'USD' ? 2 : 0, maximumFractionDigits: currency === 'USD' ? 2 : 0 });
  return currency === 'USD' ? `$${text}` : `${text} IQD`;
}
