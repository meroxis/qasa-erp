import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { api, type PartyType, type PartyView } from '../api.ts';
import { ErrorBox, Icon, SearchCombo, useData, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { pricesApi, type PriceList } from './prices-api.ts';
import { focusAfter, mayAddParty, QUICK_LIMITS, quickAddParty, quickPartyInput, quickStart, type QuickKey, type QuickPartyFields, type SameParty } from './party-quick-add.ts';

/**
 * The customer (or supplier) box of an invoice, a quotation, the till, an installment contract, a voucher or a
 * purchase order: the usual search, and for someone who may add customers a "+" inside the box and an "Add “…” as a
 * new customer" row for a name nobody has. Either opens a small form right under the box (no other page): the name,
 * the phone, the city or address and, for a customer, the price list. Saving adds the party the way the Customers page
 * does, picks it here and moves the cursor on to the next field.
 */

export const partyOption = (p: PartyView): PickOption => ({ id: p.id, code: p.code, label: p.name, search: p.phone });

export function PartyPicker({ type, value, options, onChange, onCreated, placeholder, ariaLabel, emptyLabel, invalid, inputRef, priceList = true }: {
  type: PartyType;
  value: string;
  options: PickOption[];
  /**
   * `party`: given whenever the choice is someone added (or found) by the quick add whom the page's own list may not
   * have: when they are added, and every time they are chosen again from the list afterwards
   */
  onChange(id: string, party?: PartyView): void;
  /** a party was added here: the page adds it to its own list (or loads the list again) */
  onCreated?(party: PartyView): void;
  placeholder: string;
  ariaLabel?: string;
  emptyLabel?: string;
  invalid?: boolean;
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
  /** false where the page never prices by the customer's price list (the till): the form does not ask for one */
  priceList?: boolean;
}) {
  const { t } = useI18n();
  const { permissions } = useData();
  const allowed = mayAddParty(permissions, type);
  // the text the form opened with; null while it is closed
  const [adding, setAdding] = useState<string | null>(null);
  // added or found here, until the page's own list has them
  const [made, setMade] = useState<PartyView[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLInputElement | null>(null);
  const input = inputRef ?? own;
  const all = useMemo(() => [...options, ...made.filter((p) => !options.some((o) => o.id === p.id)).map(partyOption)], [options, made]);
  const customer = type === 'customer';

  const finish = (party: PartyView, created: boolean) => {
    setMade((m) => (m.some((p) => p.id === party.id) ? m : [...m, party]));
    setAdding(null);
    if (created) onCreated?.(party);
    onChange(party.id, party);
    // once the form is gone and the page shows the choice: on to the next field
    window.setTimeout(() => focusAfter(box.current), 0);
  };
  // added by a request that was still on its way when the form was closed: in the list from now on, chosen by nobody
  const late = (party: PartyView) => {
    setMade((m) => (m.some((p) => p.id === party.id) ? m : [...m, party]));
    onCreated?.(party);
  };

  return (
    <div className="party-picker" ref={box}>
      <SearchCombo
        value={value} options={all} onChange={(id) => pickParty(id, made, onChange)} placeholder={placeholder} inputRef={input}
        {...(ariaLabel !== undefined ? { ariaLabel } : {})} {...(emptyLabel !== undefined ? { emptyLabel } : {})} {...(invalid ? { invalid } : {})}
        {...(allowed ? {
          add: {
            title: t(customer ? 'qa_addCustomer' : 'qa_addSupplier'),
            label: (typed: string) => (typed ? t(customer ? 'qa_addNamedCustomer' : 'qa_addNamedSupplier', { name: typed }) : t(customer ? 'qa_addCustomer' : 'qa_addSupplier')),
            onAdd: (typed: string) => setAdding(typed)
          }
        } : {})}
      />
      {allowed && adding !== null && (
        <QuickPartyForm type={type} name={adding} priceList={priceList} onDone={finish} onLate={late} onClose={() => { setAdding(null); window.setTimeout(() => input.current?.focus(), 0); }} />
      )}
    </div>
  );
}

/**
 * A choice made in the list. Someone the quick add added or found is only in the picker's own list until the page
 * loads its list again (and a party found there may never be in it): their record goes with the id, so a page that
 * reads more than the id from it (a voucher line takes the party's account) never keeps the party chosen before.
 */
export function pickParty(id: string, made: readonly PartyView[], onChange: (id: string, party?: PartyView) => void): void {
  const party = id ? made.find((p) => p.id === id) : undefined;
  if (party) onChange(id, party); else onChange(id);
}

export function QuickPartyForm({ type, name: typed, priceList = true, onDone, onLate, onClose }: {
  type: PartyType;
  /** the text typed in the box: the name the form starts with (a number alone starts in the phone field) */
  name: string;
  /** false: no price list is asked for, and a new customer keeps the one every customer starts with */
  priceList?: boolean;
  onDone(party: PartyView, created: boolean): void;
  /** the form was closed while the server was still adding the party: it is not chosen; the page's list gets it */
  onLate?(party: PartyView): void;
  onClose(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const customer = type === 'customer';
  const [fields, setFields] = useState<QuickPartyFields>(() => quickStart(typed));
  const [list, setList] = useState<PriceList>('retail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<{ field: keyof QuickPartyFields; text: string } | null>(null);
  const [same, setSame] = useState<SameParty[] | null>(null);
  const [offline, setOffline] = useState(false);
  // the key of the last try that got no answer: the next try of the same person can't add them twice
  const held = useRef<QuickKey | null>(null);
  // whether the form is still on the page: an answer that arrives after Esc or Cancel chooses nobody
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);
  const title = t(customer ? 'qa_addCustomer' : 'qa_addSupplier');

  const set = (patch: Partial<QuickPartyFields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setSame(null);
    setProblem(null);
  };

  async function save(force: boolean) {
    if (busy) return;
    const checked = quickPartyInput(fields);
    if (!checked.ok) {
      setProblem({ field: checked.field, text: t(checked.code === 'name_required' ? 'qa_nameNeeded' : checked.code === 'name_letters' ? 'qa_nameLetters' : 'qa_tooLong') });
      return;
    }
    setBusy(true);
    setError(null);
    setOffline(false);
    try {
      const done = await quickAddParty(type, checked.input, { force, held: held.current, closed: () => !open.current, wholesale: customer && priceList && list === 'wholesale' }, {
        list: (kind, options) => api.parties({ type: kind }, options),
        create: (kind, input, options) => api.createParty(kind, input, options),
        setWholesale: (partyId, options) => pricesApi.setPartyList(partyId, 'wholesale', options)
      });
      held.current = done.key;
      if (done.status === 'closed') {
        // closed meanwhile: the document keeps the customer it has; someone added all the same is said, and listed
        if (done.party) {
          toast(t('qa_added', { name: done.party.name, code: done.party.code }));
          onLate?.(done.party);
        }
        return;
      }
      if (done.status === 'same') { setSame(done.same); return; }
      if (done.status === 'offline') { setOffline(true); setSame(null); return; }
      toast(done.listSaved ? t('qa_added', { name: done.party.name, code: done.party.code }) : t('qa_listNotSaved'));
      onDone(done.party, true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // only this form closes, not a dialog it may sit in
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void save(false);
    }
  };

  return (
    <div className="quick-add" role="group" aria-label={title} onKeyDown={onKey}>
      <div className="quick-add-head">
        <strong>{title}</strong>
        <button type="button" className="btn icon subtle small" tabIndex={-1} aria-label={t('cancel')} title={t('cancel')} onClick={onClose}><Icon name="x" size={15} /></button>
      </div>
      <label className="field">
        <span>{t('name')}</span>
        <input className={'input' + (problem?.field === 'name' ? ' invalid' : '')} autoFocus maxLength={QUICK_LIMITS.name} value={fields.name}
          aria-invalid={problem?.field === 'name'} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>{t('phone')}</span>
          <input className={'input ltr' + (problem?.field === 'phone' ? ' invalid' : '')} dir="ltr" inputMode="tel" maxLength={QUICK_LIMITS.phone} placeholder="0750 123 4567"
            value={fields.phone} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('qa_city')}</span>
          <input className={'input' + (problem?.field === 'city' ? ' invalid' : '')} maxLength={QUICK_LIMITS.address} value={fields.city} onChange={(e) => set({ city: e.target.value })} />
        </label>
      </div>
      {customer && priceList && (
        <div className="field">
          <span>{t('prl_title')}</span>
          <div className="track" role="group" aria-label={t('prl_title')} style={{ alignSelf: 'flex-start' }}>
            {(['retail', 'wholesale'] as const).map((x) => (
              <button key={x} type="button" aria-pressed={list === x} onClick={() => setList(x)}>{t(x === 'retail' ? 'prl_retail' : 'prl_wholesale')}</button>
            ))}
          </div>
        </div>
      )}
      {problem && <div className="small quick-add-problem" role="alert">{problem.text}</div>}
      {same && (
        <div className="alert warn quick-add-same" role="alert">
          <div>{t(customer ? 'qa_sameCustomer' : 'qa_sameSupplier')}</div>
          <ul>
            {same.map((s) => (
              <li key={s.party.id}>
                <span className="quick-add-who">
                  <span className="ltr tree-code">{s.party.code}</span> <strong className="bidi">{s.party.name}</strong>
                  {s.party.phone && <> · <span className="ltr num">{i18n.digitsOf(s.party.phone)}</span></>}
                  <span className="muted small"> ({[s.samePhone && t('qa_samePhone'), s.sameName && t('qa_sameName'), !s.party.active && t('qa_inactiveNote')].filter(Boolean).join(i18n.lang === 'en' ? ', ' : '، ')})</span>
                </span>
                {s.party.active && <button type="button" className="btn small" disabled={busy} onClick={() => onDone(s.party, false)}>{t('qa_useThis')}</button>}
              </li>
            ))}
          </ul>
          <div><button type="button" className="btn small" disabled={busy} onClick={() => void save(true)}>{t('qa_addAnyway')}</button></div>
        </div>
      )}
      {offline && <div className="alert warn" role="alert">{t('qa_offline')}</div>}
      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save(false)}><Icon name="check" size={16} />{busy ? t('saving') : t('qa_add')}</button>
        <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
      </div>
      <div className="muted small">{t(customer ? 'qa_laterCustomer' : 'qa_laterSupplier')}</div>
    </div>
  );
}
