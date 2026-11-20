import { useState } from 'react';
import {
  fineMg, GOLD_KARATS, goldPiecePrice, goldValue, karatPrice, perGramFrom, priceForUnit, todayIso,
  type CurrencyCode, type GoldKarat, type GoldPriceUnit, type MakingKind
} from '@qasa/core';
import { api } from '../api.ts';
import {
  AccountCombo, AmountInput, EmptyState, ErrorBox, Icon, InvoiceStatusChip, Modal, QtyInput, SearchCombo, useData, useLoad, useMay, useToast, type PickOption
} from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { printDocument } from '../industry/printing.ts';
import { goldApi, type GoldBoard, type GoldDocInput, type GoldDocKind, type GoldDocView, type GoldItemView } from '../industry/gold-api.ts';

/** The gold shop's tabs, as App.tsx routes them (gold/<tab>). */
export const GOLD_TABS = ['board', 'pieces', 'old', 'suppliers', 'stock'] as const;
export type GoldTab = (typeof GOLD_TABS)[number];

const TAB_KEY: Record<GoldTab, Key> = { board: 'gd_tabBoard', pieces: 'gd_tabPieces', old: 'gd_tabOld', suppliers: 'gd_tabSuppliers', stock: 'gd_tabStock' };

/** The tabs someone sees: the shop's gold at cost, old gold and the suppliers' gold are for those who see the books. */
export const goldTabs = (books: boolean): GoldTab[] => (books ? [...GOLD_TABS] : ['board', 'pieces']);

const UNIT_KEY = 'qasa.gold.unit';
function savedUnit(): GoldPriceUnit {
  try { return localStorage.getItem(UNIT_KEY) === 'mithqal' ? 'mithqal' : 'gram'; } catch { return 'gram'; }
}
function keepUnit(u: GoldPriceUnit): void {
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* the choice lasts for this visit */ }
}

const karatName = (i18n: I18n, k: number) => i18n.t('gd_karatN', { n: i18n.digitsOf(String(k)) });
const weight = (i18n: I18n, mg: number) => `${i18n.qty(mg)} ${i18n.lang === 'en' ? 'g' : i18n.lang === 'ar' ? 'غم' : 'گرام'}`;

/** الذهب والمجوهرات (goldShop): the day's board, the pieces, old gold, suppliers in gold and the gold in the shop. */
export function Gold({ tab = 'board' }: { tab?: GoldTab }) {
  const { t } = useI18n();
  const { plan, seesCost } = useData();
  const allowed = !!plan?.features.includes('goldShop');
  const tabs = goldTabs(seesCost !== false);
  const shown = tabs.includes(tab) ? tab : 'board';
  return (
    <div className="stack">
      {!allowed && <div className="alert info">{t('gd_needsPlan')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="tabs no-print">
        {tabs.map((x) => <a key={x} className="btn ghost" aria-pressed={shown === x} href={href(`gold/${x}`)}>{t(TAB_KEY[x])}</a>)}
      </div>
      {allowed && shown === 'board' && <BoardTab />}
      {allowed && shown === 'pieces' && <PiecesTab />}
      {allowed && shown === 'old' && <OldGoldTab />}
      {allowed && shown === 'suppliers' && <SuppliersTab />}
      {allowed && shown === 'stock' && <StockTab />}
    </div>
  );
}

// ——— the board ———

function BoardTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const can = useMay()('goldBoard');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [unit, setUnitState] = useState<GoldPriceUnit>(savedUnit);
  const [date, setDate] = useState(todayIso());
  const [typed, setTyped] = useState<Partial<Record<GoldKarat, { buy: number | null; sell: number | null }>>>({});
  const [error, setError] = useState<unknown>(null);
  const board = useLoad(() => goldApi.board({ currency, date }), [currency, date]);
  const setUnit = (u: GoldPriceUnit) => { keepUnit(u); setUnitState(u); setTyped({}); };
  const shown = (k: GoldKarat, side: 'buy' | 'sell'): number | null => {
    const v = typed[k]?.[side];
    if (v !== undefined) return v;
    const row = board.data?.board[k];
    return row ? priceForUnit(side === 'buy' ? row.buyPerGram : row.sellPerGram, unit) : null;
  };
  function fillFrom24() {
    const buy = shown(24, 'buy');
    const sell = shown(24, 'sell');
    if (buy === null && sell === null) return;
    const next: typeof typed = { ...typed };
    for (const k of GOLD_KARATS) {
      if (k === 24) continue;
      next[k] = { buy: buy === null ? null : karatPrice(buy, k), sell: sell === null ? null : karatPrice(sell, k) };
    }
    setTyped(next);
  }
  async function save() {
    setError(null);
    const prices = GOLD_KARATS.flatMap((k) => {
      const buy = shown(k, 'buy');
      const sell = shown(k, 'sell');
      return buy === null || sell === null ? [] : [{ karat: k, buyPerGram: perGramFrom(buy, unit), sellPerGram: perGramFrom(sell, unit) }];
    });
    try {
      const r = await goldApi.saveBoard({ date, currency, prices });
      toast(t('gd_repriced', { n: r.repriced }));
      setTyped({});
      board.reload();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="stack">
      <div className="row">
        <label className="field"><span>{t('gd_boardDate')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} /></label>
        <label className="field"><span>{t('currency')}</span>
          <select className="input" value={currency} onChange={(e) => { setCurrency(e.target.value as CurrencyCode); setTyped({}); }}>
            <option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option>
          </select>
        </label>
        <label className="field"><span>{t('gd_showIn')}</span>
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as GoldPriceUnit)}>
            <option value="gram">{t('gd_unitGram')}</option><option value="mithqal">{t('gd_unitMithqal')}</option>
          </select>
        </label>
      </div>
      <p className="muted small">{t('gd_boardHint')}</p>
      <ErrorBox error={board.error} />
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>{t('gd_karat')}</th><th className="amount">{t('gd_buy')} <span className="muted small">{t(unit === 'gram' ? 'gd_perGram' : 'gd_perMithqal')}</span></th><th className="amount">{t('gd_sell')} <span className="muted small">{t(unit === 'gram' ? 'gd_perGram' : 'gd_perMithqal')}</span></th></tr>
          </thead>
          <tbody>
            {[...GOLD_KARATS].reverse().map((k) => (
              <tr key={k}>
                <td><strong>{karatName(i18n, k)}</strong></td>
                {(['buy', 'sell'] as const).map((side) => (
                  <td key={side} className="amount">
                    {can
                      ? <AmountInput value={shown(k, side)} currency={currency} ariaLabel={`${karatName(i18n, k)} ${t(side === 'buy' ? 'gd_buy' : 'gd_sell')}`} onChange={(v) => setTyped({ ...typed, [k]: { buy: side === 'buy' ? v : shown(k, 'buy'), sell: side === 'sell' ? v : shown(k, 'sell') } })} />
                      : shown(k, side) === null ? <span className="muted">{t('gd_noPrice')}</span> : i18n.money(shown(k, side)!, currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox error={error} />
      {can && (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void save()}><Icon name="check" size={16} />{t('gd_saveBoard')}</button>
          <button type="button" className="btn" onClick={fillFrom24}>{t('gd_fillFrom24')}</button>
        </div>
      )}
      {(board.data?.history.length ?? 0) > 0 && (
        <div className="card">
          <div style={{ padding: '12px 16px' }}><h2>{t('gd_history')}</h2></div>
          <table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('gd_karat')}</th><th className="amount">{t('gd_buy')}</th><th className="amount">{t('gd_sell')}</th></tr></thead>
            <tbody>
              {board.data!.history.slice(0, 40).map((r) => (
                <tr key={`${r.date}-${r.karat}`}>
                  <td className="num">{i18n.date(r.date)}</td><td>{karatName(i18n, r.karat)}</td>
                  <td className="amount">{i18n.money(priceForUnit(r.buyPerGram, unit), currency)}</td><td className="amount">{i18n.money(priceForUnit(r.sellPerGram, unit), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ——— the pieces ———

function PiecesTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const can = useMay()('goldPiece');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const list = useLoad(() => goldApi.items(q.trim() || undefined), [q]);
  const items = useLoad(() => (can ? api.items({ active: 'true' }) : Promise.resolve([])), [can]);
  const options: PickOption[] = (items.data ?? []).filter((it) => it.trackStock).map((it) => ({ id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}` }));
  return (
    <div className="stack">
      <div className="row">
        {can && <div style={{ minWidth: 260 }}><SearchCombo value={pick} options={options} onChange={(v) => { if (v) setEditing(v); setPick(''); }} placeholder={t('gd_addPiece')} ariaLabel={t('gd_addPiece')} /></div>}
        <span className="spacer" />
        <input className="input" style={{ width: 220 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.data && (list.data.length ? (
          <table className="table">
            <thead>
              <tr><th>{t('item')}</th><th>{t('gd_karat')}</th><th className="amount">{t('gd_weight')}</th><th className="amount">{t('gd_making')}</th><th className="amount">{t('gd_todayPrice')}</th><th className="amount">{t('gd_onHand')}</th>{can && <th />}</tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.itemId}>
                  <td><a href={href(`item/${p.itemId}`)}>{i18n.name(p.name)}</a> <span className="muted small ltr">{p.code}</span></td>
                  <td>{karatName(i18n, p.karat)}</td>
                  <td className="amount">{i18n.qty(p.weightMg)}</td>
                  <td className="amount">{i18n.money(p.makingAmount, p.currency)} <span className="muted small">{t(p.makingKind === 'gram' ? 'gd_makingGram' : 'gd_makingPiece')}</span></td>
                  <td className="amount">{p.boardPrice === null ? <span className="muted">{t('gd_noPrice')}</span> : i18n.money(p.boardPrice, p.currency)}</td>
                  <td className="amount">{i18n.qty(p.onHandMilli)}</td>
                  {can && <td><button type="button" className="btn icon ghost" aria-label={t('actEdit')} title={t('actEdit')} onClick={() => setEditing(p.itemId)}><Icon name="edit" size={16} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState compact icon="star" title={t('gd_noPieces')} text={t('gd_noPiecesText')} />)}
      </div>
      {editing && <PieceForm itemId={editing} current={list.data?.find((p) => p.itemId === editing) ?? null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function PieceForm({ itemId, current, onClose, onSaved }: { itemId: string; current: GoldItemView | null; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const item = useLoad(() => api.item(itemId), [itemId]);
  const board = useLoad(() => goldApi.board({ currency: item.data?.saleCurrency ?? 'IQD' }), [item.data?.saleCurrency]);
  const [weightMg, setWeight] = useState<number | null>(current?.weightMg ?? null);
  const [karat, setKarat] = useState<GoldKarat>(current?.karat ?? 21);
  const [makingKind, setKind] = useState<MakingKind>(current?.makingKind ?? 'gram');
  const [makingAmount, setMaking] = useState<number | null>(current?.makingAmount ?? 0);
  const [error, setError] = useState<unknown>(null);
  const currency = item.data?.saleCurrency ?? current?.currency ?? 'IQD';
  const sell = board.data?.board[karat]?.sellPerGram ?? null;
  const preview = weightMg && sell !== null ? goldPiecePrice({ weightMg, makingKind, makingAmount: makingAmount ?? 0 }, sell) : null;
  async function save() {
    setError(null);
    if (!weightMg) return;
    try {
      await goldApi.saveItem(itemId, { weightMg, karat, makingKind, makingAmount: makingAmount ?? 0 });
      toast(t('saved'));
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  async function remove() {
    setError(null);
    try {
      await goldApi.removeItem(itemId);
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal title={item.data ? `${item.data.code} — ${i18n.name(item.data.name)}` : t('gd_title')} onClose={onClose}>
      <ErrorBox error={item.error} />
      <div className="stack">
        <div className="grid-2">
          <div className="field"><span>{t('gd_weight')}</span><QtyInput value={weightMg} onChange={setWeight} ariaLabel={t('gd_weight')} /></div>
          <label className="field"><span>{t('gd_karat')}</span>
            <select className="input" value={karat} onChange={(e) => setKarat(Number(e.target.value) as GoldKarat)}>
              {GOLD_KARATS.map((k) => <option key={k} value={k}>{karatName(i18n, k)}</option>)}
            </select>
          </label>
          <div className="field"><span>{t('gd_making')}</span><AmountInput value={makingAmount} currency={currency} onChange={setMaking} ariaLabel={t('gd_making')} /></div>
          <label className="field"><span>{t('gd_makingKind')}</span>
            <select className="input" value={makingKind} onChange={(e) => setKind(e.target.value as MakingKind)}>
              <option value="gram">{t('gd_makingGram')}</option><option value="piece">{t('gd_makingPiece')}</option>
            </select>
          </label>
        </div>
        {weightMg ? <p className="muted small">{t('gd_fine')}: <span className="num">{i18n.qty(fineMg(weightMg, karat))}</span> · {t('gd_todayPrice')}: <strong>{preview === null ? t('gd_noPrice') : i18n.money(preview, currency)}</strong></p> : null}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={!weightMg} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <span className="spacer" />
          {current && <button type="button" className="btn ghost" onClick={() => void remove()}>{t('gd_removePiece')}</button>}
        </div>
      </div>
    </Modal>
  );
}

// ——— documents ———

const KIND_KEY: Record<GoldDocKind, Key> = { buy: 'gd_kind_buy', melt: 'gd_kind_melt', receipt: 'gd_kind_receipt', delivery: 'gd_kind_delivery' };

function docWhat(i18n: I18n, d: GoldDocView): string {
  if (d.kind === 'melt') return `${weight(i18n, d.weightMg ?? 0)} ${karatName(i18n, d.karat ?? 24)} → ${weight(i18n, d.weightOutMg ?? 0)} ${karatName(i18n, d.karatOut ?? 24)}`;
  if (d.kind === 'receipt') return `${i18n.digitsOf(String(d.lines.length))} × ${d.lines.map((l) => i18n.name(l.name)).slice(0, 3).join('، ')}`;
  return `${weight(i18n, d.weightMg ?? 0)} ${karatName(i18n, d.karat ?? 24)}`;
}

function DocList({ kinds, reloadKey, onChange }: { kinds: GoldDocKind[]; reloadKey: number; onChange(): void }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const can = useMay()('goldDoc');
  const [error, setError] = useState<unknown>(null);
  const docs = useLoad(() => goldApi.docs(), [reloadKey]);
  const rows = (docs.data ?? []).filter((d) => kinds.includes(d.kind));
  async function act(run: () => Promise<unknown>) {
    setError(null);
    try { await run(); docs.reload(); onChange(); } catch (e) { setError(e); }
  }
  return (
    <div className="card">
      <div style={{ padding: '12px 16px' }}><h2>{t('gd_docs')}</h2></div>
      <ErrorBox error={docs.error ?? error} />
      {rows.length ? (
        <table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('number')}</th><th>{t('colType')}</th><th /><th className="amount">{t('gd_amount')}</th><th /><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="num">{i18n.date(d.date)}</td>
                <td className="ltr">{d.number ?? '—'}</td>
                <td>{t(KIND_KEY[d.kind])}{d.partyName || d.customerName ? <span className="muted small"> · {d.partyName ?? d.customerName}</span> : null}</td>
                <td className="small">{docWhat(i18n, d)}</td>
                <td className="amount">{d.amount ? i18n.money(d.amount, d.currency) : '—'}</td>
                <td><InvoiceStatusChip status={d.status} /></td>
                <td>
                  {can && d.status === 'draft' && (
                    <span className="row" style={{ gap: 4 }}>
                      <button type="button" className="btn small primary" onClick={() => void act(() => goldApi.postDoc(d.id, lang))}>{t('gd_post')}</button>
                      <button type="button" className="btn small ghost" aria-label={t('actDelete')} onClick={() => void act(() => goldApi.deleteDoc(d.id))}><Icon name="trash" size={14} /></button>
                    </span>
                  )}
                  {can && d.status === 'posted' && <button type="button" className="btn small ghost" onClick={() => void act(() => goldApi.cancelDoc(d.id))}>{t('gd_cancel')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : docs.data && <EmptyState compact icon="inbox" title={t('gd_noDocs')} text="" />}
    </div>
  );
}

/** Saves a document as a draft and posts it at once (an approver posts it later when "separate duties" is on). */
function useSaveDoc(onDone: () => void) {
  const { lang } = useI18n();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save(body: GoldDocInput, post: boolean) {
    setError(null);
    setBusy(true);
    try {
      const doc = await goldApi.createDoc(body);
      if (post) {
        try { await goldApi.postDoc(doc.id, lang); } catch (e) { setError(e); setBusy(false); return; }
      }
      onDone();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return { error, busy, save };
}

function KaratSelect({ value, onChange, label }: { value: GoldKarat; onChange(k: GoldKarat): void; label: string }) {
  const i18n = useI18n();
  return (
    <label className="field"><span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value) as GoldKarat)}>
        {GOLD_KARATS.map((k) => <option key={k} value={k}>{karatName(i18n, k)}</option>)}
      </select>
    </label>
  );
}

function DocButtons({ busy, ok, onSave, onClose }: { busy: boolean; ok: boolean; onSave(post: boolean): void; onClose(): void }) {
  const { t } = useI18n();
  return (
    <div className="row">
      <button type="button" className="btn primary" disabled={busy || !ok} onClick={() => onSave(true)}><Icon name="check" size={16} />{t('gd_post')}</button>
      <button type="button" className="btn" disabled={busy || !ok} onClick={() => onSave(false)}>{t('saveDraft')}</button>
      <button type="button" className="btn ghost" onClick={onClose}>{t('cancel')}</button>
    </div>
  );
}

// ——— old gold ———

function OldGoldTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const can = useMay()('goldDoc');
  const [form, setForm] = useState<'buy' | 'melt' | null>(null);
  const [tick, setTick] = useState(0);
  const stock = useLoad(() => goldApi.stock(), [tick]);
  const done = () => { setForm(null); setTick((n) => n + 1); };
  return (
    <div className="stack">
      {can && (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => setForm('buy')}><Icon name="plus" size={16} />{t('gd_buyOld')}</button>
          <button type="button" className="btn" onClick={() => setForm('melt')}>{t('gd_melt')}</button>
        </div>
      )}
      <ErrorBox error={stock.error} />
      {stock.data && (
        <div className="card">
          <div style={{ padding: '12px 16px' }}><h2>{t('gd_scrapStock')}</h2></div>
          <table className="table">
            <thead><tr><th>{t('gd_karat')}</th><th className="amount">{t('gd_weight')}</th><th className="amount">{t('gd_atCost')}</th></tr></thead>
            <tbody>
              {stock.data.byKarat.filter((k) => k.scrapWeightMg !== 0).map((k) => (
                <tr key={k.karat}><td>{karatName(i18n, k.karat)}</td><td className="amount">{i18n.qty(k.scrapWeightMg)}</td><td className="amount">{i18n.money(k.scrapValue, 'IQD')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DocList kinds={['buy', 'melt']} reloadKey={tick} onChange={() => setTick((n) => n + 1)} />
      {form === 'buy' && <BuyForm onClose={() => setForm(null)} onDone={done} />}
      {form === 'melt' && <MeltForm onClose={() => setForm(null)} onDone={done} />}
    </div>
  );
}

function BuyForm({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const board = useLoad(() => goldApi.board({ currency: 'IQD' }), []);
  const [unit] = useState<GoldPriceUnit>(savedUnit);
  const [seller, setSeller] = useState('');
  const [karat, setKarat] = useState<GoldKarat>(21);
  const [weightMg, setWeight] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [cashAccount, setCash] = useState('1811');
  const { error, busy, save } = useSaveDoc(onDone);
  const boardBuy = board.data?.board[karat]?.buyPerGram ?? null;
  const shownPrice = price ?? (boardBuy === null ? null : priceForUnit(boardBuy, unit));
  const perGram = shownPrice === null ? null : perGramFrom(shownPrice, unit);
  const amount = weightMg && perGram !== null ? goldValue(weightMg, perGram) : null;
  return (
    <Modal title={t('gd_buyOld')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('gd_sellerName')}</span><input className="input" maxLength={120} value={seller} onChange={(e) => setSeller(e.target.value)} autoFocus /></label>
        <div className="grid-2">
          <KaratSelect value={karat} onChange={(k) => { setKarat(k); setPrice(null); }} label={t('gd_karat')} />
          <div className="field"><span>{t('gd_weight')}</span><QtyInput value={weightMg} onChange={setWeight} ariaLabel={t('gd_weight')} /></div>
          <div className="field"><span>{t('gd_pricePaid')} <span className="muted small">{t(unit === 'gram' ? 'gd_perGram' : 'gd_perMithqal')}</span></span><AmountInput value={shownPrice} currency="IQD" onChange={setPrice} ariaLabel={t('gd_pricePaid')} /></div>
          <div className="field"><span>{t('gd_cashFrom')}</span><AccountCombo value={cashAccount} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('gd_cashFrom')} /></div>
        </div>
        {amount !== null && <p>{t('gd_amount')}: <strong>{i18n.money(amount, 'IQD')}</strong></p>}
        <ErrorBox error={error} />
        <DocButtons busy={busy} ok={!!seller.trim() && !!weightMg && perGram !== null && !!cashAccount} onClose={onClose}
          onSave={(post) => void save({ kind: 'buy', date: todayIso(), customerName: seller.trim(), karat, weightMg: weightMg!, pricePerGram: perGram!, cashAccount, currency: 'IQD' }, post)} />
      </div>
    </Modal>
  );
}

function MeltForm({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [karat, setKarat] = useState<GoldKarat>(21);
  const [weightMg, setWeight] = useState<number | null>(null);
  const [karatOut, setKaratOut] = useState<GoldKarat>(24);
  const [weightOutMg, setWeightOut] = useState<number | null>(null);
  const { error, busy, save } = useSaveDoc(onDone);
  const gains = !!weightMg && !!weightOutMg && fineMg(weightOutMg, karatOut) > fineMg(weightMg, karat);
  return (
    <Modal title={t('gd_melt')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <KaratSelect value={karat} onChange={setKarat} label={`${t('gd_meltIn')} · ${t('gd_karat')}`} />
          <div className="field"><span>{t('gd_meltIn')} · {t('gd_weight')}</span><QtyInput value={weightMg} onChange={setWeight} ariaLabel={t('gd_weight')} /></div>
          <KaratSelect value={karatOut} onChange={setKaratOut} label={`${t('gd_meltOut')} · ${t('gd_karat')}`} />
          <div className="field"><span>{t('gd_meltOut')} · {t('gd_weight')}</span><QtyInput value={weightOutMg} onChange={setWeightOut} ariaLabel={t('gd_weight')} /></div>
        </div>
        <p className={gains ? 'alert warn' : 'muted small'}>{t(gains ? 'err_gold_melt_gains' : 'gd_meltHint')}</p>
        <ErrorBox error={error} />
        <DocButtons busy={busy} ok={!!weightMg && !!weightOutMg && !gains} onClose={onClose}
          onSave={(post) => void save({ kind: 'melt', date: todayIso(), karat, weightMg: weightMg!, karatOut, weightOutMg: weightOutMg! }, post)} />
      </div>
    </Modal>
  );
}

// ——— suppliers in gold ———

function SuppliersTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const can = useMay()('goldDoc');
  const [form, setForm] = useState<'receipt' | 'delivery' | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const list = useLoad(() => goldApi.suppliers(), [tick]);
  const done = () => { setForm(null); setTick((n) => n + 1); };
  async function basis(partyId: string, k: 21 | 24) {
    setError(null);
    try { await goldApi.setBasis(partyId, k); setTick((n) => n + 1); } catch (e) { setError(e); }
  }
  return (
    <div className="stack">
      {can && (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => setForm('receipt')}><Icon name="plus" size={16} />{t('gd_receive')}</button>
          <button type="button" className="btn" onClick={() => setForm('delivery')}>{t('gd_hand')}</button>
        </div>
      )}
      <ErrorBox error={list.error ?? error} />
      <div className="card">
        {list.data && (list.data.length ? (
          <table className="table">
            <thead><tr><th>{t('supplier')}</th><th>{t('gd_basis')}</th><th className="amount">{t('gd_owed')}</th><th className="amount">{t('gd_fine')}</th><th className="amount">{t('gd_owedValue')}</th></tr></thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.partyId}>
                  <td><a href={href(`party/${s.partyId}`)}>{s.name}</a></td>
                  <td>
                    {can
                      ? <select className="input" style={{ width: 120 }} value={s.basisKarat} aria-label={t('gd_basis')} onChange={(e) => void basis(s.partyId, Number(e.target.value) === 24 ? 24 : 21)}>
                          <option value={21}>{karatName(i18n, 21)}</option><option value={24}>{karatName(i18n, 24)}</option>
                        </select>
                      : karatName(i18n, s.basisKarat)}
                  </td>
                  <td className="amount"><strong>{i18n.qty(s.basisMg)}</strong></td>
                  <td className="amount">{i18n.qty(s.fineMg)}</td>
                  <td className="amount">{i18n.money(s.value, 'IQD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState compact icon="users" title={t('gd_noSuppliers')} text={t('gd_noSuppliersText')} />)}
      </div>
      <DocList kinds={['receipt', 'delivery']} reloadKey={tick} onChange={() => setTick((n) => n + 1)} />
      {form === 'receipt' && <ReceiptForm onClose={() => setForm(null)} onDone={done} />}
      {form === 'delivery' && <DeliveryForm onClose={() => setForm(null)} onDone={done} />}
    </div>
  );
}

function useSupplierOptions(): PickOption[] {
  const suppliers = useLoad(() => api.parties({ type: 'supplier', active: 'true' }), []);
  return (suppliers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.name }));
}

function ReceiptForm({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const suppliers = useSupplierOptions();
  const warehouses = useLoad(() => api.warehouses(), []);
  const pieces = useLoad(() => goldApi.items(), []);
  const board = useLoad(() => goldApi.board({ currency: 'IQD' }), []);
  const [partyId, setParty] = useState('');
  const [warehouseId, setWarehouse] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [lines, setLines] = useState<{ itemId: string; making: number | null }[]>([]);
  const [pick, setPick] = useState('');
  const { error, busy, save } = useSaveDoc(onDone);
  const wh = warehouseId || warehouses.data?.[0]?.id || '';
  const price24 = price ?? board.data?.board[24]?.buyPerGram ?? null;
  const byId = new Map((pieces.data ?? []).map((p) => [p.itemId, p]));
  const options: PickOption[] = (pieces.data ?? []).filter((p) => !lines.some((l) => l.itemId === p.itemId)).map((p) => ({ id: p.itemId, code: p.code, label: `${i18n.name(p.name)} · ${karatName(i18n, p.karat)} · ${i18n.qty(p.weightMg)}`, search: `${p.name.ar} ${p.name.en} ${p.name.ku} ${p.barcode ?? ''}` }));
  const goldOf = (itemId: string) => { const p = byId.get(itemId); return p && price24 !== null ? goldValue(p.fineMg, price24) : 0; };
  const defaultMaking = (itemId: string) => { const p = byId.get(itemId); return p ? (p.makingKind === 'gram' ? goldValue(p.weightMg, p.makingAmount) : p.makingAmount) : 0; };
  const total = lines.reduce((s, l) => s + goldOf(l.itemId) + (l.making ?? defaultMaking(l.itemId)), 0);
  return (
    <Modal title={t('gd_receive')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <div className="field"><span>{t('supplier')}</span><SearchCombo value={partyId} options={suppliers} onChange={setParty} placeholder={t('supplier')} ariaLabel={t('supplier')} /></div>
          <label className="field"><span>{t('warehouse')}</span>
            <select className="input" value={wh} onChange={(e) => setWarehouse(e.target.value)}>
              {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          <div className="field"><span>{t('gd_price24')}</span><AmountInput value={price24} currency="IQD" onChange={setPrice} ariaLabel={t('gd_price24')} /></div>
        </div>
        <p className="muted small">{t('gd_receiptHint')}</p>
        <table className="table">
          <thead><tr><th>{t('item')}</th><th className="amount">{t('gd_fine')}</th><th className="amount">{t('gd_goldValue')}</th><th className="amount">{t('gd_making')}</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const p = byId.get(l.itemId);
              return (
                <tr key={l.itemId}>
                  <td>{p ? i18n.name(p.name) : l.itemId} <span className="muted small">{p ? karatName(i18n, p.karat) : ''}</span></td>
                  <td className="amount">{p ? i18n.qty(p.fineMg) : '—'}</td>
                  <td className="amount">{i18n.money(goldOf(l.itemId), 'IQD')}</td>
                  <td className="amount" style={{ width: 160 }}><AmountInput value={l.making} placeholder={i18n.money(defaultMaking(l.itemId), 'IQD')} currency="IQD" onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, making: v } : x)))} ariaLabel={t('gd_making')} /></td>
                  <td><button type="button" className="btn icon ghost" aria-label={t('actDelete')} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ maxWidth: 360 }}><SearchCombo value={pick} options={options} onChange={(v) => { if (v) setLines([...lines, { itemId: v, making: null }]); setPick(''); }} placeholder={t('gd_addLine')} ariaLabel={t('gd_addLine')} /></div>
        {lines.length > 0 && <p>{t('gd_amount')}: <strong>{i18n.money(total, 'IQD')}</strong></p>}
        <ErrorBox error={error} />
        <DocButtons busy={busy} ok={!!partyId && !!wh && price24 !== null && lines.length > 0} onClose={onClose}
          onSave={(post) => void save({
            kind: 'receipt', date: todayIso(), partyId, warehouseId: wh, pricePerGram: price24!, currency: 'IQD',
            lines: lines.map((l) => (l.making === null ? { itemId: l.itemId } : { itemId: l.itemId, making: l.making }))
          }, post)} />
      </div>
    </Modal>
  );
}

function DeliveryForm({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const suppliers = useSupplierOptions();
  const owed = useLoad(() => goldApi.suppliers(), []);
  const [partyId, setParty] = useState('');
  const [karat, setKarat] = useState<GoldKarat>(24);
  const [weightMg, setWeight] = useState<number | null>(null);
  const { error, busy, save } = useSaveDoc(onDone);
  const s = owed.data?.find((x) => x.partyId === partyId);
  return (
    <Modal title={t('gd_hand')} onClose={onClose}>
      <div className="stack">
        <div className="field"><span>{t('supplier')}</span><SearchCombo value={partyId} options={suppliers} onChange={setParty} placeholder={t('supplier')} ariaLabel={t('supplier')} /></div>
        {s && <p className="muted small">{t('gd_owed')}: <strong className="num">{i18n.qty(s.basisMg)}</strong> {karatName(i18n, s.basisKarat)}</p>}
        <div className="grid-2">
          <KaratSelect value={karat} onChange={setKarat} label={t('gd_karat')} />
          <div className="field"><span>{t('gd_weight')}</span><QtyInput value={weightMg} onChange={setWeight} ariaLabel={t('gd_weight')} /></div>
        </div>
        {weightMg ? <p className="muted small">{t('gd_fine')}: <span className="num">{i18n.qty(fineMg(weightMg, karat))}</span></p> : null}
        <ErrorBox error={error} />
        <DocButtons busy={busy} ok={!!partyId && !!weightMg} onClose={onClose}
          onSave={(post) => void save({ kind: 'delivery', date: todayIso(), partyId, karat, weightMg: weightMg! }, post)} />
      </div>
    </Modal>
  );
}

// ——— the gold in the shop ———

function StockTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const stock = useLoad(() => goldApi.stock(), []);
  return (
    <div className="stack">
      <ErrorBox error={stock.error} />
      {stock.data && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>{t('gd_karat')}</th><th className="amount">{t('gd_stockPieces')}</th><th className="amount">{t('gd_weight')}</th><th className="amount">{t('gd_stockScrap')} · {t('gd_weight')}</th>
                <th className="amount">{t('gd_fine')}</th><th className="amount">{t('gd_atCost')}</th>
              </tr>
            </thead>
            <tbody>
              {[...stock.data.byKarat].reverse().map((k) => (
                <tr key={k.karat}>
                  <td>{karatName(i18n, k.karat)}</td>
                  <td className="amount">{i18n.int(k.pieces)}</td>
                  <td className="amount">{i18n.qty(k.piecesWeightMg)}</td>
                  <td className="amount">{i18n.qty(k.scrapWeightMg)}</td>
                  <td className="amount">{i18n.qty(k.fineMg)}</td>
                  <td className="amount">{i18n.money(k.piecesValue + k.scrapValue, 'IQD')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={4}>{t('gd_stockTotal')}</th><th className="amount">{i18n.qty(stock.data.fineMg)}</th><th className="amount">{i18n.money(stock.data.value, 'IQD')}</th></tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="row no-print"><button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button></div>
    </div>
  );
}

// ——— the customer's slip ———

/** A sale invoice's gold pieces for the customer: weight, karat, the price a gram it came to, and the making charge. */
export function GoldSlipPage({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const slip = useLoad(() => goldApi.slip(id), [id]);
  const s = slip.data;
  return (
    <div className="stack">
      <ErrorBox error={slip.error} />
      {s && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row">
            <h2 style={{ flex: 1 }}>{t('gd_slip')} {s.number ? <span className="ltr">{s.number}</span> : null}</h2>
            <span className="num">{i18n.date(s.date)}</span>
          </div>
          {settings?.companyName ? <p className="muted">{i18n.name(settings.companyName)}</p> : null}
          {s.party && <p>{s.party}</p>}
          {s.lines.length ? (
            <table className="table">
              <thead><tr><th>{t('item')}</th><th>{t('gd_karat')}</th><th className="amount">{t('gd_weight')}</th><th className="amount">{t('gd_slipPerGram')}</th><th className="amount">{t('gd_making')}</th><th className="amount">{t('gd_amount')}</th></tr></thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.lineNo}>
                    <td>{i18n.name(l.name)} <span className="muted small ltr">{l.code}</span></td>
                    <td>{karatName(i18n, l.karat)}</td>
                    <td className="amount">{i18n.qty(l.weightMg)}</td>
                    <td className="amount">{i18n.money(l.perGram, s.currency)}</td>
                    <td className="amount">{i18n.money(l.making, s.currency)}</td>
                    <td className="amount">{i18n.money(l.amount, s.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={5}>{t('total')}</th><th className="amount">{i18n.money(s.total, s.currency)}</th></tr></tfoot>
            </table>
          ) : <p className="muted">{t('gd_slipNone')}</p>}
          <div className="row no-print"><button type="button" className="btn primary" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button></div>
        </div>
      )}
    </div>
  );
}

export type { GoldBoard };
