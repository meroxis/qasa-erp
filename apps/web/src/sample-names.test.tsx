import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Sample people in the screens' texts and on the print designer's sample paper are only Mer, Las and Raz, and sample
// companies and shops are named after what they are or where they are, never after a person.
const src = fileURLToPath(new URL('.', import.meta.url));
const FILES = [
  ...readdirSync(join(src, 'i18n')).filter((f) => f.endsWith('.ts')).sort().map((f) => `i18n/${f}`),
  'i18n.ts',
  'industry/print-model.ts',
  // the sample company of `npm run seed:demo` and the website demo: its parties, addresses and streets too
  '../../../packages/server/src/demo-data.ts'
];

/** Common first names and surnames (Arabic, Kurdish, Persian, Turkish and English), as written in Latin letters. */
const LATIN = `Ahmed Ahmad Ali Mohammed Mohammad Muhammad Mohamed Hassan Hasan Hussein Hussain Husain Omar Umar Karim Kareem Khalid
  Khaled Mahmoud Mustafa Mostafa Ibrahim Ismail Yousif Yusuf Youssef Abdullah Abdul Abbas Saad Saif Salim Sami Samir Tariq
  Tarek Waleed Walid Ziad Zaid Haider Hayder Jasim Jassim Kadhim Kazem Majid Nabil Rashid Saleh Hamid Hamza Faisal Bilal
  Adnan Anas Aziz Jamal Kamal Mahdi Mehdi Murtadha Nasser Qasim Rami Usama Osama Yasir Yasser Fatima Fatma Zainab Zaynab
  Maryam Mariam Sara Sarah Layla Leila Noor Nour Huda Aisha Amina Rana Reem Rasha Hiba Zahra Zahraa Dalia Nadia Salma
  Samira Suha Lina Dina Hanan Yasmin Aram Azad Baran Bakhtiar Bakhtiari Dilshad Hemin Hiwa Karwan Kawa Rebwar Rekan Shwan
  Sherko Dara Zana Zhyar Shilan Avin Nazdar Hoshyar Jalal Nawzad Reza Hossein Farhad Dariush Shirin Nima Arash Babak
  Kourosh Cyrus Mahsa Neda Behnam Bahram Navid Omid Ahmet Mehmet John Jane James Mary Michael David Smith Doe Alice Bob
  Peter Paul Anna Emma Olivia George William Salem Rayhana Reyhaneh`.split(/\s+/);

/** The same and other common names in Arabic letters, as Arabic and Kurdish (Sorani) write them. */
const ARABIC_SCRIPT = `أحمد احمد علي محمد حسن حسين عمر كريم خالد محمود مصطفى إبراهيم ابراهيم إسماعيل يوسف عبدالله عباس سعد سيف سالم سامي
  سمير طارق وليد زياد زيد حيدر جاسم كاظم ماجد نبيل رشيد حامد حمزة فيصل بلال عدنان أنس مهدي مرتضى ناصر قاسم رامي أسامة
  ياسر فاطمة زينب مريم سارة ليلى عائشة أمينة رنا ريم رشا زهراء داليا نادية سلمى سميرة لينا دينا حنان ياسمين رضا
  ئەحمەد عەلی محەمەد حەسەن حوسێن عومەر کەریم خالید مەحموود مستەفا ئیبراهیم عەباس کاوە ئارام ئازاد دڵشاد هێمن کاروان
  ڕێبوار ڕێکان شوان شێرکۆ ژیار شیلان ئاڤین نازدار هۆشیار جەلال نەوزاد بەختیار بەختیاری فاتیمە زەینەب مەریەم سارا لەیلا
  ڕەزا حسین فرهاد داریوش شیرین نیما آرش بابک کوروش بهنام بهرام نوید امید ريحانة الريحانة ڕەیحانە ریحانه`.split(/\s+/);

const NAMES = new Set([...LATIN, ...ARABIC_SCRIPT]);
/** Words spelled like a name that these texts use in their everyday sense (word → its meaning there). */
const NOT_A_PERSON: Record<string, string> = {
  'ئازاد': 'free: a PC freed from a licence, free text'
};

it('names no sample person other than Mer, Las or Raz, and no company after a person', () => {
  const found: string[] = [];
  for (const file of FILES) {
    const text = readFileSync(join(src, file), 'utf8');
    // letters and marks, and the zero-width non-joiner Kurdish writes inside some words
    for (const [word] of text.matchAll(/[\p{L}\p{M}\u{200C}]+/gu)) {
      if (NAMES.has(word) && !(word in NOT_A_PERSON)) found.push(`${file}: ${word}`);
    }
  }
  expect([...new Set(found)]).toEqual([]);
});

it('checks every text file and the sample paper, with names in each script', () => {
  expect(FILES.length).toBeGreaterThan(25);
  expect(FILES).toContain('i18n/generators.ts');
  expect(FILES).toContain('../../../packages/server/src/demo-data.ts');
  // a street named after a person counts too (the demo's customer once lived on «سالم», Salim Street)
  for (const street of ['Salim', 'سالم']) expect(NAMES.has(street), street).toBe(true);
  for (const allowed of ['Mer', 'Las', 'Raz']) expect(NAMES.has(allowed)).toBe(false);
  // the old samples are caught in every script they were written in
  for (const old of ['Ahmed', 'Ali', 'Bakhtiari', 'أحمد', 'علي', 'ئەحمەد', 'عەلی', 'بەختیاری']) expect(NAMES.has(old), old).toBe(true);
});
