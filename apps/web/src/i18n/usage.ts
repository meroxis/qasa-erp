/** The anonymous usage ping and help & support. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const USAGE_TEXT = {
  us_title: ['إحصاءات الاستخدام المجهولة', 'Anonymous usage statistics', 'ئامارى بەکارهێنانی بێناو'],
  us_help: [
    'مرة في اليوم يخبر البرنامج Meroxis بأن هذا التثبيت مستخدم، مع نسخته وخطته وعدد المستخدمين. لا يُرسل أي اسم أو مبلغ أو شيء من دفاترك. هذا يساعدنا على تحسين قاصة ERP.',
    'Once a day the app tells Meroxis that this installation is in use, with its version, plan and number of users. No name, amount or anything from your books is ever sent. It helps us improve Qasa ERP.',
    'ڕۆژانە جارێک ئەپەکە بە Meroxis دەڵێت ئەم دامەزراندنە بەکاردێت، لەگەڵ وەشان و پلان و ژمارەی بەکارهێنەران. هیچ ناو و بڕ و شتێک لە دەفتەرەکانت نانێردرێت. یارمەتیمان دەدات قاسە ERP باشتر بکەین.'
  ],
  us_switch: ['إرسال الإحصاءات المجهولة', 'Send anonymous statistics', 'ناردنی ئاماری بێناو'],
  us_whatSent: ['ما الذي يُرسل بالضبط؟', 'What exactly is sent?', 'بە وردی چی دەنێردرێت؟'],
  us_lastSent: ['آخر إرسال: {d}', 'Last sent: {d}', 'دوایین ناردن: {d}'],
  us_neverSent: ['لم يُرسل بعد', 'Not sent yet', 'هێشتا نەنێردراوە'],
  us_unavailable: ['لا يُرسل شيء في هذه النسخة (التجريبية أو للتطوير).', 'Nothing is sent from this copy (the demo or a development build).', 'لەم وەشانەوە هیچ نانێردرێت (تاقیکردنەوە یان گەشەپێدان).'],
  us_field_install: ['رقم عشوائي لهذا التثبيت (ليس اسمك ولا شركتك)', 'A random number for this installation (not your name or company)', 'ژمارەیەکی هەڕەمەکی بۆ ئەم دامەزراندنە (نە ناوت و نە کۆمپانیاکەت)'],
  us_field_rest: ['نسخة البرنامج، نظام التشغيل، اللغة، الخطة، رقم الترخيص إن كان مفعّلاً، نشاط الشركة، عدد الشركات والمستخدمين، وهل هو أول تشغيل', 'App version, operating system, language, plan, licence number if activated, business type, number of companies and users, and whether it is the first run', 'وەشانی ئەپ، سیستەمی کارپێکردن، زمان، پلان، ژمارەی مۆڵەت ئەگەر چالاک بێت، جۆری چالاکی، ژمارەی کۆمپانیا و بەکارهێنەران، و ئایا یەکەم جارە'],
  us_support: ['الدعم عبر واتساب', 'WhatsApp support', 'پشتگیری لە واتساپ'],
  us_supportShort: ['الدعم', 'Support', 'پشتگیری'],
  us_helpTitle: ['المساعدة والدعم', 'Help & support', 'یارمەتی و پشتگیری'],
  us_helpText: ['راسلنا على واتساب لأي سؤال أو مشكلة — بالعربية أو الكوردية أو الإنكليزية.', 'Message us on WhatsApp for any question or problem — in Arabic, Kurdish or English.', 'بۆ هەر پرسیار یان کێشەیەک لە واتساپ نامەمان بۆ بنێرە — بە کوردی، عەرەبی یان ئینگلیزی.'],
  us_website: ['الموقع', 'Website', 'ماڵپەڕ'],
  us_version: ['النسخة', 'Version', 'وەشان'],
  us_licence: ['الترخيص', 'Licence', 'مۆڵەت'],
  us_waGreeting: ['مرحباً، أحتاج مساعدة في قاصة ERP: ', 'Hello, I need help with Qasa ERP: ', 'سڵاو، یارمەتیم پێویستە لە قاسە ERP: ']
} as const satisfies Record<string, readonly [string, string, string]>;
