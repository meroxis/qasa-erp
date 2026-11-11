import type { FONT_FILES } from './theme';

/** The bundled fonts (assets/fonts, made by scripts/fonts.mjs), loaded by name at start (expo-font). */
export const FONT_SOURCES: Record<keyof typeof FONT_FILES, number> = {
  'NotoSansArabic-Regular': require('../assets/fonts/NotoSansArabic-Regular.ttf'),
  'NotoSansArabic-SemiBold': require('../assets/fonts/NotoSansArabic-SemiBold.ttf'),
  'NotoSansArabic-Bold': require('../assets/fonts/NotoSansArabic-Bold.ttf'),
  'IBMPlexSans-Regular': require('../assets/fonts/IBMPlexSans-Regular.ttf'),
  'IBMPlexSans-SemiBold': require('../assets/fonts/IBMPlexSans-SemiBold.ttf'),
  'IBMPlexSans-Bold': require('../assets/fonts/IBMPlexSans-Bold.ttf')
};
