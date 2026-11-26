import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.ts';
import { askForPort, desktopScale, portChosen, type ScalePort } from './scale.ts';

/**
 * The port the scale is on, chosen by an admin for this PC (Settings → Tills and till rules → Weighing scale). The till
 * reads that port and no other, and never writes its request to a port nobody chose. In the Windows app the list comes
 * from the app and the choice is kept by it; in a browser the browser's own chooser grants one port.
 */
export function ScalePortChoice() {
  const { t } = useI18n();
  const desktop = desktopScale();
  const [ports, setPorts] = useState<ScalePort[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [ready, setReady] = useState(false);
  const refresh = async () => {
    if (desktop) {
      const list = await desktop.serialPorts().catch(() => null);
      if (list) { setPorts(list.ports); setChosen(list.chosen); }
    }
    setReady(await portChosen());
  };
  useEffect(() => { void refresh(); /* once, when the card opens */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the app only learns which ports there are when the page asks for one (a click): it grants the chosen one, or none
  const find = async () => { await askForPort(); await refresh(); };
  const choose = async (key: string) => {
    if (!desktop) return;
    await desktop.chooseSerialPort(key).catch(() => false);
    // asked again, the app now grants the port just chosen
    if (key) await askForPort();
    await refresh();
  };
  const name = ports?.find((p) => p.key === chosen)?.label ?? chosen;
  return (
    <div className="stack" style={{ gap: 6 }} data-setting="pos-scale-port">
      <strong className="small">{t('sc_port')}</strong>
      <span className="small muted">{t('sc_portHelp')}</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn small" onClick={() => void find()}>{desktop ? t('sc_find') : t('sc_choose')}</button>
        {desktop && ports !== null && ports.length > 0 && (
          <select className="input" aria-label={t('sc_choose')} value={ports.some((p) => p.key === chosen) ? chosen : ''} onChange={(e) => void choose(e.target.value)}>
            <option value="">{t('sc_none')}</option>
            {ports.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        )}
        <span className="small" role="status">
          {desktop && ports !== null && ports.length === 0 && !chosen ? t('sc_noPorts') : ready ? (name ? t('sc_chosen', { name }) : t('sc_ready')) : chosen ? t('sc_chosen', { name }) : t('sc_none')}
        </span>
      </div>
    </div>
  );
}
