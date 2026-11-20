/** 2.0.0 (the hands-on review): a return at the till, and the other usability fixes. Arabic, English, Kurdish. */
export const UXF_TEXT = {
  ux_tillReturn: ['إرجاع من نقطة البيع', 'Return at the till', 'گەڕاندنەوە لە خاڵی فرۆشتن'],
  ux_receiptNumber: ['رقم الوصل', 'Receipt number', 'ژمارەی وەسڵ'],
  ux_receiptHint: ['اكتب رقم الوصل أو امسح الباركود المطبوع عليه، ثم اختر ما يعود.', 'Type the receipt number or scan its barcode, then pick what comes back.', 'ژمارەی وەسڵەکە بنووسە یان بارکۆدەکەی سەری بخوێنەوە، پاشان ئەوە هەڵبژێرە کە دەگەڕێتەوە.'],
  ux_find: ['بحث', 'Find', 'بدۆزەوە'],
  ux_returnAll: ['إرجاع الكل', 'Return everything', 'هەمووی بگەڕێنەوە'],
  ux_sold: ['المباع', 'Sold', 'فرۆشراو'],
  ux_left: ['يمكن إرجاعه', 'Can come back', 'دەتوانرێت بگەڕێتەوە'],
  ux_back: ['يعود الآن', 'Back now', 'ئێستا دەگەڕێتەوە'],
  ux_refundAbout: ['يُرَدّ للزبون (تقريباً)', 'Paid back (about)', 'دەدرێتەوە بە کڕیار (نزیکەی)'],
  ux_returnNeedsPin: ['يحتاج الإرجاع رمز المشرف قبل الإرسال.', 'A supervisor’s PIN is asked before the return is sent.', 'پێش ناردنی گەڕاندنەوەکە ژمارەی نهێنیی سەرپەرشتیار داوا دەکرێت.'],
  ux_giveBack: ['إرجاع ورد المبلغ', 'Return and pay back', 'بگەڕێنەوە و پارەکە بدەرەوە'],
  ux_returnOffline: ['الإرجاع يحتاج الاتصال بالخادم.', 'A return needs the server.', 'گەڕاندنەوە پێویستی بە سێرڤەرە.'],
  ux_returnDone: ['تم الإرجاع: {n}', 'Returned: {n}', 'گەڕێندرایەوە: {n}'],
  ux_noReturnsTitle: ['لا مرتجعات بعد', 'No returns yet', 'هێشتا گەڕاندنەوە نییە'],
  ux_noReturnsYet: ['يُعمل المرتجع من الفاتورة نفسها (زر «إرجاع») أو من نقطة البيع.', 'A return is made from the invoice itself (its Return button) or at the till.', 'گەڕاندنەوە لە خودی پسوولەکەوە دەکرێت (دوگمەی «گەڕاندنەوە») یان لە خاڵی فرۆشتن.'],
  err_pos_return_sale_not_found: ['لا توجد عملية بيع من نقطة البيع بهذا الرقم.', 'No till sale has this number.', 'هیچ فرۆشتنێکی خاڵی فرۆشتن بەم ژمارەیە نییە.'],
  err_pos_return_not_till_sale: ['هذه الفاتورة لم تُبع من نقطة البيع؛ أرجعها من صفحة الفاتورة.', 'This invoice was not sold at a till; return it from the invoice’s page.', 'ئەم پسوولەیە لە خاڵی فرۆشتن نەفرۆشراوە؛ لە پەڕەی پسوولەکەوە بیگەڕێنەوە.'],
  err_pos_return_nothing: ['اختر كمية واحدة على الأقل للإرجاع.', 'Pick at least one quantity to return.', 'لانیکەم یەک بڕ بۆ گەڕاندنەوە هەڵبژێرە.'],
  err_pos_return_number_required: ['اكتب رقم الوصل.', 'Type the receipt number.', 'ژمارەی وەسڵەکە بنووسە.']
} as const;
