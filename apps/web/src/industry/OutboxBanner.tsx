import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { Icon } from '../components.tsx';
import { outboxClient, type OutboxState } from './outbox.ts';

/**
 * The window's outbox as it is now (null: this PC keeps none: the office server PC itself, a browser, the demo).
 * Re-renders on every change: an entry kept or sent, the link lost or back.
 */
export function useOutbox(): OutboxState | null {
  const box = outboxClient();
  return useSyncExternalStore(
    (fn) => (box ? box.subscribe(() => fn()) : () => {}),
    () => (box ? box.snapshot : null),
    // the app is never rendered on a server; the same answer keeps a static render (tests) true to the window
    () => (box ? box.snapshot : null)
  );
}

/** How many wait and how many the server refused. */
export function outboxCounts(state: Pick<OutboxState, 'entries'>): { waiting: number; refused: number } {
  return {
    waiting: state.entries.filter((e) => e.state === 'waiting').length,
    refused: state.entries.filter((e) => e.state === 'refused').length
  };
}

export type OutboxNotice =
  | { kind: 'offline'; waiting: number }
  | { kind: 'sending'; waiting: number }
  | { kind: 'waiting'; waiting: number }
  | null;

/** What the bar says about the link and what waits (the refused and a damaged list have bars of their own). */
export function outboxNotice(state: OutboxState | null): OutboxNotice {
  if (!state) return null;
  const { waiting } = outboxCounts(state);
  if (!state.online) return { kind: 'offline', waiting };
  if (waiting && state.sending) return { kind: 'sending', waiting };
  if (waiting) return { kind: 'waiting', waiting };
  return null;
}

/**
 * The bar at the top of every page on a PC connected to an office server: "Offline — 3 waiting to send" while the
 * server can't be reached, "Sending…" while what waited goes, and what the server refused, with the way to the list.
 */
export function OutboxBanner({ page }: { page: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const state = useOutbox();
  if (!state) return null;
  const notice = outboxNotice(state);
  const { refused } = outboxCounts(state);
  const onList = page === 'outbox';
  const link = onList ? null : <a href={href('outbox')}>{t('ob_open')}</a>;
  return (
    <>
      {notice?.kind === 'offline' && (
        <div className="alert warn outbox-banner no-print" role="status" aria-live="polite">
          <Icon name="zap" size={16} />
          <span>{notice.waiting ? t('ob_bannerOffline', { n: i18n.int(notice.waiting) }) : t('ob_bannerOfflineNone')}</span>
          {notice.waiting > 0 && link}
        </div>
      )}
      {(notice?.kind === 'sending' || notice?.kind === 'waiting') && (
        <div className="alert info outbox-banner no-print" role="status" aria-live="polite">
          <Icon name="clock" size={16} />
          <span>{t(notice.kind === 'sending' ? 'ob_bannerSending' : 'ob_bannerWaiting', { n: i18n.int(notice.waiting) })}</span>
          {link}
        </div>
      )}
      {refused > 0 && (
        <div className="alert bad outbox-banner no-print" role="alert">
          <Icon name="inbox" size={16} />
          <span>{t('ob_bannerRefused', { n: i18n.int(refused) })}</span>
          {link}
        </div>
      )}
      {state.damaged && (
        <div className="alert bad outbox-banner no-print" role="alert">
          <span>{t('ob_bannerDamaged')}</span>
        </div>
      )}
    </>
  );
}
