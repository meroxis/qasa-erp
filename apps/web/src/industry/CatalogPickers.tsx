import { useState } from 'react';
import { COUNTRIES, STARTER_LISTS, STARTER_TRADES, starterTradeFor, type CountryCode, type StarterTrade } from '@qasa/core';
import { ErrorBox, Icon, Modal, useData, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { brandLabel, brandsApi, categoryLabel, type BrandView, type CategoryView } from './categories-api.ts';

/**
 * The catalogue's pickers (1.1): a category list that shows "Category › Subcategory", a brand picker that can add a
 * brand on the spot, the brand form, and the "Add a starter list" button.
 */

/** The <option>s of a category list in tree order, a subcategory as "Category › Subcategory". */
export function CategoryOptions({ list, keep }: { list: readonly CategoryView[]; keep?: string | null | undefined }) {
  const i18n = useI18n();
  return (
    <>
      {list.filter((c) => c.active || c.id === keep).map((c) => <option key={c.id} value={c.id}>{categoryLabel(list, c.id, i18n.name)}</option>)}
    </>
  );
}

/** A brand's country in the language shown. */
export function countryName(lang: 'ar' | 'en' | 'ku', code: CountryCode | null): string {
  return code ? COUNTRIES[code][lang] : '';
}

/** The brand picker of an item: the active brands (and the one kept), none, and a new brand added on the spot. */
export function BrandPicker({ value, onChange, disabled }: { value: string; onChange(id: string): void; disabled?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const brands = useLoad(() => brandsApi.list(), []);
  const [adding, setAdding] = useState(false);
  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
      <select className="input" value={value} disabled={disabled} aria-label={t('bnd_brand')} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('bnd_none')}</option>
        {(brands.data ?? []).filter((b) => b.active || b.id === value).map((b) => <option key={b.id} value={b.id}>{brandLabel(b, i18n.lang)}</option>)}
      </select>
      {!disabled && (
        <button type="button" className="btn icon" title={t('bnd_add')} aria-label={t('bnd_add')} onClick={() => setAdding(true)}><Icon name="plus" size={16} /></button>
      )}
      {adding && <BrandForm brand={null} onClose={() => setAdding(false)} onSaved={(b) => { setAdding(false); brands.reload(); onChange(b.id); }} />}
    </div>
  );
}

const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export function BrandForm({ brand, onClose, onSaved }: { brand: BrandView | null; onClose(): void; onSaved(b: BrandView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [name, setName] = useState(brand?.name ?? '');
  const [nameAr, setNameAr] = useState(brand?.nameAr ?? '');
  const [nameKu, setNameKu] = useState(brand?.nameKu ?? '');
  const [code, setCode] = useState(brand?.code ?? '');
  const [country, setCountry] = useState<string>(brand?.country ?? '');
  const [sort, setSort] = useState(brand?.sort ?? 0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const countries = [...COUNTRY_CODES].sort((a, b) => COUNTRIES[a][i18n.lang].localeCompare(COUNTRIES[b][i18n.lang], i18n.lang === 'ku' ? 'ckb' : i18n.lang));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input = { name, nameAr, nameKu, code: code.trim() || null, country: country || null, ...(brand ? { sort } : {}) };
      const saved = brand ? await brandsApi.update(brand.id, input) : await brandsApi.create(input);
      toast(t('bnd_saved'));
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={brand ? brand.name : t('bnd_new')} onClose={onClose}>
      <div className="stack">
        {/* a trade name is written as it is (mostly Latin letters): left to right */}
        <label className="field"><span>{t('bnd_name')}</span><input className="input" dir="auto" value={name} maxLength={100} placeholder="Bosch" onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div className="grid-2">
          <label className="field"><span>{t('bnd_nameAr')}</span><input className="input" lang="ar" dir="rtl" value={nameAr} maxLength={100} onChange={(e) => setNameAr(e.target.value)} /></label>
          <label className="field"><span>{t('bnd_nameKu')}</span><input className="input" lang="ckb" dir="rtl" value={nameKu} maxLength={100} onChange={(e) => setNameKu(e.target.value)} /></label>
          <label className="field">
            <span>{t('bnd_country')}</span>
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="" />
              {countries.map((c) => <option key={c} value={c}>{COUNTRIES[c][i18n.lang]}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('code')}</span><input className="input ltr" value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} /></label>
          {brand && <label className="field"><span>{t('cat_order')}</span><input className="input num" type="number" min={0} max={100000} value={sort} onChange={(e) => setSort(Math.max(0, Math.floor(Number(e.target.value)) || 0))} /></label>}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * "Add a starter list": categories with subcategories and well-known brands for a trade (the company's own first),
 * added only when pressed; what is there by name is skipped.
 */
export function StarterListButton({ onAdded, trade: suggested }: { onAdded?(): void; trade?: StarterTrade }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const [trade, setTrade] = useState<StarterTrade>(suggested ?? starterTradeFor(settings?.businessTypes ?? undefined));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await brandsApi.addStarterList(trade);
      toast(r.categories + r.subcategories + r.brands === 0 ? t('st_nothing') : t('st_added', { c: r.categories, s: r.subcategories, b: r.brands }));
      onAdded?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <select className="input" style={{ width: 240 }} value={trade} aria-label={t('st_trade')} onChange={(e) => setTrade(e.target.value as StarterTrade)}>
          {STARTER_TRADES.map((s) => <option key={s} value={s}>{i18n.name(STARTER_LISTS[s].name)}</option>)}
        </select>
        <button type="button" className="btn" disabled={busy} onClick={() => void add()}><Icon name="plus" size={16} />{t('st_add')}</button>
      </div>
      <span className="muted small">{t('st_help')}</span>
      <ErrorBox error={error} />
    </div>
  );
}
