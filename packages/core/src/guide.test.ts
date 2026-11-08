import { describe, expect, it } from 'vitest';
import { GUIDE_SLUGS, guideUrl, isGuideSlug, isGuideUrl, isQasaSiteUrl, type GuideSlug } from './guide.ts';
import { LANGS, type Lang } from './lang.ts';

describe('user guide addresses', () => {
  it('follow the site: Arabic at the root, English and Kurdish under their own folder', () => {
    expect(guideUrl(null, 'ar')).toBe('https://qasaerp.com/guide/');
    expect(guideUrl(null, 'en')).toBe('https://qasaerp.com/en/guide/');
    expect(guideUrl(null, 'ku')).toBe('https://qasaerp.com/ku/guide/');
    expect(guideUrl('point-of-sale', 'en')).toBe('https://qasaerp.com/en/guide/point-of-sale/');
    expect(guideUrl('payroll', 'ar')).toBe('https://qasaerp.com/guide/payroll/');
    expect(guideUrl('industry-tools', 'ku')).toBe('https://qasaerp.com/ku/guide/industry-tools/');
  });

  it('has the sixteen topics, each once, in lower-case words and dashes', () => {
    expect(GUIDE_SLUGS).toHaveLength(16);
    expect(new Set(GUIDE_SLUGS).size).toBe(GUIDE_SLUGS.length);
    for (const slug of GUIDE_SLUGS) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('gives only addresses the allow-list accepts, for every topic and language', () => {
    for (const lang of LANGS) {
      expect(isGuideUrl(guideUrl(null, lang))).toBe(true);
      for (const slug of GUIDE_SLUGS) {
        const url = guideUrl(slug, lang);
        expect(isQasaSiteUrl(url)).toBe(true);
        expect(isGuideUrl(url)).toBe(true);
      }
    }
  });

  it('refuses a topic that is not in the list, and falls back to Arabic for an unknown language', () => {
    expect(isGuideSlug('point-of-sale')).toBe(true);
    expect(isGuideSlug('pos')).toBe(false);
    expect(() => guideUrl('pos' as GuideSlug, 'en')).toThrow();
    expect(guideUrl(null, 'fr' as Lang)).toBe('https://qasaerp.com/guide/');
  });

  it('accepts qasaerp.com over https only, with nothing hidden in the address', () => {
    expect(isQasaSiteUrl('https://qasaerp.com/')).toBe(true);
    expect(isQasaSiteUrl('https://qasaerp.com/en/guide/')).toBe(true);
    for (const bad of [
      'http://qasaerp.com/guide/',
      'https://qasaerp.com.evil.example/guide/',
      'https://evil.example/qasaerp.com/guide/',
      'https://my.qasaerp.com/guide/',
      'https://qasaerp.com:8443/guide/',
      'https://user@qasaerp.com/guide/',
      'https://qasaerp.com@evil.example/guide/',
      'https://QASAERP.com/guide/',
      'https://qasaerp.com/en/../guide/',
      'javascript:alert(1)',
      'file:///C:/Windows/',
      'not a url',
      ''
    ]) expect(isQasaSiteUrl(bad), bad).toBe(false);
  });

  it('accepts only the guide pages as guide addresses', () => {
    for (const bad of [
      'https://qasaerp.com/',
      'https://qasaerp.com/guide',
      'https://qasaerp.com/fr/guide/',
      'https://qasaerp.com/en/guide/pos/',
      'https://qasaerp.com/en/guide/payroll/?x=1',
      'https://qasaerp.com/en/guide/payroll/#top',
      'https://qasaerp.com/guide/?',
      'https://qasaerp.com/guide/#',
      'https://qasaerp.com/en/guide/payroll/?',
      'https://qasaerp.com/en/guide/payroll/extra/'
    ]) expect(isGuideUrl(bad), bad).toBe(false);
  });
});
