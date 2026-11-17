import { useContext, useState } from 'react';
import { posBigTiles } from '@qasa/core';
import { api } from '../api.ts';
import { ChoiceTiles, type Choice } from '../ChoiceTiles.tsx';
import { DataContext, ErrorBox, Icon, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';

/**
 * Settings → Sales and point of sale → Big pictures on the till, for admins: one choice for the whole company, kept
 * with its settings on the server, saved as soon as it is picked. Off (normal tiles) for every company until an
 * admin turns it on (core pos-look.ts).
 */
export function PosBigPicturesSetting() {
  const { t } = useI18n();
  const toast = useToast();
  const data = useContext(DataContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!data) return null;
  const { settings, reloadSettings } = data;
  // an office server from before this choice keeps none (a save would seem to work and do nothing)
  const oldServer = !!settings && settings.posBigPictures === undefined;
  const on = settings ? posBigTiles(settings) : false;
  const options: Choice<'on' | 'off'>[] = [
    { value: 'on', label: t('tq_bigOn'), icon: 'layers' },
    { value: 'off', label: t('tq_bigOff'), icon: 'rows' }
  ];
  async function choose(posBigPictures: 'on' | 'off') {
    setBusy(true);
    setError(null);
    try {
      await api.updateSettings({ posBigPictures });
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
      <div className="setting" data-setting="pos-big-pictures">
        <Icon name="layers" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tq_bigTitle')}</strong><span>{t('tq_bigHelp')}</span></div>
        <div className="setting-ctl">
          <ChoiceTiles label={t('tq_bigTitle')} value={on ? 'on' : 'off'} options={options} onChange={(v) => void choose(v)} busy={busy} disabled={!settings || oldServer} />
          {oldServer && <p className="small muted" data-note="pos-big-old-server">{t('tq_bigOldServer')}</p>}
          <ErrorBox error={error} />
        </div>
      </div>
    </div>
  );
}
