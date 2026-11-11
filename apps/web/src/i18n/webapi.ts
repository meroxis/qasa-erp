/** The website API (Pro): keys for websites and online shops, and webhooks. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const WEBAPI_TEXT = {
  wa_nav: ['ربط المواقع الإلكترونية', 'Website API', 'بەستنەوەی ماڵپەڕ'],
  wa_title: ['ربط موقعك أو متجرك الإلكتروني', 'Connect your website or online shop', 'ماڵپەڕ یان دوکانی ئۆنلاینەکەت ببەستەوە'],
  wa_intro: [
    'يقرأ موقعك المواد والأسعار والمخزون مباشرة من قاصة، ويرسل الطلبات إليها كفواتير بيع مسودة تراجعها وترحّلها بنفسك. لكل موقع مفتاح خاص بصلاحيات محددة يمكنك إلغاؤه في أي وقت.',
    'Your website reads items, prices and stock straight from Qasa, and sends orders to it as draft sale invoices that you check and post yourself. Each site gets its own key with set permissions, which you can cancel at any time.',
    'ماڵپەڕەکەت کاڵا و نرخ و کۆگا ڕاستەوخۆ لە قاسە دەخوێنێتەوە، و داواکارییەکان وەک ڕەشنووسی پسوولەی فرۆشتن دەنێرێت کە خۆت پێیاندا دەچیتەوە و تۆماریان دەکەیت. هەر ماڵپەڕێک کلیلی تایبەتی خۆی هەیە بە دەسەڵاتی دیاریکراو، و هەر کاتێک دەتوانیت هەڵیبوەشێنیتەوە.'
  ],
  wa_needsPro: ['ربط المواقع من مزايا Starter وPro وBusiness — راجع «الخطة والترخيص».', 'The website API is part of Starter, Pro and Business. See Plan & license.', 'بەستنەوەی ماڵپەڕ بەشێکە لە Starter، Pro و Business — «پلان و مۆڵەت» ببینە.'],
  wa_connectTitle: ['كيف يصل موقعك إلى هذا المكتب', 'How your website reaches this office', 'ماڵپەڕەکەت چۆن دەگاتە ئەم نووسینگەیە'],
  wa_connectHelp: [
    'عبر الإنترنت يستعمل الموقع معرّف المكتب ومفتاح المكتب أدناه: كل طلب يُقفل بحيث لا يفتحه إلا هذا الحاسوب، فلا يقرؤه خادم Relay ولا أي أحد في الطريق. وعلى شبكة المكتب يستعمل العنوان ويثبّت رمز الشهادة. يجب أن تكون شبكة المكتب، ووصولها عبر الإنترنت لاستعمال Relay، مفعّلين في الإعدادات.',
    'Over the internet the website uses the office ID and the office key below: each request is sealed so that only this PC can open it, and neither the relay nor anyone on the way can read it. On the office network it uses the address and pins the certificate code. The office network, and its internet access for the relay, must be on in Settings.',
    'لە ڕێگەی ئینتەرنێتەوە ماڵپەڕەکە ناسنامەی نووسینگە و کلیلی نووسینگەی خوارەوە بەکاردەهێنێت: هەر داواکارییەک قفڵ دەدرێت بە شێوەیەک تەنها ئەم کۆمپیوتەرە بیکاتەوە، بۆیە نە Relay و نە هیچ کەسێک لە ڕێگادا ناتوانێت بیخوێنێتەوە. لەسەر تۆڕی نووسینگە ناونیشانەکە بەکاردەهێنێت و کۆدی بڕوانامە دەچەسپێنێت. تۆڕی نووسینگە، و گەیشتنی لە ڕێگەی ئینتەرنێتەوە بۆ Relay، دەبێت لە ڕێکخستنەکاندا هەڵکرابن.'
  ],
  wa_viaRelay: ['عبر الإنترنت (Qasa Relay)', 'Over the internet (Qasa Relay)', 'لە ڕێگەی ئینتەرنێتەوە (Qasa Relay)'],
  wa_onLan: ['على شبكة المكتب', 'On the office network', 'لەسەر تۆڕی نووسینگە'],
  wa_officeId: ['معرّف المكتب', 'Office ID', 'ناسنامەی نووسینگە'],
  wa_officeKey: ['مفتاح المكتب', 'Office key', 'کلیلی نووسینگە'],
  wa_officeKeyHelp: [
    'ليس سرّاً: به يقفل الموقع طلباته فلا يفتحها إلا هذا الحاسوب. ضعه في إعدادات الموقع مع معرّف المكتب.',
    'Not a secret: the website seals its requests with it so that only this PC can open them. Put it in the website’s settings with the office ID.',
    'نهێنی نییە: ماڵپەڕەکە داواکارییەکانی پێی قفڵ دەدات بۆ ئەوەی تەنها ئەم کۆمپیوتەرە بیانکاتەوە. لەگەڵ ناسنامەی نووسینگە بیخەرە ناو ڕێکخستنەکانی ماڵپەڕەکە.'
  ],
  wa_renewOfficeKey: ['مفتاح مكتب جديد', 'New office key', 'کلیلی نوێی نووسینگە'],
  wa_renewOfficeKeyConfirm: [
    'إنشاء مفتاح مكتب جديد؟ استعمله فقط إن ظننت أن ملفات المفاتيح على هذا الحاسوب وقعت بيد أحد. يتوقف المفتاح الحالي فوراً، ويجب لصق المفتاح الجديد في إعدادات كل موقع متصل.',
    'Make a new office key? Do this only if you think someone got a copy of this PC’s key files. The current key stops working at once, and the new key must be pasted into the settings of every connected website.',
    'کلیلێکی نوێی نووسینگە دروست بکرێت؟ تەنها ئەگەر وا دەزانیت کەسێک کۆپیی فایلی کلیلەکانی ئەم کۆمپیوتەرەی دەست کەوتووە. کلیلە ئێستاییەکە یەکسەر لە کار دەکەوێت، و دەبێت کلیلە نوێیەکە بخرێتە ناو ڕێکخستنەکانی هەموو ماڵپەڕە بەستراوەکان.'
  ],
  wa_officeKeyRenewed: [
    'تم إنشاء مفتاح مكتب جديد. ضعه في إعدادات كل موقع متصل.',
    'A new office key was made. Put it in the settings of every connected website.',
    'کلیلێکی نوێی نووسینگە دروستکرا. بیخەرە ناو ڕێکخستنەکانی هەموو ماڵپەڕە بەستراوەکان.'
  ],
  wa_officeKeyRemade: [
    'تعذّرت قراءة مفتاح المكتب السابق على هذا الحاسوب، فأُنشئ مفتاح جديد في {d}. ضع المفتاح الجديد في إعدادات كل موقع متصل.',
    'The previous office key couldn’t be read on this PC, so a new one was made on {d}. Put the new key in the settings of every connected website.',
    'کلیلی پێشووی نووسینگە لەسەر ئەم کۆمپیوتەرە نەخوێندرایەوە، بۆیە لە {d} کلیلێکی نوێ دروستکرا. کلیلە نوێیەکە بخەرە ناو ڕێکخستنەکانی هەموو ماڵپەڕە بەستراوەکان.'
  ],
  wa_relayOff: ['الوصول عبر الإنترنت مطفأ', 'Internet access is off', 'گەیشتن لە ڕێگەی ئینتەرنێتەوە کوژاوەتەوە'],
  wa_pinCode: ['رمز الشهادة (للتثبيت)', 'Certificate code (to pin)', 'کۆدی بڕوانامە (بۆ چەسپاندن)'],
  wa_lanAddress: ['العنوان على شبكة المكتب', 'Address on the office network', 'ناونیشان لەسەر تۆڕی نووسینگە'],
  wa_networkOff: ['شبكة المكتب مطفأة؛ شغّلها أولاً من', 'The office network is off; turn it on first in', 'تۆڕی نووسینگە کوژاوەتەوە؛ سەرەتا هەڵیبکە لە'],
  wa_keys: ['المفاتيح', 'Keys', 'کلیلەکان'],
  wa_newKey: ['مفتاح جديد', 'New key', 'کلیلی نوێ'],
  wa_key: ['المفتاح', 'Key', 'کلیل'],
  wa_keyName: ['لأي موقع؟', 'Which site is it for?', 'بۆ کام ماڵپەڕە؟'],
  wa_keyNameHint: ['مثلاً: المتجر على WooCommerce', 'e.g. The WooCommerce shop', 'بۆ نموونە: دوکانی WooCommerce'],
  wa_scopes: ['ما يُسمح به', 'What it may do', 'چی دەتوانێت بکات'],
  wa_scope_items: ['قراءة المواد والأسعار', 'Read items and prices', 'خوێندنەوەی کاڵا و نرخ'],
  wa_scope_itemsHelp: ['الأسماء والرموز والباركود والأسعار والصور', 'names, codes, barcodes, prices and pictures', 'ناو، کۆد، بارکۆد، نرخ و وێنە'],
  wa_scope_stock: ['قراءة المخزون', 'Read stock', 'خوێندنەوەی کۆگا'],
  wa_scope_stockHelp: ['الكمية في كل مخزن', 'the quantity in each warehouse', 'بڕ لە هەر کۆگایەک'],
  wa_scope_customers: ['الزبائن', 'Customers', 'کڕیاران'],
  wa_scope_customersHelp: ['البحث برقم الهاتف وإضافة زبون جديد', 'find by phone and add a new customer', 'گەڕان بە ژمارەی تەلەفۆن و زیادکردنی کڕیاری نوێ'],
  wa_scope_orders: ['إرسال الطلبات', 'Send orders', 'ناردنی داواکاری'],
  wa_scope_ordersHelp: ['تصل كفواتير بيع مسودة، ولا تُرحّل أبداً من الموقع', 'they arrive as draft sale invoices, never posted by the site', 'وەک ڕەشنووسی پسوولەی فرۆشتن دەگەن، هەرگیز ماڵپەڕەکە تۆماریان ناکات'],
  wa_lastUsed: ['آخر استخدام', 'Last used', 'دوایین بەکارهێنان'],
  wa_active: ['يعمل', 'Working', 'کار دەکات'],
  wa_revoked: ['ملغى', 'Cancelled', 'هەڵوەشاوە'],
  wa_revoke: ['إلغاء', 'Cancel key', 'هەڵوەشاندنەوە'],
  wa_revokeConfirm: ['إلغاء مفتاح «{n}»؟ سيتوقف الموقع عن الاتصال فوراً.', 'Cancel the key “{n}”? The site stops connecting at once.', 'کلیلی «{n}» هەڵبوەشێنرێتەوە؟ ماڵپەڕەکە یەکسەر پەیوەندی ناکات.'],
  wa_noKeys: ['لا توجد مفاتيح بعد.', 'No keys yet.', 'هێشتا هیچ کلیلێک نییە.'],
  wa_make: ['إنشاء', 'Create', 'دروستکردن'],
  wa_keyMade: ['المفتاح الجديد', 'The new key', 'کلیلە نوێیەکە'],
  wa_hookMade: ['سرّ التوقيع لهذا الإشعار', 'This webhook’s signing secret', 'نهێنیی واژۆی ئەم ئاگادارکردنەوەیە'],
  wa_shownOnce: [
    'انسخه الآن وضعه في إعدادات موقعك. لن يظهر مرة أخرى؛ قاصة تحتفظ ببصمته فقط.',
    'Copy it now and put it in your website’s settings. It won’t be shown again; Qasa keeps only a fingerprint of it.',
    'ئێستا لەبەری بگرەوە و بیخەرە ناو ڕێکخستنەکانی ماڵپەڕەکەت. جارێکی تر پیشان نادرێتەوە؛ قاسە تەنها پەنجەمۆرەکەی دەهێڵێتەوە.'
  ],
  wa_copy: ['نسخ', 'Copy', 'لەبەرگرتنەوە'],
  wa_copied: ['تم النسخ', 'Copied', 'لەبەرگیرایەوە'],
  wa_done: ['تم', 'Done', 'تەواو'],
  wa_webhooks: ['الإشعارات (Webhooks)', 'Webhooks', 'ئاگادارکردنەوەکان (Webhooks)'],
  wa_newHook: ['إشعار جديد', 'New webhook', 'ئاگادارکردنەوەی نوێ'],
  wa_hooksHelp: [
    'تخبر قاصةُ موقعك عند تغيّر المخزون أو الأسعار أو حالة طلب، برسالة موقّعة. إن لم يردّ الموقع تعيد المحاولة.',
    'Qasa tells your website when stock, prices or an order’s status change, with a signed message. If the site doesn’t answer, it tries again.',
    'قاسە ماڵپەڕەکەت ئاگادار دەکاتەوە کاتێک کۆگا یان نرخ یان دۆخی داواکارییەک دەگۆڕێت، بە نامەیەکی واژۆکراو. ئەگەر ماڵپەڕەکە وەڵام نەداتەوە، دووبارە هەوڵ دەداتەوە.'
  ],
  wa_url: ['عنوان الاستقبال (https)', 'Receiving address (https)', 'ناونیشانی وەرگرتن (https)'],
  wa_events: ['متى يُرسل', 'When to send', 'کەی بنێردرێت'],
  wa_event_stock: ['تغيّر المخزون', 'Stock changed', 'کۆگا گۆڕا'],
  wa_event_price: ['تغيّر سعر', 'A price changed', 'نرخێک گۆڕا'],
  wa_event_order: ['تغيّرت حالة طلب', 'An order’s status changed', 'دۆخی داواکارییەک گۆڕا'],
  wa_lastDelivery: ['آخر إرسال', 'Last sent', 'دوایین ناردن'],
  wa_unreachable: ['لم يُرد', 'No answer', 'وەڵامی نەدایەوە'],
  wa_test: ['تجربة', 'Test', 'تاقیکردنەوە'],
  wa_testResult: ['ردّ الموقع: {s}', 'The site answered: {s}', 'ماڵپەڕەکە وەڵامی دایەوە: {s}'],
  wa_pause: ['إيقاف مؤقت', 'Pause', 'ڕاگرتن'],
  wa_resume: ['تشغيل', 'Resume', 'دەستپێکردنەوە'],
  wa_paused: ['موقوف', 'Paused', 'ڕاگیراوە'],
  wa_delete: ['حذف', 'Delete', 'سڕینەوە'],
  wa_deleted: ['تم الحذف', 'Deleted', 'سڕایەوە'],
  wa_deleteHookConfirm: ['حذف هذا الإشعار؟', 'Delete this webhook?', 'ئەم ئاگادارکردنەوەیە بسڕدرێتەوە؟'],
  wa_noHooks: ['لا توجد إشعارات.', 'No webhooks.', 'هیچ ئاگادارکردنەوەیەک نییە.'],
  wa_shopsTitle: ['متاجر WooCommerce وغيرها', 'WooCommerce and other shops', 'دوکانەکانی WooCommerce و هیتر'],
  wa_shopsHelp: [
    'لمتاجر WordPress توجد إضافة «Qasa ERP» لـ WooCommerce، ولغيرها مكتبة PHP؛ نرسلهما عند الطلب عبر زر الدعم. تُدخل في الإضافة معرّف المكتب ومفتاح المكتب والمفتاح الجديد، فتحدّث الأسعار والمخزون تلقائياً وترسل الطلبات الجديدة. ويستطيع المبرمج أيضاً استعمال أي لغة فيها libsodium.',
    'For WordPress shops there is a “Qasa ERP” plugin for WooCommerce, and for other sites a PHP library; we send them on request through the Support button. In the plugin you enter the office ID, the office key and the new key; it then keeps prices and stock up to date and sends new orders. A developer can also use any language that has libsodium.',
    'بۆ دوکانەکانی WordPress پێوەکراوی «Qasa ERP» بۆ WooCommerce هەیە، و بۆ ماڵپەڕەکانی تر کتێبخانەیەکی PHP؛ بە داواکاری لە ڕێگەی دوگمەی پشتگیرییەوە دەیاننێرین. لە پێوەکراوەکەدا ناسنامەی نووسینگە و کلیلی نووسینگە و کلیلە نوێیەکە دەنووسیت؛ ئینجا نرخ و کۆگا خۆکارانە نوێ دەکاتەوە و داواکارییە نوێیەکان دەنێرێت. پرۆگرامساز دەشتوانێت هەر زمانێک بەکاربهێنێت کە libsodium ی تێدا بێت.'
  ],

  err_api_key_invalid: ['المفتاح غير صحيح أو ملغى.', 'The key is wrong or was cancelled.', 'کلیلەکە هەڵەیە یان هەڵوەشێنراوەتەوە.'],
  err_api_scope_missing: ['هذا المفتاح غير مسموح له بذلك.', 'This key isn’t allowed to do that.', 'ئەم کلیلە ڕێگەی پێنەدراوە ئەوە بکات.'],
  err_rate_limited: ['طلبات كثيرة؛ حاول بعد دقيقة.', 'Too many requests; try again in a minute.', 'داواکاری زۆرە؛ دوای خولەکێک هەوڵ بدەرەوە.'],
  err_plan_limit_websiteApi: ['ربط المواقع من مزايا Starter وPro وBusiness — راجع «الخطة والترخيص».', 'The website API is part of Starter, Pro and Business. See Plan & license.', 'بەستنەوەی ماڵپەڕ بەشێکە لە Starter، Pro و Business — «پلان و مۆڵەت» ببینە.'],
  err_wa_name_required: ['اكتب لأي موقع هذا المفتاح.', 'Say which site the key is for.', 'بنووسە ئەم کلیلە بۆ کام ماڵپەڕە.'],
  err_wa_scopes_required: ['اختر صلاحية واحدة على الأقل.', 'Pick at least one permission.', 'لانیکەم یەک دەسەڵات هەڵبژێرە.'],
  err_wa_url_https: ['يجب أن يبدأ العنوان بـ https://', 'The address must start with https://', 'ناونیشانەکە دەبێت بە https:// دەست پێبکات.'],
  err_wa_url_invalid: ['العنوان غير صحيح.', 'The address isn’t valid.', 'ناونیشانەکە دروست نییە.'],
  err_wa_events_required: ['اختر متى يُرسل الإشعار.', 'Pick when to send it.', 'هەڵبژێرە کەی بنێردرێت.'],
  err_wa_external_id_required: ['رقم الطلب في الموقع مطلوب.', 'The website’s order number is needed.', 'ژمارەی داواکاری لە ماڵپەڕ پێویستە.'],
  err_wa_lines_required: ['الطلب بلا مواد.', 'The order has no items.', 'داواکارییەکە هیچ کاڵایەکی تێدا نییە.'],
  err_wa_item_unknown: ['السطر {n}: المادة غير موجودة في قاصة.', 'Line {n}: the item isn’t in Qasa.', 'دێڕی {n}: کاڵاکە لە قاسە نییە.'],
  err_wa_qty_invalid: ['السطر {n}: الكمية غير صحيحة.', 'Line {n}: the quantity isn’t valid.', 'دێڕی {n}: بڕەکە دروست نییە.'],
  err_wa_price_required: ['السطر {n}: أرسل السعر (عملة الطلب غير عملة المادة).', 'Line {n}: send the price (the order’s currency isn’t the item’s).', 'دێڕی {n}: نرخەکە بنێرە (دراوی داواکاری جیاوازە لە هی کاڵاکە).'],
  err_wa_shipping_invalid: ['أجور التوصيل غير صحيحة.', 'The delivery charge isn’t valid.', 'کرێی گەیاندن دروست نییە.'],
  err_wa_warehouse_unknown: ['المخزن غير موجود.', 'That warehouse doesn’t exist.', 'ئەو کۆگایە نییە.'],
  err_wa_customer_unknown: ['الزبون غير موجود.', 'That customer doesn’t exist.', 'ئەو کڕیارە نییە.'],
  err_wa_customer_name_required: ['اسم الزبون مطلوب.', 'The customer’s name is needed.', 'ناوی کڕیار پێویستە.'],
  // the office's relay secret or the phone link's key, when Windows can't keep it protected (it is never saved in the clear)
  err_relay_secret_unprotected: [
    'لم يتمكن ويندوز من حماية المفتاح السري لهذا الحاسوب، فلم يُحفظ وبقي هذا مطفأً. أعد تشغيل الحاسوب وحاول مجدداً؛ وإن تكرر ذلك فتواصل مع دعم قاصة ERP.',
    'Windows couldn’t protect this PC’s secret key, so it wasn’t saved and this stays off. Restart the PC and try again; if it keeps happening, contact Qasa ERP support.',
    'ویندۆز نەیتوانی کلیلی نهێنیی ئەم کۆمپیوتەرە بپارێزێت، بۆیە پاشەکەوت نەکرا و ئەمە کوژاوە دەمێنێتەوە. کۆمپیوتەرەکە دووبارە هەڵبکەرەوە و هەوڵ بدەرەوە؛ ئەگەر هەر دووبارە بووەوە پەیوەندی بە پشتگیری قاسە ERP بکە.'
  ],

  e_api_key: ['مفتاح ربط موقع', 'Website key', 'کلیلی ماڵپەڕ'],
  e_webhook: ['إشعار لموقع', 'Webhook', 'ئاگادارکردنەوەی ماڵپەڕ'],
  e_web_order: ['طلب من الموقع', 'Website order', 'داواکاری لە ماڵپەڕەوە'],
  a_revoke: ['إلغاء', 'Cancelled', 'هەڵوەشاندنەوە'],
  a_office_key_renewed: ['مفتاح مكتب جديد للمواقع', 'New office key for websites', 'کلیلی نوێی نووسینگە بۆ ماڵپەڕەکان']
} as const satisfies Record<string, readonly [string, string, string]>;
