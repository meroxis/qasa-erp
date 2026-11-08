import { isQasaSiteUrl } from '@qasa/core';

/**
 * Addresses the app window may hand to the system browser or mail app: a link, a new window (target=_blank,
 * window.open) or a navigation away from the app. The page (or, in office-network mode, a server on another PC) must
 * never be able to open any address it likes, so only these leave the app:
 *  - mailto: (the mail app opens a draft; nothing is sent without the person)
 *  - https on a short list of hosts, exactly (no subdomains, no port, no user name or password):
 *    qasaerp.com (the site, the guide, the legal pages), my.qasaerp.com (the customer portal), wa.me (WhatsApp
 *    reminders and support), apps.microsoft.com (the Store page), github.com (source code and notices), and the Google
 *    and Microsoft sign-in pages that cloud backup opens.
 * Plain http and every other scheme or host is refused.
 */
export const EXTERNAL_HOSTS: readonly string[] = [
  'my.qasaerp.com',
  'wa.me',
  'apps.microsoft.com',
  'github.com',
  'accounts.google.com',
  'login.microsoftonline.com'
];

export function isAllowedExternal(target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol === 'mailto:') return true;
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'qasaerp.com') return isQasaSiteUrl(target);
  return EXTERNAL_HOSTS.includes(url.hostname) && url.port === '' && url.username === '' && url.password === '';
}

/** What the log says about a refused address: its scheme and host only (a query can carry personal data). */
export function refusedForLog(target: string): string {
  try {
    const url = new URL(target);
    return url.host ? `${url.protocol}//${url.host}` : url.protocol;
  } catch {
    return '(not an address)';
  }
}
