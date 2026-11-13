import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { api, type PartyType, type PartyView } from '../api.ts';
import { ErrorBox, Icon, SearchCombo, useData, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { pricesApi, type PriceList } from './prices-api.ts';
import { focusAfter, mayAddParty, QUICK_LIMITS, quickAddParty, quickPartyInput, type QuickKey, type QuickPartyFields, type SameParty } from './party-quick-add.ts';

/**
 * The customer (or supplier) box of an invoice, a quotation, the till, an installment contract, a voucher or a
 * purchase order: the usual search, and for someone who may add customers a "+" inside the box and an "Add “…” as a
 * new customer" row for a name nobody has. Either opens a small form right under the box (no other page): the name,
 * the phone, the city or address and, for a customer, the price list. Saving adds the party the way the Customers page
 * does, picks it here and moves the cursor on to the next field.
 */

export const partyOption = (p: PartyView): PickOption => ({ id: p.id, code: p.code, label: p.name, search: p.phone });

export function PartyPicker({ type, value, options, onChange, onCreated, placeholder, ariaLabel, emptyLabel, invalid, inputRef }: {
  type: PartyType;
  value: string;
  options: PickOption[];
  /** `party`: given when the choice was just added (or found) by the quick add, before the page's own list has it */
  onChange(id: string, party?: PartyView): void;
  /** a party was added here: the page adds it to its own list (or loads the list again) */
  onCreated?(party: PartyView): void;
  placeholder: string;
  ariaLabel?: string;
  emptyLabel?: string;
  invalid?: boolean;
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
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

  return (
    <div className="party-picker" ref={box}>
      <SearchCombo
        value={value} options={all} onChange={(id) => onChange(id)} placeholder={placeholder} inputRef={input}
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
        <QuickPartyForm type={type} name={adding} onDone={finish} onClose={() => { setAdding(null); window.setTimeout(() => input.current?.focus(), 0); }} />
      )}
    </div>
  );
}

export function QuickPartyForm({ type, name: typed, onDone, onClose }: { type: PartyType; name: string; onDone(party: PartyView, created: boolean): void; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const customer = type === 'customer';
  const [fields, setFields] = useState<QuickPartyFields>({ name: typed, phone: '', city: '' });
  const [list, setList] = useState<PriceList>('retail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<{ field: keyof QuickPartyFields; text: string } | null>(null);
  const [same, setSame] = useState<SameParty[] | null>(null);
  const [offline, setOffline] = useState(false);
  // the key of the last try that got no answer: the next try of the same person can't add them twice
  const held = useRef<QuickKey | null>(null);
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
      setProblem({ field: checked.field, text: t(checked.code === 'name_required' ? 'qa_nameNeeded' : 'qa_tooLong') });
      return;
    }
    setBusy(true);
    setError(null);
    setOffline(false);
    try {
      const done = await quickAddParty(type, checked.input, { force, held: held.current }, {
        list: (kind) => api.parties({ type: kind }),
        create: (kind, input, options) => api.createParty(kind, input, options)
      });
      held.current = done.key;
      if (done.status === 'same') { setSame(done.same); return; }
      if (done.status === 'offline') { setOffline(true); setSame(null); return; }
      let listSaved = true;
      if (customer && list === 'wholesale') {
        // the customer is added whatever happens to their price list: it can be chosen again on their page
        try { await pricesApi.setPartyList(done.party.id, 'wholesale'); } catch { listSaved = false; }
      }
      toast(listSaved ? t('qa_added', { name: done.party.name, code: done.party.code }) : t('qa_listNotSaved'));
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
      {customer && (
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
