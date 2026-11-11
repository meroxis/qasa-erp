/** Subcategories, brands and starter lists (1.1). Arabic, English and Kurdish (Sorani), in that order. */
export const CATALOG_TEXT = {
  cat_parent: ['التصنيف الرئيسي', 'Parent category', 'پۆلی سەرەکی'],
  cat_topLevel: ['— تصنيف رئيسي —', '— Top-level category —', '— پۆلی سەرەکی —'],
  cat_newSub: ['تصنيف فرعي', 'Subcategory', 'پۆلی لاوەکی'],
  cat_subs: ['الفرعية', 'Subcategories', 'لاوەکییەکان'],
  err_category_parent_invalid: [
    'لا يصلح هذا التصنيف رئيسياً: يجب أن يكون تصنيفاً رئيسياً فعّالاً (مستويان فقط).',
    'That parent can’t be used: it must be an active top-level category (two levels only).',
    'ئەو پۆلە ناکرێتە سەرەکی: دەبێت پۆلێکی سەرەکیی چالاک بێت (تەنها دوو ئاست).'
  ],
  err_category_has_subcategories: [
    'لهذا التصنيف تصنيفات فرعية، فيبقى تصنيفاً رئيسياً.',
    'This category has subcategories, so it stays a top-level category.',
    'ئەم پۆلە پۆلی لاوەکیی هەیە، بۆیە پۆلی سەرەکی دەمێنێتەوە.'
  ],
  err_too_many: ['بلغت القائمة حدها الأعلى.', 'The list has reached its limit.', 'لیستەکە گەیشتووەتە سنووری خۆی.'],
  bnd_title: ['الماركات', 'Brands', 'براندەکان'],
  bnd_brand: ['الماركة', 'Brand', 'براند'],
  bnd_none: ['بلا ماركة', 'No brand', 'بێ براند'],
  bnd_all: ['كل الماركات', 'All brands', 'هەموو براندەکان'],
  bnd_new: ['ماركة جديدة', 'New brand', 'براندی نوێ'],
  bnd_help: [
    'ماركات المواد: قائمة واحدة لكل المواد، ومنها قطع السيارات. يُكتب اسم الماركة كما هو، ويمكن إضافة كتابته بالعربية والكردية.',
    'The brands of your items: one list for every item, car parts included. A brand is written as it is; an Arabic and a Kurdish spelling can be added.',
    'براندی کاڵاکان: یەک لیست بۆ هەموو کاڵاکان، پارچەی ئۆتۆمبێلیشەوە. ناوی براند وەک خۆی دەنووسرێت؛ دەتوانرێت نووسینی عەرەبی و کوردیشی بۆ زیاد بکرێت.'
  ],
  bnd_name: ['اسم الماركة', 'Brand name', 'ناوی براند'],
  bnd_nameAr: ['الكتابة بالعربية (اختياري)', 'Arabic spelling (optional)', 'نووسینی عەرەبی (ئارەزوومەندانە)'],
  bnd_nameKu: ['الكتابة بالكردية (اختياري)', 'Kurdish spelling (optional)', 'نووسینی کوردی (ئارەزوومەندانە)'],
  bnd_country: ['بلد المنشأ', 'Country of origin', 'وڵاتی بەرهەمهێنان'],
  bnd_saved: ['حُفظت الماركة', 'Brand saved', 'براندەکە پاشەکەوت کرا'],
  bnd_add: ['إضافة ماركة', 'Add a brand', 'زیادکردنی براند'],
  err_brand_exists: ['توجد ماركة بهذا الاسم.', 'A brand with that name exists already.', 'براندێک بەو ناوە هەیە.'],
  err_brand_invalid: ['الماركة غير موجودة أو متوقفة.', 'That brand doesn’t exist or is switched off.', 'ئەو براندە نییە یان ناچالاکە.'],
  err_brand_name_too_long: ['اسم الماركة أطول من 100 حرف.', 'The brand name is longer than 100 characters.', 'ناوی براندەکە لە 100 پیت درێژترە.'],
  err_country_invalid: ['اختر البلد من القائمة.', 'Choose the country from the list.', 'وڵاتەکە لە لیستەکە هەڵبژێرە.'],
  st_add: ['إضافة قائمة جاهزة', 'Add a starter list', 'زیادکردنی لیستی ئامادە'],
  st_help: [
    'تصنيفات وتصنيفات فرعية وماركات معروفة لنوع تجارتك، تعدّلها بعد ذلك كما تشاء. ما هو موجود بالاسم نفسه لا يُضاف، فالإضافة مرتين لا تكرر شيئاً.',
    'Categories, subcategories and well-known brands for your trade, to change as you like afterwards. Anything already there by name is skipped, so adding it twice adds nothing twice.',
    'پۆل و پۆلی لاوەکی و براندی ناسراو بۆ جۆری بازرگانییەکەت، دواتر چۆنت بوێت دەیانگۆڕیت. ئەوەی بە هەمان ناو هەیە زیاد ناکرێتەوە، بۆیە دووجار زیادکردن هیچ دووبارە ناکاتەوە.'
  ],
  st_trade: ['نوع التجارة', 'Trade', 'جۆری بازرگانی'],
  st_added: ['أُضيف: تصنيفات {c}، تصنيفات فرعية {s}، ماركات {b}.', 'Added {c} categories, {s} subcategories and {b} brands.', '{c} پۆل و {s} پۆلی لاوەکی و {b} براند زیاد کران.'],
  rl_minimum: ['الحد الأدنى للمخزون', 'Minimum stock', 'کەمترین بڕی کۆگا'],
  cat_filterItems: ['عرض مواد التصنيف', 'Show items of a category', 'پیشاندانی کاڵاکانی پۆلێک'],
  cat_back: ['رجوع', 'Back', 'گەڕانەوە'],
  rp_byCategory: ['المبيعات حسب التصنيف', 'Sales by category', 'فرۆشتن بەپێی پۆل'],
  rp_byBrand: ['المبيعات حسب الماركة', 'Sales by brand', 'فرۆشتن بەپێی براند'],
  rp_uncategorised: ['بلا تصنيف', 'Uncategorised', 'بێ پۆل'],
  rp_noBrand: ['بلا ماركة', 'No brand', 'بێ براند'],
  rp_direct: ['في التصنيف نفسه', 'In the category itself', 'لە خودی پۆلەکەدا'],
  md_fCategory: ['التصنيف', 'Category', 'پۆل'],
  md_fSubcategory: ['التصنيف الفرعي', 'Subcategory', 'پۆلی لاوەکی'],
  md_fBrand: ['الماركة', 'Brand', 'براند'],
  md_fPurchasePrice: ['سعر الشراء', 'Purchase price', 'نرخی کڕین'],
  md_fOpeningQty: ['كمية أول المدة', 'Opening quantity', 'بڕی سەرەتای کۆگا'],
  err_md_subcategory_without_category: ['الصف {n}: تصنيف فرعي بلا تصنيف رئيسي.', 'Row {n}: a subcategory without its category.', 'ڕیزی {n}: پۆلی لاوەکی بێ پۆلی سەرەکی.'],
  err_md_item_has_moves: [
    'الصف {n}: لهذه المادة حركات مخزنية، فلا تُضاف لها كمية أول المدة.',
    'Row {n}: this item has stock moves already, so no opening quantity is added to it.',
    'ڕیزی {n}: ئەم کاڵایە جووڵەی کۆگای هەیە، بۆیە بڕی سەرەتای بۆ زیاد ناکرێت.'
  ],
  st_nothing: ['القائمة موجودة كلها؛ لم يُضف شيء.', 'Everything in the list is there already; nothing was added.', 'هەموو لیستەکە هەیە؛ هیچ زیاد نەکرا.']
} as const;
