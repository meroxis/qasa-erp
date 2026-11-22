/** The weighing scale's port and what went wrong with a reading (2.0). Arabic, English and Kurdish (Sorani), in that order, like i18n.ts. */
export const SCALE_TEXT = {
  sc_port: ['منفذ الميزان', 'The scale’s port', 'پۆرتی تەرازوو'],
  sc_portHelp: ['اختر المنفذ الموصول به الميزان على هذا الحاسوب. لا يُقرأ ولا يُرسَل شيء إلى أي منفذ آخر.', 'Choose the port the scale is plugged into on this PC. Nothing is read from, or sent to, any other port.', 'ئەو پۆرتە هەڵبژێرە کە تەرازووەکەی پێوە بەستراوە لەسەر ئەم کۆمپیوتەرە. هیچ شتێک لە هیچ پۆرتێکی تر ناخوێندرێتەوە و بۆی نانێردرێت.'],
  sc_choose: ['اختر المنفذ', 'Choose the port', 'پۆرت هەڵبژێرە'],
  sc_find: ['ابحث عن المنافذ', 'Look for ports', 'بەدوای پۆرتەکاندا بگەڕێ'],
  sc_none: ['لم يُختر منفذ', 'No port chosen', 'هیچ پۆرتێک هەڵنەبژێردراوە'],
  sc_noPorts: ['لا يوجد منفذ تسلسلي على هذا الحاسوب. صِل الميزان ثم أعد المحاولة.', 'This PC has no serial port now. Plug the scale in and try again.', 'ئەم کۆمپیوتەرە ئێستا هیچ پۆرتێکی زنجیرەیی نییە. تەرازووەکە ببەستە و دووبارە هەوڵ بدەرەوە.'],
  sc_chosen: ['المنفذ المختار: {name}', 'Chosen port: {name}', 'پۆرتی هەڵبژێردراو: {name}'],
  sc_ready: ['المنفذ جاهز', 'The port is ready', 'پۆرتەکە ئامادەیە'],
  sc_noPort: ['لم يُختر منفذ للميزان على هذا الحاسوب. اختره من الإعدادات ← الصناديق وقواعدها ← الميزان.', 'No port is chosen for the scale on this PC. Choose it in Settings → Tills and till rules → Weighing scale.', 'هیچ پۆرتێک بۆ تەرازوو لەسەر ئەم کۆمپیوتەرە هەڵنەبژێردراوە. لە ڕێکخستنەکان ← سندووقەکان و ڕێساکانیان ← تەرازوو هەڵیبژێرە.'],
  sc_timeout: ['لم يصل شيء من الميزان. تحقق من الكابل والمنفذ والسرعة.', 'Nothing came from the scale. Check the cable, the port and the speed.', 'هیچ شتێک لە تەرازووەوە نەهات. کێبڵ و پۆرت و خێراییەکە بپشکنە.'],
  sc_unstable: ['لم يستقر الوزن (أو الكفّة فارغة). انتظر حتى يثبت ثم أعد القراءة.', 'The weight did not settle (or the pan is empty). Wait until it is steady, then read again.', 'کێشەکە جێگیر نەبوو (یان تاکەکە بەتاڵە). چاوەڕێ بکە تا جێگیر دەبێت، پاشان دووبارە بیخوێنەوە.'],
  sc_failed: ['تعذّرت قراءة الميزان. قد يكون المنفذ مستخدماً من برنامج آخر.', 'The scale could not be read. Another program may be using its port.', 'تەرازووەکە نەخوێندرایەوە. لەوانەیە بەرنامەیەکی تر پۆرتەکەی بەکاربهێنێت.']
} as const;
