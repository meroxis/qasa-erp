/**
 * Work from phones as Windows notifications (1.5; app-preload.ts → qasaDesktop.phoneNotice). The app's page asks the
 * office for what phones made (GET /api/phone-activity, as the signed-in user, already filtered for them) and asks this
 * side to show a notice for it: Windows shows it under the app's own name and icon (the AppUserModelId main.ts sets).
 * Clicking it brings the window forward and opens the document (or the list, for several at once).
 *
 * Only plain text crosses: a title and a line, cut short and without control characters, and the page's own address
 * of a document (one of the app's routes, checked here); nothing from the page is ever opened outside the window.
 * At most one notice every few seconds: the page already gathers a burst into one ("3 new from phones").
 */

export interface PhoneNotice {
  title: string;
  body: string;
  /** the app's page to open, as the page's router names it ("invoice/<id>"); '' opens the "From phones" list */
  route: string;
}

const TITLE_MAX = 120;
const BODY_MAX = 240;
/** The pages a notice may open: a document of work from a phone, or a list. */
const ROUTE = /^(invoice|quote|entry|stock-doc|purchase-order)\/[\w-]{1,64}$|^(stock-count|settings\/network|entries)$|^$/;
/** The shortest time between two notices. */
export const NOTICE_GAP_MS = 4000;

const clean = (value: unknown, max: number): string =>
  // eslint-disable-next-line no-control-regex -- control characters are what is taken out
  String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The notice the page asked for, checked; null when it is not one. */
export function phoneNoticeOf(value: unknown): PhoneNotice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || typeof v.body !== 'string' || typeof v.route !== 'string') return null;
  const title = clean(v.title, TITLE_MAX);
  if (!title || !ROUTE.test(v.route)) return null;
  return { title, body: clean(v.body, BODY_MAX), route: v.route };
}

export interface PhoneNoticeDeps {
  /** The call came from the app window's own page (its main frame, on the app's origin). */
  fromAppPage(event: unknown): boolean;
  /** Windows can show notifications (Electron's Notification.isSupported()). */
  supported(): boolean;
  /** Shows it; `onClick` runs when the person clicks it. */
  show(notice: PhoneNotice, onClick: () => void): void;
  /** Brings the app window forward (restored when minimized) and tells its page to open `route`. */
  open(route: string): void;
  now?(): number;
  log(...parts: unknown[]): void;
}

/** The IPC handler of 'app:phoneNotice': true when the notice was shown. */
export function phoneNoticeHandler(deps: PhoneNoticeDeps) {
  let lastAt = -Infinity;
  return (event: unknown, value: unknown): boolean => {
    if (!deps.fromAppPage(event)) return false;
    const notice = phoneNoticeOf(value);
    if (!notice || !deps.supported()) return false;
    const now = deps.now?.() ?? Date.now();
    if (now - lastAt < NOTICE_GAP_MS) return false;
    lastAt = now;
    try {
      deps.show(notice, () => deps.open(notice.route));
      return true;
    } catch (error) {
      deps.log('could not show a notice of work from phones:', error);
      return false;
    }
  };
}
