import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer, type Server } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

/**
 * Pairing an office PC with the office server (no Electron here, so it can be tested on its own).
 * The server's certificate is self-signed; what vouches for it is the pairing code shown on the server PC:
 * the first 16 hex digits of its SHA-256 fingerprint. After pairing, the full fingerprint is pinned.
 */

export const OFFICE_PORT = 47420;

/**
 * The office server this PC pairs with. Through Qasa Relay (`relay`), host and port are this PC's own tunnel
 * (127.0.0.1 and a local port chosen at start), and the server is still pinned to the same certificate.
 */
export interface Remote { host: string; port: number; fingerprint: string; relay?: { url: string; office: string } }
export type PairResult = { ok: true; remote: Remote } | { error: 'address' | 'code' | 'unreachable' | 'mismatch' | 'not_qasa' | 'offline' };

/** "192.168.1.20", "192.168.1.20:47420" or a PC name; IPv4 or a plain host name only. */
export function parseAddress(input: string): { host: string; port: number } | null {
  const m = /^\s*([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?\s*$/.exec(input);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : OFFICE_PORT;
  return port >= 1 && port <= 65535 ? { host: m[1]!.toLowerCase(), port } : null;
}

export const derFingerprint = (der: Buffer): string => createHash('sha256').update(der).digest('hex');
export const pemFingerprint = (pem: string): string => derFingerprint(Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, ''), 'base64'));

/** The certificate at the address must start with the code, and the server must answer as Qasa ERP. */
export async function pair(address: string, code: string, timeoutMs = 8000, relayBase = relayUrl()): Promise<PairResult> {
  const office = parseOfficeId(String(address).slice(0, 300));
  const target = office ? { host: '127.0.0.1', port: 0 } : parseAddress(String(address).slice(0, 300));
  if (!target) return { error: 'address' };
  const wanted = String(code).slice(0, 64).replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(wanted)) return { error: 'code' };
  let stream: Duplex | undefined;
  if (office) {
    try {
      stream = await relayStream(relayBase, office, timeoutMs);
    } catch (error) {
      return { error: error instanceof RelayError && error.code === 'office_offline' ? 'offline' : 'unreachable' };
    }
  }
  const answer = await new Promise<{ fingerprint: string; body: string } | null>((resolve) => {
    let fingerprint = '';
    let data = '';
    const options = stream
      ? { socket: stream, rejectUnauthorized: false, timeout: timeoutMs }
      : { host: target.host, port: target.port, rejectUnauthorized: false, timeout: timeoutMs };
    const socket = tlsConnect(options, () => {
      // not verified by anyone: the pairing code is what vouches for this certificate
      fingerprint = derFingerprint(socket.getPeerCertificate(true).raw);
      if (!fingerprint.startsWith(wanted)) {
        socket.destroy();
        return resolve({ fingerprint, body: '' });
      }
      socket.write(`GET /api/health HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
    });
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => { if (data.length < 65536) data += d; });
    socket.on('close', () => resolve(fingerprint ? { fingerprint, body: data } : null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => resolve(null));
  });
  if (!answer) return { error: 'unreachable' };
  if (!answer.fingerprint.startsWith(wanted)) return { error: 'mismatch' };
  try {
    const health = JSON.parse(answer.body.slice(answer.body.indexOf('\r\n\r\n') + 4)) as { app?: string };
    if (health.app !== 'qasa-erp') return { error: 'not_qasa' };
  } catch {
    return { error: 'not_qasa' };
  }
  if (office) return { ok: true, remote: { host: '127.0.0.1', port: 0, fingerprint: answer.fingerprint, relay: { url: relayBase, office } } };
  return { ok: true, remote: { ...target, fingerprint: answer.fingerprint } };
}

// ——— Qasa Relay: the office server over the internet, with no public IP (the relay only passes the TLS bytes on) ———

const RELAY_PROTOCOL = 'qasa-relay';
const OFFICE_ID = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;

declare const __QASA_RELAY_URL__: string | undefined;

/** Meroxis' relay (the release build can name another one). */
export function relayUrl(): string {
  const built = typeof __QASA_RELAY_URL__ === 'string' ? __QASA_RELAY_URL__ : '';
  return built || process.env.QASA_RELAY_URL || 'https://relay.qasaerp.com';
}

/** "ABCDE-FGH23", with or without the dash, any case; null for anything else (an address). */
export function parseOfficeId(input: string): string | null {
  const id = String(input).trim().replace(/^relay:/i, '').replace(/[\s-]/g, '').toUpperCase();
  return OFFICE_ID.test(id) ? id : null;
}

export class RelayError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** A raw stream to the office server through the relay (the TLS session then runs over it, end to end). */
export function relayStream(base: string, office: string, timeoutMs = 10_000): Promise<Duplex> {
  const url = new URL(`/v1/connect?office=${encodeURIComponent(office)}`, base);
  const make = url.protocol === 'https:' ? httpsRequest : url.protocol === 'http:' ? httpRequest : null;
  if (!make) return Promise.reject(new RelayError('bad_url'));
  return new Promise((resolve, reject) => {
    const req = make(url, { method: 'GET', headers: { Connection: 'Upgrade', Upgrade: RELAY_PROTOCOL }, timeout: timeoutMs });
    req.on('upgrade', (res: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (String(res.headers.upgrade ?? '').toLowerCase() !== RELAY_PROTOCOL) {
        socket.destroy();
        return reject(new RelayError('bad_answer'));
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.on('response', (res: IncomingMessage) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { if (body.length < 4096) body += d; });
      res.on('end', () => {
        let code = 'refused';
        try { code = String((JSON.parse(body) as { error?: unknown }).error ?? code); } catch { /* not JSON */ }
        reject(new RelayError(code));
      });
    });
    req.on('timeout', () => req.destroy(new RelayError('timeout')));
    req.on('error', (error) => reject(error instanceof RelayError ? error : new RelayError('unreachable')));
    req.end();
  });
}

/**
 * This PC's end of the tunnel: a server on 127.0.0.1 only, each connection to it carried through the relay to the office
 * server. The window loads https://127.0.0.1:<port>/ and still accepts only the paired certificate. The port is kept
 * the same across starts when it's free (the window's storage is per address).
 */
export async function startTunnel(relay: { url: string; office: string }, preferredPort = 47421): Promise<{ port: number; server: Server }> {
  const server = createServer((local) => {
    local.pause();
    relayStream(relay.url, relay.office).then((remote) => {
      remote.pipe(local);
      local.pipe(remote);
      local.resume();
      const close = () => { local.destroy(); remote.destroy(); };
      remote.on('close', close);
      local.on('close', close);
      remote.on('error', close);
      local.on('error', close);
    }, () => local.destroy());
  });
  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as { port: number }).port);
    });
  });
  let port: number;
  try {
    port = await listen(preferredPort);
  } catch {
    port = await listen(0);
  }
  return { port, server };
}
