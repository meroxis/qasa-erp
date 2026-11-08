import { createHash, randomBytes } from 'node:crypto';
import { Duplex } from 'node:stream';

/**
 * A WebSocket (RFC 6455) connection used as a plain byte stream: what Qasa Relay's connections are carried in, so they
 * pass through proxies that carry WebSocket upgrades only (Cloudflare). Every frame sent is binary; what arrives in
 * binary frames is simply the next bytes of the stream. What runs inside (the office's TLS session, pinned to its
 * pairing certificate) is end to end as before: this layer only frames bytes.
 *
 * The same file is apps/desktop/src/ws-stream.ts and pro/relay/ws-stream.ts (relay.test.ts checks they match): the
 * relay is deployed from relay/ alone, and the open-source app has no pro/. (No TypeScript parameter properties or
 * enums here: Node runs relay/ as it is.)
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const WS_KEY = /^[A-Za-z0-9+/]{22}==$/;
/** Sec-WebSocket-Accept for a Sec-WebSocket-Key. */
export const wsAccept = (key: string): string => createHash('sha1').update(key + GUID).digest('base64');
/** A new Sec-WebSocket-Key. */
export const newWsKey = (): string => randomBytes(16).toString('base64');

/** Below Cloudflare's 100 s for a quiet connection, with room for a late answer. */
export const WS_PING_MS = 30_000;

export interface WsStreamOptions {
  /** 'client' masks what it sends and wants unmasked frames back; 'server' the other way round */
  role: 'client' | 'server';
  /** a ping this often, so a proxy doesn't close a quiet connection (0: none) */
  pingMs?: number;
  /** nothing at all heard for this long: the connection is gone (default three pings) */
  deadMs?: number;
  /** the largest frame taken */
  maxFrame?: number;
}

/** What one frame carries at most when sending (a long write goes out in several). */
const SEND_CHUNK = 64 * 1024;

/** `raw` is the socket after the 101 answer, `head` what already came after it. */
export function wsStream(raw: Duplex, head: Buffer, options: WsStreamOptions): Duplex {
  const client = options.role === 'client';
  const maxFrame = options.maxFrame ?? 1024 * 1024;
  let buffer: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0);
  // a close frame went out (nothing else may follow it), the other side's stream ended
  let closing = false;
  let ended = false;
  let heard = Date.now();
  let timer: NodeJS.Timeout | null = null;

  const frame = (opcode: number, payload: Buffer): Buffer => {
    const len = payload.length;
    const size = len < 126 ? 2 : len < 65536 ? 4 : 10;
    const mask = client ? randomBytes(4) : null;
    const out = Buffer.allocUnsafe(size + (mask ? 4 : 0) + len);
    out[0] = 0x80 | opcode;
    if (len < 126) out[1] = len;
    else if (len < 65536) { out[1] = 126; out.writeUInt16BE(len, 2); }
    else { out[1] = 127; out.writeBigUInt64BE(BigInt(len), 2); }
    if (mask) {
      out[1] = out[1]! | 0x80;
      mask.copy(out, size);
      for (let i = 0; i < len; i++) out[size + 4 + i] = payload[i]! ^ mask[i & 3]!;
    } else {
      payload.copy(out, size);
    }
    return out;
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const sendClose = (code: number) => {
    if (closing) return;
    closing = true;
    if (!raw.destroyed && raw.writable) {
      raw.write(frame(8, Buffer.from([code >> 8, code & 255])));
      raw.end();
    }
  };

  const stream = new Duplex({
    allowHalfOpen: false,
    read() {
      raw.resume();
    },
    write(chunk: Buffer, _encoding, done) {
      // after a close nothing more goes out (the other side stops reading at the close frame)
      if (closing || raw.destroyed) return done();
      let ok = true;
      for (let at = 0; at < chunk.length; at += SEND_CHUNK) ok = raw.write(frame(2, chunk.subarray(at, at + SEND_CHUNK)));
      if (ok) done();
      else raw.once('drain', () => done());
    },
    final(done) {
      sendClose(1000);
      done();
    },
    destroy(error, done) {
      stop();
      if (error) raw.destroy();
      else {
        // a clean end: what was written still goes out, then the close frame
        sendClose(1000);
        setTimeout(() => raw.destroy(), 5000).unref();
      }
      done(error);
    }
  });

  const fail = (code: number) => {
    sendClose(code);
    ended = true;
    stream.destroy();
  };

  const parse = (): void => {
    while (!ended && buffer.length >= 2) {
      const b0 = buffer[0]!;
      const b1 = buffer[1]!;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      // a client's frames are masked, a server's aren't; no extensions were agreed
      if ((b0 & 0x70) !== 0 || masked === client) return fail(1002);
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(maxFrame)) return fail(1009);
        len = Number(big);
        offset = 10;
      }
      if (len > maxFrame) return fail(1009);
      const start = offset + (masked ? 4 : 0);
      if (buffer.length < start + len) return;
      const payload = Buffer.from(buffer.subarray(start, start + len));
      if (masked) {
        const m = buffer.subarray(offset, offset + 4);
        for (let i = 0; i < len; i++) payload[i] = payload[i]! ^ m[i & 3]!;
      }
      buffer = buffer.subarray(start + len);
      if (opcode === 2 || opcode === 0) {
        if (len && !stream.push(payload)) raw.pause();
      } else if (opcode === 9) {
        if (len > 125) return fail(1002);
        if (!closing && !raw.destroyed) raw.write(frame(10, payload));
      } else if (opcode === 10) {
        // the answer to a ping: hearing it is enough
      } else if (opcode === 8) {
        sendClose(1000);
        ended = true;
        stream.push(null);
        return;
      } else {
        // text or anything else: not this stream
        return fail(1003);
      }
    }
  };

  raw.on('data', (chunk: Buffer) => {
    heard = Date.now();
    if (ended) return;
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    parse();
  });
  raw.on('end', () => {
    if (ended) return;
    ended = true;
    stream.push(null);
  });
  raw.on('error', () => stream.destroy());
  raw.on('close', () => {
    stop();
    stream.destroy();
  });

  const pingMs = options.pingMs ?? 0;
  if (pingMs > 0) {
    const deadMs = options.deadMs ?? pingMs * 3;
    timer = setInterval(() => {
      if (Date.now() - heard > deadMs) return void stream.destroy();
      if (!closing && !raw.destroyed) raw.write(frame(9, Buffer.alloc(0)));
    }, pingMs);
    timer.unref();
  }
  if (buffer.length) parse();
  return stream;
}
