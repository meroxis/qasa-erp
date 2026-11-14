/** Banking: safes, banks and e-wallets, transfers, cheques and bank reconciliation. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const BANK_TEXT = {
  bk_title: ['البنوك والصكوك', 'Banks & cheques', 'بانک و چەکەکان'],
  bk_tabAccounts: ['الصناديق والبنوك', 'Safes & banks', 'قاسە و بانکەکان'],
  bk_tabTransfer: ['تحويل', 'Transfer', 'گواستنەوە'],
  bk_tabCheques: ['الصكوك', 'Cheques', 'چەکەکان'],
  bk_tabReconcile: ['مطابقة كشف البنك', 'Bank reconciliation', 'هاوتاکردنی کەشفی بانک'],

  // accounts
  bk_accountsHelp: [
    'كل صندوق وحساب بنكي ومحفظة إلكترونية له حساب في الدليل تحت 18. الأرصدة من القيود المعتمدة فقط.',
    'Every safe, bank account and e-wallet is an account under 18 in the chart. Balances count approved entries only.',
    'هەر قاسە و هەژماری بانک و جزدانێکی ئەلیکترۆنی هەژمارێکی خۆی هەیە لە ژێر 18. ڕەسیدەکان تەنها قەیدە پەسەندکراوەکان دەگرنەوە.'
  ],
  bk_kind_safe: ['صندوق', 'Safe', 'قاسە'],
  bk_kind_bank: ['حساب بنكي', 'Bank account', 'هەژماری بانک'],
  bk_kind_zaincash: ['زين كاش', 'ZainCash', 'زەین کاش'],
  bk_kind_fib: ['المصرف العراقي الأول (FIB)', 'FIB', 'FIB'],
  bk_kind_qi: ['كي كارد / ماستر كي', 'Qi Card', 'کی کارد'],
  bk_kind_asiahawala: ['آسيا حوالة', 'AsiaHawala', 'ئاسیا حەواڵە'],
  bk_kind_wallet: ['محفظة أخرى', 'Other wallet', 'جزدانی تر'],
  bk_addAccount: ['إضافة بنك أو محفظة', 'Add a bank or wallet', 'زیادکردنی بانک یان جزدان'],
  bk_addAccountHelp: [
    'يُنشأ حساب جديد تحت النقدية لدى المصارف (183) برمز تلقائي.',
    'A new account is made under cash at banks (183) with the next free code.',
    'هەژمارێکی نوێ لە ژێر «نەقد لای بانکەکان» (183) بە کۆدی خۆکار دروست دەکرێت.'
  ],
  bk_kind: ['النوع', 'Type', 'جۆر'],
  bk_anyCurrency: ['أي عملة', 'Any currency', 'هەر دراوێک'],
  bk_pending: ['{n} بانتظار الاعتماد', '{n} awaiting approval', '{n} چاوەڕێی پەسەندکردن'],
  bk_totalCash: ['مجموع النقد', 'Total cash', 'کۆی پارەی نەقد'],
  bk_inBase: ['بالدينار حسب أسعار القيود', 'in dinars at the booked rates', 'بە دینار بە نرخی قەیدەکان'],
  bk_statement: ['كشف الحساب', 'Statement', 'کەشف'],
  bk_editAccount: ['تعديل النوع', 'Change type', 'گۆڕینی جۆر'],
  bk_noAccounts: ['لا توجد حسابات نقدية بعد', 'No cash accounts yet', 'هێشتا هیچ هەژمارێکی نەقد نییە'],

  // transfer
  bk_transferHelp: [
    'نقل مبلغ بين صندوق وبنك أو محفظة بنفس العملة. يُنشأ قيد مسودة يمر بالتدقيق والاعتماد.',
    'Move money between a safe, a bank or a wallet in one currency. A draft entry is made and goes through checking and approval.',
    'گواستنەوەی پارە لە نێوان قاسە و بانک یان جزدان بە یەک دراو. قەیدێکی ڕەشنووس دروست دەکرێت و بە وردبینی و پەسەندکردندا تێدەپەڕێت.'
  ],
  bk_from: ['من حساب', 'From', 'لە هەژماری'],
  bk_to: ['إلى حساب', 'To', 'بۆ هەژماری'],
  bk_charge: ['عمولة البنك (اختياري)', 'Bank charge (optional)', 'کۆمیسیۆنی بانک (ئارەزوومەندانە)'],
  bk_chargeAccount: ['حساب العمولة', 'Charge account', 'هەژماری کۆمیسیۆن'],
  bk_transferDo: ['إنشاء قيد التحويل', 'Make the transfer entry', 'دروستکردنی قەیدی گواستنەوە'],
  bk_transferDone: ['أُنشئ قيد التحويل كمسودة', 'Transfer entry saved as a draft', 'قەیدی گواستنەوە وەک ڕەشنووس پاشەکەوت کرا'],
  bk_exchangeNote: [
    'لتحويل الدينار إلى دولار (صرف) استخدم سند قبض وسند صرف.',
    'To change dinars into dollars, use a receipt and a payment voucher.',
    'بۆ گۆڕینەوەی دینار بە دۆلار، سەنەدی وەرگرتن و سەنەدی پارەدان بەکاربهێنە.'
  ],
  bk_ratePer100: ['سعر 100 دولار بالدينار', 'Price of $100 in dinars', 'نرخی 100 دۆلار بە دینار'],
  bk_openEntry: ['فتح القيد', 'Open the entry', 'کردنەوەی قەید'],
  bk_available: ['المتاح', 'Available', 'بەردەست'],

  // cheques
  bk_received: ['صكوك واردة', 'Received', 'وەرگیراو'],
  bk_issued: ['صكوك صادرة', 'Issued', 'دەرچوو'],
  bk_receive: ['استلام صك', 'Receive a cheque', 'وەرگرتنی چەک'],
  bk_issue: ['تحرير صك', 'Write a cheque', 'نووسینی چەک'],
  bk_chequeNumber: ['رقم الصك', 'Cheque number', 'ژمارەی چەک'],
  bk_drawnBank: ['المصرف المسحوب عليه', 'Bank drawn on', 'بانکی چەکەکە'],
  bk_issueDate: ['تاريخ التحرير', 'Issue date', 'بەرواری نووسین'],
  bk_dueDate: ['تاريخ الاستحقاق', 'Due date', 'بەرواری شایستەبوون'],
  bk_ourBank: ['حسابنا البنكي', 'Our bank account', 'هەژماری بانکی ئێمە'],
  bk_payee: ['المستفيد', 'Payee', 'سوودمەند'],
  bk_drawer: ['الساحب', 'Drawer', 'خاوەنی چەک'],
  bk_status_in_hand: ['في الصندوق', 'In hand', 'لە دەستە'],
  bk_status_deposited: ['مودع في البنك', 'Deposited', 'دانراوە لە بانک'],
  bk_status_cleared: ['محصّل', 'Cleared', 'پارەکەی وەرگیرا'],
  bk_status_bounced: ['مرتجع', 'Bounced', 'گەڕاوە'],
  bk_status_cancelled: ['ملغى', 'Cancelled', 'هەڵوەشێنراوە'],
  bk_status_pending: ['بانتظار الصرف', 'Not yet cashed', 'هێشتا نەدراوە'],
  bk_status_open: ['المفتوحة', 'Open', 'کراوە'],
  bk_due_today: ['تستحق اليوم', 'Due today', 'ئەمڕۆ کاتی دانییەتی'],
  bk_due_week: ['خلال 7 أيام', 'Within 7 days', 'لە ماوەی 7 ڕۆژدا'],
  bk_due_overdue: ['متأخرة', 'Overdue', 'دواکەوتوو'],
  bk_inHandTotal: ['صكوك بأيدينا', 'Cheques in hand', 'چەکی لە دەست'],
  bk_issuedTotal: ['صكوك صادرة لم تُصرف', 'Written, not yet cashed', 'نووسراو، هێشتا نەدراوە'],
  bk_countCheques: ['{n} صك', '{n} cheques', '{n} چەک'],
  bk_daysLeft: ['بعد {n} يوم', 'in {n} days', 'دوای {n} ڕۆژ'],
  bk_daysLate: ['متأخر {n} يوم', '{n} days late', '{n} ڕۆژ دواکەوتوو'],
  bk_today: ['اليوم', 'today', 'ئەمڕۆ'],
  bk_noCheques: ['لا توجد صكوك', 'No cheques', 'هیچ چەکێک نییە'],
  bk_actDeposit: ['إيداع في البنك', 'Deposit', 'دانان لە بانک'],
  bk_actClear: ['تحصيل', 'Cleared', 'پارەکەی وەرگیرا'],
  bk_actClearIssued: ['تم الصرف من البنك', 'Paid by the bank', 'بانک پارەکەی دا'],
  bk_actBounce: ['إرجاع (مرتجع)', 'Bounced', 'گەڕاوە'],
  bk_actCancel: ['إلغاء الصك', 'Cancel the cheque', 'هەڵوەشاندنەوەی چەک'],
  bk_undo: ['تراجع عن الخطوة', 'Undo last step', 'پاشگەزبوونەوە لە دوایین هەنگاو'],
  bk_undoDraft: [
    'يُحذف قيد الخطوة الأخيرة (ما زال مسودة) ويعود الصك إلى حالته السابقة.',
    'The last step’s entry is still a draft: it is deleted and the cheque goes back to where it was.',
    'قەیدی دوایین هەنگاو هێشتا ڕەشنووسە: دەسڕدرێتەوە و چەکەکە دەگەڕێتەوە بۆ دۆخی پێشووی.'
  ],
  bk_undoApproved: [
    'قيد الخطوة الأخيرة معتمد، فيُعكس بقيد عكسي في التاريخ أدناه ويبقى القيدان في الدفاتر، ويعود الصك إلى حالته السابقة. يحتاج هذا صلاحية المصادقة.',
    'The last step’s entry is approved, so it is reversed by an entry on the date below; both stay in the books and the cheque goes back to where it was. This needs the approver’s permission.',
    'قەیدی دوایین هەنگاو پەسەندکراوە، بۆیە بە قەیدێکی پێچەوانە لە بەرواری خوارەوە پێچەوانە دەکرێتەوە؛ هەردووکیان لە دەفتەرەکاندا دەمێننەوە و چەکەکە دەگەڕێتەوە بۆ دۆخی پێشووی. ئەمە دەسەڵاتی پەسەندکردنی پێویستە.'
  ],
  bk_fee: ['غرامة الإرجاع على الزبون (اختياري)', 'Bounce fee charged to the customer (optional)', 'غەرامەی گەڕانەوە لەسەر کڕیار (ئارەزوومەندانە)'],
  bk_reason: ['السبب', 'Reason', 'هۆکار'],
  bk_waitApproval: [
    'قيد هذا الصك بانتظار الاعتماد. بعد اعتماده يمكن إيداعه وتحصيله.',
    'This cheque’s entry is waiting for approval. Once approved it can be deposited and cleared.',
    'قەیدی ئەم چەکە چاوەڕێی پەسەندکردنە. دوای پەسەندکردن دەتوانیت لە بانکی دابنێیت و پارەکەی وەربگریت.'
  ],
  bk_chequeHelp: [
    'الصك الوارد يُسجّل في أوراق القبض (162) ويُخصم من رصيد الزبون، والصادر في أوراق الدفع (262). التحصيل يُنقل إلى البنك.',
    'A received cheque goes to notes receivable (162) and off the customer’s balance; a written one to notes payable (262). Clearing moves it to the bank.',
    'چەکی وەرگیراو دەچێتە بەڵگەنامەکانی وەرگرتن (162) و لە ڕەسیدی کڕیار کەم دەکرێتەوە؛ چەکی نووسراو دەچێتە بەڵگەنامەکانی پارەدان (262). وەرگرتنی پارەکەی دەیگوازێتەوە بۆ بانک.'
  ],
  bk_chequeSaved: ['حُفظ الصك وأُنشئ قيده كمسودة', 'Cheque saved; its entry is a draft', 'چەکەکە پاشەکەوت کرا؛ قەیدەکەی ڕەشنووسە'],
  bk_receipt: ['وصل استلام صك', 'Cheque receipt', 'وەسڵی وەرگرتنی چەک'],
  bk_issueVoucher: ['إشعار تسليم صك', 'Cheque payment note', 'ئاگاداریی پێدانی چەک'],
  bk_receiptText: [
    'استلمنا من {p} الصك المبين أدناه، ويُعدّ المبلغ مدفوعاً عند تحصيله فقط.',
    'Received from {p} the cheque below. The amount counts as paid only once the cheque is cleared.',
    'لە {p} ئەم چەکەی خوارەوەمان وەرگرت. بڕی پارەکە تەنها دوای وەرگرتنی پارەی چەکەکە بە پارەی دراو دادەنرێت.'
  ],
  bk_issueText: [
    'سلّمنا إلى {p} الصك المبين أدناه.',
    'Handed to {p} the cheque below.',
    'ئەم چەکەی خوارەوەمان دایە {p}.'
  ],
  bk_signReceiver: ['توقيع المستلم', 'Received by', 'واژووی وەرگر'],
  bk_signCompany: ['ختم وتوقيع الشركة', 'Company stamp & signature', 'مۆر و واژووی کۆمپانیا'],
  bk_history: ['المراحل', 'Steps', 'قۆناغەکان'],
  bk_entryMade: ['قيد الاستلام', 'Receiving entry', 'قەیدی وەرگرتن'],
  bk_entryClear: ['قيد التحصيل', 'Clearing entry', 'قەیدی وەرگرتنی پارە'],
  bk_entryBounce: ['قيد الإرجاع / الإلغاء', 'Bounce / cancel entry', 'قەیدی گەڕانەوە / هەڵوەشاندنەوە'],
  bk_cancelConfirm: [
    'إلغاء الصك؟ إن كان قيده معتمداً يُنشأ قيد عكسي كمسودة.',
    'Cancel the cheque? If its entry is approved, a reversing draft entry is made.',
    'چەکەکە هەڵبوەشێنرێتەوە؟ ئەگەر قەیدەکەی پەسەندکراو بێت، قەیدێکی پێچەوانە وەک ڕەشنووس دروست دەکرێت.'
  ],
  bk_backToCheques: ['كل الصكوك', 'All cheques', 'هەموو چەکەکان'],

  // reconciliation
  bk_reconHelp: [
    'استورد كشف البنك (Excel أو CSV) أو الصقه، ثم يطابق البرنامج الحركات مع القيود بالمبلغ والتاريخ (±3 أيام) والرقم المرجعي.',
    'Import the bank statement (Excel or CSV) or paste it; the app matches its lines to your entries by amount, date (±3 days) and reference.',
    'کەشفی بانک هاوردە بکە (Excel یان CSV) یان بیلکێنە؛ بەرنامەکە جووڵەکانی بە بڕی پارە و بەروار (±3 ڕۆژ) و ژمارەی سەرچاوە لەگەڵ قەیدەکان هاوتا دەکات.'
  ],
  bk_reconPro: [
    'مطابقة كشف البنك متاحة في باقة Pro.',
    'Bank reconciliation is part of the Pro plan.',
    'هاوتاکردنی کەشفی بانک بەشێکە لە پلانی Pro.'
  ],
  bk_seePlans: ['عرض الباقات', 'See the plans', 'بینینی پلانەکان'],
  bk_newStatement: ['كشف جديد', 'New statement', 'کەشفی نوێ'],
  bk_statements: ['الكشوفات', 'Statements', 'کەشفەکان'],
  bk_noStatements: ['لا توجد كشوفات بعد', 'No statements yet', 'هێشتا هیچ کەشفێک نییە'],
  bk_period: ['الفترة', 'Period', 'ماوە'],
  bk_opening: ['الرصيد الافتتاحي', 'Opening balance', 'ڕەسیدی سەرەتا'],
  bk_closing: ['الرصيد الختامي حسب البنك', 'Closing balance per bank', 'ڕەسیدی کۆتایی بەپێی بانک'],
  bk_file: ['ملف الكشف', 'Statement file', 'فایلی کەشف'],
  bk_orPaste: ['أو الصق الجدول هنا (من Excel)', 'or paste the table here (from Excel)', 'یان خشتەکە لێرە بلکێنە (لە Excel)'],
  bk_readFile: ['قراءة', 'Read', 'خوێندنەوە'],
  bk_mapColumns: ['حدد الأعمدة', 'Choose the columns', 'ستوونەکان دیاری بکە'],
  bk_col_date: ['التاريخ', 'Date', 'بەروار'],
  bk_col_description: ['البيان', 'Description', 'ڕوونکردنەوە'],
  bk_col_reference: ['المرجع / رقم الصك', 'Reference / cheque no.', 'سەرچاوە / ژمارەی چەک'],
  bk_col_amount: ['المبلغ (+ إيداع / − سحب)', 'Amount (+ in / − out)', 'بڕی پارە (+ هاتن / − چوون)'],
  bk_col_in: ['إيداع / دائن', 'Deposits / credit', 'دانان / دائین'],
  bk_col_out: ['سحب / مدين', 'Withdrawals / debit', 'ڕاکێشان / مەدین'],
  bk_col_none: ['— لا يوجد —', '— none —', '— نییە —'],
  bk_headerRow: ['الصف الأول عناوين', 'First row is headers', 'یەکەم ڕیز سەردێڕە'],
  bk_preview: ['معاينة: {n} حركة، المجموع {s}', 'Preview: {n} lines, net {s}', 'پێشبینین: {n} جووڵە، کۆ {s}'],
  bk_skipped: ['تم تجاهل {n} صف غير صالح', '{n} rows skipped (no valid date or amount)', '{n} ڕیز پشتگوێ خرا'],
  bk_checkSum: [
    'الافتتاحي + الحركات يجب أن يساوي الختامي. الفرق الآن: {d}',
    'Opening + lines must equal closing. Off by {d}',
    'سەرەتا + جووڵەکان دەبێت یەکسان بێت بە کۆتایی. جیاوازی: {d}'
  ],
  bk_useComputed: ['اعتماد الختامي المحسوب', 'Use the computed closing', 'کۆتایی ژمێردراو بەکاربهێنە'],
  bk_createStatement: ['حفظ الكشف', 'Save the statement', 'پاشەکەوتکردنی کەشف'],
  bk_autoMatch: ['مطابقة تلقائية', 'Auto-match', 'هاوتاکردنی خۆکار'],
  bk_matchedN: ['طوبقت {n} حركة', '{n} lines matched', '{n} جووڵە هاوتا کرا'],
  bk_bankSide: ['حركات البنك', 'Bank lines', 'جووڵەکانی بانک'],
  bk_bookSide: ['قيود الدفاتر', 'Book entries', 'قەیدەکانی دەفتەر'],
  bk_bookBalance: ['رصيد الدفاتر في نهاية الفترة', 'Book balance at period end', 'ڕەسیدی دەفتەر لە کۆتایی ماوەکە'],
  bk_difference: ['الفرق (البنك − الدفاتر)', 'Difference (bank − books)', 'جیاوازی (بانک − دەفتەر)'],
  bk_unmatchedLines: ['حركات بنك غير مطابقة', 'Unmatched bank lines', 'جووڵەی بانکی هاوتانەکراو'],
  bk_unmatchedBook: ['قيود غير ظاهرة في الكشف', 'Entries not on the statement', 'ئەو قەیدانەی لە کەشفدا نین'],
  bk_matched: ['مطابق', 'Matched', 'هاوتاکراو'],
  bk_unmatch: ['فك المطابقة', 'Unmatch', 'لابردنی هاوتاکردن'],
  bk_matchTo: ['مطابقة مع…', 'Match to…', 'هاوتاکردن لەگەڵ…'],
  bk_pickEntry: ['اختر القيد', 'Pick the entry', 'قەید هەڵبژێرە'],
  bk_noCandidates: ['لا توجد قيود غير مطابقة بنفس المبلغ', 'No unmatched entries with this amount', 'هیچ قەیدێکی هاوتانەکراو بەم بڕە پارەیە نییە'],
  bk_makeVoucher: ['إنشاء سند', 'Make a voucher', 'دروستکردنی سەنەد'],
  bk_makeVoucherHelp: [
    'حركة غير مسجلة في الدفاتر (عمولة، فائدة، إيداع لم يُسجّل): يُنشأ سند قبض أو صرف كمسودة على حساب البنك ويُطابق معها.',
    'A line the books don’t have (charges, interest, an unrecorded deposit): a draft receipt or payment voucher on the bank account is made and matched to it.',
    'جووڵەیەک کە لە دەفتەردا نییە (کۆمیسیۆن، سوود، دانانێکی تۆمارنەکراو): سەنەدی وەرگرتن یان پارەدان وەک ڕەشنووس لەسەر هەژماری بانک دروست دەکرێت و لەگەڵی هاوتا دەکرێت.'
  ],
  bk_counterAccount: ['الحساب المقابل', 'Other account', 'هەژماری بەرامبەر'],
  bk_reconcile: ['تأكيد المطابقة', 'Mark reconciled', 'پشتڕاستکردنەوەی هاوتاکردن'],
  bk_reconciled: ['تمت المطابقة', 'Reconciled', 'هاوتا کرا'],
  bk_reconcileHint: [
    'يمكن التأكيد عندما تُطابق كل حركات البنك ويصبح الفرق صفراً (القيود الجديدة تحتاج اعتماداً أولاً).',
    'You can confirm once every bank line is matched and the difference is zero (new vouchers need approval first).',
    'دەتوانیت پشتڕاستی بکەیتەوە کاتێک هەموو جووڵەکانی بانک هاوتا کران و جیاوازی بوو بە سفر (سەنەدە نوێیەکان سەرەتا پێویستیان بە پەسەندکردنە).'
  ],
  bk_deleteStatement: ['حذف الكشف', 'Delete the statement', 'سڕینەوەی کەشف'],
  bk_deleteStatementConfirm: ['حذف هذا الكشف ومطابقاته؟ القيود نفسها لا تتأثر.', 'Delete this statement and its matches? The entries themselves stay.', 'ئەم کەشفە و هاوتاکردنەکانی بسڕدرێنەوە؟ قەیدەکان خۆیان دەمێننەوە.'],
  bk_draftEntry: ['مسودة', 'draft', 'ڕەشنووس'],
  bk_in: ['إيداع', 'In', 'هاتن'],
  bk_out: ['سحب', 'Out', 'چوون'],

  // errors
  err_bk_account_invalid: ['اختر صندوقاً أو حساباً بنكياً صالحاً (تحت 18)', 'Choose a valid safe or bank account (under 18)', 'قاسە یان هەژماری بانکی دروست هەڵبژێرە (لە ژێر 18)'],
  err_bk_same_account: ['حساب المصدر والوجهة متطابقان', 'The from and to accounts are the same', 'هەژماری سەرچاوە و مەبەست یەکن'],
  err_bk_charge_account_invalid: ['حساب العمولة يجب أن يكون حساب مصروف فرعياً', 'The charge account must be a postable expense account', 'هەژماری کۆمیسیۆن دەبێت هەژمارێکی لاوەکیی خەرجی بێت'],
  err_bk_fee_account_invalid: ['حساب الغرامة يجب أن يكون حساب إيراد فرعياً', 'The fee account must be a postable revenue account', 'هەژماری غەرامە دەبێت هەژمارێکی لاوەکیی داهات بێت'],
  err_bk_notes_receivable_missing: [
    'لا يوجد حساب أوراق القبض (162) ولا يمكن إضافته لأن حساب المدينين (16) عليه قيود. اطلب من المحاسب إضافته.',
    'There is no notes receivable account (162), and it can’t be added because Debtors (16) has entries. Ask your accountant to add it.',
    'هەژماری بەڵگەنامەکانی وەرگرتن (162) نییە و ناتوانرێت زیاد بکرێت چونکە هەژماری قەرزارەکان (16) قەیدی لەسەرە. داوا لە ژمێریار بکە زیادی بکات.'
  ],
  err_bk_notes_payable_missing: ['حساب أوراق الدفع (262) غير متاح للترحيل', 'The notes payable account (262) is not postable', 'هەژماری بەڵگەنامەکانی پارەدان (262) قەید وەرناگرێت'],
  err_bk_cheque_number_required: ['أدخل رقم الصك', 'Enter the cheque number', 'ژمارەی چەک بنووسە'],
  err_bk_cheque_bank_required: ['أدخل اسم المصرف', 'Enter the bank name', 'ناوی بانک بنووسە'],
  err_bk_due_before_issue: ['تاريخ الاستحقاق قبل تاريخ التحرير', 'The due date is before the issue date', 'بەرواری شایستەبوون پێش بەرواری نووسینە'],
  err_bk_cheque_duplicate: ['هذا الصك مسجل مسبقاً (نفس الرقم والمصرف)', 'This cheque is already recorded (same number and bank)', 'ئەم چەکە پێشتر تۆمار کراوە (هەمان ژمارە و بانک)'],
  err_bk_cheque_entry_not_approved: ['اعتمد قيد الصك أولاً', 'Approve the cheque’s entry first', 'سەرەتا قەیدی چەکەکە پەسەند بکە'],
  err_bk_cheque_entry_in_review: ['قيد الصك قيد التدقيق؛ أعده إلى مسودة أولاً', 'The cheque’s entry is being checked; return it to draft first', 'قەیدی چەکەکە لە وردبینیدایە؛ سەرەتا بیگەڕێنەوە بۆ ڕەشنووس'],
  err_bk_statement_empty: ['الكشف بلا حركات', 'The statement has no lines', 'کەشفەکە هیچ جووڵەیەکی تێدا نییە'],
  err_bk_statement_unbalanced: ['الافتتاحي + الحركات لا يساوي الختامي', 'Opening + lines don’t equal the closing balance', 'سەرەتا + جووڵەکان یەکسان نییە بە کۆتایی'],
  err_bk_statement_reconciled: ['هذا الكشف مطابَق ومقفل', 'This statement is reconciled and locked', 'ئەم کەشفە هاوتا کراوە و داخراوە'],
  err_bk_match_invalid: ['هذا القيد لا يخص هذا الحساب', 'That entry doesn’t touch this account', 'ئەو قەیدە پەیوەندیی بەم هەژمارەوە نییە'],
  err_bk_already_matched: ['هذا القيد أو الحركة مطابق مسبقاً', 'That entry or line is already matched', 'ئەو قەید یان جووڵەیە پێشتر هاوتا کراوە'],
  err_bk_match_amount: ['مبلغ القيد لا يساوي مبلغ الحركة', 'The entry’s amount differs from the line’s', 'بڕی پارەی قەیدەکە جیاوازە لە هی جووڵەکە'],
  err_bk_statement_unmatched: ['ما زالت هناك حركات غير مطابقة', 'Some bank lines are still unmatched', 'هێشتا هەندێک جووڵە هاوتا نەکراون'],
  err_bk_statement_difference: ['الفرق ليس صفراً بعد', 'The difference isn’t zero yet', 'جیاوازی هێشتا سفر نییە'],
  err_bk_read_failed: ['تعذرت قراءة الملف. استخدم xlsx أو csv.', 'Couldn’t read the file. Use .xlsx or .csv.', 'فایلەکە نەخوێنرایەوە. xlsx یان csv بەکاربهێنە.'],
  err_supplier_required: ['اختر مجهزاً', 'Choose a supplier', 'دابینکەرێک هەڵبژێرە'],
  err_plan_limit_bankReconciliation: ['مطابقة كشف البنك متاحة في باقة Pro', 'Bank reconciliation needs the Pro plan', 'هاوتاکردنی کەشفی بانک پێویستی بە پلانی Pro هەیە']
} as const satisfies Record<string, readonly [string, string, string]>;
