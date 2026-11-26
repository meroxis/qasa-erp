/**
 * 2.0.0: a long table shows a few hundred rows at a time (industry/LongList.tsx). Arabic, English and Kurdish
 * (Sorani), in that order, like i18n.ts.
 */
export const LONG_LIST_TEXT = {
  ll_hiddenAfter: ['لم يُعرض {n} من الصفوف بعد', '{n} more rows not shown', '{n} ڕیزی تر هێشتا پیشان نەدراون'],
  ll_hiddenAfter__one: ['لم يُعرض صفّ واحد بعد', '{n} more row not shown', 'ڕیزێکی تر هێشتا پیشان نەدراوە'],
  ll_hiddenBefore: ['لم يُعرض {n} من السطور الأقدم', '{n} earlier lines not shown', '{n} دێڕی کۆنتر پیشان نەدراون'],
  ll_hiddenBefore__one: ['لم يُعرض سطر أقدم واحد', '{n} earlier line not shown', 'دێڕێکی کۆنتر پیشان نەدراوە'],
  ll_more: ['عرض المزيد ({n})', 'Show {n} more', 'زیاتر پیشان بدە ({n})'],
  ll_all: ['عرض الكل', 'Show all', 'هەمووی پیشان بدە']
} as const;
