import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { WEBAPI_TEXT } from '../i18n/webapi.ts';
import { ConnectCard } from './WebsiteApi.tsx';

// Settings → Website API: over the internet a website takes the office ID and the office key (requests sealed for this
// office, through Cloudflare); on the office network the address and the certificate code it pins.
const LANGS = ['ar', 'en', 'ku'] as const;
const OFFICE_KEY = 'q8Zx3VbL0mWnP1sT4uYc7dEf9gHi2jKl5oRa6Nw_e-A';
const render = (net: Parameters<typeof ConnectCard>[0]['net'], lang: (typeof LANGS)[number] = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
    <ConnectCard net={net} />
  </I18nContext.Provider>
);
const network = { on: true, port: 47420, addresses: ['192.168.1.10'], code: 'AB12-CD34-EF56-7890' };

describe('how a website reaches this office', () => {
  it('shows the office ID and the office key for Qasa Relay, and the address and certificate code on the office network', () => {
    const html = render({ ...network, relay: { state: 'online', officeId: 'ABCDEFGH23', officeIdShown: 'ABCDE-FGH23', officeKey: OFFICE_KEY } });
    const en = makeI18n('en', 'western', () => {}, () => {});
    expect(html).toContain('ABCDE-FGH23');
    expect(html).toContain(OFFICE_KEY);
    expect(html).toContain(en.t('wa_officeKey'));
    expect(html).toContain(en.t('wa_viaRelay'));
    // the certificate code belongs to the office network only
    expect(html.indexOf('AB12-CD34-EF56-7890')).toBeGreaterThan(html.indexOf(`>${en.t('wa_onLan')}</h3>`));
    expect(html.indexOf(OFFICE_KEY)).toBeLessThan(html.indexOf(`>${en.t('wa_onLan')}</h3>`));
    expect(html).toContain('https://192.168.1.10:47420');
  });

  it('says when internet access is off, and when the office network is off', () => {
    const en = makeI18n('en', 'western', () => {}, () => {});
    expect(render({ ...network, relay: null })).toContain(en.t('wa_relayOff'));
    expect(render({ ...network, relay: null })).not.toContain(en.t('wa_officeKey'));
    expect(render({ ...network, on: false })).toContain(en.t('wa_networkOff'));
    expect(render(null)).toContain(en.t('wa_networkOff'));
  });

  it('offers a new office key (after asking), and says when the key had to be made again', () => {
    const en = makeI18n('en', 'western', () => {}, () => {});
    const relay = { state: 'online', officeId: 'ABCDEFGH23', officeIdShown: 'ABCDE-FGH23', officeKey: OFFICE_KEY };
    const withButton = renderToStaticMarkup(
      <I18nContext.Provider value={en}>
        <ConnectCard net={{ ...network, relay }} onRenewKey={() => {}} />
      </I18nContext.Provider>
    );
    expect(withButton).toContain(en.t('wa_renewOfficeKey'));
    // only where the page can make one (an admin on the Website API page)
    expect(render({ ...network, relay })).not.toContain(en.t('wa_renewOfficeKey'));
    expect(render({ ...network, relay })).not.toContain('alert warn');
    const remade = render({ ...network, relay: { ...relay, officeKeyRemadeAt: '2026-11-02T08:30:00.000Z' } });
    expect(remade).toContain(en.t('wa_officeKeyRemade', { d: en.date('2026-11-02') }));
    expect(en.t('wa_renewOfficeKeyConfirm')).toMatch(/every connected website/);
  });

  it('has its words in Arabic, English and Kurdish, with no certificate code or port for Qasa Relay', () => {
    for (const key of [
      'wa_officeKey', 'wa_officeKeyHelp', 'wa_viaRelay', 'wa_onLan', 'err_relay_secret_unprotected', 'wa_renewOfficeKey', 'wa_renewOfficeKeyConfirm',
      'wa_officeKeyRenewed', 'wa_officeKeyRemade', 'a_office_key_renewed'
    ] as Key[]) {
      const [ar, en, ku] = LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
      expect(new Set([ar, en, ku]).size, key).toBe(3);
      expect(en, key).not.toBe(key);
    }
    for (const lang of LANGS) expect(render({ ...network, relay: { state: 'online', officeId: 'ABCDEFGH23', officeKey: OFFICE_KEY } }, lang)).toContain(OFFICE_KEY);
    // the shop's settings take the office key (no certificate code over the internet)
    expect(WEBAPI_TEXT.wa_shopsHelp[1]).toContain('office key');
    expect(WEBAPI_TEXT.wa_shopsHelp[1]).not.toContain('certificate code');
    expect(WEBAPI_TEXT.wa_connectHelp[1]).toMatch(/sealed/);
    expect(JSON.stringify(WEBAPI_TEXT)).not.toMatch(/8790|relay-direct/);
  });
});
