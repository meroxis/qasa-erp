import { useState } from 'react';
import { BUSINESS_FEATURE, BUSINESS_TYPES, PLANS, starterTradeFor, type BusinessType } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, LanguageSwitch, useData, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { AgreeLine } from '../industry/LegalPanel.tsx';
import { StarterListButton } from '../industry/CatalogPickers.tsx';

const CHOICES: Record<BusinessType, { icon: string; title: Key; text: Key }> = {
  trade: { icon: 'cart', title: 'bt_trade', text: 'bt_tradeText' },
  realEstate: { icon: 'building', title: 'bt_realEstate', text: 'bt_realEstateText' },
  mobileShop: { icon: 'idcard', title: 'bt_mobileShop', text: 'bt_mobileShopText' },
  autoParts: { icon: 'box', title: 'bt_autoParts', text: 'bt_autoPartsText' },
  engineeringWorks: { icon: 'swap', title: 'bt_engineeringWorks', text: 'bt_engineeringWorksText' },
  electricalSolar: { icon: 'sun', title: 'bt_electricalSolar', text: 'bt_electricalSolarText' },
  generators: { icon: 'zap', title: 'bt_generators', text: 'bt_generatorsText' },
  pharmacy: { icon: 'pill', title: 'bt_pharmacy', text: 'bt_pharmacyText' }
};

/** The cheapest plan that includes an industry, for the badge on its card. */
function planFor(type: BusinessType): 'pro' | 'business' | null {
  const feature = BUSINESS_FEATURE[type];
  if (!feature) return null;
  return PLANS.pro.features.includes(feature) ? 'pro' : 'business';
}

/**
 * "What does your company do?" — asked once at the start and kept in Settings. It only decides which pages the menu
 * shows; turning one off hides it and keeps its data.
 */
export function BusinessTypeChooser({ onDone, first }: { onDone?: () => void; first?: boolean }) {
  const { t } = useI18n();
  const { settings, plan, reloadSettings, reloadPlan } = useData();
  const toast = useToast();
  const [picked, setPicked] = useState<BusinessType[]>(settings?.businessTypes ?? ['trade']);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (type: BusinessType) =>
    setPicked((list) => (list.includes(type) ? list.filter((x) => x !== type) : [...list, type]));

  async function save() {
    if (!picked.length) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateSettings({ businessTypes: BUSINESS_TYPES.filter((b) => picked.includes(b)) });
      // the first month's free trial (every paid feature) starts by itself the first time
      if (first && plan?.trialAvailable) {
        try { await api.startTrial(); reloadPlan(); } catch { /* the plan page offers it again */ }
      }
      reloadSettings();
      toast(t('saved'));
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="biz-chooser">
      {/* the first screen of a new company comes before Settings can be reached, so the language is chosen here too */}
      {first && <LanguageSwitch className="biz-lang" />}
      <h2>{t(first ? 'bizWelcome' : 'bizType')}</h2>
      <p className="muted">{t('bizQuestion')}</p>
      <div className="biz-grid" role="group" aria-label={t('bizQuestion')}>
        {BUSINESS_TYPES.map((type) => {
          const c = CHOICES[type];
          const on = picked.includes(type);
          const needs = planFor(type);
          const feature = BUSINESS_FEATURE[type];
          const unlocked = !feature || !!plan?.features.includes(feature);
          return (
            <button key={type} type="button" className={'biz-card' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(type)}>
              <span className="biz-icon"><Icon name={c.icon} size={22} /></span>
              <span className="biz-text">
                <strong>{t(c.title)}</strong>
                <span>{t(c.text)}</span>
              </span>
              {needs && !unlocked && <span className="chip">{needs === 'pro' ? 'Pro' : 'Business'}</span>}
              <span className="biz-check" aria-hidden="true">{on && <Icon name="check" size={16} />}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">{t('bizHelp')}</p>
      {/* categories and brands for the trade: only when pressed, never by themselves */}
      <fieldset className="card pad stack" style={{ gap: 6 }}>
        <legend className="small"><strong>{t('cat_title')} · {t('bnd_title')}</strong></legend>
        <StarterListButton key={starterTradeFor(picked)} trade={starterTradeFor(picked)} />
      </fieldset>
      <ErrorBox error={error} />
      {first && <AgreeLine />}
      <div className="actions">
        <button type="button" className="btn primary" disabled={!picked.length || saving} onClick={() => void save()}>
          {t(first ? 'bizStart' : 'save')}
        </button>
      </div>
    </div>
  );
}

/** The page under System, for changing it later. */
export function BusinessTypePage() {
  return (
    <div className="card pad">
      <BusinessTypeChooser />
    </div>
  );
}
