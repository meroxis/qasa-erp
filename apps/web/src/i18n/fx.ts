/** The dollar rate board: the day's rate, its history and revaluing dollar balances. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const FX_TEXT = {
  fx_title: ['سعر الدولار', 'Dollar rate', 'نرخی دۆلار'],
  fx_help: [
    'أدخل سعر السوق كل يوم. آخر سعر يصبح السعر الافتراضي للفواتير والسندات الجديدة، والتاريخ يبقى محفوظاً.',
    'Enter the market rate each day. The newest rate becomes the default for new invoices and vouchers, and the history is kept.',
    'هەموو ڕۆژێک نرخی بازاڕ بنووسە. نوێترین نرخ دەبێتە نرخی بنەڕەت بۆ پسوولە و سەنەدە نوێیەکان، و مێژووەکەی دەمێنێتەوە.'
  ],
  fx_today: ['سعر اليوم', 'Today’s rate', 'نرخی ئەمڕۆ'],
  fx_perDollar: ['دينار لكل 100 دولار', 'dinars per $100', 'دینار بۆ هەر 100 دۆلار'],
  fx_rateInput: ['سعر 100 دولار بالدينار', 'Price of $100 in dinars', 'نرخی 100 دۆلار بە دینار'],
  fx_source: ['المصدر (اختياري)', 'Source (optional)', 'سەرچاوە (ئارەزوومەندانە)'],
  fx_sourceHint: ['مثلاً: بورصة أربيل', 'e.g. Erbil exchange', 'بۆ نموونە: بۆرسەی هەولێر'],
  fx_saveRate: ['حفظ السعر', 'Save the rate', 'پاشەکەوتکردنی نرخ'],
  fx_sameAsYesterday: ['نفس سعر آخر يوم', 'Same as the last day', 'هەمان نرخی دوایین ڕۆژ'],
  fx_noRateYet: ['لم يُدخل سعر اليوم بعد', 'No rate entered for today yet', 'هێشتا نرخی ئەمڕۆ نەنووسراوە'],
  fx_defaultRate: ['السعر الافتراضي الحالي', 'Current default rate', 'نرخی بنەڕەتی ئێستا'],
  fx_change: ['التغيّر عن السعر السابق', 'Change since the previous rate', 'گۆڕان لە نرخی پێشوو'],
  fx_history: ['السجل', 'History', 'مێژوو'],
  fx_days30: ['30 يوماً', '30 days', '30 ڕۆژ'],
  fx_days90: ['90 يوماً', '90 days', '90 ڕۆژ'],
  fx_days365: ['سنة', 'A year', 'ساڵێک'],
  fx_chart: ['سعر الدولار خلال الفترة', 'The dollar rate over the period', 'نرخی دۆلار لەم ماوەیەدا'],
  fx_noHistory: ['لا توجد أسعار في هذه الفترة.', 'No rates in this period.', 'لەم ماوەیەدا هیچ نرخێک نییە.'],
  fx_enteredBy: ['أدخله', 'Entered by', 'نووسەر'],
  fx_deleteConfirm: ['حذف سعر هذا اليوم؟', 'Delete this day’s rate?', 'نرخی ئەم ڕۆژە بسڕدرێتەوە؟'],
  fx_tabRates: ['الأسعار', 'Rates', 'نرخەکان'],
  fx_tabRevaluation: ['إعادة التقييم', 'Revaluation', 'هەڵسەنگاندنەوە'],
  fx_revalHelp: [
    'كم تساوي أرصدة الدولار (الصناديق والمصارف والزبائن والمجهزون) بالدينار بسعر اليوم، مقارنةً بقيمتها في الدفاتر. الفرق ربح أو خسارة غير محققة.',
    'What your dollar balances (safes, banks, customers, suppliers) are worth in dinars at today’s rate, against their value in the books. The difference is an unrealised gain or loss.',
    'باڵانسە دۆلارییەکانت (قاسە، بانک، کڕیار، دابینکەر) بە نرخی ئەمڕۆ چەند دینار دەکەن، بەراورد بە بەهاکەیان لە دەفتەرەکاندا. جیاوازییەکە قازانج یان زیانی نەهاتووە.'
  ],
  fx_atRate: ['بسعر', 'At the rate', 'بە نرخی'],
  fx_rateFromBoard: ['من لوحة الأسعار', 'from the rate board', 'لە تەختەی نرخەکان'],
  fx_rateDefault: ['السعر الافتراضي (لا يوجد سعر في اللوحة)', 'the default rate (none on the board)', 'نرخی بنەڕەت (هیچ نرخێک لە تەختەکەدا نییە)'],
  fx_otherRate: ['جرّب سعراً آخر', 'Try another rate', 'نرخێکی تر تاقی بکەرەوە'],
  fx_balanceUsd: ['الرصيد بالدولار', 'Dollar balance', 'باڵانس بە دۆلار'],
  fx_inBooks: ['قيمته في الدفاتر', 'Value in the books', 'بەها لە دەفتەرەکاندا'],
  fx_atToday: ['قيمته بهذا السعر', 'Value at this rate', 'بەها بەم نرخە'],
  fx_difference: ['الفرق', 'Difference', 'جیاوازی'],
  fx_mixed: ['مختلط', 'Mixed', 'تێکەڵ'],
  fx_mixedHelp: [
    'لهذا الحساب مبالغ بالدينار أيضاً (مثلاً فاتورة بالدولار دُفعت بالدينار)، فلا يُعاد تقييمه تلقائياً.',
    'This balance also has dinar amounts (a dollar invoice paid in dinars, say), so it isn’t revalued automatically.',
    'ئەم باڵانسە بڕی دیناریشی تێدایە (بۆ نموونە پسوولەیەکی دۆلاری بە دینار دراوە)، بۆیە بە خۆکاری هەڵناسەنگێنرێتەوە.'
  ],
  fx_gains: ['أرباح فروقات العملة', 'Exchange gains', 'قازانجی جیاوازیی دراو'],
  fx_losses: ['خسائر فروقات العملة', 'Exchange losses', 'زیانی جیاوازیی دراو'],
  fx_net: ['الصافي', 'Net', 'پوخت'],
  fx_nothing: ['لا توجد أرصدة بالدولار حتى هذا التاريخ.', 'No dollar balances up to this date.', 'تا ئەم بەروارە هیچ باڵانسێکی دۆلاری نییە.'],
  fx_post: ['تسجيل قيد إعادة التقييم', 'Record the revaluation entry', 'تۆمارکردنی تۆماری هەڵسەنگاندنەوە'],
  fx_postHelp: [
    'يُنشأ قيد يومية كمسودة يمر بالمنظم والمدقق والمصادق. تُعدّل الأرصدة، وتذهب الأرباح إلى حساب إيرادات أخرى والخسائر إلى حساب مصروفات أخرى. الأرصدة المختلطة لا تدخل.',
    'A journal entry is made as a draft and goes through the preparer, checker and approver. The balances are adjusted, gains go to an other-revenue account and losses to an other-expenses account. Mixed balances are left out.',
    'تۆمارێکی ڕۆژانە وەک ڕەشنووس دروست دەکرێت و بە ئامادەکار و وردبین و پەسەندکەردا تێدەپەڕێت. باڵانسەکان ڕاست دەکرێنەوە، قازانج دەچێتە هەژماری داهاتی تر و زیان دەچێتە هەژماری خەرجیی تر. باڵانسە تێکەڵەکان ناچنە ناوی.'
  ],
  fx_gainAccount: ['حساب الأرباح', 'Gains account', 'هەژماری قازانج'],
  fx_lossAccount: ['حساب الخسائر', 'Losses account', 'هەژماری زیان'],
  fx_posted: ['سُجّل القيد كمسودة', 'The entry was recorded as a draft', 'تۆمارەکە وەک ڕەشنووس تۆمار کرا'],
  fx_openEntry: ['فتح القيد', 'Open the entry', 'کردنەوەی تۆمار'],
  err_fx_date_future: ['لا يمكن إدخال سعر ليوم لم يأتِ بعد.', 'You can’t enter a rate for a day that hasn’t come yet.', 'ناتوانیت نرخ بۆ ڕۆژێک بنووسیت کە هێشتا نەهاتووە.'],
  err_fx_nothing_to_post: ['لا توجد فروقات لتسجيلها بهذا السعر.', 'There’s no difference to record at this rate.', 'بەم نرخە هیچ جیاوازییەک نییە بۆ تۆمارکردن.'],
  err_fx_account_invalid: [
    'اختر حساباً فرعياً: الأرباح تحت 4 (الموارد) والخسائر تحت 3 (الاستخدامات).',
    'Choose an account that takes entries: gains under 4 (revenue), losses under 3 (expenses).',
    'هەژمارێک هەڵبژێرە کە تۆمار وەردەگرێت: قازانج لە ژێر 4 (داهات)، زیان لە ژێر 3 (خەرجی).'
  ],
  e_fx_rate: ['سعر الصرف', 'Dollar rate', 'نرخی دۆلار'],
  a_revalue: ['إعادة تقييم', 'Revalued', 'هەڵسەنگێنرایەوە'],
  a_set: ['أُدخل', 'Entered', 'نووسرا']
} as const satisfies Record<string, readonly [string, string, string]>;
