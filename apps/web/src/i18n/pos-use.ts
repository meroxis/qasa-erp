/**
 * Whether the company uses the point of sale (1.5.2): Settings → Sales and point of sale → Use the point of sale, and
 * the page the till's address shows when it is off. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const POS_USE_TEXT = {
  pu_title: ['استعمال نقطة البيع (الكاشير)', 'Use the point of sale', 'بەکارهێنانی خاڵی فرۆشتن (کاشێر)'],
  pu_help: [
    'للشركة كلها وعلى كل الحواسيب. عند تشغيلها تظهر نقطة البيع في القائمة والصفحة الرئيسية والبحث، للبيع السريع على الكاونتر. فواتير المبيعات تبقى كما هي.',
    'For the whole company, on every PC. When on, the point of sale shows in the menu, on the home page and in the search, for quick sales at a counter. Sales invoices stay as they are.',
    'بۆ هەموو کۆمپانیاکە و لەسەر هەموو کۆمپیوتەرەکان. کاتێک کارایە، خاڵی فرۆشتن لە لیست و پەڕەی سەرەکی و گەڕاندا دەردەکەوێت، بۆ فرۆشتنی خێرا لەسەر کاونتەر. پسوولەکانی فرۆشتن وەک خۆیان دەمێننەوە.'
  ],
  pu_on: ['نستعملها', 'Use it', 'بەکاری دەهێنین'],
  pu_off: ['لا نستعملها', 'Don’t use it', 'بەکاری ناهێنین'],
  // under the choice while it still follows the business type (nobody has chosen yet)
  pu_autoOn: [
    'مفعّلة حسب نشاط الشركة.',
    'On, from the business type.',
    'کارایە بەپێی جۆری چالاکی کۆمپانیا.'
  ],
  pu_autoOff: [
    'غير مفعّلة حسب نشاط الشركة (لا يبيع على الكاونتر).',
    'Off, from the business type (it doesn’t sell at a counter).',
    'ناکارایە بەپێی جۆری چالاکی کۆمپانیا (لەسەر کاونتەر نافرۆشێت).'
  ],
  pu_autoUsed: [
    'مفعّلة لأن الشركة باعت بنقطة البيع من قبل.',
    'On, because the company has sold at the point of sale before.',
    'کارایە چونکە کۆمپانیاکە پێشتر بە خاڵی فرۆشتن فرۆشتووە.'
  ],
  // against an office server not yet updated: it keeps no such choice
  pu_oldServer: [
    'حدّث قاصة ERP على حاسوب خادم المكتب لتغيير هذا الخيار؛ حتى ذلك تظهر نقطة البيع.',
    'Update Qasa ERP on the office server PC to change this; until then the point of sale shows.',
    'قاسە ERP لەسەر کۆمپیوتەری سێرڤەری نووسینگە نوێ بکەرەوە بۆ گۆڕینی ئەمە؛ تا ئەو کاتە خاڵی فرۆشتن دەردەکەوێت.'
  ],
  // the till's address while the company does not use it
  pu_offTitle: ['نقطة البيع غير مستعملة في هذه الشركة', 'This company doesn’t use the point of sale', 'ئەم کۆمپانیایە خاڵی فرۆشتن بەکارناهێنێت'],
  pu_offAdmin: [
    'للبيع على الكاونتر شغّل «استعمال نقطة البيع» في الإعدادات ← المبيعات ونقطة البيع. ويمكن البيع بفواتير المبيعات دائماً.',
    'To sell at a counter, turn on “Use the point of sale” in Settings → Sales and point of sale. Sales invoices are always there.',
    'بۆ فرۆشتن لەسەر کاونتەر «بەکارهێنانی خاڵی فرۆشتن» لە ڕێکخستنەکان ← فرۆشتن و خاڵی فرۆشتن هەڵبکە. پسوولەکانی فرۆشتن هەمیشە هەن.'
  ],
  pu_offOther: [
    'غير متاحة هنا. يمكن البيع بفواتير المبيعات، أو اطلب من مدير النظام تشغيلها.',
    'Not available here. You can sell with sales invoices, or ask the admin to turn it on.',
    'لێرە بەردەست نییە. دەتوانیت بە پسوولەکانی فرۆشتن بفرۆشیت، یان داوا لە بەڕێوەبەری سیستەم بکە هەڵیبکات.'
  ],
  pu_openSetting: ['فتح الإعداد', 'Open the setting', 'کردنەوەی ڕێکخستنەکە']
} as const satisfies Record<string, readonly [string, string, string]>;
