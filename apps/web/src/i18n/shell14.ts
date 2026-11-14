/**
 * 1.4, the shell: what customers owe at a glance, where the data is (this PC or the office PC), the question at
 * closing, the printers of this computer, and the dollar rate at the top of the window. Arabic, English and Kurdish
 * (Sorani), in that order, like i18n.ts.
 */
export const SHELL14_TEXT = {
  // ——— Customers and Suppliers: who owes whom, in plain words ———
  s14_oweCustomer: ['لنا على الزبائن', 'Customers owe us', 'کڕیاران قەرزارمانن'],
  s14_oweCustomerAdv: ['للزبائن علينا (دفعات مقدّمة)', 'We owe customers (paid ahead)', 'قەرزاری کڕیارانین (پارەی پێشەکی)'],
  s14_oweSupplier: ['للمجهزين علينا', 'We owe suppliers', 'قەرزاری دابینکەرانین'],
  s14_oweSupplierAdv: ['لنا على المجهزين (دفعات مقدّمة)', 'Suppliers owe us (paid ahead)', 'دابینکەران قەرزارمانن (پارەی پێشەکی)'],
  s14_owingCustomers: ['عدد الزبائن المدينين: {n}', 'Customers who owe: {n}', 'ژمارەی کڕیارە قەرزارەکان: {n}'],
  s14_owingSuppliers: ['عدد المجهزين الذين لهم علينا: {n}', 'Suppliers we owe: {n}', 'ژمارەی ئەو دابینکەرانەی قەرزاریانین: {n}'],
  s14_nothingCustomer: ['لا ديون لنا على الزبائن.', 'No customer owes us anything.', 'هیچ کڕیارێک قەرزارمان نییە.'],
  s14_nothingSupplier: ['لا ديون علينا للمجهزين.', 'We owe no supplier anything.', 'قەرزاری هیچ دابینکەرێک نین.'],
  s14_owesUs: ['عليه لنا', 'Owes us', 'قەرزارمانە'],
  s14_weOwe: ['له علينا', 'We owe them', 'قەرزاری ئەوین'],
  s14_settled: ['لا رصيد', 'Nothing owed', 'بێ قەرز'],
  s14_onlyOwingCustomers: ['المدينون فقط', 'Only those who owe', 'تەنها قەرزارەکان'],
  s14_onlyOwingSuppliers: ['من لهم علينا فقط', 'Only those we owe', 'تەنها ئەوانەی قەرزاریانین'],
  s14_show: ['العرض', 'Show', 'پیشاندان'],
  s14_sort: ['الترتيب', 'Sort', 'ڕیزکردن'],
  s14_sortCode: ['حسب الرمز', 'By code', 'بەپێی کۆد'],
  s14_sortDebt: ['الأكبر ديناً أولاً', 'Biggest debt first', 'زۆرترین قەرز لە پێشەوە'],
  s14_noneOwing: ['لا أحد عليه دين الآن.', 'Nobody here owes anything right now.', 'ئێستا کەس قەرزار نییە.'],
  s14_totalAtRates: [
    'المجموع بالدينار بأسعار الدفاتر (الدولار محوَّلاً)',
    'Total in IQD at the book rates (dollars converted)',
    'کۆ بە دینار بە نرخەکانی دەفتەر (دۆلار کراوە بە دینار)'
  ],

  // ——— where the data is ———
  s14_dataOffice: ['البيانات على حاسوب المكتب {h}', 'Data is on the office PC {h}', 'داتا لەسەر کۆمپیوتەری نووسینگەیە: {h}'],
  s14_dataOfficeNoName: ['البيانات على حاسوب المكتب', 'Data is on the office PC', 'داتا لەسەر کۆمپیوتەری نووسینگەیە'],
  s14_officeDown: ['تعذّر الوصول إلى حاسوب المكتب {h}', 'The office PC {h} can’t be reached', 'ناگەیتە کۆمپیوتەری نووسینگە {h}'],
  s14_whereData: ['مكان البيانات', 'Where the data is', 'شوێنی داتا'],
  s14_bkClient: [
    'بيانات الشركة على حاسوب المكتب {h}، وليست على هذا الحاسوب. النسخ الاحتياطية تُصنع وتُحفظ على ذلك الحاسوب: افتح الإعدادات ← النسخ الاحتياطية هناك. لا توجد على هذا الحاسوب أي نسخة من الدفاتر، فنسخ ملفات هذا الحاسوب لا يحميها.',
    'The company’s data is on the office PC {h}, not on this PC. Backups are made and kept on that PC: open Settings → Backups there. Nothing on this PC is a copy of the books, so backing up this PC’s files does not protect them.',
    'داتای کۆمپانیا لەسەر کۆمپیوتەری نووسینگەیە {h}، نەک لەسەر ئەم کۆمپیوتەرە. باکئەپەکان لەسەر ئەو کۆمپیوتەرە دەکرێن و هەڵدەگیرێن: لەوێ ڕێکخستنەکان ← باکئەپەکان بکەرەوە. هیچ کۆپییەکی دەفتەرەکان لەسەر ئەم کۆمپیوتەرە نییە، بۆیە کۆپیکردنی فایلەکانی ئەم کۆمپیوتەرە نایانپارێزێت.'
  ],
  s14_netClient: [
    'هذا الحاسوب متصل بحاسوب المكتب {h} ويعمل على ملف شركته. للاتصال بحاسوب مكتب آخر، أو للعودة إلى ملف الشركة الخاص بهذا الحاسوب، استعمل قائمة «ملف».',
    'This PC is connected to the office PC {h} and works on its company file. To connect to another office PC, or to go back to this PC’s own company file, use the File menu.',
    'ئەم کۆمپیوتەرە بە کۆمپیوتەری نووسینگە {h} بەستراوە و لەسەر فایلی کۆمپانیای ئەو کار دەکات. بۆ پەیوەستبوون بە کۆمپیوتەرێکی تری نووسینگە، یان گەڕانەوە بۆ فایلی کۆمپانیای خودی ئەم کۆمپیوتەرە، لیستی «فایل» بەکاربهێنە.'
  ],
  // the same card in a browser on the office network: no File menu there, and no company file of its own
  s14_netBrowser: [
    'هذا المتصفح يعمل على ملف شركة حاسوب المكتب {h}.',
    'This browser works on the company file of the office PC {h}.',
    'ئەم وێبگەڕە لەسەر فایلی کۆمپانیای کۆمپیوتەری نووسینگە {h} کار دەکات.'
  ],
  s14_netClientSettings: [
    'إعدادات شبكة المكتب وQasa Relay وقاعدة البيانات تُغيَّر على حاسوب المكتب نفسه.',
    'The office network, Qasa Relay and the database are set up on the office PC itself.',
    'تۆڕی نووسینگە، Qasa Relay و بنکەدراوە لەسەر خودی کۆمپیوتەری نووسینگە ڕێکدەخرێن.'
  ],

  // ——— Settings → Backups: the question at closing ———
  s14_closeAsk: ['اسألني عن نسخة احتياطية عند إغلاق قاصة ERP', 'Ask to back up when I close Qasa ERP', 'کاتێک قاسە ERP دادەخەم دەربارەی باکئەپ لێم بپرسە'],
  s14_closeAskHelp: [
    'إذا تغيّرت الدفاتر ولم تُحفظ نسخة بعد ذلك (ولا اليوم)، يسألك البرنامج عند الإغلاق: احفظ نسخة وأغلق، أو أغلق دون نسخة، أو إلغاء. إذا فشلت النسخة يُعرض السبب ويبقى الإغلاق ممكناً دائماً. مع تشغيل «نسخة احتياطية عند إغلاق قاصة ERP» تُحفظ النسخة دون سؤال.',
    'When the books changed and no backup was made since (nor today), closing asks first: back up and close, close without a backup, or cancel. If the backup fails, it says why and you can still close. With “Back up when I close Qasa ERP” on, the backup is made without asking.',
    'کاتێک دەفتەرەکان گۆڕابن و لەو کاتەوە (یان ئەمڕۆ) باکئەپ نەکرابێت، لە داخستندا سەرەتا دەپرسێت: باکئەپ بکە و دایبخە، بەبێ باکئەپ دایبخە، یان پاشگەزبوونەوە. ئەگەر باکئەپ سەرنەکەوت، هۆکارەکەی دەڵێت و هەر دەتوانیت دایبخەیت. کاتێک «باکئەپ کاتێک قاسە ERP دادەخەم» هەڵکراوە، باکئەپ بەبێ پرسیار دەکرێت.'
  ],
  s14_closeAskNotSaved: ['تعذّر حفظ هذا الإعداد.', 'This setting could not be saved.', 'ئەم ڕێکخستنە پاشەکەوت نەکرا.'],

  // ——— Settings → Printers ———
  s14_prnInstalled: ['طابعات هذا الحاسوب', 'Printers on this computer', 'چاپکەرەکانی ئەم کۆمپیوتەرە'],
  s14_prnDefault: ['الافتراضية في ويندوز', 'Windows default', 'بنەڕەتیی ویندۆز'],
  s14_prnReady: ['جاهزة', 'Ready', 'ئامادەیە'],
  s14_prnOffline: ['غير متصلة', 'Offline', 'پەیوەست نییە'],
  s14_prnGuess_receipt80: ['طابعة إيصالات 80 مم', '80 mm receipt printer', 'چاپکەری وەسڵی 80 ملم'],
  s14_prnGuess_receipt58: ['طابعة إيصالات 58 مم', '58 mm receipt printer', 'چاپکەری وەسڵی 58 ملم'],
  s14_prnGuess_label: ['طابعة ملصقات', 'Label printer', 'چاپکەری لێبڵ'],
  s14_prnGuess_page: ['طابعة A4', 'A4 printer', 'چاپکەری A4'],
  s14_prnGuess_file: ['تحفظ ملفاً (لا تطبع ورقاً)', 'Saves a file (no paper)', 'فایل پاشەکەوت دەکات (نەک کاغەز)'],
  s14_prnLooksLike: ['تبدو: {g}', 'Looks like: {g}', 'وا دەردەکەوێت: {g}'],
  s14_prnSuggestHelp: [
    'عرف قاصة ERP الطابعة الافتراضية في ويندوز، وخمّن نوع كل طابعة من اسمها وورقها. هذه اقتراحات فقط: راجعها ثم اطبع صفحة تجربة.',
    'Qasa ERP found the Windows default printer and guessed each printer’s kind from its name and paper. These are suggestions only: check them, then print a test page.',
    'قاسە ERP چاپکەری بنەڕەتیی ویندۆزی دۆزییەوە و جۆری هەر چاپکەرێکی لە ناو و کاغەزەکەیەوە مەزەندە کرد. ئەمانە تەنها پێشنیارن: سەیریان بکە، پاشان پەڕەیەکی تاقیکردنەوە چاپ بکە.'
  ],
  s14_prnSuggested: ['المقترحة: {p}', 'Suggested: {p}', 'پێشنیارکراو: {p}'],
  s14_prnUse: ['استعملها', 'Use it', 'بەکاری بهێنە'],
  s14_prnUseAll: ['استعمل الطابعات المقترحة لما لم يُحدَّد', 'Use the suggested printers where none is chosen', 'چاپکەرە پێشنیارکراوەکان بەکاربهێنە بۆ ئەوانەی دیاری نەکراون'],
  s14_prnGoneDefault: [
    'الطابعة {p} لم تعد على هذا الحاسوب. إلى أن تختار غيرها تُطبع هذه الورقة على الطابعة الافتراضية في ويندوز ({d}).',
    'The printer {p} is no longer on this computer. Until you choose another, this paper prints on the Windows default printer ({d}).',
    'چاپکەری {p} چیتر لەسەر ئەم کۆمپیوتەرە نییە. تا یەکێکی تر هەڵدەبژێریت، ئەم پەڕەیە لەسەر چاپکەری بنەڕەتیی ویندۆز ({d}) چاپ دەکرێت.'
  ],
  s14_prnOfflineNote: ['{p} غير متصلة الآن في ويندوز.', '{p} is offline in Windows now.', '{p} ئێستا لە ویندۆزدا پەیوەست نییە.'],
  s14_prn_n_fallback: [
    'الطابعة المختارة لهذه الورقة ({p}) غير موجودة الآن، فطُبعت على الطابعة الافتراضية في ويندوز ({d}). اختر طابعة أخرى من الإعدادات ← الطابعات.',
    'The printer chosen for this paper ({p}) isn’t on this computer now, so it was printed on the Windows default printer ({d}). Choose another in Settings → Printers.',
    'ئەو چاپکەرەی بۆ ئەم پەڕەیە هەڵبژێردراوە ({p}) ئێستا لەسەر ئەم کۆمپیوتەرە نییە، بۆیە لەسەر چاپکەری بنەڕەتیی ویندۆز ({d}) چاپ کرا. لە ڕێکخستنەکان ← چاپکەرەکان یەکێکی تر هەڵبژێرە.'
  ],

  // ——— the dollar rate at the top of the window ({one} and {hundred} come with their sign: "$1", "١") ———
  s14_rate: ['{one} دولار = {r} دينار', '{one} = {r} IQD', '{one} دۆلار = {r} دینار'],
  s14_rateTitle: [
    'سعر الدولار ليوم {d}: كل {hundred} دولار = {r} دينار',
    'Dollar rate of {d}: {hundred} = {r} IQD',
    'نرخی دۆلاری ڕۆژی {d}: {hundred} دۆلار = {r} دینار'
  ],
  s14_rateUsual: [
    'سعر الشركة المعتاد (لم يُدخل سعر في لوحة الأسعار بعد): كل {hundred} دولار = {r} دينار',
    'The company’s usual rate (no rate entered on the rate board yet): {hundred} = {r} IQD',
    'نرخی ئاسایی کۆمپانیا (هێشتا هیچ نرخێک لە تابلۆی نرخەکان نەنووسراوە): {hundred} دۆلار = {r} دینار'
  ],
  s14_rateSet: ['حدّد سعر الدولار', 'Set dollar rate', 'نرخی دۆلار دابنێ']
} as const satisfies Record<string, readonly [string, string, string]>;
