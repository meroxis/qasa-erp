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
  rl_e_connection_lost: ['انقطع الاتصال بـ Qasa Relay؛ يعيد الاتصال تلقائياً.', 'The connection to Qasa Relay dropped; it reconnects by itself.', 'پەیوەندی بە Qasa Relay ـەوە پچڕا؛ خۆی دووبارە پەیوەندی دەکاتەوە.'],
  rl_e_licence_invalid: ['Qasa Relay يحتاج ترخيص Pro أو Business مفعّلاً وساري المفعول.', 'Qasa Relay needs an activated Pro or Business licence that hasn’t ended.', 'Qasa Relay پێویستی بە مۆڵەتی Pro یان Business ی چالاک و بەسەرنەچوو هەیە.'],
  rl_e_relay_needs_licence: ['فعّل ترخيص Pro أو Business أولاً (الخطة والترخيص). الفترة التجريبية لا تشمل Qasa Relay.', 'Activate a Pro or Business licence first (Plan & license). The trial doesn’t include Qasa Relay.', 'سەرەتا مۆڵەتی Pro یان Business چالاک بکە (پلان و مۆڵەت). ماوەی تاقیکردنەوە Qasa Relay ناگرێتەوە.'],
  rl_e_office_taken: ['رقم هذا المكتب مستخدم بمفتاح آخر. تواصل مع دعم قاصة ERP.', 'This office ID is held by another key. Contact Qasa ERP support.', 'ئەم ژمارەی نووسینگەیە بە کلیلێکی تر گیراوە. پەیوەندی بە پشتگیری قاسە ERP بکە.'],
  rl_e_too_many_offices: ['هذا الترخيص مستخدم على عدد كبير من المكاتب.', 'This licence is already used for too many offices.', 'ئەم مۆڵەتە بۆ ژمارەیەکی زۆر نووسینگە بەکارهاتووە.'],
  rl_e_too_many_attempts: ['محاولات كثيرة؛ يحاول مجدداً بعد قليل.', 'Too many attempts; it tries again shortly.', 'هەوڵی زۆر؛ کەمێکی تر هەوڵ دەداتەوە.'],
  err_relay_needs_network: ['شغّل شبكة المكتب أولاً.', 'Switch on the office network first.', 'سەرەتا تۆڕی نووسینگە هەڵبکە.'],
  err_relay_needs_licence: ['فعّل ترخيص Pro أو Business أولاً (الخطة والترخيص). الفترة التجريبية لا تشمل Qasa Relay.', 'Activate a Pro or Business licence first (Plan & license). The trial doesn’t include Qasa Relay.', 'سەرەتا مۆڵەتی Pro یان Business چالاک بکە (پلان و مۆڵەت). ماوەی تاقیکردنەوە Qasa Relay ناگرێتەوە.']
} as const satisfies Record<string, readonly [string, string, string]>;
