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
  // what came in and isn't parsed yet: kept as the chunks that arrived (`parts`, `have` bytes in all), joined only once
  // there is enough for the next step (`need` bytes: a frame's header, or its whole frame), so a frame that trickles in
  // a few bytes at a time is copied once, not once per chunk
  let parts: Buffer[] = head.length ? [Buffer.from(head)] : [];
  let have = head.length;
  let need = 2;
  // a close frame went out (nothing else may follow it), the other side's stream ended
  let closing = false;
  let ended = false;
  let heard = Date.now();
  // the reader is behind (backpressure): this side stopped reading the socket, so silence from it isn't the peer's
  let held = false;
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
      // reading again after a hold: the other side gets a fresh dead-time window (its pongs waited in the socket too)
      if (held) {
        held = false;
        heard = Date.now();
      }
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

  /** Parses every whole frame at the start of `input`; gives back what is left, and sets `need` for the next step. */
  const parse = (input: Buffer): Buffer => {
    const none = Buffer.alloc(0);
    let buffer = input;
    while (!ended) {
      need = 2;
      if (buffer.length < 2) return buffer;
      const b0 = buffer[0]!;
      const b1 = buffer[1]!;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      // a client's frames are masked, a server's aren't; no extensions were agreed
      if ((b0 & 0x70) !== 0 || masked === client) { fail(1002); return none; }
      // a control frame (close, ping, pong) is never split into fragments
      if (opcode >= 8 && (b0 & 0x80) === 0) { fail(1002); return none; }
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        need = 4;
        if (buffer.length < 4) return buffer;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        need = 10;
        if (buffer.length < 10) return buffer;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(maxFrame)) { fail(1009); return none; }
        len = Number(big);
        offset = 10;
      }
      if (len > maxFrame) { fail(1009); return none; }
      const start = offset + (masked ? 4 : 0);
      need = start + len;
      if (buffer.length < need) return buffer;
      const payload = Buffer.from(buffer.subarray(start, start + len));
      if (masked) {
        const m = buffer.subarray(offset, offset + 4);
        for (let i = 0; i < len; i++) payload[i] = payload[i]! ^ m[i & 3]!;
      }
      buffer = buffer.subarray(start + len);
      if (opcode === 2 || opcode === 0) {
        if (len && !stream.push(payload)) {
          held = true;
          raw.pause();
        }
      } else if (opcode === 9) {
        if (len > 125) { fail(1002); return none; }
        if (!closing && !raw.destroyed) raw.write(frame(10, payload));
      } else if (opcode === 10) {
        // the answer to a ping: hearing it is enough
      } else if (opcode === 8) {
        sendClose(1000);
        ended = true;
        stream.push(null);
        return none;
      } else {
        // text or anything else: not this stream
        fail(1003);
        return none;
      }
    }
    return none;
  };

  /** Joins what came in once there is enough of it for the next step, and parses it. */
  const take = (): void => {
    if (ended || have < need) return;
    const joined = parts.length === 1 ? parts[0]! : Buffer.concat(parts, have);
    const rest = parse(joined);
    // the start of the next frame is copied out, so a small tail doesn't keep the whole joined buffer alive
    parts = rest.length ? [Buffer.from(rest)] : [];
    have = rest.length;
  };

  raw.on('data', (chunk: Buffer) => {
    heard = Date.now();
    if (ended) return;
    parts.push(chunk);
    have += chunk.length;
    take();
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
      // (while this side holds the socket for a slow reader, the other side's pongs wait in it unread: not silence. A
      // peer that is really gone is still found: by its own side's timer, the relay's idle time, a failed write)
      if (!held && Date.now() - heard > deadMs) return void stream.destroy();
      if (!closing && !raw.destroyed) raw.write(frame(9, Buffer.alloc(0)));
    }, pingMs);
    timer.unref();
  }
  if (have) take();
  return stream;
}
