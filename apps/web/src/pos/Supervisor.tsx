import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ErrorBox, Icon, Modal } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { setRefundApproval } from '../api.ts';
import { refusedActions } from './approvals.ts';
import { tillRulesApi, type Approval, type ApprovalAction, type ApprovalFor } from './rules-api.ts';

/**
 * A supervisor's PIN at the till (2.0): `ask(action, detail, what)` opens a small dialog (`what`: the very thing approved,
 * which the server holds the approval to: rules-api.ts ApprovalFor); the supervisor types their PIN on the
 * cashier's screen and the server answers with an approval (till-rules.ts), or says the PIN is wrong. The promise gives
 * the approval, or null when the dialog is closed. The PIN is never kept here: it goes to the server once and is gone.
 */
export function useSupervisor(shiftId: string, online: boolean, onOffline: () => void): { ask(action: ApprovalAction, detail?: string, what?: ApprovalFor): Promise<Approval | null>; dialog: ReactNode } {
  const [asking, setAsking] = useState<{ action: ApprovalAction; detail?: string | undefined; what?: ApprovalFor | undefined } | null>(null);
  const done = useRef<((a: Approval | null) => void) | null>(null);
  const ask = useCallback((action: ApprovalAction, detail?: string, what?: ApprovalFor) => {
    if (!online) { onOffline(); return Promise.resolve(null); }
    return new Promise<Approval | null>((resolve) => {
      done.current = resolve;
      setAsking({ action, detail, what });
    });
  }, [online, onOffline]);
  const finish = (a: Approval | null) => {
    setAsking(null);
    done.current?.(a);
    done.current = null;
  };
  return {
    ask,
    dialog: asking ? <PinDialog shiftId={shiftId} action={asking.action} detail={asking.detail} what={asking.what} onDone={finish} /> : null
  };
}

/**
 * Sends a refund; when the server answers that a supervisor must approve it, asks for one (`ask`: the PIN dialog) and
 * sends it again with the approval (kept for the request that follows: api.ts refundApprovals; the server takes it
 * once, within two minutes). No approval given: the server's refusal is thrown. Any other error: thrown as it is.
 */
export async function refundWithPin<T>(send: () => Promise<T>, ask: () => Promise<Approval | null>, keep: (token: string) => void = setRefundApproval): Promise<T> {
  try {
    return await send();
  } catch (e) {
    if (!refusedActions(e).includes('refund')) throw e;
    const ok = await ask();
    if (!ok) throw e;
    keep(ok.token);
    return send();
  }
}

/**
 * A refund made on an invoice screen (a return or a cancel there): `run(invoiceId, lines, send)` sends it; when the
 * server answers that a supervisor must approve (the company's rule, and the money leaves a till's safe), the PIN
 * dialog opens on that screen, the supervisor types their PIN, and the refund is sent again with the approval. No
 * lines: the whole invoice (a cancel). Closed without a PIN: the server's refusal is the error shown.
 */
export function useRefundPin(): { run<T>(invoiceId: string, lines: { lineNo: number; qtyMilli: number }[] | undefined, send: () => Promise<T>): Promise<T>; dialog: ReactNode } {
  const [asking, setAsking] = useState<{ invoiceId: string; lines?: { lineNo: number; qtyMilli: number }[] | undefined } | null>(null);
  const done = useRef<((a: Approval | null) => void) | null>(null);
  const run = useCallback(async <T,>(invoiceId: string, lines: { lineNo: number; qtyMilli: number }[] | undefined, send: () => Promise<T>): Promise<T> => {
    return refundWithPin(send, () => new Promise<Approval | null>((resolve) => { done.current = resolve; setAsking({ invoiceId, lines }); }));
  }, []);
  const finish = (a: Approval | null) => {
    setAsking(null);
    done.current?.(a);
    done.current = null;
  };
  return {
    run,
    dialog: asking ? <PinDialog action="refund" onDone={finish} send={(pin) => tillRulesApi.approveRefund(asking.invoiceId, pin, asking.lines)} /> : null
  };
}

/**
 * The dialog itself. At a till it asks the shift's approval (`shiftId`); on another screen `send` says where the PIN
 * goes instead (an invoice screen's refund: rules-api.ts approveRefund).
 */
export function PinDialog({ shiftId, action, detail, what, onDone, send }: {
  shiftId?: string | undefined; action: ApprovalAction; detail?: string | undefined; what?: ApprovalFor | undefined; onDone(a: Approval | null): void;
  send?: ((pin: string) => Promise<Approval>) | undefined;
}) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin) || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await (send ? send(pin) : tillRulesApi.approve(shiftId ?? '', action, pin, detail, what)));
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
