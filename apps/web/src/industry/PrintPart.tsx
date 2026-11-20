import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { printAlone } from './printing.ts';

/**
 * 2.0.0: one paper printed alone on A4 (a wholesale route sheet, a sales order, a van sheet, a collection receipt, a
 * delivery slip, a consignment statement): the paper is kept hidden in <body> and only it goes to the printer, as the
 * till's receipt does (styles.css .print-part-host).
 */
export function PrintPart({ id, children }: { id: string; children: ReactNode }) {
  return createPortal(<div className="print-part-host" data-print-part={id}>{children}</div>, document.body);
}

export function printPart(id: string): void {
  // only this paper shows: every host is hidden, and this one is marked to show
  for (const el of document.querySelectorAll<HTMLElement>('.print-part-host')) el.classList.toggle('print-part-on', el.dataset.printPart === id);
  void printAlone('report', 'print-part');
}

export function PrintPartButton({ id, label }: { id: string; label?: string }) {
  const { t } = useI18n();
  return <button type="button" className="btn small no-print" onClick={() => printPart(id)}><Icon name="printer" size={14} />{label ?? t('print')}</button>;
}

/** A plain paper: the company, a title, a date and rows of label and value, then a table. */
export function Paper({ company, title, sub, children }: { company: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="paper print-part-paper">
      <div className="small">{company}</div>
      <h2 style={{ margin: '4px 0' }}>{title}</h2>
      {sub && <div className="small">{sub}</div>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}
