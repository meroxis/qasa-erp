import { useState } from 'react';
import { AmountInput, ErrorBox, Icon, Modal } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { posApi, type ShiftView } from '../industry/pos-api.ts';
import { money2 } from './shared.ts';
import { DiffText } from './OpenShift.tsx';

/* ---------- closing ---------- */

export function CloseShift({ shift, keptHere = 0, held = 0, onCancel, onClosed }: { shift: ShiftView; keptHere?: number; held?: number; onCancel(): void; onClosed(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [iqd, setIqd] = useState<number | null>(null);
  const [usd, setUsd] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [closed, setClosed] = useState<ShiftView | null>(null);
  const diff = { IQD: (iqd ?? 0) - shift.expected.IQD, USD: (usd ?? 0) - shift.expected.USD };

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      setClosed(await posApi.close(shift.id, { countedCash: iqd ?? 0, ...(usd !== null ? { countedUsd: usd } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    return (
      <Modal title={t('pos_closedTitle')} onClose={onClosed}>
        <div className="stack">
          <p style={{ margin: 0 }}>{t('pos_closedText', { n: closed.number })}</p>
          {!closed.blind && <div className="pos-r-row"><span>{t('pos_expected')}</span><strong className="num">{money2(i18n, closed.expected)}</strong></div>}
          <div className="pos-r-row"><span>{t('pos_counted')}</span><strong className="num">{closed.counted ? money2(i18n, closed.counted) : '—'}</strong></div>
          {!closed.blind && <div className="pos-r-row"><span>{t('pos_difference')}</span><strong className="num">{closed.difference ? <DiffText d={closed.difference} /> : '—'}</strong></div>}
          <div className="row">
            <a className="btn primary" href={href(`pos-shift/${closed.id}`)}><Icon name="printer" size={16} />{t('pos_zReport')}</a>
            <button type="button" className="btn" onClick={onClosed}>{t('pos_done')}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('pos_closeShift')} onClose={onCancel}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('pos_closeHelp')}</p>
        <div className="pos-r-row"><span>{t('pos_openingCash')}</span><span className="num">{i18n.money(shift.openingCash, 'IQD')}</span></div>
        {/* 2.0: a blind close: the cashier counts without seeing what is expected (a supervisor sees the difference) */}
        {shift.blind ? <div className="alert info small">{t('tu_blindNote')}</div> : (
          <>
            <div className="pos-r-row"><span>{t('pos_sales')}</span><span className="num">{money2(i18n, shift.sales)}</span></div>
            {(shift.refunds.IQD > 0 || shift.refunds.USD > 0) && <div className="pos-r-row"><span>{t('pos_refunds')}</span><span className="num">−{money2(i18n, shift.refunds)}</span></div>}
            {shift.otherCash && (shift.otherCash.IQD !== 0 || shift.otherCash.USD !== 0) && <div className="pos-r-row"><span>{t('tu_otherCash')}</span><span className="num">{money2(i18n, shift.otherCash)}</span></div>}
            <div className="pos-r-row"><span>{t('pos_expected')}</span><strong className="num">{money2(i18n, shift.expected)}</strong></div>
          </>
        )}
        <div className="grid-2">
          <label className="field"><span>{t('pos_countedIqd')}</span><AmountInput value={iqd} currency="IQD" onChange={setIqd} ariaLabel={t('pos_countedIqd')} /></label>
          <label className="field"><span>{t('pos_countedUsd')}</span><AmountInput value={usd} currency="USD" onChange={setUsd} ariaLabel={t('pos_countedUsd')} /></label>
        </div>
        {iqd !== null && !shift.blind && <div className="pos-r-row"><span>{t('pos_difference')}</span><strong className="num"><DiffText d={diff} /></strong></div>}
        {keptHere > 0 && <div className="alert warn" role="alert">{t('pos_closeWaiting', { n: i18n.int(keptHere) })} <a href={href('outbox')}>{t('ob_open')}</a></div>}
        {held > 0 && <div className="alert warn" role="alert">{t('tl_heldAtClose', { n: i18n.int(held) })}</div>}
        {!shift.blind && (shift.usdTaken?.usd ?? 0) > 0 && <div className="pos-r-row small"><span>{t('tl_usdTaken')}</span><span className="num">{i18n.money(shift.usdTaken!.usd, 'USD')} = {i18n.money(shift.usdTaken!.iqd, 'IQD')}</span></div>}
        <label className="field"><span>{t('pos_notes')}</span><textarea className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || iqd === null || keptHere > 0} onClick={() => void close()}>{t('pos_closeConfirm')}</button>
          <button type="button" className="btn" onClick={onCancel}>{t('pos_cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

