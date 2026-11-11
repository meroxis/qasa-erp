/**
 * Remote support, the Windows side (Help → Remote support…, Settings → About; app-preload.ts → qasaDesktop.remoteSupport).
 *
 * Start Quick Assist opens Windows' own Quick Assist, where the customer types the 6-digit code Qasa support gives
 * them and allows it. The page can't name what opens: the call takes no argument, and this side opens only the two
 * fixed addresses below (Quick Assist, else its Store page when it isn't installed), never one from the page.
 *
 * supportInfo answers the few facts only this side knows (the edition, Windows' version, whether this PC works on an
 * office server, the last error lines of the log), already scrubbed (@qasa/core support.ts); the page adds the rest.
 */
import { scrubSupportText, SUPPORT_LOG_LINES, SUPPORT_LOG_LINE_MAX, type ScrubOptions, type SupportEdition } from '@qasa/core';
import { isRemoteSupportUrl, QUICK_ASSIST_STORE_URL, QUICK_ASSIST_URL } from './external-links.ts';

export interface RemoteSupportDeps {
  /** The call came from the app window's own page (its main frame, on the app's origin). */
  fromAppPage(event: unknown): boolean;
  /** Electron's shell.openExternal */
  openExternal(url: string): Promise<void>;
  /** The log's text (its last part is enough), or null when there is none. */
  readLog(): string | null;
  edition(): SupportEdition;
  /** process.getSystemVersion() */
  windows(): string;
  /** true on a PC that works on an office server's company */
  client(): boolean;
  /** what must never leave this PC in the details: the user's folder, the user and PC names, the session key… */
  scrub(): ScrubOptions;
  log(...parts: unknown[]): void;
}

export type QuickAssistOutcome = 'opened' | 'store' | 'failed';

export interface RemoteSupportInfo {
  edition: SupportEdition;
  windows: string;
  role: 'client' | 'local';
  logLines: string[];
}

/** Error-looking lines of the log: newest last, at most SUPPORT_LOG_LINES, each scrubbed and cut short. */
export function errorLines(text: string | null, scrub: ScrubOptions = {}): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .filter((line) => /error|fail|could not|couldn't|uncaught|unhandled|refused|did not|crash|gone/i.test(line))
    .slice(-SUPPORT_LOG_LINES)
    .map((line) => scrubSupportText(line, scrub).replace(/\s+/g, ' ').trim().slice(0, SUPPORT_LOG_LINE_MAX))
    .filter(Boolean);
}

/** Opens Quick Assist, else its page in the Microsoft Store. Only these two fixed addresses, whatever is passed in. */
export async function startQuickAssist(deps: Pick<RemoteSupportDeps, 'openExternal' | 'log'>): Promise<QuickAssistOutcome> {
  for (const [url, outcome] of [[QUICK_ASSIST_URL, 'opened'], [QUICK_ASSIST_STORE_URL, 'store']] as const) {
    if (!isRemoteSupportUrl(url)) continue; // never: both are fixed above
    try {
      await deps.openExternal(url);
      deps.log(outcome === 'opened' ? 'remote support: Quick Assist opened' : 'remote support: Quick Assist is not installed; its Store page opened');
      return outcome;
    } catch (error) {
      deps.log('remote support: could not open', url, error);
    }
  }
  return 'failed';
}

/** The two IPC handlers: ('app:remoteSupport', event) and ('app:supportInfo', event). Arguments from the page are ignored. */
export function remoteSupportHandlers(deps: RemoteSupportDeps) {
  return {
    start: async (event: unknown, ..._ignored: unknown[]): Promise<QuickAssistOutcome | null> => {
      if (!deps.fromAppPage(event)) return null;
      return startQuickAssist(deps);
    },
    info: (event: unknown, ..._ignored: unknown[]): RemoteSupportInfo | null => {
      if (!deps.fromAppPage(event)) return null;
      let log: string | null = null;
      try { log = deps.readLog(); } catch { /* no log */ }
      const windows = String(deps.windows() ?? '');
      return {
        edition: deps.edition(),
        windows: /^\d{1,3}\.\d{1,3}\.\d{1,6}$/.test(windows) ? windows : '',
        role: deps.client() ? 'client' : 'local',
        logLines: errorLines(log, deps.scrub())
      };
    }
  };
}
