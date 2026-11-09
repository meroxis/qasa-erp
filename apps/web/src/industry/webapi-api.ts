import { request } from '../api.ts';

/** The website API (Pro module): keys websites use, and webhooks. Missing (404) in builds without Pro. */
export type WebScope = 'items:read' | 'stock:read' | 'customers:write' | 'orders:write' | 'payments:write';
export type OnlineMethod = 'fib' | 'zaincash' | 'qi' | 'card' | 'other';
/** What the Qasa Store choice on the key form ticks. */
export const STORE_SCOPES: WebScope[] = ['items:read', 'stock:read', 'customers:write', 'orders:write', 'payments:write'];
export type WebEvent = 'stock.changed' | 'price.changed' | 'order.updated';

export interface ApiKeyView {
  id: string; name: string; prefix: string; scopes: WebScope[]; createdBy: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
}
export interface WebhookView {
  id: string; url: string; events: WebEvent[]; active: boolean; lastStatus: number | null; lastDeliveryAt: string | null; createdBy: string; createdAt: string;
}
export interface WebApiOverview {
  available: boolean; keys: ApiKeyView[]; webhooks: WebhookView[]; scopes: WebScope[]; events: WebEvent[];
  /** 1.1 (older servers leave them out) */
  paymentAccounts?: Partial<Record<OnlineMethod, string>>; paymentMethods?: OnlineMethod[];
}

/**
 * Only what the page needs from GET /api/network: over the internet the office ID and the office key a website seals
 * its requests for; on the office network the address and the pairing code it pins.
 */
export interface NetworkForWeb {
  on: boolean;
  port: number;
  addresses: string[];
  code: string | null;
  relay?: { state: string; officeId: string; officeIdShown?: string; officeKey?: string; officeKeyRemadeAt?: string | null } | null;
}

export const webApiClient = {
  overview: () => request<WebApiOverview>('GET', '/api/webapi'),
  createKey: (body: { name: string; scopes: WebScope[] }) => request<{ key: string; view: ApiKeyView }>('POST', '/api/webapi/keys', body),
  revokeKey: (id: string) => request<ApiKeyView>('POST', `/api/webapi/keys/${id}/revoke`, {}),
  /** which safe or bank each online payment method goes into */
  setPaymentAccounts: (body: Partial<Record<OnlineMethod, string>>) => request<Partial<Record<OnlineMethod, string>>>('PUT', '/api/webapi/payment-accounts', body),
  createWebhook: (body: { url: string; events: WebEvent[] }) => request<{ secret: string; view: WebhookView }>('POST', '/api/webapi/webhooks', body),
  updateWebhook: (id: string, body: { url?: string; events?: WebEvent[]; active?: boolean }) => request<WebhookView>('PUT', `/api/webapi/webhooks/${id}`, body),
  deleteWebhook: (id: string) => request<void>('DELETE', `/api/webapi/webhooks/${id}`),
  testWebhook: (id: string) => request<{ status: number }>('POST', `/api/webapi/webhooks/${id}/test`, {}),
  network: () => request<NetworkForWeb>('GET', '/api/network'),
  /** a new office key for websites (admin): the old one stops opening requests at once */
  renewOfficeKey: () => request<{ officeKey: string }>('POST', '/api/network/office-key', {})
};
