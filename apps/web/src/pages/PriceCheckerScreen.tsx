import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isLang, UNITS, type Lang } from '@qasa/core';
import { makeI18n } from '../i18n.ts';
import { offerSummary } from './Offers.tsx';
import { deviceGet, type PriceCheck, type SlideOffer } from '../industry/market-extras-api.ts';

/**
 * The price checker screen (#/price-checker): a full-screen page for a tablet or an old PC near the shelves. It has no
 * sign-in: the device token the admin's link carried (after #) is kept on this device, and it opens the two lookups
 * and nothing else. A customer scans (or types) a barcode and sees the name, picture, price and the offer on it now;
 * after a few seconds, or while nobody scans, the offers on now go round. No cost, no stock, no other page.
 */

const TOKEN_KEY = 'qasa_price_checker_token';
const LANG_KEY = 'qasa_price_checker_lang';
const SHOW_MS = 10_000;
const SLIDE_MS = 6_000;

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* a browser with no storage: kept for this visit only */ }
}

/** The token the admin's link carried (#/price-checker?token=…), else the one this device kept. */
export function tokenFrom(hash: string, kept: string | null): string | null {
  const q = hash.split('?')[1] ?? '';
  const fromLink = new URLSearchParams(q).get('token');
  return fromLink && /^qpc_[A-Za-z0-9_-]{16,80}$/.test(fromLink) ? fromLink : kept;
}

export function PriceCheckerScreen({ fetcher = fetch, hash }: { fetcher?: typeof fetch; hash?: string }) {
  const [token, setToken] = useState<string | null>(() => tokenFrom(hash ?? location.hash, stored(TOKEN_KEY)));
  const [lang, setLangState] = useState<Lang>(() => { const l = stored(LANG_KEY); return l && isLang(l) ? l : 'ar'; });
  const i18n = useMemo(() => makeI18n(lang, 'western', () => {}, () => {}), [lang]);
  const { t } = i18n;
  const [code, setCode] = useState('');
  const [result, setResult] = useState<PriceCheck | null>(null);
  const [slides, setSlides] = useState<SlideOffer[]>([]);
  const [slide, setSlide] = useState(0);
  const [problem, setProblem] = useState<'token' | 'network' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const clear = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the token from the link is kept, and taken out of the address bar
  useEffect(() => {
    if (!token) return;
    store(TOKEN_KEY, token);
    if (location.hash.includes('token=')) history.replaceState(null, '', `${location.pathname}#/price-checker`);
  }, [token]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    store(LANG_KEY, lang);
  }, [lang]);

  const failed = useCallback((e: unknown) => {
    const status = (e as { status?: number }).status;
    if (status === 401) { store(TOKEN_KEY, null); setToken(null); setProblem('token'); } else setProblem('network');
  }, []);

  // the offers on now, asked again every five minutes
  useEffect(() => {
    if (!token) return;
    const load = () => deviceGet<{ offers: SlideOffer[] }>('/api/price-check/offers', token, fetcher).then((r) => { setSlides(r.offers); setProblem(null); }, failed);
    load();
    const timer = setInterval(load, 300_000);
    return () => clearInterval(timer);
  }, [token, fetcher, failed]);
  useEffect(() => {
    if (result || slides.length < 2) return;
    const timer = setInterval(() => setSlide((s) => (s + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [result, slides.length]);

  // the scanner types into this box: it keeps the focus
  useEffect(() => {
    const keep = setInterval(() => { if (document.activeElement !== input.current) input.current?.focus(); }, 1500);
    return () => clearInterval(keep);
  }, []);

  async function look(scanned: string) {
    const typed = scanned.trim();
    setCode('');
    if (!typed || !token) return;
    try {
      const r = await deviceGet<PriceCheck>(`/api/price-check?code=${encodeURIComponent(typed)}`, token, fetcher);
      setResult(r);
      setProblem(null);
      if (clear.current) clearTimeout(clear.current);
      clear.current = setTimeout(() => setResult(null), SHOW_MS);
    } catch (e) {
      failed(e);
    }
  }

  const page: React.CSSProperties = {
    minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 32,
    background: 'var(--bg, #f7f7f5)', color: 'var(--ink, #111)', textAlign: 'center', fontSize: 22
  };
  if (!token) {
    return (
      <main style={page}>
        <h1 style={{ margin: 0 }}>{t('mx_pcScreenTitle')}</h1>
        <p style={{ maxWidth: 560 }}>{t(problem === 'token' ? 'mx_pcScreenRevoked' : 'mx_pcScreenNoToken')}</p>
      </main>
    );
  }
  const shown = slides[slide % Math.max(1, slides.length)];
  return (
    <main style={page}>
      <form onSubmit={(e) => { e.preventDefault(); void look(code); }} style={{ width: 'min(560px, 100%)' }}>
        <label style={{ display: 'block', fontSize: 18, marginBottom: 8 }} htmlFor="pc-code">{t('mx_pcScan')}</label>
        <input id="pc-code" ref={input} className="input ltr" autoFocus autoComplete="off" inputMode="numeric" value={code} maxLength={64}
          onChange={(e) => setCode(e.target.value)} style={{ fontSize: 26, textAlign: 'center', width: '100%' }} />
      </form>
      <section aria-live="polite" style={{ width: 'min(760px, 100%)' }}>
        {result ? (result.found ? (
          <div className="card" style={{ padding: 24 }}>
            {result.image && <img src={result.image} alt="" style={{ maxHeight: 220, maxWidth: '100%', objectFit: 'contain' }} />}
            <h2 style={{ fontSize: 34, margin: '12px 0' }}>{i18n.name(result.name!)}</h2>
            <div className="num" style={{ fontSize: 56, fontWeight: 700 }}>{i18n.money(result.price!, result.currency!)}</div>
            <div className="muted">{t('mx_pcPer', { unit: i18n.name(UNITS[result.unit!]) })}</div>
            {result.offers?.map((o, i) => (
              <div key={i} className="chip ok" style={{ fontSize: 22, padding: '8px 14px', marginTop: 12, display: 'inline-block' }}>
                {i18n.name(o.names)} · {offerSummary(i18n, o)}
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: 24 }}><h2 style={{ margin: 0 }}>{t('mx_pcNotFound')}</h2><p>{t('mx_pcAskStaff')}</p></div>
        )) : shown ? (
          <div className="card" style={{ padding: 24 }}>
            <div className="chip ok" style={{ fontSize: 20 }}>{t('mx_pcOfferNow')}</div>
            <h2 style={{ fontSize: 32, margin: '12px 0' }}>{i18n.name(shown.names)}</h2>
            <div style={{ fontSize: 26 }}>{offerSummary(i18n, shown)}</div>
            {shown.items[0]?.image && <img src={shown.items[0].image} alt="" style={{ maxHeight: 200, maxWidth: '100%', objectFit: 'contain', marginTop: 12 }} />}
            <div className="muted" style={{ marginTop: 8 }}>{shown.items.map((it) => `${i18n.name(it.name)} · ${i18n.money(it.price, it.currency)}`).join('  —  ')}</div>
          </div>
        ) : (
          <p className="muted">{t('mx_pcIdle')}</p>
        )}
        {problem === 'network' && <p className="muted small">{t('mx_pcOffline')}</p>}
      </section>
      <nav aria-label={t('language')} style={{ display: 'flex', gap: 8 }}>
        {(['ar', 'ku', 'en'] as const).map((l) => (
          <button key={l} type="button" className="btn small" aria-pressed={lang === l} onClick={() => setLangState(l)}>{l === 'ar' ? 'عربي' : l === 'ku' ? 'کوردی' : 'English'}</button>
        ))}
      </nav>
    </main>
  );
}
