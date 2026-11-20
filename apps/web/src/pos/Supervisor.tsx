import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ErrorBox, Icon, Modal } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { tillRulesApi, type Approval, type ApprovalAction } from './rules-api.ts';

/**
 * A supervisor's PIN at the till (2.0): `ask(action)` opens a small dialog; the supervisor types their PIN on the
 * cashier's screen and the server answers with an approval (till-rules.ts), or says the PIN is wrong. The promise gives
 * the approval, or null when the dialog is closed. The PIN is never kept here: it goes to the server once and is gone.
 */
export function useSupervisor(shiftId: string, online: boolean, onOffline: () => void): { ask(action: ApprovalAction, detail?: string): Promise<Approval | null>; dialog: ReactNode } {
  const [asking, setAsking] = useState<{ action: ApprovalAction; detail?: string | undefined } | null>(null);
  const done = useRef<((a: Approval | null) => void) | null>(null);
  const ask = useCallback((action: ApprovalAction, detail?: string) => {
    if (!online) { onOffline(); return Promise.resolve(null); }
    return new Promise<Approval | null>((resolve) => {
      done.current = resolve;
      setAsking({ action, detail });
    });
  }, [online, onOffline]);
  const finish = (a: Approval | null) => {
    setAsking(null);
    done.current?.(a);
    done.current = null;
  };
  return {
    ask,
    dialog: asking ? <PinDialog shiftId={shiftId} action={asking.action} detail={asking.detail} onDone={finish} /> : null
  };
}

function PinDialog({ shiftId, action, detail, onDone }: { shiftId: string; action: ApprovalAction; detail?: string | undefined; onDone(a: Approval | null): void }) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin) || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await tillRulesApi.approve(shiftId, action, pin, detail));
    } catch (e) {
      setError(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('tu_pinTitle')} onClose={() => onDone(null)}>
      <form className="stack pos-pin" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p style={{ margin: 0 }}><Icon name="key" size={18} /> {t(`tu_act_${action}` as Key)}{detail ? ` — ${detail}` : ''}</p>
        <label className="field"><span>{t('tu_pin')}</span>
          <input className="input pos-pin-input num ltr" type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="submit" className="btn primary pos-touch" disabled={busy || !/^\d{4,8}$/.test(pin)}><Icon name="check" size={18} />{t('tu_pinApprove')}</button>
          <button type="button" className="btn pos-touch" onClick={() => onDone(null)}>{t('pos_cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
