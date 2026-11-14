/** The Qasa phone app (Pro): pairing phones with this PC, in Settings → Phones. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const PHONE_TEXT = {
  ph_title: ['الهواتف (تطبيق قاصة)', 'Phones (Qasa app)', 'مۆبایلەکان (ئەپی قاسە)'],
  ph_help: [
    'امسح الباركود بكاميرا الهاتف، واعرف السعر والمخزون، وأضف مادة بصورتها، واجرد المخزن، وأرسل بيعاً كمسودة — من تطبيق قاصة على الهاتف. الاتصال مشفّر من الهاتف إلى هذا الحاسوب.',
    'Scan barcodes with the phone camera, check prices and stock, add an item with its photo, count stock and send a sale as a draft — from the Qasa app on the phone. The link is encrypted from the phone to this PC.',
    'بارکۆد بە کامێرای مۆبایل بخوێنەوە، نرخ و بڕی کۆگا ببینە، کاڵا بە وێنەکەیەوە زیاد بکە، جەردی کۆگا بکە و فرۆشتن وەک ڕەشنووس بنێرە — لە ئەپی قاسە لەسەر مۆبایل. پەیوەندییەکە لە مۆبایلەوە تا ئەم کۆمپیوتەرە شفرەکراوە.'
  ],
  ph_needsPro: ['تطبيق الهاتف من مزايا Starter وPro وBusiness.', 'The phone app is part of Starter, Pro and Business.', 'ئەپی مۆبایل بەشێکە لە Starter، Pro و Business.'],
  // 1.0 ships without the phone app: Settings → Phones says it is coming instead of the pairing steps
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
  ph_online: ['متصل', 'Online', 'پەیوەستە'],
  ph_remove: ['حذف', 'Remove', 'لابردن'],
  ph_removed: ['حُذف الهاتف؛ لم يعد يستطيع الاتصال.', 'The phone was removed; it can no longer connect.', 'مۆبایلەکە لابرا؛ چیتر ناتوانێت پەیوەندی بکات.'],
  ph_qrLabel: ['رمز ربط الهاتف', 'Phone pairing code', 'کۆدی بەستنەوەی مۆبایل'],
  ph_scanThis: ['امسح هذا الرمز من تطبيق قاصة على الهاتف', 'Scan this code from the Qasa app on the phone', 'ئەم کۆدە لە ئەپی قاسە لەسەر مۆبایل بخوێنەوە'],
  ph_step1: ['ثبّت «قاصة ERP» من Google Play على الهاتف.', 'Install "Qasa ERP" from Google Play on the phone.', '«قاسە ERP» لە Google Play لەسەر مۆبایل دابمەزرێنە.'],
  ph_step2: ['افتحه واختر «ربط بالحاسوب».', 'Open it and choose "Pair with a PC".', 'بیکەرەوە و «بەستنەوە بە کۆمپیوتەر» هەڵبژێرە.'],
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
  err_plan_limit_phoneApp: ['تطبيق الهاتف من مزايا Pro — راجع «الخطة والترخيص».', 'The phone app is part of Pro. See Plan & license.', 'ئەپی مۆبایل بەشێکە لە Pro — «پلان و مۆڵەت» ببینە.'],
  a_phone_pair_start: ['بدء ربط هاتف', 'Phone pairing started', 'دەستپێکردنی بەستنەوەی مۆبایل'],
  a_phone_paired: ['ربط هاتف', 'Phone paired', 'مۆبایل بەسترایەوە'],
  a_phone_remove: ['حذف هاتف', 'Phone removed', 'مۆبایل لابرا'],
  a_phone_count: ['جرد من هاتف', 'Count from a phone', 'جەرد لە مۆبایلەوە']
} as const satisfies Record<string, readonly [string, string, string]>;
