/**
 * Remote support (Settings → About, Help → Remote support…): the short block "Copy support details" puts on the
 * clipboard for the customer to paste into WhatsApp, so Qasa support knows what the PC runs without asking.
 *
 * It must never carry a password, licence key, activation token, office or relay secret, pairing code, customer data,
 * a path with the Windows user's name, or an IP address. So the block is built only from a few narrow facts (each
 * checked against what it may look like), and every free text in it (the error log lines, the plan name) goes through
 * scrubSupportText; the whole block goes through it once more at the end.
 *
 * The labels are in English on purpose: support reads one format, whatever language the customer uses.
 */

export type SupportEdition = 'installer' | 'store' | 'browser' | 'demo';
/** server: this PC shares its company on the office network; client: it works on another PC's; local: not known which. */
export type SupportRole = 'server' | 'client' | 'standalone' | 'local';

export interface SupportFacts {
  version: string;
  edition: SupportEdition;
  /** e.g. "pro", "business", "free"; trial: the free month */
  plan?: { plan: string; trial: boolean } | null;
  /** Windows' own version, "10.0.26100" (null in a browser) */
  windows?: string | null;
  lang: string;
  role?: SupportRole | null;
  /** what waits in the outbox (1.2), null or 0: nothing */
  outboxWaiting?: number | null;
  /** the company file's schema version, and the one this app writes */
  schema?: number | null;
  schemaApp?: number | null;
  /** the last error lines of the log, newest last (scrubbed again here) */
  logLines?: readonly string[] | null;
}

export interface ScrubOptions {
  /** the Windows user's profile folder, e.g. C:\Users\Mer: written as %USERPROFILE% */
  homeDir?: string | null;
  /** the Windows user name and the PC's name: hidden wherever they appear */
  names?: readonly (string | null | undefined)[];
  /** known secrets (session key, office secret…): hidden wherever they appear */
  secrets?: readonly (string | null | undefined)[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The longest line kept from a log, and how many lines. */
export const SUPPORT_LOG_LINE_MAX = 240;
export const SUPPORT_LOG_LINES = 5;

/** The office ID's letters (office.ts): ten of them, maybe as 5-5. */
const OFFICE_ID = /\b[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-?[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}\b/g;

/**
 * Takes out of a text what must never reach a chat: known secrets and names, the user's folder, addresses with their
 * queries, "password=…"-like values, e-mail and IP addresses, long tokens and keys, long numbers (phones, codes).
 */
export function scrubSupportText(input: string, options: ScrubOptions = {}): string {
  let s = String(input ?? '');
  for (const secret of options.secrets ?? []) {
    if (secret && secret.length >= 4) s = s.split(secret).join('[hidden]');
  }
  // the profile folder, given, then any C:\Users\<name> (either slash)
  const home = options.homeDir?.replace(/[\\/]+$/, '');
  if (home && home.length >= 4) {
    const pattern = escape(home).replace(/\\\\/g, '[\\\\/]+').replace(/\//g, '[\\\\/]+');
    s = s.replace(new RegExp(pattern, 'gi'), '%USERPROFILE%');
  }
  // the names first, so a user name with a space can't leave half of it after C:\Users\
  for (const name of options.names ?? []) {
    if (name && name.trim().length >= 3) s = s.replace(new RegExp(`(?<![\\w%])${escape(name.trim())}(?![\\w%])`, 'gi'), '[name]');
  }
  s = s.replace(/\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'<>|:]+/gi, '%USERPROFILE%');
  s = s.replace(/(^|[\s"'(=])[\\/]{2}[^\\/\s]+[\\/][^\s"']*/g, '$1[network path]');
  // an address keeps its scheme and host only (its path and query can carry codes, tokens or a customer's name)
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#"'<>]+)[^\s"'<>]*/gi, (_m, scheme: string, host: string) => `${scheme}${host.replace(/^.*@/, '')}`);
  s = s.replace(/\bBearer\s+\S+/gi, 'Bearer [hidden]');
  s = s.replace(
    /\b(password|passwd|pwd|pass|secret|token|api[_-]?key|key|licen[cs]e|activation|code|pin|cookie|session|authorization|signature|seed)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1$2[hidden]'
  );
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]');
  s = s.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '[IP]');
  // IPv6: two colons or more, and either "::" or a hex letter or many groups (a time "12:05:33" stays)
  s = s.replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi, (m) =>
    m.includes('::') || /[a-f]/i.test(m) || m.split(':').length > 4 ? '[IP]' : m
  );
  s = s.replace(OFFICE_ID, '[office]');
  // keys, tokens, hashes: long runs of letters and digits
  s = s.replace(/[A-Za-z0-9+/_=-]{16,}/g, (m) => (/^[0-9a-f]{16,}$/i.test(m) || (m.length >= 24 && /\d/.test(m) && /[A-Za-z]/.test(m)) ? '[hidden]' : m));
  // phone numbers, licence and pairing numbers: six digits or more, or groups of them
  s = s.replace(/\+?\d[\d -]{4,}\d/g, (m) => (m.replace(/\D/g, '').length >= 6 && !/^\d{4}-\d{2}-\d{2}/.test(m) ? '[number]' : m));
  return s;
}

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.]{1,20})?$/;

/** "10.0.26100" → "Windows 11 (10.0.26100)"; anything else isn't trusted. */
export function windowsName(version: string | null | undefined): string | null {
  const v = String(version ?? '').trim();
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,6}$/.test(v)) return null;
  const [major, , build] = v.split('.').map(Number);
  if (major === 10) return `Windows ${build! >= 22000 ? '11' : '10'} (${v})`;
  return `Windows (${v})`;
}

const EDITION: Record<SupportEdition, string> = {
  installer: 'Windows app (installer from qasaerp.com)',
  store: 'Windows app (Microsoft Store)',
  browser: 'In a browser',
  demo: 'Website demo'
};
const ROLE: Record<SupportRole, string> = {
  server: 'Office server (shares its company on the network)',
  client: 'Client of an office server',
  standalone: 'Standalone',
  local: 'Own company file on this PC'
};
const LANGS: Record<string, string> = { ar: 'Arabic', en: 'English', ku: 'Kurdish' };

/** The block for the clipboard: a few lines, plain text, nothing secret (see the top of this file). */
export function buildSupportDetails(facts: SupportFacts, options: ScrubOptions = {}): string {
  const lines: string[] = ['Qasa ERP support details'];
  lines.push(`Version: ${VERSION.test(String(facts.version)) ? facts.version : 'unknown'}`);
  lines.push(`Edition: ${EDITION[facts.edition] ?? 'unknown'}`);
  const plan = facts.plan && /^[a-z]{1,20}$/.test(facts.plan.plan) ? facts.plan.plan[0]!.toUpperCase() + facts.plan.plan.slice(1) : null;
  lines.push(`Plan: ${plan ? `${plan}${facts.plan!.trial ? ' (free month)' : ''}` : 'unknown'}`);
  const windows = windowsName(facts.windows);
  if (windows) lines.push(`Windows: ${windows}`);
  lines.push(`Language: ${LANGS[facts.lang] ?? 'unknown'}`);
  if (facts.role && ROLE[facts.role]) lines.push(`This PC: ${ROLE[facts.role]}`);
  const waiting = Number(facts.outboxWaiting);
  if (Number.isInteger(waiting) && waiting > 0 && waiting < 1_000_000) lines.push(`Outbox: ${waiting} waiting to send`);
  const schema = Number(facts.schema);
  const schemaApp = Number(facts.schemaApp);
  if (facts.schema != null && Number.isInteger(schema) && schema >= 0 && schema < 10_000) {
    lines.push(`Company file schema: ${schema}${facts.schemaApp != null && Number.isInteger(schemaApp) && schemaApp !== schema ? ` (this app: ${schemaApp})` : ''}`);
  }
  const log = (facts.logLines ?? [])
    .map((line) => scrubSupportText(String(line), options).replace(/\s+/g, ' ').trim().slice(0, SUPPORT_LOG_LINE_MAX))
    .filter(Boolean)
    .slice(-SUPPORT_LOG_LINES);
  if (log.length) lines.push('Last errors in the log:', ...log.map((line) => `- ${line}`));
  return scrubSupportText(lines.join('\n'), options);
}
