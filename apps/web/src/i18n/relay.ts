/** Qasa Relay (Pro): the office network reachable over the internet, with no public IP. Arabic, English and Kurdish (Sorani), like i18n.ts. */
export const RELAY_TEXT = {
  rl_title: ['الوصول عبر الإنترنت (Qasa Relay)', 'Reachable over the internet (Qasa Relay)', 'گەیشتن لە ڕێی ئینتەرنێتەوە (Qasa Relay)'],
  rl_help: ['يعمل الموظفون من البيت أو من فرع آخر على بيانات هذا الحاسوب، دون عنوان IP عام ودون إعداد الراوتر.', 'Staff at home or in another branch work on this PC’s company file, with no public IP and no router setup.', 'کارمەندان لە ماڵەوە یان لە لقێکی ترەوە لەسەر فایلی کۆمپانیای ئەم کۆمپیوتەرە کار دەکەن، بێ IP ی گشتی و بێ ڕێکخستنی ڕاوتەر.'],
  rl_officeId: ['رقم المكتب', 'Office ID', 'ژمارەی نووسینگە'],
  rl_steps: ['على الحاسوب الآخر: من قائمة «ملف» اختر «الاتصال بخادم المكتب…»، واكتب رقم المكتب بدل العنوان، ثم رمز الاقتران.', 'On the other PC: choose File → Connect to an office server…, enter the office ID instead of an address, then the pairing code.', 'لەسەر کۆمپیوتەرەکەی تر: لە لیستی «فایل» «پەیوەندی بە سێرڤەری نووسینگەوە…» هەڵبژێرە، لە جیاتی ناونیشان ژمارەی نووسینگە بنووسە، پاشان کۆدی جووتبوون.'],
  rl_clients: ['متصل عبر الإنترنت الآن: {n}', 'Connected over the internet now: {n}', 'ئێستا لە ڕێی ئینتەرنێتەوە پەیوەستن: {n}'],
  rl_private: ['البيانات مشفّرة من حاسوب إلى حاسوب: خادم Relay ينقلها فقط ولا يستطيع قراءتها. تبقى بيانات الشركة على هذا الحاسوب، ويجب أن يبقى يعمل.', 'Data is encrypted from PC to PC: the relay only passes it on and can’t read it. The company file stays on this PC, which has to stay on.', 'داتا لە کۆمپیوتەرەوە بۆ کۆمپیوتەر شفرە کراوە: Relay تەنها دەیگوازێتەوە و ناتوانێت بیخوێنێتەوە. فایلی کۆمپانیا لەسەر ئەم کۆمپیوتەرە دەمێنێتەوە، کە دەبێت هەڵکراو بمێنێت.'],
  rl_turnOn: ['تفعيل الوصول عبر الإنترنت', 'Switch on internet access', 'هەڵکردنی گەیشتن لە ڕێی ئینتەرنێت'],
  rl_turnOff: ['إيقاف الوصول عبر الإنترنت', 'Switch off internet access', 'کوژاندنەوەی گەیشتن لە ڕێی ئینتەرنێت'],
  rl_state_online: ['متصل', 'Online', 'پەیوەستە'],
  rl_state_connecting: ['يتصل…', 'Connecting…', 'پەیوەندی دەکات…'],
  rl_state_waiting: ['يحاول مجدداً', 'Retrying', 'هەوڵ دەداتەوە'],
  rl_state_refused: ['مرفوض', 'Refused', 'ڕەتکرایەوە'],
  rl_e_unreachable: ['لا يمكن الوصول إلى Qasa Relay. تأكد من اتصال هذا الحاسوب بالإنترنت؛ سيحاول مجدداً تلقائياً.', 'Qasa Relay can’t be reached. Check this PC’s internet connection; it keeps trying by itself.', 'ناگاتە Qasa Relay. پەیوەندی ئینتەرنێتی ئەم کۆمپیوتەرە بپشکنە؛ خۆی هەوڵ دەداتەوە.'],
  rl_e_connection_lost: ['انقطع الاتصال بـ Qasa Relay؛ يعيد الاتصال تلقائياً.', 'The connection to Qasa Relay dropped; it reconnects by itself.', 'پەیوەندی لەگەڵ Qasa Relay پچڕا؛ خۆی دووبارە پەیوەندی دەکاتەوە.'],
  rl_e_licence_invalid: ['Qasa Relay يحتاج ترخيص Pro أو Business مفعّلاً وساري المفعول.', 'Qasa Relay needs an activated Pro or Business licence that hasn’t ended.', 'Qasa Relay پێویستی بە مۆڵەتی Pro یان Business ی چالاک و بەسەرنەچوو هەیە.'],
  rl_e_relay_needs_licence: ['فعّل ترخيص Pro أو Business أولاً (الخطة والترخيص). الفترة التجريبية لا تشمل Qasa Relay.', 'Activate a Pro or Business licence first (Plan & license). The trial doesn’t include Qasa Relay.', 'سەرەتا مۆڵەتی Pro یان Business چالاک بکە (پلان و مۆڵەت). ماوەی تاقیکردنەوە Qasa Relay ناگرێتەوە.'],
  // 1.2: a relay that asks for the activation token (no token sent, or one the portal stopped renewing)
  rl_e_activation_required: ['ترخيص هذا المكتب يحتاج إلى التحقق مع بوابة العملاء قبل أن يخدمه Qasa Relay: افتح «الخطة والترخيص» على هذا الحاسوب وفعّله (يحتاج الإنترنت مرة واحدة).', 'This office’s licence needs to check in with the portal before Qasa Relay can serve it: open Plan & license on this PC and activate it (it needs the internet once).', 'مۆڵەتی ئەم نووسینگەیە پێویستە لەگەڵ پۆرتاڵەکە بپشکنرێت پێش ئەوەی Qasa Relay خزمەتی بکات: لەسەر ئەم کۆمپیوتەرە «پلان و مۆڵەت» بکەرەوە و چالاکی بکە (یەک جار ئینتەرنێتی پێویستە).'],
  rl_e_activation_stale: ['ترخيص هذا المكتب يحتاج إلى التحقق مع بوابة العملاء: صِل هذا الحاسوب بالإنترنت واضغط «تحقق الآن» في «الخطة والترخيص». يعود Qasa Relay بعدها تلقائياً.', 'This office’s licence needs to check in with the portal: connect this PC to the internet and press “Check now” on Plan & license. Qasa Relay is back by itself right after.', 'مۆڵەتی ئەم نووسینگەیە پێویستە لەگەڵ پۆرتاڵەکە بپشکنرێت: ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە و لە «پلان و مۆڵەت» «ئێستا بپشکنە» دابگرە. Qasa Relay دوای ئەوە خۆی دەگەڕێتەوە.'],
  rl_e_office_taken: ['رقم هذا المكتب مستخدم بمفتاح آخر. تواصل مع دعم قاصة ERP.', 'This office ID is held by another key. Contact Qasa ERP support.', 'ئەم ژمارەی نووسینگەیە بە کلیلێکی تر گیراوە. پەیوەندی بە پشتیوانیی قاسە ERP بکە.'],
  rl_e_too_many_offices: ['هذا الترخيص مستخدم على عدد كبير من المكاتب.', 'This licence is already used for too many offices.', 'ئەم مۆڵەتە بۆ ژمارەیەکی زۆر نووسینگە بەکارهاتووە.'],
  // 1.4.2: the licence's activation on this PC is used by another office ID registered first on the same PC
  rl_e_office_replaced: [
    'هذا الحاسوب مسجّل في Qasa Relay برقم مكتب آخر سُجّل قبله بالترخيص نفسه، فأُوقف هذا. إن لم تكن تعرف السبب فتواصل مع دعم قاصة ERP.',
    'This PC’s licence is used on Qasa Relay by another office ID, registered first on the same PC, so this one was stopped. If you don’t know why, contact Qasa ERP support.',
    'مۆڵەتی ئەم کۆمپیوتەرە لە Qasa Relay بە ژمارەیەکی تری نووسینگە بەکاردێت کە پێشتر لەسەر هەمان کۆمپیوتەر تۆمار کراوە، بۆیە ئەمە ڕاگیرا. ئەگەر هۆکارەکەی نازانیت پەیوەندی بە پشتیوانیی قاسە ERP بکە.'
  ],
  // 1.4.2: more clients waited at the relay at once than this PC opens connections for; some were left to try again
  rl_e_too_many_dials: [
    'وصلت طلبات اتصال كثيرة في وقت واحد عبر Qasa Relay، فتُرك بعضها ليعيد المحاولة. إن تكرر ذلك كثيراً فقد يكون أحدٌ يطرق رقم المكتب: أخبر دعم قاصة ERP.',
    'Many connections arrived through Qasa Relay at once, so some were left to try again. If this keeps happening, someone may be knocking on the office ID: tell Qasa ERP support.',
    'پەیوەندیی زۆر بە یەکجار لە ڕێی Qasa Relay گەیشتن، بۆیە هەندێکیان بەجێهێڵران تا دووبارە هەوڵ بدەنەوە. ئەگەر زۆر دووبارە بووەوە لەوانەیە کەسێک لە ژمارەی نووسینگە بدات: بە پشتیوانیی قاسە ERP بڵێ.'
  ],
  rl_e_relay_busy: ['Qasa Relay مشغول الآن؛ يحاول مجدداً بعد قليل.', 'Qasa Relay is busy right now; it tries again shortly.', 'Qasa Relay ئێستا سەرقاڵە؛ کەمێکی تر هەوڵ دەداتەوە.'],
  rl_e_too_many_attempts: ['محاولات كثيرة؛ يحاول مجدداً بعد قليل.', 'Too many attempts; it tries again shortly.', 'هەوڵی زۆر؛ کەمێکی تر هەوڵ دەداتەوە.'],
  // Starter: the office network on the office's own network only
  rl_needsPro: ['خطتك Starter تشغّل شبكة المكتب داخل المكتب فقط. الوصول عبر الإنترنت بـ Qasa Relay يأتي مع Pro وBusiness.', 'Your Starter plan runs the office network inside the office only. Reaching it over the internet with Qasa Relay comes with Pro and Business.', 'پلانەکەت (Starter) تۆڕی نووسینگە تەنها لەناو نووسینگەدا کار پێدەکات. گەیشتن لە ڕێی ئینتەرنێتەوە بە Qasa Relay لەگەڵ Pro و Business دێت.'],
  rl_e_plan_no_relay: ['Qasa Relay يأتي مع Pro وBusiness. خطة Starter تعمل على شبكة المكتب نفسها فقط.', 'Qasa Relay comes with Pro and Business. The Starter plan works on the office’s own network only.', 'Qasa Relay لەگەڵ Pro و Business دێت. پلانی Starter تەنها لەسەر تۆڕی خودی نووسینگە کار دەکات.'],
  err_plan_no_relay: ['Qasa Relay يأتي مع Pro وBusiness. خطة Starter تعمل على شبكة المكتب نفسها فقط — راجع «الخطة والترخيص».', 'Qasa Relay comes with Pro and Business. The Starter plan works on the office’s own network only. See Plan & license.', 'Qasa Relay لەگەڵ Pro و Business دێت. پلانی Starter تەنها لەسەر تۆڕی خودی نووسینگە کار دەکات — «پلان و مۆڵەت» ببینە.'],
  // 1.4.2: a new office certificate (the old key may be in a copy somewhere): every PC pairs again
  netNewCert: ['شهادة مكتب جديدة', 'New office certificate', 'بڕوانامەی نوێی نووسینگە'],
  netNewCertHelp: [
    'إن كان مفتاح هذا الحاسوب قد نُسخ (نسخة قديمة من مجلد البرنامج، حاسوب قديم)، فاصنع شهادة جديدة: يتوقف المفتاح القديم عن العمل، وتتصل الحواسيب الأخرى من جديد برمز الاقتران الجديد. الهواتف لا تتأثر. والموقع الإلكتروني الذي يتصل على شبكة المكتب يحتاج رمز الشهادة الجديد من الإعدادات ← ربط المواقع الإلكترونية (وعبر Qasa Relay لا يتغير شيء).',
    'If this PC’s key may have been copied (an old copy of the app’s folder, an old PC), make a new certificate: the old key stops working, and the other PCs connect again with the new pairing code. Phones are not affected. A website that connects on the office network needs the new certificate code from Settings → Website API (through Qasa Relay nothing changes).',
    'ئەگەر لەوانەیە کلیلی ئەم کۆمپیوتەرە کۆپی کرابێت (کۆپییەکی کۆنی بوخچەی بەرنامەکە، کۆمپیوتەرێکی کۆن)، بڕوانامەیەکی نوێ دروست بکە: کلیلە کۆنەکە لە کار دەکەوێت، و کۆمپیوتەرەکانی تر بە کۆدی پەیوەندیی نوێ دووبارە پەیوەندی دەکەنەوە. مۆبایلەکان کاریگەر نابن. ماڵپەڕێک کە لەسەر تۆڕی نووسینگە پەیوەندی دەکات پێویستی بە کۆدە نوێیەکەی بڕوانامە هەیە لە ڕێکخستنەکان ← بەستنەوەی ماڵپەڕ (لە ڕێی Qasa Relay ەوە هیچ ناگۆڕێت).'
  ],
  netNewCertConfirm: [
    'ستصنع شهادة جديدة لهذا الحاسوب. كل حاسوب متصل به الآن يتوقف، وعلى كل واحد أن يتصل من جديد («ملف» ← «الاتصال بخادم المكتب…») برمز الاقتران الجديد. والموقع الإلكتروني الذي يتصل على شبكة المكتب يحتاج رمز الشهادة الجديد من الإعدادات ← ربط المواقع الإلكترونية (وعبر Qasa Relay لا يتغير شيء). هل تتابع؟',
    'This makes a new certificate for this PC. Every PC connected to it stops, and each must connect again (File → Connect to an office server…) with the new pairing code. A website that connects on the office network needs the new certificate code from Settings → Website API (through Qasa Relay nothing changes). Go on?',
    'بڕوانامەیەکی نوێ بۆ ئەم کۆمپیوتەرە دروست دەکرێت. هەموو کۆمپیوتەرێکی پەیوەستکراو پێیەوە دەوەستێت، و هەریەکەیان دەبێت دووبارە پەیوەندی بکاتەوە («فایل» ← «پەیوەندی بە سێرڤەری نووسینگەوە…») بە کۆدی پەیوەندیی نوێ. ماڵپەڕێک کە لەسەر تۆڕی نووسینگە پەیوەندی دەکات پێویستی بە کۆدە نوێیەکەی بڕوانامە هەیە لە ڕێکخستنەکان ← بەستنەوەی ماڵپەڕ (لە ڕێی Qasa Relay ەوە هیچ ناگۆڕێت). بەردەوام دەبیت؟'
  ],
  netNewCertDone: ['صُنعت شهادة جديدة: اتصل من الحواسيب الأخرى برمز الاقتران الجديد، وضع رمز الشهادة الجديد في الموقع الذي يتصل على شبكة المكتب.', 'A new certificate is made: connect the other PCs with the new pairing code, and put the new certificate code in a website that connects on the office network.', 'بڕوانامەیەکی نوێ دروست کرا: کۆمپیوتەرەکانی تر بە کۆدی پەیوەندیی نوێ پەیوەست بکە، و کۆدە نوێیەکەی بڕوانامە لەو ماڵپەڕە دابنێ کە لەسەر تۆڕی نووسینگە پەیوەندی دەکات.'],
  a_network_certificate_renewed: ['شهادة مكتب جديدة', 'New office certificate', 'بڕوانامەی نوێی نووسینگە'],
  // the office server's own key, when Windows can't keep it protected (it is never saved in the clear)
  err_network_secret_unprotected: [
    'لم يتمكن ويندوز من حماية مفتاح خادم المكتب على هذا الحاسوب، فلم يُحفظ وبقيت شبكة المكتب مطفأة. أعد تشغيل الحاسوب وحاول مجدداً؛ وإن تكرر ذلك فتواصل مع دعم قاصة ERP.',
    'Windows couldn’t protect the office server’s key on this PC, so it wasn’t saved and the office network stays off. Restart the PC and try again; if it keeps happening, contact Qasa ERP support.',
    'ویندۆز نەیتوانی کلیلی سێرڤەری نووسینگە لەسەر ئەم کۆمپیوتەرە بپارێزێت، بۆیە پاشەکەوت نەکرا و تۆڕی نووسینگە کوژاوە دەمێنێتەوە. کۆمپیوتەرەکە دووبارە هەڵبکەرەوە و هەوڵ بدەرەوە؛ ئەگەر هەر دووبارە بووەوە پەیوەندی بە پشتیوانیی قاسە ERP بکە.'
  ],
  err_relay_needs_network: ['شغّل شبكة المكتب أولاً.', 'Switch on the office network first.', 'سەرەتا تۆڕی نووسینگە هەڵبکە.'],
  err_relay_needs_licence: ['فعّل ترخيص Pro أو Business أولاً (الخطة والترخيص). الفترة التجريبية لا تشمل Qasa Relay.', 'Activate a Pro or Business licence first (Plan & license). The trial doesn’t include Qasa Relay.', 'سەرەتا مۆڵەتی Pro یان Business چالاک بکە (پلان و مۆڵەت). ماوەی تاقیکردنەوە Qasa Relay ناگرێتەوە.']
} as const satisfies Record<string, readonly [string, string, string]>;
