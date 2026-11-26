import { useState } from 'react';
import { request } from '../api.ts';
import { AccountCombo, ErrorBox, Icon, useLoad, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';

interface FeatureAccountView { key: string; code: string | null; standard: string; root: string }

/**
 * Settings → Company (2.0, an admin): the accounts features post to that the unified chart may not have (cheques,
 * consignment, gift vouchers, gold). A feature never takes an account the company made itself with the same code; the
 * accountant chooses one here when the feature says its account is missing.
 */
export function FeatureAccountsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, reload } = useLoad(() => request<FeatureAccountView[]>('GET', '/api/feature-accounts').catch(() => null), []);
  const [error, setError] = useState<unknown>(null);
  if (!data) return null;
  const choose = (key: string, accountCode: string) => {
    setError(null);
    void request('PUT', `/api/feature-accounts/${key}`, { accountCode }).then(() => { toast(t('fa_saved')); reload(); }, setError);
  };
  return (
    <div className="settings-group" data-setting="feature-accounts">
      <div className="setting">
        <Icon name="accounts" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('fa_accountsTitle')}</strong><span>{t('fa_hint')}</span></div>
      </div>
      {data.map((f) => (
        <div className="setting" key={f.key}>
          <div className="setting-text"><strong>{t(`fa_${f.key}` as Key)}</strong>{!f.code && <span className="chip warn">{t('fa_notSet')}</span>}</div>
          <div className="setting-ctl" style={{ minWidth: 260 }}>
            <AccountCombo value={f.code ?? ''} ariaLabel={t(`fa_${f.key}` as Key)} filter={(a) => a.code.startsWith(f.root)} onChange={(code) => choose(f.key, code)} />
          </div>
        </div>
      ))}
      <ErrorBox error={error} />
    </div>
  );
}
