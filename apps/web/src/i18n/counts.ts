/**
 * Texts of a count (1.4.1). A text whose `{n}` is a count reads wrong for one in the "many" form ("1 items"), so it may
 * have a form for exactly one, `<key>__one`, in all three languages (Arabic, English, Kurdish, like i18n.ts), and Arabic
 * its dual for exactly two (AR_DUAL). `t()` picks the form from the count; a text whose count is not `{n}` names its
 * placeholder in COUNT_VAR. Kurdish keeps the noun singular after a number, so its form for one only changes the verb
 * ("گەیشتووەتە", not "گەیشتوونەتە") or stays as it was.
 */
export const COUNT_TEXT = {
  err_plan_user_limit__one: [
    'خطة هذه الشركة تسمح بمستخدم واحد، وعدد المستخدمين الفعّالين أكثر. اطلب من المدير إيقاف مستخدمين آخرين ليبقى مكان لك، أو ترقية الخطة.',
    'This company’s plan allows {n} user, and it has more active users than that. Ask an admin to make other users inactive so there is room for you, or to upgrade the plan.',
    'پلانی ئەم کۆمپانیایە ڕێگە بە {n} بەکارهێنەر دەدات، و ژمارەی بەکارهێنەرە چالاکەکان زیاترە. داوا لە بەڕێوەبەر بکە بەکارهێنەرانی تر ناچالاک بکات تا شوێنت بۆ بمێنێتەوە، یان پلانەکە بەرز بکاتەوە.'
  ],
  usersOverLimit__one: [
    'خطتك تسمح بمستخدم واحد، وعندك {m} فعّالين. لا يستطيع الدخول إلا المدراء أولاً ثم الأقدم إنشاءً، حتى {k}. الباقون (عليهم علامة «فوق حد الخطة») لا يدخلون إلى أن توقف مستخدمين آخرين أو ترقّي الخطة. لا يُحذف شيء.',
    'Your plan allows {n} user and you have {m} active. Only {k} can sign in: admins first, then the earliest made. The others (marked “Over the plan”) can’t sign in until you make other users inactive or upgrade the plan. Nothing is deleted.',
    'پلانەکەت ڕێگە بە {n} بەکارهێنەر دەدات و {m} چالاکت هەیە. تەنها {k} دەتوانن بچنە ژوورەوە: سەرەتا بەڕێوەبەران، پاشان ئەوانەی زووتر دروست کراون. ئەوانی تر (نیشانەی «سەروو سنووری پلان»یان لەسەرە) ناتوانن بچنە ژوورەوە تا بەکارهێنەرانی تر ناچالاک نەکەیت یان پلانەکە بەرز نەکەیتەوە. هیچ شتێک ناسڕدرێتەوە.'
  ],
  trialEnds__one: ['تنتهي التجربة في {d} — بقي يوم واحد.', 'The trial ends on {d} ({n} day left).', 'تاقیکردنەوە لە {d} کۆتایی دێت ({n} ڕۆژ ماوە).'],
  nudgeText__one: [
    'رحّلت فاتورة مبيعات واحدة هذا الشهر. Pro يضيف فريق عمل على شبكة المكتب والتقسيط والرواتب والنسخ الاحتياطي.',
    'You posted {n} sales invoice this month. Pro adds a team on the office network, installments, payroll and backups.',
    'ئەم مانگە {n} پسوولەی فرۆشتنت تەرحیل کردووە. Pro تیمێک لەسەر تۆڕی نووسینگە، قیست، مووچە و باکئەپ زیاد دەکات.'
  ],
  bkCopies__one: ['نسخة واحدة', '{n} copy', '{n} کۆپی'],
  bl_unfinished_entries__one: [
    'سند أو قيد واحد لم يُصادق بعد: صادِقه أو احذفه.',
    '{n} voucher or entry is not approved yet: approve or delete it.',
    '{n} سەنەد یان قەید هێشتا پەسەند نەکراوە: پەسەندی بکە یان بیسڕەوە.'
  ],
  bl_unfinished_documents__one: [
    'فاتورة أو مستند واحد لا يزال مسودة: رحّله أو احذفه.',
    '{n} invoice or document is still a draft: post or delete it.',
    '{n} پسوولە یان بەڵگە هێشتا ڕەشنووسە: تەرحیلی بکە یان بیسڕەوە.'
  ],
  dbHasCompany__one: [
    'في قاعدة البيانات هذه شركة: {name} (قيد واحد). يمكن لهذا الحاسوب العمل عليها؛ ويُحفظ ملف الشركة على هذا الحاسوب جانباً ولا يُدمج معها.',
    'This database has a company: {name} ({n} entry). This PC can work on it; its own company file is kept aside, not merged into it.',
    'ئەم بنکەدراوەیە کۆمپانیایەکی تێدایە: {name} ({n} قەید). ئەم کۆمپیوتەرە دەتوانێت لەسەری کار بکات؛ فایلی کۆمپانیای خۆی بە جیا هەڵدەگیرێت و تێکەڵ ناکرێت.'
  ],
  lateDays__one: ['متأخر يوماً واحداً', '{n} day late', '{n} ڕۆژ دواکەوتووە'],
  adj_applied__one: ['تمت قراءة سطر واحد.', '{n} line read.', '{n} دێڕ خوێندرایەوە.'],
  adj_countedSummary__one: ['مادة واحدة معدودة', '{n} item counted', '{n} کاڵا ژمێردرا'],
  adj_diffSummary__one: ['فرق واحد', '{n} difference', '{n} جیاوازی'],
  fa_lifeYears__one: ['سنة واحدة', '{n} year', '{n} ساڵ'],
  fa_months__one: ['شهر واحد', '{n} month', '{n} مانگ'],
  bk_countCheques__one: ['صك واحد', '{n} cheque', '{n} چەک'],
  bk_daysLeft__one: ['بعد يوم واحد', 'in {n} day', 'دوای {n} ڕۆژ'],
  bk_daysLate__one: ['متأخر يوماً واحداً', '{n} day late', '{n} ڕۆژ دواکەوتوو'],
  bk_preview__one: ['معاينة: حركة واحدة، المجموع {s}', 'Preview: {n} line, net {s}', 'پێشبینین: {n} جووڵە، کۆ {s}'],
  bk_skipped__one: ['تم تجاهل صف واحد غير صالح', '{n} row skipped (no valid date or amount)', '{n} ڕیز پشتگوێ خرا'],
  bk_matchedN__one: ['طوبقت حركة واحدة', '{n} line matched', '{n} جووڵە هاوتا کرا'],
  ex_daysAgo__one: ['منذ يوم واحد', '{n} day ago', 'پێش {n} ڕۆژ'],
  br_invoicesCount__one: ['فاتورة واحدة', '{n} invoice', '{n} پسوولە'],
  br_cashAccounts__one: ['في حساب واحد', 'in {n} account', 'لە {n} هەژماردا'],
  br_owesSince__one: ['مدين منذ يوم واحد', 'owing for {n} day', '{n} ڕۆژە قەرزارە'],
  br_lateDays__one: ['متأخر يوماً واحداً', '{n} day late', '{n} ڕۆژ دواکەوتووە'],
  br_waitingApprovals__one: ['سند واحد بانتظار التدقيق أو المصادقة', '{n} voucher waiting to be checked or approved', '{n} سەنەد چاوەڕێی وردبینی یان پەسەندکردنە'],
  br_days__one: ['يوم واحد', '{n} day', '{n} ڕۆژ'],
  ro_count__one: ['مادة واحدة عند حدها الأدنى أو تحته', '{n} item at or below its minimum', '{n} کاڵا گەیشتووەتە کەمترین بڕی خۆی یان لەوە کەمترە'],
  so_err_too_many_attempts__one: ['محاولات كثيرة؛ أعد المحاولة بعد ثانية واحدة.', 'Too many tries; try again in {s} second.', 'هەوڵی زۆر؛ دوای {s} چرکە دووبارە هەوڵ بدەوە.'],
  rn_days__one: ['ينتهي ترخيصك بعد يوم واحد.', 'Your licence ends in {n} day.', 'مۆڵەتی بەرنامەکەت {n} ڕۆژی تر کۆتایی دێت.'],
  rn_grace__one: [
    'انتهى ترخيصك؛ يبقى يعمل يوماً واحداً آخر، ثم تعود الشركة إلى الخطة المجانية (تبقى البيانات كما هي).',
    'Your licence has ended; it keeps working for {n} more day, then the company goes back to Free (the data stays as it is).',
    'مۆڵەتی بەرنامەکەت کۆتایی هات؛ {n} ڕۆژی تر هەر کار دەکات، پاشان کۆمپانیاکە دەگەڕێتەوە بۆ پلانی بەخۆڕایی (داتاکان وەک خۆیان دەمێننەوە).'
  ],
  co_limit__one: ['خطتك تسمح بشركة واحدة.', 'Your plan allows {n} company.', 'پلانەکەت ڕێگە بە {n} کۆمپانیا دەدات.'],
  dc_returnsCount__one: ['مرتجع واحد', '{n} return', '{n} گەڕاوە'],
  dc_lowStockCount__one: ['مادة واحدة عند حد إعادة الطلب أو نفدت', '{n} item at its reorder level or out', '{n} کاڵا گەیشتووەتە سنووری داواکردنەوە یان نەماوە'],
  ew_tileBilled__one: ['عمل واحد مفوتر', '{n} job billed', '{n} کاری پسوولەکراو'],
  ew_validity__one: ['هذا العرض صالح لمدة يوم واحد من تاريخه.', 'This quotation is valid for {n} day from its date.', 'ئەم عەرزی نرخە بۆ ماوەی {n} ڕۆژ لە بەروارەکەیەوە کاری پێدەکرێت.'],
  ew_lateDays__one: ['متأخر يوماً واحداً', '{n} day late', '{n} ڕۆژ دواکەوتووە'],
  gen_tileOwing__one: ['مشترك واحد مدين', '{n} subscriber owes', '{n} بەشداربوو قەرزارە'],
  gen_monthsN__one: ['شهر واحد', '{n} month', '{n} مانگ'],
  gen_addedN__one: ['أُضيف مشترك واحد', '{n} subscriber added', '{n} بەشداربوو زیادکرا'],
  gen_subscribersN__one: ['مشترك واحد', '{n} subscriber', '{n} بەشداربوو'],
  gen_cutOffTitle__one: ['قائمة القطع — متأخر شهراً واحداً أو أكثر', 'Cut-off list — owing {n} month or more', 'لیستی بڕین — {n} مانگ یان زیاتر قەرزار'],
  gen_debtsTotal__one: ['مشترك واحد · {a}', '{n} subscriber · {a}', '{n} بەشداربوو · {a}'],
  gen_waText__one: [
    'السلام عليكم {n}، نود تذكيركم بأن عليكم لمولدة {c} مبلغ {a} (شهر واحد). نرجو التسديد للجابي. شكراً لكم.',
    'Hello {n}, a reminder that you owe {a} ({m} month) to {c} generator. Please pay the collector. Thank you.',
    'سڵاو {n}، بیرخستنەوەیەک: {a} ({m} مانگ) قەرزی مۆلیدەی {c} لەسەرتە. تکایە بیدە بە کۆکەرەوەکە. سوپاس.'
  ],
  lb_total__one: ['ملصق واحد', '{n} label', '{n} لێبڵ'],
  ly_points__one: ['نقطة واحدة', '{n} point', '{n} خاڵ'],
  ly_available__one: ['لدى الزبون نقطة واحدة (تساوي {v})', 'The customer has {n} point (worth {v})', 'کڕیار {n} خاڵی هەیە (بەهای {v})'],
  ly_example__one: [
    'مثال: بيع بـ {a} يكسب نقطة واحدة، وتساوي {v} عند استعمالها.',
    'Example: a sale of {a} earns {p} point, worth {v} when used.',
    'نموونە: فرۆشتنێکی {a} {p} خاڵ بەدەست دەهێنێت، کە لە کاتی بەکارهێناندا دەکاتە {v}.'
  ],
  ly_expiring__one: ['نقطة واحدة تنتهي في {d}', '{p} point lapses on {d}', '{p} خاڵ لە {d} بەسەردەچێت'],
  md_andMore__one: ['وصف واحد آخر', 'and {n} more row', 'و {n} ڕیزی تر'],
  md_rowsN__one: ['صف واحد', '{n} row', '{n} ڕیز'],
  mob_registered__one: ['سُجّل جهاز واحد', '{n} phone registered', '{n} مۆبایل تۆمار کرا'],
  mob_assigned__one: ['رُبط جهاز واحد بالفاتورة', '{n} phone named on the invoice', '{n} مۆبایل بە پسوولەکەوە بەسترا'],
  ob_bannerOffline__one: ['غير متصل — {n} بانتظار الإرسال', 'Offline — {n} waiting to send', 'بێ پەیوەندی — {n} چاوەڕێی ناردنە'],
  ob_bannerSending__one: ['يجري إرسال {n} كانت بانتظار الاتصال…', 'Sending {n} that waited for the link…', 'ناردنی {n} کە چاوەڕێی پەیوەندی بوو…'],
  ob_bannerWaiting__one: ['{n} بانتظار الإرسال على هذا الحاسوب', '{n} waiting to send on this PC', '{n} لەسەر ئەم کۆمپیوتەرە چاوەڕێی ناردنە'],
  ob_bannerRefused__one: ['{n} لم يقبلها الخادم وتحتاج إلى من يراجعها', '{n} not accepted by the server and needs a person', 'سێرڤەر {n} دانەی وەرنەگرتووە و پێویستە کەسێک سەیری بکات'],
  pos_closeWaiting__one: [
    'عملية بيع واحدة من هذه الوردية ما زالت على هذا الحاسوب. أرسلها أو راجع قائمة الانتظار قبل الإغلاق، ليكون النقد المتوقع صحيحاً.',
    '{n} sale of this shift is still on this PC. Send it or check the waiting list before closing, so the expected cash is right.',
    '{n} فرۆشتنی ئەم شەفتە هێشتا لەسەر ئەم کۆمپیوتەرەیە. پێش داخستن بینێرە یان لیستی چاوەڕوانی ببینە، تا پارەی چاوەڕوانکراو دروست بێت.'
  ],
  pay_employeesCount__one: ['موظف واحد', '{n} employee', '{n} کارمەند'],
  ph_lines__one: ['مادة واحدة', '{n} item', '{n} کاڵا'],
  re_expiredCount__one: ['حجز واحد انتهى موعده', '{n} reservation past its date', '{n} گرتن کاتەکەی بەسەرچووە'],
  re_willMake__one: ['ستُنشأ وحدة واحدة.', '{n} unit will be made.', '{n} یەکە دروست دەکرێت.'],
  re_unitsAdded__one: ['أُضيفت وحدة واحدة', '{n} unit added', '{n} یەکە زیادکرا'],
  re_unitsN__one: ['وحدة واحدة', '{n} unit', '{n} یەکە'],
  adj_countResumed__one: [
    'هذا جرد محفوظ لهذا المخزن (مادة واحدة)، آخر تعديل عليه من {who} في {when}. تابع من حيث توقفت.',
    'This warehouse has a saved count ({n} item), last changed by {who} on {when}. Carry on where it stopped.',
    'ئەم کۆگایە جەردێکی پاشەکەوتکراوی هەیە ({n} کاڵا)، دوایین گۆڕانکاری لەلایەن {who} لە {when}. لەو شوێنەوە بەردەوام بە کە وەستا.'
  ],
  sl_tileSystems__one: ['منظومة واحدة مباعة', '{n} system sold', '{n} سیستەم فرۆشراوە'],
  sl_sysPanels__one: ['لوح واحد', '{n} panel', '{n} پانێڵ'],
  sl_sysUnits__one: ['جهاز واحد', '{n} unit', '{n} دانە'],
  sl_sysUsable__one: ['{kwh} kWh قابلة للاستخدام · بطارية واحدة', '{kwh} kWh usable · {n} battery', '{kwh} kWh بۆ بەکارهێنان · {n} باتری'],
  sl_pending__one: ['بانتظار البيع · ضمان شهر واحد', 'Waiting for the sale · {m} month’s warranty', 'چاوەڕێی فرۆشتن · گەرەنتی {m} مانگ'],
  sl_serialsCount__one: ['رقم واحد', '{n} number', '{n} ژمارە'],
  sl_everyN__one: ['كل شهر', 'Every month', 'هەموو مانگێک'],
  cat_updated__one: ['تغيّر تصنيف مادة واحدة', '{n} item moved', 'پۆلی {n} کاڵا گۆڕا'],
  chq_lateDays__one: ['متأخر يوماً واحداً', '{n} day late', '{n} ڕۆژ دواکەوتوو']
} as const satisfies Record<`${string}__one`, readonly [string, string, string]>;

/** Arabic's dual: the form for exactly two, by the key of the text's many form. */
export const AR_DUAL: Readonly<Record<string, string>> = {
  err_plan_user_limit: 'خطة هذه الشركة تسمح بمستخدمَين، وعدد المستخدمين الفعّالين أكثر. اطلب من المدير إيقاف مستخدمين آخرين ليبقى مكان لك، أو ترقية الخطة.',
  usersOverLimit: 'خطتك تسمح بمستخدمَين، وعندك {m} فعّالين. لا يستطيع الدخول إلا المدراء أولاً ثم الأقدم إنشاءً، حتى {k}. الباقون (عليهم علامة «فوق حد الخطة») لا يدخلون إلى أن توقف مستخدمين آخرين أو ترقّي الخطة. لا يُحذف شيء.',
  trialEnds: 'تنتهي التجربة في {d} — بقي يومان.',
  nudgeText: 'رحّلت فاتورتَي مبيعات هذا الشهر. Pro يضيف فريق عمل على شبكة المكتب والتقسيط والرواتب والنسخ الاحتياطي.',
  bkCopies: 'نسختان',
  bl_unfinished_entries: 'سندان أو قيدان لم يُصادقا بعد: صادِقهما أو احذفهما.',
  bl_unfinished_documents: 'فاتورتان أو مستندان لا يزالان مسودة: رحّلهما أو احذفهما.',
  dbHasCompany: 'في قاعدة البيانات هذه شركة: {name} (قيدان). يمكن لهذا الحاسوب العمل عليها؛ ويُحفظ ملف الشركة على هذا الحاسوب جانباً ولا يُدمج معها.',
  lateDays: 'متأخر يومين',
  adj_applied: 'تمت قراءة سطرين.',
  adj_countedSummary: 'مادتان معدودتان',
  adj_diffSummary: 'فرقان',
  fa_lifeYears: 'سنتان',
  fa_months: 'شهران',
  bk_countCheques: 'صكّان',
  bk_daysLeft: 'بعد يومين',
  bk_daysLate: 'متأخر يومين',
  bk_preview: 'معاينة: حركتان، المجموع {s}',
  bk_skipped: 'تم تجاهل صفّين غير صالحين',
  bk_matchedN: 'طوبقت حركتان',
  ex_daysAgo: 'منذ يومين',
  br_invoicesCount: 'فاتورتان',
  br_cashAccounts: 'في حسابين',
  br_owesSince: 'مدين منذ يومين',
  br_lateDays: 'متأخر يومين',
  br_waitingApprovals: 'سندان بانتظار التدقيق أو المصادقة',
  br_days: 'يومان',
  ro_count: 'مادتان عند حدهما الأدنى أو تحته',
  so_err_too_many_attempts: 'محاولات كثيرة؛ أعد المحاولة بعد ثانيتين.',
  rn_days: 'ينتهي ترخيصك بعد يومين.',
  rn_grace: 'انتهى ترخيصك؛ يبقى يعمل يومين آخرين، ثم تعود الشركة إلى الخطة المجانية (تبقى البيانات كما هي).',
  co_limit: 'خطتك تسمح بشركتين.',
  dc_returnsCount: 'مرتجعان',
  dc_lowStockCount: 'مادتان عند حد إعادة الطلب أو نفدتا',
  ew_tileBilled: 'عملان مفوتران',
  ew_validity: 'هذا العرض صالح لمدة يومين من تاريخه.',
  ew_lateDays: 'متأخر يومين',
  gen_tileOwing: 'مشتركان مدينان',
  gen_monthsN: 'شهران',
  gen_addedN: 'أُضيف مشتركان',
  gen_subscribersN: 'مشتركان',
  gen_cutOffTitle: 'قائمة القطع — متأخر شهرين أو أكثر',
  gen_debtsTotal: 'مشتركان · {a}',
  gen_waText: 'السلام عليكم {n}، نود تذكيركم بأن عليكم لمولدة {c} مبلغ {a} (شهران). نرجو التسديد للجابي. شكراً لكم.',
  lb_total: 'ملصقان',
  ly_points: 'نقطتان',
  ly_available: 'لدى الزبون نقطتان (تساويان {v})',
  ly_example: 'مثال: بيع بـ {a} يكسب نقطتين، وتساويان {v} عند استعمالهما.',
  ly_expiring: 'نقطتان تنتهيان في {d}',
  md_andMore: 'وصفّان آخران',
  md_rowsN: 'صفّان',
  mob_registered: 'سُجّل جهازان',
  mob_assigned: 'رُبط جهازان بالفاتورة',
  pos_closeWaiting: 'عمليتا بيع من هذه الوردية ما زالتا على هذا الحاسوب. أرسلهما أو راجع قائمة الانتظار قبل الإغلاق، ليكون النقد المتوقع صحيحاً.',
  pay_employeesCount: 'موظفان',
  ph_lines: 'مادتان',
  re_expiredCount: 'حجزان انتهى موعدهما',
  re_willMake: 'ستُنشأ وحدتان.',
  re_unitsAdded: 'أُضيفت وحدتان',
  re_unitsN: 'وحدتان',
  adj_countResumed: 'هذا جرد محفوظ لهذا المخزن (مادتان)، آخر تعديل عليه من {who} في {when}. تابع من حيث توقفت.',
  sl_tileSystems: 'منظومتان مباعتان',
  sl_sysPanels: 'لوحان',
  sl_sysUnits: 'جهازان',
  sl_sysUsable: '{kwh} kWh قابلة للاستخدام · بطاريتان',
  sl_pending: 'بانتظار البيع · ضمان شهرين',
  sl_serialsCount: 'رقمان',
  sl_everyN: 'كل شهرين',
  cat_updated: 'تغيّر تصنيف مادتين',
  chq_lateDays: 'متأخر يومين'
};

/** The placeholder that holds the count, where it is not `{n}` (in gen_waText `{n}` is the subscriber's name). */
export const COUNT_VAR: Readonly<Record<string, string>> = {
  so_err_too_many_attempts: 's',
  gen_waText: 'm',
  ly_example: 'p',
  ly_expiring: 'p',
  sl_pending: 'm'
};

/** A count from a placeholder's value: a number, or digits as a screen shows them (Eastern digits, separators, isolates). */
export function countOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const western = value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s,٬⁦-⁩‎‏]/g, '');
  return /^\d+$/.test(western) ? Number(western) : undefined;
}
