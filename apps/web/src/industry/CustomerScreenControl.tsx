import { useCallback, useEffect, useState } from 'react';
import { Icon, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { closeCustomerScreen, customerScreenState, openCustomerScreen } from './till.ts';

/**
 * The customer screen this PC opened (2.0): opened and closed from the till's menu and from Settings → Tills. In the
 * Windows app its window is full screen on the second screen, with nothing on it to close it by; when that screen is
 * unplugged the app hides the window (never over the till) and shows it again when the screen is back.
 */
function useCustomerScreen() {
  const [state, setState] = useState({ open: false, waiting: false });
  const refresh = useCallback(() => { void customerScreenState().then(setState).catch(() => { /* as it was */ }); }, []);
  useEffect(refresh, [refresh]);
  const open = async () => { const ok = await openCustomerScreen(); refresh(); return ok; };
  const close = async () => { await closeCustomerScreen(); refresh(); };
  return { state, open, close };
}

/** The till's menu: open the customer screen, and close it when this PC has it open. `onDone`: the menu closes. */
export function CustomerScreenButtons({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { state, open, close } = useCustomerScreen();
  return (
    <>
      <button type="button" className="btn" onClick={() => { onDone?.(); void open().then((ok) => { if (!ok) toast(t('tl_screenBlocked')); }); }}>
        <Icon name="panel" size={16} />{t('tl_customerScreen')}
      </button>
      {state.open && (
        <button type="button" className="btn" data-customer-screen="close" onClick={() => { onDone?.(); void close(); }}>
          <Icon name="panel" size={16} />{t('tl_customerScreenClose')}
        </button>
      )}
    </>
  );
}

/** Settings → Tills: the same two actions for this PC, with what the window is doing now. */
export function CustomerScreenCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { state, open, close } = useCustomerScreen();
  return (
    <div className="settings-group" data-setting="pos-customer-screen">
      <div className="setting">
        <Icon name="panel" size={20} className="setting-icon" />
        <div className="setting-text">
          <strong>{t('tl_screenHere')}</strong>
          <span>{t('tl_screenHereHelp')}</span>
          {state.open && <span className="small muted">{state.waiting ? t('tl_screenWaiting') : t('tl_screenIsOpen')}</span>}
        </div>
        <div className="setting-ctl row" style={{ gap: 8 }}>
          <button type="button" className="btn small" onClick={() => { void open().then((ok) => { if (!ok) toast(t('tl_screenBlocked')); }); }}>{t('tl_screenOpenNow')}</button>
          <button type="button" className="btn small" disabled={!state.open} onClick={() => { void close(); }}>{t('tl_screenCloseNow')}</button>
        </div>
      </div>
    </div>
  );
}
