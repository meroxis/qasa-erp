import { useMemo, useState } from 'react';
import { SIZE_SCALES, todayIso, type CurrencyCode, type Names } from '@qasa/core';
import { api } from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { categoriesApi } from '../industry/categories-api.ts';
import { clothingApi, type ColorView, type ModelView } from '../industry/clothing-api.ts';
import { ColorName } from '../industry/ClothingTools.tsx';
import { queueLabels } from '../industry/label-queue.ts';
import { LockedFeature } from '../industry/LockedFeature.tsx';

/**
 * Clothing and shoes (2.0). Route: clothing/<tab> (models, colors, reports) and clothing-model/<id>. A model is one
 * design in sizes and colours; each size and colour is an item of its own, so the till, invoices, purchases and stock
 * work as they always do. Here: making models, their stock as a grid, labels in one go, colours and the reports.
 */

export const CLOTHING_TABS = ['models', 'colors', 'reports'] as const;
export type ClothingTab = (typeof CLOTHING_TABS)[number];
const TAB_KEYS: Record<ClothingTab, Key> = { models: 'cw_tabModels', colors: 'cw_tabColors', reports: 'cw_tabReports' };
const empty: Names = { ar: '', en: '', ku: '' };

/** 2.0.0: without the plan, what the page does and how to get it (LockedFeature), not its tabs over an empty page. */
export function Clothing(props: { tab?: ClothingTab; canEdit: boolean }) {
  const { plan } = useData();
  if (plan && !plan.features.includes('clothingShop')) return <LockedFeature feature="clothingShop" icon="shirt" />;
  return <ClothingPage {...props} />;
}

function ClothingPage({ tab = 'models', canEdit }: { tab?: ClothingTab; canEdit: boolean }) {
  const { t } = useI18n();
  usePageNav({ key: 'cw_title', group: 'gIndustry' });
  const { plan } = useData();
  const available = !!plan?.features.includes('clothingShop');
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('cw_help')}</p>
      {!available && <div className="alert">{t('cw_planHint')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <div className="track" role="tablist">
          {CLOTHING_TABS.map((x) => (
            <a key={x} role="tab" aria-selected={tab === x} aria-pressed={tab === x} className="btn" style={{ border: 'none' }}
              href={href(x === 'models' ? 'clothing' : `clothing/${x}`)}>{t(TAB_KEYS[x])}</a>
          ))}
        </div>
      </div>
      {tab === 'models' && <ModelsTab canEdit={available && canEdit} />}
      {tab === 'colors' && <ColorsTab canEdit={available && canEdit} />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

/* ---------------- models ---------------- */

function ModelsTab({ canEdit }: { canEdit: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [season, setSeason] = useState('');
  const overview = useLoad(() => clothingApi.overview(), []);
  const { data, error, reload } = useLoad(() => clothingApi.models({ ...(q.trim() ? { q: q.trim() } : {}), ...(season ? { season } : {}) }), [q, season]);
  const [making, setMaking] = useState(false);
  return (
    <>
      <div className="row no-print" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input className="input" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cw_searchModels')} aria-label={t('cw_searchModels')} />
        <select className="input" style={{ maxWidth: 200 }} value={season} onChange={(e) => setSeason(e.target.value)} aria-label={t('cw_season')}>
          <option value="">{t('cw_allSeasons')}</option>
          {(overview.data?.seasons ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <PurchaseLabels />
        {canEdit && <button type="button" className="btn primary" onClick={() => setMaking(true)}><Icon name="plus" size={16} />{t('cw_newModel')}</button>}
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && (data.models.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('cw_noModels')}</p> : (
          <table className="table">
            <thead><tr><th>{t('code')}</th><th>{t('cw_model')}</th><th>{t('cw_season')}</th><th>{t('cw_sizes')}</th><th className="amount">{t('cw_variants')}</th><th className="amount">{t('cw_onHandAll')}</th><th className="amount">{t('cw_price')}</th></tr></thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'muted'}>
                  <td><a href={href(`clothing-model/${m.id}`)}>{m.code}</a></td>
                  <td><a href={href(`clothing-model/${m.id}`)}>{i18n.name(m.name)}</a></td>
                  <td>{m.season ?? '—'}</td>
                  <td>{m.sizes.join(' · ')}</td>
                  <td className="amount num">{i18n.int(m.variantCount)}</td>
                  <td className="amount num">{i18n.qty(m.onHandMilli)}</td>
                  <td className="amount num">{i18n.money(m.salePrice, m.saleCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {making && <ModelForm seasons={overview.data?.seasons ?? []} onClose={() => setMaking(false)} onSaved={(m) => { setMaking(false); reload(); go(`clothing-model/${m.id}`); }} />}
    </>
  );
}

/** A purchase's goods sent to the Labels page, one label per piece bought. */
function PurchaseLabels() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setError(null);
    try {
      const found = (await api.invoices({ kind: 'purchase', status: 'posted', q: number.trim() })).find((x) => (x.number ?? '').toLowerCase() === number.trim().toLowerCase());
      if (!found) { setError(new Error(t('cw_purchaseNotFound'))); return; }
      const r = await clothingApi.invoiceVariants(found.id);
      if (!r.lines.length) { setError(new Error(t('cw_purchaseNoVariants'))); return; }
      queueLabels(r.lines.map((l) => ({ itemId: l.itemId, copies: Math.max(1, Math.round(l.qtyMilli / 1000)) })));
      go('labels');
    } catch (e) { setError(e); }
  };
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="tag" size={16} />{t('cw_labelsFromPurchase')}</button>
      {open && (
        <Modal title={t('cw_labelsFromPurchase')} onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>{t('cw_labelsFromPurchaseHelp')}</p>
            <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} placeholder={t('cw_purchaseNumber')} aria-label={t('cw_purchaseNumber')} />
            <ErrorBox error={error} />
            <div className="row"><span className="spacer" /><button type="button" className="btn primary" disabled={!number.trim()} onClick={() => void run()}><Icon name="printer" size={16} />{t('cw_toLabels')}</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function SizesField({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [typed, setTyped] = useState('');
  const add = (list: readonly string[]) => onChange([...value, ...list.map((s) => s.trim().toUpperCase()).filter((s) => s && !value.includes(s))]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {SIZE_SCALES.map((s) => <button key={s.id} type="button" className="btn small" onClick={() => onChange([...s.sizes])}>{i18n.name(s.name)}</button>)}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {value.map((s) => (
          <span key={s} className="chip">{s} <button type="button" className="link-btn" aria-label={t('cw_remove')} onClick={() => onChange(value.filter((x) => x !== s))}><Icon name="x" size={12} /></button></span>
        ))}
        <input className="input" style={{ width: 120 }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('cw_addSize')} aria-label={t('cw_addSize')}
          onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) { e.preventDefault(); add(typed.split(/[,،\s]+/)); setTyped(''); } }} />
      </div>
    </div>
  );
}

function ColorsField({ colors, value, onChange }: { colors: ColorView[]; value: string[]; onChange(v: string[]): void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {colors.filter((c) => c.active).map((c) => {
        const on = value.includes(c.id);
        return (
          <button key={c.id} type="button" className={`btn small${on ? ' primary' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}>
            <ColorName color={c} />
          </button>
        );
      })}
    </div>
  );
}

function NamesFields({ value, onChange }: { value: Names; onChange(v: Names): void }) {
  const { t } = useI18n();
  return (
    <div className="grid3">
      <label className="field"><span>{t('nameAr')}</span><input className="input" dir="rtl" value={value.ar} onChange={(e) => onChange({ ...value, ar: e.target.value })} /></label>
      <label className="field"><span>{t('nameEn')}</span><input className="input" dir="ltr" value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} /></label>
      <label className="field"><span>{t('nameKu')}</span><input className="input" dir="rtl" value={value.ku} onChange={(e) => onChange({ ...value, ku: e.target.value })} /></label>
    </div>
  );
}

function ModelForm({ seasons, onClose, onSaved }: { seasons: string[]; onClose(): void; onSaved(m: ModelView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const colors = useLoad(() => clothingApi.colors(), []);
  const cats = useLoad(() => categoriesApi.list({ active: 'true' }), []);
  const [name, setName] = useState<Names>(empty);
  const [code, setCode] = useState('');
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [season, setSeason] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [price, setPrice] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [barcodes, setBarcodes] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const catOptions = (cats.data ?? []).map((c): PickOption => ({ id: c.id, code: c.code, label: i18n.name(c.name) }));
  const count = sizes.length * Math.max(1, colorIds.length);
  const save = async () => {
    setBusy(true); setError(null);
    // a name typed in one language only is used for the others too (it can be corrected later)
    const any = name.ar.trim() || name.en.trim() || name.ku.trim();
    const filled: Names = { ar: name.ar.trim() || any, en: name.en.trim() || any, ku: name.ku.trim() || any };
    try {
      onSaved(await clothingApi.createModel({
        ...(code.trim() ? { code: code.trim() } : {}), name: filled, sizes, colorIds, season: season.trim() || null, categoryId: categoryId || null,
        salePrice: price ?? 0, saleCurrency: currency, ...(cost !== null ? { purchasePrice: cost, purchaseCurrency: currency } : {}), barcodes
      }));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('cw_newModel')} onClose={onClose}>
      <div className="stack">
        <NamesFields value={name} onChange={setName} />
        <div className="grid3">
          <label className="field"><span>{t('code')}</span><input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('cw_codeAuto')} /></label>
          <label className="field"><span>{t('cw_season')}</span><input className="input" list="cl-seasons" value={season} onChange={(e) => setSeason(e.target.value)} placeholder={t('cw_seasonExample')} /></label>
          <label className="field"><span>{t('cat_category')}</span><SearchCombo value={categoryId} options={catOptions} onChange={setCategoryId} placeholder={t('cat_category')} emptyLabel={t('cw_none')} /></label>
        </div>
        <datalist id="cl-seasons">{seasons.map((s) => <option key={s} value={s} />)}</datalist>
        <div className="field"><span>{t('cw_sizes')}</span><SizesField value={sizes} onChange={setSizes} /></div>
        <div className="field">
          <span>{t('cw_colors')}</span>
          {(colors.data?.colors.length ?? 0) === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('cw_noColorsYet')} <a href={href('clothing/colors')}>{t('cw_tabColors')}</a></p>
            : <ColorsField colors={colors.data!.colors} value={colorIds} onChange={setColorIds} />}
        </div>
        <div className="grid3">
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select>
          </label>
          <label className="field"><span>{t('salePrice')}</span><AmountInput value={price} currency={currency} onChange={setPrice} /></label>
          <label className="field"><span>{t('cw_cost')}</span><AmountInput value={cost} currency={currency} onChange={setCost} /></label>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={barcodes} onChange={(e) => setBarcodes(e.target.checked)} /> {t('cw_makeBarcodes')}</label>
        <p className="muted small" style={{ margin: 0 }}>{t('cw_willMake', { n: i18n.int(count) })}</p>
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || !sizes.length || !(name.ar.trim() || name.en.trim() || name.ku.trim())} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button></div>
      </div>
    </Modal>
  );
}

/* ---------------- one model ---------------- */

export function ClothingModel({ id, canEdit }: { id: string; canEdit: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav({ key: 'cw_title', group: 'gIndustry' });
  const toast = useToast();
  const { plan } = useData();
  const edit = canEdit && !!plan?.features.includes('clothingShop');
  const { data: m, error, reload } = useLoad(() => clothingApi.model(id), [id]);
  const colors = useLoad(() => clothingApi.colors(), []);
  const warehouses = useLoad(() => api.warehouses(), []);
  const colorById = useMemo(() => new Map((colors.data?.colors ?? []).map((c) => [c.id, c])), [colors.data]);
  const [where, setWhere] = useState('');
  const [growing, setGrowing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  if (error) return <ErrorBox error={error} />;
  if (!m) return null;
  const columns = m.colorIds.length ? m.colorIds : [null];
  const qtyOf = (itemId: string) => (where ? m.stock.find((s) => s.warehouseId === where)?.byItem[itemId] ?? 0 : m.variants.find((v) => v.itemId === itemId)?.onHandMilli ?? 0);
  const at = (size: string, c: string | null) => m.variants.find((v) => v.size === size && v.colorId === c);
  const sizeTotal = (size: string) => columns.reduce((s, c) => s + (at(size, c) ? qtyOf(at(size, c)!.itemId) : 0), 0);
  const colorTotal = (c: string | null) => m.sizes.reduce((s, size) => s + (at(size, c) ? qtyOf(at(size, c)!.itemId) : 0), 0);
  const labels = (onHand: boolean) => {
    queueLabels(m.variants.map((v) => ({ itemId: v.itemId, copies: onHand ? Math.max(0, Math.round(qtyOf(v.itemId) / 1000)) : 1 })));
    go('labels');
  };
  const setActive = async (active: boolean) => {
    setFailure(null);
    try { await clothingApi.updateModel(m.id, { active }); toast(t('saved')); reload(); } catch (e) { setFailure(e); }
  };
  const remove = async () => {
    setFailure(null);
    try { await clothingApi.deleteModel(m.id); toast(t('cw_deleted')); go('clothing'); } catch (e) { setFailure(e); }
  };
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <a href={href('clothing')} className="btn small"><Icon name="chevron" size={14} />{t('cw_tabModels')}</a>
        <h2 style={{ margin: 0 }}>{m.code} · {i18n.name(m.name)}</h2>
        {m.season && <span className="chip">{m.season}</span>}
        {!m.active && <span className="chip">{t('inactive')}</span>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => labels(true)}><Icon name="tag" size={16} />{t('cw_labelsOnHand')}</button>
        <button type="button" className="btn" onClick={() => labels(false)}><Icon name="tag" size={16} />{t('cw_labelsOneEach')}</button>
        {edit && <button type="button" className="btn" onClick={() => setGrowing(true)}><Icon name="edit" size={16} />{t('cw_editModel')}</button>}
        {edit && <button type="button" className="btn" onClick={() => void setActive(!m.active)}>{m.active ? t('cw_switchOff') : t('cw_switchOn')}</button>}
        {edit && <button type="button" className="btn danger" onClick={() => void remove()}><Icon name="x" size={16} />{t('cw_delete')}</button>}
      </div>
      <ErrorBox error={failure} />
      <div className="row no-print" style={{ gap: 8 }}>
        <label className="field" style={{ maxWidth: 260 }}>
          <span>{t('warehouse')}</span>
          <select className="input" value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="">{t('cw_allWarehouses')}</option>
            {(warehouses.data ?? []).filter((w) => m.stock.some((s) => s.warehouseId === w.id) || w.active).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
          </select>
        </label>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>{t('cw_size')}</th>{columns.map((c) => <th key={c ?? ''} className="amount">{c ? <ColorName color={colorById.get(c)} /> : t('qty')}</th>)}<th className="amount">{t('total')}</th></tr>
          </thead>
          <tbody>
            {m.sizes.map((size) => (
              <tr key={size}>
                <th scope="row">{size}</th>
                {columns.map((c) => {
                  const v = at(size, c);
                  const q = v ? qtyOf(v.itemId) : 0;
                  return (
                    <td key={c ?? ''} className="amount" title={v ? `${v.code}${v.barcode ? ` · ${v.barcode}` : ''}` : ''}>
                      {v ? <a className={`num${q > 0 ? '' : ' muted'}`} href={href(`item/${v.itemId}`)}>{i18n.qty(q)}</a> : '—'}
                      {v && v.salePrice !== m.salePrice && <div className="muted small num">{i18n.money(v.salePrice, v.saleCurrency)}</div>}
                    </td>
                  );
                })}
                <td className="amount num"><strong>{i18n.qty(sizeTotal(size))}</strong></td>
              </tr>
            ))}
            <tr>
              <th scope="row">{t('total')}</th>
              {columns.map((c) => <td key={c ?? ''} className="amount num"><strong>{i18n.qty(colorTotal(c))}</strong></td>)}
              <td className="amount num"><strong>{i18n.qty(m.sizes.reduce((s, size) => s + sizeTotal(size), 0))}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('cw_gridHelp', { p: i18n.money(m.salePrice, m.saleCurrency) })}</p>
      {growing && colors.data && <ModelEdit model={m} colors={colors.data.colors} onClose={() => setGrowing(false)} onSaved={() => { setGrowing(false); reload(); }} />}
    </div>
  );
}

function ModelEdit({ model, colors, onClose, onSaved }: { model: ModelView; colors: ColorView[]; onClose(): void; onSaved(): void }) {
  const { t } = useI18n();
  const [name, setName] = useState<Names>(model.name);
  const [season, setSeason] = useState(model.season ?? '');
  const [price, setPrice] = useState<number | null>(model.salePrice);
  const [addSizes, setAddSizes] = useState<string[]>([]);
  const [addColors, setAddColors] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await clothingApi.updateModel(model.id, {
        name, season: season.trim() || null, ...(price !== null && price !== model.salePrice ? { salePrice: price } : {}),
        ...(addSizes.length ? { addSizes } : {}), ...(addColors.length ? { addColorIds: addColors } : {})
      });
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const newColors = colors.filter((c) => !model.colorIds.includes(c.id));
  return (
    <Modal title={t('cw_editModel')} onClose={onClose}>
      <div className="stack">
        <NamesFields value={name} onChange={setName} />
        <div className="grid3">
          <label className="field"><span>{t('cw_season')}</span><input className="input" value={season} onChange={(e) => setSeason(e.target.value)} /></label>
          <label className="field"><span>{t('salePrice')}</span><AmountInput value={price} currency={model.saleCurrency} onChange={setPrice} /></label>
        </div>
        {price !== model.salePrice && <p className="muted small" style={{ margin: 0 }}>{t('cw_priceFollows')}</p>}
        <div className="field"><span>{t('cw_addSizes')}</span><SizesField value={addSizes} onChange={(v) => setAddSizes(v.filter((s) => !model.sizes.includes(s)))} /></div>
        {model.colorIds.length > 0 && newColors.length > 0 && (
          <div className="field"><span>{t('cw_addColors')}</span><ColorsField colors={newColors} value={addColors} onChange={setAddColors} /></div>
        )}
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button></div>
      </div>
    </Modal>
  );
}

/* ---------------- colours ---------------- */

function ColorsTab({ canEdit }: { canEdit: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error, reload } = useLoad(() => clothingApi.colors(), []);
  const [editing, setEditing] = useState<ColorView | 'new' | null>(null);
  return (
    <>
      {canEdit && <div className="row"><span className="spacer" /><button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('cw_newColor')}</button></div>}
      <ErrorBox error={error} />
      <div className="card">
        {data && (data.colors.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('cw_noColors')}</p> : (
          <table className="table">
            <thead><tr><th>{t('code')}</th><th>{t('cw_color')}</th><th /></tr></thead>
            <tbody>
              {data.colors.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'muted'}>
                  <td className="num">{c.code}</td>
                  <td><ColorName color={c} /></td>
                  <td>{canEdit && <button type="button" className="btn small" onClick={() => setEditing(c)}><Icon name="edit" size={14} />{t('cw_edit')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {editing && <ColorForm color={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

/** Common colours a shop starts from (it names them its own way later). */
const STARTER_COLORS: readonly { code: string; name: Names; hex: string }[] = [
  { code: 'BLK', name: { ar: 'أسود', en: 'Black', ku: 'ڕەش' }, hex: '#111111' },
  { code: 'WHT', name: { ar: 'أبيض', en: 'White', ku: 'سپی' }, hex: '#ffffff' },
  { code: 'GRY', name: { ar: 'رمادي', en: 'Grey', ku: 'خۆڵەمێشی' }, hex: '#8a8a8a' },
  { code: 'NVY', name: { ar: 'كحلي', en: 'Navy', ku: 'شینی تاریک' }, hex: '#1f2a44' },
  { code: 'BLU', name: { ar: 'أزرق', en: 'Blue', ku: 'شین' }, hex: '#2f6fd6' },
  { code: 'RED', name: { ar: 'أحمر', en: 'Red', ku: 'سوور' }, hex: '#c62828' },
  { code: 'GRN', name: { ar: 'أخضر', en: 'Green', ku: 'سەوز' }, hex: '#2e7d32' },
  { code: 'BEG', name: { ar: 'بيج', en: 'Beige', ku: 'بێژ' }, hex: '#d8c3a5' },
  { code: 'BRN', name: { ar: 'بني', en: 'Brown', ku: 'قاوەیی' }, hex: '#6d4c41' },
  { code: 'PNK', name: { ar: 'وردي', en: 'Pink', ku: 'پەمەیی' }, hex: '#e91e63' }
];

function ColorForm({ color, onClose, onSaved }: { color: ColorView | null; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [code, setCode] = useState(color?.code ?? '');
  const [name, setName] = useState<Names>(color?.name ?? empty);
  const [hex, setHex] = useState(color?.hex ?? '#000000');
  const [active, setActive] = useState(color?.active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    const input = { code: code.trim().toUpperCase(), name, hex, active };
    try { await (color ? clothingApi.updateColor(color.id, input) : clothingApi.createColor(input)); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={color ? t('cw_edit') : t('cw_newColor')} onClose={onClose}>
      <div className="stack">
        {!color && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {STARTER_COLORS.map((c) => (
              <button key={c.code} type="button" className="btn small" onClick={() => { setCode(c.code); setName(c.name); setHex(c.hex); }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 6, background: c.hex, border: '1px solid #ccc' }} />{i18n.name(c.name)}
              </button>
            ))}
          </div>
        )}
        <div className="grid3">
          <label className="field"><span>{t('code')}</span><input className="input" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BLK" /></label>
          <label className="field"><span>{t('cw_colorShade')}</span><input className="input" type="color" value={hex} onChange={(e) => setHex(e.target.value)} /></label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('active')}</label>
        </div>
        <NamesFields value={name} onChange={setName} />
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button></div>
      </div>
    </Modal>
  );
}

/* ---------------- reports ---------------- */

function monthStart(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

function ReportsTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [season, setSeason] = useState('');
  const overview = useLoad(() => clothingApi.overview(), []);
  const { data, error } = useLoad(() => clothingApi.report({ from, to, ...(season ? { season } : {}) }), [from, to, season]);
  const colorById = useMemo(() => new Map((overview.data?.colors ?? []).map((c) => [c.id, c])), [overview.data]);
  const pct = (bp: number | null) => (bp === null ? '—' : i18n.ltr(`${(bp / 100).toFixed(1)}%`));
  const head = (first: Key) => (
    <tr><th>{t(first)}</th><th className="amount">{t('cw_soldQty')}</th><th className="amount">{t('cw_salesIqd')}</th><th className="amount">{t('cw_onHandAll')}</th><th className="amount">{t('cw_sellThrough')}</th></tr>
  );
  const sizes = data?.sizes ?? [];
  const best = sizes.filter((s) => s.soldMilli > 0).slice(0, 3);
  const worst = [...sizes].filter((s) => s.onHandMilli > 0).sort((a, b) => (a.sellThroughBp ?? 0) - (b.sellThroughBp ?? 0)).slice(0, 3);
  return (
    <>
      <div className="row no-print" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="field"><span>{t('from')}</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>{t('to')}</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field"><span>{t('cw_season')}</span>
          <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">{t('cw_allSeasons')}</option>
            {(overview.data?.seasons ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('cw_sellThroughHelp')}</p>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 220 }}>
              <strong>{t('cw_bestSizes')}</strong>
              <div>{best.length ? best.map((s) => `${s.size} (${i18n.qty(s.soldMilli)})`).join(' · ') : '—'}</div>
            </div>
            <div className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 220 }}>
              <strong>{t('cw_worstSizes')}</strong>
              <div>{worst.length ? worst.map((s) => `${s.size} (${pct(s.sellThroughBp)})`).join(' · ') : '—'}</div>
            </div>
          </div>
          <div className="card">
            <h3 style={{ padding: '10px 16px 0', margin: 0 }}>{t('cw_byModel')}</h3>
            <table className="table">
              <thead>{head('cw_model')}</thead>
              <tbody>
                {data.models.map((r) => (
                  <tr key={r.modelId}>
                    <td><a href={href(`clothing-model/${r.modelId}`)}>{r.code} · {i18n.name(r.name)}</a></td>
                    <td className="amount num">{i18n.qty(r.soldMilli)}</td><td className="amount num">{i18n.money(r.sales, 'IQD')}</td>
                    <td className="amount num">{i18n.qty(r.onHandMilli)}</td><td className="amount num">{pct(r.sellThroughBp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3 style={{ padding: '10px 16px 0', margin: 0 }}>{t('cw_bySize')}</h3>
            <table className="table">
              <thead>{head('cw_size')}</thead>
              <tbody>
                {sizes.map((r) => (
                  <tr key={r.size}><td>{r.size}</td><td className="amount num">{i18n.qty(r.soldMilli)}</td><td className="amount num">{i18n.money(r.sales, 'IQD')}</td>
                    <td className="amount num">{i18n.qty(r.onHandMilli)}</td><td className="amount num">{pct(r.sellThroughBp)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3 style={{ padding: '10px 16px 0', margin: 0 }}>{t('cw_byColor')}</h3>
            <table className="table">
              <thead>{head('cw_color')}</thead>
              <tbody>
                {data.colors.map((r) => (
                  <tr key={r.colorId ?? ''}><td>{r.colorId ? <ColorName color={colorById.get(r.colorId)} /> : t('cw_noColor')}</td><td className="amount num">{i18n.qty(r.soldMilli)}</td>
                    <td className="amount num">{i18n.money(r.sales, 'IQD')}</td><td className="amount num">{i18n.qty(r.onHandMilli)}</td><td className="amount num">{pct(r.sellThroughBp)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
