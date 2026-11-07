import { useEffect, useState } from 'react';
import { useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { BRANCH_EVENT, branchesApi, pickBranch, pickedBranch, useBranchOnRequests } from './branches-api.ts';

/**
 * The branch switcher in the top bar: shown when the company has branches and this person can pick among more than
 * one (a user limited to a single branch has nothing to switch). The choice is kept per user on this PC and sent
 * with every request as the x-qasa-branch header, so the Daily Brief, the dashboard and the reports follow it.
 */
export function BranchSwitcher({ user }: { user: string }) {
  const { t } = useI18n();
  const mine = useLoad(() => branchesApi.mine(), []);
  const [picked, setPicked] = useState(() => pickedBranch(user));
  useBranchOnRequests(picked);
  useEffect(() => {
    const on = (e: Event) => setPicked((e as CustomEvent<string>).detail ?? '');
    window.addEventListener(BRANCH_EVENT, on);
    return () => window.removeEventListener(BRANCH_EVENT, on);
  }, []);
  const branches = mine.data?.branches ?? [];
  // a branch picked earlier that this person can no longer use is forgotten
  useEffect(() => {
    if (mine.data && picked && !branches.some((b) => b.id === picked)) pickBranch(user, '');
  }, [mine.data, picked, branches, user]);
  if (!mine.data || branches.length < 2) return null;
  return (
    <label className="branch-switcher row" title={t('bn_switcher')}>
      <span className="small muted">{t('bn_switcher')}</span>
      <select className="input" value={picked} aria-label={t('bn_switcher')} onChange={(e) => pickBranch(user, e.target.value)}>
        <option value="">{mine.data.limited ? t('bn_allBranches') : t('bn_wholeCompany')}</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
