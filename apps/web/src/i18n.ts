import { createContext, useContext } from 'react';
import { formatAmount, formatDate, formatInteger, LANGS, toEasternDigits, type CurrencyCode, type DigitStyle, type Lang, type Names } from '@qasa/core';

/** Every UI string in Arabic, English and Kurdish (Sorani) — in that order. */
const D = {
  appName: ['قاصة ERP', 'Qasa ERP', 'قاسە ERP'],
  tagline: ['كل دينار محسوب', 'Every dinar, counted', 'هەموو دینارێک ژمێردراوە'],
  gOverview: ['عام', 'Overview', 'گشتی'],
  home: ['الرئيسية', 'Home', 'سەرەکی'],
  gSales: ['المبيعات', 'Sales', 'فرۆشتن'],
  invoices: ['فواتير المبيعات', 'Sales invoices', 'پسوولەکانی فرۆشتن'],
  installments: ['البيع بالتقسيط', 'Installment sales', 'فرۆشتن بە قیست'],
  pipeline: ['متابعة المبيعات', 'Sales pipeline', 'بەدواداچوونی فرۆشتن'],
  gAccounting: ['الحسابات', 'Accounting', 'ژمێریاری'],
  vouchers: ['السندات والقيود', 'Vouchers & entries', 'سەنەد و تۆمارەکان'],
  accounts: ['الدليل المحاسبي', 'Chart of accounts', 'ڕێبەری هەژمارەکان'],
  trialBalance: ['ميزان المراجعة', 'Trial balance', 'تەرازووی پێداچوونەوە'],
  statement: ['كشف حساب', 'Account statement', 'کەشفی هەژمار'],
  gStock: ['المخزن', 'Inventory', 'کۆگا'],
  items: ['المواد والمخزون', 'Items & stock', 'کاڵا و کۆگا'],
  gPeople: ['الموظفون', 'People', 'کارمەندان'],
  hr: ['الموارد البشرية', 'HR', 'سەرچاوە مرۆییەکان'],
  salaries: ['الرواتب والسلف', 'Salaries & advances', 'مووچە و سولفە'],
  gSystem: ['النظام', 'System', 'سیستەم'],
  settings: ['الإعدادات', 'Settings', 'ڕێکخستنەکان'],
  soon: ['قريباً', 'Soon', 'بەم زووانە'],
  language: ['اللغة', 'Language', 'زمان'],
  digits: ['شكل الأرقام', 'Digits', 'شێوەی ژمارە'],
  localMode: ['البيانات على هذا الحاسوب', 'Data is on this PC', 'داتا لەسەر ئەم کۆمپیوتەرەیە'],
  serverDown: ['الخادم لا يعمل', 'Server is not running', 'سێرڤەر کار ناکات'],
  noCompany: ['شركتك', 'Your company', 'کۆمپانیاکەت'],

  welcome: ['أهلاً بك', 'Welcome', 'بەخێربێیت'],
  setupCompany: ['أدخل اسم شركتك من الإعدادات.', 'Enter your company name in Settings.', 'ناوی کۆمپانیاکەت لە ڕێکخستنەکان بنووسە.'],
  cashAndBanks: ['النقد والمصارف', 'Cash & banks', 'پارە و بانک'],
  waitingCheck: ['بانتظار التدقيق', 'Waiting for check', 'چاوەڕێی وردبینی'],
  waitingApproval: ['بانتظار المصادقة', 'Waiting for approval', 'چاوەڕێی پەسەندکردن'],
  postedThisMonth: ['مُرحّل هذا الشهر', 'Posted this month', 'تۆمارکراو ئەم مانگە'],
  quickActions: ['إجراءات سريعة', 'Quick actions', 'کردارە خێراکان'],
  newReceipt: ['سند قبض جديد', 'New receipt voucher', 'سەنەدی وەرگرتنی نوێ'],
  newPayment: ['سند صرف جديد', 'New payment voucher', 'سەنەدی پارەدانی نوێ'],
  newJournal: ['قيد يومية جديد', 'New journal entry', 'تۆماری ڕۆژانەی نوێ'],
  recentEntries: ['آخر السندات والقيود', 'Recent vouchers & entries', 'دوایین سەنەد و تۆمارەکان'],
  viewAll: ['عرض الكل', 'View all', 'هەمووی ببینە'],
  noEntries: ['لا توجد سندات بعد', 'No vouchers yet', 'هێشتا هیچ سەنەدێک نییە'],

  receipt: ['سند قبض', 'Receipt voucher', 'سەنەدی وەرگرتن'],
  payment: ['سند صرف', 'Payment voucher', 'سەنەدی پارەدان'],
  journal: ['قيد يومية', 'Journal entry', 'تۆماری ڕۆژانە'],
  reversal: ['قيد عكسي', 'Reversal entry', 'تۆماری پێچەوانە'],
  draft: ['مسودة', 'Draft', 'ڕەشنووس'],
  checked: ['مدقق', 'Checked', 'وردبینی کرا'],
  approved: ['مُرحّل', 'Posted', 'تۆمارکرا'],
  reversedTag: ['معكوس', 'Reversed', 'پێچەوانەکراوە'],

  all: ['الكل', 'All', 'هەموو'],
  search: ['بحث…', 'Search…', 'گەڕان…'],
  colNumber: ['الرقم', 'No.', 'ژمارە'],
  colType: ['النوع', 'Type', 'جۆر'],
  colDate: ['التاريخ', 'Date', 'بەروار'],
  colParty: ['الجهة / البيان', 'Party / description', 'لایەن / ڕوونکردنەوە'],
  colAmount: ['المبلغ', 'Amount', 'بڕ'],
  colStatus: ['الحالة', 'Status', 'دۆخ'],

  date: ['التاريخ', 'Date', 'بەروار'],
  cashAccount: ['القاصة / المصرف', 'Safe / bank', 'قاسە / بانک'],
  receivedFrom: ['استلمنا من', 'Received from', 'وەرگیرا لە'],
  paidTo: ['صُرف إلى', 'Paid to', 'درا بە'],
  forLabel: ['وذلك عن', 'For', 'بۆ'],
  description: ['البيان', 'Description', 'ڕوونکردنەوە'],
  currency: ['العملة', 'Currency', 'دراو'],
  rate: ['سعر الدولار', 'USD rate', 'نرخی دۆلار'],
  perUsd: ['دينار لكل دولار', 'IQD per dollar', 'دینار بۆ هەر دۆلارێک'],
  account: ['الحساب', 'Account', 'هەژمار'],
  amount: ['المبلغ', 'Amount', 'بڕ'],
  lineNote: ['ملاحظة', 'Note', 'تێبینی'],
  debit: ['مدين', 'Debit', 'قەرزار'],
  credit: ['دائن', 'Credit', 'قەرزدەر'],
  addLine: ['إضافة سطر', 'Add line', 'زیادکردنی ڕیز'],
  removeLine: ['حذف السطر', 'Remove line', 'سڕینەوەی ڕیز'],
  total: ['المجموع', 'Total', 'کۆ'],
  difference: ['الفرق', 'Difference', 'جیاوازی'],
  balanced: ['القيد متوازن', 'Balanced', 'هاوسەنگە'],
  inWords: ['كتابةً', 'In words', 'بە نووسین'],
  saveDraft: ['حفظ كمسودة', 'Save as draft', 'پاشەکەوت وەک ڕەشنووس'],
  cancel: ['إلغاء', 'Cancel', 'هەڵوەشاندنەوە'],
  saving: ['جارٍ الحفظ…', 'Saving…', 'پاشەکەوت دەکرێت…'],
  chooseAccount: ['اختر حساباً…', 'Choose an account…', 'هەژمارێک هەڵبژێرە…'],
  noMatch: ['لا نتائج', 'No results', 'هیچ ئەنجامێک نییە'],
  receiptItems: ['الحسابات الدائنة', 'Credited accounts', 'هەژمارە قەرزدەرەکان'],
  paymentItems: ['الحسابات المدينة', 'Debited accounts', 'هەژمارە قەرزارەکان'],
  editTitle: ['تعديل', 'Edit', 'دەستکاری'],
  iqdName: ['دينار', 'IQD', 'دینار'],
  usdName: ['دولار', 'USD', 'دۆلار'],
  iqdShort: ['د.ع', 'IQD', 'د.ع'],

  preparedBy: ['المنظم', 'Prepared by', 'ئامادەکار'],
  checkedBy: ['المدقق', 'Checked by', 'وردبین'],
  approvedBy: ['المصادق', 'Approved by', 'پەسەندکەر'],
  waiting: ['بالانتظار', 'Waiting', 'چاوەڕوان'],
  actEdit: ['تعديل', 'Edit', 'دەستکاری'],
  actDelete: ['حذف', 'Delete', 'سڕینەوە'],
  actCheck: ['تدقيق', 'Mark as checked', 'وردبینی کرا'],
  actReturn: ['إعادة للمنظم', 'Return to preparer', 'گەڕاندنەوە بۆ ئامادەکار'],
  actApprove: ['مصادقة وترحيل', 'Approve & post', 'پەسەندکردن و تۆمارکردن'],
  actReverse: ['قيد عكسي', 'Reverse', 'پێچەوانەکردنەوە'],
  print: ['طباعة', 'Print', 'چاپ'],
  confirmDelete: ['حذف هذه المسودة؟', 'Delete this draft?', 'ئەم ڕەشنووسە بسڕدرێتەوە؟'],
  reverseTitle: ['إنشاء قيد عكسي', 'Create a reversal entry', 'دروستکردنی تۆماری پێچەوانە'],
  reverseHelp: ['السند المُرحّل لا يُحذف. يُنشأ قيد معاكس بنفس المبالغ ويبقى الاثنان في الدفاتر.', 'A posted voucher is never deleted. An opposite entry with the same amounts is created, and both stay in the books.', 'سەنەدی تۆمارکراو ناسڕدرێتەوە. تۆمارێکی پێچەوانە بە هەمان بڕ دروست دەکرێت و هەردووکیان لە دەفتەرەکاندا دەمێننەوە.'],
  reversalDate: ['تاريخ القيد العكسي', 'Reversal date', 'بەرواری تۆماری پێچەوانە'],
  confirm: ['تأكيد', 'Confirm', 'دڵنیاکردنەوە'],
  reversedBy: ['عُكس بالقيد', 'Reversed by', 'پێچەوانەکرایەوە بە'],
  reverses: ['يعكس السند', 'Reverses', 'پێچەوانەی'],
  postedNote: ['هذا السند مُرحّل ولا يمكن تعديله — يُصحح بقيد عكسي فقط.', 'This voucher is posted and can’t be changed — only corrected with a reversal.', 'ئەم سەنەدە تۆمارکراوە و ناگۆڕدرێت — تەنها بە تۆماری پێچەوانە ڕاست دەکرێتەوە.'],
  exchangeRate: ['سعر الصرف', 'Exchange rate', 'نرخی ئاڵوگۆڕ'],
  iqdEquivalent: ['ما يعادل بالدينار', 'IQD equivalent', 'بەرامبەر بە دینار'],
  code: ['الرمز', 'Code', 'کۆد'],
  back: ['رجوع', 'Back', 'گەڕانەوە'],
  open: ['فتح', 'Open', 'کردنەوە'],
  number: ['الرقم', 'No.', 'ژمارە'],

  unifiedSystem: ['النظام المحاسبي الموحد — نسخة الشركات', 'Iraqi Unified Accounting System — companies version', 'سیستەمی ژمێریاریی یەکگرتووی عێراق — وەشانی کۆمپانیاکان'],
  verifyNote: ['الرموز والأسماء تحتاج مراجعة محاسب قانوني قبل الاستخدام الرسمي.', 'Codes and names should be reviewed by a licensed accountant before official use.', 'پێویستە کۆد و ناوەکان لەلایەن ژمێریاری یاسایی پێداچوونەوەیان بۆ بکرێت پێش بەکارهێنانی فەرمی.'],
  expandAll: ['توسيع الكل', 'Expand all', 'هەمووی بکەرەوە'],
  collapseAll: ['طي الكل', 'Collapse all', 'هەمووی دابخە'],
  nature: ['الطبيعة', 'Nature', 'جۆر'],
  balance: ['الرصيد', 'Balance', 'باڵانس'],
  addSub: ['حساب فرعي', 'Add sub-account', 'هەژماری لاوەکی'],
  rename: ['تعديل الاسم', 'Rename', 'گۆڕینی ناو'],
  standard: ['أساسي', 'Standard', 'بنەڕەتی'],
  newAccountTitle: ['حساب فرعي جديد تحت {p}', 'New sub-account under {p}', 'هەژماری لاوەکیی نوێ لەژێر {p}'],
  renameTitle: ['أسماء الحساب {c}', 'Names of account {c}', 'ناوەکانی هەژماری {c}'],
  nameAr: ['الاسم بالعربية', 'Name in Arabic', 'ناو بە عەرەبی'],
  nameEn: ['الاسم بالإنجليزية', 'Name in English', 'ناو بە ئینگلیزی'],
  nameKu: ['الاسم بالكردية', 'Name in Kurdish', 'ناو بە کوردی'],
  save: ['حفظ', 'Save', 'پاشەکەوت'],
  deleteAccountQ: ['حذف الحساب {c}؟', 'Delete account {c}?', 'هەژماری {c} بسڕدرێتەوە؟'],
  searchAccounts: ['ابحث بالرمز أو الاسم', 'Search by code or name', 'بە کۆد یان ناو بگەڕێ'],
  takesEntries: ['يقبل القيود', 'Takes entries', 'تۆمار وەردەگرێت'],

  from: ['من', 'From', 'لە'],
  to: ['إلى', 'To', 'تا'],
  exportExcel: ['تصدير Excel', 'Export to Excel', 'بۆ Excel'],
  movementDebit: ['حركة مدينة', 'Debit movement', 'جووڵەی قەرزار'],
  movementCredit: ['حركة دائنة', 'Credit movement', 'جووڵەی قەرزدەر'],
  balDebit: ['رصيد مدين', 'Debit balance', 'باڵانسی قەرزار'],
  balCredit: ['رصيد دائن', 'Credit balance', 'باڵانسی قەرزدەر'],
  totals: ['المجموع', 'Totals', 'کۆی گشتی'],
  notBalanced: ['غير متوازن!', 'Not balanced!', 'هاوسەنگ نییە!'],
  noData: ['لا توجد حركات مُرحّلة في هذه الفترة', 'No posted movements in this period', 'هیچ جووڵەیەکی تۆمارکراو لەم ماوەیەدا نییە'],
  opening: ['الرصيد الافتتاحي', 'Opening balance', 'باڵانسی سەرەتا'],
  closing: ['الرصيد الختامي', 'Closing balance', 'باڵانسی کۆتایی'],
  onlyPosted: ['التقارير تشمل السندات المُرحّلة فقط.', 'Reports include posted vouchers only.', 'ڕاپۆرتەکان تەنها سەنەدە تۆمارکراوەکان لەخۆدەگرن.'],
  pickAccount: ['اختر الحساب لعرض الكشف', 'Choose an account to see its statement', 'هەژمارێک هەڵبژێرە بۆ بینینی کەشفەکەی'],

  company: ['الشركة', 'Company', 'کۆمپانیا'],
  defaultRate: ['سعر الدولار الافتراضي', 'Default USD rate', 'نرخی بنەڕەتیی دۆلار'],
  fiscalStart: ['بداية السنة المالية (شهر-يوم)', 'Fiscal year starts (MM-DD)', 'سەرەتای ساڵی دارایی (مانگ-ڕۆژ)'],
  yourName: ['اسمك — يظهر على السندات', 'Your name — shown on vouchers', 'ناوت — لەسەر سەنەدەکان دەردەکەوێت'],
  saved: ['تم الحفظ', 'Saved', 'پاشەکەوت کرا'],
  periods: ['إقفال الفترات', 'Period locking', 'داخستنی ماوەکان'],
  periodsHelp: ['الشهر المقفل لا يقبل سندات جديدة أو مصادقات.', 'A locked month takes no new vouchers or approvals.', 'مانگی داخراو هیچ سەنەد و پەسەندکردنێکی نوێ وەرناگرێت.'],
  locked: ['مقفل', 'Locked', 'داخراوە'],
  lock: ['إقفال', 'Lock', 'داخستن'],
  unlock: ['فتح', 'Unlock', 'کردنەوە'],
  auditLog: ['سجل التدقيق', 'Audit log', 'تۆماری وردبینی'],
  auditHelp: ['كل تغيير يُسجل: من، ماذا، ومتى. لا يمكن حذف السجل.', 'Every change is recorded: who, what and when. The log can’t be deleted.', 'هەموو گۆڕانکارییەک تۆمار دەکرێت: کێ، چی و کەی. تۆمارەکە ناسڕدرێتەوە.'],
  a_create: ['إنشاء', 'Created', 'دروستکرا'],
  a_update: ['تعديل', 'Updated', 'گۆڕدرا'],
  a_delete: ['حذف', 'Deleted', 'سڕایەوە'],
  a_check: ['تدقيق', 'Checked', 'وردبینی کرا'],
  a_return: ['إعادة', 'Returned', 'گەڕێندرایەوە'],
  a_approve: ['مصادقة', 'Approved', 'پەسەندکرا'],
  a_reverse: ['عكس', 'Reversed', 'پێچەوانەکرایەوە'],
  a_lock: ['إقفال', 'Locked', 'داخرا'],
  a_unlock: ['فتح', 'Unlocked', 'کرایەوە'],
  a_rename: ['تعديل اسم', 'Renamed', 'ناو گۆڕدرا'],
  e_entry: ['سند', 'Voucher', 'سەنەد'],
  e_account: ['حساب', 'Account', 'هەژمار'],
  e_settings: ['الإعدادات', 'Settings', 'ڕێکخستنەکان'],
  e_period: ['فترة', 'Period', 'ماوە'],
  who: ['المستخدم', 'User', 'بەکارهێنەر'],
  when: ['الوقت', 'Time', 'کات'],
  what: ['الإجراء', 'Action', 'کردار'],

  err_date_invalid: ['التاريخ غير صحيح', 'The date is not valid', 'بەروار دروست نییە'],
  err_period_locked: ['الفترة {p} مقفلة', 'Period {p} is locked', 'ماوەی {p} داخراوە'],
  err_currency_invalid: ['العملة غير صحيحة', 'Invalid currency', 'دراو دروست نییە'],
  err_rate_invalid: ['أدخل سعر الدولار', 'Enter the USD rate', 'نرخی دۆلار بنووسە'],
  err_description_required: ['أدخل البيان', 'Enter a description', 'ڕوونکردنەوە بنووسە'],
  err_too_few_lines: ['يحتاج القيد سطرين على الأقل', 'An entry needs at least two lines', 'تۆمار پێویستی بە لانیکەم دوو ڕیز هەیە'],
  err_line_amount_invalid: ['مبلغ غير صحيح في السطر {n}', 'Invalid amount on line {n}', 'بڕی هەڵە لە ڕیزی {n}'],
  err_line_both_sides: ['السطر {n}: مدين ودائن معاً', 'Line {n}: both debit and credit', 'ڕیزی {n}: هەم قەرزار و هەم قەرزدەر'],
  err_line_zero: ['السطر {n} بدون مبلغ', 'Line {n} has no amount', 'ڕیزی {n} بڕی نییە'],
  err_account_unknown: ['الحساب {c} غير موجود', 'Account {c} does not exist', 'هەژماری {c} بوونی نییە'],
  err_account_not_postable: ['الحساب {c} رئيسي — اختر حساباً فرعياً', '{c} is a parent account — choose a sub-account', '{c} هەژمارێکی سەرەکییە — هەژمارێکی لاوەکی هەڵبژێرە'],
  err_not_balanced: ['القيد غير متوازن', 'The entry is not balanced', 'تۆمارەکە هاوسەنگ نییە'],
  err_cash_account_invalid: ['اختر قاصة أو حساباً مصرفياً (تحت 18)', 'Choose a safe or bank account (under 18)', 'قاسە یان هەژماری بانک هەڵبژێرە (لەژێر 18)'],
  err_items_required: ['أضف حساباً واحداً على الأقل', 'Add at least one account', 'لانیکەم یەک هەژمار زیاد بکە'],
  err_schema: ['بعض المعلومات ناقصة أو غير صحيحة', 'Some information is missing or wrong', 'هەندێک زانیاری کەمە یان هەڵەیە'],
  err_code_format: ['الرمز يجب أن يكون أرقاماً فقط', 'The code must be digits only', 'کۆد دەبێت تەنها ژمارە بێت'],
  err_code_exists: ['هذا الرمز مستخدم', 'This code is already used', 'ئەم کۆدە بەکارهاتووە'],
  err_parent_missing: ['الحساب الرئيسي غير موجود', 'Parent account not found', 'هەژماری سەرەکی نەدۆزرایەوە'],
  err_parent_has_entries: ['الحساب الرئيسي عليه قيود — لا يمكن تفريعه', 'The parent already has entries, so it can’t get sub-accounts', 'هەژماری سەرەکی تۆماری لەسەرە و ناتوانرێت لقی بۆ دروست بکرێت'],
  err_not_under_parent: ['الرمز يجب أن يبدأ برمز الحساب الرئيسي', 'The code must start with the parent’s code', 'کۆد دەبێت بە کۆدی هەژماری سەرەکی دەست پێبکات'],
  err_name_required: ['أدخل اسماً واحداً على الأقل', 'Enter at least one name', 'لانیکەم یەک ناو بنووسە'],
  err_account_is_standard: ['لا يمكن حذف حساب أساسي من الدليل', 'Standard accounts can’t be deleted', 'هەژماری بنەڕەتی ناسڕدرێتەوە'],
  err_account_has_children: ['للحساب حسابات فرعية', 'The account has sub-accounts', 'هەژمارەکە لقی هەیە'],
  err_account_has_entries: ['للحساب قيود', 'The account has entries', 'هەژمارەکە تۆماری لەسەرە'],
  err_action_not_allowed: ['هذا الإجراء غير مسموح الآن', 'That action isn’t allowed now', 'ئەم کردارە ئێستا ڕێگەپێدراو نییە'],
  err_posted_entry_is_permanent: ['السند المُرحّل لا يُعدّل', 'Posted vouchers can’t be changed', 'سەنەدی تۆمارکراو ناگۆڕدرێت'],
  err_not_found: ['غير موجود', 'Not found', 'نەدۆزرایەوە'],
  err_network: ['تعذر الاتصال بالخادم — هل الخادم يعمل؟', 'Can’t reach the server — is it running?', 'پەیوەندی بە سێرڤەرەوە نەکرا — ئایا کار دەکات؟'],
  err_internal: ['حدث خطأ غير متوقع', 'Something went wrong', 'هەڵەیەکی چاوەڕواننەکراو ڕوویدا']
} as const satisfies Record<string, readonly [string, string, string]>;

export type Key = keyof typeof D;

export function isKey(key: string): key is Key {
  return Object.prototype.hasOwnProperty.call(D, key);
}

export interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  digits: DigitStyle;
  setLang(lang: Lang): void;
  setDigits(d: DigitStyle): void;
  t(key: Key, vars?: Record<string, string | number>): string;
  /** Picks the name in the current language, falling back to the other two. */
  name(names: Names): string;
  money(amountMinor: number, currency: CurrencyCode): string;
  int(value: number): string;
  date(iso: string): string;
  /** Applies the digit setting to arbitrary text (codes and numbers inside sentences). */
  digitsOf(text: string): string;
}

export function makeI18n(lang: Lang, digits: DigitStyle, setLang: (l: Lang) => void, setDigits: (d: DigitStyle) => void): I18n {
  const index = LANGS.indexOf(lang);
  const eastern = digits === 'eastern' && lang !== 'en';
  const digitsOf = (text: string) => (eastern ? toEasternDigits(text) : text);
  const t = (key: Key, vars?: Record<string, string | number>) => {
    let text: string = D[key][index] ?? D[key][1];
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, digitsOf(String(v)));
    return text;
  };
  return {
    lang,
    dir: lang === 'en' ? 'ltr' : 'rtl',
    digits,
    setLang,
    setDigits,
    t,
    name: (n) => n[lang] || n.ar || n.en || n.ku,
    money: (amountMinor, currency) => {
      const text = formatAmount(amountMinor, currency, eastern ? 'eastern' : 'western');
      return currency === 'USD' ? '$' + text : text + ' ' + t('iqdShort');
    },
    int: (value) => formatInteger(value, eastern ? 'eastern' : 'western'),
    date: (iso) => digitsOf(formatDate(iso)),
    digitsOf
  };
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('I18nContext missing');
  return ctx;
}
