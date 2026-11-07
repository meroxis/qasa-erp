import { useEffect, useState } from 'react';
import { AmountInput, ErrorBox, Icon, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { pricesApi } from './prices-api.ts';

/** On an item's page: the wholesale price (in the item's sale currency). Empty = wholesale customers pay retail. */
export function WholesalePriceField({ itemId }: { itemId: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, reload } = useLoad(() => pricesApi.item(itemId), [itemId]);
  const [value, setValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (data) setValue(data.wholesale); }, [data]);
  if (!data) return null;
  const changed = value !== data.wholesale;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await pricesApi.setItemWholesale(itemId, value);
      toast(t('saved'));
      reload();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <div className="field">
      <span>{t('prl_wholesalePrice')}</span>
      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1, maxWidth: 220 }}><AmountInput value={value} currency={data.currency} onChange={setValue} ariaLabel={t('prl_wholesalePrice')} /></div>
        {changed && <button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={15} />{t('save')}</button>}
      </div>
      <span className="small muted">
        {t('prl_wholesaleHelp')}
        {data.wholesale === null && data.partsWholesale !== null && <> · {t('prl_fromParts', { p: i18n.money(data.partsWholesale, data.currency) })}</>}
      </span>
      <ErrorBox error={error} />
    </div>
  );
}
