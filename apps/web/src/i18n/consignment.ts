/**
 * Goods on consignment (sale-or-return, بضاعة أمانة): items a supplier leaves, receipts and returns, settlements and the
 * supplier's statement. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const CONSIGNMENT_TEXT = {
  cg_title: ['بضاعة الأمانة', 'Consignment goods', 'کاڵای ئەمانەت'],
  f_consignment: ['بضاعة الأمانة: تُدفع للمجهز حسب ما يُباع', 'Consignment goods: pay the supplier for what sells', 'کاڵای ئەمانەت: پارەی دابینکەر بەپێی ئەوەی دەفرۆشرێت'],
  cg_help: [
    'بضاعة يتركها المجهز عندك ولا تدفع ثمنها إلا بعد بيعها. تُباع في نقطة البيع والفواتير كأي مادة، وتسوية ما بيع تصير ديناً للمجهز بعد التدقيق والمصادقة.',
    'Goods a supplier leaves with you, paid for only once they sell. They sell at the till and on invoices like any item; settling what sold makes it owed to the supplier, after checking and approval.',
    'ئەو کاڵایانەی دابینکەر لای تۆی دادەنێت و تەنها دوای فرۆشتن پارەیان دەدەیت. لە خاڵی فرۆشتن و پسوولەکاندا وەک هەر کاڵایەک دەفرۆشرێن؛ یەکلاکردنەوەی ئەوەی فرۆشرا دەبێتە قەرزی دابینکەر، دوای پشکنین و پەسەندکردن.'
  ],
  cg_planHint: ['بضاعة الأمانة متاحة في خطط Starter وPro وBusiness.', 'Consignment goods are on the Starter, Pro and Business plans.', 'کاڵای ئەمانەت لە پلانەکانی Starter و Pro و Business دایە.'],
  cg_tabSuppliers: ['المجهزون', 'Suppliers', 'دابینکەران'],
  cg_tabItems: ['المواد', 'Items', 'کاڵاکان'],
  cg_tabDocs: ['الاستلام والإرجاع', 'Receipts and returns', 'وەرگرتن و گەڕاندنەوە'],
  cg_tabSettlements: ['التسويات', 'Settlements', 'یەکلاکردنەوەکان'],
  cg_noSuppliers: ['لا توجد بضاعة أمانة بعد. ابدأ بوضع مادة على الأمانة مع مجهزها.', 'No consignment goods yet. Start by putting an item on consignment with its supplier.', 'هێشتا کاڵای ئەمانەت نییە. بە دانانی کاڵایەک لەسەر ئەمانەت لەگەڵ دابینکەرەکەی دەست پێبکە.'],
  cg_unsettled: ['مباع غير مسوّى', 'Sold, not settled', 'فرۆشراو، یەکلانەکراوە'],
  cg_itemCount: ['عدد المواد', 'Items', 'ژمارەی کاڵا'],
  cg_statement: ['كشف المجهز', 'Supplier statement', 'کەشفی دابینکەر'],
  cg_addItem: ['وضع مادة على الأمانة', 'Put an item on consignment', 'دانانی کاڵا لەسەر ئەمانەت'],
  cg_editTerms: ['تعديل الشروط', 'Change terms', 'گۆڕینی مەرجەکان'],
  cg_endItem: ['إنهاء الأمانة', 'End consignment', 'کۆتاییهێنان بە ئەمانەت'],
  cg_endConfirm: ['تعود المادة مادة عادية تُشترى بفاتورة. لا يجوز ذلك وعندك منها رصيد.', 'The item becomes an ordinary item, bought on invoices. Not while any of it is on hand.', 'کاڵاکە دەبێتەوە کاڵایەکی ئاسایی کە بە پسوولە دەکڕدرێت. ناکرێت تا هیچی لێ ماوە.'],
  cg_agreedCost: ['الكلفة المتفق عليها', 'Agreed cost', 'تێچووی ڕێککەوتوو'],
  cg_agreedCostHelp: ['لكل وحدة أساسية، بعملة الاتفاق. تُطبَّق على الاستلامات القادمة.', 'Per base unit, in the agreed currency. It applies to the next receipts.', 'بۆ هەر یەکەیەکی بنەڕەتی، بە دراوی ڕێککەوتن. لە وەرگرتنەکانی داهاتوودا جێبەجێ دەکرێت.'],
  cg_onHand: ['الرصيد', 'On hand', 'بەردەست'],
  cg_ended: ['منتهية', 'Ended', 'کۆتایی هاتووە'],
  cg_newReceipt: ['استلام بضاعة أمانة', 'Receive consignment goods', 'وەرگرتنی کاڵای ئەمانەت'],
  cg_newReturn: ['إرجاع إلى المجهز', 'Return to the supplier', 'گەڕاندنەوە بۆ دابینکەر'],
  cg_kind_receipt: ['استلام', 'Receipt', 'وەرگرتن'],
  cg_kind_return: ['إرجاع', 'Return', 'گەڕاندنەوە'],
  cg_noDocs: ['لا يوجد استلام أو إرجاع بعد.', 'No receipts or returns yet.', 'هێشتا هیچ وەرگرتن و گەڕاندنەوەیەک نییە.'],
  cg_docHelp: [
    'الاستلام يُدخل البضاعة بالكلفة المتفق عليها دون فاتورة شراء ودون دين للمجهز. الإرجاع يعيدها إليه.',
    'A receipt brings the goods in at the agreed cost, with no purchase invoice and nothing owed yet. A return gives them back.',
    'وەرگرتن کاڵاکان بە تێچووی ڕێککەوتوو دێنێتە ژوورەوە، بێ پسوولەی کڕین و بێ قەرز بۆ دابینکەر. گەڕاندنەوە بۆی دەگەڕێنێتەوە.'
  ],
  cg_itemsOfSupplier: ['تظهر مواد هذا المجهز التي على الأمانة فقط.', 'Only this supplier’s consignment items are listed.', 'تەنها کاڵا ئەمانەتەکانی ئەم دابینکەرە پیشان دەدرێن.'],
  cg_post: ['ترحيل', 'Post', 'ناردن'],
  cg_cancelDoc: ['إلغاء', 'Cancel', 'هەڵوەشاندنەوە'],
  cg_preview: ['ما بيع ولم يُسوَّ', 'Sold and not settled', 'فرۆشراو و یەکلانەکراوە'],
  cg_settle: ['تسوية ما بيع', 'Settle what sold', 'یەکلاکردنەوەی ئەوەی فرۆشرا'],
  cg_settleHelp: [
    'ينشئ قيداً يجعل المبلغ ديناً للمجهز. يمر القيد بالتدقيق والمصادقة كأي سند، ثم تدفع للمجهز بسند صرف.',
    'Makes an entry that puts the amount on the supplier’s account. It goes through checking and approval like any voucher; then pay the supplier with a payment voucher.',
    'قەیدێک دروست دەکات کە بڕەکە دەخاتە سەر هەژماری دابینکەر. وەک هەر سەنەدێک بە پشکنین و پەسەندکردندا تێدەپەڕێت؛ پاشان بە سەنەدی پارەدان پارەی دابینکەر بدە.'
  ],
  cg_nothingToSettle: ['لا شيء بيع ولم يُسوَّ حتى هذا التاريخ.', 'Nothing sold and unsettled up to this date.', 'تا ئەم بەروارە هیچ شتێکی فرۆشراوی یەکلانەکراو نییە.'],
  cg_noSettlements: ['لا توجد تسويات بعد.', 'No settlements yet.', 'هێشتا هیچ یەکلاکردنەوەیەک نییە.'],
  cg_bookValue: ['قيمتها في الدفاتر', 'Value in the books', 'بەهای لە دەفتەرەکاندا'],
  cg_state_draft: ['بانتظار المصادقة', 'Waiting for approval', 'چاوەڕێی پەسەندکردن'],
  cg_state_checked: ['دُقّقت، بانتظار المصادقة', 'Checked, waiting for approval', 'پشکنرا، چاوەڕێی پەسەندکردن'],
  cg_state_approved: ['مصادق عليها: دين للمجهز', 'Approved: owed to the supplier', 'پەسەندکراو: قەرزی دابینکەر'],
  cg_state_reversed: ['معكوسة', 'Reversed', 'پێچەوانەکراوە'],
  cg_state_none: ['ملغاة', 'Cancelled', 'هەڵوەشاوە'],
  cg_cancelSettlement: ['التراجع عن التسوية', 'Take the settlement back', 'گەڕاندنەوەی یەکلاکردنەوەکە'],
  cg_cancelSettlementHelp: [
    'القيد بانتظار المصادقة يُحذف، والمصادق عليه يُعكس. ما غطته التسوية يعود غير مسوّى.',
    'An entry waiting for approval is deleted; an approved one is reversed. What it covered is unsettled again.',
    'قەیدی چاوەڕێی پەسەندکردن دەسڕدرێتەوە؛ ئەوەی پەسەندکراوە پێچەوانە دەکرێتەوە. ئەوەی گرتبوویەوە دەبێتەوە یەکلانەکراو.'
  ],
  cg_received: ['المستلم', 'Received', 'وەرگیراو'],
  cg_returned: ['المرجَع', 'Returned', 'گەڕێندراوە'],
  cg_sold: ['المباع', 'Sold', 'فرۆشراو'],
  cg_settled: ['المسوّى', 'Settled', 'یەکلاکراوە'],
  cg_waiting: ['بانتظار المصادقة', 'Waiting for approval', 'چاوەڕێی پەسەندکردن'],
  cg_paid: ['المدفوع للمجهز', 'Paid to the supplier', 'دراو بە دابینکەر'],
  cg_balance: ['الرصيد المستحق له', 'Balance owed to them', 'ماوەی قەرزی ئەوان'],
  cg_soldNote: ['المباع يشمل ما أُتلف أو فُقد (يتحمّله المحل) ومطروحاً منه ما أرجعه الزبائن.', 'Sold includes what was damaged or lost (the shop bears it), less what customers brought back.', 'فرۆشراو ئەوەش دەگرێتەوە کە تێکچوو یان ون بوو (دوکان هەڵیدەگرێت)، کەمکراوە لە ئەوەی کڕیاران گەڕاندیانەوە.'],
  cg_rate: ['سعر الصرف', 'Exchange rate', 'نرخی ئاڵوگۆڕ'],

  e_consignment_item: ['مادة على الأمانة', 'Consignment item', 'کاڵای ئەمانەت'],
  e_consignment_doc: ['استلام أو إرجاع أمانة', 'Consignment receipt or return', 'وەرگرتن یان گەڕاندنەوەی ئەمانەت'],
  e_consignment_settlement: ['تسوية بضاعة أمانة', 'Consignment settlement', 'یەکلاکردنەوەی کاڵای ئەمانەت'],

  err_cs_item_has_stock: ['عندك رصيد من هذه المادة؛ أرجِعه إلى المجهز أو بِعه أولاً.', 'Some of this item is on hand; return it to the supplier or sell it first.', 'هێشتا بڕێک لەم کاڵایە ماوە؛ سەرەتا بیگەڕێنەوە بۆ دابینکەر یان بیفرۆشە.'],
  // the accounts features post to (Settings → Accounts): the two refusals of the 2.0 books review
  err_feature_account_in_use: ['الحساب الحالي ({c}) فيه رصيد؛ يُغيَّر الحساب بعد أن يصفَّر (أو يُنقل رصيده بقيد أولاً)', 'The account in use ({c}) holds a balance: change it once that is zero (or move the balance with an entry first)', 'هەژماری ئێستا ({c}) ڕەسیدی تێدایە؛ دوای سفربوونی بیگۆڕە (یان سەرەتا ڕەسیدەکە بە قەیدێک بگوازەوە)'],
  err_feature_account_stock: ['هذا حساب مخزون (مخزن أو وقود)؛ اختر حساباً آخر', 'That is a stock account (a warehouse’s or the fuel’s): choose another', 'ئەوە هەژماری کۆگایە (کۆگا یان سووتەمەنی)؛ هەژمارێکی تر هەڵبژێرە'],
  err_cs_item_not_stocked: ['المادة لا يُتابَع مخزونها، فلا توضع على الأمانة.', 'This item doesn’t track stock, so it can’t be on consignment.', 'ئەم کاڵایە کۆگاکەی بەدوادا ناچێت، بۆیە ناخرێتە سەر ئەمانەت.'],
  err_cs_item_not_from_supplier: ['هذه المادة ليست على الأمانة مع هذا المجهز.', 'This item isn’t on consignment with this supplier.', 'ئەم کاڵایە لەگەڵ ئەم دابینکەرەدا لەسەر ئەمانەت نییە.'],
  err_cs_mixed_currencies: ['مواد المستند بعملتين؛ اجعل كل عملة في مستند.', 'The document mixes two currencies; make one document per currency.', 'بەڵگەنامەکە دوو دراوی تێکەڵ کردووە؛ بۆ هەر دراوێک بەڵگەنامەیەک دروست بکە.'],
  err_cs_nothing_to_settle: ['لا شيء بيع ولم يُسوَّ حتى هذا التاريخ.', 'Nothing sold and unsettled up to this date.', 'تا ئەم بەروارە هیچ شتێکی فرۆشراوی یەکلانەکراو نییە.'],
  err_cs_account_missing: ['لا يوجد حساب لبضاعة الأمانة؛ اطلب من المحاسب اختيار حساب تحت الدائنين.', 'There is no account for consignment goods; ask the accountant to choose one under creditors.', 'هیچ هەژمارێک بۆ کاڵای ئەمانەت نییە؛ داوا لە ژمێریار بکە یەکێک لە ژێر قەرزدەرەکاندا هەڵبژێرێت.'],
  err_cs_entry_checked: ['قيد التسوية مدقَّق؛ يعيده المدقِّق إلى مسودة أولاً.', 'The settlement’s entry is checked; its checker returns it to draft first.', 'قەیدی یەکلاکردنەوەکە پشکنراوە؛ سەرەتا پشکنەرەکەی دەیگەڕێنێتەوە بۆ ڕەشنووس.'],
  err_cs_entry_reversed: ['قيد التسوية معكوس من قبل.', 'The settlement’s entry was reversed already.', 'قەیدی یەکلاکردنەوەکە پێشتر پێچەوانە کراوەتەوە.'],
  err_item_on_consignment: ['هذه المادة على الأمانة: رصيدها للمجهز، فلا تُشترى ولا تُدخَل رصيداً افتتاحياً.', 'This item is on consignment: its stock is the supplier’s, so it isn’t bought or brought in as opening stock.', 'ئەم کاڵایە لەسەر ئەمانەتە: کۆگاکەی هی دابینکەرە، بۆیە ناکڕدرێت و وەک کۆگای سەرەتا ناخرێتە ژوورەوە.'],
  err_entry_belongs_to_consignment: ['هذا القيد لبضاعة أمانة؛ ألغِه أو تراجع عنه من صفحة بضاعة الأمانة.', 'This entry belongs to consignment goods; cancel or take it back from the Consignment goods page.', 'ئەم قەیدە هی کاڵای ئەمانەتە؛ لە پەڕەی کاڵای ئەمانەتەوە هەڵیبوەشێنەوە یان بیگەڕێنەوە.']
} as const;
