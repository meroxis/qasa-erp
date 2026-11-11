/** Sending documents on WhatsApp as a PDF. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const WHATSAPP_TEXT = {
  wp_partyLang: ['لغة رسائل واتساب', 'Language for WhatsApp messages', 'زمانی نامەکانی واتسئاپ'],
  wp_langApp: ['لغة البرنامج', 'The app’s language', 'زمانی بەرنامەکە'],
  wp_send: ['أرسل على واتساب', 'Send on WhatsApp', 'ناردن بە واتسئاپ'],
  wp_title_invoice: ['إرسال الفاتورة على واتساب', 'Send the invoice on WhatsApp', 'ناردنی پسوولەکە بە واتسئاپ'],
  wp_title_receipt: ['إرسال الوصل على واتساب', 'Send the receipt on WhatsApp', 'ناردنی وەسڵەکە بە واتسئاپ'],
  wp_title_quote: ['إرسال عرض السعر على واتساب', 'Send the quotation on WhatsApp', 'ناردنی نرخنامەکە بە واتسئاپ'],
  wp_title_statement: ['إرسال كشف الحساب على واتساب', 'Send the account statement on WhatsApp', 'ناردنی کەشفی هەژمارەکە بە واتسئاپ'],
  wp_title_dayclose: ['إرسال إغلاق اليوم على واتساب', 'Send the end-of-day close on WhatsApp', 'ناردنی داخستنی ڕۆژ بە واتسئاپ'],
  wp_phone: ['رقم واتساب', 'WhatsApp number', 'ژمارەی واتسئاپ'],
  wp_phoneHint: [
    'موبايل عراقي مثل 0750 123 4567 أو ‎+964 750 123 4567، أو رقم دولي يبدأ بـ +. اتركه فارغاً لتختار المحادثة في واتساب.',
    'An Iraqi mobile such as 0750 123 4567 or +964 750 123 4567, or an international number starting with +. Leave it empty to pick the chat in WhatsApp.',
    'مۆبایلێکی عێراقی وەک 0750 123 4567 یان ‎+964 750 123 4567، یان ژمارەیەکی نێودەوڵەتی کە بە + دەست پێدەکات. بەتاڵی بهێڵەوە بۆ ئەوەی گفتوگۆکە لە واتسئاپ هەڵبژێریت.'
  ],
  wp_phoneOk: ['يُفتح واتساب على {n}', 'WhatsApp opens on {n}', 'واتسئاپ لەسەر {n} دەکرێتەوە'],
  wp_lang: ['لغة الرسالة', 'Message language', 'زمانی نامەکە'],
  wp_message: ['الرسالة', 'Message', 'نامە'],
  wp_how: [
    'يصنع البرنامج ملف PDF في مجلده الخاص ويفتح المجلد والملف محدد، ثم يفتح واتساب والرسالة جاهزة. اسحب الملف إلى المحادثة واضغط «إرسال» بنفسك — لا يُرسل شيء دون ضغطتك.',
    'Qasa makes the PDF in its own folder and opens that folder with the file selected, then opens WhatsApp with the message ready. Drag the file into the chat and press Send yourself — nothing is sent without your click.',
    'قاسە فایلی PDF لە بوخچەی خۆیدا دروست دەکات و بوخچەکە بە فایلە هەڵبژێردراوەکەوە دەکاتەوە، پاشان واتسئاپ بە نامە ئامادەکەوە دەکاتەوە. فایلەکە ڕابکێشە ناو گفتوگۆکە و خۆت «ناردن» دابگرە — هیچ شتێک بێ کلیکی تۆ نانێردرێت.'
  ],
  wp_browserHelp: [
    'في المتصفح: اطبع الوثيقة واختر «حفظ بتنسيق PDF»، ثم افتح واتساب وأرفق الملف. لا يُرسل شيء دون ضغطتك.',
    'In a browser: print the document and choose “Save as PDF”, then open WhatsApp and attach the file. Nothing is sent without your click.',
    'لە وێبگەڕدا: بەڵگەنامەکە چاپ بکە و «پاشەکەوت وەک PDF» هەڵبژێرە، پاشان واتسئاپ بکەرەوە و فایلەکە هاوپێچ بکە. هیچ شتێک بێ کلیکی تۆ نانێردرێت.'
  ],
  wp_makePdf: ['اصنع PDF وافتح واتساب', 'Make the PDF and open WhatsApp', 'PDF دروست بکە و واتسئاپ بکەرەوە'],
  wp_printPdf: ['طباعة / حفظ PDF', 'Print / save as PDF', 'چاپ / پاشەکەوت وەک PDF'],
  wp_openWhatsApp: ['افتح واتساب', 'Open WhatsApp', 'واتسئاپ بکەرەوە'],
  wp_working: ['جارٍ صنع ملف PDF…', 'Making the PDF…', 'فایلی PDF دروست دەکرێت…'],
  wp_saved: [
    'حُفظ {n} وفُتح مجلده. اسحب الملف إلى محادثة واتساب، تأكد منه، ثم اضغط «إرسال».',
    'Saved {n} and opened its folder. Drag the file into the WhatsApp chat, check it, then press Send.',
    '{n} پاشەکەوت کرا و بوخچەکەی کرایەوە. فایلەکە ڕابکێشە ناو گفتوگۆی واتسئاپ، سەیری بکە، پاشان «ناردن» دابگرە.'
  ],
  wp_failed: ['تعذّر صنع ملف PDF. جرّب «طباعة» واختر «حفظ بتنسيق PDF».', 'Couldn’t make the PDF. Try Print and choose “Save as PDF”.', 'فایلی PDF دروست نەکرا. «چاپ» تاقی بکەرەوە و «پاشەکەوت وەک PDF» هەڵبژێرە.'],
  wp_busy: ['ملف PDF آخر قيد الصنع؛ انتظر لحظة ثم أعد المحاولة.', 'Another PDF is being made; wait a moment and try again.', 'فایلێکی PDFی تر دروست دەکرێت؛ کەمێک چاوەڕێ بکە و دووبارە هەوڵ بدەرەوە.'],
  wp_again: ['افتح واتساب مرة أخرى', 'Open WhatsApp again', 'دووبارە واتسئاپ بکەرەوە'],
  wp_close: ['إغلاق', 'Close', 'داخستن'],
  // the messages, in the customer's language
  wp_hello: ['مرحباً {name}،', 'Hello {name},', 'سڵاو {name}،'],
  wp_attached: ['الملف المرفق بصيغة PDF.', 'The PDF is attached.', 'فایلەکە بە شێوەی PDF هاوپێچ کراوە.'],
  wp_receipt: ['وصل البيع {n} بتاريخ {d}', 'Receipt {n} of {d}', 'وەسڵی فرۆشتنی {n} لە {d}'],
  wp_paidBy: ['دُفع: {m}', 'Paid: {m}', 'دراوە: {m}']
} as const;
