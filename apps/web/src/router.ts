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
