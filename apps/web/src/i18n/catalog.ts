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
  ro_title: ['مواد للطلب', 'Reorder', 'کاڵا بۆ داواکردنەوە'],
  ro_count: ['{n} مادة عند حدها الأدنى أو تحته', '{n} items at or below their minimum', '{n} کاڵا لە کەمترین بڕی خۆیان یان کەمتر'],
  ro_help: [
    'المواد التي بلغ مخزونها حدها الأدنى أو نزل عنه: حد المادة نفسها، أو حد تصنيفها إن لم يكن لها حد.',
    'Items whose stock is at or below their minimum: the item’s own, or its category’s when it has none.',
    'ئەو کاڵایانەی کۆگاکەیان گەیشتووەتە کەمترین بڕ یان کەمتر: هی خودی کاڵاکە، یان هی پۆلەکەی ئەگەر خۆی نەیبێت.'
  ],
  ro_none: ['لا توجد مادة عند حدها الأدنى.', 'No item is at its minimum.', 'هیچ کاڵایەک لە کەمترین بڕی خۆیدا نییە.'],
  ro_short: ['الناقص', 'Short by', 'کەمی'],
  ro_categoryMinimum: ['الحد الأدنى لمواد التصنيف', 'Minimum for its items', 'کەمترین بڕ بۆ کاڵاکانی'],
  ro_categoryHelp: ['يُستعمل للمواد التي ليس لها حد أدنى خاص بها.', 'Used for items that have no minimum of their own.', 'بۆ ئەو کاڵایانە بەکاردێت کە کەمترین بڕی خۆیان نییە.'],
  err_reorder_invalid: ['الحد الأدنى غير صحيح.', 'The minimum isn’t valid.', 'کەمترین بڕەکە دروست نییە.'],
  ro_minimum: ['الحد الأدنى للمخزون', 'Minimum stock', 'کەمترین بڕی کۆگا'],
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
  so_title: ['البدء من جديد بدفاتر فارغة', 'Start over with empty books', 'دەستپێکردنەوە بە دەفتەری بەتاڵ'],
  so_help: [
    'يحفظ نسخة احتياطية أولاً، ثم يضع ملف الشركة الحالي جانباً في مجلد البيانات (لا يُحذف) ويفتح شركة فارغة لإعدادها من البداية. يبقى الترخيص وتفعيل هذا الحاسوب.',
    'Saves a backup first, then keeps the current company file aside in the data folder (it is never deleted) and opens an empty company to set up from the start. The licence and this PC’s activation stay.',
    'سەرەتا پاڵپشتێک پاشەکەوت دەکات، پاشان فایلی ئێستای کۆمپانیا لە بوخچەی داتادا لادەنێت (هەرگیز ناسڕدرێتەوە) و کۆمپانیایەکی بەتاڵ دەکاتەوە بۆ ڕێکخستن لە سەرەتاوە. مۆڵەت و چالاککردنی ئەم کۆمپیوتەرە دەمێننەوە.'
  ],
  so_button: ['البدء من جديد', 'Start over', 'دەستپێکردنەوە'],
  so_warning: [
    'ستبدأ الشركة فارغة: لا حسابات ولا مواد ولا فواتير. لإرجاع الدفاتر القديمة استرجع النسخة الاحتياطية من الإعدادات ← النسخ الاحتياطي.',
    'The company will start empty: no accounts, items or invoices. To get the old books back, restore the backup in Settings → Backups.',
    'کۆمپانیاکە بەتاڵ دەست پێدەکات: نە هەژمار، نە کاڵا، نە پسوولە. بۆ گەڕاندنەوەی دەفتەرە کۆنەکان، پاڵپشتەکە لە ڕێکخستنەکان ← پاڵپشت بگەڕێنەوە.'
  ],
  so_username: ['اسم مستخدم المدير', 'Admin user name', 'ناوی بەکارهێنەری بەڕێوەبەر'],
  so_password: ['كلمة مرور المدير', 'Admin password', 'وشەی نهێنیی بەڕێوەبەر'],
  so_confirm: ['اكتب اسم الشركة للتأكيد', 'Type the company’s name to confirm', 'ناوی کۆمپانیاکە بنووسە بۆ دڵنیابوونەوە'],
  so_working: ['يحفظ النسخة الاحتياطية…', 'Saving the backup…', 'پاڵپشت پاشەکەوت دەکرێت…'],
  so_done: ['حُفظت النسخة الاحتياطية؛ يُعاد تشغيل البرنامج بشركة فارغة.', 'The backup is saved; the app restarts with an empty company.', 'پاڵپشتەکە پاشەکەوت کرا؛ بەرنامەکە بە کۆمپانیایەکی بەتاڵ دەست پێدەکاتەوە.'],
  so_err_invalid_login: [
    'اسم المستخدم أو كلمة المرور غير صحيحة. يلزم مدير له كلمة مرور (الإعدادات ← المستخدمون).',
    'The user name or password is wrong. An admin with a password is needed (Settings → Users).',
    'ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە. بەڕێوەبەرێک بە وشەی نهێنی پێویستە (ڕێکخستنەکان ← بەکارهێنەران).'
  ],
  so_err_not_admin: ['هذا المستخدم ليس مديراً.', 'This user isn’t an admin.', 'ئەم بەکارهێنەرە بەڕێوەبەر نییە.'],
  so_err_confirmation: ['الاسم المكتوب ليس اسم الشركة.', 'What you typed isn’t the company’s name.', 'ئەوەی نووسیت ناوی کۆمپانیاکە نییە.'],
  so_err_backup_failed: [
    'تعذّر حفظ النسخة الاحتياطية، فلم يتغير شيء. راجع الإعدادات ← النسخ الاحتياطي.',
    'The backup could not be saved, so nothing was changed. See Settings → Backups.',
    'پاڵپشتەکە پاشەکەوت نەکرا، بۆیە هیچ نەگۆڕا. ڕێکخستنەکان ← پاڵپشت ببینە.'
  ],
  so_err_too_many_attempts: ['محاولات كثيرة؛ أعد المحاولة بعد {s} ثانية.', 'Too many tries; try again in {s} seconds.', 'هەوڵی زۆر؛ دوای {s} چرکە دووبارە هەوڵ بدەوە.'],
  so_err_office_client: [
    'هذا الحاسوب متصل بخادم المكتب؛ يُبدأ من جديد على الحاسوب الذي يحفظ الدفاتر فقط.',
    'This PC is connected to an office server; starting over is done only on the PC that keeps the books.',
    'ئەم کۆمپیوتەرە بە ڕاژەکاری ئۆفیسەوە بەستراوە؛ دەستپێکردنەوە تەنها لەسەر ئەو کۆمپیوتەرە دەکرێت کە دەفتەرەکان هەڵدەگرێت.'
  ],
  so_err_start_over_on_server: [
    'الدفاتر على خادم قاعدة بيانات؛ أعدها أولاً إلى ملف شركة (الإعدادات ← قاعدة البيانات).',
    'The books are on a database server; move them back to a company file first (Settings → Database).',
    'دەفتەرەکان لەسەر ڕاژەکاری داتابەیسن؛ سەرەتا بیانگەڕێنەوە بۆ فایلی کۆمپانیا (ڕێکخستنەکان ← داتابەیس).'
  ],
  so_err_error: ['حدث خطأ، فلم يتغير شيء.', 'Something went wrong, so nothing was changed.', 'هەڵەیەک ڕوویدا، بۆیە هیچ نەگۆڕا.'],
  st_nothing: ['القائمة موجودة كلها؛ لم يُضف شيء.', 'Everything in the list is there already; nothing was added.', 'هەموو لیستەکە هەیە؛ هیچ زیاد نەکرا.']
} as const;
