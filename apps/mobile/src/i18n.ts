/** Every text of the phone app in Arabic, English and Kurdish (Sorani), in that order, like the desktop app. */
export type Lang = 'ar' | 'en' | 'ku';
export const LANGS: Lang[] = ['ar', 'en', 'ku'];
export const isRtl = (lang: Lang) => lang !== 'en';
/** Each language's own name, for the language switch. */
export const LANG_NAMES: Record<Lang, string> = { ar: 'العربية', en: 'English', ku: 'کوردی' };

const T = {
  appName: ['قاصة ERP', 'Qasa ERP', 'قاسە ERP'],
  welcome: ['امسح، اعرف السعر والمخزون، وبِع واستلم — من هاتفك.', 'Scan, check prices and stock, sell and collect — from your phone.', 'بخوێنەوە، نرخ و کۆگا ببینە، بفرۆشە و پارە وەربگرە — لە مۆبایلەکەتەوە.'],

  // ——— pairing ———
  pairTitle: ['اربط الهاتف بمكتبك', 'Pair the phone with your office', 'مۆبایلەکە بە ئۆفیسەکەتەوە ببەستەوە'],
  pairStep1: ['على حاسوب قاصة: الإعدادات ← الهواتف ← «إضافة هاتف».', 'On the Qasa PC: Settings → Phones → "Add a phone".', 'لەسەر کۆمپیوتەری قاسە: ڕێکخستنەکان ← مۆبایلەکان ← «زیادکردنی مۆبایل».'],
  pairStep2: ['امسح الرمز الظاهر على الحاسوب بهذا الهاتف.', 'Scan the code shown on the PC with this phone.', 'ئەو کۆدەی لەسەر کۆمپیوتەرەکە دەردەکەوێت بەم مۆبایلە بخوێنەوە.'],
  pairStep3: [
    'بعدها يتصل الهاتف وحده: على شبكة Wi-Fi المكتب، أو من أي مكان عبر Qasa Relay إن كان مفعّلاً على الحاسوب.',
    'From then on the phone connects by itself: on the office Wi-Fi, or from anywhere through Qasa Relay when the PC has it on.',
    'دواتر مۆبایلەکە خۆی پەیوەندی دەکات: لەسەر Wi-Fi ی ئۆفیس، یان لە هەر شوێنێکەوە لە ڕێگەی Qasa Relay ئەگەر لەسەر کۆمپیوتەرەکە کارا بێت.'
  ],
  pairPrivacy: [
    'الاتصال مشفّر من هذا الهاتف إلى حاسوبك، ولا يصل شيء إلى أي جهة أخرى.',
    'The link is encrypted from this phone to your PC. Nothing goes to anyone else.',
    'پەیوەندییەکە لەم مۆبایلەوە تا کۆمپیوتەرەکەت شفرەکراوە، و هیچ شتێک ناگاتە هیچ لایەنێکی تر.'
  ],
  pair: ['امسح رمز الربط', 'Scan the pairing code', 'کۆدی بەستنەوە بخوێنەوە'],
  pairing: ['جارٍ الربط…', 'Pairing…', 'بەستنەوە دەکرێت…'],
  scanPairCode: ['وجّه الكاميرا إلى الرمز على شاشة الحاسوب', 'Point the camera at the code on the PC\'s screen', 'کامێرا ئاراستەی کۆدەکەی سەر شاشەی کۆمپیوتەر بکە'],
  notPairCode: ['هذا ليس رمز ربط من قاصة.', 'That isn\'t a Qasa pairing code.', 'ئەمە کۆدی بەستنەوەی قاسە نییە.'],
  phoneName: ['اسم هذا الهاتف', 'This phone\'s name', 'ناوی ئەم مۆبایلە'],
  phoneNameHint: ['يظهر في قائمة الهواتف على الحاسوب.', 'Shown in the list of phones on the PC.', 'لە لیستی مۆبایلەکان لەسەر کۆمپیوتەر دەردەکەوێت.'],

  // ——— connection ———
  connecting: ['جارٍ الاتصال…', 'Connecting…', 'پەیوەندی دەکرێت…'],
  online: ['متصل', 'Connected', 'پەیوەستە'],
  viaLan: ['متصل على شبكة Wi-Fi المكتب', 'Connected on the office Wi-Fi', 'پەیوەستە لەسەر Wi-Fi ی ئۆفیس'],
  viaRelay: ['متصل عبر Qasa Relay', 'Connected through Qasa Relay', 'پەیوەستە لە ڕێگەی Qasa Relay'],
  offline: ['غير متصل — تأكد من الإنترنت ومن تشغيل حاسوب قاصة. يعيد الهاتف المحاولة وحده.', 'Not connected — check the internet and that the Qasa PC is on. The phone keeps trying.', 'پەیوەست نییە — ئینتەرنێت و هەڵکردنی کۆمپیوتەری قاسە بپشکنە. مۆبایلەکە خۆی هەوڵ دەداتەوە.'],
  offlineShort: ['غير متصل', 'Offline', 'پەیوەست نییە'],
  retry: ['إعادة المحاولة', 'Try again', 'دووبارە هەوڵبدەرەوە'],

  // ——— tabs and common ———
  tabHome: ['الرئيسية', 'Home', 'سەرەکی'],
  tabItems: ['المواد', 'Items', 'کاڵاکان'],
  tabSell: ['البيع', 'Sell', 'فرۆشتن'],
  tabCustomers: ['الزبائن', 'Customers', 'کڕیاران'],
  tabMore: ['المزيد', 'More', 'زیاتر'],
  back: ['رجوع', 'Back', 'گەڕانەوە'],
  close: ['إغلاق', 'Close', 'داخستن'],
  cancel: ['إلغاء', 'Cancel', 'هەڵوەشاندنەوە'],
  yes: ['نعم', 'Yes', 'بەڵێ'],
  no: ['لا', 'No', 'نەخێر'],
  save: ['حفظ', 'Save', 'پاشەکەوت'],
  saved: ['تم الحفظ', 'Saved', 'پاشەکەوت کرا'],
  remove: ['حذف', 'Remove', 'لابردن'],
  change: ['تغيير', 'Change', 'گۆڕین'],
  loading: ['جارٍ التحميل…', 'Loading…', 'باردەکرێت…'],
  loadFailed: ['تعذّر التحميل.', 'Couldn\'t load this.', 'نەتوانرا باربکرێت.'],
  updatedAt: ['آخر تحديث {t}', 'Updated {t}', 'دوایین نوێکردنەوە {t}'],
  increase: ['زيادة', 'Increase', 'زیادکردن'],
  decrease: ['إنقاص', 'Decrease', 'کەمکردنەوە'],

  // ——— home ———
  quickActions: ['إجراءات سريعة', 'Quick actions', 'کردارە خێراکان'],
  scan: ['مسح باركود', 'Scan a barcode', 'خوێندنەوەی بارکۆد'],
  newSale: ['بيع جديد', 'New sale', 'فرۆشتنی نوێ'],
  collect: ['قبض من زبون', 'Collect', 'وەرگرتنی پارە'],
  statement: ['كشف حساب', 'Statement', 'کەشفی حیساب'],
  todaySales: ['مبيعات اليوم', 'Today\'s sales', 'فرۆشتنی ئەمڕۆ'],
  invoicesN: ['{n} فاتورة', '{n} invoices', '{n} پسوولە'],
  vsLastWeek: ['اليوم نفسه من الأسبوع الماضي: {v}', 'Same day last week: {v}', 'هەمان ڕۆژی هەفتەی ڕابردوو: {v}'],
  monthSales: ['مبيعات الشهر', 'This month\'s sales', 'فرۆشتنی ئەم مانگە'],
  cashTotal: ['النقد في الصناديق', 'Cash in the safes', 'پارەی ناو سندوقەکان'],
  receivables: ['ديون الزبائن', 'Customers owe', 'قەرزی کڕیاران'],
  lateCustomers: ['زبائن متأخرون (أكثر من 30 يوماً)', 'Late customers (over 30 days)', 'کڕیارانی دواکەوتوو (زیاتر لە 30 ڕۆژ)'],
  daysLate: ['{n} يوماً', '{n} days', '{n} ڕۆژ'],
  lowStock: ['مواد قاربت على النفاد', 'Running low', 'کاڵای خەریکە تەواو دەبێت'],
  approvals: ['بانتظار التدقيق: {c} · بانتظار المصادقة: {a}', 'Waiting to be checked: {c} · to be approved: {a}', 'چاوەڕێی وردبینی: {c} · چاوەڕێی پەسەندکردن: {a}'],
  hello: ['مرحباً، {n}', 'Hello, {n}', 'سڵاو، {n}'],

  // ——— items ———
  items: ['المواد', 'Items', 'کاڵاکان'],
  searchItems: ['الاسم أو الرمز أو الباركود', 'Name, code or barcode', 'ناو، کۆد یان بارکۆد'],
  typeTwo: ['اكتب حرفين على الأقل، أو امسح باركوداً.', 'Type at least two letters, or scan a barcode.', 'لانیکەم دوو پیت بنووسە، یان بارکۆدێک بخوێنەوە.'],
  nothing: ['لا شيء', 'Nothing found', 'هیچ نەدۆزرایەوە'],
  cameraNeeded: ['نحتاج إذن الكاميرا لمسح الباركود.', 'We need the camera to scan barcodes.', 'بۆ خوێندنەوەی بارکۆد پێویستمان بە کامێرایە.'],
  allowCamera: ['السماح بالكاميرا', 'Allow the camera', 'ڕێگەدان بە کامێرا'],
  torch: ['المصباح', 'Torch', 'ڕووناکی'],
  pointCamera: ['وجّه الكاميرا إلى الباركود', 'Point the camera at a barcode', 'کامێرا ئاراستەی بارکۆد بکە'],
  notFound: ['لا توجد مادة بهذا الرمز:', 'No item with this code:', 'هیچ کاڵایەک بەم کۆدە نییە:'],
  addItem: ['إضافة مادة جديدة', 'Add a new item', 'زیادکردنی کاڵای نوێ'],
  price: ['السعر', 'Price', 'نرخ'],
  wholesale: ['سعر الجملة', 'Wholesale', 'نرخی کۆ'],
  stock: ['المخزون', 'Stock', 'کۆگا'],
  inStock: ['المتوفر', 'In stock', 'بەردەست'],
  shelf: ['الرف', 'Shelf', 'ڕەف'],
  addToCart: ['أضف إلى البيع', 'Add to the sale', 'زیادکردن بۆ فرۆشتن'],
  addedToCart: ['أضيفت إلى البيع', 'Added to the sale', 'زیادکرا بۆ فرۆشتن'],
  addToCount: ['أضف إلى الجرد', 'Add to the count', 'زیادکردن بۆ ژماردن'],
  scanNext: ['مسح التالي', 'Scan the next', 'دانەی داهاتوو'],
  name: ['الاسم', 'Name', 'ناو'],
  barcode: ['الباركود', 'Barcode', 'بارکۆد'],
  unit: ['الوحدة', 'Unit', 'یەکە'],
  currency: ['العملة', 'Currency', 'دراو'],
  takePhoto: ['التقاط صورة', 'Take a photo', 'وێنە گرتن'],
  retake: ['صورة أخرى', 'Retake', 'وێنەی تر'],
  piece: ['قطعة', 'piece', 'دانە'],
  service: ['خدمة', 'service', 'خزمەتگوزاری'],
  kg: ['كغم', 'kg', 'کگم'],
  m: ['متر', 'm', 'مەتر'],
  box: ['علبة', 'box', 'قوتوو'],
  carton: ['كارتون', 'carton', 'کارتۆن'],
  qty: ['الكمية', 'Quantity', 'بڕ'],
  iqdShort: ['د.ع', 'IQD', 'د.ع'],

  // ——— sell ———
  cart: ['البيع', 'Sale', 'فرۆشتن'],
  cartEmpty: ['لا شيء في البيع بعد. امسح مادة أو ابحث عنها لإضافتها.', 'Nothing in the sale yet. Scan or search for an item to add it.', 'هێشتا هیچ لە فرۆشتنەکەدا نییە. کاڵایەک بخوێنەوە یان بیگەڕێ بۆ زیادکردنی.'],
  searchToAdd: ['ابحث عن مادة', 'Find an item', 'کاڵایەک بدۆزەوە'],
  customer: ['الزبون', 'Customer', 'کڕیار'],
  walkIn: ['زبون نقدي', 'Walk-in customer (cash)', 'کڕیاری نەقد'],
  chooseCustomer: ['اختر زبوناً', 'Choose a customer', 'کڕیارێک هەڵبژێرە'],
  warehouse: ['المخزن', 'Warehouse', 'کۆگا'],
  total: ['المجموع', 'Total', 'کۆ'],
  modeSale: ['فاتورة (مسودة)', 'Invoice (draft)', 'پسوولە (ڕەشنووس)'],
  modeOrder: ['طلبية (عرض سعر)', 'Order (quote)', 'داواکاری (نرخنامە)'],
  sendDraft: ['إرسال كمسودة فاتورة', 'Send as a draft invoice', 'ناردن وەک ڕەشنووسی پسوولە'],
  sendOrder: ['إرسال الطلبية', 'Send the order', 'ناردنی داواکاری'],
  draftSent: ['أُرسلت مسودة الفاتورة. يرحّلها المحاسب من الحاسوب.', 'The draft invoice was sent. The accountant posts it on the PC.', 'ڕەشنووسی پسوولە نێردرا. ژمێریار لەسەر کۆمپیوتەر تۆماری دەکات.'],
  orderSent: ['أُرسلت الطلبية كعرض سعر. يحوّلها المكتب إلى فاتورة عند التسليم.', 'The order was sent as a quote. The office turns it into an invoice on delivery.', 'داواکارییەکە وەک نرخنامە نێردرا. ئۆفیس لە کاتی ڕادەستکردن دەیکاتە پسوولە.'],
  orderNeedsCustomer: ['الطلبية تحتاج زبوناً.', 'An order needs a customer.', 'داواکاری پێویستی بە کڕیارە.'],
  oneCurrency: ['البيع الواحد بعملة واحدة: تُرسل مواد {c} وحدها.', 'One sale is in one currency: the {c} items go on their own.', 'هەر فرۆشتنێک بە یەک دراوە: کاڵاکانی {c} بە تەنها دەنێردرێن.'],
  emptyCart: ['إفراغ البيع', 'Empty the sale', 'بەتاڵکردنەوەی فرۆشتن'],
  linesN: ['{n} سطر', '{n} lines', '{n} دێڕ'],
  phoneNote: ['من تطبيق قاصة على الهاتف', 'From the Qasa phone app', 'لە ئەپی قاسەی مۆبایلەوە'],

  // ——— customers ———
  customers: ['الزبائن', 'Customers', 'کڕیاران'],
  searchCustomers: ['اسم الزبون أو هاتفه', 'Customer name or phone', 'ناو یان ژمارەی کڕیار'],
  owes: ['عليه', 'Owes', 'قەرزارە'],
  owesNothing: ['لا شيء عليه', 'Owes nothing', 'هیچی لەسەر نییە'],
  inCredit: ['له رصيد', 'In credit', 'باڵانسی هەیە'],
  creditLimit: ['حد الائتمان', 'Credit limit', 'سنووری قەرز'],

  // ——— statement ———
  thisMonth: ['هذا الشهر', 'This month', 'ئەم مانگە'],
  threeMonths: ['3 أشهر', '3 months', '3 مانگ'],
  thisYear: ['هذه السنة', 'This year', 'ئەمساڵ'],
  opening: ['الرصيد السابق', 'Opening balance', 'باڵانسی پێشوو'],
  closing: ['الرصيد', 'Balance', 'باڵانس'],
  debit: ['مدين', 'Debit', 'قەرزدار'],
  credit: ['دائن', 'Credit', 'قەرزدەر'],
  noLines: ['لا قيود في هذه الفترة.', 'No entries in this period.', 'هیچ تۆمارێک لەم ماوەیەدا نییە.'],

  // ——— collect ———
  collectTitle: ['قبض من زبون', 'Receipt from a customer', 'وەرگرتنی پارە لە کڕیار'],
  amount: ['المبلغ', 'Amount', 'بڕی پارە'],
  note: ['ملاحظة (اختيارية)', 'Note (optional)', 'تێبینی (ئارەزوومەندانە)'],
  collectSend: ['تسجيل القبض', 'Record the receipt', 'تۆمارکردنی وەرگرتن'],
  collectSent: ['أُرسل سند القبض كمسودة. يدققه المحاسب ويصادقه على الحاسوب.', 'The receipt was sent as a draft voucher. The accountant checks and approves it on the PC.', 'پسوولەی وەرگرتن وەک ڕەشنووس نێردرا. ژمێریار لەسەر کۆمپیوتەر وردبینی و پەسەندی دەکات.'],
  receiptDescription: ['قبض من {c} — تطبيق الهاتف', 'Received from {c} — phone app', 'وەرگیرا لە {c} — ئەپی مۆبایل'],
  amountInvalid: ['أدخل مبلغاً أكبر من صفر.', 'Enter an amount above zero.', 'بڕێکی سەرووی سفر بنووسە.'],
  noAccount: ['لا حساب لهذا الزبون في الدليل.', 'This customer has no account in the chart.', 'ئەم کڕیارە هیچ هەژمارێکی لە ڕێبەرەکەدا نییە.'],

  // ——— count ———
  count: ['جرد المخزن', 'Count stock', 'ژماردنی کۆگا'],
  countEmpty: ['لم يُجرد شيء بعد. امسح مادة وأدخل الكمية.', 'Nothing counted yet. Scan an item and enter the quantity.', 'هێشتا هیچ نەژمێردراوە. کاڵایەک بخوێنەوە و بڕ بنووسە.'],
  sendCount: ['إرسال الجرد إلى الحاسوب', 'Send the count to the PC', 'ناردنی ژماردن بۆ کۆمپیوتەر'],
  countSent: ['أُرسل الجرد؛ يجده المسؤول في الإعدادات ← الهواتف.', 'The count was sent; the admin finds it in Settings → Phones.', 'ژماردنەکە نێردرا؛ بەڕێوەبەر لە ڕێکخستنەکان ← مۆبایلەکان دەیبینێت.'],
  openCountNote: ['هناك جرد مفتوح لهذا المخزن على الحاسوب: تدخل الكميات فيه مباشرة.', 'A count is open for this warehouse on the PC: the quantities go straight into it.', 'ژماردنێکی کراوە بۆ ئەم کۆگایە لەسەر کۆمپیوتەر هەیە: بڕەکان ڕاستەوخۆ دەچنە ناوی.'],
  countSessionSent: ['أُدخلت الكميات في الجرد المفتوح على الحاسوب.', 'The quantities were entered into the open count on the PC.', 'بڕەکان خرانە ناو ژماردنە کراوەکەی سەر کۆمپیوتەر.'],

  // ——— outbox ———
  outbox: ['بانتظار الإرسال', 'Waiting to send', 'چاوەڕێی ناردن'],
  outboxEmpty: ['أُرسل كل شيء.', 'Everything has been sent.', 'هەموو شتێک نێردرا.'],
  queued: ['محفوظ على الهاتف، يُرسل عند الاتصال ({n})', 'Kept on the phone, sent when connected ({n})', 'لەسەر مۆبایل پاشەکەوتە، کاتی پەیوەندی دەنێردرێت ({n})'],
  queuedOne: ['محفوظ على الهاتف، يُرسل وحده عند الاتصال.', 'Kept on the phone; it goes by itself once connected.', 'لەسەر مۆبایل پاشەکەوتە؛ کاتی پەیوەندی خۆی دەنێردرێت.'],
  sendNow: ['أرسل الآن', 'Send now', 'ئێستا بنێرە'],
  refusedBy: ['رفضه الحاسوب: {r}', 'Refused by the PC: {r}', 'کۆمپیوتەرەکە ڕەتی کردەوە: {r}'],
  refusedN: ['رفض الحاسوب {n} — افتحها لمعرفة السبب.', 'The PC refused {n} — open them to see why.', 'کۆمپیوتەرەکە {n} دانەی ڕەتکردەوە — بیانکەرەوە بۆ زانینی هۆکار.'],
  deleteItem: ['حذف من الهاتف', 'Delete from the phone', 'سڕینەوە لە مۆبایل'],
  deleteConfirm: ['حذف هذا من الهاتف؟ لم يصل إلى المكتب ولا يمكن استرجاعه.', 'Delete this from the phone? It has not reached the office, and it can\'t be brought back.', 'ئەمە لە مۆبایل بسڕدرێتەوە؟ نەگەیشتۆتە ئۆفیس و ناگەڕێتەوە.'],
  kindSale: ['بيع', 'Sale', 'فرۆشتن'],
  kindOrder: ['طلبية', 'Order', 'داواکاری'],
  kindReceipt: ['قبض', 'Receipt', 'وەرگرتن'],
  kindCount: ['جرد', 'Count', 'ژماردن'],
  triesN: ['المحاولات: {n}', 'Tries: {n}', 'هەوڵەکان: {n}'],

  // ——— more, settings ———
  more: ['المزيد', 'More', 'زیاتر'],
  settings: ['الإعدادات', 'Settings', 'ڕێکخستنەکان'],
  language: ['اللغة', 'Language', 'زمان'],
  theme: ['المظهر', 'Appearance', 'ڕووکار'],
  themeSystem: ['مثل الهاتف', 'As the phone', 'وەک مۆبایلەکە'],
  themeLight: ['فاتح', 'Light', 'ڕووناک'],
  themeDark: ['داكن', 'Dark', 'تاریک'],
  about: ['حول التطبيق', 'About', 'دەربارە'],
  version: ['الإصدار {v}', 'Version {v}', 'وەشانی {v}'],
  company: ['الشركة', 'Company', 'کۆمپانیا'],
  connection: ['الاتصال', 'Connection', 'پەیوەندی'],
  actsAs: ['يعمل باسم', 'Works as', 'کار دەکات بە ناوی'],
  owner: ['المالك', 'The owner', 'خاوەن'],
  privacy: ['سياسة الخصوصية', 'Privacy policy', 'سیاسەتی تایبەتمەندی'],
  credits: [
    'الخطوط: Noto Sans Arabic © The Noto Project Authors، وIBM Plex Sans © IBM Corp.، بترخيص SIL Open Font License 1.1.',
    'Fonts: Noto Sans Arabic © The Noto Project Authors and IBM Plex Sans © IBM Corp., under the SIL Open Font License 1.1.',
    'فۆنتەکان: Noto Sans Arabic © The Noto Project Authors و IBM Plex Sans © IBM Corp.، بە مۆڵەتی SIL Open Font License 1.1.'
  ],
  unpair: ['فك الربط بهذا الحاسوب', 'Unpair from this PC', 'هەڵوەشاندنەوەی بەستنەوە'],
  unpairConfirm: [
    'سيتوقف الهاتف عن الاتصال بهذا الحاسوب ويُمسح ما يحفظه منه، ومنه ما لم يُرسل بعد. متأكد؟',
    'The phone stops connecting to this PC and wipes what it keeps from it, including anything not sent yet. Sure?',
    'مۆبایلەکە چیتر پەیوەندی بەم کۆمپیوتەرەوە ناکات و ئەوەی لێی هەڵیگرتووە دەسڕێتەوە، تەنانەت ئەوەی هێشتا نەنێردراوە. دڵنیایت؟'
  ],
  unpairQueued: ['انتباه: {n} لم تُرسل بعد وستُحذف.', 'Careful: {n} not sent yet will be deleted.', 'ئاگاداربە: {n} هێشتا نەنێردراون و دەسڕدرێنەوە.'],

  // ——— app lock ———
  security: ['قفل التطبيق', 'App lock', 'قفڵی ئەپ'],
  securityHelp: ['رمز PIN يحمي التطبيق إن وقع الهاتف في يد غيرك.', 'A PIN keeps the app closed if the phone is in someone else\'s hands.', 'PIN ئەپەکە دادەخات ئەگەر مۆبایلەکە کەوتە دەستی کەسێکی تر.'],
  setPin: ['تعيين رمز PIN', 'Set a PIN', 'دانانی PIN'],
  changePin: ['تغيير رمز PIN', 'Change the PIN', 'گۆڕینی PIN'],
  removePin: ['إيقاف رمز PIN', 'Turn the PIN off', 'ناچالاککردنی PIN'],
  newPin: ['رمز PIN جديد (4 إلى 8 أرقام)', 'New PIN (4 to 8 digits)', 'PIN ی نوێ (4 بۆ 8 ژمارە)'],
  confirmPin: ['أعد إدخاله', 'Enter it again', 'دووبارە بینووسەوە'],
  pinMismatch: ['الرمزان غير متطابقين.', 'The two PINs are not the same.', 'دوو PIN ەکە وەک یەک نین.'],
  pinWeak: ['سهل التخمين. اختر رمزاً آخر.', 'Too easy to guess. Choose another.', 'زۆر ئاسانە بۆ تەخمین. یەکێکی تر هەڵبژێرە.'],
  pinSet: ['تم تعيين رمز PIN', 'The PIN is set', 'PIN دانرا'],
  biometric: ['البصمة أو الوجه', 'Fingerprint or face', 'پەنجەمۆر یان ڕوخسار'],
  biometricNone: ['لا بصمة ولا وجه مسجّلان على هذا الهاتف.', 'This phone has no fingerprint or face set up.', 'هیچ پەنجەمۆر یان ڕوخسارێک لەسەر ئەم مۆبایلە تۆمار نەکراوە.'],
  autoLock: ['القفل بعد', 'Lock after', 'داخستن دوای'],
  lockNow: ['فوراً', 'At once', 'دەستبەجێ'],
  lock1m: ['دقيقة', '1 minute', '1 خولەک'],
  lock5m: ['5 دقائق', '5 minutes', '5 خولەک'],
  lockTitle: ['أدخل رمز PIN', 'Enter your PIN', 'PIN ەکەت بنووسە'],
  lockWrong: ['رمز PIN غير صحيح.', 'Wrong PIN.', 'PIN هەڵەیە.'],
  lockWait: ['محاولات كثيرة. حاول بعد {s} ثانية.', 'Too many tries. Try again in {s} seconds.', 'هەوڵی زۆر. دوای {s} چرکە هەوڵ بدەرەوە.'],
  useBiometric: ['استخدم البصمة أو الوجه', 'Use fingerprint or face', 'پەنجەمۆر یان ڕوخسار بەکاربهێنە'],
  unlockPrompt: ['افتح قاصة', 'Unlock Qasa', 'قاسە بکەرەوە'],
  forgotPin: ['نسيت رمز PIN؟', 'Forgot the PIN?', 'PIN ت لەبیرچووە؟'],
  forgotPinConfirm: [
    'سيُفك ربط الهاتف ويُمسح كل ما يحفظه، ومنه ما لم يُرسل بعد. اربطه من جديد من الحاسوب.',
    'This unpairs the phone and wipes everything it keeps, including anything not sent yet. Pair it again from the PC.',
    'مۆبایلەکە لە بەستنەوە دەردەچێت و هەموو ئەوەی هەڵیگرتووە دەسڕێتەوە، تەنانەت ئەوەی نەنێردراوە. لە کۆمپیوتەرەوە دووبارە بیبەستەوە.'
  ],
  digitKey: ['الرقم {d}', 'Digit {d}', 'ژمارە {d}'],
  deleteDigit: ['حذف رقم', 'Delete a digit', 'سڕینەوەی ژمارەیەک'],

  // ——— refusals ———
  forbidden: ['ليس لديك صلاحية لهذا. اطلبها من مدير قاصة.', 'You don\'t have permission for this. Ask the Qasa admin.', 'مۆڵەتی ئەمەت نییە. لە بەڕێوەبەری قاسە داوای بکە.'],
  planLimit: ['تطبيق الهاتف من مزايا Pro وBusiness.', 'The phone app is part of Pro and Business.', 'ئەپی مۆبایل بەشێکە لە Pro و Business.'],
  phoneLimit: ['وصل الحاسوب إلى عدد الهواتف المسموح به. احذف هاتفاً من الإعدادات ← الهواتف.', 'The PC has as many phones as its plan allows. Remove one in Settings → Phones.', 'کۆمپیوتەرەکە گەیشتۆتە ژمارەی مۆبایلی ڕێگەپێدراو. یەکێک لە ڕێکخستنەکان ← مۆبایلەکان لاببە.'],
  pairingInvalid: ['انتهت صلاحية الرمز أو استُخدم. اطلب رمزاً جديداً من الحاسوب.', 'The code expired or was used. Ask the PC for a new one.', 'کۆدەکە بەسەرچوو یان بەکارهات. داوای کۆدێکی نوێ لە کۆمپیوتەر بکە.'],
  unknownDevice: ['حُذف هذا الهاتف من الحاسوب. اربطه من جديد.', 'This phone was removed on the PC. Pair it again.', 'ئەم مۆبایلە لە کۆمپیوتەرەکەوە لابرا. دووبارە بیبەستەوە.'],
  stale: ['ساعة الهاتف غير مضبوطة. صحّح الوقت والتاريخ.', 'The phone\'s clock is off. Fix the time and date.', 'کاتژمێری مۆبایل ڕێک نییە. کات و بەروار ڕاست بکەرەوە.'],
  tampered: ['لم يثبت الحاسوب هويته بمفتاحه المسجّل. تأكد أنك على شبكة المكتب الصحيحة.', 'The PC did not prove itself with its paired key. Make sure this is the right office network.', 'کۆمپیوتەرەکە بە کلیلە تۆمارکراوەکەی خۆی نەسەلماند. دڵنیابە کە ئەمە تۆڕی ڕاستی ئۆفیسە.'],
  error: ['حدث خطأ:', 'Something went wrong:', 'هەڵەیەک ڕوویدا:'],
  validation: ['رفض الحاسوب البيانات. تحقق منها وحاول مجدداً.', 'The PC refused the details. Check them and try again.', 'کۆمپیوتەرەکە زانیارییەکانی ڕەتکردەوە. بیانپشکنە و دووبارە هەوڵبدەرەوە.']
} as const satisfies Record<string, readonly [string, string, string]>;

export type Key = keyof typeof T;
export const KEYS = Object.keys(T) as Key[];

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

// ——— numbers as the desktop shows them: Western digits, grouped, the sign and "$" kept with the digits ———

/** Left-to-right isolate: "$1,500.00" keeps its "$" on the left inside Arabic and Kurdish text. */
export const ltr = (text: string) => `⁦${text}⁩`;

const group = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Money in minor units: dinars whole, dollars with cents. */
export function money(amountMinor: number, currency: 'IQD' | 'USD', lang: Lang = 'en'): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.round(amountMinor));
  const text = currency === 'USD' ? `${group(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, '0')}` : group(String(abs));
  if (currency === 'USD') return ltr(`${negative ? '-' : ''}$${text}`);
  return `${ltr((negative ? '-' : '') + text)} ${translate(lang, 'iqdShort')}`;
}

/** A quantity in thousandths: up to three decimals, none when whole. */
export function qty(milli: number): string {
  const negative = milli < 0;
  const abs = Math.abs(Math.round(milli));
  const fraction = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return ltr(`${negative ? '-' : ''}${group(String(Math.floor(abs / 1000)))}${fraction ? `.${fraction}` : ''}`);
}

/** A date (YYYY-MM-DD) in the desktop's order, day first: 11/11/2026. */
export const dateText = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return ltr(`${d}/${m}/${y}`);
};

/** Typed numbers: Arabic-Indic and Persian digits, Arabic separators, as plain digits ("١٬٢٥٠٫٥" → "1250.5"). */
export function parseNumber(text: string): number {
  const western = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
  return /^\d+(\.\d+)?$/.test(western) ? Number(western) : NaN;
}
