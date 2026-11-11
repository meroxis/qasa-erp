import { useEffect } from 'react';
import { holdRoute } from '../router.ts';

/**
 * A stock count saved on the server as it is typed (POST/PUT /api/adjustments/counts): what was counted since the last
 * save goes up shortly after the last key press, so leaving the page, a reload or a closed laptop loses at most that
 * moment. The server freezes each item's book quantity the first time it is counted.
 */

export interface CountSessionLine { itemId: string; countedMilli: number; bookMilli: number; unitCost: number | null; countedAt: string }
export interface CountSessionView {
  id: string; warehouseId: string; date: string; notes: string; full: boolean; status: 'open' | 'done' | 'discarded';
  adjustmentId: string | null; createdBy: string; updatedBy: string; updatedAt: string; lines: CountSessionLine[];
  /** 1.1: the categories and brands it is limited to (null: every item) */
  scope?: { categoryIds: string[]; brandIds: string[] } | null;
}
export interface CountMeta { date: string; notes: string; full: boolean }
export type CountChange = { itemId: string; countedMilli: number | null; unitCost?: number };

export interface CountSaverApi {
  start(body: { warehouseId: string; date: string; notes?: string; full?: boolean }): Promise<CountSessionView>;
  save(id: string, body: { date: string; notes: string; full: boolean; counts: CountChange[] }): Promise<CountSessionView>;
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'closed';

interface Timers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The server's answer when the count was finished or discarded meanwhile (on another PC): it can't change any more. */
export function closedElsewhere(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown } | null;
  return !!e && e.status === 409 && e.code === 'action_not_allowed';
}

export interface CountSaverListeners {
  saved(session: CountSessionView): void;
  state(state: SaveState, error?: unknown): void;
  /** The count was finished or discarded on another PC: what was not saved here is dropped. */
  closed?(): void;
}

/**
 * Collects changes and sends them after `delay` ms of quiet; one request at a time; a failed save is kept and tried
 * again. Once disposed (the page is gone, or another warehouse is counted) it tells the page nothing more and tries
 * nothing again; once the count is closed on another PC it keeps nothing and sends nothing more.
 */
export class CountSaver {
  sessionId: string | null;
  state: SaveState = 'saved';
  /** The book quantities the server froze for this warehouse's count (from the last save, or the session opened). */
  frozen = new Map<string, number>();
  private pending = new Map<string, CountChange>();
  private metaChanged = false;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private disposed = false;
  private closed = false;

  constructor(
    private readonly api: CountSaverApi,
    private readonly warehouseId: string,
    private meta: CountMeta,
    private readonly listeners: CountSaverListeners,
    sessionId: string | null = null,
    private readonly delay = 800,
    private readonly timers: Timers = realTimers
  ) {
    this.sessionId = sessionId;
  }

  /** Something not on the server yet (or on its way). */
  get dirty(): boolean {
    return this.pending.size > 0 || this.metaChanged || this.running !== null;
  }

  setCount(itemId: string, countedMilli: number | null, unitCost?: number): void {
    if (this.closed || this.disposed) return;
    this.pending.set(itemId, { itemId, countedMilli, ...(unitCost !== undefined && countedMilli !== null ? { unitCost } : {}) });
    this.schedule();
  }

  /**
   * One item's count, with its cost only for a surplus: above the book quantity frozen for this saver's own warehouse,
   * or (not counted before) above `sheetStock`, what the books say now.
   */
  count(itemId: string, countedMilli: number | null, unitCost: number | undefined, sheetStock: number | undefined): void {
    const book = this.frozen.get(itemId) ?? sheetStock ?? 0;
    this.setCount(itemId, countedMilli, countedMilli !== null && countedMilli > book ? unitCost : undefined);
  }

  setMeta(patch: Partial<CountMeta>): void {
    if (this.closed || this.disposed) return;
    this.meta = { ...this.meta, ...patch };
    this.metaChanged = true;
    this.schedule();
  }

  private setState(state: SaveState, error?: unknown): void {
    this.state = state;
    if (!this.disposed) this.listeners.state(state, error);
  }

  private schedule(wait = this.delay): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.setState('pending');
    this.timer = this.timers.set(() => { this.timer = null; void this.flush().catch(() => {}); }, wait);
  }

  /** Sends everything now and waits until the server has it (the count is finished, or the page is left). */
  async flush(): Promise<void> {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    while (this.running) await this.running.catch(() => {});
    if (!this.pending.size && !this.metaChanged) {
      if (this.state !== 'error' && this.state !== 'closed') this.setState('saved');
      return;
    }
    const changes = [...this.pending.values()];
    this.pending.clear();
    this.metaChanged = false;
    this.setState('saving');
    const work = (async () => {
      try {
        if (!this.sessionId) {
          const started = await this.api.start({ warehouseId: this.warehouseId, date: this.meta.date, ...(this.meta.notes ? { notes: this.meta.notes } : {}), full: this.meta.full });
          this.sessionId = started.id;
        }
        const session = await this.api.save(this.sessionId, { ...this.meta, counts: changes });
        if (session.warehouseId === this.warehouseId) this.frozen = fromSession(session).frozen;
        if (!this.disposed) this.listeners.saved(session);
        this.setState(this.pending.size || this.metaChanged ? 'pending' : 'saved');
      } catch (error) {
        if (closedElsewhere(error)) {
          // finished or discarded on another PC: nothing typed here can go into it any more, so nothing is kept
          this.closed = true;
          this.pending.clear();
          this.metaChanged = false;
          this.setState('closed', error);
          if (!this.disposed) this.listeners.closed?.();
          throw error;
        }
        // nothing is lost: what failed goes back in front of anything typed since, and is tried again
        for (const c of changes) if (!this.pending.has(c.itemId)) this.pending.set(c.itemId, c);
        this.metaChanged = true;
        this.setState('error', error);
        throw error;
      }
    })();
    this.running = work;
    try {
      await work;
    } catch (error) {
      this.retry();
      throw error;
    } finally {
      this.running = null;
    }
    if (this.pending.size || this.metaChanged) await this.flush();
  }

  private retry(): void {
    if (this.disposed || this.closed) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => { this.timer = null; void this.flush().catch(() => {}); }, Math.max(this.delay, 5000));
  }

  /** Stops the timers and the page's updates (the page is gone); what is still pending is sent once more, without waiting. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (this.pending.size || this.metaChanged) void this.flush().catch(() => {});
  }
}

/**
 * The cost that goes with an item's count: the one just typed (null: it was cleared, so none), or, when no cost was
 * typed, the one kept for the item.
 */
export function costFor(costs: ReadonlyMap<string, number>, itemId: string, typed?: number | null): number | undefined {
  if (typed === undefined) return costs.get(itemId);
  return typed ?? undefined;
}

/** "Make draft" with nothing counted and not "count all": there is nothing to finish, so no count is started for it. */
export function nothingToCount(full: boolean, counted: ReadonlyMap<string, number>): boolean {
  return !full && counted.size === 0;
}

interface GuardDeps {
  window?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'confirm'>;
  ask?: (q: string) => boolean;
  hold?: typeof holdRoute;
}

/**
 * While `dirty()` says so: the browser's own question before the window is closed or reloaded, and a question before
 * going to another page of the app (the router's hold, which puts the address back when the person stays).
 */
export function useLeaveGuard(dirty: () => boolean, question: string, deps: GuardDeps = {}): void {
  useEffect(() => leaveGuard(dirty, question, deps), [question]);
}

export function leaveGuard(dirty: () => boolean, question: string, deps: GuardDeps = {}): () => void {
  const w = deps.window ?? window;
  const ask = deps.ask ?? ((q: string) => w.confirm(q));
  const hold = deps.hold ?? holdRoute;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!dirty()) return;
    e.preventDefault();
    // older browsers show their own text only when this is set
    e.returnValue = '';
  };
  w.addEventListener('beforeunload', onBeforeUnload);
  hold(() => !dirty() || ask(question));
  return () => {
    w.removeEventListener('beforeunload', onBeforeUnload);
    hold(null);
  };
}

/** The counts and costs of a saved session, as the page keeps them. */
export function fromSession(session: CountSessionView): { counted: Map<string, number>; costs: Map<string, number>; frozen: Map<string, number> } {
  const counted = new Map<string, number>();
  const costs = new Map<string, number>();
  const frozen = new Map<string, number>();
  for (const l of session.lines) {
    counted.set(l.itemId, l.countedMilli);
    frozen.set(l.itemId, l.bookMilli);
    if (l.unitCost !== null) costs.set(l.itemId, l.unitCost);
  }
  return { counted, costs, frozen };
}
