import type { Names } from './lang.ts';
import { normalizeForSearch } from './lang.ts';
import type { BusinessType } from './plans.ts';
import { UNIT_CODES, type UnitCode } from './inventory.ts';

/**
 * The item catalogue's lists (1.1): categories in two levels (a category and its subcategories), brands, the countries a
 * brand comes from, and the starter lists a company can add for its trade. The starter lists are only ever added when
 * someone presses "Add a starter list"; adding one twice adds nothing twice (what exists by name is skipped).
 *
 * Brand names are trade names and are written the same in every language; a brand may also have an Arabic and a
 * Kurdish spelling. To edit a starter list, edit STARTER_LISTS below: names are Arabic, English, Kurdish (Sorani).
 */

/** A brand's name as compared: case, spaces and Arabic/Kurdish letter forms don't count ("Mann Filter" = "MANN filter"). */
export function brandKey(name: string): string {
  return normalizeForSearch(name.normalize('NFKC')).replace(/\s+/g, '');
}

/** A category's name as compared when a starter list checks what is there already (spaces collapsed, any case). */
export function categoryKey(name: string): string {
  return normalizeForSearch(name.normalize('NFKC'));
}

const n = (ar: string, en: string, ku: string): Names => ({ ar, en, ku });

/** Countries a brand comes from, by their ISO 3166 two-letter code. */
export const COUNTRIES = {
  IQ: n('العراق', 'Iraq', 'عێراق'),
  AE: n('الإمارات', 'United Arab Emirates', 'ئیمارات'),
  AT: n('النمسا', 'Austria', 'نەمسا'),
  BR: n('البرازيل', 'Brazil', 'بەڕازیل'),
  CA: n('كندا', 'Canada', 'کەنەدا'),
  CH: n('سويسرا', 'Switzerland', 'سویسرا'),
  CN: n('الصين', 'China', 'چین'),
  DE: n('ألمانيا', 'Germany', 'ئەڵمانیا'),
  DK: n('الدنمارك', 'Denmark', 'دانیمارک'),
  EG: n('مصر', 'Egypt', 'میسر'),
  ES: n('إسبانيا', 'Spain', 'ئیسپانیا'),
  FI: n('فنلندا', 'Finland', 'فینلەندا'),
  FR: n('فرنسا', 'France', 'فەرەنسا'),
  GB: n('المملكة المتحدة', 'United Kingdom', 'بەریتانیا'),
  ID: n('إندونيسيا', 'Indonesia', 'ئیندۆنیزیا'),
  IN: n('الهند', 'India', 'هیندستان'),
  IR: n('إيران', 'Iran', 'ئێران'),
  IT: n('إيطاليا', 'Italy', 'ئیتاڵیا'),
  JO: n('الأردن', 'Jordan', 'ئوردن'),
  JP: n('اليابان', 'Japan', 'ژاپۆن'),
  KR: n('كوريا الجنوبية', 'South Korea', 'کۆریای باشوور'),
  KW: n('الكويت', 'Kuwait', 'کوەیت'),
  LB: n('لبنان', 'Lebanon', 'لوبنان'),
  MY: n('ماليزيا', 'Malaysia', 'مالیزیا'),
  NL: n('هولندا', 'Netherlands', 'هۆڵەندا'),
  NO: n('النرويج', 'Norway', 'نەرویج'),
  PL: n('بولندا', 'Poland', 'پۆڵەندا'),
  SA: n('السعودية', 'Saudi Arabia', 'سعودیە'),
  SE: n('السويد', 'Sweden', 'سوید'),
  TH: n('تايلاند', 'Thailand', 'تایلەند'),
  TR: n('تركيا', 'Turkey', 'تورکیا'),
  TW: n('تايوان', 'Taiwan', 'تایوان'),
  US: n('الولايات المتحدة', 'United States', 'ئەمریکا'),
  VN: n('فيتنام', 'Vietnam', 'ڤێتنام')
} as const satisfies Record<string, Names>;

export type CountryCode = keyof typeof COUNTRIES;

export function isCountry(value: unknown): value is CountryCode {
  return typeof value === 'string' && Object.hasOwn(COUNTRIES, value);
}

/** The most categories (with subcategories) and brands a company keeps. */
export const MAX_CATEGORIES = 2_000;
export const MAX_BRANDS = 5_000;

export interface StarterCategory { name: Names; sub?: readonly Names[] }
export interface StarterBrand { name: string; ar?: string; ku?: string; country?: CountryCode }
export interface StarterList { name: Names; categories: readonly StarterCategory[]; brands: readonly StarterBrand[] }

export const STARTER_TRADES = [
  'general', 'electronics', 'autoParts', 'pharmacy', 'grocery', 'building', 'clothing', 'cosmetics', 'homeAppliances', 'stationery', 'electricalSolar', 'generators'
] as const;
export type StarterTrade = (typeof STARTER_TRADES)[number];

export function isStarterTrade(value: unknown): value is StarterTrade {
  return typeof value === 'string' && (STARTER_TRADES as readonly string[]).includes(value);
}

/** The starter list a business type suggests first (any trade can still be picked). */
export const BUSINESS_STARTER_TRADE: Record<BusinessType, StarterTrade> = {
  trade: 'general', market: 'grocery', realEstate: 'building', mobileShop: 'electronics', autoParts: 'autoParts', engineeringWorks: 'building',
  electricalSolar: 'electricalSolar', generators: 'generators', pharmacy: 'pharmacy'
};

/** The suggested trade for a company: its first business type with a list of its own, else general trade. */
export function starterTradeFor(types: readonly BusinessType[] | undefined): StarterTrade {
  const own = (types ?? []).find((t) => t !== 'trade');
  return own ? BUSINESS_STARTER_TRADE[own] : 'general';
}

// shared category names
const ACCESSORIES = n('إكسسوارات', 'Accessories', 'ئێکسسوارات');
const BATTERIES = n('بطاريات', 'Batteries', 'پاتری');
const LIGHTING = n('إنارة', 'Lighting', 'ڕووناکی');
const FILTERS = n('فلاتر', 'Filters', 'فلتەر');
const CABLES = n('كيبلات وأسلاك', 'Cables and wires', 'کێبڵ و وایەر');
const ORAL_CARE = n('العناية بالفم والأسنان', 'Oral care', 'چاودێریی دەم و ددان');
const SKIN_CARE = n('العناية بالبشرة', 'Skin care', 'چاودێریی پێست');
const BREAKERS = n('قواطع وفيوزات', 'Breakers and fuses', 'برێکەر و فیوز');

export const STARTER_LISTS: Record<StarterTrade, StarterList> = {
  general: {
    name: n('تجارة عامة', 'General trade', 'بازرگانیی گشتی'),
    categories: [
      { name: n('مواد غذائية', 'Food and groceries', 'خۆراک'), sub: [n('مواد أساسية', 'Staples', 'خۆراکی سەرەکی'), n('مشروبات', 'Beverages', 'خواردنەوە')] },
      { name: n('أجهزة كهربائية', 'Electrical appliances', 'ئامێری کارەبایی'), sub: [n('أجهزة منزلية', 'Home appliances', 'ئامێری ماڵ'), n('هواتف وإلكترونيات', 'Phones and electronics', 'مۆبایل و ئەلیکترۆنیات')] },
      { name: n('منظفات ومستلزمات منزلية', 'Cleaning and household', 'پاککەرەوە و پێداویستیی ماڵ') },
      { name: n('العناية الشخصية', 'Personal care', 'چاودێریی کەسی') },
      { name: n('عدد ومواد بناء', 'Tools and building materials', 'ئامراز و کەرەستەی بیناسازی') },
      { name: n('ملابس وأحذية', 'Clothing and shoes', 'جل و پێڵاو') }
    ],
    brands: [
      { name: 'Samsung', ar: 'سامسونج', ku: 'سامسۆنگ', country: 'KR' }, { name: 'LG', country: 'KR' }, { name: 'Apple', country: 'US' },
      { name: 'Xiaomi', ar: 'شاومي', ku: 'شاومی', country: 'CN' }, { name: 'Nestlé', ar: 'نستله', ku: 'نێستلە', country: 'CH' },
      { name: 'Pepsi', ar: 'بيبسي', ku: 'پێپسی', country: 'US' }, { name: 'Coca-Cola', ar: 'كوكاكولا', ku: 'کۆکاکۆلا', country: 'US' },
      { name: 'Almarai', ar: 'المراعي', ku: 'ئەلمەراعی', country: 'SA' }, { name: 'Bosch', country: 'DE' }, { name: 'Philips', country: 'NL' },
      { name: 'Nivea', country: 'DE' }, { name: 'Ariel', country: 'US' }, { name: 'Beko', country: 'TR' }, { name: 'Gree', country: 'CN' },
      { name: 'Ülker', country: 'TR' }
    ]
  },

  electronics: {
    name: n('موبايلات وحاسبات', 'Mobiles and computers', 'مۆبایل و کۆمپیوتەر'),
    categories: [
      { name: n('هواتف محمولة', 'Mobile phones', 'مۆبایل'), sub: [n('هواتف ذكية', 'Smartphones', 'مۆبایلی زیرەک'), n('هواتف عادية', 'Basic phones', 'مۆبایلی ئاسایی'), n('أجهزة لوحية', 'Tablets', 'تابلێت')] },
      { name: n('حاسبات', 'Computers', 'کۆمپیوتەر'), sub: [n('حاسبات محمولة', 'Laptops', 'لاپتۆپ'), n('حاسبات مكتبية', 'Desktops', 'کۆمپیوتەری سەرمێز'), n('شاشات', 'Monitors', 'شاشە'), n('طابعات', 'Printers', 'پرینتەر')] },
      {
        name: ACCESSORIES,
        sub: [
          n('شواحن وكابلات', 'Chargers and cables', 'شارجەر و کێبڵ'), n('أغطية وواقيات شاشة', 'Cases and screen protectors', 'بەرگ و پارێزەری شاشە'),
          n('سماعات', 'Headphones', 'هێدفۆن'), n('باور بانك', 'Power banks', 'پاوەر بانک'), n('بطاقات ذاكرة وفلاشات', 'Memory cards and flash drives', 'کارتی بیرگە و فلاش')
        ]
      },
      { name: n('ساعات ذكية', 'Smart watches', 'کاتژمێری زیرەک') },
      { name: n('شبكات', 'Networking', 'تۆڕ'), sub: [n('راوترات', 'Routers', 'ڕاوتەر'), n('كيبلات شبكة', 'Network cables', 'کێبڵی تۆڕ')] },
      { name: n('قطع غيار وصيانة', 'Spare parts and repair', 'پارچەی یەدەگ و چاککردنەوە'), sub: [n('شاشات بديلة', 'Replacement screens', 'شاشەی یەدەگ'), BATTERIES] }
    ],
    brands: [
      { name: 'Samsung', ar: 'سامسونج', ku: 'سامسۆنگ', country: 'KR' }, { name: 'Apple', country: 'US' }, { name: 'Xiaomi', ar: 'شاومي', ku: 'شاومی', country: 'CN' },
      { name: 'Huawei', ar: 'هواوي', ku: 'هواوی', country: 'CN' }, { name: 'Oppo', country: 'CN' }, { name: 'Honor', country: 'CN' }, { name: 'Vivo', country: 'CN' },
      { name: 'Realme', country: 'CN' }, { name: 'Tecno', country: 'CN' }, { name: 'Infinix', country: 'CN' }, { name: 'Nokia', country: 'FI' },
      { name: 'Lenovo', country: 'CN' }, { name: 'HP', country: 'US' }, { name: 'Dell', country: 'US' }, { name: 'Asus', country: 'TW' }, { name: 'Acer', country: 'TW' },
      { name: 'Anker', country: 'CN' }, { name: 'Baseus', country: 'CN' }, { name: 'JBL', country: 'US' }, { name: 'Canon', country: 'JP' },
      { name: 'TP-Link', country: 'CN' }, { name: 'SanDisk', country: 'US' }, { name: 'Logitech', country: 'CH' }
    ]
  },

  autoParts: {
    name: n('قطع غيار السيارات', 'Car parts', 'پارچەی ئۆتۆمبێل'),
    categories: [
      {
        name: n('المحرك', 'Engine', 'بزوێنەر'),
        sub: [FILTERS, n('بواجي', 'Spark plugs', 'بوجی'), n('سيور وسلاسل', 'Belts and chains', 'قایش و زنجیر'), n('كاسكيتات', 'Gaskets and seals', 'گاسکێت')]
      },
      { name: n('الفرامل', 'Brakes', 'بریک'), sub: [n('فحمات', 'Brake pads', 'فەحمەی بریک'), n('أقراص وطبول', 'Discs and drums', 'دیسک و تەپڵ')] },
      { name: n('العوارض والتوجيه', 'Suspension and steering', 'هەڵگر و سووکان'), sub: [n('مساعدات', 'Shock absorbers', 'ئەمۆرتیسەر'), n('قطع التوجيه', 'Steering parts', 'پارچەی سووکان')] },
      { name: n('الكهرباء', 'Electrical', 'کارەبا'), sub: [BATTERIES, LIGHTING, n('دينمو وسلف', 'Alternators and starters', 'داینەمۆ و سەلف')] },
      { name: n('زيوت وسوائل', 'Oils and fluids', 'ڕۆن و شلە'), sub: [n('زيت محرك', 'Engine oil', 'ڕۆنی بزوێنەر'), n('زيت كير', 'Gear oil', 'ڕۆنی گێڕ'), n('ماء رديتر', 'Coolant', 'ئاوی ڕادیاتەر')] },
      { name: n('التبريد والتكييف', 'Cooling and air conditioning', 'ساردکردنەوە و ئەیرکۆندیشن'), sub: [n('رديترات', 'Radiators', 'ڕادیاتەر'), n('كمبرسرات', 'AC compressors', 'کۆمپرێسەر')] },
      { name: n('إطارات', 'Tyres', 'تایە') },
      { name: n('قطع البدي', 'Body parts', 'پارچەی بۆدی'), sub: [n('مرايات', 'Mirrors', 'ئاوێنە'), n('دعاميات', 'Bumpers', 'دەعامیە')] }
    ],
    brands: [
      { name: 'Toyota Genuine', country: 'JP' }, { name: 'Hyundai Mobis', country: 'KR' }, { name: 'Bosch', country: 'DE' }, { name: 'Denso', country: 'JP' },
      { name: 'NGK', country: 'JP' }, { name: 'Mann-Filter', country: 'DE' }, { name: 'Mahle', country: 'DE' }, { name: 'Valeo', country: 'FR' },
      { name: 'Sachs', country: 'DE' }, { name: 'Brembo', country: 'IT' }, { name: 'TRW', country: 'DE' }, { name: 'Aisin', country: 'JP' },
      { name: 'KYB', country: 'JP' }, { name: 'Gates', country: 'US' }, { name: 'Febi Bilstein', country: 'DE' }, { name: 'Castrol', country: 'GB' },
      { name: 'Mobil', country: 'US' }, { name: 'Shell', country: 'GB' }, { name: 'TotalEnergies', country: 'FR' }, { name: 'Varta', country: 'DE' },
      { name: 'Michelin', country: 'FR' }, { name: 'Bridgestone', country: 'JP' }, { name: 'Hankook', country: 'KR' }
    ]
  },

  pharmacy: {
    name: n('صيدلية', 'Pharmacy', 'دەرمانخانە'),
    categories: [
      {
        name: n('أدوية', 'Medicines', 'دەرمان'),
        sub: [
          n('مضادات حيوية', 'Antibiotics', 'دژەبەکتریا'), n('مسكنات وخافضات حرارة', 'Pain and fever', 'ئازارشکێن و دابەزێنەری تا'),
          n('البرد والإنفلونزا', 'Cold and flu', 'هەڵامەت و ئەنفلۆنزا'), n('الأمراض المزمنة', 'Chronic diseases', 'نەخۆشییە درێژخایەنەکان'),
          n('الجهاز الهضمي', 'Stomach and digestion', 'گەدە و هەرس')
        ]
      },
      { name: n('فيتامينات ومكملات', 'Vitamins and supplements', 'ڤیتامین و تەواوکەر') },
      { name: n('العناية بالطفل', 'Baby care', 'چاودێریی منداڵ'), sub: [n('حليب أطفال', 'Baby milk', 'شیری منداڵ'), n('حفاضات', 'Diapers', 'دایپەر')] },
      { name: n('العناية الشخصية', 'Personal care', 'چاودێریی کەسی'), sub: [SKIN_CARE, ORAL_CARE] },
      { name: n('مستلزمات طبية', 'Medical supplies', 'پێداویستیی پزیشکی'), sub: [n('أجهزة طبية', 'Medical devices', 'ئامێری پزیشکی'), n('إسعافات أولية', 'First aid', 'فریاگوزاریی سەرەتایی')] }
    ],
    brands: [
      { name: 'Pfizer', country: 'US' }, { name: 'GSK', country: 'GB' }, { name: 'Novartis', country: 'CH' }, { name: 'Sanofi', country: 'FR' },
      { name: 'AstraZeneca', country: 'GB' }, { name: 'Bayer', country: 'DE' }, { name: 'Abbott', country: 'US' }, { name: 'MSD', country: 'US' },
      { name: 'Roche', country: 'CH' }, { name: 'Novo Nordisk', country: 'DK' }, { name: 'Servier', country: 'FR' },
      { name: 'Hikma', ar: 'الحكمة', ku: 'حیکمە', country: 'JO' }, { name: 'Julphar', ar: 'جلفار', ku: 'جولفار', country: 'AE' },
      { name: 'SDI Samarra', ar: 'أدوية سامراء', ku: 'دەرمانی سامەڕا', country: 'IQ' }, { name: 'Pioneer', ar: 'بايونير', ku: 'پایۆنیر', country: 'IQ' },
      { name: 'Spimaco', ar: 'سبيماكو', country: 'SA' }, { name: 'Tabuk Pharmaceuticals', ar: 'تبوك للأدوية', country: 'SA' },
      { name: 'Dar Al Dawa', ar: 'دار الدواء', country: 'JO' }, { name: 'Beurer', country: 'DE' }
    ]
  },

  grocery: {
    name: n('مواد غذائية وسوبرماركت', 'Grocery and supermarket', 'خۆراک و سوپەرمارکێت'),
    categories: [
      {
        name: n('مواد أساسية', 'Staples', 'خۆراکی سەرەکی'),
        sub: [n('رز وحبوب', 'Rice and grains', 'برنج و دانەوێڵە'), n('سكر وطحين', 'Sugar and flour', 'شەکر و ئارد'), n('زيوت وسمن', 'Oils and ghee', 'ڕۆن'), n('معكرونة', 'Pasta', 'مەکەرۆنی'), n('معلبات', 'Canned food', 'خواردنی قوتوو')]
      },
      { name: n('ألبان وبيض', 'Dairy and eggs', 'شیرەمەنی و هێلکە'), sub: [n('حليب', 'Milk', 'شیر'), n('أجبان', 'Cheese', 'پەنیر'), n('لبن', 'Yogurt', 'ماست')] },
      { name: n('مشروبات', 'Beverages', 'خواردنەوە'), sub: [n('مشروبات غازية', 'Soft drinks', 'خواردنەوەی گازدار'), n('مياه', 'Water', 'ئاو'), n('عصائر', 'Juices', 'شەربەت'), n('شاي وقهوة', 'Tea and coffee', 'چا و قاوە')] },
      { name: n('حلويات ومقرمشات', 'Snacks and sweets', 'شیرینی و سووکەخۆراک'), sub: [n('بسكويت', 'Biscuits', 'بیسکویت'), n('شوكولاتة', 'Chocolate', 'چۆکلێت'), n('شبس', 'Chips', 'چیپس')] },
      { name: n('مجمدات', 'Frozen food', 'خۆراکی بەستوو') },
      { name: n('منظفات', 'Cleaning', 'پاککەرەوە'), sub: [n('مساحيق غسيل', 'Laundry detergent', 'پاودەری جلشۆردن'), n('سائل جلي', 'Dishwashing', 'شلەی قاپشۆردن'), n('مناديل وورقيات', 'Tissues and paper', 'دەستەسڕ و کاغەز')] }
    ],
    brands: [
      { name: 'Nestlé', ar: 'نستله', ku: 'نێستلە', country: 'CH' }, { name: 'Almarai', ar: 'المراعي', ku: 'ئەلمەراعی', country: 'SA' },
      { name: 'Pepsi', ar: 'بيبسي', ku: 'پێپسی', country: 'US' }, { name: 'Coca-Cola', ar: 'كوكاكولا', ku: 'کۆکاکۆلا', country: 'US' },
      { name: 'Al Kabeer', ar: 'الكبير', country: 'AE' }, { name: 'Sadia', ar: 'ساديا', country: 'BR' }, { name: 'Al Alali', ar: 'العلالي', country: 'KW' },
      { name: 'Lipton', ar: 'ليبتون', country: 'GB' }, { name: 'Puck', ar: 'بوك', country: 'DK' }, { name: 'Kiri', ar: 'كيري', country: 'FR' },
      { name: 'Indomie', ar: 'إندومي', country: 'ID' }, { name: 'Ülker', country: 'TR' }, { name: 'Eti', country: 'TR' }, { name: 'Pınar', country: 'TR' },
      { name: 'Tide', country: 'US' }, { name: 'Ariel', country: 'US' }, { name: 'Persil', country: 'DE' }, { name: 'Fairy', country: 'GB' }
    ]
  },

  building: {
    name: n('مواد بناء وعدد', 'Building materials and tools', 'کەرەستەی بیناسازی و ئامراز'),
    categories: [
      { name: n('عدد كهربائية', 'Power tools', 'ئامرازی کارەبایی'), sub: [n('دريلات', 'Drills', 'دریل'), n('مكائن قص وتجليخ', 'Grinders and cutters', 'مەکینەی بڕین و ساوین'), n('مناشير', 'Saws', 'مشار')] },
      { name: n('عدد يدوية', 'Hand tools', 'ئامرازی دەستی'), sub: [n('مفاتيح', 'Wrenches', 'سپانە'), n('درنفيسات', 'Screwdrivers', 'درنەفیس'), n('مطارق وكلابتين', 'Hammers and pliers', 'چەکوش و پەنسە')] },
      { name: n('مواد بناء', 'Building materials', 'کەرەستەی بیناسازی'), sub: [n('إسمنت', 'Cement', 'چیمەنتۆ'), n('حديد تسليح', 'Rebar', 'شیش'), n('بلوك وطابوق', 'Blocks and bricks', 'بلۆک و خشت'), n('جص', 'Gypsum', 'گەچ')] },
      { name: n('أنابيب وأدوات صحية', 'Plumbing', 'بۆری و کەرەستەی ئاو'), sub: [n('أنابيب وملحقات', 'Pipes and fittings', 'بۆری و پارچەکانی'), n('أدوات صحية', 'Sanitary ware', 'کەرەستەی حەمام')] },
      { name: n('مواد كهربائية', 'Electrical supplies', 'کەرەستەی کارەبا'), sub: [CABLES, n('مفاتيح وبلكات', 'Switches and sockets', 'سویچ و پلاک'), LIGHTING] },
      { name: n('أصباغ', 'Paints', 'بۆیە') },
      { name: n('معدات السلامة', 'Safety equipment', 'کەرەستەی سەلامەتی') }
    ],
    brands: [
      { name: 'Bosch', country: 'DE' }, { name: 'Makita', country: 'JP' }, { name: 'DeWalt', country: 'US' }, { name: 'Total', country: 'CN' },
      { name: 'Ingco', country: 'CN' }, { name: 'Stanley', country: 'US' }, { name: 'Black+Decker', country: 'US' }, { name: 'Metabo', country: 'DE' },
      { name: 'Milwaukee', country: 'US' }, { name: 'Einhell', country: 'DE' }, { name: 'Kärcher', country: 'DE' }, { name: 'Knipex', country: 'DE' },
      { name: 'Tolsen', country: 'CN' }, { name: 'Jotun', country: 'NO' }, { name: 'Jazeera Paints', ar: 'دهانات الجزيرة', country: 'SA' },
      { name: 'National Paints', ar: 'الدهانات الوطنية', country: 'AE' }, { name: 'Lafarge', country: 'FR' }, { name: 'Mass Cement', ar: 'سمنت ماس', ku: 'چیمەنتۆی ماس', country: 'IQ' },
      { name: 'Grohe', country: 'DE' }, { name: 'Schneider Electric', country: 'FR' }, { name: 'Legrand', country: 'FR' }
    ]
  },

  clothing: {
    name: n('ملابس وأحذية', 'Clothing and shoes', 'جل و پێڵاو'),
    categories: [
      { name: n('ملابس رجالية', 'Men’s clothing', 'جلی پیاوان'), sub: [n('قمصان', 'Shirts', 'کراس'), n('بناطيل', 'Trousers', 'پانتۆڵ'), n('بدلات', 'Suits', 'قات'), n('ملابس داخلية', 'Underwear', 'جلی ژێرەوە')] },
      { name: n('ملابس نسائية', 'Women’s clothing', 'جلی ئافرەتان'), sub: [n('فساتين', 'Dresses', 'فستان'), n('عباءات', 'Abayas', 'عەبا'), n('بلوزات', 'Blouses', 'بلووز')] },
      { name: n('ملابس أطفال', 'Children’s clothing', 'جلی منداڵان') },
      {
        name: n('أحذية', 'Shoes', 'پێڵاو'),
        sub: [n('أحذية رجالية', 'Men’s shoes', 'پێڵاوی پیاوان'), n('أحذية نسائية', 'Women’s shoes', 'پێڵاوی ئافرەتان'), n('أحذية رياضية', 'Sports shoes', 'پێڵاوی وەرزشی'), n('أحذية أطفال', 'Children’s shoes', 'پێڵاوی منداڵان')]
      },
      { name: n('ملابس رياضية', 'Sportswear', 'جلی وەرزشی') },
      { name: ACCESSORIES, sub: [n('حقائب', 'Bags', 'جانتا'), n('أحزمة', 'Belts', 'قایش'), n('ساعات', 'Watches', 'کاتژمێر')] }
    ],
    brands: [
      { name: 'Nike', ar: 'نايكي', ku: 'نایکی', country: 'US' }, { name: 'Adidas', ar: 'أديداس', ku: 'ئەدیداس', country: 'DE' }, { name: 'Puma', country: 'DE' },
      { name: 'Skechers', country: 'US' }, { name: 'New Balance', country: 'US' }, { name: 'Reebok', country: 'US' }, { name: 'Zara', country: 'ES' },
      { name: 'Bershka', country: 'ES' }, { name: 'Pull&Bear', country: 'ES' }, { name: 'Mango', country: 'ES' }, { name: 'H&M', country: 'SE' },
      { name: 'LC Waikiki', country: 'TR' }, { name: 'DeFacto', country: 'TR' }, { name: 'Koton', country: 'TR' }, { name: 'Mavi', country: 'TR' },
      { name: 'Columbia', country: 'US' }, { name: 'The North Face', country: 'US' }
    ]
  },

  cosmetics: {
    name: n('مستحضرات تجميل', 'Cosmetics', 'کەرەستەی جوانکاری'),
    categories: [
      { name: SKIN_CARE, sub: [n('كريمات ولوشن', 'Creams and lotions', 'کرێم و لۆشن'), n('واقي شمس', 'Sunscreen', 'پارێزەری خۆر'), n('غسول', 'Cleansers', 'پاککەرەوەی ڕوو')] },
      { name: n('العناية بالشعر', 'Hair care', 'چاودێریی قژ'), sub: [n('شامبو وبلسم', 'Shampoo and conditioner', 'شامپۆ و بەلسەم'), n('صبغات شعر', 'Hair dye', 'بۆیەی قژ'), n('زيوت وتصفيف', 'Oils and styling', 'ڕۆن و شێوەدانی قژ')] },
      { name: n('مكياج', 'Makeup', 'مەکیاج'), sub: [n('وجه', 'Face', 'ڕوو'), n('عيون', 'Eyes', 'چاو'), n('شفاه', 'Lips', 'لێو')] },
      { name: n('عطور', 'Perfumes', 'بۆن'), sub: [n('عطور رجالية', 'Men’s perfumes', 'بۆنی پیاوان'), n('عطور نسائية', 'Women’s perfumes', 'بۆنی ئافرەتان'), n('مزيلات العرق', 'Deodorants', 'دیۆدۆرانت')] },
      { name: n('العناية الشخصية', 'Personal care', 'چاودێریی کەسی'), sub: [n('حلاقة', 'Shaving', 'تاشین'), n('صابون وغسول جسم', 'Soap and body wash', 'سابوون و شامپۆی لەش'), ORAL_CARE] }
    ],
    brands: [
      { name: 'L’Oréal', country: 'FR' }, { name: 'Nivea', country: 'DE' }, { name: 'Garnier', country: 'FR' }, { name: 'Maybelline', country: 'US' },
      { name: 'Dove', country: 'US' }, { name: 'Pantene', country: 'US' }, { name: 'Head & Shoulders', country: 'US' }, { name: 'Vaseline', country: 'US' },
      { name: 'Sunsilk', country: 'GB' }, { name: 'Essence', country: 'DE' }, { name: 'Flormar', country: 'TR' }, { name: 'Golden Rose', country: 'TR' },
      { name: 'Farmasi', country: 'TR' }, { name: 'Bioderma', country: 'FR' }, { name: 'La Roche-Posay', country: 'FR' }, { name: 'CeraVe', country: 'US' },
      { name: 'The Ordinary', country: 'CA' }, { name: 'Pupa', country: 'IT' }, { name: 'Rituals', country: 'NL' }
    ]
  },

  homeAppliances: {
    name: n('أجهزة منزلية', 'Home appliances', 'ئامێری ماڵ'),
    categories: [
      { name: n('أجهزة كبيرة', 'Large appliances', 'ئامێری گەورە'), sub: [n('ثلاجات', 'Refrigerators', 'سەلاجە'), n('غسالات', 'Washing machines', 'جلشۆر'), n('طباخات', 'Cookers', 'تەباخ'), n('غسالات صحون', 'Dishwashers', 'قاپشۆر')] },
      { name: n('تبريد وتدفئة', 'Cooling and heating', 'فێنککەرەوە و گەرمکەرەوە'), sub: [n('مكيفات', 'Air conditioners', 'سپلیت'), n('مبردات هواء', 'Air coolers', 'کوولەری ئاوی'), n('مدافئ', 'Heaters', 'سۆبە'), n('مراوح', 'Fans', 'پانکە')] },
      { name: n('أجهزة صغيرة', 'Small appliances', 'ئامێری بچووک'), sub: [n('أجهزة مطبخ', 'Kitchen appliances', 'ئامێری چێشتخانە'), n('مكاوي', 'Irons', 'ئوتوو'), n('مكانس كهربائية', 'Vacuum cleaners', 'گسکی کارەبایی')] },
      { name: n('تلفزيونات وصوتيات', 'TV and audio', 'تەلەفزیۆن و دەنگ'), sub: [n('تلفزيونات', 'Televisions', 'تەلەفزیۆن'), n('رسيفرات وصوتيات', 'Receivers and audio', 'ڕیسیڤەر و دەنگ')] },
      { name: n('مبردات وفلاتر ماء', 'Water dispensers and filters', 'ئاوساردکەرەوە و فلتەری ئاو') }
    ],
    brands: [
      { name: 'Samsung', ar: 'سامسونج', ku: 'سامسۆنگ', country: 'KR' }, { name: 'LG', country: 'KR' }, { name: 'Gree', country: 'CN' }, { name: 'Midea', country: 'CN' },
      { name: 'Haier', country: 'CN' }, { name: 'Hisense', country: 'CN' }, { name: 'TCL', country: 'CN' }, { name: 'Beko', country: 'TR' }, { name: 'Arçelik', country: 'TR' },
      { name: 'Vestel', country: 'TR' }, { name: 'Bosch', country: 'DE' }, { name: 'Siemens', country: 'DE' }, { name: 'Philips', country: 'NL' }, { name: 'Tefal', country: 'FR' },
      { name: 'Moulinex', country: 'FR' }, { name: 'Kenwood', country: 'GB' }, { name: 'Panasonic', country: 'JP' }, { name: 'Sharp', country: 'JP' },
      { name: 'Sony', country: 'JP' }, { name: 'Toshiba', country: 'JP' }, { name: 'Electrolux', country: 'SE' }, { name: 'Ariston', country: 'IT' }
    ]
  },

  stationery: {
    name: n('قرطاسية', 'Stationery', 'قرتاسیە'),
    categories: [
      { name: n('أدوات الكتابة', 'Writing', 'کەرەستەی نووسین'), sub: [n('أقلام جاف', 'Pens', 'پێنووس'), n('أقلام رصاص', 'Pencils', 'قەڵەمی ڕەساس'), n('ماركرات', 'Markers and highlighters', 'مارکەر')] },
      { name: n('ورق ودفاتر', 'Paper and notebooks', 'کاغەز و دەفتەر'), sub: [n('دفاتر', 'Notebooks', 'دەفتەر'), n('ورق طباعة', 'Printing paper', 'کاغەزی چاپ'), n('ظروف', 'Envelopes', 'زەرف')] },
      { name: n('مستلزمات مدرسية', 'School supplies', 'پێداویستیی قوتابخانە'), sub: [n('حقائب مدرسية', 'School bags', 'جانتای قوتابخانە'), n('أدوات هندسية', 'Geometry sets', 'ئامێری ئەندازە'), n('ألوان', 'Colours', 'ڕەنگ')] },
      { name: n('لوازم مكتبية', 'Office supplies', 'پێداویستیی ئۆفیس'), sub: [n('ملفات', 'Files and folders', 'فایل و دۆسیە'), n('دباسات وخرامات', 'Staplers and punches', 'دەباسە و کونکەر'), n('لاصق وصمغ', 'Tape and glue', 'سەلۆتێپ و چەسپ')] },
      { name: n('أحبار ومستلزمات طابعات', 'Ink and printer supplies', 'مەرەکەب و پێداویستیی پرینتەر') },
      { name: n('أدوات رسم', 'Art supplies', 'کەرەستەی وێنەکێشان') }
    ],
    brands: [
      { name: 'Faber-Castell', country: 'DE' }, { name: 'Pilot', country: 'JP' }, { name: 'Bic', country: 'FR' }, { name: 'Staedtler', country: 'DE' },
      { name: 'Pentel', country: 'JP' }, { name: 'Uni-ball', country: 'JP' }, { name: 'Stabilo', country: 'DE' }, { name: 'Maped', country: 'FR' },
      { name: 'Pelikan', country: 'DE' }, { name: 'Double A', country: 'TH' }, { name: 'PaperOne', country: 'ID' }, { name: 'Canson', country: 'FR' },
      { name: 'Deli', country: 'CN' }, { name: 'M&G', country: 'CN' }, { name: 'Casio', country: 'JP' }, { name: 'Epson', country: 'JP' },
      { name: 'Canon', country: 'JP' }, { name: 'HP', country: 'US' }, { name: '3M', country: 'US' }
    ]
  },

  electricalSolar: {
    name: n('كهربائيات وطاقة شمسية', 'Electrical and solar', 'کارەبا و وزەی خۆر'),
    categories: [
      { name: n('ألواح شمسية', 'Solar panels', 'پانێڵی خۆر'), sub: [n('هياكل التثبيت', 'Mounting structures', 'ستراکچەری دامەزراندن')] },
      { name: n('انفرترات', 'Inverters', 'ئینڤێرتەر'), sub: [n('انفرترات هجينة', 'Hybrid inverters', 'ئینڤێرتەری هایبرید'), n('انفرترات منفصلة', 'Off-grid inverters', 'ئینڤێرتەری سەربەخۆ')] },
      { name: BATTERIES, sub: [n('بطاريات ليثيوم', 'Lithium batteries', 'پاتریی لیسیۆم'), n('بطاريات جل', 'Gel batteries', 'پاتریی جێل')] },
      { name: n('كيبلات وحماية', 'Cables and protection', 'کێبڵ و پاراستن'), sub: [n('كيبلات شمسية', 'Solar cables', 'کێبڵی خۆر'), BREAKERS] },
      { name: LIGHTING, sub: [n('مصابيح LED', 'LED lamps', 'گڵۆپی LED'), n('إنارة شمسية', 'Solar lights', 'ڕووناکیی خۆر')] },
      { name: n('مواد كهربائية', 'Electrical supplies', 'کەرەستەی کارەبا') }
    ],
    brands: [
      { name: 'Jinko Solar', country: 'CN' }, { name: 'LONGi', country: 'CN' }, { name: 'Trina Solar', country: 'CN' }, { name: 'JA Solar', country: 'CN' },
      { name: 'Canadian Solar', country: 'CA' }, { name: 'Huawei', ar: 'هواوي', ku: 'هواوی', country: 'CN' }, { name: 'Growatt', country: 'CN' },
      { name: 'Deye', country: 'CN' }, { name: 'Sungrow', country: 'CN' }, { name: 'Victron Energy', country: 'NL' }, { name: 'SMA', country: 'DE' },
      { name: 'Felicity Solar', country: 'CN' }, { name: 'Must', country: 'CN' }, { name: 'Pylontech', country: 'CN' }, { name: 'BYD', country: 'CN' },
      { name: 'Schneider Electric', country: 'FR' }, { name: 'ABB', country: 'CH' }, { name: 'Legrand', country: 'FR' }, { name: 'Philips', country: 'NL' },
      { name: 'Osram', country: 'DE' }
    ]
  },

  generators: {
    name: n('مولدات', 'Generators', 'مۆلیدە'),
    categories: [
      { name: n('مولدات', 'Generators', 'مۆلیدە'), sub: [n('مولدات ديزل', 'Diesel generators', 'مۆلیدەی دیزڵ'), n('مولدات بنزين', 'Petrol generators', 'مۆلیدەی بەنزین')] },
      { name: n('قطع غيار', 'Spare parts', 'پارچەی یەدەگ'), sub: [FILTERS, n('سيور وبلبرنات', 'Belts and bearings', 'قایش و بێرینگ'), n('قطع كهربائية', 'Electrical parts', 'پارچەی کارەبایی')] },
      { name: n('زيوت ومشحمات', 'Oils and lubricants', 'ڕۆن و گریس') },
      { name: n('كيبلات وتوزيع', 'Cables and distribution', 'کێبڵ و دابەشکردن'), sub: [CABLES, BREAKERS, n('مقاييس', 'Meters', 'پێوەر')] }
    ],
    brands: [
      { name: 'Perkins', country: 'GB' }, { name: 'Cummins', country: 'US' }, { name: 'Caterpillar', country: 'US' }, { name: 'Volvo Penta', country: 'SE' },
      { name: 'Doosan', country: 'KR' }, { name: 'Deutz', country: 'DE' }, { name: 'MTU', country: 'DE' }, { name: 'Mitsubishi', country: 'JP' },
      { name: 'Yanmar', country: 'JP' }, { name: 'Honda', country: 'JP' }, { name: 'Kipor', country: 'CN' }, { name: 'Weichai', country: 'CN' },
      { name: 'Stamford', country: 'GB' }, { name: 'Leroy-Somer', country: 'FR' }, { name: 'Deep Sea Electronics', country: 'GB' },
      { name: 'Fleetguard', country: 'US' }, { name: 'Shell', country: 'GB' }, { name: 'Castrol', country: 'GB' }, { name: 'Mobil', country: 'US' }
    ]
  }
};

/**
 * The units a kind of company usually counts in (1.4), in the order the item form lists them. The form offers these
 * first; every other unit stays one press away ("show all units"), and a unit the company already uses is always
 * listed. 'trade' is what every company does and has no list of its own: alone it offers every unit, and beside
 * another type it adds nothing.
 */
export const BUSINESS_UNITS: Record<BusinessType, readonly UnitCode[] | null> = {
  trade: null,
  market: ['piece', 'kg', 'g', 'carton', 'pack', 'box', 'bottle', 'bag', 'dozen', 'l', 'sachet', 'roll'],
  realEstate: ['piece', 'm2', 'm', 'ton', 'bag', 'kg', 'l', 'set', 'roll', 'service'],
  mobileShop: ['piece', 'box', 'set', 'carton', 'pair', 'service'],
  autoParts: ['piece', 'set', 'pair', 'box', 'carton', 'l', 'bottle', 'kg', 'm', 'service'],
  engineeringWorks: ['piece', 'm', 'm2', 'kg', 'ton', 'bag', 'set', 'roll', 'l', 'service'],
  electricalSolar: ['piece', 'm', 'roll', 'set', 'box', 'carton', 'pair', 'service'],
  generators: ['piece', 'l', 'set', 'm', 'box', 'service'],
  pharmacy: ['tablet', 'capsule', 'strip', 'box', 'bottle', 'tube', 'ampoule', 'vial', 'sachet', 'piece', 'pack', 'carton']
};

/**
 * The units to offer a company: those of its business types (in their order), then any unit in `keep` (what the
 * company's items use already, and what the form holds now) that is not among them, in the order of UNIT_CODES.
 * `narrowed` says whether anything was left out (so the form shows "show all units"). A company with no type chosen,
 * or one that only trades in general, gets every unit.
 */
export function unitsForBusiness(types: readonly BusinessType[] | null | undefined, keep: Iterable<string> = []): { units: UnitCode[]; narrowed: boolean } {
  const lists = (types ?? []).map((t) => BUSINESS_UNITS[t]).filter((l) => l !== null);
  if (!lists.length) return { units: [...UNIT_CODES], narrowed: false };
  const wanted = new Set<string>(keep);
  const units: UnitCode[] = [];
  for (const list of lists) for (const u of list) if (!units.includes(u)) units.push(u);
  for (const u of UNIT_CODES) if (wanted.has(u) && !units.includes(u)) units.push(u);
  return { units, narrowed: units.length < UNIT_CODES.length };
}
