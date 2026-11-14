/** Cloud backup (Pro): Google Drive and OneDrive, connected with one click. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const CLOUD_TEXT = {
  cl_title: ['النسخ إلى السحابة', 'Cloud backup', 'باکئەپ بۆ هەور'],
  cl_help: [
    'تُرفع كل نسخة يومية مشفّرة تلقائياً إلى حسابك السحابي. اضغط «ربط» وسجّل الدخول في المتصفح، فقط.',
    'Each daily copy, encrypted, goes up to your cloud account by itself. Click Connect and sign in in your browser — that’s all.',
    'هەموو کۆپییەکی ڕۆژانە، بە شفرەکراوی، خۆکارانە بۆ هەژماری هەورەکەت بەرز دەکرێتەوە. کلیک لە «پەیوەستکردن» بکە و لە وێبگەڕەکەت بچۆ ژوورەوە — تەواو.'
  ],
  // Starter (and Free): the automatic copies stay in their folder
  cl_needsPro: ['النسخ إلى السحابة يأتي مع Pro وBusiness.', 'Cloud backup comes with Pro and Business.', 'باکئەپ بۆ هەور لەگەڵ Pro و Business دێت.'],
  cl_google: ['Google Drive', 'Google Drive', 'Google Drive'],
  cl_onedrive: ['OneDrive', 'OneDrive', 'OneDrive'],
  cl_connect: ['ربط {p}', 'Connect {p}', 'پەیوەستکردنی {p}'],
  // a service this build has no sign-in for yet (OneDrive for now): shown as coming, never as a dead button or an error
  cl_soon: ['{p}: قريباً', '{p}: coming soon', '{p}: بەم زووانە'],
  cl_needsPassword: [
    'عيّن كلمة مرور للنسخ الاحتياطية أعلاه أولاً: لا يُرفع إلى السحابة إلا نسخ مشفّرة لا يقرؤها أحد غيرك.',
    'Set a backup password above first: only encrypted copies go to the cloud, so nobody but you can read them.',
    'سەرەتا لە سەرەوە وشەی نهێنی بۆ باکئەپەکان دابنێ: تەنها کۆپیی شفرەکراو دەچێتە هەور، کەس جگە لە تۆ ناتوانێت بیخوێنێتەوە.'
  ],
  cl_waiting: [
    'أكمِل تسجيل الدخول في المتصفح الذي فُتح، ثم ارجع إلى هنا.',
    'Finish signing in in the browser that opened, then come back here.',
    'چوونەژوورەوە لەو وێبگەڕەی کرایەوە تەواو بکە، پاشان بگەڕێوە ئێرە.'
  ],
  cl_openAgain: ['افتح صفحة الدخول مرة أخرى', 'Open the sign-in page again', 'پەڕەی چوونەژوورەوە دووبارە بکەرەوە'],
  cl_connectedTo: ['مربوط بـ {p}', 'Connected to {p}', 'پەیوەستە بە {p}'],
  cl_account: ['الحساب: {a}', 'Account: {a}', 'هەژمار: {a}'],
  cl_last: ['آخر رفع: {when} ({size})', 'Last upload: {when} ({size})', 'دوایین بەرزکردنەوە: {when} ({size})'],
  cl_none: ['لم تُرفع أي نسخة بعد.', 'Nothing uploaded yet.', 'هێشتا هیچ شتێک بەرز نەکراوەتەوە.'],
  cl_uploading: ['جارٍ الرفع…', 'Uploading…', 'بەرز دەکرێتەوە…'],
  cl_uploadNow: ['ارفع الآن', 'Upload now', 'ئێستا بەرزی بکەرەوە'],
  cl_uploaded: ['رُفعت النسخة.', 'Copy uploaded.', 'کۆپییەکە بەرز کرایەوە.'],
  cl_restoreFrom: ['استرجاع من السحابة', 'Restore from the cloud', 'گەڕاندنەوە لە هەورەوە'],
  cl_cloudCopies: ['النسخ في {p}', 'Copies in {p}', 'کۆپییەکان لە {p}'],
  cl_noCopies: ['لا توجد نسخ في السحابة.', 'No copies in the cloud.', 'هیچ کۆپییەک لە هەور نییە.'],
  // a copy in the folder or the cloud made by another company or on another PC (a new PC owns none yet)
  bkForeign: ['من شركة أو حاسوب آخر', 'From another company or PC', 'لە کۆمپانیایەک یان کۆمپیوتەرێکی ترەوە'],
  bkRestoreForeignQ: [
    'النسخة {when} صُنعت في شركة أخرى أو على حاسوب آخر. استرجاعها يضع بياناتها مكان بيانات هذه الشركة على هذا الحاسوب، ويُحفظ الملف الحالي جانباً في مجلد البيانات (لا يُحذف)، ثم يُعاد تشغيل قاصة ERP. تأكد أنها الشركة التي تريدها. هل تتابع؟',
    'The copy from {when} was made by another company or on another PC. Restoring it puts its data in place of this company’s data on this PC; the current file is kept aside in the data folder (not deleted), and Qasa ERP restarts. Make sure it is the company you want. Go on?',
    'کۆپییەکەی {when} لە کۆمپانیایەکی تر یان لەسەر کۆمپیوتەرێکی تر دروست کراوە. گەڕاندنەوەی، داتاکانی دەخاتە جێگەی داتای ئەم کۆمپانیایە لەسەر ئەم کۆمپیوتەرە؛ فایلی ئێستا لە بوخچەی داتادا لاوە دادەنرێت (ناسڕدرێتەوە)، و قاسە ERP دەست پێدەکاتەوە. دڵنیابە کە ئەوە ئەو کۆمپانیایەیە کە دەتەوێت. بەردەوام دەبیت؟'
  ],
  cl_disconnect: ['إلغاء الربط', 'Disconnect', 'پچڕاندنی پەیوەندی'],
  cl_disconnectQ: [
    'إلغاء الربط؟ تبقى النسخ الموجودة في السحابة، لكن لن تُرفع نسخ جديدة.',
    'Disconnect? The copies already in the cloud stay there, but no new ones go up.',
    'پەیوەندی بپچڕێنرێت؟ ئەو کۆپییانەی لە هەورن دەمێننەوە، بەڵام کۆپیی نوێ بەرز ناکرێتەوە.'
  ],
  cl_failed: ['تعذّر الرفع: {e}', 'Upload failed: {e}', 'بەرزکردنەوە سەرنەکەوت: {e}'],
  cl_where_google: [
    'تجدها في Google Drive داخل مجلد «Qasa ERP backups». لا يرى البرنامج إلا الملفات التي أنشأها هو، ولا يرى أي ملف آخر في حسابك.',
    'You’ll find them in Google Drive in the “Qasa ERP backups” folder. The app only sees the files it made itself, never any other file in your account.',
    'لە Google Drive لە بوخچەی «Qasa ERP backups» دەیاندۆزیتەوە. بەرنامەکە تەنها ئەو فایلانە دەبینێت کە خۆی دروستی کردوون، هیچ فایلێکی تری هەژمارەکەت نابینێت.'
  ],
  cl_where_onedrive: [
    'تجدها في OneDrive داخل «Apps/Qasa ERP». لا يرى البرنامج أي ملف آخر في حسابك.',
    'You’ll find them in OneDrive under “Apps/Qasa ERP”. The app can’t see any other file in your account.',
    'لە OneDrive لە «Apps/Qasa ERP» دەیاندۆزیتەوە. بەرنامەکە هیچ فایلێکی تری هەژمارەکەت نابینێت.'
  ],
  err_cloud_needs_password: [
    'عيّن كلمة مرور للنسخ الاحتياطية أولاً.',
    'Set a backup password first.',
    'سەرەتا وشەی نهێنی بۆ باکئەپەکان دابنێ.'
  ],
  err_cloud_not_configured: ['هذه الخدمة قادمة قريباً، وهي غير متاحة بعد.', 'That service is coming soon; it isn’t available yet.', 'ئەم خزمەتگوزارییە بەم زووانە دێت؛ هێشتا بەردەست نییە.'],
  err_cloud_not_connected: ['لا توجد سحابة مربوطة.', 'No cloud is connected.', 'هیچ هەورێک پەیوەست نەکراوە.'],
  err_cloud_signed_out: [
    'انتهى الوصول إلى الحساب السحابي. اربطه مرة أخرى.',
    'Access to the cloud account has ended. Connect it again.',
    'دەستگەیشتن بە هەژماری هەور کۆتایی هات. دووبارە پەیوەستی بکەرەوە.'
  ],
  err_cloud_offline: ['لا يوجد اتصال بالإنترنت. سيُحاوَل مرة أخرى لاحقاً.', 'No internet connection. It will try again later.', 'پەیوەندیی ئینتەرنێت نییە. دواتر دووبارە هەوڵ دەدرێتەوە.'],
  err_cloud_full: ['المساحة في الحساب السحابي ممتلئة.', 'The cloud account is full.', 'شوێنی هەژماری هەور پڕ بووە.'],
  err_cloud_refused: ['لم يُسمح بالوصول في صفحة تسجيل الدخول.', 'Access wasn’t allowed on the sign-in page.', 'لە پەڕەی چوونەژوورەوە ڕێگە نەدرا.'],
  err_cloud_timeout: ['انتهى وقت تسجيل الدخول. حاول مرة أخرى.', 'Signing in took too long. Please try again.', 'چوونەژوورەوە زۆری خایاند. تکایە دووبارە هەوڵ بدەوە.'],
  err_cloud_token_failed: ['لم يكتمل الربط. حاول مرة أخرى.', 'Connecting didn’t finish. Please try again.', 'پەیوەستکردن تەواو نەبوو. تکایە دووبارە هەوڵ بدەوە.'],
  err_cloud_no_refresh: [
    'لم يمنح الحساب وصولاً دائماً. ألغِ وصول Qasa ERP من إعدادات حسابك واربطه مرة أخرى.',
    'The account didn’t grant lasting access. Remove Qasa ERP’s access in your account settings and connect again.',
    'هەژمارەکە دەستگەیشتنی بەردەوامی نەدا. دەستگەیشتنی Qasa ERP لە ڕێکخستنەکانی هەژمارەکەت لابە و دووبارە پەیوەستی بکەرەوە.'
  ],
  err_cloud_upload_failed: ['تعذّر رفع النسخة.', 'The copy couldn’t be uploaded.', 'کۆپییەکە بەرز نەکرایەوە.'],
  err_cloud_download_failed: ['تعذّر تنزيل النسخة.', 'The copy couldn’t be downloaded.', 'کۆپییەکە دانەبەزێنرا.'],
  err_cloud_request_failed: ['لم تستجب الخدمة السحابية. حاول لاحقاً.', 'The cloud service didn’t answer. Try again later.', 'خزمەتگوزاریی هەور وەڵامی نەدایەوە. دواتر هەوڵ بدەوە.'],
  err_cloud_failed: ['حدث خطأ في النسخ إلى السحابة.', 'Something went wrong with the cloud backup.', 'هەڵەیەک لە باکئەپی هەوردا ڕوویدا.']
} as const satisfies Record<string, readonly [string, string, string]>;
