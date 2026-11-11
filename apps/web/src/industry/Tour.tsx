import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { BusinessType } from '@qasa/core';
import { Icon, useData } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { mayLeave } from './leave-guard.ts';

/** Ask the app to open the tour (from Help & support or the Ctrl+K search). */
export const TOUR_EVENT = 'qasa-tour';
export const showTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

const doneKey = (user: string) => `qasa.tour.done.${user || 'owner'}`;
export function tourDone(user: string): boolean {
  try { return localStorage.getItem(doneKey(user)) === '1'; } catch { return true; }
}
function markDone(user: string) {
  try { localStorage.setItem(doneKey(user), '1'); } catch { /* not available */ }
}

interface Step { id: string; title: Key; target?: string; icon: string }

const INDUSTRY: readonly BusinessType[] = ['realEstate', 'mobileShop', 'autoParts', 'engineeringWorks', 'electricalSolar', 'generators'];

/**
 * The welcome tour: a few short steps with a spotlight on the real screen. Shown once per person after the company says
 * what it does; skip with "Skip" or Esc at any step; opened again from Help & support or Ctrl+K.
 */
export function Tour({ user, businessTypes, onClose }: { user: string; businessTypes: readonly BusinessType[]; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { plan } = useData();
  const industry = businessTypes.filter((b) => INDUSTRY.includes(b));
  const steps: Step[] = [
    { id: 'welcome', title: 'tour_welcomeTitle', icon: 'home' },
    { id: 'home', title: 'tour_homeTitle', target: '[data-tour="launcher"] .launch-section', icon: 'rows' },
    { id: 'nav', title: 'tour_navTitle', target: '.sidebar', icon: 'star' },
    { id: 'search', title: 'tour_searchTitle', target: '.search-trigger', icon: 'search' },
    ...(industry.length ? [{ id: 'industry', title: 'tour_industryTitle' as Key, target: '.launch-section.g-gIndustry', icon: 'building' }] : []),
    { id: 'brief', title: 'br_title', target: '[data-tour="brief"]', icon: 'sun' },
    { id: 'help', title: 'tour_helpTitle', target: '[data-tour="support"]', icon: 'mail' }
  ];
  const [at, setAt] = useState(0);
  const [never, setNever] = useState(true);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[at]!;
  const last = at === steps.length - 1;

  // the tour talks about the home screen: start there
  // (opened from Ctrl+K on an editor: ask first, or the typed work would be lost; no means no tour)
  useEffect(() => {
    if (/^#\/?(home)?$/.test(location.hash)) return;
    if (mayLeave(t('bn_leaveEditor'))) go('');
    else onClose();
  }, []);

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
  }, [step.target]);

  useLayoutEffect(() => {
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
    measure();
    // the page may still be loading its tiles: measure again shortly
    const again = setTimeout(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(again); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [measure, step.target]);

  useEffect(() => { card.current?.focus(); }, [at]);

  const finish = (remember: boolean) => { if (remember) markDone(user); onClose(); };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); finish(never); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const forward = (e.key === 'ArrowLeft') === (i18n.dir === 'rtl');
      e.preventDefault();
      setAt((i) => Math.max(0, Math.min(steps.length - 1, i + (forward ? 1 : -1))));
    } else if (e.key === 'Tab') {
      // keep focus inside the tour card
      const els = card.current?.querySelectorAll<HTMLElement>('button, a, input');
      if (!els?.length) return;
      const first = els[0]!, end = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    }
  }

  // where the card goes: beside the spotlight when there is room, otherwise in the middle
  const pad = 8;
  const W = Math.min(380, window.innerWidth - 32);
  let pos: CSSProperties = {};
  if (rect) {
    const spaceRight = window.innerWidth - rect.right, spaceLeft = rect.left, spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow > 240 && rect.height < window.innerHeight * 0.5) pos = { top: rect.bottom + 14, left: clamp(rect.left + rect.width / 2 - W / 2, 16, window.innerWidth - W - 16) };
    else if (rect.top > 300) pos = { bottom: window.innerHeight - rect.top + 14, left: clamp(rect.left + rect.width / 2 - W / 2, 16, window.innerWidth - W - 16) };
    else if (spaceRight > W + 32) pos = { top: clamp(rect.top, 16, window.innerHeight - 320), left: rect.right + 16 };
    else if (spaceLeft > W + 32) pos = { top: clamp(rect.top, 16, window.innerHeight - 320), left: rect.left - W - 16 };
    else pos = { top: clamp(rect.top + 24, 16, window.innerHeight - 320), left: clamp(rect.left + rect.width / 2 - W / 2, 16, window.innerWidth - W - 16) };
  }

  const p = plan?.plan ?? 'free';
  const onTrial = plan?.source === 'trial' && plan.trialActive;
  const planText = onTrial && plan?.trialEnds ? t('tour_planTrial', { d: i18n.date(plan.trialEnds) }) : t(`tour_plan_${p}` as Key);

  return (
    <div className="tour no-print" onKeyDown={onKey}>
      {rect
        ? <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} aria-hidden="true" />
        : <div className="tour-scrim" aria-hidden="true" />}
      <div
        ref={card} className={'tour-card' + (rect ? '' : ' center')} style={rect ? { ...pos, width: W } : { width: Math.min(460, window.innerWidth - 32) }}
        role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}
      >
        <div className="tour-top">
          <span className="tour-ico"><Icon name={step.icon} size={18} /></span>
          <span className="small muted">{t('tour_step', { n: i18n.int(at + 1), m: i18n.int(steps.length) })}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost small" onClick={() => finish(never)}>{t('tour_skip')}</button>
        </div>
        <h2 id="tour-title">{t(step.title)}</h2>
        <div id="tour-body" className="tour-body">
          {step.id === 'welcome' && (
            <>
              <p>{t('tour_welcomeText')}</p>
              {businessTypes.length > 0 && <p><strong>{t('tour_yourBusiness')}</strong> {businessTypes.map((b) => t(`bt_${b}` as Key)).join(i18n.lang === 'en' ? ', ' : '، ')}</p>}
              <p><strong>{t('tour_yourPlan')}</strong> {planText}</p>
              {p === 'free' && !onTrial && <p className="muted">{t('tour_proAdds')}</p>}
              {p === 'starter' && !onTrial && <p className="muted">{t('tour_starterAdds')}</p>}
              {p === 'pro' && !onTrial && <p className="muted">{t('tour_businessAdds')}</p>}
            </>
          )}
          {step.id === 'home' && <p>{t('tour_homeText')}</p>}
          {step.id === 'nav' && <p>{t('tour_navText')}</p>}
          {step.id === 'search' && <p>{t('tour_searchText')} <kbd className="ltr">Ctrl K</kbd></p>}
          {step.id === 'industry' && (
            <>
              <p>{t('tour_industryText')}</p>
              <ul>{industry.map((b) => <li key={b}><strong>{t(`bt_${b}` as Key)}</strong>: {t(`bt_${b}Text` as Key)}</li>)}</ul>
            </>
          )}
          {step.id === 'brief' && <p>{t('tour_briefText')}</p>}
          {step.id === 'help' && (
            <>
              <p>{t('tour_helpText')}</p>
              <p><a href={href('import')} onClick={() => finish(never)}>{t('importExcel')}</a></p>
            </>
          )}
        </div>
        <div className="tour-dots" aria-hidden="true">{steps.map((s, i) => <span key={s.id} className={i === at ? 'on' : ''} />)}</div>
        <div className="tour-foot">
          <label className="tour-never"><input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} /> {t('tour_never')}</label>
          <span className="spacer" />
          {at > 0 && <button type="button" className="btn" onClick={() => setAt(at - 1)}>{t('tour_back')}</button>}
          <button type="button" className="btn primary" onClick={() => (last ? finish(true) : setAt(at + 1))}>{t(last ? 'tour_done' : 'tour_next')}</button>
        </div>
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

