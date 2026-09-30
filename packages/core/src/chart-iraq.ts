import type { Names } from './lang.ts';

export interface AccountSeed {
  code: string;
  name: Names;
}

/**
 * Iraqi Unified Accounting System — companies version (النظام المحاسبي الموحد).
 * Top levels 1–4 and the 2- and 3-digit accounts below are the standard guide.
 * Companies add their own sub-accounts underneath (e.g. 1811 "Main safe — Erbil").
 *
 * IMPORTANT: codes and names must be reviewed by a licensed Iraqi accountant
 * (محاسب قانوني) before release; they are editable in the app.
 */
export const IRAQI_UNIFIED_CHART: AccountSeed[] = [
  { code: '1', name: { ar: 'الموجودات', en: 'Assets', ku: 'سامانەکان' } },
  { code: '11', name: { ar: 'الموجودات الثابتة', en: 'Fixed assets', ku: 'سامانە جێگیرەکان' } },
  { code: '111', name: { ar: 'الأراضي', en: 'Land', ku: 'زەوی' } },
  { code: '112', name: { ar: 'المباني والمنشآت والطرق', en: 'Buildings, structures & roads', ku: 'بینا و دامەزراوە و ڕێگاوبان' } },
  { code: '113', name: { ar: 'الآلات والمعدات', en: 'Machinery & equipment', ku: 'ئامێر و کەرەستە' } },
  { code: '114', name: { ar: 'وسائل النقل والانتقال', en: 'Vehicles', ku: 'ئامرازەکانی گواستنەوە' } },
  { code: '115', name: { ar: 'العدد والقوالب', en: 'Tools & moulds', ku: 'ئامراز و قاڵبەکان' } },
  { code: '116', name: { ar: 'الأثاث وأجهزة المكاتب', en: 'Furniture & office equipment', ku: 'کەلوپەل و ئامێری نووسینگە' } },
  { code: '12', name: { ar: 'مشروعات تحت التنفيذ', en: 'Projects in progress', ku: 'پرۆژە لەژێر جێبەجێکردن' } },
  { code: '13', name: { ar: 'المخزون', en: 'Inventory', ku: 'کۆگا' } },
  { code: '131', name: { ar: 'مخزون المواد الأولية', en: 'Raw materials', ku: 'کۆگای کەرەستەی خاو' } },
  { code: '136', name: { ar: 'مخزون الإنتاج', en: 'Production inventory', ku: 'کۆگای بەرهەم' } },
  { code: '137', name: { ar: 'مخزون بضائع بغرض البيع', en: 'Goods held for sale', ku: 'کاڵای کۆگا بۆ فرۆشتن' } },
  { code: '138', name: { ar: 'اعتمادات مستندية لشراء المواد', en: 'Letters of credit for purchases', ku: 'ئیعتیمادی بەڵگەنامەیی بۆ کڕینی کەرەستە' } },
  { code: '14', name: { ar: 'القروض الممنوحة', en: 'Loans granted', ku: 'قەرزە پێدراوەکان' } },
  { code: '15', name: { ar: 'الاستثمارات', en: 'Investments', ku: 'وەبەرهێنانەکان' } },
  { code: '16', name: { ar: 'المدينون', en: 'Debtors', ku: 'قەرزارەکان' } },
  { code: '161', name: { ar: 'العملاء', en: 'Customers', ku: 'کڕیاران' } },
  { code: '166', name: { ar: 'حسابات مدينة متنوعة', en: 'Other receivables', ku: 'هەژمارە قەرزارە جۆراوجۆرەکان' } },
  { code: '18', name: { ar: 'النقود', en: 'Cash', ku: 'پارە' } },
  { code: '181', name: { ar: 'نقدية لدى الصندوق', en: 'Cash on hand', ku: 'پارە لە قاسە' } },
  { code: '183', name: { ar: 'نقدية لدى المصارف', en: 'Cash at banks', ku: 'پارە لە بانکەکان' } },

  { code: '2', name: { ar: 'المطلوبات', en: 'Liabilities & capital', ku: 'پابەندبوونەکان' } },
  { code: '21', name: { ar: 'رأس المال', en: 'Capital', ku: 'سەرمایە' } },
  { code: '22', name: { ar: 'الاحتياطيات', en: 'Reserves', ku: 'یەدەگەکان' } },
  { code: '23', name: { ar: 'التخصيصات', en: 'Provisions', ku: 'تەرخانکراوەکان' } },
  { code: '231', name: { ar: 'مخصص الاندثار المتراكم', en: 'Accumulated depreciation', ku: 'تەرخانی داخورانی کەڵەکەبوو' } },
  { code: '24', name: { ar: 'القروض المستلمة', en: 'Loans received', ku: 'قەرزە وەرگیراوەکان' } },
  { code: '25', name: { ar: 'المصارف الدائنة', en: 'Bank overdrafts', ku: 'بانکە قەرزدەرەکان' } },
  { code: '26', name: { ar: 'الدائنون', en: 'Creditors', ku: 'قەرزدەرەکان' } },
  { code: '261', name: { ar: 'المجهزون', en: 'Suppliers', ku: 'دابینکەران' } },
  { code: '262', name: { ar: 'أوراق الدفع', en: 'Notes payable', ku: 'بەڵگەنامەکانی پارەدان' } },
  { code: '266', name: { ar: 'حسابات دائنة متنوعة', en: 'Other payables', ku: 'هەژمارە قەرزدەرە جۆراوجۆرەکان' } },
  { code: '267', name: { ar: 'استقطاعات لحساب الغير', en: 'Withholdings for others', ku: 'بڕینەکان بۆ لایەنی تر' } },

  { code: '3', name: { ar: 'الاستخدامات', en: 'Uses (expenses)', ku: 'بەکارهێنانەکان (خەرجی)' } },
  { code: '31', name: { ar: 'الرواتب والأجور', en: 'Salaries & wages', ku: 'مووچە و کرێ' } },
  { code: '32', name: { ar: 'المستلزمات السلعية', en: 'Commodity supplies', ku: 'پێداویستییە کاڵاییەکان' } },
  { code: '33', name: { ar: 'المستلزمات الخدمية', en: 'Service supplies', ku: 'پێداویستییە خزمەتگوزارییەکان' } },
  { code: '34', name: { ar: 'مقاولات وخدمات', en: 'Contracts & services', ku: 'گرێبەستکاری و خزمەتگوزاری' } },
  { code: '35', name: { ar: 'مشتريات بضائع بغرض البيع', en: 'Purchases of goods for resale', ku: 'کڕینی کاڵا بۆ فرۆشتن' } },
  { code: '36', name: { ar: 'فوائد وإيجارات الأراضي', en: 'Interest & land rent', ku: 'سوود و کرێی زەوی' } },
  { code: '37', name: { ar: 'الاندثار', en: 'Depreciation', ku: 'داخوران' } },
  { code: '38', name: { ar: 'المصروفات التحويلية', en: 'Transfer expenses', ku: 'خەرجییە گواستراوەکان' } },
  { code: '39', name: { ar: 'المصروفات الأخرى', en: 'Other expenses', ku: 'خەرجییەکانی تر' } },

  { code: '4', name: { ar: 'الموارد', en: 'Resources (revenue)', ku: 'سەرچاوەکان (داهات)' } },
  { code: '41', name: { ar: 'إيراد نشاط الإنتاج السلعي', en: 'Revenue from goods production', ku: 'داهاتی چالاکیی بەرهەمهێنانی کاڵا' } },
  { code: '42', name: { ar: 'إيراد النشاط التجاري', en: 'Trading revenue', ku: 'داهاتی چالاکیی بازرگانی' } },
  { code: '43', name: { ar: 'إيراد النشاط الخدمي', en: 'Service revenue', ku: 'داهاتی چالاکیی خزمەتگوزاری' } },
  { code: '44', name: { ar: 'إيراد التشغيل للغير', en: 'Revenue from work for others', ku: 'داهاتی کارکردن بۆ لایەنی تر' } },
  { code: '45', name: { ar: 'كلفة الموجودات المصنعة داخلياً', en: 'Cost of internally made assets', ku: 'تێچووی سامانی دروستکراو لە ناوەوە' } },
  { code: '46', name: { ar: 'فوائد وإيجارات الأراضي', en: 'Interest & land rent income', ku: 'داهاتی سوود و کرێی زەوی' } },
  { code: '47', name: { ar: 'الإعانات', en: 'Subsidies', ku: 'یارمەتییەکان' } },
  { code: '48', name: { ar: 'الإيرادات التحويلية', en: 'Transfer revenue', ku: 'داهاتە گواستراوەکان' } },
  { code: '49', name: { ar: 'الإيرادات الأخرى', en: 'Other revenue', ku: 'داهاتەکانی تر' } }
];

/**
 * Sub-accounts most companies need on day one; created by the first-run setup.
 * They sit under the standard accounts above.
 */
export const STARTER_SUB_ACCOUNTS: AccountSeed[] = [
  { code: '1811', name: { ar: 'القاصة الرئيسية', en: 'Main safe', ku: 'قاسەی سەرەکی' } },
  { code: '1831', name: { ar: 'الحساب المصرفي — دينار', en: 'Bank account — IQD', ku: 'هەژماری بانکی — دینار' } },
  { code: '1832', name: { ar: 'الحساب المصرفي — دولار', en: 'Bank account — USD', ku: 'هەژماری بانکی — دۆلار' } },
  { code: '1611', name: { ar: 'زبائن البيع الآجل', en: 'Credit customers', ku: 'کڕیارانی قەرز' } },
  { code: '1612', name: { ar: 'زبائن التقسيط', en: 'Installment customers', ku: 'کڕیارانی قیست' } },
  { code: '1661', name: { ar: 'سلف الموظفين', en: 'Employee advances', ku: 'سولفەی کارمەندان' } },
  { code: '1371', name: { ar: 'المخزن الرئيسي', en: 'Main warehouse', ku: 'کۆگای سەرەکی' } },
  { code: '2611', name: { ar: 'المجهزون المحليون', en: 'Local suppliers', ku: 'دابینکەرانی ناوخۆ' } },
  // where the year-end closing puts each year's profit or loss (to be confirmed by the company's accountant)
  { code: '229', name: { ar: 'الفائض (العجز) المتراكم', en: 'Accumulated surplus (deficit)', ku: 'زیادە (کورتهێنان)ی کەڵەکەبوو' } }
];

/**
 * Default posting accounts for invoices. Editable in settings; to be confirmed by the company's accountant.
 * sales → 42 إيراد النشاط التجاري · cost of goods sold → 35 مشتريات بضائع بغرض البيع
 */
export const DEFAULT_POSTING_ACCOUNTS = {
  customers: '1611',
  suppliers: '2611',
  sales: '42',
  costOfSales: '35',
  cash: '1811',
  /** the year-end closing moves each year's result here */
  yearResult: '229'
} as const;

export type PostingAccounts = { [K in keyof typeof DEFAULT_POSTING_ACCOUNTS]: string };
