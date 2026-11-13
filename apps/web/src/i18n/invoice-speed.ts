/**
 * Adding a customer or supplier inside the picker (qa_), and the one button that saves, prints and opens the next
 * invoice (sv_). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const INVOICE_SPEED_TEXT = {
  qa_addCustomer: ['إضافة زبون جديد', 'Add a new customer', 'زیادکردنی کڕیاری نوێ'],
  qa_addSupplier: ['إضافة مجهز جديد', 'Add a new supplier', 'زیادکردنی دابینکەری نوێ'],
  qa_addNamedCustomer: ['إضافة «{name}» كزبون جديد', 'Add “{name}” as a new customer', 'زیادکردنی «{name}» وەک کڕیاری نوێ'],
  qa_addNamedSupplier: ['إضافة «{name}» كمجهز جديد', 'Add “{name}” as a new supplier', 'زیادکردنی «{name}» وەک دابینکەری نوێ'],
  qa_city: ['المدينة أو العنوان', 'City or address', 'شار یان ناونیشان'],
  qa_laterCustomer: [
    'الاسم يكفي الآن. باقي المعلومات تُكمَل لاحقاً من صفحة الزبائن.',
    'The name is enough for now. The rest can be filled in later on the Customers page.',
    'ئێستا ناو بەسە. زانیارییەکانی تر دواتر لە پەڕەی کڕیاران پڕ دەکرێنەوە.'
  ],
  qa_laterSupplier: [
    'الاسم يكفي الآن. باقي المعلومات تُكمَل لاحقاً من صفحة المجهزين.',
    'The name is enough for now. The rest can be filled in later on the Suppliers page.',
    'ئێستا ناو بەسە. زانیارییەکانی تر دواتر لە پەڕەی دابینکەران پڕ دەکرێنەوە.'
  ],
  qa_nameNeeded: ['اكتب الاسم.', 'Enter the name.', 'ناوەکە بنووسە.'],
  qa_nameLetters: [
    'اكتب الاسم بالحروف: الرقم وحده ليس اسماً.',
    'Enter the name in letters: a number alone is not a name.',
    'ناوەکە بە پیت بنووسە: ژمارە بە تەنها ناو نییە.'
  ],
  qa_tooLong: ['النص أطول من المسموح.', 'That text is too long.', 'ئەو دەقە لە ڕادە درێژترە.'],
  qa_add: ['إضافة واختيار', 'Add and choose', 'زیادکردن و هەڵبژاردن'],
  qa_sameCustomer: ['يوجد زبون بالاسم نفسه أو الهاتف نفسه:', 'A customer with the same name or phone already exists:', 'کڕیارێک بە هەمان ناو یان هەمان تەلەفۆن پێشتر هەیە:'],
  qa_sameSupplier: ['يوجد مجهز بالاسم نفسه أو الهاتف نفسه:', 'A supplier with the same name or phone already exists:', 'دابینکەرێک بە هەمان ناو یان هەمان تەلەفۆن پێشتر هەیە:'],
  qa_samePhone: ['الهاتف نفسه', 'same phone', 'هەمان تەلەفۆن'],
  qa_sameName: ['الاسم نفسه', 'same name', 'هەمان ناو'],
  qa_useThis: ['استخدم هذا', 'Use this one', 'ئەمە بەکاربهێنە'],
  qa_addAnyway: ['أضِفه على أي حال', 'Add anyway', 'هەر زیادی بکە'],
  qa_inactiveNote: ['موقوف: يُفعَّل من صفحته أولاً', 'switched off: turn it on from its page first', 'ناچالاکە: سەرەتا لە پەڕەکەی خۆی چالاکی بکە'],
  qa_added: ['أُضيف {name} ({code})', '{name} added ({code})', '{name} زیادکرا ({code})'],
  qa_listNotSaved: [
    'أُضيف الزبون، لكن قائمة أسعاره لم تُحفظ. اخترها من صفحته.',
    'The customer was added, but the price list was not saved. Choose it on the customer’s page.',
    'کڕیارەکە زیادکرا، بەڵام لیستی نرخەکەی پاشەکەوت نەکرا. لە پەڕەی کڕیارەکە هەڵیبژێرە.'
  ],
  qa_offline: [
    'تعذر الوصول إلى الخادم، فلم يُضَف بعد. حاول مجدداً عند عودة الاتصال: لن يُضاف مرتين.',
    'The server can’t be reached, so nothing is added yet. Try again when the link is back: it is never added twice.',
    'پەیوەندی بە سێرڤەرەوە نەکرا، بۆیە هێشتا زیاد نەکراوە. کاتێک پەیوەندی گەڕایەوە دووبارە هەوڵ بدە: هەرگیز دوو جار زیاد ناکرێت.'
  ],

  sv_print_next: ['حفظ وطباعة والتالية', 'Save, print and next', 'پاشەکەوت، چاپ و داهاتوو'],
  sv_print: ['حفظ وطباعة', 'Save and print', 'پاشەکەوت و چاپ'],
  sv_next: ['حفظ والتالية', 'Save and next', 'پاشەکەوت و داهاتوو'],
  sv_whatsapp: ['حفظ وإرسال على واتساب', 'Save and send on WhatsApp', 'پاشەکەوت و ناردن بە واتسئاپ'],
  sv_more: ['طرق أخرى للحفظ', 'Other ways to save', 'ڕێگەکانی تری پاشەکەوتکردن'],
  sv_hint_print_next: ['ترحيل الفاتورة ثم طباعتها ثم فتح فاتورة جديدة فارغة', 'Posts the invoice, prints it, then opens a new empty one', 'پسوولەکە تۆمار دەکات، چاپی دەکات، پاشان پسوولەیەکی نوێی بەتاڵ دەکاتەوە'],
  sv_hint_print: ['ترحيل الفاتورة ثم طباعتها', 'Posts the invoice and prints it', 'پسوولەکە تۆمار دەکات و چاپی دەکات'],
  sv_hint_next: ['ترحيل الفاتورة ثم فتح فاتورة جديدة فارغة', 'Posts the invoice, then opens a new empty one', 'پسوولەکە تۆمار دەکات، پاشان پسوولەیەکی نوێی بەتاڵ دەکاتەوە'],
  sv_hint_next_draft: ['حفظها مسودةً ثم فتح فاتورة جديدة فارغة', 'Saves it as a draft, then opens a new empty one', 'وەک ڕەشنووس پاشەکەوتی دەکات، پاشان پسوولەیەکی نوێی بەتاڵ دەکاتەوە'],
  sv_hint_whatsapp: ['ترحيل الفاتورة ثم فتح نافذة الإرسال على واتساب', 'Posts the invoice, then opens the send on WhatsApp window', 'پسوولەکە تۆمار دەکات، پاشان پەنجەرەی ناردن بە واتسئاپ دەکاتەوە'],
  sv_hint_post: ['ترحيل الفاتورة ثم فتح صفحتها', 'Posts the invoice and opens its own page', 'پسوولەکە تۆمار دەکات و پەڕەکەی خۆی دەکاتەوە'],
  sv_hint_draft: ['حفظ بلا ترحيل: يمكن تعديلها لاحقاً', 'Saves without posting: it can still be changed', 'بێ تۆمارکردن پاشەکەوتی دەکات: دواتر دەگۆڕدرێت'],
  sv_remembered: ['الزر الرئيسي يتذكر آخر طريقة اخترتها.', 'The main button remembers the way you chose last.', 'دوگمە سەرەکییەکە دوایین ڕێگەی هەڵبژێردراوت لەبیر دەمێنێت.'],
  sv_onlyDraft: [
    'صلاحيتك إعداد الفاتورة فقط: تُحفظ مسودةً، ويرحّلها من له صلاحية الترحيل.',
    'You may prepare invoices but not post them: it is saved as a draft, for someone who may post it.',
    'تۆ تەنها دەتوانیت پسوولە ئامادە بکەیت: وەک ڕەشنووس پاشەکەوت دەکرێت، تا کەسێکی مۆڵەتدار تۆماری بکات.'
  ],
  sv_lastPosted: ['حُفظت الفاتورة {n} ورُحّلت', 'Invoice {n} is saved and posted', 'پسوولەی {n} پاشەکەوت و تۆمار کرا'],
  sv_lastDraft: ['حُفظت الفاتورة مسودةً', 'The invoice is saved as a draft', 'پسوولەکە وەک ڕەشنووس پاشەکەوت کرا'],
  sv_notPrinted: [
    'حُفظت الفاتورة {n}، لكنها لم تُطبع. اضغط «طباعة» للمحاولة مجدداً.',
    'Invoice {n} is saved, but it did not print. Press Print to try again.',
    'پسوولەی {n} پاشەکەوت کرا، بەڵام چاپ نەکرا. بۆ هەوڵدانەوە «چاپ» دابگرە.'
  ],
  sv_printing: ['جارٍ إرسال الفاتورة إلى الطابعة…', 'Sending the invoice to the printer…', 'پسوولەکە بۆ چاپکەر دەنێردرێت…'],
  sv_open: ['فتح الفاتورة', 'Open the invoice', 'کردنەوەی پسوولەکە'],
  sv_hide: ['إخفاء', 'Hide', 'شاردنەوە']
} as const satisfies Record<string, readonly [string, string, string]>;
