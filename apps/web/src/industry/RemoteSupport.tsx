import { useEffect, useState } from 'react';
import { APP_VERSION, buildSupportDetails, type SupportEdition, type SupportFacts, type SupportRole } from '@qasa/core';
import { api } from '../api.ts';
import { Modal, useData, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { copyText } from '../share.ts';
import { outboxCounts, useOutbox } from './OutboxBanner.tsx';

/**
 * Remote support (Settings → About, and Help → Remote support… in the Windows app): what Quick Assist is and how to use
 * it safely, a button that starts it (Windows app only), and "Copy support details" for WhatsApp.
 *
 * The page never names what opens: qasaDesktop.remoteSupport() takes no argument, and the main process opens only
 * Quick Assist or its Store page (apps/desktop/src/remote-support.ts). The details are built by @qasa/core
 * buildSupportDetails from a few checked facts, and never carry passwords, keys, codes, customer data, paths or IPs.
 */

interface DesktopSupport {
  remoteSupport?: () => Promise<unknown>;
  supportInfo?: () => Promise<unknown>;
  onRemoteSupport?: (listener: () => void) => () => void;
}

/** The Windows app's remote-support calls, or null in a browser, the demo and Windows apps from before them. */
export function desktopSupport(): DesktopSupport | null {
  if (typeof window === 'undefined') return null;
  const desktop = (window as unknown as { qasaDesktop?: DesktopSupport }).qasaDesktop;
  return desktop && typeof desktop.remoteSupport === 'function' ? desktop : null;
}

const EDITIONS: readonly SupportEdition[] = ['installer', 'store'];

/** Gathers the facts: the Windows app's own (already scrubbed there), the company file's schema, this PC's role. */
export async function supportFacts(input: {
  lang: string;
  plan: { plan: string; source: string } | null | undefined;
  outboxWaiting: number | null;
  demo: boolean;
  desktop: DesktopSupport | null;
  server?: { support(): Promise<{ schema: number; app: number }>; network(): Promise<{ on: boolean }> };
}): Promise<SupportFacts> {
  const server = input.server ?? api;
  const facts: SupportFacts = {
    version: APP_VERSION,
    edition: input.demo ? 'demo' : 'browser',
    plan: input.plan ? { plan: String(input.plan.plan), trial: input.plan.source === 'trial' } : null,
    lang: input.lang,
    outboxWaiting: input.outboxWaiting
  };
  const schema = await server.support().catch(() => null);
  if (schema) { facts.schema = schema.schema; facts.schemaApp = schema.app; }
  if (!input.desktop?.supportInfo) return facts;
  const info = (await input.desktop.supportInfo().catch(() => null)) as { edition?: unknown; windows?: unknown; role?: unknown; logLines?: unknown } | null;
  if (!info || typeof info !== 'object') return facts;
  if (EDITIONS.includes(info.edition as SupportEdition)) facts.edition = info.edition as SupportEdition;
  if (typeof info.windows === 'string') facts.windows = info.windows;
  if (Array.isArray(info.logLines)) facts.logLines = info.logLines.filter((l): l is string => typeof l === 'string');
  let role: SupportRole = info.role === 'client' ? 'client' : 'local';
  // this PC's own company: does it share it on the office network? (admins only; otherwise it stays "own company file")
  if (role === 'local') {
    const network = await server.network().catch(() => null);
    if (network) role = network.on ? 'server' : 'standalone';
  }
  facts.role = role;
  return facts;
}

export function RemoteSupportDialog({ onClose }: { onClose(): void }) {
  const { t, lang } = useI18n();
  const { plan } = useData();
  const toast = useToast();
  const outbox = useOutbox();
  const desktop = desktopSupport();
  const [started, setStarted] = useState<'store' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  async function start() {
    if (!desktop?.remoteSupport) return;
    setBusy(true);
    try {
      const outcome = await desktop.remoteSupport().catch(() => 'failed');
      setStarted(outcome === 'store' ? 'store' : outcome === 'opened' ? null : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      const facts = await supportFacts({
        lang, plan, demo: import.meta.env.MODE === 'demo', desktop,
        outboxWaiting: outbox ? outboxCounts(outbox).waiting : null
      });
      const text = buildSupportDetails(facts);
      if (await copyText(text)) { setManual(null); toast(t('rs_copied')); } else setManual(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('rs_title')} onClose={onClose}>
      <div className="stack">
        {desktop ? (
          <>
            <p style={{ margin: 0 }}>{t('rs_intro')}</p>
            <p style={{ margin: 0 }}>{t('rs_steps')}</p>
            <p style={{ margin: 0 }}>{t('rs_stop')}</p>
            <div className="alert warn" role="note">{t('rs_warning')}</div>
            {started && <div className={'alert ' + (started === 'store' ? 'info' : 'warn')} role="status">{t(started === 'store' ? 'rs_store' : 'rs_failed')}</div>}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>{t('rs_browser')}</p>
        )}
        <p className="muted small" style={{ margin: 0 }}>{t('rs_copyHelp')}</p>
        {manual !== null && (
          <>
            <div className="alert warn" role="status">{t('rs_copyFailed')}</div>
            <textarea className="ltr" dir="ltr" readOnly rows={8} value={manual} onFocus={(e) => e.currentTarget.select()} aria-label={t('rs_copy')} />
          </>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {desktop && <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>{t('rs_start')}</button>}
          <button type="button" className={'btn' + (desktop ? '' : ' primary')} disabled={busy} onClick={() => void copy()}>{t('rs_copy')}</button>
          <button type="button" className="btn subtle" onClick={onClose}>{t('rs_close')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Settings → About: a short line and the button that opens the Remote support screen. */
export function RemoteSupportSection() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <strong>{t('rs_title')}</strong>
      <p className="muted" style={{ margin: 0 }}>{desktopSupport() ? t('rs_cardText') : t('rs_browser')}</p>
      <div className="row"><button type="button" className="btn" onClick={() => setOpen(true)}>{t('rs_open')}</button></div>
      {open && <RemoteSupportDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Help → Remote support… in the Windows app's menu: the main process asks, the screen opens here. */
export function RemoteSupportFromMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => desktopSupport()?.onRemoteSupport?.(() => setOpen(true)), []);
  return open ? <RemoteSupportDialog onClose={() => setOpen(false)} /> : null;
}
