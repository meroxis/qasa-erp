/**
 * The update rules, apart from Electron so they can be tested: which releases a copy may take (stable or beta), and the
 * release notes as plain text. main.ts applies them to electron-updater.
 */

export type UpdateChannel = 'stable' | 'beta';

/** What the app window is told (updates:state), and the Settings card shows. */
export interface UpdateState {
  /** this copy's version */
  current: string;
  /** installed from the Microsoft Store: the Store updates it */
  fromStore: boolean;
  /** an unpacked development run: nothing to update */
  development: boolean;
  channel: UpdateChannel;
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  /** the version found, downloading or ready */
  version: string | null;
  /** 0–100 while downloading */
  percent: number | null;
  /** release notes of the version found, as plain text (markdown-lite, see docs/releasing.md) */
  notes: string | null;
  /** ISO time of the last finished check */
  lastChecked: string | null;
  /** the last check's error code, when status is 'error' */
  error: string | null;
}

/** A version with a pre-release part (1.0.0-beta.2) is a beta. */
export function isPrerelease(version: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(version.trim());
}

/**
 * What electron-updater is set to. A beta tester follows the beta channel (beta.yml) and takes pre-releases. Leaving the
 * beta goes back to the stable channel without a downgrade: a copy on 1.1.0-beta.3 stays there until a stable release
 * is newer (1.1.0 is newer than 1.1.0-beta.3). electron-updater turns allowDowngrade on whenever the channel is set, and
 * takes pre-releases by default when the running version is one, so both are always set explicitly.
 */
export function updaterOptions(beta: boolean): { channel: 'beta' | 'latest'; allowPrerelease: boolean; allowDowngrade: false } {
  return beta ? { channel: 'beta', allowPrerelease: true, allowDowngrade: false } : { channel: 'latest', allowPrerelease: false, allowDowngrade: false };
}

/** The channel a copy starts on: stable, unless the person joined the beta (a beta build installed by hand also counts). */
export function channelOf(saved: unknown, currentVersion: string): UpdateChannel {
  if (saved === 'beta' || saved === 'stable') return saved;
  return isPrerelease(currentVersion) ? 'beta' : 'stable';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * GitHub gives a release's notes as HTML (the rendered release body). Back to markdown-lite plain text: headings become
 * "### ", list items "- ", bold "**", links their text; every other tag is dropped. The result is only ever shown as
 * text (React escapes it), never as HTML.
 */
export function htmlToText(html: string): string {
  let s = html.replace(/\r/g, '');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h[1-6][^>]*>/gi, '\n### ').replace(/<\/h[1-6]>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  s = s.replace(/<\/?(strong|b)>/gi, '**');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|ul|ol|blockquote|pre|table|tr)>/gi, '\n').replace(/<hr\s*\/?>/gi, '\n---\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** electron-updater's releaseNotes: a string (HTML from GitHub, or text), a list per version, or nothing. */
export function notesText(releaseNotes: unknown): string | null {
  if (typeof releaseNotes === 'string') return releaseNotes.trim() ? htmlToText(releaseNotes) : null;
  if (Array.isArray(releaseNotes)) {
    const parts = releaseNotes
      .map((n) => (n && typeof n === 'object' && typeof (n as { note?: unknown }).note === 'string' ? htmlToText((n as { note: string }).note) : ''))
      .filter(Boolean);
    return parts.length ? parts.join('\n\n---\n\n') : null;
  }
  return null;
}
