import { useEffect, useState } from 'react';
import { ErrorBox, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { pricesApi, type PriceList } from './prices-api.ts';

/** On a customer's page: do they buy at retail or wholesale prices? Saved as soon as it is switched. */
export function PriceListField({ partyId }: { partyId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data } = useLoad(() => pricesApi.partyList(partyId), [partyId]);
  const [list, setList] = useState<PriceList>('retail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (data) setList(data.list); }, [data]);

  async function choose(next: PriceList) {
    if (next === list || busy) return;
    setBusy(true);
    setError(null);
    const before = list;
    setList(next);
    try {
      await pricesApi.setPartyList(partyId, next);
      toast(t('prl_saved'));
    } catch (e) {
      setList(before);
      setError(e);
    }
    setBusy(false);
  }

  return (
    <div className="field">
      <span>{t('prl_title')}</span>
      <div className="track" role="group" aria-label={t('prl_title')}>
        {(['retail', 'wholesale'] as const).map((x) => (
          <button key={x} type="button" aria-pressed={list === x} disabled={busy || !data} onClick={() => void choose(x)}>{t(x === 'retail' ? 'prl_retail' : 'prl_wholesale')}</button>
        ))}
      </div>
      <span className="small muted">{t('prl_partyHelp')}</span>
      <ErrorBox error={error} />
    </div>
  );
}
