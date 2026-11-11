/** Menu and dialog texts in Arabic, English and Kurdish (Sorani). The app's pages have their own texts. */
export type Lang = 'ar' | 'en' | 'ku';

const T = {
  file: ['ملف', 'File', 'فایل'],
  openData: ['فتح مجلد البيانات', 'Open data folder', 'کردنەوەی بوخچەی داتا'],
  // File → Reset admin password (recover.html, windows-confirm.ts)
  resetAdmin: ['إعادة تعيين كلمة مرور المدير…', 'Reset admin password…', 'ڕێکخستنەوەی وشەی نهێنیی بەڕێوەبەر…'],
  helloMessage: ['تأكيد إعادة تعيين كلمة مرور المدير «{u}» في قاصة ERP', 'Confirm resetting the password of admin “{u}” in Qasa ERP', 'دڵنیابوونەوە لە ڕێکخستنەوەی وشەی نهێنیی بەڕێوەبەر «{u}» لە قاسە ERP'],
  quit: ['خروج', 'Quit', 'دەرچوون'],
  view: ['عرض', 'View', 'پیشاندان'],
  reload: ['إعادة تحميل', 'Reload', 'نوێکردنەوە'],
  zoomIn: ['تكبير', 'Zoom in', 'گەورەکردن'],
  zoomOut: ['تصغير', 'Zoom out', 'بچووککردنەوە'],
  zoomReset: ['الحجم الأصلي', 'Actual size', 'قەبارەی ئاسایی'],
  fullScreen: ['ملء الشاشة', 'Full screen', 'پڕ بە شاشە'],
  help: ['مساعدة', 'Help', 'یارمەتی'],
  guide: ['دليل الاستخدام', 'User guide', 'ڕێنمایی بەکارهێنان'],
  checkUpdates: ['التحقق من التحديثات', 'Check for updates', 'پشکنینی نوێکردنەوە'],
  website: ['موقع qasaerp.com', 'qasaerp.com website', 'ماڵپەڕی qasaerp.com'],
  about: ['حول قاصة ERP', 'About Qasa ERP', 'دەربارەی قاسە ERP'],
  aboutText: ['قاصة ERP {v}\nمنتج من Meroxis\nhttps://qasaerp.com', 'Qasa ERP {v}\nA product of Meroxis\nhttps://qasaerp.com', 'قاسە ERP {v}\nبەرهەمێکی Meroxis ـە\nhttps://qasaerp.com'],
  ok: ['حسناً', 'OK', 'باشە'],
  updateReadyTitle: ['تحديث جاهز', 'Update ready', 'نوێکردنەوە ئامادەیە'],
  updateReady: ['الإصدار {v} من قاصة ERP جاهز. أعد التشغيل الآن لتثبيته؟ بياناتك محفوظة.', 'Qasa ERP {v} is ready. Restart now to install it? Your data is kept.', 'وەشانی {v}ی قاسە ERP ئامادەیە. ئێستا دەستپێبکەرەوە بۆ دامەزراندنی؟ داتاکانت دەپارێزرێن.'],
  restartNow: ['أعد التشغيل الآن', 'Restart now', 'ئێستا دەستپێبکەرەوە'],
  later: ['لاحقاً', 'Later', 'دواتر'],
  upToDate: ['لديك أحدث إصدار ({v}).', 'You have the latest version ({v}).', 'نوێترین وەشانت هەیە ({v}).'],
  downloading: ['يوجد إصدار جديد ({v})، يجري تنزيله وسننبّهك عند جاهزيته.', 'A new version ({v}) is downloading. We’ll let you know when it’s ready.', 'وەشانێکی نوێ ({v}) دادەبەزێت. کاتێک ئامادە بوو ئاگادارت دەکەینەوە.'],
  updateWaiting: ['الإصدار {v} جاهز للتثبيت. اختر «أعد التشغيل للتحديث» في الشريط أعلى النافذة، أو سيُثبَّت عند إغلاق البرنامج.', 'Qasa ERP {v} is ready to install. Click “Restart to update” in the bar at the top of the window, or it installs when you close the app.', 'وەشانی {v} ئامادەیە بۆ دامەزراندن. لە شریتی سەرەوەی پەنجەرەکە «دووبارە بیکەرەوە بۆ نوێکردنەوە» هەڵبژێرە، یان کاتێک بەرنامەکە دادەخەیت دادەمەزرێت.'],
  updateError: ['تعذر التحقق من التحديثات. تحقق من الاتصال بالإنترنت وحاول لاحقاً.', 'Couldn’t check for updates. Check the internet connection and try again later.', 'نەتوانرا نوێکردنەوە بپشکنرێت. پەیوەندیی ئینتەرنێت بپشکنە و دواتر هەوڵ بدەرەوە.'],
  startFailed: ['تعذر تشغيل قاصة ERP', 'Qasa ERP couldn’t start', 'قاسە ERP نەتوانرا دەستپێبکات'],
  // books a newer version has already upgraded (the Store version can be a release behind the installer)
  newerBooks: ['هذه الدفاتر من إصدار أحدث لقاصة ERP، ولا يستطيع هذا الإصدار ({v}) فتحها. لم يتغيّر فيها شيء.', 'These books come from a newer Qasa ERP, and this version ({v}) can’t open them. Nothing in them was changed.', 'ئەم دەفتەرانە لە وەشانێکی نوێتری قاسە ERP ـەوەن، و ئەم وەشانە ({v}) ناتوانێت بیانکاتەوە. هیچ شتێکیان تێدا نەگۆڕاوە.'],
  newerFromStore: ['حدّث قاصة ERP في Microsoft Store، ثم افتحه من جديد. إن لم يتوفر التحديث في Microsoft Store بعد، فأحدث إصدار موجود على qasaerp.com.', 'Update Qasa ERP in the Microsoft Store, then open it again. If the update isn’t in the Microsoft Store yet, the latest version is on qasaerp.com.', 'قاسە ERP لە Microsoft Store نوێ بکەرەوە، پاشان دووبارە بیکەرەوە. ئەگەر نوێکردنەوەکە هێشتا لە Microsoft Store نییە، نوێترین وەشان لە qasaerp.com هەیە.'],
  newerFromSite: ['ثبّت أحدث إصدار من qasaerp.com، ثم افتحه من جديد.', 'Install the latest version from qasaerp.com, then open it again.', 'نوێترین وەشان لە qasaerp.com دابمەزرێنە، پاشان دووبارە بیکەرەوە.'],
  getLatest: ['احصل على أحدث إصدار', 'Get the latest version', 'نوێترین وەشان وەربگرە'],
  // the office network, on the other PCs
  connect: ['الاتصال بخادم المكتب…', 'Connect to an office server…', 'پەیوەندی بە سێرڤەری نووسینگەوە…'],
  connectedTo: ['متصل بـ {host}', 'Connected to {host}', 'پەیوەستە بە {host}'],
  workHere: ['العمل على هذا الحاسوب', 'Work on this PC', 'کارکردن لەسەر ئەم کۆمپیوتەرە'],
  serverDown: ['خادم المكتب {host} لا يجيب. هل الحاسوب يعمل وقاصة ERP مفتوح عليه؟', 'The office server {host} doesn’t answer. Is that PC on, with Qasa ERP open?', 'سێرڤەری نووسینگە {host} وەڵام ناداتەوە. ئەو کۆمپیوتەرە هەڵکراوە و قاسە ERP لەسەری کراوەیە؟'],
  serverChanged: ['شهادة خادم المكتب {host} تغيّرت، فلا يمكن التأكد أنه الخادم نفسه. اتصل من جديد برمز الاقتران الذي يظهر عليه.', 'The certificate of the office server {host} has changed, so it can’t be confirmed as the same server. Connect again with the pairing code it shows.', 'بڕوانامەی سێرڤەری نووسینگە {host} گۆڕاوە، بۆیە ناتوانرێت دڵنیا بین هەمان سێرڤەرە. بە کۆدی جووتبوونی سەر ئەو دووبارە پەیوەندی بکەرەوە.'],
  tryAgain: ['حاول مجدداً', 'Try again', 'دووبارە هەوڵ بدەرەوە'],
  cancel: ['إلغاء', 'Cancel', 'پاشگەزبوونەوە'],
  // the company database on a MariaDB/MySQL server (Business)
  dbServerProblem: ['تعذّر فتح قاعدة بيانات الشركة على الخادم {host} (قاعدة البيانات {database}).', 'The company database on the server {host} (database {database}) can’t be opened.', 'بنکەدراوەی کۆمپانیا لەسەر سێرڤەری {host} (بنکەدراوەی {database}) ناکرێتەوە.'],
  dbWhyUnavailable: ['الخادم لا يجيب. تأكد أنه يعمل وأن هذا الحاسوب متصل بالشبكة.', 'The server doesn’t answer. Check that it is running and that this PC is connected to the network.', 'سێرڤەرەکە وەڵام ناداتەوە. دڵنیابە کە کار دەکات و ئەم کۆمپیوتەرە بە تۆڕەوە بەستراوە.'],
  dbWhyLogin: ['الخادم رفض اسم المستخدم أو كلمة المرور، أو لم تعد قاعدة البيانات موجودة. ربما تغيّرت على الخادم.', 'The server refused the user name or password, or the database is no longer there. It may have been changed on the server.', 'سێرڤەرەکە ناوی بەکارهێنەر یان وشەی نهێنی ڕەتکردەوە، یان بنکەدراوەکە چیتر نییە. لەوانەیە لەسەر سێرڤەرەکە گۆڕدرابێت.'],
  dbWhyInUse: ['قاصة ERP على حاسوب آخر يعمل على قاعدة البيانات هذه الآن. يفتحها حاسوب واحد فقط، وتتصل الحواسيب الأخرى به عبر شبكة المكتب.', 'Qasa ERP on another PC is working on this database now. Only one PC opens it; the other PCs connect to that PC through the office network.', 'قاسە ERP لەسەر کۆمپیوتەرێکی تر ئێستا لەسەر ئەم بنکەدراوەیە کار دەکات. تەنها یەک کۆمپیوتەر دەیکاتەوە؛ کۆمپیوتەرەکانی تر لە ڕێگەی تۆڕی نووسینگەوە پەیوەندی بەو کۆمپیوتەرەوە دەکەن.'],
  dbWhyCertificate: ['لا يمكن التحقق من شهادة الخادم: ليست الشهادة المعتمدة، أو انتهت صلاحيتها. اسأل مسؤول الخادم.', 'The server’s certificate can’t be checked: it isn’t the one that was confirmed, or it has expired. Ask the server’s administrator.', 'بڕوانامەی سێرڤەرەکە ناپشکنرێت: ئەوە نییە کە پەسەندکرابوو، یان کاتی بەسەرچووە. لە بەڕێوەبەری سێرڤەرەکە بپرسە.'],
  dbWhyConfig: ['لا يمكن قراءة إعدادات قاعدة البيانات على هذا الحاسوب (database.json في مجلد قاصة ERP). لن يفتح قاصة ERP شركة فارغة مكانها؛ تواصل مع الدعم.', 'This PC’s database settings (database.json in the Qasa ERP folder) can’t be read. Qasa ERP won’t open an empty company in their place; contact support.', 'ڕێکخستنەکانی بنکەدراوەی ئەم کۆمپیوتەرە (database.json لە بوخچەی قاسە ERP) ناخوێندرێنەوە. قاسە ERP کۆمپانیایەکی بەتاڵ لە جێیدا ناکاتەوە؛ پەیوەندی بە پشتگیرییەوە بکە.'],
  dbWhyPassword: ['لا يمكن قراءة كلمة مرور قاعدة البيانات المحفوظة لمستخدم ويندوز هذا.', 'The saved database password can’t be read for this Windows user.', 'وشەی نهێنیی پاشەکەوتکراوی بنکەدراوە بۆ ئەم بەکارهێنەرەی ویندۆز ناخوێندرێتەوە.'],
  dbWhyOther: ['السبب: {code}', 'Reason: {code}', 'هۆکار: {code}'],
  dbUseLocalCopy: ['استخدام ملف الشركة من قبل النقل', 'Use the company file from before the move', 'بەکارهێنانی فایلی کۆمپانیا لە پێش گواستنەوە'],
  dbLocalCopyConfirm: ['سيفتح قاصة ERP ملف الشركة كما كان في {date}، يوم نُقلت الشركة إلى الخادم. لا يحتوي على شيء أُدخل على الخادم بعد ذلك، ويتوقف هذا الحاسوب عن استخدام الخادم. هل تتابع؟', 'Qasa ERP opens the company file as it was on {date}, when the company moved to the server. Nothing entered on the server since then is in it, and this PC stops using the server. Continue?', 'قاسە ERP فایلی کۆمپانیا دەکاتەوە وەک ئەوەی لە {date} بوو، ئەو ڕۆژەی کۆمپانیا گوازرایەوە بۆ سێرڤەر. هیچ شتێک کە دواتر لەسەر سێرڤەر تۆمارکراوە تێیدا نییە، و ئەم کۆمپیوتەرە واز لە بەکارهێنانی سێرڤەر دەهێنێت. بەردەوام دەبیت؟'],
  // the server process (server-process.ts) ended by itself
  serverCrashed: ['توقف جزء الخادم في قاصة ERP بشكل غير متوقع. بياناتك محفوظة في ملف الشركة.', 'Qasa ERP’s server part stopped unexpectedly. Your data is safe in the company file.', 'بەشی سێرڤەری قاسە ERP لەناکاو وەستا. داتاکانت لە فایلی کۆمپانیادا پارێزراون.'],
  serverCrashedDetail: ['أعد التشغيل للمتابعة. إن تكرر ذلك، أرسل ملفات السجل (server.log) إلى الدعم. الرمز: {code}', 'Restart to carry on. If it happens again, send the log files (server.log) to support. Code: {code}', 'دەستپێبکەرەوە بۆ بەردەوامبوون. ئەگەر دووبارە بووەوە، فایلەکانی تۆمار (server.log) بنێرە بۆ پشتگیری. کۆد: {code}'],
  openLogs: ['فتح مجلد السجلات', 'Open the logs folder', 'کردنەوەی بوخچەی تۆمارەکان'],
  // graphics acceleration (Settings → Language and display)
  gpuOffTitle: ['تم إيقاف تسريع الرسوميات', 'Graphics acceleration turned off', 'خێراکردنی گرافیک ڕاگیرا'],
  gpuOff: ['توقف معالج الرسوميات في هذا الحاسوب عدة مرات، لذلك أوقف قاصة ERP تسريع الرسوميات. أعد التشغيل ليعمل بسلاسة. يمكنك إعادة تشغيله من الإعدادات ← اللغة والعرض.', 'This PC’s graphics stopped several times, so Qasa ERP turned graphics acceleration off. Restart for it to run smoothly. You can turn it back on in Settings → Language and display.', 'گرافیکی ئەم کۆمپیوتەرە چەند جارێک وەستا، بۆیە قاسە ERP خێراکردنی گرافیکی ڕاگرت. دەستپێبکەرەوە بۆ ئەوەی بە نەرمی کار بکات. دەتوانیت لە ڕێکخستنەکان ← زمان و پیشاندان دووبارە هەڵیبکەیتەوە.'],
  // backups (Settings)
  // 1.1: the backup when Qasa ERP closes (close-backup.ts)
  closeBackingUp: ['يحفظ نسخة احتياطية قبل الإغلاق…', 'Backing up before closing…', 'باکئەپ دەکرێت پێش داخستن…'],
  closeSkip: ['تخطَّ هذه المرة', 'Skip this time', 'ئەم جارە بازی بدە'],
  closeBackupFailed: ['تعذّر حفظ النسخة الاحتياطية عند إغلاق قاصة ERP آخر مرة. دفاترك كما هي؛ راجع الإعدادات ← النسخ الاحتياطية.', 'The backup could not be made when Qasa ERP last closed. Your books are as they were; see Settings → Backups.', 'لە دوایین داخستنی قاسە ERP باکئەپ نەکرا. دەفتەرەکانت وەک خۆیانن؛ ڕێکخستنەکان ← باکئەپەکان ببینە.'],
  closeBackupTimeout: ['استغرقت النسخة أكثر من دقيقة، فأُغلق البرنامج دونها.', 'It took more than a minute, so the app closed without it.', 'زیاتر لە خولەکێکی خایاند، بۆیە بەرنامەکە بەبێ ئەو داخرا.'],
  backupFolder: ['اختر مجلد النسخ الاحتياطية', 'Choose the folder for backups', 'بوخچەی باکئەپەکان هەڵبژێرە'],
  restoreFile: ['اختر النسخة الاحتياطية المراد استرجاعها', 'Choose the backup to restore', 'ئەو باکئەپە هەڵبژێرە کە دەتەوێت بیگەڕێنیتەوە'],
  // a restore that could not put the copy in place (server-process.ts): the company file was left as it was
  restoreFailed: ['تعذّر استرجاع النسخة الاحتياطية، ولم يتغيّر شيء في ملف الشركة. تأكد أن القرص متصل وفيه مساحة كافية، ثم حاول مرة أخرى.', 'The backup couldn’t be restored, and nothing in the company file was changed. Check that the disk is connected and has enough free space, then try again.', 'باکئەپەکە نەگەڕێندرایەوە، و هیچ شتێک لە فایلی کۆمپانیادا نەگۆڕا. دڵنیابە کە دیسکەکە بەستراوە و شوێنی بەتاڵی بەس هەیە، پاشان دووبارە هەوڵ بدەرەوە.'],
  // a restore that failed and could not even put the company file back (server-process.ts): it is kept aside, and the
  // next start puts it back
  restoreFailedAside: ['تعذّر استرجاع النسخة الاحتياطية، وتعذّرت إعادة ملف الشركة إلى مكانه: إنه محفوظ دون تغيير في مجلد البيانات باسم {file}. سيعيده قاصة ERP إلى مكانه عند التشغيل التالي. إن لم يتمكن، أغلق البرامج التي قد تستخدم مجلد البيانات (أداة نسخ احتياطي أو مزامنة)، ثم شغّل قاصة ERP مرة أخرى.', 'The backup couldn’t be restored, and the company file couldn’t be put back in its place: it is kept, unchanged, in the data folder as {file}. Qasa ERP puts it back when it starts again. If it can’t, close any program that may be using the data folder (a backup or sync tool), then start Qasa ERP again.', 'باکئەپەکە نەگەڕێندرایەوە، و فایلی کۆمپانیا نەگەڕێندرایەوە شوێنی خۆی: بێ گۆڕان لە بوخچەی داتادا بە ناوی {file} پارێزراوە. قاسە ERP کاتێک دووبارە دەستپێدەکاتەوە دەیگەڕێنێتەوە شوێنی خۆی. ئەگەر نەیتوانی، ئەو بەرنامانە دابخە کە لەوانەیە بوخچەی داتا بەکاربهێنن (ئامرازی باکئەپ یان هاوکاتکردن)، پاشان دووبارە قاسە ERP دەستپێبکەرەوە.'],
  // the company file can't be opened at the start
  dbDamaged: ['تعذّر فتح ملف الشركة. قد يكون تالفاً أو ليس ملف شركة لقاصة ERP.', 'The company file can’t be opened. It may be damaged, or it isn’t a Qasa ERP company file.', 'فایلی کۆمپانیا ناکرێتەوە. لەوانەیە تێکچووبێت، یان فایلی کۆمپانیای قاسە ERP نەبێت.'],
  dbDamagedDetail: ['«الاسترجاع من نسخة احتياطية» يحفظ هذا الملف جانباً في مجلد البيانات (لا يُحذف شيء)، ثم يفتح شركة فارغة. استرجع نسختك منها فوراً من الإعدادات ← النسخ الاحتياطية، ولا تُدخل فيها أي بيانات قبل ذلك.\nالسبب: {reason}', '“Restore from a backup” keeps this file aside in the data folder (nothing is deleted), then opens an empty company. Restore your backup in it straight away from Settings → Backups, and enter nothing in it before that.\nReason: {reason}', '«گەڕاندنەوە لە باکئەپێک» ئەم فایلە لە بوخچەی داتادا بە لاوە دادەنێت (هیچ ناسڕدرێتەوە)، پاشان کۆمپانیایەکی بەتاڵ دەکاتەوە. یەکسەر لە ڕێکخستنەکان ← باکئەپەکان باکئەپەکەتی تێدا بگەڕێنەوە، و پێش ئەوە هیچ داتایەکی تێدا تۆمار مەکە.\nهۆکار: {reason}'],
  // the company file is fine, but the copy kept before a schema update could not be written (server-process.ts)
  dbUpdateCopyFailed: [
    'تعذّر تحديث ملف الشركة، لأنه لم يمكن حفظ نسخة منه أولاً. الملف سليم ولم يتغيّر فيه شيء.',
    'The company file couldn’t be updated, because a copy of it couldn’t be kept first. The file is fine and nothing in it changed.',
    'فایلی کۆمپانیا نوێ نەکرایەوە، چونکە نەتوانرا سەرەتا کۆپییەکی لێ بپارێزرێت. فایلەکە ساغە و هیچ شتێکی تێدا نەگۆڕاوە.'
  ],
  dbUpdateCopyFailedDetail: [
    'قبل كل تحديث يحفظ قاصة ERP نسخة من ملف الشركة بجانبه في مجلد البيانات. وفّر مساحة على القرص (أو تأكد أن مجلد البيانات غير مقفل وأن لديك صلاحية الكتابة فيه)، ثم اختر «حاول مجدداً». لا تسترجع نسخة احتياطية: ملفك لا يحتاج إلى ذلك.\nالسبب: {reason}',
    'Before each update Qasa ERP keeps a copy of the company file beside it in the data folder. Free some disk space (or check that the data folder isn’t locked and you may write to it), then choose Try again. Don’t restore a backup: your file doesn’t need it.\nReason: {reason}',
    'پێش هەر نوێکردنەوەیەک قاسە ERP کۆپییەکی فایلی کۆمپانیا لە تەنیشتیەوە لە بوخچەی داتادا دەپارێزێت. هەندێک شوێن لە دیسکەکەدا بەتاڵ بکە (یان دڵنیابە کە بوخچەی داتا داخراو نییە و مۆڵەتی نووسینت تێیدا هەیە)، پاشان «دووبارە هەوڵ بدەرەوە» هەڵبژێرە. باکئەپ مەگەڕێنەوە: فایلەکەت پێویستی پێی نییە.\nهۆکار: {reason}'
  ],
  dbRestoreFromBackup: ['الاسترجاع من نسخة احتياطية', 'Restore from a backup', 'گەڕاندنەوە لە باکئەپێک'],
  openFirstCompany: ['فتح الشركة الأولى', 'Open the first company', 'کردنەوەی کۆمپانیای یەکەم']
} as const;

export type TextKey = keyof typeof T;

export function text(lang: Lang, key: TextKey, vars: Record<string, string> = {}): string {
  let s: string = T[key][lang === 'ar' ? 0 : lang === 'ku' ? 2 : 1];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function isLang(value: unknown): value is Lang {
  return value === 'ar' || value === 'en' || value === 'ku';
}
