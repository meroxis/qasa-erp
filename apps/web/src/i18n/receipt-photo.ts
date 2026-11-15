/**
 * 1.5: the photo of a paper receipt kept with a voucher (an expense recorded on the phone app), and what arrived of a
 * purchase order recorded from a phone. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const RECEIPT_PHOTO_TEXT = {
  rp_title: ['صورة الوصل', 'Photo of the receipt', 'وێنەی وەسڵەکە'],
  rp_open: ['عرض بالحجم الكامل', 'Show full size', 'پیشاندان بە قەبارەی تەواو'],
  rp_by: ['أضافها {u}', 'Added by {u}', 'زیادکراوە لەلایەن {u}'],
  rp_failed: ['تعذّر عرض الصورة.', 'Couldn’t show the photo.', 'نەتوانرا وێنەکە پیشان بدرێت.'],
  a_attach_photo: ['إرفاق صورة', 'Photo attached', 'وێنە هاوپێچ کرا'],
  err_photo_invalid: ['هذه ليست صورة JPEG صالحة.', 'That isn’t a valid JPEG photo.', 'ئەمە وێنەیەکی JPEG ی دروست نییە.'],
  err_photo_too_large: ['الصورة كبيرة جداً (الحد 400 كيلوبايت).', 'The photo is too large (400 KB at most).', 'وێنەکە زۆر گەورەیە (زۆرترین 400 کیلۆبایت).'],
  err_po_over_remaining: ['الكمية أكثر من المتبقي في أمر الشراء', 'More than is still to come on the order', 'بڕەکە زیاترە لەوەی لە داواکاریی کڕیندا ماوە'],
  err_po_line_unknown: ['هذه المادة ليست في أمر الشراء', 'This item isn’t on the purchase order', 'ئەم کاڵایە لە داواکاریی کڕیندا نییە']
} as const satisfies Record<string, readonly [string, string, string]>;
