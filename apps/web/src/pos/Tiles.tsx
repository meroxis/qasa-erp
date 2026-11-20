import { POS_QUICK_MAX, type CurrencyCode } from '@qasa/core';
import type { ItemView } from '../api.ts';
import type { CategoryView } from '../industry/categories-api.ts';
import { ErrorBox, Icon } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { useItemPicture } from '../industry/ItemImage.tsx';
import { tileOffer } from '../pages/pos-logic.ts';
import { initials } from './shared.ts';

/**
 * The picture on a tile, as the Items screen shows it: one request says which items have a picture, a picture is
 * asked for only when its tile comes into view, and it is kept for the visit. No picture: the item's initials.
 */
export function ItemPicture({ item, name }: { item: ItemView; name: string }) {
  const { box, url } = useItemPicture(item.id);
  return (
    <span ref={box} className="pos-picture" aria-hidden="true">
      {url ? <img className="pos-img" src={url} alt="" /> : <span className="pos-initials">{initials(name) || '•'}</span>}
    </span>
  );
}

/**
 * The quick buttons: a row above the categories with what the company sells all day (a charger, a bag, a loaf of
 * bread), each a small picture with its name and price; one tap adds one. The list is the company's (Settings key
 * pos_quick_items, the same on every PC). An admin edits it here: "Edit buttons", then a tap on a tile below puts it
 * on the row or takes it off (a star on those on it), the arrows move a button, and Done. While the server can't be
 * reached the row shows the list last known and can't be edited.
 */
export function QuickRow({ items, currency, priceRate, editing, mayEdit, canEdit, error, onPick, onEdit, onMove }: {
  items: readonly ItemView[]; currency: CurrencyCode; priceRate: number;
  /** the admin is choosing the buttons (the row sells nothing meanwhile) */
  editing: boolean;
  /** an admin (the server takes the list from an admin only) */
  mayEdit: boolean;
  /** the server can be reached (offline the list is not changed) */
  canEdit: boolean;
  error?: unknown;
  onPick(item: ItemView): void; onEdit(): void; onMove(id: string, step: -1 | 1): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!items.length && !mayEdit) return null;
  return (
    <div className={'pos-quick' + (editing ? ' editing' : '')} role="group" aria-label={t('tq_quick')} data-quick={items.length}>
      {items.map((it, i) => {
        const name = i18n.name(it.name);
        const offer = tileOffer(it, currency, priceRate);
        const face = (
          <>
            <QuickPicture item={it} name={name} />
            <span className="pos-quick-text">
              <span className="pos-quick-name">{name}</span>
              <span className="pos-quick-price num">{offer.price === null ? '—' : i18n.money(offer.price, currency)}</span>
            </span>
          </>
        );
        if (!editing) return <button key={it.id} type="button" className="pos-quick-btn" title={name} onClick={() => onPick(it)}>{face}</button>;
        return (
          <span key={it.id} className="pos-quick-btn pos-quick-chosen">
            <button type="button" className="pos-quick-move pos-quick-move-back" aria-label={`${t('tq_moveBack')}: ${name}`} disabled={i === 0} onClick={() => onMove(it.id, -1)}><Icon name="chevron" size={16} /></button>
            {face}
            <button type="button" className="pos-quick-move" aria-label={`${t('tq_moveForward')}: ${name}`} disabled={i === items.length - 1} onClick={() => onMove(it.id, 1)}><Icon name="chevron" size={16} className="flip" /></button>
          </span>
        );
      })}
      {!items.length && <span className="small muted pos-quick-empty">{t('tq_empty')}</span>}
      {mayEdit && (
        <button type="button" className={'btn small pos-quick-edit' + (editing ? ' primary' : '')} disabled={!editing && !canEdit} title={!canEdit ? t('tq_offlineEdit') : undefined} onClick={onEdit}>
          <Icon name={editing ? 'check' : 'edit'} size={15} />{editing ? t('tq_done') : t('tq_edit')}
        </button>
      )}
      {editing && <div className="small muted pos-quick-hint">{t('tq_editHint', { n: i18n.int(POS_QUICK_MAX) })}</div>}
      {error ? <div className="pos-quick-hint"><ErrorBox error={error} /></div> : null}
    </div>
  );
}

/** A quick button's small picture, or the item's initials. */
function QuickPicture({ item, name }: { item: ItemView; name: string }) {
  const { box, url } = useItemPicture(item.id);
  return (
    <span ref={box} className="pos-quick-pic" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <span className="pos-initials">{initials(name) || '•'}</span>}
    </span>
  );
}

/**
 * The till's category buttons: the top-level categories; a category opens its subcategories (with a button for all of
 * it and one back). Choosing one shows only its items (a category's subcategories' items with it).
 */
export function PosCategories({ list, value, onChange }: { list: readonly CategoryView[]; value: string; onChange(id: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const current = list.find((c) => c.id === value);
  // the category whose subcategories show: the one picked, or the parent of the subcategory picked
  const open = current ? (current.parentId ? list.find((c) => c.id === current.parentId) : current) : undefined;
  const subs = open ? list.filter((c) => c.parentId === open.id) : [];
  const buttons = open ? subs : list.filter((c) => !c.parentId);
  return (
    <div className="pos-cats" role="group" aria-label={t('cat_title')}>
      {open ? (
        <>
          <button type="button" className="btn" onClick={() => onChange(current?.parentId ? open.id : '')}><Icon name="undo" size={16} />{t('cat_back')}</button>
          <button type="button" className="btn" aria-pressed={value === open.id} onClick={() => onChange(open.id)}>{i18n.name(open.name)}</button>
        </>
      ) : (
        <button type="button" className="btn" aria-pressed={!value} onClick={() => onChange('')}>{t('cat_all')}</button>
      )}
      {buttons.map((c) => (
        <button key={c.id} type="button" className="btn" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>{i18n.name(c.name)}</button>
      ))}
    </div>
  );
}

