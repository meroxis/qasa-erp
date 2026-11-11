import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useData } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { ControlledRecord } from '../pages/Pharmacy.tsx';
import { pharmacyApi, type ControlledLine } from './pharmacy-api.ts';

/**
 * The pharmacy's reminders on a sale (Pro, a company that is a pharmacy): the Rx badge and the "prescription seen" tick
 * on each line of a prescription-only medicine (a reminder, never enforced), and the patient and prescription asked for
 * each controlled medicine once the sale is posted, from the POS or the sale invoice.
 */

/** Whether the pharmacy pack is on: the plan has it and the company is a pharmacy. */
export function usePharmacyOn(): boolean {
  const { plan, settings } = useData();
  return !!plan?.features.includes('pharmacy') && !!settings?.businessTypes?.includes('pharmacy');
}

/** The item ids of the prescription-only medicines, for the Rx badge on sale lines; none when the pack is off. */
export function useRxItems(on: boolean): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!on) { setIds(new Set()); return; }
    let alive = true;
    pharmacyApi.rxItemIds().then((r) => { if (alive) setIds(new Set(r)); }, () => {});
    return () => { alive = false; };
  }, [on]);
  return ids;
}

/** The Rx badge and the "prescription seen" tick of a sale line; it stays in the warning colour until ticked. */
export function RxTick({ seen, onChange }: { seen: boolean; onChange(seen: boolean): void }) {
  const { t } = useI18n();
  return (
    <label className="row small" style={{ gap: 6, marginTop: 4, flexWrap: 'nowrap', color: seen ? undefined : 'var(--warn)' }}>
      <span className="chip warn" title={t('ph_rxOnly')}>Rx</span>
      <input type="checkbox" checked={seen} onChange={(e) => onChange(e.target.checked)} />
      <span>{t('ph_rxSeen')}</span>
    </label>
  );
}

/** The controlled lines of one sale that still miss their patient. */
export const controlledOf = <L extends Pick<ControlledLine, 'invoiceId'>>(lines: readonly L[], invoiceId: string): L[] =>
  lines.filter((l) => l.invoiceId === invoiceId);

// a sale posted from the invoice editor, whose page opens next: that page asks (the editor is gone by then)
let askOnOpen: string | null = null;

/** The invoice editor posted sale `invoiceId` and goes to its page: the page asks for its controlled medicines. */
export function askControlledOnOpen(invoiceId: string): void {
  askOnOpen = invoiceId;
}

/**
 * After a sale is posted: when it sold controlled medicines whose details are missing, the dialog asks for them now
 * (or later, from the pharmacy log). `openedId`: the sale whose page this is, asked for once if the editor posted it.
 */
export function useControlledPrompt(openedId?: string): { dialog: ReactNode; check(invoiceId: string): void } {
  const on = usePharmacyOn();
  const [lines, setLines] = useState<ControlledLine[] | null>(null);
  const check = useCallback((invoiceId: string) => {
    if (!on) return;
    pharmacyApi.controlled({ missing: '1' }).then((all) => {
      const mine = controlledOf(all, invoiceId);
      if (mine.length) setLines(mine);
    }, () => {});
  }, [on]);
  useEffect(() => {
    if (!on || !openedId || askOnOpen !== openedId) return;
    askOnOpen = null;
    check(openedId);
  }, [on, openedId, check]);
  return { dialog: lines ? <ControlledRecord lines={lines} onDone={() => setLines(null)} /> : null, check };
}
