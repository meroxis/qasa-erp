import { useState } from 'react';
import { todayIso } from '@qasa/core';
import { ErrorBox, Icon, Modal } from '../components.tsx';
import { useI18n } from '../i18n.ts';

/** Today, or the first day allowed when today is earlier (a reversal is never dated before what it reverses). */
export const reverseDefaultDate = (min?: string): string => {
  const today = todayIso();
  return min && today < min ? min : today;
};

/**
 * Confirms taking back something already approved (a payroll month, a generator month, a deposit's refund or
 * forfeit): what will happen, and the date of the approved reversing entry (today by default). Both entries stay in
 * the books.
 */
export function ReverseModal({ title, note, action, min, busy, error, onReverse, onClose }: {
  title: string; note: string; action: string; min?: string | undefined; busy: boolean; error: unknown;
  onReverse(date: string): void; onClose(): void;
}) {
  const { t } = useI18n();
  const [date, setDate] = useState(() => reverseDefaultDate(min));
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{note}</p>
        <label className="field">
          <span>{t('reversalDate')}</span>
          <input className="input" type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" disabled={busy || !date} onClick={() => onReverse(date)}><Icon name="undo" size={16} />{action}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
