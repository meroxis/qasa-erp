import { useEffect, useState } from 'react';
import { LANGS, type Lang } from '@qasa/core';
import { UPD_TEXT } from '../i18n/updates.ts';

/** What the Windows app reports (apps/desktop/src/updates-logic.ts UpdateState). */
export interface UpdateState {
  current: string;
  fromStore: boolean;
  development: boolean;
  channel: 'stable' | 'beta';
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  version: string | null;
  percent: number | null;
  notes: string | null;
  lastChecked: string | null;
  error: string | null;
}

/** The Windows app's updates API (app-preload.ts); absent in a browser and on the website demo. */
export interface DesktopUpdates {
  get(): Promise<UpdateState | null>;
  check(): Promise<UpdateState | null>;
  install(): Promise<UpdateState | null>;
  setChannel(channel: 'stable' | 'beta'): Promise<UpdateState | null>;
  openStore(): void;
  onState(listener: (state: UpdateState) => void): () => void;
}

export const desktopUpdates = (): DesktopUpdates | null =>
  (window as unknown as { qasaUpdates?: DesktopUpdates }).qasaUpdates ?? null;

/** The update state, kept live from the app's messages; null outside the Windows app. */
export function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const api = desktopUpdates();
    if (!api) return;
    let live = true;
    api.get().then((s) => { if (live && s) setState(s); }).catch(() => undefined);
    const off = api.onState((s) => { if (live) setState(s); });
    return () => { live = false; off(); };
  }, []);
  return state;
}

export type UpdKey = keyof typeof UPD_TEXT;

/** The texts in the person's language (these keys live in i18n/updates.ts). */
export function upd(lang: Lang, key: UpdKey, vars: Record<string, string | number> = {}): string {
  const text = UPD_TEXT[key][Math.max(0, LANGS.indexOf(lang))] as string;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
