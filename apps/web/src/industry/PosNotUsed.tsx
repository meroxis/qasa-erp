import { EmptyState } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';

/**
 * The till's address (#/pos) in a company that does not use the point of sale (1.5.2, core pos-use.ts): no till, but
 * what to do instead. An admin gets the way to the setting; anyone else sells with sales invoices or asks an admin.
 * (The menu, the home page and the search show no till then; this is for a link, a bookmark or an old favourite.)
 */
export function PosNotUsed({ admin }: { admin: boolean }) {
  const { t } = useI18n();
  return (
    <div className="card" data-page="pos-not-used">
      <EmptyState
        icon="wallet"
        title={t('pu_offTitle')}
        text={t(admin ? 'pu_offAdmin' : 'pu_offOther')}
        {...(admin ? { action: { label: t('pu_openSetting'), href: href('settings/sales'), icon: 'sliders' } } : {})}
        secondary={{ label: t('invoices'), href: href('sales'), icon: 'invoice' }}
      />
    </div>
  );
}
