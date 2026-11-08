/** About & legal: the licences, the policies and the third-party notices. Arabic, English and Kurdish (Sorani), like i18n.ts. */
export const LEGAL_TEXT = {
  lg_title: ['حول البرنامج والشروط', 'About & legal', 'دەربارە و یاسایی'],
  lg_version: ['النسخة', 'Version', 'وەشان'],
  lg_maker: ['من إنتاج Meroxis', 'Made by Meroxis', 'بەرهەمی Meroxis'],
  lg_licences: ['الترخيص', 'Licences', 'مۆڵەتەکان'],
  lg_core: [
    'نواة قاصة ERP برنامج حر بموجب رخصة جنو العمومية أفيرو (AGPL) الإصدار 3 أو أحدث، ويمكنك قراءة شيفرتها المصدرية.',
    'The core of Qasa ERP is free software under the GNU Affero General Public License (AGPL), version 3 or later; you can read its source code.',
    'ناوکی قاسە ERP بەرنامەیەکی ئازادە لەژێر مۆڵەتی گشتیی ئەفێرۆی گنو (AGPL) وەشانی ٣ یان نوێتر؛ دەتوانیت کۆدی سەرچاوەکەی بخوێنیتەوە.'
  ],
  lg_pro: [
    'المزايا المدفوعة (Pro وBusiness) ووحدة الترخيص ملكية خاصة لـ Meroxis، ليست مفتوحة المصدر، وتخضع لاتفاقية الترخيص (EULA).',
    'The paid features (Pro and Business) and the licence module are proprietary to Meroxis, not open source, and covered by the licence agreement (EULA).',
    'تایبەتمەندییە پارەدارەکان (Pro و Business) و مۆدیولی مۆڵەت موڵکی Meroxisن، سەرچاوەکراوە نین، و لەژێر ڕێککەوتنی مۆڵەتدان (EULA).'
  ],
  lg_privacyNote: [
    'دفاتر شركتك تبقى على حواسيبك ولا تصل إلى Meroxis.',
    'Your company’s books stay on your computers and never reach Meroxis.',
    'دەفتەرەکانی کۆمپانیاکەت لەسەر کۆمپیوتەرەکانت دەمێننەوە و ناگەنە Meroxis.'
  ],
  lg_terms: ['شروط الخدمة', 'Terms of service', 'مەرجەکانی خزمەتگوزاری'],
  lg_privacy: ['سياسة الخصوصية', 'Privacy policy', 'سیاسەتی تایبەتێتی'],
  lg_eula: ['اتفاقية الترخيص (EULA)', 'Licence agreement (EULA)', 'ڕێککەوتنی مۆڵەت (EULA)'],
  lg_refunds: ['سياسة الاسترداد', 'Refund policy', 'سیاسەتی گەڕاندنەوەی پارە'],
  lg_data: ['ملخص البيانات', 'Data summary', 'پوختەی داتا'],
  lg_acceptable: ['الاستخدام المقبول', 'Acceptable use', 'بەکارهێنانی پەسەندکراو'],
  lg_thirdParty: ['إشعارات الطرف الثالث', 'Third-party notices', 'ئاگادارییەکانی لایەنی سێیەم'],
  lg_source: ['الشيفرة المصدرية', 'Source code', 'کۆدی سەرچاوە'],
  lg_agree: [
    'باستخدامك قاصة ERP فإنك توافق على {terms} و{privacy}.',
    'By using Qasa ERP you agree to the {terms} and the {privacy}.',
    'بە بەکارهێنانی قاسە ERP ڕازی دەبیت بە {terms} و {privacy}.'
  ],
  lg_agreePaid: [
    'بتفعيل ترخيص مدفوع فإنك توافق أيضاً على {eula}.',
    'By activating a paid licence you also agree to the {eula}.',
    'بە چالاککردنی مۆڵەتێکی پارەدار هەروەها ڕازی دەبیت بە {eula}.'
  ]
} as const satisfies Record<string, readonly [string, string, string]>;
