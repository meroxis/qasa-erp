import { APP_VERSION } from '@qasa/core';
import { useData } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';

/** Meroxis' WhatsApp support line. */
export const SUPPORT_WHATSAPP = 'https://wa.me/rapidnetisp';
export const WEBSITE = 'https://qasaerp.com';

/** A chat bubble (the app's icon set has none), drawn like the other icons. */
function ChatIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}

type PlanLike = { plan: string; source: string } | null | undefined;

function planLabel(plan: PlanLike, t: I18n['t']): string {
  if (!plan) return '';
  if (plan.source === 'trial') return t('planTrialChip');
  return plan.plan === 'pro' ? t('plan_pro') : plan.plan === 'business' ? t('plan_business') : t('plan_free');
}

/**
 * The WhatsApp link with the app's version and plan already written, so support knows what the customer runs. The
 * Windows app opens it in the browser or WhatsApp Desktop (new windows to outside addresses go to the system).
 */
export function supportLink(i18n: I18n, plan: PlanLike, note = ''): string {
  const head = `Qasa ERP ${APP_VERSION} — ${planLabel(plan, i18n.t) || '-'} — `;
  return `${SUPPORT_WHATSAPP}?text=${encodeURIComponent(head + i18n.t('us_waGreeting') + note)}`;
}

/** A button for the header or a help menu: opens a WhatsApp chat with support. */
export function SupportButton({ compact = false }: { compact?: boolean }) {
  const i18n = useI18n();
  const { plan } = useData();
  const open = () => window.open(supportLink(i18n, plan), '_blank', 'noopener,noreferrer');
  return (
    <button type="button" className={'btn subtle' + (compact ? ' icon' : '')} onClick={open} title={i18n.t('us_support')} aria-label={i18n.t('us_support')}>
      <ChatIcon />
      {!compact && <span>{i18n.t('us_supportShort')}</span>}
    </button>
  );
}

/** "Help & support": WhatsApp, the website, the version and the licence status, for a menu or a settings card. */
export function HelpPanel() {
  const i18n = useI18n();
  const { t } = i18n;
  const { plan } = useData();
  const licence = plan?.license;
  return (
    <div className="card pad stack">
      <h2>{t('us_helpTitle')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('us_helpText')}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a className="btn primary" href={supportLink(i18n, plan)} target="_blank" rel="noopener noreferrer">
          <ChatIcon /> {t('us_support')}
        </a>
        <a className="btn" href={WEBSITE} target="_blank" rel="noopener noreferrer">{t('us_website')}</a>
      </div>
      <div className="grid-2">
        <div className="field"><span>{t('us_version')}</span><strong className="ltr num">{APP_VERSION}</strong></div>
        <div className="field">
          <span>{t('us_licence')}</span>
          <strong>
            {planLabel(plan, t)}
            {licence ? <> · <span className="ltr num">{licence.id}</span></> : null}
          </strong>
        </div>
      </div>
    </div>
  );
}
