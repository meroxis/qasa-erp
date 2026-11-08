/**
 * Texts for the trial balance's opening columns, backups on every plan, the admin recovery code and saved stock
 * counts. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const SAFETY_TEXT = {
  // trial balance: opening, movement and closing, each as debit and credit
  tbMovement: ['الحركة خلال المدة', 'Movement in the period', 'جووڵە لەم ماوەیەدا'],
  openingDebit: ['رصيد افتتاحي مدين', 'Opening debit', 'باڵانسی سەرەتای قەرزار'],
  openingCredit: ['رصيد افتتاحي دائن', 'Opening credit', 'باڵانسی سەرەتای قەرزدەر'],
  closingDebit: ['رصيد ختامي مدين', 'Closing debit', 'باڵانسی کۆتایی قەرزار'],
  closingCredit: ['رصيد ختامي دائن', 'Closing credit', 'باڵانسی کۆتایی قەرزدەر'],
  tbOpeningHelp: [
    'الرصيد الافتتاحي هو مجموع كل ما رُحّل قبل تاريخ «من».',
    'The opening balance is everything posted before the From date.',
    'باڵانسی سەرەتا کۆی هەموو ئەو شتانەیە کە پێش بەرواری «لە» تۆمار کراون.'
  ],

  // backups on every plan, and the notice when they need the admin
  bkSavedNow: ['حُفظت النسخة الاحتياطية.', 'The backup is saved.', 'باکئەپەکە پاشەکەوت کرا.'],
  bkNoticePlan: [
    'لا تُنسخ بيانات الشركة تلقائياً في خطتك الحالية، ولم تُحفظ أي نسخة منذ أكثر من 3 أيام. احفظ نسخة الآن من الإعدادات.',
    'Your current plan has no automatic backups, and no copy has been saved for more than 3 days. Save a backup now in Settings.',
    'پلانەکەی ئێستات باکئەپی خۆکاری تێدا نییە، و زیاتر لە 3 ڕۆژە هیچ کۆپییەک پاشەکەوت نەکراوە. لە ڕێکخستنەکان ئێستا باکئەپێک پاشەکەوت بکە.'
  ],
  bkNoticeOff: [
    'النسخ الاحتياطي التلقائي متوقف، ولم تُحفظ أي نسخة منذ أكثر من 3 أيام.',
    'Automatic backups are turned off, and no copy has been saved for more than 3 days.',
    'باکئەپی خۆکار کوژاوەتەوە، و زیاتر لە 3 ڕۆژە هیچ کۆپییەک پاشەکەوت نەکراوە.'
  ],
  bkNoticeOld: [
    'آخر نسخة احتياطية أقدم من 3 أيام. تأكد أن مجلد النسخ متاح، أو احفظ نسخة الآن.',
    'The last backup is more than 3 days old. Check that the backup folder is there, or save a backup now.',
    'دوایین باکئەپ لە 3 ڕۆژ کۆنترە. دڵنیابە بوخچەی باکئەپەکان بەردەستە، یان ئێستا باکئەپێک پاشەکەوت بکە.'
  ],
  bkNoticeFailed: [
    'فشلت آخر نسخة احتياطية. افتح الإعدادات لترى السبب واحفظ نسخة من جديد.',
    'The last backup failed. Open Settings to see why, and save a backup again.',
    'دوایین باکئەپ سەرکەوتوو نەبوو. ڕێکخستنەکان بکەرەوە بۆ ئەوەی هۆکارەکە ببینیت، و دووبارە باکئەپێک پاشەکەوت بکە.'
  ],
  bkNoticeOpen: ['النسخ الاحتياطي', 'Backups', 'باکئەپەکان'],

  // the admin recovery code
  recoveryTitle: ['رمز استعادة المدير', 'Admin recovery code', 'کۆدی گەڕاندنەوەی بەڕێوەبەر'],
  recoveryShownOnce: [
    'اكتب هذا الرمز أو اطبعه واحفظه بعيداً عن الحاسوب. يظهر الآن مرة واحدة فقط، ولا يمكن لأحد، ولا لنا، أن يعرضه مرة أخرى.',
    'Write this code down or print it, and keep it away from the PC. It is shown now, once: nobody, us included, can show it again.',
    'ئەم کۆدە بنووسە یان چاپی بکە و دوور لە کۆمپیوتەرەکە بیپارێزە. تەنها ئێستا یەک جار پیشان دەدرێت: کەس، ئێمەش، ناتوانێت دووبارە پیشانی بداتەوە.'
  ],
  recoveryWhere: [
    'إذا نسي المدير كلمة مروره: في برنامج ويندوز على هذا الحاسوب افتح «ملف» ← «إعادة تعيين كلمة مرور المدير» واكتب هذا الرمز. بعد استخدامه يُعطى رمز جديد.',
    'If the admin forgets their password: in the Windows app on this PC, open File → Reset admin password and enter this code. Once used, it is replaced by a new one.',
    'ئەگەر بەڕێوەبەر وشەی نهێنیی خۆی بیرچووەوە: لە بەرنامەی ویندۆز لەسەر ئەم کۆمپیوتەرە «فایل» ← «ڕێکخستنەوەی وشەی نهێنیی بەڕێوەبەر» بکەرەوە و ئەم کۆدە بنووسە. دوای بەکارهێنانی، کۆدێکی نوێ دەدرێت.'
  ],
  recoveryKept: ['كتبت الرمز وحفظته في مكان آمن', 'I have written the code down and put it somewhere safe', 'کۆدەکەم نووسی و لە شوێنێکی سەلامەت داینا'],
  recoveryDone: ['تم', 'Done', 'تەواو'],
  recoveryHelp: [
    'رمز استعادة المدير يعيد تعيين كلمة مرور منسية من برنامج ويندوز على هذا الحاسوب.',
    'The admin recovery code resets a forgotten admin password in the Windows app on this PC.',
    'کۆدی گەڕاندنەوەی بەڕێوەبەر وشەی نهێنییەکی لەبیرچوو لە بەرنامەی ویندۆز لەسەر ئەم کۆمپیوتەرە ڕێکدەخاتەوە.'
  ],
  recoveryNew: ['رمز استعادة جديد', 'New recovery code', 'کۆدی گەڕاندنەوەی نوێ'],
  recoveryNewQ: [
    'إنشاء رمز استعادة جديد؟ الرمز السابق لن يعمل بعد الآن.',
    'Make a new recovery code? The code before it stops working.',
    'کۆدێکی گەڕاندنەوەی نوێ دروست بکرێت؟ کۆدەکەی پێشوو چیتر کار ناکات.'
  ],
  err_signin_off: ['شغّل تسجيل الدخول أولاً.', 'Switch sign-in on first.', 'سەرەتا چوونەژوورەوە چالاک بکە.'],

  // the stock count, saved on the server as it is typed
  adj_countKept: [
    'يُحفظ الجرد على الخادم أثناء الكتابة، فيمكنك الخروج والعودة إليه. تُثبَّت كمية الدفاتر لكل مادة لحظة جردها أول مرة، فلا يظهر ما يُباع أثناء الجرد زيادةً.',
    'The count is saved on the server as you type, so you can leave and come back to it. Each item’s book quantity is fixed the moment it is first counted, so what is sold during the count does not show as a surplus.',
    'ژماردنەکە لە کاتی نووسیندا لەسەر سێرڤەر پاشەکەوت دەکرێت، بۆیە دەتوانیت بڕۆیت و بگەڕێیتەوە سەری. بڕی دەفتەری هەر کاڵایەک لەو ساتەدا جێگیر دەکرێت کە یەکەم جار دەژمێردرێت، بۆیە ئەوەی لە کاتی ژماردندا دەفرۆشرێت وەک زیادە دەرناکەوێت.'
  ],
  adj_countResumed: [
    'هذا جرد محفوظ لهذا المخزن ({n} مادة)، آخر تعديل عليه من {who} في {when}. تابع من حيث توقفت.',
    'This warehouse has a saved count ({n} items), last changed by {who} on {when}. Carry on where it stopped.',
    'ئەم کۆگایە ژماردنێکی پاشەکەوتکراوی هەیە ({n} کاڵا)، دوایین گۆڕانکاری لەلایەن {who} لە {when}. لەو شوێنەوە بەردەوام بە کە وەستا.'
  ],
  adj_countSaved: ['محفوظ على الخادم', 'Saved on the server', 'لەسەر سێرڤەر پاشەکەوت کراوە'],
  adj_countSaving: ['جارٍ الحفظ…', 'Saving…', 'پاشەکەوت دەکرێت…'],
  adj_countUnsaved: ['تغييرات لم تُحفظ بعد', 'Changes not saved yet', 'گۆڕانکاری هێشتا پاشەکەوت نەکراوە'],
  adj_countSaveFailed: ['تعذّر الحفظ، ستُعاد المحاولة تلقائياً. لا تغلق الصفحة.', 'Could not save; it will try again by itself. Don’t close the page.', 'پاشەکەوت نەکرا؛ خۆی دووبارە هەوڵ دەداتەوە. پەڕەکە دامەخە.'],
  adj_leaveCount: [
    'بعض ما جردته لم يُحفظ على الخادم بعد. هل تغادر الصفحة على أي حال؟',
    'Some of what you counted is not saved on the server yet. Leave the page anyway?',
    'هەندێک لەوەی ژماردووتە هێشتا لەسەر سێرڤەر پاشەکەوت نەکراوە. هەر بە هەر حاڵ پەڕەکە بەجێدەهێڵیت؟'
  ],
  adj_discardCount: ['تجاهل الجرد', 'Discard the count', 'وازهێنان لە ژماردن'],
  adj_discardCountQ: [
    'تجاهل هذا الجرد كله والبدء من جديد؟ لا يتغيّر شيء في المخزون.',
    'Discard this whole count and start again? Nothing in the stock changes.',
    'واز لە هەموو ئەم ژماردنە بهێنرێت و لە سەرەتاوە دەست پێبکرێتەوە؟ هیچ شتێک لە کۆگادا ناگۆڕێت.'
  ],
  adj_frozenHelp: [
    'للمادة التي جُردت: كمية الدفاتر لحظة جردها أول مرة.',
    'For a counted item: the book quantity at the moment it was first counted.',
    'بۆ کاڵایەکی ژمێردراو: بڕی دەفتەر لەو ساتەی یەکەم جار ژمێردرا.'
  ],
  adj_frozenNow: ['في الدفاتر الآن: {n}', 'In the books now: {n}', 'ئێستا لە دەفتەردا: {n}'],
  adj_countClosedElsewhere: [
    'أُنهي هذا الجرد أو أُلغي على حاسوب آخر، لذا لم تُحفظ آخر التغييرات التي أُجريت هنا. تعرض الصفحة الآن المخزن من جديد.',
    'This count was finished or discarded on another PC, so the last changes made here were not saved. The page now shows the warehouse afresh.',
    'ئەم ژماردنە لەسەر کۆمپیوتەرێکی تر تەواو کرا یان وازی لێهێنرا، بۆیە دوایین گۆڕانکارییەکانی ئێرە پاشەکەوت نەکران. پەڕەکە ئێستا کۆگاکە لە سەرەتاوە پیشان دەدات.'
  ],
  adj_nothingCounted: [
    'لم يُجرد شيء بعد: أدخل كمية مادة واحدة على الأقل، أو اختر الجرد الكامل.',
    'Nothing is counted yet: enter a count for at least one item, or choose a full count.',
    'هێشتا هیچ نەژمێردراوە: لانیکەم بڕی یەک کاڵا بنووسە، یان ژماردنی تەواو هەڵبژێرە.'
  ],
  err_count_session_open: [
    'لهذا المخزن جرد مفتوح محفوظ على الخادم. أكمله أو تجاهله من صفحة الجرد، أو أضف هذه الكميات إليه هناك.',
    'This warehouse has an open count saved on the server. Finish or discard it on the count page, or add these quantities to it there.',
    'ئەم کۆگایە ژماردنێکی کراوەی لەسەر سێرڤەر پاشەکەوتکراو هەیە. لە پەڕەی ژماردن تەواوی بکە یان وازی لێبهێنە، یان ئەم بڕانە لەوێ بخەرە ناوی.'
  ]
} as const satisfies Record<string, readonly [string, string, string]>;
