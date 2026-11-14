/**
 * Printing in 1.4: the gallery of ready-made designs, the parts added to "what the paper shows", the balance before
 * and after a paper, and the company logo as a paid feature. Arabic, English and Kurdish (Sorani), in that order,
 * like i18n.ts.
 */
export const PRINT14_TEXT = {
  // the gallery
  pd_gallery: ['التصميم', 'Design', 'دیزاین'],
  pd_galleryHint: [
    'اختر تصميماً جاهزاً، ثم غيّر اللون والشعار وما يظهر كما تريد.',
    'Pick a ready-made design, then change its colour, logo and what it shows as you like.',
    'دیزاینێکی ئامادە هەڵبژێرە، پاشان ڕەنگ و لۆگۆ و ئەوەی دەردەکەوێت بە دڵی خۆت بگۆڕە.'
  ],
  pd_g_classic: ['الافتراضي', 'Standard', 'بنەڕەتی'],
  pd_g_classic_d: ['تصميم البرنامج المعتاد', 'The program’s usual design', 'دیزاینی ئاسایی بەرنامەکە'],
  pd_g_modernLines: ['حديث بخطوط', 'Modern with lines', 'نوێ بە هێڵ'],
  pd_g_modernLines_d: ['شريط ملوّن وجدول بخطوط بين الصفوف والأعمدة', 'A colour band and a table ruled between rows and columns', 'هێڵێکی ڕەنگاوڕەنگ و خشتەیەک بە هێڵ لە نێوان ڕیز و ستوونەکان'],
  pd_g_ledger: ['دفتري كلاسيكي', 'Classic ledger', 'دەفتەری کلاسیکی'],
  pd_g_ledger_d: ['أبيض وأسود، جدول مسطّر كاملاً، يوفّر الحبر', 'Black and white, a fully ruled table, saves ink', 'ڕەش و سپی، خشتەی تەواو هێڵکراو، مەرەکەب پاشەکەوت دەکات'],
  pd_g_modern: ['حديث', 'Modern', 'نوێ'],
  pd_g_modern_d: ['رأس جدول ملوّن وصفوف متناوبة', 'A coloured table heading and striped rows', 'سەری خشتەی ڕەنگاوڕەنگ و ڕیزی یەک لە دوای یەک'],
  pd_g_halfPage: ['نصف صفحة (A5)', 'Half page (A5)', 'نیو پەڕە (A5)'],
  pd_g_halfPage_d: ['مضغوط لورق A5', 'Tight, for A5 paper', 'چڕ، بۆ پەڕەی A5'],
  pd_g_receipt80: ['إيصال حراري 80 مم', '80 mm thermal receipt', 'پسوولەی گەرمی 80 ملم'],
  pd_g_receipt80_d: ['لطابعة الإيصالات', 'For a receipt printer', 'بۆ چاپکەری پسوولە'],
  pd_layout_modernLines: ['حديث بخطوط', 'Modern with lines', 'نوێ بە هێڵ'],
  pd_layout_ledger: ['دفتري كلاسيكي', 'Classic ledger', 'دەفتەری کلاسیکی'],

  // text size by name
  pd_textSize: ['حجم الخط', 'Text size', 'قەبارەی نووسین'],
  pd_size_small: ['صغير', 'Small', 'بچووک'],
  pd_size_normal: ['عادي', 'Normal', 'ئاسایی'],
  pd_size_large: ['كبير', 'Large', 'گەورە'],
  pd_size_custom: ['حجم آخر ({n} نقطة)', 'Another size ({n} pt)', 'قەبارەیەکی تر ({n} خاڵ)'],

  // what the paper shows, in groups
  pd_grp_company: ['الشركة', 'Company', 'کۆمپانیا'],
  pd_grp_party: ['الزبون أو المجهز', 'Customer or supplier', 'کڕیار یان دابینکەر'],
  pd_grp_lines: ['المواد', 'Items', 'کاڵاکان'],
  pd_grp_totals: ['المجاميع', 'Totals', 'کۆکان'],
  pd_grp_foot: ['أسفل الورقة', 'Bottom of the paper', 'خوارەوەی پەڕە'],
  pd_f_logo: ['الشعار', 'Logo', 'لۆگۆ'],
  pd_f_companyAddress: ['عنوان الشركة', 'Company address', 'ناونیشانی کۆمپانیا'],
  pd_f_companyPhone: ['هاتف الشركة', 'Company phone', 'تەلەفۆنی کۆمپانیا'],
  pd_f_companyTax: ['الرقم الضريبي', 'Tax number', 'ژمارەی باج'],
  pd_f_partyPhone: ['الهاتف', 'Phone', 'تەلەفۆن'],
  pd_f_partyAddress: ['العنوان', 'Address', 'ناونیشان'],
  pd_f_subtotal: ['المجموع قبل الخصم والخصم', 'Subtotal and discount', 'کۆی بەر لە داشکاندن و داشکاندن'],
  pd_f_notes: ['الملاحظات', 'Notes', 'تێبینییەکان'],
  pd_f_amountWords: ['المبلغ كتابةً', 'Amount in words', 'بڕی پارە بە نووسین'],
  pd_f_exchangeRate: ['سعر الصرف', 'Exchange rate', 'نرخی گۆڕینەوە'],
  pd_f_previousBalance: ['الرصيد السابق', 'Previous balance', 'باڵانسی پێشوو'],
  pd_f_remainingBalance: ['الرصيد المتبقي', 'Remaining balance', 'باڵانسی ماوە'],
  pd_balanceHint: [
    'الرصيد يُطبع على الورقة المرحَّلة التي لها زبون أو مجهز من القائمة.',
    'The balance prints on a posted paper that has a customer or supplier from the list.',
    'باڵانس لەسەر پەڕەی تۆمارکراو چاپ دەکرێت کە کڕیار یان دابینکەرێکی لیستی هەبێت.'
  ],

  // headings printed on papers (in the paper's language)
  pd_h_previousBalance: ['الرصيد السابق', 'Previous balance', 'باڵانسی پێشوو'],
  pd_h_remainingBalance: ['الرصيد المتبقي', 'Remaining balance', 'باڵانسی ماوە'],
  pd_h_currentBalance: ['رصيد الحساب', 'Account balance', 'باڵانسی هەژمار'],
  pd_h_words: ['المبلغ كتابةً', 'Amount in words', 'بڕی پارە بە نووسین'],
  pd_h_notes: ['ملاحظات', 'Notes', 'تێبینی'],
  pd_h_phone: ['الهاتف', 'Phone', 'تەلەفۆن'],
  pd_h_address: ['العنوان', 'Address', 'ناونیشان'],

  // the company logo: a paid feature
  f_companyLogo: ['شعار الشركة على المطبوعات', 'Your company logo on printed papers', 'لۆگۆی کۆمپانیاکەت لەسەر چاپکراوەکان'],
  pp_logoEarlier: [
    'شعارك المحفوظ سابقاً يبقى يُطبع. تغييره يحتاج إلى خطة مدفوعة.',
    'Your logo, saved earlier, keeps printing. Changing it needs a paid plan.',
    'لۆگۆکەت کە پێشتر پاشەکەوت کراوە هەر چاپ دەکرێت. گۆڕینی پێویستی بە پلانێکی پارەدار هەیە.'
  ],
  pp_logoLocked: [
    'شعار الشركة على المطبوعات من مزايا Starter وPro وBusiness.',
    'Your company logo on printed papers is part of Starter, Pro and Business.',
    'لۆگۆی کۆمپانیا لەسەر چاپکراوەکان بەشێکە لە Starter، Pro و Business.'
  ],
  pp_logoKept: [
    'الشعار المحفوظ باقٍ، ويُطبع من جديد عند تفعيل خطة مدفوعة.',
    'Your saved logo is kept and prints again once a paid plan is active.',
    'لۆگۆ پاشەکەوتکراوەکەت دەمێنێتەوە و دووبارە چاپ دەکرێت کاتێک پلانێکی پارەدار چالاک بێت.'
  ],
  err_plan_limit_companyLogo: [
    'شعار الشركة على المطبوعات من مزايا Starter وPro وBusiness — راجع «الخطة والترخيص».',
    'Your company logo on printed papers is part of Starter, Pro and Business. See Plan & license.',
    'لۆگۆی کۆمپانیا لەسەر چاپکراوەکان بەشێکە لە Starter، Pro و Business — «پلان و مۆڵەت» ببینە.'
  ],
  err_pp_logo_too_wide: [
    'الشعار أكبر من 2000 بكسل في العرض أو الارتفاع.',
    'The logo is over 2000 pixels wide or high.',
    'لۆگۆکە لە 2000 پیکسڵ پانتر یان بەرزترە.'
  ]
} as const;
