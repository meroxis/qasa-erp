/** Menu and dialog texts in Arabic, English and Kurdish (Sorani). The app's pages have their own texts. */
export type Lang = 'ar' | 'en' | 'ku';

const T = {
  file: ['ملف', 'File', 'فایل'],
  openData: ['فتح مجلد البيانات', 'Open data folder', 'کردنەوەی بوخچەی داتا'],
  quit: ['خروج', 'Quit', 'دەرچوون'],
  view: ['عرض', 'View', 'پیشاندان'],
  reload: ['إعادة تحميل', 'Reload', 'نوێکردنەوە'],
  zoomIn: ['تكبير', 'Zoom in', 'گەورەکردن'],
  zoomOut: ['تصغير', 'Zoom out', 'بچووککردنەوە'],
  zoomReset: ['الحجم الأصلي', 'Actual size', 'قەبارەی ئاسایی'],
  fullScreen: ['ملء الشاشة', 'Full screen', 'پڕ بە شاشە'],
  help: ['مساعدة', 'Help', 'یارمەتی'],
  checkUpdates: ['التحقق من التحديثات', 'Check for updates', 'پشکنینی نوێکردنەوە'],
  website: ['موقع qasaerp.com', 'qasaerp.com website', 'ماڵپەڕی qasaerp.com'],
  about: ['حول قاصة ERP', 'About Qasa ERP', 'دەربارەی قاسە ERP'],
  aboutText: ['قاصة ERP {v}\nمنتج من Meroxis\nhttps://qasaerp.com', 'Qasa ERP {v}\nA product of Meroxis\nhttps://qasaerp.com', 'قاسە ERP {v}\nبەرهەمێکی Meroxis ـە\nhttps://qasaerp.com'],
  ok: ['حسناً', 'OK', 'باشە'],
  updateReadyTitle: ['تحديث جاهز', 'Update ready', 'نوێکردنەوە ئامادەیە'],
  updateReady: ['الإصدار {v} من قاصة ERP جاهز. أعد التشغيل الآن لتثبيته؟ بياناتك محفوظة.', 'Qasa ERP {v} is ready. Restart now to install it? Your data is kept.', 'وەشانی {v}ی قاسە ERP ئامادەیە. ئێستا دەستپێبکەرەوە بۆ دامەزراندنی؟ داتاکانت دەپارێزرێن.'],
  restartNow: ['أعد التشغيل الآن', 'Restart now', 'ئێستا دەستپێبکەرەوە'],
  later: ['لاحقاً', 'Later', 'دواتر'],
  upToDate: ['لديك أحدث إصدار ({v}).', 'You have the latest version ({v}).', 'نوێترین وەشانت هەیە ({v}).'],
  downloading: ['يوجد إصدار جديد ({v})، يجري تنزيله وسننبّهك عند جاهزيته.', 'A new version ({v}) is downloading. We’ll let you know when it’s ready.', 'وەشانێکی نوێ ({v}) دادەبەزێت. کاتێک ئامادە بوو ئاگادارت دەکەینەوە.'],
  updateError: ['تعذر التحقق من التحديثات. تحقق من الاتصال بالإنترنت وحاول لاحقاً.', 'Couldn’t check for updates. Check the internet connection and try again later.', 'نەتوانرا نوێکردنەوە بپشکنرێت. پەیوەندیی ئینتەرنێت بپشکنە و دواتر هەوڵ بدەرەوە.'],
  startFailed: ['تعذر تشغيل قاصة ERP', 'Qasa ERP couldn’t start', 'قاسە ERP نەتوانرا دەستپێبکات']
} as const;

export type TextKey = keyof typeof T;

export function text(lang: Lang, key: TextKey, vars: Record<string, string> = {}): string {
  let s: string = T[key][lang === 'ar' ? 0 : lang === 'ku' ? 2 : 1];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function isLang(value: unknown): value is Lang {
  return value === 'ar' || value === 'en' || value === 'ku';
}
