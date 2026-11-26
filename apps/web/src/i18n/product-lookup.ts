/**
 * Product lookup (2.0): a product's picture and name from its barcode, out of the open product databases (Open Food
 * Facts and its sister projects). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. The databases'
 * names are proper names and stay in Latin letters.
 */
export const PRODUCT_LOOKUP_TEXT = {
  // the setting (Settings → Sales and items)
  plk_title: ['صور وأسماء المواد من الباركود', 'Product pictures and names from the barcode', 'وێنە و ناوی کاڵا لە بارکۆدەوە'],
  plk_setting: ['البحث عن صور وأسماء المواد عبر الإنترنت', 'Look up product pictures and names online', 'گەڕان بەدوای وێنە و ناوی کاڵا لە ئینتەرنێت'],
  plk_explain: [
    'عند إضافة مادة بباركودها يبحث البرنامج عن صورتها واسمها في قاعدة بيانات المنتجات المفتوحة Open Food Facts (ومشاريعها الشقيقة لمواد التجميل وأغذية الحيوانات والمنتجات الأخرى). يُرسَل رقم الباركود فقط: لا اسم الشركة ولا الأسعار ولا أي شيء عن زبائنك. الباركود الذي تصنعه في محلك (ملصقات الميزان والأرقام الداخلية) لا يُرسَل أبداً.',
    'When you add an item by its barcode, the app looks for its picture and name in the open product database Open Food Facts (and its sister projects for beauty products, pet food and other goods). Only the barcode number is sent: not your company’s name, not your prices, nothing about your customers. A barcode your own shop makes (scale labels, internal numbers) is never sent.',
    'کاتێک کاڵایەک بە بارکۆدەکەی زیاد دەکەیت، بەرنامەکە بەدوای وێنە و ناوەکەیدا دەگەڕێت لە بنکەدراوەی کراوەی بەرهەمەکان Open Food Facts (و پڕۆژە خوشکەکانی بۆ کاڵای جوانکاری و خۆراکی ئاژەڵ و بەرهەمی تر). تەنها ژمارەی بارکۆدەکە دەنێردرێت: نە ناوی کۆمپانیاکەت، نە نرخەکانت، نە هیچ شتێک دەربارەی کڕیارەکانت. ئەو بارکۆدەی دوکانەکەت خۆی دروستی دەکات (لەیبڵی تەرازوو و ژمارە ناوخۆییەکان) هەرگیز نانێردرێت.'
  ],
  plk_offNote: [
    'بدون إنترنت، أو والخيار مطفأ، يعمل كل شيء كما هو وتضيف الصورة بنفسك.',
    'Without internet, or with this switched off, everything works as before and you add the picture yourself.',
    'بەبێ ئینتەرنێت، یان کاتێک ئەمە کوژاوەتەوە، هەموو شتێک وەک پێشوو کار دەکات و خۆت وێنەکە زیاد دەکەیت.'
  ],
  plk_unavailable: ['غير متاح في النسخة التجريبية على الموقع.', 'Not available in the website demo.', 'لە نموونەی سەر ماڵپەڕەکە بەردەست نییە.'],
  plk_on: ['مفعّل', 'On', 'چالاکە'],
  plk_off: ['مطفأ', 'Off', 'کوژاوەتەوە'],
  // the one-time question in the add-item form
  plk_askTitle: ['هل تريد جلب صور المواد تلقائياً؟', 'Fetch product pictures automatically?', 'دەتەوێت وێنەی کاڵاکان خۆکارانە بهێنرێن؟'],
  plk_turnOn: ['تفعيل', 'Turn on', 'چالاککردن'],
  plk_notNow: ['ليس الآن', 'Not now', 'ئێستا نا'],
  plk_changeLater: ['يمكن تغيير ذلك لاحقاً من الإعدادات.', 'You can change this later in Settings.', 'دواتر دەتوانیت لە ڕێکخستنەکان بیگۆڕیت.'],
  // the form
  plk_looking: ['جارٍ البحث عن صورة…', 'Looking for a picture…', 'گەڕان بەدوای وێنەدا…'],
  plk_none: ['لم توجد صورة — أضف واحدة.', 'No picture found — add one.', 'وێنە نەدۆزرایەوە — یەکێک زیاد بکە.'],
  plk_noneNames: ['لم توجد صورة لهذا الباركود — أضف واحدة.', 'No picture for this barcode — add one.', 'وێنە بۆ ئەم بارکۆدە نییە — یەکێک زیاد بکە.'],
  plk_useThis: ['استخدم هذه الصورة', 'Use this picture', 'ئەم وێنەیە بەکاربهێنە'],
  plk_found: ['صورة موجودة لهذا الباركود', 'A picture found for this barcode', 'وێنەیەک بۆ ئەم بارکۆدە دۆزرایەوە'],
  plk_from: ['الصورة من {s}', 'Picture from {s}', 'وێنە لە {s}'],
  plk_names: ['أسماء مقترحة (اضغط للاستخدام)', 'Suggested names (tap to use)', 'ناوە پێشنیارکراوەکان (دەست لێبدە بۆ بەکارهێنان)'],
  plk_takePhoto: ['التقط صورة', 'Take a photo', 'وێنە بگرە'],
  plk_chooseFile: ['اختر ملفاً', 'Choose a file', 'فایلێک هەڵبژێرە'],
  // the items list
  plk_findOne: ['ابحث عن صورة', 'Find a picture', 'بەدوای وێنەدا بگەڕێ'],
  plk_noneForItem: ['لم توجد صورة لهذا الباركود.', 'No picture was found for this barcode.', 'هیچ وێنەیەک بۆ ئەم بارکۆدە نەدۆزرایەوە.'],
  plk_busyOne: ['عمليات بحث كثيرة الآن. حاول بعد دقيقة.', 'Too many searches just now. Try again in a minute.', 'ئێستا گەڕان زۆرە. دوای خولەکێک هەوڵ بدەرەوە.'],
  plk_unreachableOne: ['تعذّر الوصول إلى قاعدة البيانات (تحقق من الإنترنت).', 'The database could not be reached (check the internet).', 'نەتوانرا بگەینە بنکەدراوەکە (ئینتەرنێتەکە بپشکنە).'],
  plk_findAll: ['البحث عن صور للمواد التي بلا صورة', 'Find pictures for items without one', 'گەڕان بەدوای وێنە بۆ ئەو کاڵایانەی وێنەیان نییە'],
  plk_findAllHelp: [
    'يبحث البرنامج بباركود كل مادة ليس لها صورة، واحدة بعد أخرى وبهدوء في الخلفية (نحو ست مواد في الدقيقة). لا يستبدل صورة موجودة أبداً. يمكنك إغلاق هذه النافذة ومتابعة عملك.',
    'The app looks up the barcode of each item that has no picture, one after another, quietly in the background (about six items a minute). It never replaces a picture that is there. You can close this window and go on working.',
    'بەرنامەکە بە بارکۆدی هەر کاڵایەک کە وێنەی نییە دەگەڕێت، یەک لە دوای یەک و بە هێمنی لە پشتەوە (نزیکەی شەش کاڵا لە خولەکێکدا). هەرگیز وێنەیەکی هەبوو ناگۆڕێت. دەتوانیت ئەم پەنجەرەیە دابخەیت و بەردەوام بیت لە کارەکەت.'
  ],
  plk_start: ['ابدأ البحث', 'Start', 'دەست پێبکە'],
  plk_stop: ['إيقاف', 'Stop', 'وەستان'],
  plk_progress: ['{done} من {total} · أُضيفت {added} صورة', '{done} of {total} · {added} pictures added', '{done} لە {total} · {added} وێنە زیادکرا'],
  plk_running: ['جارٍ البحث…', 'Searching…', 'گەڕان بەردەوامە…'],
  plk_endDone: ['انتهى البحث.', 'The search is finished.', 'گەڕانەکە تەواو بوو.'],
  plk_endStopped: ['أُوقف البحث.', 'The search was stopped.', 'گەڕانەکە وەستێنرا.'],
  plk_endOff: ['الخيار مطفأ: فعّله من الإعدادات أولاً.', 'The setting is off: switch it on in Settings first.', 'ڕێکخستنەکە کوژاوەتەوە: سەرەتا لە ڕێکخستنەکان چالاکی بکە.'],
  plk_endUnreachable: [
    'تعذّر الوصول إلى قاعدة البيانات (تحقق من الإنترنت). ما أُضيف باقٍ؛ يمكنك البدء من جديد لاحقاً.',
    'The database could not be reached (check the internet). What was added stays; you can start again later.',
    'نەتوانرا بگەینە بنکەدراوەکە (ئینتەرنێتەکە بپشکنە). ئەوەی زیادکرا دەمێنێتەوە؛ دواتر دەتوانیت دووبارە دەست پێبکەیتەوە.'
  ],
  plk_close: ['إغلاق', 'Close', 'داخستن'],
  plk_nothingToFind: ['كل المواد ذات الباركود لها صور.', 'Every item with a barcode has a picture.', 'هەموو ئەو کاڵایانەی بارکۆدیان هەیە وێنەیان هەیە.'],
  // the credit
  plk_credit: ['الصور: مساهمو {s}، بترخيص CC BY-SA', 'Images: {s} contributors, CC BY-SA', 'وێنەکان: بەشداربووانی {s}، بە مۆڵەتی CC BY-SA'],
  lg_openData: [
    'صور وأسماء المواد التي تُجلب بالباركود مصدرها Open Food Facts ومشاريعها الشقيقة: البيانات بترخيص Open Database License والصور بترخيص Creative Commons Attribution-ShareAlike. قد تحمل صور العبوات علامات تجارية تخص أصحابها.',
    'Product pictures and names fetched by barcode come from Open Food Facts and its sister projects: the data under the Open Database License, the pictures under Creative Commons Attribution-ShareAlike. Pictures of packaging may show trademarks that belong to their owners.',
    'ئەو وێنە و ناوانەی کاڵا کە بە بارکۆد دەهێنرێن سەرچاوەکەیان Open Food Facts و پڕۆژە خوشکەکانییەتی: داتاکان بە مۆڵەتی Open Database License و وێنەکان بە مۆڵەتی Creative Commons Attribution-ShareAlike. وێنەی پاکەتەکان لەوانەیە نیشانەی بازرگانیی تێدا بێت کە هی خاوەنەکانیانە.'
  ]
};
