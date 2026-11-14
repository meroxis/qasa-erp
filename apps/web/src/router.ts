import { useEffect, useState } from 'react';

/** Tiny hash router: "#/entry/abc" → ["entry", "abc"]. Works offline and inside the Windows app. */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

export function go(path: string): void {
  window.location.hash = '#/' + path.replace(/^\//, '');
}

export function href(path: string): string {
  return '#/' + path.replace(/^\//, '');
}

/**
 * The address to put in place of a page that is closed to the person signed in (an admin's page, the books, a page
 * whose action is not theirs): Home's, since Home is what shows. Null when nothing is to change: the page is open,
 * the address is Home's already, or nobody is signed in yet (who they are, and so what is closed, is not known).
 */
export function closedPageAddress(o: { closed: boolean; page: string | undefined; signedIn: boolean }): string | null {
  return o.closed && o.signedIn && !!o.page && o.page !== 'home' ? '#/' : null;
}

/**
 * A page with work not saved yet (a stock count) may hold the address: before the app goes to another page, the hold
 * says whether it may (it asks the person). When it may not, the address is put back and the page stays.
 */
type Hold = () => boolean;
let hold: Hold | null = null;

export function holdRoute(next: Hold | null): void {
  hold = next;
}

/**
 * The first hashchange listener of the window: added when this module loads, before any useRoute adds its own, so
 * a refused change stops here and the pages never see it.
 */
export function guardHashChange(e: HashChangeEvent, w: Pick<Window, 'history'> = window): boolean {
  if (!hold || hold()) return true;
  e.stopImmediatePropagation();
  let back = '#/';
  try {
    back = new URL(e.oldURL).hash || '#/';
  } catch { /* no old address: home */ }
  w.history.replaceState(w.history.state, '', back);
  return false;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', (e) => { guardHashChange(e); });
}
