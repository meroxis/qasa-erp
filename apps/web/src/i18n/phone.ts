/** The Qasa phone app (Pro): pairing phones with this PC, in Settings → Office network → Phones. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const PHONE_TEXT = {
  ph_title: ['الهواتف (تطبيق قاصة)', 'Phones (Qasa app)', 'مۆبایلەکان (ئەپی قاسە)'],
  ph_help: [
    'امسح الباركود بكاميرا الهاتف، واعرف السعر والمخزون، وأضف مادة بصورتها، واجرد المخزن، وأرسل بيعاً نقداً أو آجلاً كمسودة أو طلبية، واقبض من الزبائن — من تطبيق قاصة على الهاتف، كلٌّ بصلاحيات المستخدم الذي يعمل الهاتف باسمه. ومع تطبيق الهاتف 1.1: الموافقة على السندات، وسعر الدولار، وإغلاق اليوم، والمصاريف مع صورة الوصل، والفواتير وكشوف الحساب بصيغة PDF، ونقل البضاعة واستلامها. الاتصال مشفّر من الهاتف إلى هذا الحاسوب.',
    'Scan barcodes with the phone camera, check prices and stock, add an item with its photo, count stock, send a sale (cash or on credit) as a draft or an order, and take money from customers — from the Qasa app on the phone, each with the permissions of the user the phone works as. With the phone app 1.1: approving vouchers, the dollar rate, the end of day, expenses with a photo of the receipt, invoices and statements as PDF, and moving and receiving stock. The link is encrypted from the phone to this PC.',
    'بارکۆد بە کامێرای مۆبایل بخوێنەوە، نرخ و بڕی کۆگا ببینە، کاڵا بە وێنەکەیەوە زیاد بکە، جەردی کۆگا بکە، فرۆشتن (نەقد یان قەرز) وەک ڕەشنووس یان داواکاری بنێرە، و پارە لە کڕیاران وەربگرە — لە ئەپی قاسە لەسەر مۆبایل، هەر یەکەیان بە دەسەڵاتی ئەو بەکارهێنەرەی مۆبایلەکە بە ناوییەوە کار دەکات. لەگەڵ ئەپی مۆبایل 1.1: پەسەندکردنی سەنەدەکان، نرخی دۆلار، داخستنی ڕۆژ، خەرجی لەگەڵ وێنەی وەسڵ، پسوولە و کەشفی هەژمار وەک PDF، و گواستنەوە و وەرگرتنی کاڵا. پەیوەندییەکە لە مۆبایلەوە تا ئەم کۆمپیوتەرە شفرەکراوە.'
  ],
  ph_needsPro: ['تطبيق الهاتف من مزايا Starter وPro وBusiness.', 'The phone app is part of Starter, Pro and Business.', 'ئەپی مۆبایل بەشێکە لە Starter، Pro و Business.'],
  // shown only when PHONE_APP_READY is false (1.0 to 1.4.1 shipped without the phone app)
  ph_soonNote: [
    'تطبيق قاصة للهاتف قادم قريباً. عند صدوره يمكنك ربط الهواتف بهذا الحاسوب من هنا.',
    'The Qasa phone app is coming soon. Once it is out, you can pair phones with this PC here.',
    'ئەپی قاسە بۆ مۆبایل بەم زووانە دێت. کاتێک بڵاوکرایەوە، لێرەوە دەتوانیت مۆبایل بەم کۆمپیوتەرەوە ببەستیتەوە.'
  ],
  ph_add: ['إضافة هاتف', 'Add a phone', 'زیادکردنی مۆبایل'],
  ph_phone: ['الهاتف', 'Phone', 'مۆبایل'],
  ph_actsAs: ['يعمل باسم', 'Works as', 'کار دەکات بە ناوی'],
  ph_owner: ['المالك', 'The owner', 'خاوەن'],
  ph_lastSeen: ['آخر اتصال', 'Last seen', 'دوایین پەیوەندی'],
  // 1.4.3: the phone app says its version when it connects (app 1.0.2 on); an older app says none
  ph_appVersion: ['إصدار التطبيق', 'App version', 'وەشانی ئەپ'],
  ph_versionOld: ['1.0.1 أو أقدم', '1.0.1 or older', '1.0.1 یان کۆنتر'],
  ph_newer: ['يوجد إصدار أحدث على qasaerp.com/phone.', 'A newer version is on qasaerp.com/phone.', 'وەشانێکی نوێتر لە qasaerp.com/phone هەیە.'],
  ph_online: ['متصل', 'Online', 'پەیوەستە'],
  ph_remove: ['حذف', 'Remove', 'لابردن'],
  ph_removed: ['حُذف الهاتف؛ لم يعد يستطيع الاتصال.', 'The phone was removed; it can no longer connect.', 'مۆبایلەکە لابرا؛ چیتر ناتوانێت پەیوەندی بکات.'],
  ph_qrLabel: ['رمز ربط الهاتف', 'Phone pairing code', 'کۆدی بەستنەوەی مۆبایل'],
  ph_scanThis: ['امسح هذا الرمز من تطبيق قاصة على الهاتف', 'Scan this code from the Qasa app on the phone', 'ئەم کۆدە لە ئەپی قاسە لەسەر مۆبایل بخوێنەوە'],
  ph_step1: ['ثبّت «قاصة ERP» على الهاتف من qasaerp.com/phone.', 'Install "Qasa ERP" on the phone from qasaerp.com/phone.', '«قاسە ERP» لە qasaerp.com/phone لەسەر مۆبایل دابمەزرێنە.'],
  ph_step2: ['افتحه واختر «امسح رمز الربط».', 'Open it and choose "Scan the pairing code".', 'بیکەرەوە و «کۆدی بەستنەوە بخوێنەوە» هەڵبژێرە.'],
  // 1.4.2: the Android app is downloaded from qasaerp.com (an APK; Google Play later)
  ph_getApp: ['احصل على تطبيق الهاتف (Android)', 'Get the phone app (Android)', 'ئەپی مۆبایل وەربگرە (Android)'],
  ph_getQrLabel: ['رمز صفحة تنزيل تطبيق الهاتف', 'Code for the phone app download page', 'کۆدی پەڕەی داگرتنی ئەپی مۆبایل'],
  ph_get1: [
    'على الهاتف، امسح هذا الرمز أو افتح الرابط، ونزّل التطبيق.',
    'On the phone, scan this code or open the link, and download the app.',
    'لەسەر مۆبایل، ئەم کۆدە بخوێنەوە یان بەستەرەکە بکەرەوە، و ئەپەکە دابگرە.'
  ],
  ph_get2: [
    'افتح الملف المنزَّل. إذا طلب Android ذلك، اسمح بـ«تثبيت التطبيقات غير المعروفة» للمتصفح أو لتطبيق الملفات، ثم «تثبيت».',
    'Open the downloaded file. If Android asks, allow "Install unknown apps" for the browser or Files, then Install.',
    'فایلە داگیراوەکە بکەرەوە. ئەگەر Android پرسیاری کرد، ڕێگە بدە بە «دامەزراندنی ئەپە نەناسراوەکان» (Install unknown apps) بۆ وێبگەڕ یان Files، پاشان «دامەزراندن».'
  ],
  ph_get3: ['افتح «قاصة ERP» على الهاتف.', 'Open "Qasa ERP" on the phone.', '«قاسە ERP» لەسەر مۆبایل بکەرەوە.'],
  ph_get4: [
    'هنا على هذا الحاسوب اضغط «إضافة هاتف» لربطه.',
    'Here on this PC, choose "Add a phone" to pair it.',
    'لێرە لەسەر ئەم کۆمپیوتەرە «زیادکردنی مۆبایل» هەڵبژێرە بۆ بەستنەوەی.'
  ],
  ph_check: ['للتحقق من الملف المنزَّل', 'To check the downloaded file', 'بۆ پشکنینی فایلە داگیراوەکە'],
  ph_checkHelp: [
    'يجب أن يطابق ملف التطبيق هذه البصمات تماماً. إن لم يطابق فلا تثبّته.',
    'The app file must match these fingerprints exactly. If it does not, do not install it.',
    'فایلی ئەپەکە دەبێت ڕێک وەک ئەم پەنجەمۆرانە بێت. ئەگەر وانەبوو، دایمەمەزرێنە.'
  ],
  ph_apkSha: ['SHA-256 لملف التطبيق (APK):', 'SHA-256 of the app file (APK):', 'SHA-256ی فایلی ئەپەکە (APK):'],
  ph_certSha: ['بصمة شهادة التوقيع (SHA-256، Meroxis):', 'Signing certificate fingerprint (SHA-256, Meroxis):', 'پەنجەمۆری بڕوانامەی واژۆ (SHA-256، Meroxis):'],
  ph_step3: ['وجّه الكاميرا إلى هذا الرمز.', 'Point the camera at this code.', 'کامێراکە ئاراستەی ئەم کۆدە بکە.'],
  ph_expires: ['يعمل الرمز مرة واحدة حتى الساعة {time}.', 'The code works once, until {time}.', 'کۆدەکە یەک جار کار دەکات، تا کاتژمێر {time}.'],
  ph_sameNetwork: [
    'يجب أن يكون الهاتف على شبكة Wi-Fi نفسها التي عليها هذا الحاسوب. قد يسأل ويندوز عن السماح لقاصة على الشبكة: اختر «السماح».',
    'The phone must be on the same Wi-Fi as this PC. Windows may ask to allow Qasa on the network: choose Allow.',
    'مۆبایلەکە دەبێت لەسەر هەمان Wi-Fi بێت کە ئەم کۆمپیوتەرەی لەسەرە. لەوانەیە ویندۆز بپرسێت ڕێگە بە قاسە بدات لەسەر تۆڕ: «ڕێگەدان» هەڵبژێرە.'
  ],
  ph_paired: ['رُبط الهاتف.', 'The phone is paired.', 'مۆبایلەکە بەسترایەوە.'],
  ph_counts: ['جرد من الهواتف', 'Stock counts from phones', 'جەردی کۆگا لە مۆبایلەکانەوە'],
  ph_lines: ['{n} مادة', '{n} items', '{n} کاڵا'],
  ph_download: ['تنزيل (Excel)', 'Download (Excel)', 'داگرتن (Excel)'],
  err_phone_limit: [
    'وصلت إلى عدد الهواتف المسموح به في خطتك (3 في Starter وPro). احذف هاتفاً، أو انتقل إلى Business لعدد غير محدود.',
    'You have reached the phones your plan allows (3 on Starter and Pro). Remove one, or move to Business for unlimited phones.',
    'گەیشتیتە ژمارەی ئەو مۆبایلانەی پلانەکەت ڕێگەی پێدەدات (3 لە Starter و Pro). یەکێک لاببە، یان بڕۆ بۆ Business بۆ ژمارەی بێسنوور.'
  ],
  err_phone_user_required: ['اختر المستخدم الذي يعمل الهاتف باسمه.', 'Choose the user the phone works as.', 'ئەو بەکارهێنەرە هەڵبژێرە کە مۆبایلەکە بە ناوییەوە کار دەکات.'],
  err_phone_port_busy: [
    'منفذ ربط الهواتف مستخدم من برنامج آخر على هذا الحاسوب.',
    'The phone link port is used by another program on this PC.',
    'بەرنامەیەکی تر لەسەر ئەم کۆمپیوتەرە پۆرتی بەستنەوەی مۆبایل بەکاردەهێنێت.'
  ],
  err_plan_limit_phoneApp: ['تطبيق الهاتف من مزايا Starter وPro وBusiness — راجع «الخطة والترخيص».', 'The phone app is part of Starter, Pro and Business. See Plan & license.', 'ئەپی مۆبایل بەشێکە لە Starter، Pro و Business — «پلان و مۆڵەت» ببینە.'],
  a_phone_pair_start: ['بدء ربط هاتف', 'Phone pairing started', 'دەستپێکردنی بەستنەوەی مۆبایل'],
  a_phone_paired: ['ربط هاتف', 'Phone paired', 'مۆبایل بەسترایەوە'],
  a_phone_remove: ['حذف هاتف', 'Phone removed', 'مۆبایل لابرا'],
  a_phone_count: ['جرد من هاتف', 'Count from a phone', 'جەرد لە مۆبایلەوە'],
  // phone app 1.1: every change a phone makes has a line of its own in the audit log (which phone, as whom, what)
  a_phone_change: ['تغيير من هاتف', 'Change from a phone', 'گۆڕانکاری لە مۆبایلەوە'],
  e_phone: ['هاتف', 'Phone', 'مۆبایل']
} as const satisfies Record<string, readonly [string, string, string]>;
