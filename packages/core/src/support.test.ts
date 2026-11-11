import { describe, expect, it } from 'vitest';
import { buildSupportDetails, scrubSupportText, windowsName } from './support.ts';

// Made-up secrets of every kind the details must never carry, put into every input that takes text.
const SECRETS = {
  password: 'Hunter2-Mer-pass!',
  licenceKey: 'QASA1.eyJwbGFuIjoicHJvIiwiaWQiOiJMLTEyMzQ1In0.c2lnbmF0dXJlLWJ5dGVzLWhlcmU',
  activationToken: 'act_9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  officeSecret: 'b7f3c2d1e0a9f8e7d6c5b4a3f2e1d0c9',
  relaySecret: 'R3layS3cretK3yForTheOffice2026xyz',
  pairingCode: '4e1a9c0b7d2f4a6e8b3c5d7f9a1b3c5d',
  officeId: 'K7M2P9Q4RT',
  sessionKey: 'f'.repeat(64),
  phone: '07501234567',
  ipv4: '192.168.1.20',
  ipv6: 'fe80::1c2b:3a4d:5e6f:7a8b',
  email: 'mer@example.com',
  userName: 'Las',
  pcName: 'RAZ-DESKTOP'
};

const LOG = [
  `2026-11-11T09:30:00.000Z start failed: Error: SQLITE_CANTOPEN C:\\Users\\${SECRETS.userName}\\AppData\\Roaming\\Qasa ERP\\data\\qasa.sqlite`,
  `2026-11-11T09:31:00.000Z could not open https://my.qasaerp.com/activate?token=${SECRETS.activationToken}&key=${SECRETS.licenceKey}`,
  `2026-11-11T09:32:00.000Z pairing failed: code=${SECRETS.pairingCode} password: "${SECRETS.password}" secret=${SECRETS.officeSecret}`,
  `2026-11-11T09:33:00.000Z office server did not load: ${SECRETS.ipv4}:47420 and [${SECRETS.ipv6}] from ${SECRETS.pcName}`,
  `2026-11-11T09:34:00.000Z Qasa Relay tunnel to office ${SECRETS.officeId} refused (relay ${SECRETS.relaySecret}) session ${SECRETS.sessionKey}`,
  `2026-11-11T09:35:00.000Z error sending a reminder to ${SECRETS.phone} and ${SECRETS.email} for C:/Users/${SECRETS.userName}/Desktop/customers.xlsx`
];

describe('Copy support details', () => {
  it('never carries a password, key, token, secret, code, phone, e-mail, IP, user or PC name placed in its inputs', () => {
    const text = buildSupportDetails(
      {
        version: '1.2.0', edition: 'installer', plan: { plan: 'pro', trial: false }, windows: '10.0.26100', lang: 'ku',
        role: 'server', outboxWaiting: 3, schema: 12, schemaApp: 12, logLines: LOG
      },
      { homeDir: `C:\\Users\\${SECRETS.userName}`, names: [SECRETS.userName, SECRETS.pcName], secrets: [SECRETS.sessionKey] }
    );
    // (the short names as words: "Las" is also the start of "Last errors")
    for (const [what, secret] of Object.entries(SECRETS)) {
      if (secret.length > 3) expect(text, what).not.toContain(secret);
      else expect(text, what).not.toMatch(new RegExp(`\\b${secret}\\b`, 'i'));
    }
    // nor the parts of them a looser check could leave
    expect(text).not.toMatch(/Users[\\/]/);
    expect(text).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(text).not.toMatch(/\d{6,}/);
    expect(text).toContain('%USERPROFILE%');
    expect(text).toContain('Version: 1.2.0');
    expect(text).toContain('Edition: Windows app (installer from qasaerp.com)');
    expect(text).toContain('Plan: Pro');
    expect(text).toContain('Windows: Windows 11 (10.0.26100)');
    expect(text).toContain('Language: Kurdish');
    expect(text).toContain('This PC: Office server');
    expect(text).toContain('Outbox: 3 waiting to send');
    expect(text).toContain('Company file schema: 12');
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5);
  });

  it('hides the user folder even without being told it, and a user name with a space', () => {
    expect(scrubSupportText('could not write C:\\Users\\Mer Las\\Documents\\x.txt', { names: ['Mer Las'] })).not.toMatch(/Mer|Las/);
    expect(scrubSupportText('d:/users/raz/AppData/x')).toBe('%USERPROFILE%/AppData/x');
    expect(scrubSupportText('copy to \\\\FILESERVER\\share\\books')).not.toContain('FILESERVER');
  });

  it('keeps what support needs: times, versions, short numbers and plain words', () => {
    const line = '2026-11-11T09:30:00.000Z graphics process ended (crashed, 3) in 1.2.0 on 10.0.26100';
    expect(scrubSupportText(line)).toBe(line);
  });

  it('trusts only the facts that look like what they are', () => {
    const text = buildSupportDetails({
      version: 'x; password=1', edition: 'browser', plan: { plan: 'Pro <script>', trial: true }, windows: 'C:\\Users\\Mer', lang: 'xx',
      role: null, outboxWaiting: -1, schema: Number.NaN, logLines: null
    });
    expect(text).toBe(['Qasa ERP support details', 'Version: unknown', 'Edition: In a browser', 'Plan: unknown', 'Language: unknown'].join('\n'));
    expect(buildSupportDetails({ version: '1.2.0', edition: 'demo', plan: { plan: 'free', trial: true }, lang: 'ar' })).toContain('Plan: Free (free month)');
  });

  it('names Windows 10 and 11 by their build', () => {
    expect(windowsName('10.0.19045')).toBe('Windows 10 (10.0.19045)');
    expect(windowsName('10.0.22631')).toBe('Windows 11 (10.0.22631)');
    expect(windowsName('anything')).toBeNull();
  });
});
