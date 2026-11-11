import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { buildSupportDetails } from '@qasa/core';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n } from '../i18n.ts';
import { SUPPORT_TEXT } from '../i18n/support.ts';
import { RemoteSupportDialog, supportFacts } from './RemoteSupport.tsx';

const data = { plan: { plan: 'pro', source: 'license' } } as unknown as React.ContextType<typeof DataContext>;
const render = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') =>
  renderToStaticMarkup(
    <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
      <DataContext.Provider value={data}>{node}</DataContext.Provider>
    </I18nContext.Provider>
  );
const windowsApp = () => vi.stubGlobal('window', {
  qasaDesktop: { setLanguage() {}, remoteSupport: vi.fn(async () => 'opened'), supportInfo: vi.fn(async () => null) },
  addEventListener() {}, removeEventListener() {}
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the Remote support screen', () => {
  it('explains Quick Assist and offers it in the Windows app, in each language', () => {
    windowsApp();
    const en = render(<RemoteSupportDialog onClose={() => {}} />);
    for (const key of ['rs_intro', 'rs_steps', 'rs_stop', 'rs_start', 'rs_copy'] as const) expect(en).toContain(SUPPORT_TEXT[key][1]);
    expect(en).toContain('Qasa support (Meroxis)');
    expect(en).not.toContain(SUPPORT_TEXT.rs_browser[1]);
    expect(render(<RemoteSupportDialog onClose={() => {}} />, 'ar')).toContain('تشغيل «المساعدة السريعة»');
    expect(render(<RemoteSupportDialog onClose={() => {}} />, 'ku')).toContain('دەستپێکردنی Quick Assist');
  });

  it('shows only Copy support details in a browser or the demo, and says Quick Assist is in the Windows app', () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const html = render(<RemoteSupportDialog onClose={() => {}} />);
    expect(html).toContain(SUPPORT_TEXT.rs_browser[1]);
    expect(html).toContain(SUPPORT_TEXT.rs_copy[1]);
    expect(html).not.toContain(SUPPORT_TEXT.rs_start[1]);
  });
});

describe('the facts it copies', () => {
  const server = (on: boolean | null) => ({
    support: async () => ({ schema: 12, app: 12 }),
    network: async () => { if (on === null) throw new Error('forbidden'); return { on }; }
  });

  it('takes the Windows app’s facts, and asks whether this PC is the office server', async () => {
    const desktop = { remoteSupport: async () => 'opened', supportInfo: async () => ({ edition: 'store', windows: '10.0.22631', role: 'local', logLines: ['error one', 42] }) };
    const facts = await supportFacts({ lang: 'ar', plan: { plan: 'business', source: 'license' }, outboxWaiting: null, demo: false, desktop, server: server(true) });
    expect(facts).toMatchObject({ edition: 'store', windows: '10.0.22631', role: 'server', schema: 12, logLines: ['error one'], plan: { plan: 'business', trial: false } });
    expect((await supportFacts({ lang: 'ar', plan: null, outboxWaiting: null, demo: false, desktop, server: server(false) })).role).toBe('standalone');
    // not an admin: the office network can't be asked
    expect((await supportFacts({ lang: 'ar', plan: null, outboxWaiting: null, demo: false, desktop, server: server(null) })).role).toBe('local');
  });

  it('never lets an edition, role or secret from the bridge through unchecked', async () => {
    const desktop = { remoteSupport: async () => 'opened', supportInfo: async () => ({ edition: 'hacked', windows: '10.0.26100', role: 'client', logLines: ['failed with password=Hunter2-Las'] }) };
    const facts = await supportFacts({ lang: 'en', plan: null, outboxWaiting: 2, demo: false, desktop, server: server(true) });
    expect(facts.edition).toBe('browser');
    expect(facts.role).toBe('client');
    const text = buildSupportDetails(facts);
    expect(text).not.toContain('Hunter2-Las');
    expect(text).toContain('Outbox: 2 waiting to send');
  });

  it('works in a browser with no bridge, and without the schema when the server can’t say', async () => {
    const facts = await supportFacts({
      lang: 'en', plan: null, outboxWaiting: null, demo: true, desktop: null,
      server: { support: async () => { throw new Error('offline'); }, network: async () => ({ on: true }) }
    });
    expect(facts).toEqual({ version: facts.version, edition: 'demo', plan: null, lang: 'en', outboxWaiting: null });
  });
});
