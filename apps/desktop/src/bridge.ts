/**
 * The link between the window process (Electron's main process) and the server process (an Electron utilityProcess
 * that runs the API server, the company database and the Pro module). Plain messages both ways:
 *
 *   { kind: 'call',   id, method, args }            ask the other side to do something
 *   { kind: 'result', id, ok: true,  value }         … its answer
 *   { kind: 'result', id, ok: false, error: { code, message } }
 *   { kind: 'event',  name, data }                   a one-way notice (the server is ready, it is stopping …)
 *
 * Both sides use the same class over whatever carries messages (process.parentPort in the server process, the
 * UtilityProcess object in the main process, a MessageChannel in tests), so it needs nothing from Electron.
 */

export interface Carrier {
  postMessage(message: unknown): void;
  /** Starts listening; the function gets each message's data. */
  listen(onMessage: (data: unknown) => void): void;
}

export type Handler = (...args: never[]) => unknown;

export interface CallMessage { kind: 'call'; id: number; method: string; args: unknown[] }
export interface ResultMessage { kind: 'result'; id: number; ok: boolean; value?: unknown; error?: { code: string; message: string } }
export interface EventMessage { kind: 'event'; name: string; data?: unknown }
export type BridgeMessage = CallMessage | ResultMessage | EventMessage;

/** An error the other side threw, with its code kept (an AppError's code, a Node error's code, or 'error'). */
export class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

function isMessage(data: unknown): data is BridgeMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as { kind?: unknown; id?: unknown; method?: unknown; name?: unknown };
  if (m.kind === 'call') return typeof m.id === 'number' && typeof m.method === 'string';
  if (m.kind === 'result') return typeof m.id === 'number';
  if (m.kind === 'event') return typeof m.name === 'string';
  return false;
}

function errorOf(error: unknown): { code: string; message: string } {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = e && typeof e.code === 'string' ? e.code : 'error';
  const message = e && typeof e.message === 'string' ? e.message : String(error);
  return { code, message };
}

export class Bridge {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> | null }>();
  private readonly handlers = new Map<string, Handler>();
  private readonly listeners = new Map<string, ((data: unknown) => void)[]>();
  private closed = false;

  constructor(private readonly carrier: Carrier, private readonly options: { timeoutMs?: number } = {}) {
    carrier.listen((data) => this.receive(data));
  }

  /** What the other side may ask of this one. */
  handle(method: string, handler: Handler): this {
    this.handlers.set(method, handler);
    return this;
  }

  on(name: string, listener: (data: unknown) => void): this {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    return this;
  }

  emit(name: string, data?: unknown): void {
    if (!this.closed) this.carrier.postMessage({ kind: 'event', name, data } satisfies EventMessage);
  }

  /**
   * Asks the other side; rejects with a BridgeError on its error, on a timeout (code 'bridge_timeout') or when the
   * bridge is closed. A call that waits on a person (a folder picker) passes timeoutMs: 0 for no timeout.
   */
  call<T = unknown>(method: string, args: unknown[] = [], options: { timeoutMs?: number } = {}): Promise<T> {
    if (this.closed) return Promise.reject(new BridgeError('bridge_closed', 'the other process has gone'));
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new BridgeError('bridge_timeout', `${method} got no answer in ${timeoutMs} ms`));
        }, timeoutMs)
        : null;
      timer?.unref?.();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.carrier.postMessage({ kind: 'call', id, method, args } satisfies CallMessage);
    });
  }

  /** The other process ended: every waiting call fails. */
  close(): void {
    this.closed = true;
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new BridgeError('bridge_closed', 'the other process has gone'));
      this.pending.delete(id);
    }
  }

  private receive(data: unknown): void {
    if (!isMessage(data)) return;
    if (data.kind === 'result') {
      const p = this.pending.get(data.id);
      if (!p) return; // timed out already
      this.pending.delete(data.id);
      if (p.timer) clearTimeout(p.timer);
      if (data.ok) p.resolve(data.value);
      else p.reject(new BridgeError(data.error?.code ?? 'error', data.error?.message ?? 'failed'));
      return;
    }
    if (data.kind === 'event') {
      for (const l of this.listeners.get(data.name) ?? []) {
        try { l(data.data); } catch { /* a listener's mistake must not stop the bridge */ }
      }
      return;
    }
    void this.answer(data);
  }

  private async answer(call: CallMessage): Promise<void> {
    const handler = this.handlers.get(call.method);
    let reply: ResultMessage;
    if (!handler) {
      reply = { kind: 'result', id: call.id, ok: false, error: { code: 'bridge_no_method', message: `no ${call.method} here` } };
    } else {
      try {
        const value = await (handler as (...a: unknown[]) => unknown)(...(Array.isArray(call.args) ? call.args : []));
        reply = { kind: 'result', id: call.id, ok: true, value };
      } catch (error) {
        reply = { kind: 'result', id: call.id, ok: false, error: errorOf(error) };
      }
    }
    if (!this.closed) this.carrier.postMessage(reply);
  }
}
