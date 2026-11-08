import { request } from '../api.ts';

/** Branches (Business): warehouses and safes grouped by branch, and users limited to their branches. */

export interface BranchView {
  id: string;
  code: string;
  name: string;
  city: string;
  active: boolean;
  warehouses: { id: string; code: string }[];
  accounts: string[];
  users: { id: string; username: string; name: string }[];
}
export interface BranchInput { code: string; name: string; city?: string; active?: boolean }
export interface MyBranches { limited: boolean; branches: { id: string; code: string; name: string }[] }

export const branchesApi = {
  list: () => request<{ available: boolean; branches: BranchView[] }>('GET', '/api/branches'),
  mine: () => request<MyBranches>('GET', '/api/branches/mine'),
  create: (input: BranchInput) => request<BranchView>('POST', '/api/branches', input),
  update: (id: string, input: BranchInput) => request<BranchView>('PUT', `/api/branches/${id}`, input),
  setWarehouses: (id: string, warehouseIds: string[]) => request<BranchView>('PUT', `/api/branches/${id}/warehouses`, { warehouseIds }),
  setAccounts: (id: string, accounts: string[]) => request<BranchView>('PUT', `/api/branches/${id}/accounts`, { accounts }),
  setUserBranches: (userId: string, branchIds: string[]) => request<{ userId: string; branchIds: string[] }>('PUT', `/api/users/${userId}/branches`, { branchIds })
};

/** The branch picked in the switcher, kept per user on this PC; '' = the whole company (or all of a limited user's). */
const KEY = (user: string) => `qasa.branch.${user || 'owner'}`;
export const BRANCH_EVENT = 'qasa-branch';

export function pickedBranch(user: string): string {
  try { return localStorage.getItem(KEY(user)) ?? ''; } catch { return ''; }
}

/** The branch the requests go out with (set by the switcher), for api.ts's request(). */
let current = '';
export function currentBranchHeader(): Record<string, string> {
  return current ? { 'x-qasa-branch': current } : {};
}
export function useBranchOnRequests(id: string): void {
  current = id;
}

export function pickBranch(user: string, id: string): void {
  current = id;
  try {
    if (id) localStorage.setItem(KEY(user), id);
    else localStorage.removeItem(KEY(user));
  } catch { /* not available */ }
  window.dispatchEvent(new CustomEvent(BRANCH_EVENT, { detail: id }));
}
