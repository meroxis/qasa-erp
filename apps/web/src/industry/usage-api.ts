import type { Lang } from '@qasa/core';
import { request } from '../api.ts';

/** Exactly what the anonymous usage ping sends (packages/server/src/usage.ts). */
export interface UsagePayload {
  install: string;
  version: string;
  os: string;
  lang: Lang;
  plan: 'free' | 'trial' | 'pro' | 'business';
  licence: string | null;
  businessTypes: string[];
  companies: number;
  users: number;
  firstRun: boolean;
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
