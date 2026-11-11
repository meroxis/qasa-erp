/**
 * The offline outbox and the offline till (1.2): what a PC connected to an office server keeps while the server can't
 * be reached, and sends when the link is back. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const OUTBOX_TEXT = {
  ob_title: ['ما ينتظر الإرسال', 'Waiting to send', 'چاوەڕێی ناردن'],
  ob_bannerOffline: ['غير متصل — {n} بانتظار الإرسال', 'Offline — {n} waiting to send', 'بێ پەیوەندی — {n} چاوەڕێی ناردنن'],
  ob_bannerOfflineNone: ['غير متصل بخادم المكتب — يستمر البيع نقداً وبالبطاقة، ويُحفظ على هذا الحاسوب حتى يعود الاتصال', 'Offline from the office server — cash and card sales go on and are kept on this PC until the link is back', 'پەیوەندی بە سێرڤەری نووسینگەوە نییە — فرۆشتن بە نەقد و کارت بەردەوامە و تا پەیوەندی دەگەڕێتەوە لەسەر ئەم کۆمپیوتەرە دەپارێزرێت'],
  ob_bannerSending: ['يجري إرسال {n} كانت بانتظار الاتصال…', 'Sending {n} that waited for the link…', 'ناردنی {n} کە چاوەڕێی پەیوەندی بوون…'],
  ob_bannerWaiting: ['{n} بانتظار الإرسال على هذا الحاسوب', '{n} waiting to send on this PC', '{n} لەسەر ئەم کۆمپیوتەرە چاوەڕێی ناردنن'],
  ob_bannerRefused: ['{n} لم يقبلها الخادم وتحتاج إلى من يراجعها', '{n} not accepted by the server and need a person', '{n} لەلایەن سێرڤەرەوە وەرنەگیران و پێویستیان بە کەسێکە سەیریان بکات'],
  ob_bannerDamaged: ['تعذّرت قراءة قائمة الانتظار على هذا الحاسوب فحُفظت جانباً كما هي. اتصل بالدعم.', 'The waiting list on this PC could not be read and was kept aside as it was. Contact support.', 'لیستی چاوەڕوانی لەسەر ئەم کۆمپیوتەرە نەخوێندرایەوە و وەک خۆی لایەک دانرا. پەیوەندی بە پشتگیرییەوە بکە.'],
  ob_open: ['عرض القائمة', 'Open the list', 'کردنەوەی لیستەکە'],
  ob_intro: [
    'ما حفظه هذا الحاسوب حين تعذّر الوصول إلى خادم المكتب: مبيعات الكاشير وسندات القبض. يُرسل كلٌّ منها وحده وبالترتيب عند عودة الاتصال، ويُسجَّل في الدفاتر مرة واحدة فقط.',
    'What this PC kept while the office server could not be reached: till sales and receipt vouchers. Each is sent by itself, in order, when the link is back, and is booked once only.',
    'ئەوەی ئەم کۆمپیوتەرە پاشەکەوتی کرد کاتێک سێرڤەری نووسینگە نەدەگەیشترا: فرۆشتنەکانی کاشێر و سەنەدەکانی وەرگرتن. هەر یەکەیان خۆی و بە ڕیز کاتێک پەیوەندی گەڕایەوە دەنێردرێت، و تەنها یەک جار لە دەفتەرەکاندا تۆمار دەکرێت.'
  ],
  ob_none: ['لا شيء بانتظار الإرسال.', 'Nothing is waiting to send.', 'هیچ شتێک چاوەڕێی ناردن نییە.'],
  ob_notOffice: ['قائمة الانتظار موجودة فقط على حاسوب متصل بخادم المكتب.', 'The waiting list is only on a PC connected to an office server.', 'لیستی چاوەڕوانی تەنها لەسەر کۆمپیوتەرێکە کە بە سێرڤەری نووسینگەوە بەستراوە.'],
  ob_kind_pos_sale: ['بيع كاشير', 'Till sale', 'فرۆشتنی کاشێر'],
  ob_kind_voucher: ['سند قبض', 'Receipt voucher', 'سەنەدی وەرگرتن'],
  ob_what: ['ما هو', 'What', 'چییە'],
  ob_madeBy: ['بواسطة', 'By', 'لەلایەن'],
  ob_madeAt: ['الوقت', 'Time', 'کات'],
  ob_amount: ['المبلغ', 'Amount', 'بڕ'],
  ob_state: ['الحالة', 'Status', 'دۆخ'],
  ob_waiting: ['بانتظار الإرسال', 'Waiting', 'چاوەڕێی ناردن'],
  ob_sending: ['يُرسل الآن', 'Sending', 'دەنێردرێت'],
  ob_refused: ['لم يُقبل', 'Not accepted', 'وەرنەگیرا'],
  ob_otherUser: ['يُرسل حين يدخل {u} على هذا الحاسوب', 'Sent when {u} signs in on this PC', 'کاتێک {u} لەسەر ئەم کۆمپیوتەرە دەچێتە ژوورەوە دەنێردرێت'],
  ob_tries: ['المحاولات: {n}', 'Tries: {n}', 'هەوڵەکان: {n}'],
  ob_nextTry: ['المحاولة التالية {t}', 'Next try {t}', 'هەوڵی داهاتوو {t}'],
  ob_why: ['السبب', 'Why', 'هۆکار'],
  ob_fixHint: [
    'صحّح السبب على الخادم (المخزون، المادة، الوردية…) ثم «أرسل الآن»، أو احذفه من القائمة وسجّله يدوياً.',
    'Fix the cause on the server (the stock, the item, the shift…) and press Send now, or discard it and record it by hand.',
    'هۆکارەکە لەسەر سێرڤەر چاک بکە (کۆگا، کاڵا، شەفت…) و «ئێستا بینێرە» دابگرە، یان لە لیستەکە لایببە و بە دەست تۆماری بکە.'
  ],
  ob_sendNow: ['أرسل الآن', 'Send now', 'ئێستا بینێرە'],
  ob_discard: ['حذف من القائمة…', 'Discard…', 'لابردن لە لیستەکە…'],
  ob_discardTitle: ['حذف من قائمة الانتظار؟', 'Discard from the waiting list?', 'لە لیستی چاوەڕوانی لاببرێت؟'],
  ob_discardText: [
    'لن يُسجَّل في الدفاتر أبداً. إن كان المال قد استُلم فسجّله يدوياً. يُكتب الحذف في سجل التدقيق مع ما كان فيه.',
    'It will never be booked. If money was taken, record it by hand. The discard is written to the audit log with what it held.',
    'هەرگیز لە دەفتەرەکاندا تۆمار ناکرێت. ئەگەر پارە وەرگیرابێت، بە دەست تۆماری بکە. لابردنەکە لەگەڵ ناوەڕۆکەکەی لە تۆماری وردبینیدا دەنووسرێت.'
  ],
  ob_discardReason: ['السبب (اختياري)', 'Reason (optional)', 'هۆکار (ئارەزوومەندانە)'],
  ob_discardConfirm: ['احذف نهائياً', 'Discard for good', 'بە یەکجاری لایببە'],
  ob_discardNeedsServer: ['الحذف يحتاج خادم المكتب ليُكتب في سجل التدقيق.', 'Discarding needs the office server, to write it to the audit log.', 'لابردن پێویستی بە سێرڤەری نووسینگەیە بۆ ئەوەی لە تۆماری وردبینیدا بنووسرێت.'],
  ob_discarded: ['حُذف وكُتب في سجل التدقيق', 'Discarded and written to the audit log', 'لابرا و لە تۆماری وردبینیدا نووسرا'],
  ob_discardedBooked: ['كان قد سُجّل في الدفاتر من قبل؛ حُذفت النسخة التي على هذا الحاسوب فقط', 'It had been booked already; only the copy on this PC was removed', 'پێشتر تۆمار کرابوو؛ تەنها کۆپییەکەی سەر ئەم کۆمپیوتەرە لابرا'],
  ob_back: ['رجوع', 'Back', 'گەڕانەوە'],
  ob_savedHere: ['حُفظ على هذا الحاسوب برقم {n} — يُرسل عند عودة الاتصال', 'Kept on this PC as {n} — sent when the link is back', 'لەسەر ئەم کۆمپیوتەرە بە ژمارەی {n} پاشەکەوت کرا — کاتێک پەیوەندی گەڕایەوە دەنێردرێت'],
  ob_voucherSavedHere: ['حُفظ السند على هذا الحاسوب — يُرسل عند عودة الاتصال', 'The voucher is kept on this PC — sent when the link is back', 'سەنەدەکە لەسەر ئەم کۆمپیوتەرە پاشەکەوت کرا — کاتێک پەیوەندی گەڕایەوە دەنێردرێت'],

  pos_offline: ['دون اتصال', 'Offline', 'بێ پەیوەندی'],
  pos_offlineWaiting: ['{n} على هذا الحاسوب', '{n} on this PC', '{n} لەسەر ئەم کۆمپیوتەرە'],
  pos_offlineReceipt: ['رقم مؤقت — يصدر رقم الفاتورة عند عودة الاتصال', 'Temporary number — the invoice number follows when the link is back', 'ژمارەی کاتی — ژمارەی پسوولە کاتێک پەیوەندی گەڕایەوە دەردەچێت'],
  pos_offlineShort: [
    'المخزون المعروف آخر مرة أقل مما بيع: {i}. حُفظ البيع، ويتحقق منه الخادم عند وصوله.',
    'The stock last known is less than was sold: {i}. The sale is kept; the server checks it when it arrives.',
    'ئەو کۆگایەی دوایین جار زانرا کەمترە لەوەی فرۆشرا: {i}. فرۆشتنەکە پاشەکەوت کرا؛ سێرڤەرەکە کاتێک گەیشت دەیپشکنێت.'
  ],
  pos_offlineNoAccount: ['البيع على حساب الزبون يحتاج الاتصال بالخادم.', 'Selling on a customer’s account needs the server.', 'فرۆشتن لەسەر حسابی کڕیار پێویستی بە سێرڤەرە.'],
  pos_unsure: [
    'لم يُجب الخادم، فربما سُجّل هذا البيع من قبل. اضغط «دفع وطباعة» مرة أخرى عند عودة الاتصال: البيع نفسه لا يُسجَّل إلا مرة واحدة. قبل أن تغيّره أو تمسحه راجع مبيعات الوردية، كي لا يُباع مرتين.',
    'The server didn’t answer, so this sale may already be booked. Press Pay again once the link is back: the same sale is booked only once. Before you change or clear it, check the shift’s sales, so it isn’t sold twice.',
    'سێرڤەرەکە وەڵامی نەدایەوە، بۆیە لەوانەیە ئەم فرۆشتنە پێشتر تۆمار کرابێت. کاتێک پەیوەندی گەڕایەوە دووبارە «پارەدان» دابگرە: هەمان فرۆشتن تەنها یەک جار تۆمار دەکرێت. پێش ئەوەی بیگۆڕیت یان پاکی بکەیتەوە، فرۆشتنەکانی شەفتەکە ببینە، تا دوو جار نەفرۆشرێت.'
  ],
  // the button under either note: the person checked and it isn't there, so it may be sent as a new one
  ob_unsureNotThere: ['تحققت: ليس موجوداً', 'I checked: it isn’t there', 'پشکنیم: لەوێ نییە'],
  err_changed_after_unsure: [
    'ربما سُجّلت المحاولة السابقة، وقد تغيّر هذا منذ ذلك الحين. راجع أولاً مبيعات الوردية أو السندات والقيود: إن وجدتها فامسح هذا، وإلا فاضغط «تحققت: ليس موجوداً».',
    'The last try may already be booked, and this has changed since. Check the shift’s sales or Vouchers & entries first: if it’s there, clear this one; if not, press “I checked: it isn’t there”.',
    'لەوانەیە هەوڵی پێشوو پێشتر تۆمار کرابێت، و ئەمە لەو کاتەوە گۆڕاوە. سەرەتا فرۆشتنەکانی شەفتەکە یان سەنەد و تۆمارەکان ببینە: ئەگەر هەبوو ئەمە پاک بکەرەوە، ئەگەر نا «پشکنیم: لەوێ نییە» دابگرە.'
  ],
  ob_voucherUnsure: [
    'لم يُجب الخادم، فربما حُفظ هذا السند من قبل. اضغط «حفظ كمسودة» مرة أخرى عند عودة الاتصال: السند نفسه لا يُحفظ إلا مرة واحدة. قبل أن تغيّره راجع السندات والقيود، كي لا يُحفظ مرتين.',
    'The server didn’t answer, so this voucher may already be saved. Press Save as draft again once the link is back: the same voucher is saved only once. Before you change it, check Vouchers & entries, so it isn’t saved twice.',
    'سێرڤەرەکە وەڵامی نەدایەوە، بۆیە لەوانەیە ئەم سەنەدە پێشتر پاشەکەوت کرابێت. کاتێک پەیوەندی گەڕایەوە دووبارە «پاشەکەوت وەک ڕەشنووس» دابگرە: هەمان سەنەد تەنها یەک جار پاشەکەوت دەکرێت. پێش ئەوەی بیگۆڕیت، سەنەد و تۆمارەکان ببینە، تا دوو جار پاشەکەوت نەکرێت.'
  ],
  pos_closeWaiting: [
    '{n} من مبيعات هذه الوردية ما زالت على هذا الحاسوب. أرسلها أو راجع قائمة الانتظار قبل الإغلاق، ليكون النقد المتوقع صحيحاً.',
    '{n} sales of this shift are still on this PC. Send them or check the waiting list before closing, so the expected cash is right.',
    '{n} فرۆشتنی ئەم شەفتە هێشتا لەسەر ئەم کۆمپیوتەرەن. پێش داخستن بیاننێرە یان لیستی چاوەڕوانی ببینە، تا پارەی چاوەڕوانکراو دروست بێت.'
  ],

  err_outbox_unavailable: [
    'لا يمكن حفظه على هذا الحاسوب الآن (لم يصل إلى خادم المكتب منذ فُتح البرنامج).',
    'It can’t be kept on this PC now (the PC hasn’t reached the office server since the app opened).',
    'ئێستا ناتوانرێت لەسەر ئەم کۆمپیوتەرە پاشەکەوت بکرێت (لە کاتی کردنەوەی بەرنامەکەوە نەگەیشتۆتە سێرڤەری نووسینگە).'
  ],
  err_outbox_write_failed: ['تعذّرت الكتابة على قرص هذا الحاسوب (ربما امتلأ). لم يُحفظ.', 'Couldn’t write to this PC’s disk (it may be full). It was not kept.', 'نەتوانرا لەسەر دیسکی ئەم کۆمپیوتەرە بنووسرێت (لەوانەیە پڕ بووبێت). پاشەکەوت نەکرا.'],
  err_outbox_full: ['قائمة الانتظار على هذا الحاسوب ممتلئة. أعد الاتصال بخادم المكتب أولاً.', 'The waiting list on this PC is full. Reconnect to the office server first.', 'لیستی چاوەڕوانی لەسەر ئەم کۆمپیوتەرە پڕە. سەرەتا دووبارە بە سێرڤەری نووسینگەوە ببەستەوە.'],
  err_outbox_invalid: ['لا يمكن حفظ هذا في قائمة الانتظار.', 'This can’t be kept in the waiting list.', 'ئەمە ناتوانرێت لە لیستی چاوەڕوانیدا پاشەکەوت بکرێت.'],
  err_outbox_duplicate: ['هذا محفوظ في قائمة الانتظار من قبل.', 'This is in the waiting list already.', 'ئەمە پێشتر لە لیستی چاوەڕوانیدایە.'],
  err_outbox_missing: ['لم يعد هذا في قائمة الانتظار.', 'This is no longer in the waiting list.', 'ئەمە چیتر لە لیستی چاوەڕوانیدا نییە.'],
  err_idempotency_key_reused: [
    'أُرسل هذا من قبل بمحتوى آخر أو من مستخدم آخر، فلم يُسجَّل مرة ثانية.',
    'This was sent before with other contents or by another user, so it was not booked again.',
    'ئەمە پێشتر بە ناوەڕۆکێکی تر یان لەلایەن بەکارهێنەرێکی ترەوە نێردرابوو، بۆیە دووبارە تۆمار نەکرا.'
  ],
  err_idempotency_key_invalid: ['الطلب غير صالح.', 'The request isn’t valid.', 'داواکارییەکە دروست نییە.'],
  err_pos_offline_on_account: ['البيع على حساب الزبون يحتاج الاتصال بالخادم.', 'Selling on a customer’s account needs the server.', 'فرۆشتن لەسەر حسابی کڕیار پێویستی بە سێرڤەرە.'],
  err_pos_offline_loyalty: ['استعمال نقاط الولاء يحتاج الاتصال بالخادم.', 'Using loyalty points needs the server.', 'بەکارهێنانی خاڵەکانی دڵسۆزی پێویستی بە سێرڤەرە.'],
  err_pos_offline_invalid: ['الرقم المؤقت لهذا البيع غير صالح.', 'This sale’s temporary number isn’t valid.', 'ژمارەی کاتیی ئەم فرۆشتنە دروست نییە.'],
  err_other_books: ['حُفظ هذا لدفاتر شركة أخرى، فلا يُرسل إلى هذه.', 'This was kept for another company’s books, so it isn’t sent to these.', 'ئەمە بۆ دەفتەری کۆمپانیایەکی تر پاشەکەوت کرابوو، بۆیە بۆ ئەمە نانێردرێت.']
} as const satisfies Record<string, readonly [string, string, string]>;
