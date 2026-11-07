/** Invoice QR codes and qasaerp.com/v/. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const VERIFY_TEXT = {
  vf_qrLabel: ['رمز QR للتحقق من الفاتورة', 'QR code to check this invoice', 'کۆدی QR بۆ پشکنینی ئەم پسوولەیە'],
  vf_scanVerified: ['امسح الرمز بكاميرا الهاتف للتأكد من أن هذه الفاتورة صادرة عنا وأنها لم تُغيَّر.', 'Scan with a phone camera to check this invoice came from us and was not changed.', 'بە کامێرای مۆبایل سکانی بکە بۆ دڵنیابوون لەوەی ئەم پسوولەیە لە ئێمەوە دەرچووە و نەگۆڕدراوە.'],
  vf_scanDetails: ['امسح الرمز بكاميرا الهاتف لرؤية رقم الفاتورة وتاريخها ومبلغها.', 'Scan with a phone camera to see the invoice number, date and total.', 'بە کامێرای مۆبایل سکانی بکە بۆ بینینی ژمارە و بەروار و بڕی پسوولەکە.'],
  err_qr_needs_posted_sale: ['رمز QR يكون لفواتير المبيعات المرحّلة فقط.', 'Only posted sale invoices have a QR code.', 'تەنها پسوولەی فرۆشتنی تۆمارکراو کۆدی QR ی هەیە.']
} as const satisfies Record<string, readonly [string, string, string]>;
