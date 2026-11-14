/**
 * 1.4, sales: cash or credit on the sales invoice and at the till, "Receive payment" and "Pay supplier", and vouchers
 * that wait for approval. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 * The payment choice "credit" (on the customer's account, a debt) is «قەرز» in Kurdish everywhere.
 */
export const SALES14_TEXT = {
  // cash or credit
  s14_payCashHint: ['يُدفع الآن ويدخل القاصة.', 'Paid now, into the safe.', 'ئێستا دەدرێت و دەچێتە قاسە.'],
  s14_payCreditHint: ['يُسجَّل ديناً على حساب الزبون.', 'Goes on the customer’s account as a debt.', 'وەک قەرز لەسەر کڕیار تۆمار دەکرێت.'],
  s14_payCreditHintSupplier: ['يبقى ديناً علينا للمجهز.', 'Stays owed to the supplier.', 'وەک قەرز بۆ دابینکەر دەمێنێتەوە.'],
  s14_creditNeedsCustomer: [
    'اختر الزبون أولاً: البيع الآجل يُسجَّل على حسابه.',
    'Choose the customer first: a credit sale goes on their account.',
    'سەرەتا کڕیار هەڵبژێرە: فرۆشتن بە قەرز لەسەر ئەو تۆمار دەکرێت.'
  ],
  s14_creditNeedsSupplier: [
    'اختر المجهز أولاً: الشراء الآجل يبقى ديناً علينا له.',
    'Choose the supplier first: a credit purchase stays owed to them.',
    'سەرەتا دابینکەر هەڵبژێرە: کڕین بە قەرز وەک قەرز بۆ ئەو دەمێنێتەوە.'
  ],
  s14_safe: ['القاصة', 'Safe', 'قاسە'],
  // what the section holds now: the rule for selling stock past its date, the days of warning, dates on new items
  s14_salesSectionHelp: [
    'بيع المنتهي الصلاحية، وأيام التنبيه قبل الانتهاء، وتاريخ الانتهاء للمواد الجديدة',
    'Selling expired stock, the days of warning before expiry, and expiry dates on new items',
    'فرۆشتنی کاڵای بەسەرچوو، ڕۆژەکانی ئاگاداری پێش بەسەرچوون، و بەرواری بەسەرچوون بۆ کاڵا نوێیەکان'
  ],
  err_pos_credit_not_mixed: [
    'البيع إما مدفوع الآن أو آجل كله، ولا يُقسم بينهما.',
    'A sale is either paid now or on credit as a whole, never part one and part the other.',
    'فرۆشتن یان ئێستا دەدرێت یان هەمووی قەرزە؛ لە نێوانیاندا دابەش ناکرێت.'
  ],

  // receive payment / pay supplier
  s14_receive: ['قبض دفعة', 'Receive payment', 'وەرگرتنی پارە'],
  s14_paySupplier: ['دفع للمجهز', 'Pay supplier', 'پارەدان بە دابینکەر'],
  s14_receiveHelp: [
    'سند قبض عادي: يدخل المبلغ القاصة أو المصرف وينزل من حساب الزبون.',
    'An ordinary receipt voucher: the money goes into the safe or bank and comes off the customer’s account.',
    'سەنەدی وەرگرتنی ئاسایی: پارەکە دەچێتە قاسە یان بانک و لە قەرزی کڕیار کەم دەبێتەوە.'
  ],
  s14_payHelp: [
    'سند صرف عادي: يخرج المبلغ من القاصة أو المصرف وينزل مما علينا للمجهز.',
    'An ordinary payment voucher: the money leaves the safe or bank and comes off what we owe the supplier.',
    'سەنەدی پارەدانی ئاسایی: پارەکە لە قاسە یان بانک دەردەچێت و لە قەرزی دابینکەر کەم دەبێتەوە.'
  ],
  s14_into: ['يدخل إلى', 'Paid into', 'دەچێتە ناو'],
  s14_outOf: ['يُدفع من', 'Paid from', 'دەدرێت لە'],
  s14_balanceBefore: ['الرصيد قبل', 'Balance before', 'ڕەسیدی پێشوو'],
  s14_balanceAfter: ['المتبقي بعد', 'Remaining after', 'ڕەسیدی ماوە'],
  s14_overpaid: [
    'المبلغ أكبر من الرصيد: الزيادة تبقى له.',
    'More than the balance: the extra stays in their favour.',
    'پارەکە لە ڕەسید زیاترە: زیادەکە بۆ ئەو دەمێنێتەوە.'
  ],
  s14_balanceAlso: ['وبالعملة الأخرى', 'And in the other currency', 'و بە دراوەکەی تر'],
  s14_invoiceSettled: [
    'لم يبقَ شيء على هذه الفاتورة. إن استلمت مبلغاً مع ذلك فاكتبه، ويُقيَّد على الحساب.',
    'Nothing is left on this invoice. If money is taken all the same, type the amount: it goes on the account.',
    'هیچ شتێک لەسەر ئەم پسوولەیە نەماوە. ئەگەر لەگەڵ ئەوەشدا پارە وەردەگیرێت، بڕەکەی بنووسە: دەچێتە سەر هەژمارەکەی.'
  ],
  s14_invoiceSettledPay: [
    'لم يبقَ شيء على هذه الفاتورة. إن دفعت مبلغاً مع ذلك فاكتبه، ويُقيَّد على الحساب.',
    'Nothing is left on this invoice. If money is paid all the same, type the amount: it goes on the account.',
    'هیچ شتێک لەسەر ئەم پسوولەیە نەماوە. ئەگەر لەگەڵ ئەوەشدا پارە دەدرێت، بڕەکەی بنووسە: دەچێتە سەر هەژمارەکەی.'
  ],
  // an amount typed above what is open on the invoice: said before saving
  s14_overInvoice: [
    'المبلغ أكبر من المتبقي على هذه الفاتورة بـ {extra}: الزيادة تبقى في حساب الزبون دفعةً مقدَّمة.',
    '{extra} more than is still open on this invoice: the extra stays on the customer’s account as an advance.',
    'پارەکە {extra} لەوەی لەسەر ئەم پسوولەیە ماوە زیاترە: زیادەکە وەک پێشەکی لەسەر هەژماری کڕیار دەمێنێتەوە.'
  ],
  s14_overInvoicePay: [
    'المبلغ أكبر من المتبقي على هذه الفاتورة بـ {extra}: الزيادة تبقى في حساب المجهز دفعةً مقدَّمة.',
    '{extra} more than is still open on this invoice: the extra stays on the supplier’s account as an advance.',
    'پارەکە {extra} لەوەی لەسەر ئەم پسوولەیە ماوە زیاترە: زیادەکە وەک پێشەکی لەسەر هەژماری دابینکەر دەمێنێتەوە.'
  ],
  s14_invoiceWaits: [
    'لم يبقَ ما يُطلب على هذه الفاتورة: {amount} بانتظار الموافقة.',
    'Nothing is left to ask for on this invoice: {amount} waits for approval.',
    'هیچ شتێک نەماوە داوا بکرێت لەسەر ئەم پسوولەیە: {amount} چاوەڕێی پەسەندکردنە.'
  ],
  s14_invReceived: ['المستلم عنها', 'Received for it', 'وەرگیراو بۆی'],
  s14_invPaid: ['المدفوع عنها', 'Paid for it', 'دراو بۆی'],
  s14_invWaiting: ['بانتظار الموافقة', 'Waiting for approval', 'چاوەڕێی پەسەندکردن'],
  s14_invOpen: ['المتبقي عليها', 'Still open', 'ماوە لەسەری'],
  s14_invNothingOpen: ['لم يبقَ عليها شيء', 'Nothing left on it', 'هیچی لەسەر نەماوە'],
  // money was received without naming an invoice: the books do not say which invoice it paid, and the page says so
  s14_invOpenUpTo: ['المتبقي عليها، بحد أقصى', 'Still open on this invoice, up to', 'ماوە لەسەر ئەم پسوولەیە، ئەوپەڕی'],
  s14_invUnsure: [
    'على الزبون {owed} إجمالاً. استُلمت مبالغ دون تحديد فاتورة، فقد تكون هذه الفاتورة مدفوعة.',
    'The customer owes {owed} in all. Some money was received without naming an invoice, so this invoice may already be paid.',
    'کڕیار بە گشتی {owed} قەرزارە. هەندێک پارە بەبێ دیاریکردنی پسوولە وەرگیراوە، بۆیە لەوانەیە ئەم پسوولەیە درابێت.'
  ],
  s14_invUnsureSupplier: [
    'علينا للمجهز {owed} إجمالاً. دُفعت مبالغ دون تحديد فاتورة، فقد تكون هذه الفاتورة مدفوعة.',
    'We owe the supplier {owed} in all. Some money was paid without naming an invoice, so this invoice may already be paid.',
    'بە گشتی {owed} قەرزاری دابینکەرین. هەندێک پارە بەبێ دیاریکردنی پسوولە دراوە، بۆیە لەوانەیە ئەم پسوولەیە درابێت.'
  ],
  s14_invNoDebt: ['لا دين على هذا الزبون', 'Nothing owed by this customer', 'ئەم کڕیارە هیچ قەرزی لەسەر نییە'],
  s14_invNoDebtSupplier: ['لا دين علينا لهذا المجهز', 'Nothing owed to this supplier', 'هیچ قەرزی ئەم دابینکەرەمان لەسەر نییە'],
  s14_invAging: [
    'تقارير أعمار الديون تحتسب المدفوعات على أقدم دين أولاً، فقد تختلف الأعمار فيها عمّا تُظهره هذه الفاتورة.',
    'Aging reports count payments against the oldest debt first, so the ages there can differ from what this invoice shows.',
    'ڕاپۆرتەکانی تەمەنی قەرز پارەدانەکان لە کۆنترین قەرزەوە دەژمێرن، بۆیە لەوانەیە تەمەنەکانی ئەوێ لەوەی ئەم پسوولەیە پیشانی دەدات جیاواز بن.'
  ],
  s14_forInvoice: ['عن الفاتورة {n}', 'For invoice {n}', 'بۆ پسوولەی {n}'],
  s14_posted: ['رُحّل السند {n}', 'Voucher {n} posted', 'سەنەدی {n} تەرحیل کرا'],
  s14_savedWaiting: ['حُفظ السند وهو بانتظار الموافقة.', 'Saved. It waits for approval.', 'پاشەکەوت کرا و چاوەڕێی پەسەندکردنە.'],
  s14_savedDraft: [
    'حُفظ مسودة: يحتاج التدقيق والمصادقة.',
    'Saved as a draft: it needs checking and approval.',
    'وەک ڕەشنووس پاشەکەوت کرا: پێویستی بە وردبینی و پەسەندکردنە.'
  ],
  s14_willWait: [
    'سيُحفظ بانتظار موافقة من له صلاحية المصادقة، ولا يتغير الرصيد قبلها.',
    'It will wait for someone who may approve vouchers; the balance changes only then.',
    'چاوەڕێی کەسێک دەبێت کە دەسەڵاتی پەسەندکردنی هەیە؛ ڕەسید تەنها دوای ئەوە دەگۆڕێت.'
  ],
  s14_willDraft: [
    'سيُحفظ مسودة للتدقيق والمصادقة، ولا يتغير الرصيد قبلها.',
    'It will be saved as a draft for checking and approval; the balance changes only then.',
    'وەک ڕەشنووس بۆ وردبینی و پەسەندکردن پاشەکەوت دەکرێت؛ ڕەسید تەنها دوای ئەوە دەگۆڕێت.'
  ],
  // whoever prepared a voucher that is not posted takes it back, or corrects it and sends it again
  s14_withdraw: ['سحب السند', 'Withdraw', 'کێشانەوەی سەنەد'],
  s14_withdrawConfirm: [
    'سحب هذا السند؟ يُحذف ولا يدخل أي رصيد.',
    'Withdraw this voucher? It is deleted and enters no balance.',
    'ئەم سەنەدە بکێشیتەوە؟ دەسڕدرێتەوە و ناچێتە هیچ ڕەسیدێک.'
  ],
  s14_withdrawn: ['سُحب السند', 'Voucher withdrawn', 'سەنەدەکە کێشرایەوە'],
  s14_sendAgain: ['تصحيح وإرسال من جديد', 'Correct and send again', 'ڕاستکردنەوە و دووبارە ناردن'],
  s14_againHelp: [
    'يُحفظ سنداً جديداً بما تكتبه هنا، ويُسحب السند السابق.',
    'Saved as a new voucher with what you enter here; the earlier one is withdrawn.',
    'بەوەی لێرە دەینووسیت وەک سەنەدێکی نوێ پاشەکەوت دەکرێت و سەنەدەکەی پێشوو دەکێشرێتەوە.'
  ],
  s14_waitingOwn: [
    'يمكنك سحبه ما دام بانتظار الموافقة.',
    'You can withdraw it while it waits.',
    'تا چاوەڕێی پەسەندکردنە دەتوانیت بیکێشیتەوە.'
  ],
  s14_rejectedOwn: [
    'صحّحه وأرسله من جديد، أو اسحبه.',
    'Correct it and send it again, or withdraw it.',
    'ڕاستی بکەرەوە و دووبارە بینێرە، یان بیکێشەوە.'
  ],
  s14_creditDropped: [
    'انقطع الاتصال بالخادم: صار هذا البيع نقداً. اختر «آجل» من جديد بعد عودة الاتصال إن أردت.',
    'The server can’t be reached: this sale is now cash. Choose “On credit” again once it is back, if you still want it.',
    'پەیوەندی بە سێرڤەرەوە پچڕا: ئەم فرۆشتنە بوو بە نەقد. ئەگەر ویستت، دوای گەڕانەوەی پەیوەندی دووبارە «قەرز» هەڵبژێرە.'
  ],
  // someone who does not keep the books sees the vouchers they prepared, and no other
  s14_myVouchers: ['سنداتي', 'My vouchers', 'سەنەدەکانم'],
  s14_myVouchersHelp: [
    'تظهر هنا السندات التي نظّمتها أنت فقط، مع حالة الموافقة وسبب الرفض إن رُفضت. بقية السندات والقيود في دفاتر الشركة.',
    'Only the vouchers you prepared are listed here, with their approval and the reason if one was rejected. The other vouchers and entries are in the company’s books.',
    'تەنها ئەو سەنەدانەی خۆت ئامادەت کردوون لێرە دەردەکەون، لەگەڵ دۆخی پەسەندکردن و هۆکاری ڕەتکردنەوە ئەگەر ڕەتکرابێتەوە. سەنەد و قەیدەکانی تر لە دەفتەرەکانی کۆمپانیادان.'
  ],
  s14_notYours: [
    'هذا القيد في دفاتر الشركة. يمكنك فتح السندات التي نظّمتها أنت فقط.',
    'This entry is in the company’s books. You can open only the vouchers you prepared.',
    'ئەم قەیدە لە دەفتەرەکانی کۆمپانیادایە. تەنها دەتوانیت ئەو سەنەدانە بکەیتەوە کە خۆت ئامادەت کردوون.'
  ],
  // a supplier's statement for someone who does not keep the books: the balance, and where the rest is
  s14_statementInBooks: [
    'حركات هذا الحساب في دفاتر الشركة. يظهر لك هنا الرصيد فقط.',
    'The movements of this account are in the company’s books. Only the balance is shown to you here.',
    'جووڵەکانی ئەم هەژمارە لە دەفتەرەکانی کۆمپانیادان. لێرە تەنها ڕەسیدت پیشان دەدرێت.'
  ],
  s14_openVoucher: ['فتح السند', 'Open the voucher', 'کردنەوەی سەنەد'],

  // vouchers that wait for approval
  s14_waiting: ['بانتظار الموافقة', 'Waiting for approval', 'چاوەڕێی پەسەندکردن'],
  s14_rejected: ['مرفوض', 'Rejected', 'ڕەتکراوە'],
  s14_approve: ['موافقة وترحيل', 'Approve & post', 'پەسەندکردن و تەرحیلکردن'],
  s14_reject: ['رفض', 'Reject', 'ڕەتکردنەوە'],
  s14_rejectTitle: ['رفض السند', 'Reject the voucher', 'ڕەتکردنەوەی سەنەد'],
  s14_rejectHelp: [
    'يبقى السند مسودة خارج الأرصدة، ويرى منظّمه السبب فيصحّحه ويرسله من جديد، أو يسحبه.',
    'The voucher stays a draft, out of every balance; whoever prepared it sees the reason, and corrects it and sends it again, or withdraws it.',
    'سەنەدەکە وەک ڕەشنووس دەمێنێتەوە و ناچێتە هیچ ڕەسیدێک؛ ئامادەکارەکەی هۆکارەکە دەبینێت، ڕاستی دەکاتەوە و دووبارە دەینێرێت، یان دەیکێشێتەوە.'
  ],
  s14_rejectReason: ['سبب الرفض', 'Reason', 'هۆکاری ڕەتکردنەوە'],
  s14_rejectedToast: ['رُفض السند', 'Voucher rejected', 'سەنەدەکە ڕەت کرایەوە'],
  s14_waitingNote: [
    'هذا السند بانتظار الموافقة (طلبها {u})، ولا يؤثر في الأرصدة قبلها.',
    'This voucher waits for approval (asked by {u}). It changes no balance until it is approved.',
    'ئەم سەنەدە چاوەڕێی پەسەندکردنە (داواکار: {u}). تا پەسەند نەکرێت هیچ ڕەسیدێک ناگۆڕێت.'
  ],
  s14_rejectedNote: ['رفضه {u}: {r}', 'Rejected by {u}: {r}', '{u} ڕەتی کردەوە: {r}'],
  s14_rejectedFix: [
    'عدّله ليُرسل للموافقة من جديد، أو احذفه.',
    'Change it to send it for approval again, or delete it.',
    'بیگۆڕە بۆ ئەوەی دووبارە بنێردرێت بۆ پەسەندکردن، یان بیسڕەوە.'
  ],
  s14_approvedNote: ['وافق عليه {u} بعد طلب {p}.', 'Approved by {u}, asked by {p}.', '{u} پەسەندی کرد، بە داوای {p}.'],
  s14_needTitle: ['السندات تحتاج موافقة', 'Vouchers need approval', 'سەنەدەکان پێویستیان بە پەسەندکردنە'],
  s14_needHelp: [
    'عند التفعيل، سندات من ليست له صلاحية المصادقة تُحفظ «بانتظار الموافقة» ولا تؤثر في الأرصدة حتى يوافق عليها من له الصلاحية، أو يرفضها مع السبب. الصلاحية تُمنح بدور «المصادق» لأي مستخدم، وهي للمدير دائماً؛ وسندات صاحبها تُعتمد فوراً.',
    'When on, vouchers made by users who may not approve vouchers are saved as “waiting for approval” and change no balance until someone who may approves them, or rejects them with a reason. Give the permission to any user with the Approver role (admins always have it); vouchers made by someone who has it are approved at once.',
    'کاتێک چالاک بێت، سەنەدی ئەو بەکارهێنەرانەی دەسەڵاتی پەسەندکردنیان نییە وەک «چاوەڕێی پەسەندکردن» پاشەکەوت دەکرێت و هیچ ڕەسیدێک ناگۆڕێت تا کەسێک کە دەسەڵاتی هەیە پەسەندی بکات، یان بە هۆکارەوە ڕەتی بکاتەوە. دەسەڵاتەکە بە ڕۆڵی «پەسەندکەر» بە هەر بەکارهێنەرێک دەدرێت (بەڕێوەبەر هەمیشە هەیەتی)؛ سەنەدی خاوەن دەسەڵات یەکسەر پەسەند دەکرێت.'
  ],
  s14_needWaiting: ['{n} بانتظار الموافقة', '{n} waiting for approval', '{n} چاوەڕێی پەسەندکردن'],
  s14_saveApprove: ['حفظ واعتماد', 'Save and approve', 'پاشەکەوت و پەسەندکردن'],
  s14_saveSend: ['حفظ وإرسال للموافقة', 'Save and send for approval', 'پاشەکەوت و ناردن بۆ پەسەندکردن'],
  err_invoice_invalid: [
    'هذه الفاتورة لم تعد مفتوحة للدفع: أُلغيت أو تغيّرت. أغلق هذا النموذج وابدأ من سطر الزبون أو المجهز.',
    'This invoice is no longer open for payment: it was cancelled or changed. Close this form and start again from the customer’s or supplier’s row.',
    'ئەم پسوولەیە چیتر بۆ پارەدان کراوە نییە: هەڵوەشێنراوەتەوە یان گۆڕاوە. ئەم فۆڕمە دابخە و لە ڕیزی کڕیار یان دابینکەرەوە دەست پێ بکەوە.'
  ],
  err_reject_reason_required: ['اكتب سبب الرفض (حتى 300 حرف).', 'Write the reason (up to 300 characters).', 'هۆکاری ڕەتکردنەوە بنووسە (تا 300 پیت).']
} as const satisfies Record<string, readonly [string, string, string]>;
