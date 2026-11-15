import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Icon, useToast } from '../components.tsx';
import { ChoiceTiles } from '../ChoiceTiles.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';
import {
  desktopNotices, docRoute, noticeLine, phoneActivityApi, phoneNotifyOn, pollDelay, PHONE_NOTIFY_EVENT,
  setPhoneNotify, setToldUpTo, toldUpTo, whatToTell, type PhoneActivityAnswer, type PhoneActivityItem
} from './phone-activity.ts';

export interface Shown { on: boolean; last: number; seen: number; unseen: number; items: PhoneActivityItem[]; waiting: number | null }

/** The office's answer folded into what is shown: an answer without items ("nothing new") keeps the list it had. */
export function foldAnswer(before: Shown | null, a: PhoneActivityAnswer): Shown {
  const items = a.items ?? before?.items ?? [];
  const unseen = a.unseen ?? Math.min(before?.unseen ?? 0, items.filter((i) => i.id > a.seen).length);
  return { on: a.on, last: a.last, seen: a.seen, unseen, items, waiting: a.waiting };
}

/**
 * The header's "From phones" (1.5): what phones made that this person may see, newest first, with how many are new,
 * and the vouchers waiting for their approval. It asks the office every 20 seconds while the window is shown (a
 * minute when hidden, five when no phone is paired, longer after a failure), only while someone is signed in and only
 * where the build serves it. On this PC, what arrives is told as a Windows notification (when "Notify me of work from
 * phones" is on here and the app is not in front; in front, a short message in the app). Opening the list marks it seen.
 */
export function PhoneBell({ userKey }: { userKey: string }) {
  const i18n = useI18n();
  const toast = useToast();
  const [shown, setShown] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // the latest words and formats, for the notices made in the background
  const words = useRef(i18n);
  words.current = i18n;

  const tell = useCallback((answer: PhoneActivityAnswer) => {
    const w = words.current;
    const told = whatToTell(answer, toldUpTo(userKey), phoneNotifyOn(), w.t, (a, c) => w.money(a, c), (n) => w.int(n));
    if (!told) return;
    setToldUpTo(userKey, told.toldUpTo);
    const notice = told.notice;
    if (!notice) return;
    const desktop = desktopNotices();
    const front = typeof document !== 'undefined' && !document.hidden && document.hasFocus();
    if (desktop && !front) void desktop.phoneNotice(notice.title, notice.body, notice.route).catch(() => false);
    else if (front) toast(notice.title);
  }, [userKey, toast]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let failures = 0;
    let since: number | undefined;
    let asking = false;
    const tick = async () => {
      // one question at a time (coming back into view while one is on its way does not start a second round)
      if (asking) return;
      asking = true;
      window.clearTimeout(timer);
      let on = shownRef.current?.on ?? true;
      try {
        const answer = await phoneActivityApi.get(since);
        if (stopped) return;
        failures = 0;
        on = answer.on;
        since = answer.last;
        setShown((before) => foldAnswer(before, answer));
        tell(answer);
      } catch {
        failures++;
      } finally {
        asking = false;
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), pollDelay({ hidden: document.hidden, on, failures }));
    };
    void tick();
    // back in view: ask now rather than at the end of the longer wait
    const visible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userKey, tell]);

  const markSeen = useCallback(async () => {
    const s = shownRef.current;
    if (!s || s.unseen === 0) return;
    try {
      const answer = await phoneActivityApi.seen(s.last);
      setShown((before) => foldAnswer(before, answer));
    } catch { /* still new; asked again next time */ }
  }, []);

  // a click on a Windows notification: its document, or the list for several
  useEffect(() => {
    const desktop = desktopNotices();
    if (!desktop) return;
    return desktop.onPhoneNoticeOpen((route) => {
      if (route) go(route);
      else setOpen(true);
    });
  }, []);

  useEffect(() => { if (open) void markSeen(); }, [open, markSeen]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!shown) return null;
  return <PhoneBellView shown={shown} open={open} setOpen={setOpen} box={box} button={button} />;
}

/** What the header shows of work from phones (PhoneBell asks for it): the button with its count, and the list when open. */
export function PhoneBellView({ shown, open, setOpen, box, button }: {
  shown: Shown;
  open: boolean;
  setOpen(open: boolean): void;
  box?: RefObject<HTMLDivElement | null>;
  button?: RefObject<HTMLButtonElement | null>;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const waiting = shown.waiting ?? 0;
  // nothing to show where no phone is paired and nothing waits for this person
  if (!shown.on && !shown.items.length && !waiting) return null;
  const count = shown.unseen + waiting;
  const label = count ? `${t('pn_title')}: ${t('pn_unseen', { n: i18n.int(count) })}` : t('pn_title');
  const openItem = (item: PhoneActivityItem) => {
    setOpen(false);
    const route = docRoute(item);
    if (route) go(route);
  };
  return (
    <div className="menu-anchor phone-bell no-print" ref={box}>
      <button ref={button} type="button" className="btn subtle icon" aria-expanded={open} aria-haspopup="true" aria-label={label} title={label} onClick={() => setOpen(!open)}>
        <Icon name="phone" size={16} />
        {count > 0 && <span className="phone-bell-count" aria-hidden="true">{count > 99 ? '99+' : i18n.int(count)}</span>}
      </button>
      {open && (
        <div className="menu phone-menu" role="dialog" aria-label={t('pn_title')}>
          <div className="phone-menu-head"><strong>{t('pn_title')}</strong></div>
          {waiting > 0 && (
            <a className="menu-item" href={href('entries')} onClick={() => setOpen(false)}>
              <Icon name="receipt" size={16} /><span>{t('pn_waiting', { n: i18n.int(waiting) })}</span>
            </a>
          )}
          {waiting > 0 && <div className="menu-sep" />}
          {shown.items.length === 0 && <p className="small muted phone-menu-empty">{t('pn_none')}</p>}
          <div className="phone-menu-list">
            {shown.items.map((item) => {
              const route = docRoute(item);
              return (
                <button key={item.id} type="button" className={'menu-item phone-row' + (item.id > shown.seen ? ' new' : '')} disabled={!route} onClick={() => openItem(item)}>
                  <Icon name={kindIcon(item.kind)} size={16} />
                  <span className="phone-row-text">
                    <span className="bidi">{noticeLine(item, t, (a, c) => i18n.money(a, c))}</span>
                    <span className="small muted"><span className="bidi">{t('pn_viaPhone', { phone: item.phone })}</span> · {i18n.dateTime(item.at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const kindIcon = (kind: PhoneActivityItem['kind']): string =>
  kind === 'sale' || kind === 'order' ? 'cart' : kind === 'receipt' || kind === 'expense' ? 'receipt' : kind === 'count' ? 'box' : 'truck';

/**
 * Settings → Language and display → "Notify me of work from phones": on this PC only (kept like the appearance and
 * the language), on unless switched off. Shown where the build brings work from phones.
 */
export function PhoneNotifySetting() {
  const { t } = useI18n();
  const [on, setOn] = useState(phoneNotifyOn);
  useEffect(() => {
    const changed = () => setOn(phoneNotifyOn());
    window.addEventListener(PHONE_NOTIFY_EVENT, changed);
    return () => window.removeEventListener(PHONE_NOTIFY_EVENT, changed);
  }, []);
  return (
    <div className="setting">
      <Icon name="phone" size={20} className="setting-icon" />
      <div className="setting-text"><strong>{t('pn_setting')}</strong><span>{t('pn_settingHelp')}</span></div>
      <div className="setting-ctl">
        <ChoiceTiles
          label={t('pn_setting')} value={on ? 'on' : 'off'} onChange={(v) => setPhoneNotify(v === 'on')}
          options={[{ value: 'on', label: t('pn_on'), icon: 'phone' }, { value: 'off', label: t('pn_off'), icon: 'x' }]}
        />
      </div>
    </div>
  );
}
