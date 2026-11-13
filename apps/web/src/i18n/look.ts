/**
 * The options shown as rectangles in Settings (ChoiceTiles.tsx) that had no words of their own: the two digit styles
 * were only "١٢٣" and "123". Arabic, English and Kurdish (Sorani), in that order, like i18n.ts.
 */
export const LOOK_TEXT = {
  lk_digitsEastern: ['أرقام مشرقية', 'Eastern digits', 'ژمارەی ڕۆژهەڵاتی'],
  lk_digitsWestern: ['أرقام غربية', 'Western digits', 'ژمارەی ڕۆژئاوایی']
} as const satisfies Record<string, readonly [string, string, string]>;
