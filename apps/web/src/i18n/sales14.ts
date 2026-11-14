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
    'سەرەتا کڕیار هەڵبژێرە: فرۆشتنی قەرز لەسەر ئەو تۆمار دەکرێت.'
  ],
  s14_safe: ['القاصة', 'Safe', 'قاسە'],
  s14_salesSectionHelp: ['الصلاحية والوجبات', 'Expiry and batches', 'بەسەرچوون و وەجبەکان'],
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
  s14_balanceBefore: ['الرصيد قبل', 'Balance before', 'ڕەسید پێش'],
  s14_balanceAfter: ['المتبقي بعد', 'Remaining after', 'ماوە دوای'],
  s14_overpaid: [
    'المبلغ أكبر من الرصيد: الزيادة تبقى له.',
    'More than the balance: the extra stays in their favour.',
    'بڕەکە لە ڕەسید زیاترە: زیادەکە بۆ ئەو دەمێنێتەوە.'
  ],
  s14_forInvoice: ['عن الفاتورة {n}', 'For invoice {n}', 'بۆ پسوولەی {n}'],
  s14_posted: ['رُحّل السند {n}', 'Voucher {n} posted', 'سەنەدی {n} تۆمار کرا'],
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
  // someone who does not keep the books sees the vouchers they prepared, and no other
  s14_myVouchers: ['سنداتي', 'My vouchers', 'سەنەدەکانم'],
  s14_myVouchersHelp: [
    'تظهر هنا السندات التي نظّمتها أنت فقط، مع حالة الموافقة وسبب الرفض إن رُفضت. بقية السندات والقيود في دفاتر الشركة.',
    'Only the vouchers you prepared are listed here, with their approval and the reason if one was rejected. The other vouchers and entries are in the company’s books.',
    'تەنها ئەو سەنەدانەی خۆت ئامادەت کردوون لێرە دەردەکەون، لەگەڵ دۆخی پەسەندکردن و هۆکاری ڕەتکردنەوە ئەگەر ڕەتکرابێتەوە. سەنەد و تۆمارەکانی تر لە دەفتەرەکانی کۆمپانیادان.'
  ],
  s14_notYours: [
    'هذا القيد في دفاتر الشركة. يمكنك فتح السندات التي نظّمتها أنت فقط.',
    'This entry is in the company’s books. You can open only the vouchers you prepared.',
    'ئەم تۆمارە لە دەفتەرەکانی کۆمپانیادایە. تەنها دەتوانیت ئەو سەنەدانە بکەیتەوە کە خۆت ئامادەت کردوون.'
  ],
  s14_openVoucher: ['فتح السند', 'Open the voucher', 'کردنەوەی سەنەد'],

  // vouchers that wait for approval
  s14_waiting: ['بانتظار الموافقة', 'Waiting for approval', 'چاوەڕێی پەسەندکردن'],
  s14_rejected: ['مرفوض', 'Rejected', 'ڕەتکراوە'],
  s14_approve: ['موافقة وترحيل', 'Approve & post', 'پەسەندکردن و تۆمارکردن'],
  s14_reject: ['رفض', 'Reject', 'ڕەتکردنەوە'],
  s14_rejectTitle: ['رفض السند', 'Reject the voucher', 'ڕەتکردنەوەی سەنەد'],
  s14_rejectHelp: [
    'يبقى السند مسودة خارج الأرصدة، ويرى منظّمه السبب ليصحّحه أو يحذفه.',
    'The voucher stays a draft, out of every balance; whoever prepared it sees the reason and corrects or deletes it.',
    'سەنەدەکە وەک ڕەشنووس دەمێنێتەوە و ناچێتە هیچ ڕەسیدێک؛ ئامادەکارەکەی هۆکارەکە دەبینێت و ڕاستی دەکاتەوە یان دەیسڕێتەوە.'
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
  err_reject_reason_required: ['اكتب سبب الرفض (حتى 300 حرف).', 'Write the reason (up to 300 characters).', 'هۆکاری ڕەتکردنەوە بنووسە (تا 300 پیت).']
} as const satisfies Record<string, readonly [string, string, string]>;
