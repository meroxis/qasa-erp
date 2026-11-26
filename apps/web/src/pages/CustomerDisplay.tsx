import { TILL_CARD_PAYMENTS } from '@qasa/core';
import { useEffect, useMemo, useState } from 'react';
import type { Lang, Names } from '@qasa/core';
import { CUSTOMER_CHANNEL, type CustomerScreenState } from '../industry/till.ts';
import { tillRulesApi, type DisplayFeed } from '../pos/rules-api.ts';
import { makeI18n } from '../i18n.ts';
import '../pos.css';

/**
 * The customer screen (2.0): a screen facing the customer, showing only what the till sends it (the lines, the offers
 * they get, the total, what offers saved, their points, what was paid and the change), already in the language the
 * company chose for it. Two ways to reach it:
 *
 * - a second window of the app's own page on the till's PC (the Windows app puts it on the second monitor): it hears
 *   the till in this browser, and reads the screen's pictures and logo with the till's own sign-in;
 * - another device (a tablet, a second PC) on the same network: `#/customer-display?code=123456`, the till's pairing
 *   code (Settings → Till rules), used once within ten minutes: the screen gets a key of its own for that till (kept
 *   in this browser) and reads that till's basket from the server with it, never anything else.
 *
 * While the till is idle it shows the offers running and the company's pictures, in turn. It has no buttons.
 */

const codeInHash = (): string => {
  const m = /[?&]code=(\d{6})/.exec(typeof location === 'undefined' ? '' : location.hash);
  return m ? m[1]! : '';
};

const KEY = 'qasa.customerDisplayKey';
const storedKey = (): string => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };

export function CustomerDisplay() {
  const [code, setCode] = useState(codeInHash);
  const [key, setKey] = useState(storedKey);
  const [state, setState] = useState<CustomerScreenState | null>(null);
  const [feed, setFeed] = useState<Omit<DisplayFeed, 'state'> | null>(null);
  const [pictures, setPictures] = useState<string[]>([]);
  const [wrong, setWrong] = useState(false);
  // a device with no till in its browser (a tablet): after a moment with nothing heard, it asks for the till's code
  const [askCode, setAskCode] = useState(false);
  useEffect(() => {
    if (code || key) return;
    const timer = window.setTimeout(() => setAskCode(true), 3000);
    return () => window.clearTimeout(timer);
  }, [code, key]);

  // a code typed or in the link: paired once, then the key
  useEffect(() => {
    if (!code) return;
    let alive = true;
    tillRulesApi.pair(code).then((r) => {
      if (!alive) return;
      try { localStorage.setItem(KEY, r.key); } catch { /* kept for this visit only */ }
      setKey(r.key); setCode(''); setWrong(false);
      if (/[?&]code=/.test(location.hash)) location.hash = '#/customer-display';
    }, () => { if (alive) { setCode(''); setWrong(true); } });
    return () => { alive = false; };
  }, [code]);

  // the same browser: the till's own channel
  useEffect(() => {
    if (code || key || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CUSTOMER_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const s = e.data as CustomerScreenState | null;
      if (s && typeof s === 'object' && Array.isArray(s.lines)) setState(s);
    };
    // the pictures and the screen's rules, with the till's sign-in (a cashier may read them)
    void tillRulesApi.rules().then((r) => setFeed((f) => ({ ...(f ?? { offers: [], images: [], company: { ar: '', en: '', ku: '' }, logo: null }), display: r.display })), () => {});
    void tillRulesApi.images().then(async (r) => {
      const urls = await Promise.all(r.images.map((i) => tillRulesApi.adminImage(i.id).then((x) => `data:${x.mime};base64,${x.data}`, () => '')));
      setPictures(urls.filter(Boolean));
    }, () => {});
    return () => channel.close();
  }, [code, key]);

  // another device: the server, with the screen's key, about once a second
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let pics: string[] = [];
    const tick = async () => {
      try {
        const f = await tillRulesApi.feed(key);
        if (!alive) return;
        setWrong(false);
        setState(f.state as CustomerScreenState | null);
        setFeed(f);
        if (f.images.join() !== pics.join()) {
          pics = f.images;
          const urls = await Promise.all(f.images.map((id) => tillRulesApi.feedImage(key, id).then((x) => `data:${x.mime};base64,${x.data}`, () => '')));
          if (alive) setPictures(urls.filter(Boolean));
        }
      } catch (e) {
        if (!alive) return;
        setWrong(true);
        // a key the server no longer knows: forget it and ask for a new code
        if ((e as { status?: number }).status === 404) { try { localStorage.removeItem(KEY); } catch { /* none */ } setKey(''); }
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [key]);

  useEffect(() => {
    if (!state) return;
    document.documentElement.dir = state.dir;
    document.documentElement.lang = state.lang === 'ku' ? 'ckb' : state.lang;
  }, [state?.dir, state?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const lang = ((state?.lang ?? 'ar') as Lang);
  const i18n = useMemo(() => makeI18n(lang, 'western', () => {}, () => {}), [lang]);
  const t = i18n.t;
  const company = state?.company || (feed ? feed.company[lang] || feed.company.ar : '');
  const logo = feed?.logo ? `data:${feed.logo.mime};base64,${feed.logo.data}` : '';
  const slides = useMemo(() => [
    ...(feed?.offers ?? []).map((o: Names) => ({ kind: 'offer' as const, text: o[lang] || o.ar })),
    ...pictures.map((url) => ({ kind: 'picture' as const, url }))
  ], [feed?.offers, pictures, lang]);

  if (!key && wrong && !state) {
    return (
      <div className="cd cd-idle" dir="auto">
        <div className="cd-pair">
          <p>{t('tu_cd_wrong')}</p>
          <PairForm label={t('tu_cd_connect')} hint={t('tu_cd_enterCode')} onCode={(c) => { setWrong(false); setCode(c); }} />
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="cd cd-idle">
        {logo && <img className="cd-logo" src={logo} alt="" />}
        <div className="cd-welcome">{company || t('tu_cd_waiting')}</div>
        {!code && !key && askCode && <div className="cd-pair"><p>{t('tu_cd_enterCode')}</p><PairForm label={t('tu_cd_connect')} hint={t('tu_cd_enterCode')} onCode={setCode} /></div>}
      </div>
    );
  }
  const empty = state.lines.length === 0;
  const idle = empty && !state.done;
  return (
    <div className={'cd' + (state.paying ? ' cd-paying' : '')} dir={state.dir}>
      <header className="cd-head">
        {logo && <img className="cd-logo" src={logo} alt="" />}
        <span>{company}</span>
      </header>
      {idle ? (
        <div className="cd-idle-body">
          <div className="cd-welcome">{state.welcome}</div>
          {feed?.display.slideshow !== false && slides.length > 0 && <Slides slides={slides} />}
        </div>
      ) : (
        <>
          <div className="cd-lines">
            {state.lines.slice(-12).map((l, i) => (
              <div key={i} className="cd-line">
                <span className="cd-name">{l.name}{l.offer && <span className="cd-offer">{l.offer}</span>}</span>
                <span className="num cd-qty">{l.qty}</span>
                <span className="num cd-amount">{l.amount}</span>
              </div>
            ))}
          </div>
          {state.saved && <div className="cd-row cd-saved"><span>{state.saved.label}</span><strong className="num">{state.saved.value}</strong></div>}
          <div className="cd-total"><span>{state.totalLabel}</span><strong className="num">{state.total}</strong></div>
          {state.points && <div className="cd-row"><span>{state.points.label}</span><span className="num">{state.points.value}</span></div>}
          {state.paid && <div className="cd-row"><span>{state.paid.label}</span><span className="num">{state.paid.value}</span></div>}
          {state.change && <div className="cd-row cd-change"><span>{state.change.label}</span><strong className="num">{state.change.value}</strong></div>}
          {TILL_CARD_PAYMENTS && state.paying && feed?.display.paymentText && <div className="cd-pay"><span>{t('tu_cd_payTo')}</span><strong dir="ltr">{feed.display.paymentText}</strong></div>}
          {state.done && <div className="cd-done">{state.done}</div>}
        </>
      )}
    </div>
  );
}

/** The offers and the company's pictures, one at a time, while the till is idle. */
function Slides({ slides }: { slides: ({ kind: 'offer'; text: string } | { kind: 'picture'; url: string })[] }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setAt((n) => (n + 1) % slides.length), 6000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  const s = slides[at % slides.length];
  if (!s) return null;
  return (
    <div className="cd-slide" aria-live="off">
      {s.kind === 'offer' ? <div className="cd-slide-offer">{s.text}</div> : <img src={s.url} alt="" />}
    </div>
  );
}

function PairForm({ label, hint, onCode }: { label: string; hint: string; onCode(code: string): void }) {
  const [text, setText] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(text)) onCode(text); }}>
      <input className="input num ltr" inputMode="numeric" maxLength={6} value={text} onChange={(e) => setText(e.target.value.replace(/\D/g, ''))} aria-label={hint} />
      <button type="submit" className="btn primary">{label}</button>
    </form>
  );
}
