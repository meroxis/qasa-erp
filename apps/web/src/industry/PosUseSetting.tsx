import { useContext, useState } from 'react';
import { posShown } from '@qasa/core';
import { api } from '../api.ts';
import { ChoiceTiles, type Choice } from '../ChoiceTiles.tsx';
import { DataContext, ErrorBox, Icon, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';

/**
 * Settings → Sales and point of sale → Use the point of sale (1.5.2), for admins: one choice for the whole company, kept
 * with its settings on the server, saved as soon as it is picked. Until someone picks, it follows the business type
 * (core pos-use.ts) and says so under the choice; a company that has sold at the till keeps it.
 */
export function PosUseSetting() {
  const { t } = useI18n();
  const toast = useToast();
  const data = useContext(DataContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!data) return null;
  const { settings, reloadSettings } = data;
  // an office server from before 1.5.2 keeps no such choice (a save would seem to work and do nothing): the till shows
  const oldServer = !!settings && settings.posUse === undefined;
  const on = settings ? posShown(settings) : true;
  const options: Choice<'on' | 'off'>[] = [
    { value: 'on', label: t('pu_on'), icon: 'check' },
    { value: 'off', label: t('pu_off'), icon: 'x' }
  ];
  const why: Key | null = !settings || settings.posUse !== 'auto' ? null : settings.posUsed ? 'pu_autoUsed' : on ? 'pu_autoOn' : 'pu_autoOff';
  async function choose(posUse: 'on' | 'off') {
    setBusy(true);
    setError(null);
    try {
      await api.updateSettings({ posUse });
      await reloadSettings();
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-group">
      <div className="setting" data-setting="pos-use">
        <Icon name="wallet" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('pu_title')}</strong><span>{t('pu_help')}</span></div>
        <div className="setting-ctl">
          <ChoiceTiles label={t('pu_title')} value={on ? 'on' : 'off'} options={options} onChange={(v) => void choose(v)} busy={busy} disabled={!settings || oldServer} />
          {why && <p className="small muted" data-note="pos-use-why">{t(why)}</p>}
          {oldServer && <p className="small muted" data-note="pos-use-old-server">{t('pu_oldServer')}</p>}
          <ErrorBox error={error} />
        </div>
      </div>
    </div>
  );
}
