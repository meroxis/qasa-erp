import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CountSaver, costFor, fromSession, leaveGuard, nothingToCount, type CountChange, type CountSessionView, type SaveState } from './count-session.ts';
import { guardHashChange, holdRoute } from '../router.ts';

const session = (id: string, lines: CountSessionView['lines'] = []): CountSessionView => ({
  id, warehouseId: 'w1', date: '2026-11-09', notes: '', full: false, status: 'open', adjustmentId: null,
  createdBy: 'Mer', updatedBy: 'Mer', updatedAt: '2026-11-09T10:00:00Z', lines
});

/** Timers run by hand: `tick()` fires what is due. */
function manualTimers() {
  let queue: { fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    set: (fn: () => void) => { const id = next++; queue.push({ fn, id }); return id; },
    clear: (id: unknown) => { queue = queue.filter((q) => q.id !== id); },
    tick: async () => { const due = queue; queue = []; for (const q of due) q.fn(); await new Promise((r) => setTimeout(r, 0)); },
    get pending() { return queue.length; }
  };
}

function saverWith(api: { start?: () => Promise<CountSessionView>; save?: (id: string, body: { counts: CountChange[] }) => Promise<CountSessionView> }, sessionId: string | null = null) {
  const timers = manualTimers();
  const states: SaveState[] = [];
  const saved: CountSessionView[] = [];
  const start = vi.fn(api.start ?? (async () => session('s1')));
  const save = vi.fn(api.save ?? (async (id: string) => session(id)));
  const saver = new CountSaver({ start, save }, 'w1', { date: '2026-11-09', notes: '', full: false },
    { saved: (s) => saved.push(s), state: (s) => states.push(s) }, sessionId, 800, timers);
  return { saver, timers, states, saved, start, save };
}

describe('the count saved as it is typed', () => {
  it('waits for a quiet moment, then sends only what changed, in one request', async () => {
    const { saver, timers, start, save, states } = saverWith({});
    saver.setCount('pipe', 1000);
    saver.setCount('pipe', 2000);
    saver.setCount('cable', 5000);
    expect(saver.dirty).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await timers.tick();
    expect(start).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1].counts).toEqual([{ itemId: 'pipe', countedMilli: 2000 }, { itemId: 'cable', countedMilli: 5000 }]);
    expect(saver.dirty).toBe(false);
    expect(states.at(-1)).toBe('saved');
    // the session is made once, then reused
    saver.setCount('pipe', null);
    await timers.tick();
    expect(start).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[1]).toEqual(['s1', expect.objectContaining({ counts: [{ itemId: 'pipe', countedMilli: null }] })]);
  });

  it('keeps what failed to save and tries again, so nothing typed is lost', async () => {
    let fail = true;
    const { saver, timers, save, states } = saverWith({ save: async (id) => { if (fail) throw new Error('offline'); return session(id); } }, 's9');
    saver.setCount('pipe', 3000);
    await timers.tick();
    expect(states.at(-1)).toBe('error');
    expect(saver.dirty).toBe(true);
    // typed while offline: sent together with what failed
    saver.setCount('cable', 1000);
    fail = false;
    await timers.tick();
    expect(save.mock.calls.at(-1)![1].counts).toEqual([{ itemId: 'pipe', countedMilli: 3000 }, { itemId: 'cable', countedMilli: 1000 }]);
    expect(saver.dirty).toBe(false);
    expect(states.at(-1)).toBe('saved');
  });

  it('flush sends at once and waits (finishing the count); the meta goes with it', async () => {
    const { saver, save, timers } = saverWith({}, 's2');
    saver.setMeta({ notes: 'Shelf B', full: true });
    await saver.flush();
    expect(save).toHaveBeenCalledWith('s2', { date: '2026-11-09', notes: 'Shelf B', full: true, counts: [] });
    expect(timers.pending).toBe(0);
    expect(saver.dirty).toBe(false);
  });

  it('sends a surplus cost only with a count', () => {
    const { saver } = saverWith({}, 's3');
    saver.setCount('pipe', 4000, 21_000);
    saver.setCount('cable', null, 9_000);
    expect((saver as unknown as { pending: Map<string, CountChange> }).pending.get('pipe')).toEqual({ itemId: 'pipe', countedMilli: 4000, unitCost: 21_000 });
    expect((saver as unknown as { pending: Map<string, CountChange> }).pending.get('cable')).toEqual({ itemId: 'cable', countedMilli: null });
  });

  it('tries nothing again once disposed, and tells the old page nothing more', async () => {
    const { saver, timers, save, states, saved } = saverWith({ save: async () => { throw new Error('offline'); } }, 's5');
    saver.setCount('pipe', 3000);
    await timers.tick();
    expect(states.at(-1)).toBe('error');
    // the page is left (or another warehouse is counted): one last try, then nothing
    const heard = states.length;
    saver.dispose();
    await new Promise((r) => setTimeout(r, 0));
    const tries = save.mock.calls.length;
    expect(timers.pending).toBe(0);
    await timers.tick();
    await timers.tick();
    expect(save.mock.calls.length).toBe(tries);
    expect(states.length).toBe(heard);
    expect(saved).toEqual([]);
    // and nothing typed after it starts again
    saver.setCount('cable', 1000);
    expect(timers.pending).toBe(0);
  });

  it('a count finished or discarded on another PC: drops what is pending, is clean, says so, and tries nothing again', async () => {
    const conflict = Object.assign(new Error('action_not_allowed'), { status: 409, code: 'action_not_allowed' });
    const timers = manualTimers();
    const states: SaveState[] = [];
    const closed = vi.fn();
    const save = vi.fn(async () => { throw conflict; });
    const saver = new CountSaver({ start: async () => session('s6'), save }, 'w1', { date: '2026-11-09', notes: '', full: false },
      { saved: () => {}, state: (s) => states.push(s), closed }, 's6', 800, timers);
    saver.setCount('pipe', 3000);
    saver.setMeta({ notes: 'Shelf C' });
    await expect(saver.flush()).rejects.toBe(conflict);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('closed');
    expect(saver.dirty).toBe(false);
    expect(timers.pending).toBe(0);
    await timers.tick();
    expect(save).toHaveBeenCalledTimes(1);
    // what is typed after it can't go into that count any more
    saver.setCount('cable', 1000);
    expect(saver.dirty).toBe(false);
  });

  it('counts against the book quantity frozen for its own warehouse, never another one', async () => {
    const { saver, save } = saverWith({ save: async (id) => session(id, [{ itemId: 'pipe', countedMilli: 20_000, bookMilli: 20_000, unitCost: null, countedAt: 'x' }]) }, 's7');
    saver.setCount('pipe', 20_000);
    await saver.flush();
    expect([...saver.frozen]).toEqual([['pipe', 20_000]]);
    // 5 pipes sold since: the sheet says 15, the count still measures against the 20 frozen, so 18 is no surplus
    saver.count('pipe', 18_000, 9_000, 15_000);
    await saver.flush();
    expect(save.mock.calls.at(-1)![1].counts).toEqual([{ itemId: 'pipe', countedMilli: 18_000 }]);
    // an item not counted before goes by the sheet: above it is a surplus, with its cost
    saver.count('cable', 2_000, 4_000, 0);
    await saver.flush();
    expect(save.mock.calls.at(-1)![1].counts).toEqual([{ itemId: 'cable', countedMilli: 2_000, unitCost: 4_000 }]);
    // a session of another warehouse never becomes this saver's frozen quantities
    const other = saverWith({ save: async (id) => ({ ...session(id, [{ itemId: 'pipe', countedMilli: 1, bookMilli: 99_000, unitCost: null, countedAt: 'x' }]), warehouseId: 'w2' }) }, 's8');
    other.saver.setCount('pipe', 1);
    await other.saver.flush();
    expect(other.saver.frozen.size).toBe(0);
  });

  it('"make draft" with nothing counted and not "count all" starts no count', () => {
    expect(nothingToCount(false, new Map())).toBe(true);
    expect(nothingToCount(true, new Map())).toBe(false);
    expect(nothingToCount(false, new Map([['pipe', 1000]]))).toBe(false);
  });

  it('reads a saved session back, with the frozen book quantities', () => {
    const f = fromSession(session('s4', [
      { itemId: 'pipe', countedMilli: 20_000, bookMilli: 20_000, unitCost: null, countedAt: 'x' },
      { itemId: 'cable', countedMilli: 3_000, bookMilli: 0, unitCost: 4_000, countedAt: 'y' }
    ]));
    expect([...f.counted]).toEqual([['pipe', 20_000], ['cable', 3_000]]);
    expect([...f.frozen]).toEqual([['pipe', 20_000], ['cable', 0]]);
    expect([...f.costs]).toEqual([['cable', 4_000]]);
  });
});

describe('leaving the count with unsaved changes', () => {
  function fakeWindow() {
    const listeners: { type: string; fn: (e: Event) => void }[] = [];
    const w = {
      addEventListener: (type: string, fn: (e: Event) => void) => listeners.push({ type, fn }),
      removeEventListener: (type: string, fn: (e: Event) => void) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
      confirm: () => true
    };
    return { w, listeners };
  }
  const hashEvent = () => {
    let stopped = false;
    return { e: { oldURL: 'http://127.0.0.1/#/stock-count', newURL: 'http://127.0.0.1/#/sales', stopImmediatePropagation: () => { stopped = true; } } as unknown as HashChangeEvent, stopped: () => stopped };
  };
  const history = () => {
    const replaced: string[] = [];
    return { replaced, w: { history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) } } as unknown as Pick<Window, 'history'> };
  };

  it('asks before the app goes to another page, and stays (address put back, pages never told) when the answer is no', () => {
    const { w } = fakeWindow();
    let dirty = true;
    let answer = false;
    const ask = vi.fn(() => answer);
    const stop = leaveGuard(() => dirty, 'Leave?', { window: w, ask });
    const h = history();
    const stay = hashEvent();
    expect(guardHashChange(stay.e, h.w)).toBe(false);
    expect(ask).toHaveBeenCalledWith('Leave?');
    // the router's own listener comes after this one: stopped here, it never moves the page
    expect(stay.stopped()).toBe(true);
    expect(h.replaced).toEqual(['#/stock-count']);
    answer = true;
    const go = hashEvent();
    expect(guardHashChange(go.e, h.w)).toBe(true);
    expect(go.stopped()).toBe(false);
    // nothing unsaved: no question at all
    dirty = false;
    ask.mockClear();
    expect(guardHashChange(hashEvent().e, h.w)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    // the page is gone: the hold goes with it
    dirty = true;
    stop();
    expect(guardHashChange(hashEvent().e, h.w)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks the browser to confirm closing or reloading the window while something is unsaved', () => {
    const { w, listeners } = fakeWindow();
    let dirty = true;
    const stop = leaveGuard(() => dirty, 'Leave?', { window: w, ask: () => true });
    const onUnload = listeners.find((l) => l.type === 'beforeunload')!;
    const e = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    onUnload.fn(e as unknown as Event);
    expect(e.preventDefault).toHaveBeenCalled();
    dirty = false;
    const quiet = { preventDefault: vi.fn() };
    onUnload.fn(quiet as unknown as Event);
    expect(quiet.preventDefault).not.toHaveBeenCalled();
    stop();
    expect(listeners).toHaveLength(0);
    holdRoute(null);
  });
});

describe('the stock count page', () => {
  const page = readFileSync(new URL('../pages/StockAdjustments.tsx', import.meta.url), 'utf8');

  it('hears only the current saver, so another warehouse’s quantities never show', () => {
    expect(page).toContain('saved: (s) => { if (saverRef.current === saver) setFrozen(fromSession(s).frozen); }');
    expect(page).toContain('state: (state) => { if (saverRef.current === saver) setSaveState(state); }');
    // the sheet of the warehouse being counted, never the one before it while the next loads
    expect(page).toContain('sheet.data.warehouseId === warehouseId ? sheet.data.rows : NO_ROWS');
    expect(page).toContain('saverRef.current?.count(itemId, v, cost,');
  });

  it('sends a cleared surplus cost as no cost, not the cost kept before it', () => {
    const costs = new Map([['pipe', 1_500]]);
    expect(costFor(costs, 'pipe', null)).toBeUndefined();
    expect(costFor(costs, 'pipe', 2_000)).toBe(2_000);
    expect(costFor(costs, 'pipe')).toBe(1_500);
    expect(costFor(costs, 'cable')).toBeUndefined();
    // the page passes the typed value on as it is (null included): `v ?? undefined` brought the old cost back
    expect(page).toContain('queue(itemId, counted.get(itemId) ?? null, v);');
    expect(page).toContain('const cost = costFor(costs, itemId, typedCost);');
    expect(page).not.toContain('v ?? undefined');
  });

  it('starts no count for "make draft" with nothing counted, before anything is sent', () => {
    const draft = page.slice(page.indexOf('async function makeDraft()'));
    expect(draft.indexOf('nothingToCount(full, counted)')).toBeGreaterThan(0);
    expect(draft.indexOf('nothingToCount(full, counted)')).toBeLessThan(draft.indexOf('saver.setMeta({ full })'));
  });
});
