import { useEffect, useState } from 'react';
import { Icon } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import type { ShiftView, TillView } from '../industry/pos-api.ts';
import { desktopPrinters, savedChoices } from '../industry/printing.ts';
import { money2, shiftTime } from './shared.ts';

/** The receipt printer this PC prints receipts on (Windows app), or the print window; read once per visit. */
function useReceiptPrinter(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const desktop = desktopPrinters();
    if (!desktop) return;
    let alive = true;
    void savedChoices(desktop).then((c) => { if (alive) setName(c.receipt?.printer ?? ''); }, () => {});
    return () => { alive = false; };
  }, []);
  return name;
}

/**
 * The till's status line (2.0): which till and cashier, since when, the link to the server and what waits to be sent,
 * the receipt printer and the drawer, the baskets held, and the shift's sales (not on a blind close).
 */
export function StatusBar({ shift, till, offline, waiting, held, drawer, onHeld }: {
  shift: ShiftView; till: TillView | null; offline: boolean; waiting: number; held: number; drawer: boolean; onHeld(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const printer = useReceiptPrinter();
  return (
    <div className="pos-status no-print" role="status" aria-label={t('pos_title')}>
      <span className="pos-status-item"><Icon name="panel" size={15} /><strong>{till?.name ?? shift.register}</strong></span>
      <span className="pos-status-item"><Icon name="users" size={15} />{shift.openedBy}</span>
      <span className="pos-status-item num"><Icon name="clock" size={15} />{t('tu_since', { t: shiftTime(i18n, shift.openedAt) })} · {shift.number}</span>
      <span className={'pos-status-item pos-link ' + (offline ? 'off' : 'on')}><span className="pos-dot" aria-hidden="true" />{offline ? t('tu_offline') : t('tu_online')}</span>
      {waiting > 0 && <a className="pos-status-item warn num" href={href('outbox')}>{t('tu_waiting', { n: i18n.int(waiting) })}</a>}
      {printer !== null && <span className="pos-status-item"><Icon name="printer" size={15} />{printer ? t('tu_printer', { p: printer }) : t('tu_printWindow')}</span>}
      {drawer && <span className="pos-status-item"><Icon name="wallet" size={15} />{t('tu_drawer')}</span>}
      {held > 0 && <button type="button" className="pos-status-item pos-status-btn num" onClick={onHeld}><Icon name="clock" size={15} />{t('tl_held', { n: i18n.int(held) })}</button>}
      <span className="spacer" />
      {shift.blind ? <span className="pos-status-item muted small">{t('tu_blindNote')}</span>
        : <span className="pos-status-item num">{t('pos_salesSoFar')}: {money2(i18n, shift.sales)} · {i18n.int(shift.count)}</span>}
    </div>
  );
}
