import { decodePairingCode, type PairingCode } from './protocol';

/**
 * The QR code from Settings → Phones on the office PC, checked before the phone uses anything in it: the office's
 * addresses on the Wi-Fi (plain IPv4 addresses or names, at most 8), the phone link's port, the office's Qasa Relay ID,
 * the one-time pairing id and secret. The office's public key in it is what the phone trusts from then on (it is
 * pinned: a later connection that can't prove that key is refused, on the Wi-Fi and through the relay alike).
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
/** Qasa Relay office IDs: 10 of these characters, shown as ABCDE-FGH23 (pro/src/relay-client.ts). */
const RELAY_ID = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-?[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
const PAIRING_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const validAddress = (a: string) => IPV4.test(a) || (HOST.test(a) && !/^\d+(\.\d+)*$/.test(a));

/** The QR code's text as a pairing code the phone may use, or null (not a Qasa code, or something in it is wrong). */
export function readPairingCode(text: string): PairingCode | null {
  const code = decodePairingCode(text.trim());
  if (!code) return null;
  const relay = code.relay === null ? null : code.relay.toUpperCase();
  if (relay !== null && !RELAY_ID.test(relay)) return null;
  if (!Number.isInteger(code.port) || code.port < 1 || code.port > 65535) return null;
  if (!code.addresses.every(validAddress)) return null;
  if (!code.addresses.length && !relay) return null;
  if (!PAIRING_ID.test(code.pairingId) || code.pairingSecret.length !== 32) return null;
  return { ...code, relay, company: code.company.slice(0, 200) };
}
