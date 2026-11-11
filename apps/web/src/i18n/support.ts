/**
 * Remote support (Settings → About, Help → Remote support… in the Windows app): Windows' Quick Assist and "Copy support
 * details". Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. Windows calls Quick Assist
 * «المساعدة السريعة» in Arabic; it has no Kurdish name, so Kurdish keeps "Quick Assist".
 */
export const SUPPORT_TEXT = {
  rs_title: ['الدعم عن بُعد', 'Remote support', 'پشتگیری لە دوورەوە'],
  rs_cardText: [
    'دع موظف دعم قاصة يرى شاشتك عبر «المساعدة السريعة» في Windows، أو انسخ تفاصيل هذا الحاسوب له.',
    'Let Qasa support see your screen with Windows’ Quick Assist, or copy this PC’s details for them.',
    'با پشتگیریی قاسە بە Quick Assist ی Windows شاشەکەت ببینێت، یان وردەکارییەکانی ئەم کۆمپیوتەرەیان بۆ کۆپی بکە.'
  ],
  rs_open: ['فتح الدعم عن بُعد', 'Open remote support', 'کردنەوەی پشتگیری لە دوورەوە'],
  rs_intro: [
    '«المساعدة السريعة» (Quick Assist) جزء من Windows. بها يستطيع موظف دعم قاصة أن يرى شاشتك أو يتحكم بها ليساعدك.',
    'Quick Assist is part of Windows. With it, a Qasa support person can see your screen, or control it, to help you.',
    'Quick Assist بەشێکە لە Windows. بەهۆیەوە کارمەندێکی پشتگیریی قاسە دەتوانێت شاشەکەت ببینێت یان کۆنترۆڵی بکات، بۆ ئەوەی یارمەتیت بدات.'
  ],
  rs_steps: [
    'يعطيك موظف الدعم رمزاً من 6 أرقام. اكتبه في «المساعدة السريعة» ثم اختر «السماح». لا يرى أحد شاشتك قبل ذلك.',
    'The support person gives you a 6-digit code. Type it in Quick Assist, then choose Allow. Nobody sees your screen before that.',
    'کارمەندی پشتگیری کۆدێکی 6 ژمارەیی پێت دەدات. لە Quick Assist بینووسە، پاشان «ڕێگەدان» هەڵبژێرە. پێش ئەوە کەس شاشەکەت نابینێت.'
  ],
  rs_stop: [
    'يمكنك إيقافه في أي وقت بإغلاق «المساعدة السريعة».',
    'You can stop it at any time by closing Quick Assist.',
    'هەر کاتێک بتەوێت دەتوانیت بە داخستنی Quick Assist ڕایبگریت.'
  ],
  rs_warning: [
    'لا تكتب إلا رمزاً أعطاك إياه دعم قاصة (Meroxis) بعد أن طلبت أنت المساعدة. لا تكتب أبداً رمزاً من شخص غريب اتصل بك، حتى لو قال إنه من قاصة أو Microsoft أو مصرف.',
    'Only type a code that Qasa support (Meroxis) gave you after you asked for help. Never type a code from a stranger who phoned you, even if they say they are from Qasa, Microsoft or a bank.',
    'تەنها کۆدێک بنووسە کە پشتگیریی قاسە (Meroxis) دوای ئەوەی خۆت داوای یارمەتیت کرد پێی داویت. هەرگیز کۆدی کەسێکی نەناسراو مەنووسە کە پەیوەندیی پێوە کردوویت، تەنانەت ئەگەر بڵێت لە قاسە یان Microsoft یان بانکێکەوەیە.'
  ],
  rs_start: ['تشغيل «المساعدة السريعة»', 'Start Quick Assist', 'دەستپێکردنی Quick Assist'],
  rs_store: [
    '«المساعدة السريعة» غير مثبّتة على هذا الحاسوب، ففُتحت صفحتها في Microsoft Store. ثبّتها ثم اضغط «تشغيل المساعدة السريعة» مجدداً.',
    'Quick Assist isn’t installed on this PC, so its Microsoft Store page opened. Install it, then press Start Quick Assist again.',
    'Quick Assist لەسەر ئەم کۆمپیوتەرە دانەمەزراوە، بۆیە پەڕەکەی لە Microsoft Store کرایەوە. دایبمەزرێنە، پاشان دووبارە «دەستپێکردنی Quick Assist» دابگرە.'
  ],
  rs_failed: [
    'تعذّر فتح «المساعدة السريعة». ابحث عنها في قائمة «ابدأ» في Windows.',
    'Quick Assist could not be opened. Look for Quick Assist in the Windows Start menu.',
    'نەتوانرا Quick Assist بکرێتەوە. لە لیستی Start ی Windows بەدوایدا بگەڕێ.'
  ],
  rs_copy: ['نسخ تفاصيل الدعم', 'Copy support details', 'کۆپیکردنی وردەکارییەکانی پشتگیری'],
  rs_copyHelp: [
    'للصقها في واتساب: نسخة البرنامج وخطته ونسخة Windows وآخر الأخطاء، دون كلمات مرور أو مفاتيح أو بيانات شركتك.',
    'To paste into WhatsApp: the app’s version and plan, Windows’ version and the last errors, without passwords, keys or your company’s data.',
    'بۆ لکاندن لە واتساپ: وەشان و پلانی بەرنامەکە، وەشانی Windows و دوایین هەڵەکان، بەبێ وشەی نهێنی، کلیل یان داتای کۆمپانیاکەت.'
  ],
  rs_copied: ['نُسخت تفاصيل الدعم — الصقها في واتساب.', 'Support details copied — paste them into WhatsApp.', 'وردەکارییەکانی پشتگیری کۆپی کران — لە واتساپ بیانلکێنە.'],
  rs_copyFailed: ['تعذّر النسخ. حدّد النص أدناه وانسخه.', 'Couldn’t copy. Select the text below and copy it.', 'کۆپی نەکرا. دەقی خوارەوە دیاری بکە و کۆپی بکە.'],
  rs_browser: [
    'الدعم عن بُعد بـ«المساعدة السريعة» متاح في تطبيق قاصة ERP لـ Windows.',
    'Remote support with Quick Assist is available in the Qasa ERP app for Windows.',
    'پشتگیری لە دوورەوە بە Quick Assist لە بەرنامەی قاسە ERP بۆ Windows بەردەستە.'
  ],
  rs_close: ['إغلاق', 'Close', 'داخستن']
} as const satisfies Record<string, readonly [string, string, string]>;
