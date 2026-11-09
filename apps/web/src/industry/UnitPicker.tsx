import type { ItemView } from '../api.ts';
import { useI18n } from '../i18n.ts';
import { holdsText, unitChoices, unitLabel, type LineUnit } from './units.ts';

/**
 * The unit a document line is typed in: the item's base unit or one of its other units (1.1). An item with no other
 * units shows its unit's name only, as before.
 */
export function UnitPicker({ item, value, onChange }: { item: Pick<ItemView, 'unit' | 'units'> | undefined; value: LineUnit; onChange(unit: LineUnit): void }) {
  const i18n = useI18n();
  if (!item) return null;
  const choices = unitChoices(item);
  if (choices.length < 2) return <div className="muted small" style={{ textAlign: 'end', marginTop: 2 }}>{unitLabel(i18n, item.unit)}</div>;
  return (
    <select className="input small" style={{ marginTop: 2 }} value={value ?? ''} aria-label={i18n.t('unit')} onChange={(e) => onChange((e.target.value || null) as LineUnit)}>
      {choices.map((c) => <option key={c.code} value={c.unit ?? ''}>{unitLabel(i18n, c.code)}{c.unit ? ` (${holdsText(i18n, item, c.factorMilli)})` : ''}</option>)}
    </select>
  );
}
