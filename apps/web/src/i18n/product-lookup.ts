/**
 * Product lookup (2.1): a product's picture and name from its barcode, out of the open product databases (Open Food
 * Facts and its sister projects). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. The databases'
 * names are proper names and stay in Latin letters.
 */
export const PRODUCT_LOOKUP_TEXT = {
  // the setting (Settings → Sales and items)
  pl_title: ['صور وأسماء المواد من الباركود', 'Product pictures and names from the barcode', 'وێنە و ناوی کاڵا لە بارکۆدەوە'],
  pl_setting: ['البحث عن صور وأسماء المواد عبر الإنترنت', 'Look up product pictures and names online', 'گەڕان بەدوای وێنە و ناوی کاڵا لە ئینتەرنێت'],
  pl_explain: [
    'عند إضافة مادة بباركودها يبحث البرنامج عن صورتها واسمها في قاعدة بيانات المنتجات المفتوحة Open Food Facts (ومشاريعها الشقيقة لمواد التجميل وأغذية الحيوانات والمنتجات الأخرى). يُرسَل رقم الباركود فقط: لا اسم الشركة ولا الأسعار ولا أي شيء عن زبائنك. الباركود الذي تصنعه في محلك (ملصقات الميزان والأرقام الداخلية) لا يُرسَل أبداً.',
    'When you add an item by its barcode, the app looks for its picture and name in the open product database Open Food Facts (and its sister projects for beauty products, pet food and other goods). Only the barcode number is sent: not your company’s name, not your prices, nothing about your customers. A barcode your own shop makes (scale labels, internal numbers) is never sent.',
    'کاتێک کاڵایەک بە بارکۆدەکەی زیاد دەکەیت، بەرنامەکە بەدوای وێنە و ناوەکەیدا دەگەڕێت لە بنکەدراوەی کراوەی بەرهەمەکان Open Food Facts (و پڕۆژە خوشکەکانی بۆ کاڵای جوانکاری و خۆراکی ئاژەڵ و بەرهەمی تر). تەنها ژمارەی بارکۆدەکە دەنێردرێت: نە ناوی کۆمپانیاکەت، نە نرخەکانت، نە هیچ شتێک دەربارەی کڕیارەکانت. ئەو بارکۆدەی دوکانەکەت خۆی دروستی دەکات (لەیبڵی تەرازوو و ژمارە ناوخۆییەکان) هەرگیز نانێردرێت.'
  ],
  pl_offNote: [
    'بدون إنترنت، أو والخيار مطفأ، يعمل كل شيء كما هو وتضيف الصورة بنفسك.',
    'Without internet, or with this switched off, everything works as before and you add the picture yourself.',
    'بەبێ ئینتەرنێت، یان کاتێک ئەمە کوژاوەتەوە، هەموو شتێک وەک پێشوو کار دەکات و خۆت وێنەکە زیاد دەکەیت.'
  ],
  pl_unavailable: ['غير متاح في النسخة التجريبية على الموقع.', 'Not available in the website demo.', 'لە نموونەی سەر ماڵپەڕەکە بەردەست نییە.'],
  pl_on: ['مفعّل', 'On', 'چالاکە'],
  pl_off: ['مطفأ', 'Off', 'کوژاوەتەوە'],
  // the one-time question in the add-item form
  pl_askTitle: ['هل تريد جلب صور المواد تلقائياً؟', 'Fetch product pictures automatically?', 'دەتەوێت وێنەی کاڵاکان خۆکارانە بهێنرێن؟'],
  pl_turnOn: ['تفعيل', 'Turn on', 'چالاککردن'],
  pl_notNow: ['ليس الآن', 'Not now', 'ئێستا نا'],
  pl_changeLater: ['يمكن تغيير ذلك لاحقاً من الإعدادات.', 'You can change this later in Settings.', 'دواتر دەتوانیت لە ڕێکخستنەکان بیگۆڕیت.'],
  // the form
  pl_looking: ['جارٍ البحث عن صورة…', 'Looking for a picture…', 'گەڕان بەدوای وێنەدا…'],
  pl_none: ['لم توجد صورة — أضف واحدة.', 'No picture found — add one.', 'وێنە نەدۆزرایەوە — یەکێک زیاد بکە.'],
  pl_noneNames: ['لم توجد صورة لهذا الباركود — أضف واحدة.', 'No picture for this barcode — add one.', 'وێنە بۆ ئەم بارکۆدە نییە — یەکێک زیاد بکە.'],
  pl_useThis: ['استخدم هذه الصورة', 'Use this picture', 'ئەم وێنەیە بەکاربهێنە'],
  pl_found: ['صورة موجودة لهذا الباركود', 'A picture found for this barcode', 'وێنەیەک بۆ ئەم بارکۆدە دۆزرایەوە'],
  pl_from: ['الصورة من {s}', 'Picture from {s}', 'وێنە لە {s}'],
  pl_names: ['أسماء مقترحة (اضغط للاستخدام)', 'Suggested names (tap to use)', 'ناوە پێشنیارکراوەکان (دەست لێبدە بۆ بەکارهێنان)'],
  pl_takePhoto: ['التقط صورة', 'Take a photo', 'وێنە بگرە'],
  pl_chooseFile: ['اختر ملفاً', 'Choose a file', 'فایلێک هەڵبژێرە'],
  // the items list
  pl_findAll: ['البحث عن صور للمواد التي بلا صورة', 'Find pictures for items without one', 'گەڕان بەدوای وێنە بۆ ئەو کاڵایانەی وێنەیان نییە'],
  pl_findAllHelp: [
    'يبحث البرنامج بباركود كل مادة ليس لها صورة، واحدة بعد أخرى وبهدوء في الخلفية (نحو ست مواد في الدقيقة). لا يستبدل صورة موجودة أبداً. يمكنك إغلاق هذه النافذة ومتابعة عملك.',
    'The app looks up the barcode of each item that has no picture, one after another, quietly in the background (about six items a minute). It never replaces a picture that is there. You can close this window and go on working.',
    'بەرنامەکە بە بارکۆدی هەر کاڵایەک کە وێنەی نییە دەگەڕێت، یەک لە دوای یەک و بە هێمنی لە پشتەوە (نزیکەی شەش کاڵا لە خولەکێکدا). هەرگیز وێنەیەکی هەبوو ناگۆڕێت. دەتوانیت ئەم پەنجەرەیە دابخەیت و بەردەوام بیت لە کارەکەت.'
  ],
  pl_start: ['ابدأ البحث', 'Start', 'دەست پێبکە'],
  pl_stop: ['إيقاف', 'Stop', 'وەستان'],
  pl_progress: ['{done} من {total} · أُضيفت {added} صورة', '{done} of {total} · {added} pictures added', '{done} لە {total} · {added} وێنە زیادکرا'],
  pl_running: ['جارٍ البحث…', 'Searching…', 'گەڕان بەردەوامە…'],
  pl_endDone: ['انتهى البحث.', 'The search is finished.', 'گەڕانەکە تەواو بوو.'],
  pl_endStopped: ['أُوقف البحث.', 'The search was stopped.', 'گەڕانەکە وەستێنرا.'],
  pl_endOff: ['الخيار مطفأ: فعّله من الإعدادات أولاً.', 'The setting is off: switch it on in Settings first.', 'ڕێکخستنەکە کوژاوەتەوە: سەرەتا لە ڕێکخستنەکان چالاکی بکە.'],
  pl_endUnreachable: [
    'تعذّر الوصول إلى قاعدة البيانات (تحقق من الإنترنت). ما أُضيف باقٍ؛ يمكنك البدء من جديد لاحقاً.',
    'The database could not be reached (check the internet). What was added stays; you can start again later.',
    'نەتوانرا بگەینە بنکەدراوەکە (ئینتەرنێتەکە بپشکنە). ئەوەی زیادکرا دەمێنێتەوە؛ دواتر دەتوانیت دووبارە دەست پێبکەیتەوە.'
  ],
  pl_close: ['إغلاق', 'Close', 'داخستن'],
  pl_nothingToFind: ['كل المواد ذات الباركود لها صور.', 'Every item with a barcode has a picture.', 'هەموو ئەو کاڵایانەی بارکۆدیان هەیە وێنەیان هەیە.'],
  // the credit
  pl_credit: ['الصور: مساهمو {s}، بترخيص CC BY-SA', 'Images: {s} contributors, CC BY-SA', 'وێنەکان: بەشداربووانی {s}، بە مۆڵەتی CC BY-SA'],
  lg_openData: [
    'صور وأسماء المواد التي تُجلب بالباركود مصدرها Open Food Facts ومشاريعها الشقيقة: البيانات بترخيص Open Database License والصور بترخيص Creative Commons Attribution-ShareAlike. قد تحمل صور العبوات علامات تجارية تخص أصحابها.',
    'Product pictures and names fetched by barcode come from Open Food Facts and its sister projects: the data under the Open Database License, the pictures under Creative Commons Attribution-ShareAlike. Pictures of packaging may show trademarks that belong to their owners.',
    'ئەو وێنە و ناوانەی کاڵا کە بە بارکۆد دەهێنرێن سەرچاوەکەیان Open Food Facts و پڕۆژە خوشکەکانییەتی: داتاکان بە مۆڵەتی Open Database License و وێنەکان بە مۆڵەتی Creative Commons Attribution-ShareAlike. وێنەی پاکەتەکان لەوانەیە نیشانەی بازرگانیی تێدا بێت کە هی خاوەنەکانیانە.'
  ]
};
