/**
 * 1.4.1: receipts that documents make (an installment collected, a job's deposit, a solar system paid in cash, a unit's
 * reservation deposit, a generator collection) wait for approval when "Vouchers need approval" is on and the person
 * may not approve vouchers. Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const DOC_APPROVAL_TEXT = {
  da_waiting: ['استُلم، بانتظار الموافقة', 'Collected, waiting for approval', 'وەرگیرا، چاوەڕێی پەسەندکردن'],
  da_waitingAmount: ['بانتظار الموافقة: {a}', 'Waiting for approval: {a}', 'چاوەڕێی پەسەندکردن: {a}'],
  da_savedWaiting: [
    'حُفظ سند القبض، ويُحتسب بعد الموافقة عليه.',
    'The receipt is saved. It counts once it is approved.',
    'سەنەدی وەرگرتن پاشەکەوت کرا. دوای پەسەندکردن هەژمار دەکرێت.'
  ],
  da_notCounted: [
    'لا يُحتسب ما ينتظر الموافقة ولا المرفوض.',
    'What waits for approval, and what was rejected, does not count.',
    'ئەوەی چاوەڕێی پەسەندکردنە و ئەوەی ڕەتکراوەتەوە هەژمار ناکرێن.'
  ],
  dep_waitingNote: [
    'عربون بانتظار الموافقة: لا يُحتسب، ولا تُباع الوحدة ولا تُحرَّر حتى يُوافق عليه أو يُرفض.',
    'A deposit waits for approval: it does not count yet, and the unit can be neither sold nor released until it is approved or rejected.',
    'عەرەبوونێک چاوەڕێی پەسەندکردنە: هێشتا هەژمار ناکرێت، و یەکەکە نە دەفرۆشرێت نە ئازاد دەکرێت تا پەسەند یان ڕەت دەکرێتەوە.'
  ],
  err_deposit_waiting: [
    'عربون على هذه الوحدة بانتظار الموافقة: وافق عليه أو ارفضه أولاً.',
    'A deposit on this unit waits for approval: approve or reject it first.',
    'عەرەبوونێک لەسەر ئەم یەکەیە چاوەڕێی پەسەندکردنە: سەرەتا پەسەندی بکە یان ڕەتی بکەرەوە.'
  ],
  err_job_receipt_waiting: [
    'سند قبض لهذا العمل بانتظار الموافقة: وافق عليه أو ارفضه قبل البيع.',
    'A receipt for this job waits for approval: approve or reject it before the sale.',
    'سەنەدی وەرگرتنێک بۆ ئەم کارە چاوەڕێی پەسەندکردنە: پێش فرۆشتن پەسەندی بکە یان ڕەتی بکەرەوە.'
  ]
} as const satisfies Record<string, readonly [string, string, string]>;
