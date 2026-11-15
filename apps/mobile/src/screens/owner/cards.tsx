import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { today, type Brief } from '../../api';
import { dateText } from '../../i18n';
import { Icon, type IconName } from '../../icons';
import type { Route } from '../../nav';
import type { ApprovalState, RateNow } from '../../owner/api';
import { approvalsCard } from '../../owner/approvals';
import { rateStatus, rateText } from '../../owner/rate';
import { radius, space } from '../../theme';
import { Card, ErrorState, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { Dashboard } from './dashboard';

/** A counter that goes up each time the link comes back online (not when the screen first opens). */
function useOnlineAgain(): number {
  const { state } = useApp();
  const [n, setN] = useState(0);
  const was = useRef(state);
  useEffect(() => {
    if (state === 'online' && was.current !== 'online') setN((x) => x + 1);
    was.current = state;
  }, [state]);
  return n;
}

type Part<T> = { value: T | null; error: unknown };

/** One read for a card: nothing when the card is not this user's, its error kept apart from the other cards'. */
async function part<T>(on: boolean, read: () => Promise<T>): Promise<Part<T>> {
  if (!on) return { value: null, error: null };
  try {
    return { value: await read(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

/**
 * The owner's and the managers' part of the home screen (phone app 1.1): the dollar rate, what waits for approval, the
 * end of the day, then the day's figures. Each only for whom it is for and only when the office offers it (roles.ts).
 * Loaded together, again on pull to refresh (`tick`, then `onLoaded`) and when the link comes back.
 */
export function OwnerCards({ tick, onLoaded }: { tick: number; onLoaded(): void }) {
  const { t, p, rtl } = useLook();
  const { api, go, can, me, explain } = useApp();
  const again = useOnlineAgain();
  const figures = can('figures');
  const showRate = can('rate');
  const showApprovals = can('approvals');
  const load = useLoad(async () => {
    const [brief, rate, approval] = await Promise.all([
      part<Brief>(figures, api.brief), part<RateNow>(showRate, api.rate), part<ApprovalState>(showApprovals, api.voucherApproval)
    ]);
    return { brief, rate, approval };
  }, [figures, showRate, showApprovals, tick, again]);
  useEffect(() => {
    if (load.data) onLoaded();
    // told once for each answer, whatever the parent's callback is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.data]);

  const brief = load.data?.brief;
  const rate = load.data?.rate.value ?? null;
  const card = approvalsCard(me, load.data?.approval.value, brief?.value);
  const status = rate ? rateStatus(rate, today()) : null;
  const row = (icon: IconName, title: string, sub: string | null, route: Route) => (
    <Card onPress={() => go(route)} label={[title, sub].filter(Boolean).join(', ')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.m, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} color={p.accentText} rtl={rtl} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="bodyStrong">{title}</Txt>
          {sub ? <Txt v="caption" tone="ink3">{sub}</Txt> : null}
        </View>
        <Icon name="forward" color={p.ink3} size={20} rtl={rtl} />
      </View>
    </Card>
  );

  return (
    <>
      {showRate && rate && status && row('dollar', t('rateCard', { r: rateText(rate.rateX100) }),
        status.key === 'rateToday' ? t('ratePer100') : status.key === 'rateLast' ? `${t('rateLast', { d: dateText(status.date!) })} · ${t('rateNoneToday')}` : t('rateDefault'),
        { name: 'rate' })}
      {showApprovals && card.show && row('stamp', card.count !== null ? t('aprCard', { n: card.count }) : t('aprTitle'), null, { name: 'approvals' })}
      {/* a link only: the day's close is read on its own screen, so Home stays light */}
      {can('dayClose') && row('register', t('dayTitle'), dateText(today()), { name: 'dayClose' })}
      {figures && (
        !brief ? <Skeleton rows={3} height={96} />
        : brief.value ? <Dashboard brief={brief.value} />
        : <ErrorState text={explain(brief.error)} onRetry={load.reload} />
      )}
    </>
  );
}
