import { createHash } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';

/**
 * Pairing an office PC with the office server (no Electron here, so it can be tested on its own).
 * The server's certificate is self-signed; what vouches for it is the pairing code shown on the server PC:
 * the first 16 hex digits of its SHA-256 fingerprint. After pairing, the full fingerprint is pinned.
 */

export const OFFICE_PORT = 47420;

export interface Remote { host: string; port: number; fingerprint: string }
export type PairResult = { ok: true; remote: Remote } | { error: 'address' | 'code' | 'unreachable' | 'mismatch' | 'not_qasa' };

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
export async function pair(address: string, code: string, timeoutMs = 8000): Promise<PairResult> {
  const target = parseAddress(String(address).slice(0, 300));
  if (!target) return { error: 'address' };
  const wanted = String(code).slice(0, 64).replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(wanted)) return { error: 'code' };
  const answer = await new Promise<{ fingerprint: string; body: string } | null>((resolve) => {
    let fingerprint = '';
    let data = '';
    const socket = tlsConnect({ host: target.host, port: target.port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
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
  return { ok: true, remote: { ...target, fingerprint: answer.fingerprint } };
}
