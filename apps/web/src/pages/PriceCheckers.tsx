import { useState } from 'react';
import { api } from '../api.ts';
import { EmptyState, ErrorBox, Icon, Modal, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { priceCheckerApi } from '../industry/market-extras-api.ts';
import { LockedFeature } from '../industry/LockedFeature.tsx';

/**
 * أجهزة فحص الأسعار — the price checker screens near the shelves (2.0, Starter and up; the admin's page). Adding one
 * gives its link once: opened on the tablet, the screen keeps the token and shows prices only. Route: price-checkers.
 */

/** The address a tablet opens: this app's own page, the token after # (it never reaches a server log). */
export function deviceLink(token: string, base: string = `${location.origin}${location.pathname}`): string {
  return `${base}#/price-checker?token=${encodeURIComponent(token)}`;
}

/** 2.0.0: without the plan, what the page does and how to get it (LockedFeature), not its tabs over an empty page. */
export function PriceCheckers() {
  const { plan } = useData();
  if (plan && !plan.features.includes('priceChecker')) return <LockedFeature feature="priceChecker" icon="scale" />;
  return <PriceCheckersPage />;
}

function PriceCheckersPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'mx_pcTitle', group: 'gStock' });
  const { plan } = useData();
  const available = !!plan?.features.includes('priceChecker');
  const { data, error, reload } = useLoad(() => priceCheckerApi.devices(), []);
  const warehouses = useLoad(() => api.warehouses(), []);
  const [adding, setAdding] = useState<{ name: string; warehouseId: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function add() {
    if (!adding) return;
    setActionError(null);
    try {
      const made = await priceCheckerApi.add({ name: adding.name, warehouseId: adding.warehouseId || null });
      setAdding(null);
      setLink(deviceLink(made.token));
      reload();
    } catch (e) { setActionError(e); }
  }
  const local = /^(127\.|localhost)/.test(location.hostname);
  return (
    <div className="stack">
      <p className="muted no-print" style={{ margin: 0 }}>{t('mx_pcHelp')}</p>
      {plan && !available && <div className="alert info small" role="status">{t('mx_pcNeedsPlan')}</div>}
      <div className="row no-print"><span className="spacer" />
        {available && <button type="button" className="btn primary" onClick={() => setAdding({ name: '', warehouseId: '' })}><Icon name="plus" size={16} />{t('mx_pcAdd')}</button>}
      </div>
      <ErrorBox error={error ?? actionError} />
      {data && (data.devices.length === 0 ? <EmptyState icon="scale" title={t('mx_pcTitle')} text={t('mx_pcNone')} /> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>{t('mx_name')}</th><th>{t('mx_pcLastSeen')}</th><th /><th className="no-print" /></tr></thead>
            <tbody>
              {data.devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="small">{d.lastSeenAt ? i18n.dateTime(d.lastSeenAt) : <span className="muted">{t('mx_pcNeverSeen')}</span>}</td>
                  <td>{d.revokedAt ? <span className="chip bad">{t('mx_pcRevoked')}</span> : <span className="chip ok">{t('mx_active')}</span>}</td>
                  <td className="no-print">
                    {!d.revokedAt && (
                      <button type="button" className="btn small" onClick={() => {
                        if (!window.confirm(t('mx_pcRevokeConfirm'))) return;
                        priceCheckerApi.revoke(d.id).then(() => { toast(t('mx_pcRevoked')); reload(); }, setActionError);
                      }}>{t('mx_pcRevoke')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {adding && (
        <Modal title={t('mx_pcAdd')} onClose={() => setAdding(null)}>
          <div className="stack">
            <label className="field"><span>{t('mx_name')}</span><input className="input" value={adding.name} maxLength={80} placeholder={t('mx_pcNamePlaceholder')} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus /></label>
            {(warehouses.data ?? []).filter((w) => w.active).length > 1 && (
              <label className="field"><span>{t('warehouse')}</span>
                <select className="input" value={adding.warehouseId} onChange={(e) => setAdding({ ...adding, warehouseId: e.target.value })}>
                  <option value="">{t('mx_pcAnyBranch')}</option>
                  {(warehouses.data ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
                </select>
              </label>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setAdding(null)}>{t('cancel')}</button>
              <button type="button" className="btn primary" disabled={!adding.name.trim()} onClick={() => void add()}>{t('mx_pcAdd')}</button>
            </div>
          </div>
        </Modal>
      )}
      {link && (
        <Modal title={t('mx_pcLinkTitle')} onClose={() => setLink(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('mx_pcLinkHelp')}</p>
            <input className="input ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label={t('mx_pcLinkTitle')} />
            {local && <div className="alert info small">{t('mx_pcLocalNote')}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(link).then(() => toast(t('mx_pcCopied'))); }}><Icon name="clipboard" size={16} />{t('mx_pcCopy')}</button>
              <button type="button" className="btn primary" onClick={() => setLink(null)}>{t('mx_close')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
