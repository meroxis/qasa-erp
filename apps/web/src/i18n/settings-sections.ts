/**
 * The Settings list (pages/Settings.tsx, SETTINGS_SECTIONS): the names that have no text of their own yet, and the
 * line under each name. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const SETTINGS_SECTION_TEXT = {
  ss_displayHelp: ['اللغة والأرقام والمظهر', 'Language, digits and appearance', 'زمان، ژمارەکان و ڕووکار'],
  ss_companyHelp: ['الاسم وسعر الصرف وحسابات الترحيل', 'Name, exchange rate and posting accounts', 'ناو، نرخی گۆڕینەوە و هەژمارەکانی تۆمارکردن'],
  ss_periods: ['الفترات وإقفال السنة', 'Periods and year-end', 'ماوەکان و داخستنی ساڵ'],
  ss_periodsHelp: ['إقفال الفترات وإقفال السنة وسجل التدقيق', 'Period locking, year-end closing and the audit log', 'داخستنی ماوەکان، داخستنی ساڵ و تۆماری وردبینی'],
  ss_sales: ['المبيعات ونقطة البيع', 'Sales and point of sale', 'فرۆشتن و خاڵی فرۆشتن'],
  ss_loyaltyHelp: ['نقاط يكسبها الزبائن على مشترياتهم', 'Points customers earn on what they buy', 'ئەو خاڵانەی کڕیاران لەسەر کڕینەکانیان وەریدەگرن'],
  ss_printersHelp: ['طابعة وورق لكل نوع من الأوراق', 'A printer and paper for each kind of paper', 'چاپکەر و پەڕە بۆ هەر جۆرە پەڕەیەک'],
  ss_backupsHelp: ['النسخ التلقائية والاستعادة والنسخ السحابي', 'Automatic copies, restore and cloud backup', 'باکئەپی خۆکار، گەڕاندنەوە و باکئەپی هەوری'],
  ss_networkHelp: ['الحواسيب الأخرى وQasa Relay والهواتف وقاعدة البيانات', 'Other PCs, Qasa Relay, phones and the database', 'کۆمپیوتەرەکانی تر، Qasa Relay، مۆبایلەکان و داتابەیس'],
  ss_companiesHelp: ['الشركات الأخرى على هذا الحاسوب والبدء من جديد', 'Other companies on this PC, and starting over', 'کۆمپانیاکانی تر لەسەر ئەم کۆمپیوتەرە و دەستپێکردنەوە'],
  ss_usersHelp: ['من يسجّل الدخول وما يستطيعه كلٌّ منهم', 'Who signs in and what each one can do', 'کێ دەچێتە ژوورەوە و هەریەکەیان چی دەتوانێت'],
  ss_usageHelp: ['أرقام مجهولة تساعد على تحسين قاصة ERP', 'Anonymous counts that help improve Qasa ERP', 'ژمارەی بێناو کە یارمەتی باشترکردنی قاسە ERP دەدەن'],
  ss_updates: ['التحديثات', 'Updates', 'نوێکردنەوەکان'],
  ss_updatesHelp: ['الإصدارات الجديدة من قاصة ERP', 'New versions of Qasa ERP', 'وەشانە نوێیەکانی قاسە ERP'],
  ss_about: ['المساعدة وحول البرنامج', 'Help and About', 'یارمەتی و دەربارە'],
  ss_aboutHelp: ['الدعم والدعم عن بُعد وما الجديد والشروط', 'Support, remote support, what’s new and legal', 'پشتگیری، پشتگیری لە دوورەوە، چی نوێیە و یاسایی']
} as const satisfies Record<string, readonly [string, string, string]>;
