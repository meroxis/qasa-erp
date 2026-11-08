import { describe, expect, it } from 'vitest';
import { guideUrl } from '@qasa/core';
import { EXTERNAL_HOSTS, isAllowedExternal, refusedForLog } from './external-links.ts';

describe('addresses the app window may open outside the app', () => {
  it('lets the app’s own links through: the site and guide, the portal, WhatsApp, the Store, GitHub, cloud sign-in, mail', () => {
    for (const ok of [
      'https://qasaerp.com/',
      'https://qasaerp.com/en/#download',
      guideUrl('point-of-sale', 'ku'),
      'https://my.qasaerp.com/lang/en?back=/buy',
      'https://wa.me/9647501234567?text=Hello',
      'https://wa.me/?text=%D8%B3%D9%84%D8%A7%D9%85',
      'https://apps.microsoft.com/detail/9NRTX5BBK9DW',
      'https://github.com/meroxis/qasa-erp/blob/main/THIRD_PARTY_NOTICES.md',
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x',
      'mailto:info@qasaerp.com'
    ]) expect(isAllowedExternal(ok), ok).toBe(true);
  });

  it('refuses plain http, other schemes, other hosts and look-alikes', () => {
    for (const bad of [
      'http://qasaerp.com/',
      'http://wa.me/9647501234567',
      'http://192.168.1.20:47420/',
      'https://evil.example/',
      'https://qasaerp.com.evil.example/',
      'https://wa.me.evil.example/',
      'https://evil.example/wa.me/',
      'https://sub.qasaerp.com/',
      'https://relay.qasaerp.com/',
      'https://gist.github.com/',
      'https://wa.me:8443/123',
      'https://user@wa.me/123',
      'https://wa.me@evil.example/',
      'https://qasaerp.com:8443/',
      'https://qasaerp.com@evil.example/',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:privacy',
      'smb://server/share',
      'data:text/html,hi',
      'not an address',
      ''
    ]) expect(isAllowedExternal(bad), bad).toBe(false);
  });

  it('keeps the list short and exact: no wildcard, no http, no IP address', () => {
    expect(EXTERNAL_HOSTS.length).toBeLessThanOrEqual(8);
    for (const host of EXTERNAL_HOSTS) expect(host).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/);
  });

  it('logs only the scheme and host of a refused address, never its query', () => {
    expect(refusedForLog('http://evil.example/path?token=secret')).toBe('http://evil.example');
    expect(refusedForLog('javascript:alert(1)')).toBe('javascript:');
    expect(refusedForLog('nonsense')).toBe('(not an address)');
  });
});
