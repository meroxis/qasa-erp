import { useEffect, useState } from 'react';

/**
 * Something a screen reads from the office: loading (for the skeleton), the answer, or the error (for the retry), and
 * reload() for pull to refresh. `deps` are plain values (ids, a period); a change loads again. An answer that arrives
 * after the screen has gone, or after a newer request, is dropped.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly (string | number | boolean | null | undefined)[]): {
  data: T | undefined; error: unknown; loading: boolean; refreshing: boolean; reload(): void;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(deps);
  useEffect(() => {
    let live = true;
    load().then(
      (value) => { if (live) { setData(value); setError(null); } },
      (e: unknown) => { if (live) setError(e); }
    ).finally(() => {
      if (!live) return;
      setLoading(false);
      setRefreshing(false);
    });
    return () => { live = false; };
    // loaded again when the values it depends on change (key) or on reload (tick), not for a new function each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { data, error, loading, refreshing, reload: () => { setRefreshing(true); setTick((n) => n + 1); } };
}
