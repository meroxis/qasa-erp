import { useMemo, useState } from 'react';
import { normalizeForSearch, type Names } from '@qasa/core';
import { api, type AccountView } from '../api.ts';
import { ErrorBox, Icon, Modal, useData, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';

function suggestCode(parent: string, taken: Set<string>): string {
  for (let i = 1; i <= 99; i += 1) {
    const code = parent + String(i);
    if (!taken.has(code) && ![...taken].some((c) => c.startsWith(code) && c !== code)) return code;
  }
  return parent;
}

export function Accounts() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { accounts, reloadAccounts } = useData();
  const [open, setOpen] = useState<Set<string>>(() => new Set(['1', '18', '181', '183', '16']));
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<AccountView | null>(null);
  const [renaming, setRenaming] = useState<AccountView | null>(null);
  const [error, setError] = useState<unknown>(null);

  const children = useMemo(() => {
    const map = new Map<string | null, AccountView[]>();
    for (const a of accounts) map.set(a.parentCode, [...(map.get(a.parentCode) ?? []), a]);
    return map;
  }, [accounts]);

  const depth = useMemo(() => {
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const d = new Map<string, number>();
    for (const a of accounts) {
      let n = 0;
      let p = a.parentCode;
      while (p) { n += 1; p = byCode.get(p)?.parentCode ?? null; }
      d.set(a.code, n);
    }
    return d;
  }, [accounts]);

  const visible = useMemo(() => {
    const q = normalizeForSearch(query);
    if (q) return accounts.filter((a) => a.code.startsWith(q) || [a.name.ar, a.name.en, a.name.ku].some((n) => normalizeForSearch(n).includes(q)));
    const out: AccountView[] = [];
    const walk = (parent: string | null) => {
      for (const a of children.get(parent) ?? []) {
        out.push(a);
        if (open.has(a.code)) walk(a.code);
      }
    };
    walk(null);
    return out;
  }, [accounts, children, open, query]);

  const toggle = (code: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  async function remove(a: AccountView) {
    if (!window.confirm(t('deleteAccountQ', { c: a.code }))) return;
    setError(null);
    try {
      await api.deleteAccount(a.code);
      await reloadAccounts();
      toast(t('a_delete'));
    } catch (e) {
      setError(e);
    }
  }

  const others = (n: Names) => (['ar', 'en', 'ku'] as const).filter((l) => l !== i18n.lang).map((l) => n[l]).filter(Boolean).join(' · ');

  return (
    <div className="stack">
      <div className="row">
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16 }}>{t('unifiedSystem')}</h2>
          <div className="muted small">{t('verifyNote')}</div>
        </div>
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('searchAccounts')} aria-label={t('searchAccounts')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn" onClick={() => setOpen(new Set(accounts.filter((a) => !a.postable).map((a) => a.code)))}>{t('expandAll')}</button>
        <button type="button" className="btn" onClick={() => setOpen(new Set())}>{t('collapseAll')}</button>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>{t('account')}</th><th>{t('nature')}</th><th className="amount">{t('balance')}</th><th style={{ width: 150 }} /></tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const hasKids = !a.postable;
              return (
                <tr key={a.code} className="tree-row" style={{ background: (depth.get(a.code) ?? 0) === 0 ? 'var(--fill)' : undefined }}>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap', paddingInlineStart: query ? 0 : (depth.get(a.code) ?? 0) * 22 }}>
                      {hasKids && !query
                        ? <button type="button" className="tree-toggle" onClick={() => toggle(a.code)} aria-expanded={open.has(a.code)} aria-label={a.code}>
                            <span style={{ display: 'inline-block', transform: open.has(a.code) ? 'rotate(90deg)' : i18n.dir === 'rtl' ? 'rotate(180deg)' : 'none' }}><Icon name="chevron" size={14} /></span>
                          </button>
                        : <span style={{ width: 26, display: 'inline-block' }} />}
                      <span className="tree-code num">{a.code}</span>
                      <span>
                        <span style={{ fontWeight: hasKids ? 700 : 500 }}>{i18n.name(a.name)}</span>
                        {a.system && <span className="chip" style={{ marginInlineStart: 6 }}>{t('standard')}</span>}
                        <div className="muted small">{others(a.name)}</div>
                      </span>
                    </div>
                  </td>
                  <td className="small">{a.nature === 'debit' ? t('debit') : t('credit')}</td>
                  <td className="amount">{a.balance ? i18n.money(a.balance, 'IQD') : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {!(a.postable && a.hasEntries) && <button type="button" className="btn icon small" title={t('addSub')} aria-label={t('addSub') + ' ' + a.code} onClick={() => setAdding(a)}><Icon name="plus" size={15} /></button>}
                      <button type="button" className="btn icon small" title={t('rename')} aria-label={t('rename') + ' ' + a.code} onClick={() => setRenaming(a)}><Icon name="edit" size={15} /></button>
                      <a className="btn icon small" title={t('statement')} aria-label={t('statement') + ' ' + a.code} href={href(`statement/${a.code}`)}><Icon name="doc" size={15} /></a>
                      {!a.system && a.postable && !a.hasEntries && <button type="button" className="btn icon small danger" title={t('actDelete')} aria-label={t('actDelete') + ' ' + a.code} onClick={() => remove(a)}><Icon name="x" size={15} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding && <AccountForm mode="add" account={adding} suggested={suggestCode(adding.code, new Set(accounts.map((a) => a.code)))} onClose={() => setAdding(null)} onDone={(code) => { setAdding(null); setOpen((s) => new Set([...s, adding.code])); toast(t('saved') + ' — ' + code); }} />}
      {renaming && <AccountForm mode="rename" account={renaming} suggested={renaming.code} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); toast(t('saved')); }} />}
    </div>
  );
}

function AccountForm({ mode, account, suggested, onClose, onDone }: { mode: 'add' | 'rename'; account: AccountView; suggested: string; onClose(): void; onDone(code: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { reloadAccounts } = useData();
  const [code, setCode] = useState(suggested);
  const [name, setName] = useState<Names>(mode === 'rename' ? account.name : { ar: '', en: '', ku: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'add') await api.createAccount({ parentCode: account.code, code: code.trim(), name });
      else await api.renameAccount(account.code, name);
      await reloadAccounts();
      onDone(code);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'add' ? t('newAccountTitle', { p: `${account.code} — ${i18n.name(account.name)}` }) : t('renameTitle', { c: account.code });
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {mode === 'add' && <label className="field"><span>{t('code')}</span><input className="input ltr" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /></label>}
        <label className="field"><span>{t('nameAr')}</span><input className="input" dir="rtl" lang="ar" value={name.ar} onChange={(e) => setName({ ...name, ar: e.target.value })} /></label>
        <label className="field"><span>{t('nameEn')}</span><input className="input" dir="ltr" lang="en" value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} /></label>
        <label className="field"><span>{t('nameKu')}</span><input className="input" dir="rtl" lang="ckb" value={name.ku} onChange={(e) => setName({ ...name, ku: e.target.value })} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={submit}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
