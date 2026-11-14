import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.ts';
import { useToast } from '../components.tsx';

/**
 * 1.4, Settings → Backups: "Ask to back up when I close Qasa ERP". The question itself is the Windows app's (its main
 * process asks when the window closes: close-backup.ts); this is the way to turn it off, and back on after "Don't ask
 * again". Only in the Windows app on the PC that keeps the books: a browser has nothing to close, and a PC connected
 * to an office PC has no books to back up (the app answers null there, and nothing shows).
 */
export interface CloseAskBridge {
  get(): Promise<unknown>;
  set(on: boolean): Promise<unknown>;
}

export function closeAskBridge(): CloseAskBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { qasaDesktop?: { closeAsk?: Partial<CloseAskBridge> } }).qasaDesktop?.closeAsk;
  return b && typeof b.get === 'function' && typeof b.set === 'function' ? (b as CloseAskBridge) : null;
}

/** The app's answer: on or off, or null when it isn't one (an older app, a PC connected to an office PC). */
export function closeAskOf(answer: unknown): boolean | null {
  const ask = answer && typeof answer === 'object' ? (answer as { ask?: unknown }).ask : undefined;
  return typeof ask === 'boolean' ? ask : null;
}

export function CloseAskView({ ask, busy, onChange }: { ask: boolean; busy: boolean; onChange(on: boolean): void }) {
  const { t } = useI18n();
  return (
    <div className="stack" data-close-ask style={{ gap: 8, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={ask} disabled={busy} onChange={(e) => onChange(e.target.checked)} />
        <strong>{t('s14_closeAsk')}</strong>
      </label>
      <div className="muted small">{t('s14_closeAskHelp')}</div>
    </div>
  );
}

export function CloseAskSetting() {
  const { t } = useI18n();
  const toast = useToast();
  const [bridge] = useState(closeAskBridge);
  const [ask, setAsk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.get().then((a) => { if (live) setAsk(closeAskOf(a)); }, () => {});
    return () => { live = false; };
  }, [bridge]);
  if (!bridge || ask === null) return null;
  const change = async (on: boolean) => {
    setBusy(true);
    let saved: boolean | null = null;
    try { saved = closeAskOf(await bridge.set(on)); } catch { saved = null; }
    setBusy(false);
    if (saved === null) { toast(t('s14_closeAskNotSaved')); return; }
    setAsk(saved);
    toast(t('saved'));
  };
  return <CloseAskView ask={ask} busy={busy} onChange={(on) => void change(on)} />;
}
