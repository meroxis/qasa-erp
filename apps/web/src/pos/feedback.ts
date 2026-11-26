/**
 * The till's own preferences on this PC (2.0): touch mode (bigger buttons and an on-screen keypad, for a touch POS
 * screen) and the scan beep. Kept in this browser's storage: they belong to the screen and the cashier's hands, not to
 * the company, so each till decides. A storage that can't be used (private window) gives the defaults.
 */

export interface TillPrefs {
  /** bigger buttons and the keypad on screen */
  touch: boolean;
  /** a short beep on each scan (a lower one when nothing is found) */
  beep: boolean;
  /**
   * All the till's tools on screen (the discount, the customer, the cash handed over, Hold, a gift voucher). Off: the
   * simple till, which shows the total, cash or credit and the two Sale buttons, and keeps the rest under More.
   */
  full: boolean;
}

export const TILL_PREFS_KEY = 'qasa.pos.prefs';
export const DEFAULT_PREFS: TillPrefs = { touch: false, beep: true, full: false };

export function readPrefs(store: Pick<Storage, 'getItem'> | null = safeStorage()): TillPrefs {
  try {
    const raw = store?.getItem(TILL_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const v = JSON.parse(raw) as Partial<TillPrefs>;
    return {
      touch: typeof v.touch === 'boolean' ? v.touch : DEFAULT_PREFS.touch, beep: typeof v.beep === 'boolean' ? v.beep : DEFAULT_PREFS.beep,
      full: typeof v.full === 'boolean' ? v.full : DEFAULT_PREFS.full
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs: TillPrefs, store: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { store?.setItem(TILL_PREFS_KEY, JSON.stringify(prefs)); } catch { /* not available */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

let audio: AudioContext | null = null;

/**
 * A short beep through the PC's speaker: a high one for an item added, a low double one for a code nothing has. No
 * sound file: a tone made here, so nothing loads and nothing fails offline. Quiet where sound can't play.
 */
export function beep(kind: 'ok' | 'bad'): void {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const tones = kind === 'ok' ? [{ f: 1760, at: 0, d: 0.07 }] : [{ f: 330, at: 0, d: 0.12 }, { f: 260, at: 0.16, d: 0.16 }];
    for (const tone of tones) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = tone.f;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(audio.destination);
      const start = audio.currentTime + tone.at;
      osc.start(start);
      osc.stop(start + tone.d);
    }
  } catch { /* no sound on this PC */ }
}

/** The keypad's keys, in the order they show (a calculator's layout: 7 8 9 on top). */
export const KEYPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'] as const;
export type PadKey = (typeof KEYPAD)[number];

/** A keypad key on a number being typed (whole numbers only: dinars, or a quantity). */
export function padPress(current: string, key: PadKey): string {
  if (key === '⌫') return current.slice(0, -1);
  const next = (current === '0' ? '' : current) + key;
  return next.replace(/^0+(?=\d)/, '').slice(0, 9);
}
