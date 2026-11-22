import { useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { canSwitchCompanies, companiesApi } from './companies-api.ts';

/**
 * Over every page of a company that is past the plan's company limit (Windows app): it can be viewed, not changed,
 * until the plan allows it again. Says so plainly and points at the plans and at the other companies, so nobody takes
 * the refusals for a fault or the records for lost. `plan` is passed so the bar asks again when the plan changes (a
 * licence entered, a check-in that brought it back).
 */
export function CompanyViewOnlyBanner({ plan }: { plan?: string | undefined }) {
  const { t } = useI18n();
  const { data } = useLoad(() => (canSwitchCompanies() ? companiesApi.state() : Promise.resolve({ viewOnly: false })), [plan]);
  if (!data?.viewOnly) return null;
  return (
    <div className="alert warn no-print" role="status" style={{ margin: 0, borderRadius: 0, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <strong>{t('co_viewOnly')}</strong>
      <span>{t('co_viewOnlyText')}</span>
      <a className="btn small" href={href('plans')}>{t('co_viewOnlyPlans')}</a>
      <a className="btn small subtle" href={href('companies')}>{t('co_title')}</a>
    </div>
  );
}
