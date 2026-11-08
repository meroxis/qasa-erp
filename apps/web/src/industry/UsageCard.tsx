import { useEffect, useState } from 'react';
import { ErrorBox, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { usageApi, type UsageView } from './usage-api.ts';

/**
 * Settings card for the anonymous usage ping: what it is, a switch (on by default, only an admin changes it), and
 * the exact JSON that is sent. It also tells the server which language the app is in (the ping's `lang`).
 */
export function UsageCard({ admin }: { admin: boolean }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const toast = useToast();
  const { data, error, reload } = useLoad(() => usageApi.get(), []);
  const [view, setView] = useState<UsageView | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const shown = view ?? data;

  useEffect(() => {
    void usageApi.context(lang).catch(() => { /* the ping is optional; never bother the user */ });
  }, [lang]);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setSaveError(null);
    try {
      setView(await usageApi.set(enabled));
      toast(t('saved'));
    } catch (e) {
      setSaveError(e);
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="card pad stack"><h2>{t('us_title')}</h2><ErrorBox error={error} /></div>;
  if (!shown) return null;
  return (
    <div className="card pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('us_title')}</h2>
        {shown.available && <span className={'chip ' + (shown.enabled ? 'ok' : '')}>{shown.enabled ? t('switchedOn') : t('switchedOff')}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('us_help')}</p>
      {!shown.available ? (
        <div className="alert">{t('us_unavailable')}</div>
      ) : (
        <>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={shown.enabled} disabled={!admin || saving} onChange={(e) => void toggle(e.target.checked)} />
            {t('us_switch')}
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            {shown.lastSent ? t('us_lastSent', { d: i18n.date(shown.lastSent.slice(0, 10)) }) : t('us_neverSent')}
          </p>
          <details>
            <summary>{t('us_whatSent')}</summary>
            <ul className="small">
              <li>{t('us_field_install')}</li>
              <li>{t('us_field_rest')}</li>
            </ul>
            {shown.payload && (
              <pre className="ltr small" dir="ltr" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(shown.payload, null, 2)}</pre>
            )}
          </details>
        </>
      )}
      <ErrorBox error={saveError} />
    </div>
  );
}
