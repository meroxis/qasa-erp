import { useState } from 'react';
import { ApiError, request } from '../api.ts';
import { AccountCombo, ErrorBox, Icon, useLoad, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';

/** What the server tells of each feature's account (packages/server/src/feature-accounts.ts). */
export interface FeatureAccountView { key: string; code: string | null; standard: string; root: string }

export const featureAccountsApi = {
  list: () => request<FeatureAccountView[]>('GET', '/api/feature-accounts'),
  choose: (key: string, accountCode: string) => request<FeatureAccountView[]>('PUT', `/api/feature-accounts/${encodeURIComponent(key)}`, { accountCode })
};

const LABEL: Record<string, Key> = {
  notesReceivable: 'ux_fa_notesReceivable', consignment: 'ux_fa_consignment', giftVouchers: 'ux_fa_giftVouchers', oldGold: 'ux_fa_oldGold', goldOwed: 'ux_fa_goldOwed'
};

/**
 * 2.0.0: Settings → Company: the accounts the new features post to (notes receivable, consignment goods held, gift
 * vouchers sold, old gold, gold owed to suppliers). Each uses its own standard account, made the first time; a company
 * that already has an account of its own with that code chooses one here (the feature says so when it can't go on).
 * Only accounts of the right kind are offered; the server checks again.
 */
export function FeatureAccountsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => featureAccountsApi.list().catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null; // an office server on an older version
    throw e;
  }), []);
  const [failed, setFailed] = useState<unknown>(null);
  if (data === null) return null;
  const choose = async (key: string, code: string) => {
    setFailed(null);
    try { await featureAccountsApi.choose(key, code); toast(t('saved')); reload(); } catch (e) { setFailed(e); }
  };
  return (
    <div className="settings-group" data-setting="feature-accounts">
      <div className="setting">
        <Icon name="book" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('ux_fa_title')}</strong><span>{t('ux_fa_help')}</span></div>
      </div>
      <ErrorBox error={error ?? failed} />
      {(data ?? []).map((a) => (
        <div key={a.key} className="setting">
          <div className="setting-text">
            <strong>{t(LABEL[a.key] ?? 'ux_fa_title')}</strong>
            <span className="small">{a.code ? t('ux_fa_uses', { c: a.code }) : t('ux_fa_none', { c: a.standard })}</span>
          </div>
          <div className="setting-ctl" style={{ minWidth: 260 }}>
            <AccountCombo value={a.code ?? ''} ariaLabel={t(LABEL[a.key] ?? 'ux_fa_title')} filter={(x) => x.code.startsWith(a.root)} onChange={(code) => { if (code && code !== a.code) void choose(a.key, code); }} />
          </div>
        </div>
      ))}
    </div>
  );
}
