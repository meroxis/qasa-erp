import type { Lang } from '@qasa/core';
import { request } from '../api.ts';

/** Exactly what the anonymous usage ping sends (packages/server/src/usage.ts). */
export interface UsagePayload {
  install: string;
  version: string;
  os: string;
  lang: Lang;
  /** The plan only: never the licence number, so a usage report is never linked to a licence. */
  plan: 'free' | 'trial' | 'starter' | 'pro' | 'business';
  businessTypes: string[];
  companies: number;
  users: number;
  firstRun: boolean;
  channel: 'stable' | 'beta';
  /** A one-time random number (16 bytes, hex), new for every ping and kept nowhere: the portal signs its time with it. */
  nonce: string;
}

export interface UsageView {
  /** False where nothing is ever sent (the website demo, development). */
  available: boolean;
  enabled: boolean;
  lastSent: string | null;
  payload: UsagePayload | null;
}

export const usageApi = {
  get: () => request<UsageView>('GET', '/api/usage'),
  set: (enabled: boolean) => request<UsageView>('PUT', '/api/usage', { enabled }),
  /** Tells the ping which language the app shows (the only thing the screens add to it). */
  context: (lang: Lang) => request<{ ok: true }>('POST', '/api/usage/context', { lang })
};
