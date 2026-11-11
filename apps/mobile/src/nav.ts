/**
 * The app's navigation: five tabs at the bottom (home, items, sell, customers, more), each with its own stack of
 * screens. Back (the header's arrow or Android's back gesture) goes up the current stack, then to the home tab; on
 * home's first screen it leaves the app. Kept as plain data so it is tested without React Native.
 */

export type Tab = 'home' | 'items' | 'sell' | 'customers' | 'more';
export const TABS: readonly Tab[] = ['home', 'items', 'sell', 'customers', 'more'];

export type Purpose = 'look' | 'cart' | 'count';

export type Route =
  | { name: 'home' }
  | { name: 'items' }
  | { name: 'scan'; purpose: Purpose }
  | { name: 'item'; code: string; itemId?: string | undefined; purpose: Purpose }
  | { name: 'newItem'; barcode: string }
  | { name: 'count' }
  | { name: 'cart' }
  | { name: 'customers'; pick?: 'sale' | undefined }
  | { name: 'customer'; id: string }
  | { name: 'statement'; id: string }
  | { name: 'collect'; id: string }
  | { name: 'more' }
  | { name: 'outbox' }
  | { name: 'security' }
  | { name: 'about' };

export interface NavState {
  tab: Tab;
  stacks: Record<Tab, Route[]>;
}

const ROOTS: Record<Tab, Route> = {
  home: { name: 'home' }, items: { name: 'items' }, sell: { name: 'cart' }, customers: { name: 'customers' }, more: { name: 'more' }
};

export const rootOf = (tab: Tab): Route => ROOTS[tab];

export function initialNav(): NavState {
  return { tab: 'home', stacks: { home: [ROOTS.home], items: [ROOTS.items], sell: [ROOTS.sell], customers: [ROOTS.customers], more: [ROOTS.more] } };
}

export type NavAction =
  | { type: 'push'; route: Route }
  | { type: 'replace'; route: Route }
  | { type: 'back' }
  /** a tab: again on the tab already open, back to its first screen */
  | { type: 'tab'; tab: Tab }
  /** to a tab's first screen, then (optionally) a screen on top of it */
  | { type: 'open'; tab: Tab; route?: Route | undefined };

/** Longer stacks drop their oldest screens above the first (a long run of scans must not grow without end). */
const MAX_DEPTH = 12;

export function navigate(state: NavState, action: NavAction): NavState {
  const stack = state.stacks[state.tab];
  const set = (tab: Tab, s: Route[]): NavState => ({ tab, stacks: { ...state.stacks, [tab]: s } });
  switch (action.type) {
    case 'push': {
      const next = [...stack, action.route];
      return set(state.tab, next.length > MAX_DEPTH ? [next[0]!, ...next.slice(next.length - MAX_DEPTH + 1)] : next);
    }
    case 'replace':
      return set(state.tab, stack.length > 1 ? [...stack.slice(0, -1), action.route] : [stack[0]!, action.route]);
    case 'back':
      if (stack.length > 1) return set(state.tab, stack.slice(0, -1));
      return state.tab === 'home' ? state : { ...state, tab: 'home' };
    case 'tab':
      return action.tab === state.tab ? set(state.tab, [ROOTS[state.tab]]) : { ...state, tab: action.tab };
    case 'open':
      return set(action.tab, action.route ? [ROOTS[action.tab], action.route] : [ROOTS[action.tab]]);
  }
}

/** Is there somewhere for back to go? (false: Android's back leaves the app) */
export const canGoBack = (state: NavState) => state.stacks[state.tab].length > 1 || state.tab !== 'home';
export const current = (state: NavState): Route => state.stacks[state.tab].at(-1)!;
