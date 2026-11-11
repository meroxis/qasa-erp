/**
 * Texts for the 1.1 security fixes: the errors they added, restoring an unencrypted copy on purpose, backups kept on
 * this PC while Documents is synced to the internet, why a backup failed, and correcting a controlled-medicine record.
 * Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const HARDENING_TEXT = {
  // errors the server now answers with
  err_backup_not_encrypted: [
    'هذه النسخة غير مشفّرة، وللشركة كلمة مرور للنسخ. أي شخص يستطيع الكتابة في المجلد قد يضع فيه نسخة غير مشفّرة، لذلك لا تُسترجع إلا إذا أكّدت أنك تعرف مصدرها.',
    'This copy isn’t encrypted, and the company has a backup password. Anyone who can write to the folder could have put an unencrypted copy there, so it is restored only if you confirm you know where it came from.',
    'ئەم کۆپییە شفرنەکراوە، و کۆمپانیاکە وشەی نهێنیی باکئەپی هەیە. هەر کەسێک بتوانێت لە بوخچەکەدا بنووسێت دەتوانێت کۆپییەکی شفرنەکراوی تێدا دابنێت، بۆیە تەنها ئەو کاتە دەگەڕێنرێتەوە کە دڵنیای بکەیتەوە سەرچاوەکەی دەناسیت.'
  ],
  err_backup_password_weak: [
    'كلمة مرور النسخ هذه سهلة التخمين. استخدم عبارة أطول من كلمات ليست اسم الشركة أو البرنامج أو السنة.',
    'That backup password is easy to guess. Use a longer phrase of words that aren’t the company, the app or the year.',
    'ئەم وشەی نهێنیی باکئەپە بە ئاسانی مەزەندە دەکرێت. ڕستەیەکی درێژتر بەکاربهێنە لە وشەگەلێک کە ناوی کۆمپانیا، بەرنامە یان ساڵ نین.'
  ],
  err_backup_allow_plain: [
    'لم يُفهم طلب استرجاع النسخة غير المشفّرة. حاول مجدداً.',
    'The request to restore an unencrypted copy wasn’t understood. Try again.',
    'داواکاریی گەڕاندنەوەی کۆپییە شفرنەکراوەکە تێنەگەیشترا. دووبارە هەوڵ بدەرەوە.'
  ],
  err_database_ca_unsafe: [
    'شهادة الجهة المُصدِرة هذه لا تكفي للثقة بهذا الخادم بأمان: شهادة الخادم تسمّي أجهزة أخرى غير هذا العنوان، أو لم توقّعها تلك الجهة مباشرة. اتصل بالاسم الذي تسمّيه الشهادة، أو اطلب من مسؤول الخادم شهادة مصنوعة لهذا الخادم.',
    'That authority certificate isn’t enough to trust this server safely: the server’s certificate names other hosts, not this address, or the authority didn’t sign it directly. Connect by the name the certificate gives, or ask the server’s administrator for a certificate made for this server.',
    'ئەم بڕوانامەی دەسەڵاتی دەرکەرە بەس نییە بۆ متمانەکردنی سەلامەت بەم سێرڤەرە: بڕوانامەی سێرڤەرەکە ناوی ئامێری تر دەبات نەک ئەم ناونیشانە، یان ئەو دەسەڵاتە ڕاستەوخۆ واژۆی نەکردووە. بەو ناوەی بڕوانامەکە دەیبات پەیوەندی بکە، یان داوا لە بەڕێوەبەری سێرڤەرەکە بکە بڕوانامەیەک بۆ ئەم سێرڤەرە دروست بکات.'
  ],
  err_source_not_allowed: [
    'طلبات هذا المتجر يرسلها مفتاح API آخر. لكل موقع مفتاحه: استخدم مفتاح ذلك المتجر، أو ألغِ المفتاح القديم ليأخذ المفتاح الجديد طلباته.',
    'This shop’s orders are sent with another API key. Each website has its own key: use that shop’s key, or revoke the old key so the new one takes its orders over.',
    'داواکارییەکانی ئەم فرۆشگایە بە کلیلێکی تری API دەنێردرێن. هەر ماڵپەڕێک کلیلی خۆی هەیە: کلیلی ئەو فرۆشگایە بەکاربهێنە، یان کلیلە کۆنەکە هەڵبوەشێنەوە تا کلیلە نوێیەکە داواکارییەکانی وەربگرێت.'
  ],
  err_source_limit: [
    'هذا المفتاح يرسل الطلبات لأكبر عدد مسموح من المتاجر. أنشئ مفتاحاً خاصاً لكل موقع.',
    'This key already sends orders for as many shops as a key may. Make a key of its own for each website.',
    'ئەم کلیلە بۆ زۆرترین ژمارەی ڕێگەپێدراوی فرۆشگا داواکاری دەنێرێت. بۆ هەر ماڵپەڕێک کلیلێکی تایبەت دروست بکە.'
  ],

  // restoring an unencrypted copy while the company has a backup password: the admin's own, deliberate choice
  bkPlainTitle: ['نسخة غير مشفّرة', 'An unencrypted copy', 'کۆپییەکی شفرنەکراو'],
  bkPlainWarning: [
    'لهذه الشركة كلمة مرور للنسخ، وهذه النسخة غير مشفّرة. لا يُعرف من صنعها: أي شخص يستطيع الكتابة في المجلد أو حساب السحابة قد يضعها، وقد تحمل قيوداً أو مستخدمين أو كلمات مرور غير التي عندك. استرجعها فقط إن كنت صنعتها بنفسك (قبل تعيين كلمة المرور مثلاً). يحلّ الاسترجاع محلّ ملف الشركة ويُسجَّل في سجل التدقيق أنها نسخة غير مشفّرة.',
    'This company has a backup password, and this copy isn’t encrypted. Nothing shows who made it: anyone who can write to the folder or the cloud account could have put it there, with other entries, users or passwords than yours. Restore it only if you made it yourself (before the password was set, say). The restore replaces the company file, and the audit log records that the copy was unencrypted.',
    'ئەم کۆمپانیایە وشەی نهێنیی باکئەپی هەیە، و ئەم کۆپییە شفرنەکراوە. هیچ شتێک پیشان نادات کێ دروستی کردووە: هەر کەسێک بتوانێت لە بوخچەکە یان هەژماری هەورەکەدا بنووسێت دەتوانێت دایبنێت، بە تۆمار، بەکارهێنەر یان وشەی نهێنیی جیاواز لەوانەی تۆ. تەنها ئەگەر خۆت دروستت کردبێت بیگەڕێنەرەوە (بۆ نموونە پێش دانانی وشەی نهێنی). گەڕاندنەوەکە جێگەی فایلی کۆمپانیا دەگرێتەوە، و تۆماری وردبینی دەنووسێت کە کۆپییەکە شفرنەکراو بووە.'
  ],
  bkPlainKnown: ['صنعتُ هذه النسخة بنفسي وأعرف مصدرها.', 'I made this copy myself and know where it came from.', 'ئەم کۆپییەم خۆم دروست کردووە و سەرچاوەکەی دەناسم.'],
  bkPlainRestore: ['استرجاع النسخة غير المشفّرة', 'Restore the unencrypted copy', 'گەڕاندنەوەی کۆپییە شفرنەکراوەکە'],

  // Documents synced to the internet and no backup password: the daily copies stay on this PC
  bkLocalInstead: [
    'مجلد المستندات تتم مزامنته مع الإنترنت ({f})، فبدون كلمة مرور للنسخ تُحفظ النسخ على هذا الحاسوب فقط، في المجلد أعلاه. عيّن كلمة مرور للنسخ فتذهب النسخ مشفّرةً إلى ذلك المجلد، فتكون لك نسخة في السحابة أيضاً.',
    'Documents is synced to the internet ({f}), so without a backup password the copies are kept on this PC only, in the folder above. Set a backup password and they go to that folder encrypted, so you have a copy in the cloud too.',
    'بوخچەی بەڵگەنامەکان لەگەڵ ئینتەرنێت هاوکات دەکرێت ({f})، بۆیە بەبێ وشەی نهێنیی باکئەپ کۆپییەکان تەنها لەسەر ئەم کۆمپیوتەرە، لە بوخچەکەی سەرەوە هەڵدەگیرێن. وشەی نهێنیی باکئەپ دابنێ و کۆپییەکان بە شفرکراوی دەچنە ئەو بوخچەیە، بەمەش کۆپییەکیشت لە هەور دەبێت.'
  ],
  bkNoticeLocal: [
    'مجلد المستندات على هذا الحاسوب تتم مزامنته مع الإنترنت، لذلك تُحفظ النسخ الاحتياطية اليومية على هذا الحاسوب بدلاً منه. عيّن كلمة مرور للنسخ في الإعدادات لتذهب النسخ مشفّرةً إلى مجلد السحابة.',
    'Documents on this PC is synced to the internet, so the daily backups are kept on this PC instead. Set a backup password in Settings to have them go to the cloud folder, encrypted.',
    'بوخچەی بەڵگەنامەکانی ئەم کۆمپیوتەرە لەگەڵ ئینتەرنێت هاوکات دەکرێت، بۆیە باکئەپە ڕۆژانەکان لە جیاتی ئەو لەسەر ئەم کۆمپیوتەرە هەڵدەگیرێن. لە ڕێکخستنەکان وشەی نهێنیی باکئەپ دابنێ تا کۆپییەکان بە شفرکراوی بچنە بوخچەی هەور.'
  ],
  bkNoticeLocalOk: ['فهمت', 'Got it', 'تێگەیشتم'],

  // why the last backup failed (after "The last backup failed: ")
  bkErr_settings_unreadable: [
    'تعذّرت قراءة إعدادات النسخ. اختر المجلد وعيّن كلمة مرور النسخ من جديد.',
    'the backup settings couldn’t be read. Choose the folder and set the backup password again.',
    'ڕێکخستنەکانی باکئەپ نەخوێندرانەوە. بوخچەکە هەڵبژێرە و وشەی نهێنیی باکئەپ دووبارە دابنێ.'
  ],
  bkErr_synced_needs_password: [
    'هذا المجلد تنسخه خدمة سحابية إلى الإنترنت. عيّن كلمة مرور للنسخ، أو اختر مجلداً لا تتم مزامنته.',
    'the folder is copied to the internet by a cloud service. Set a backup password, or choose a folder that isn’t synced.',
    'ئەم بوخچەیە خزمەتگوزارییەکی هەوری بۆ ئینتەرنێت کۆپی دەکات. وشەی نهێنیی باکئەپ دابنێ، یان بوخچەیەک هەڵبژێرە کە هاوکات نەکرێت.'
  ],
  bkErr_password_unreadable: [
    'لا يمكن قراءة كلمة مرور النسخ على هذا الحاسوب (مستخدم ويندوز آخر أو حاسوب جديد). عيّنها من جديد.',
    'the backup password can’t be read on this PC (another Windows user, or a new PC). Set it again.',
    'وشەی نهێنیی باکئەپ لەسەر ئەم کۆمپیوتەرە ناخوێندرێتەوە (بەکارهێنەرێکی تری ویندۆز، یان کۆمپیوتەرێکی نوێ). دووبارە دایبنێ.'
  ],
  bkErr_copy_check: [
    'لم تجتز النسخة الفحص فلم تُحفظ. حاول مجدداً، وإن تكرر ذلك فتواصل مع الدعم.',
    'the copy didn’t check out, so it wasn’t kept. Try again; if it happens again, contact support.',
    'کۆپییەکە لە پشکنین دەرنەچوو، بۆیە هەڵنەگیرا. دووبارە هەوڵ بدەرەوە؛ ئەگەر دووبارە بووەوە، پەیوەندی بە پشتگیرییەوە بکە.'
  ],
  bkErr_reopen_failed: [
    'لم تُفتح النسخة المشفّرة عند فحصها فلم تُحفظ. حاول مجدداً.',
    'the encrypted copy didn’t open again when checked, so it wasn’t kept. Try again.',
    'کۆپییە شفرکراوەکە لە پشکنیندا نەکرایەوە، بۆیە هەڵنەگیرا. دووبارە هەوڵ بدەرەوە.'
  ],
  bkErr_disk_full: [
    'القرص ممتلئ. أفرغ بعض المساحة أو اختر مجلداً آخر.',
    'the disk is full. Free some space, or choose another folder.',
    'دیسکەکە پڕە. هەندێک شوێن بەتاڵ بکە، یان بوخچەیەکی تر هەڵبژێرە.'
  ],
  bkErr_no_access: [
    'لا يسمح ويندوز بالكتابة في المجلد. اختر مجلداً آخر.',
    'Windows doesn’t allow writing to the folder. Choose another folder.',
    'ویندۆز ڕێگە نادات لە بوخچەکەدا بنووسرێت. بوخچەیەکی تر هەڵبژێرە.'
  ],
  bkErr_folder_missing: [
    'المجلد (أو القرص الذي فيه) غير موجود. صِل القرص أو اختر مجلداً آخر.',
    'the folder (or its drive) isn’t there. Plug the drive in, or choose another folder.',
    'بوخچەکە (یان دیسکەکەی) بوونی نییە. دیسکەکە ببەستەرەوە، یان بوخچەیەکی تر هەڵبژێرە.'
  ],

  // a recorded controlled-medicine line: corrected by an admin only, both versions kept in the audit log
  ph_correct: ['تصحيح', 'Correct', 'ڕاستکردنەوە'],
  ph_correctTitle: ['تصحيح بيانات الدواء الخاضع للرقابة', 'Correct the controlled medicine details', 'ڕاستکردنەوەی وردەکاریی دەرمانی ژێر چاودێری'],
  ph_correctHelp: [
    'يبقى ما سُجّل أولاً وما تصحّحه الآن كلاهما في سجل التدقيق.',
    'Both what was recorded first and your correction stay in the audit log.',
    'ئەوەی یەکەمجار تۆمار کرا و ڕاستکردنەوەکەت هەردووکیان لە تۆماری وردبینیدا دەمێننەوە.'
  ]
} as const satisfies Record<string, readonly [string, string, string]>;
