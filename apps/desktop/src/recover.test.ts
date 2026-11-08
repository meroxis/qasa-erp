import { MessageChannel } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@qasa/server';
import { issueRecoveryCode, login, resetLoginThrottle, setPassword, setSignInRequired } from '../../../packages/server/src/auth.ts';
import { Bridge, type Carrier } from './bridge.ts';
import { handleRecoverRequest, parseRecoverRequest, recoverableAdmins } from './recover.ts';
import { serve } from './server-process.ts';
import { confirmWithHello, HELLO_SCRIPT, parseHelloOutput, resetWithWindows, windowsAccount, type HelloResult } from './windows-confirm.ts';

let db: Db;
let code: string;
const owner = () => (db.prepare('SELECT id, name, username FROM users ORDER BY created_at').get() as { id: string; name: string; username: string });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  await setPassword(db, owner().id, 'owner-pass-1', 'Mer');
  const actor = { id: owner().id, name: 'Mer', username: owner().username, roles: ['admin' as const], permissions: ['admin' as const] };
  setSignInRequired(db, true, actor);
  code = await issueRecoveryCode(db, 'Mer');
});

describe('File → Reset admin password (server process side)', () => {
  it('resets with the recovery code and gives the new one back, once', async () => {
    const answer = await handleRecoverRequest(db, { mode: 'code', username: owner().username, code, password: 'new-pass-22', windowsUser: 'OFFICE\\Las' });
    expect(answer).toMatchObject({ ok: true });
    expect((answer as { recoveryCode: string }).recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
    await expect(login(db, owner().username, 'new-pass-22')).resolves.toBeTruthy();
    // used up
    expect(await handleRecoverRequest(db, { mode: 'code', username: owner().username, code, password: 'again-pass-3', windowsUser: 'OFFICE\\Las' }))
      .toEqual({ ok: false, error: 'recovery_failed' });
  });

  it('resets as the Windows user on this PC, and says plainly what went wrong otherwise', async () => {
    expect(await handleRecoverRequest(db, { mode: 'windows', username: owner().username, password: 'win-pass-33', windowsUser: 'OFFICE\\Raz', computer: 'OFFICE', method: 'windows_hello' }))
      .toEqual({ ok: true });
    await expect(login(db, owner().username, 'win-pass-33')).resolves.toBeTruthy();
    expect(await handleRecoverRequest(db, { mode: 'windows', username: 'nobody', password: 'win-pass-33', windowsUser: 'x', computer: 'y', method: 'windows_hello' }))
      .toEqual({ ok: false, error: 'not_admin' });
    expect(await handleRecoverRequest(db, { mode: 'windows', username: owner().username, password: 'short', windowsUser: 'x', computer: 'y', method: 'windows_hello' }))
      .toEqual({ ok: false, error: 'password_short' });
    expect(await handleRecoverRequest(null, { mode: 'code' })).toEqual({ ok: false, error: 'not_ready' });
    expect(recoverableAdmins(db)).toEqual([owner().username]);
    expect(recoverableAdmins(null)).toEqual([]);
  });

  it('takes nothing it does not expect: no other mode, no missing or oversized field, no unknown confirmation', () => {
    const ok = { mode: 'windows', username: 'admin', password: 'win-pass-33', windowsUser: 'PC\\Mer', computer: 'PC', method: 'windows_hello' };
    expect(parseRecoverRequest(ok)).toEqual(ok);
    expect(parseRecoverRequest({ ...ok, mode: 'trust_me' })).toBeNull();
    expect(parseRecoverRequest({ ...ok, method: 'none' })).toBeNull();
    // a one-click Windows dialog is no confirmation: only Windows Hello is taken
    expect(parseRecoverRequest({ ...ok, method: 'windows_confirm' })).toBeNull();
    expect(parseRecoverRequest({ mode: 'windows_unconfirmed', username: 'admin', windowsUser: 'PC\\Mer', computer: 'PC', outcome: 'pass' })).toBeNull();
    expect(parseRecoverRequest({ ...ok, password: 'x'.repeat(201) })).toBeNull();
    expect(parseRecoverRequest({ ...ok, windowsUser: '' })).toBeNull();
    expect(parseRecoverRequest({ mode: 'code', username: 'admin', password: 'p-123456', windowsUser: 'PC\\Mer' })).toBeNull();
    expect(parseRecoverRequest(null)).toBeNull();
    expect(parseRecoverRequest('admin')).toBeNull();
  });

  it('refuses a reset Windows Hello did not confirm, and writes the try to the audit log', async () => {
    const admin = owner().username;
    expect(await handleRecoverRequest(db, { mode: 'windows', username: admin, password: 'win-pass-33', windowsUser: 'OFFICE\\Las', computer: 'OFFICE', method: 'windows_confirm' }))
      .toEqual({ ok: false, error: 'invalid' });
    expect(await handleRecoverRequest(db, { mode: 'windows_unconfirmed', username: admin, windowsUser: 'OFFICE\\Las', computer: 'OFFICE', outcome: 'hello_unavailable' }))
      .toEqual({ ok: false, error: 'hello_unavailable' });
    await expect(login(db, admin, 'owner-pass-1')).resolves.toBeTruthy();
    const rows = db.prepare("SELECT user, details FROM audit_log WHERE action = 'recovery_failed' ORDER BY id").all() as { user: string; details: string }[];
    expect(rows.map((r) => [r.user, JSON.parse(r.details).outcome])).toEqual([['Windows: OFFICE\\Las', 'hello_unavailable']]);
  });

  it('is reachable over the bridge from the main process (no HTTP route takes it)', async () => {
    const ch = new MessageChannel();
    const carrier = (port: MessageChannel['port1']): Carrier => ({ postMessage: (m) => port.postMessage(m), listen: (fn) => port.on('message', fn) });
    serve(carrier(ch.port2));
    const main = new Bridge(carrier(ch.port1));
    try {
      // before the server has opened a company there is nothing to reset
      expect(await main.call('recoverAdmins', [])).toEqual([]);
      expect(await main.call('recoverAdmin', [{ mode: 'code', username: 'admin', code, password: 'new-pass-22', windowsUser: 'PC\\Mer' }])).toEqual({ ok: false, error: 'not_ready' });
    } finally {
      ch.port1.close();
      ch.port2.close();
    }
  });
});

describe('confirming with Windows (main process side)', () => {
  it('passes only when Windows Hello says Verified', () => {
    expect(parseHelloOutput('result:Verified\r\n')).toEqual({ kind: 'verified' });
    expect(parseHelloOutput('result:Canceled')).toEqual({ kind: 'cancelled' });
    expect(parseHelloOutput('unavailable:DeviceNotPresent')).toEqual({ kind: 'unavailable', why: 'DeviceNotPresent' });
    expect(parseHelloOutput('unavailable:NotConfiguredForUser')).toEqual({ kind: 'unavailable', why: 'NotConfiguredForUser' });
    expect(parseHelloOutput('result:RetriesExhausted')).toEqual({ kind: 'failed', why: 'RetriesExhausted' });
    expect(parseHelloOutput('')).toEqual({ kind: 'failed', why: 'no_answer' });
    expect(parseHelloOutput('Verified')).toMatchObject({ kind: 'failed' });
    expect(parseHelloOutput('result:Verified extra')).toMatchObject({ kind: 'failed' });
  });

  it('hands the message to the script in the environment, never inside its text, and never throws', async () => {
    const seen: { script: string; env: Record<string, string> }[] = [];
    const message = "Mer'; Remove-Item C:\\ -Recurse; '";
    const result = await confirmWithHello(message, async (script, env) => { seen.push({ script, env }); return 'result:Verified'; });
    expect(result).toEqual({ kind: 'verified' });
    expect(seen[0]!.script).toBe(HELLO_SCRIPT);
    expect(seen[0]!.script).not.toContain('Mer');
    expect(seen[0]!.env.QASA_HELLO_MESSAGE).toBe(message);
    expect(await confirmWithHello('x', async () => { throw new Error('powershell.exe not found'); })).toMatchObject({ kind: 'failed' });
  });

  it('resets only when Windows Hello says Verified: without Hello there is no one-click way, and every try is reported', async () => {
    const input = { username: 'admin', password: 'win-pass-33', windowsUser: 'OFFICE\\Las', computer: 'OFFICE' };
    const run = async (hello: HelloResult) => {
      const asked: Record<string, unknown>[] = [];
      const answer = await resetWithWindows(input, async () => hello, async (request) => {
        asked.push(request);
        return request.mode === 'windows' ? { ok: true } : { ok: false, error: String(request.outcome) };
      });
      return { answer, asked };
    };
    const verified = await run({ kind: 'verified' });
    expect(verified.answer).toEqual({ ok: true });
    expect(verified.asked).toEqual([{ mode: 'windows', ...input, method: 'windows_hello' }]);
    // Windows Hello not set up here: no reset (the recovery code is the way), but the server writes the try down
    const none = await run({ kind: 'unavailable', why: 'NotConfiguredForUser' });
    expect(none.answer).toEqual({ ok: false, error: 'hello_unavailable' });
    expect(none.asked).toEqual([{ mode: 'windows_unconfirmed', username: 'admin', windowsUser: 'OFFICE\\Las', computer: 'OFFICE', outcome: 'hello_unavailable' }]);
    expect(JSON.stringify(none.asked)).not.toContain('win-pass-33');
    expect((await run({ kind: 'cancelled' })).asked[0]).toMatchObject({ mode: 'windows_unconfirmed', outcome: 'cancelled' });
    expect((await run({ kind: 'failed', why: 'RetriesExhausted' })).answer).toEqual({ ok: false, error: 'windows_failed' });
    // the audit can't be written (the server process is gone): still no reset
    expect(await resetWithWindows(input, async () => ({ kind: 'unavailable', why: 'x' }), async () => { throw new Error('gone'); }))
      .toEqual({ ok: false, error: 'hello_unavailable' });
  });

  it('names the Windows user as DOMAIN\\name', () => {
    expect(windowsAccount({ USERNAME: 'Las', USERDOMAIN: 'OFFICE' }, 'ignored', 'PC')).toBe('OFFICE\\Las');
    expect(windowsAccount({}, 'Raz', 'PC-2')).toBe('PC-2\\Raz');
    expect(windowsAccount({}, '', '')).toBe('unknown');
  });
});

describe('the reset window', () => {
  const page = readFileSync(new URL('./recover.html', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('./recover-preload.ts', import.meta.url), 'utf8');

  it('runs one script, allowed by its hash, and talks to the app only through its preload', () => {
    expect(page).toContain("script-src 'sha256-{{scriptHash}}'");
    expect(page.match(/<script>/g)).toHaveLength(1);
    expect(page).not.toMatch(/innerHTML|eval\(|new Function/);
    expect(preload.match(/ipcRenderer\.(invoke|send)\('([\w:]+)'/g)!.map((s) => s.replace(/.*'([\w:]+)'/, '$1')))
      .toEqual(['recover:admins', 'recover:code', 'recover:windows', 'recover:close']);
  });

  it('has every text in Arabic, English and Kurdish', () => {
    const rows = [...page.matchAll(/^\s{4}(\w+): \[('[^']*'), ('[^']*'), ('[^']*')\],?$/gm)];
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) for (const s of r.slice(2)) expect(s.length, r[1]).toBeGreaterThan(2);
    // without Windows Hello the window says to use the recovery code
    expect(rows.map((r) => r[1])).toContain('e_hello_unavailable');
  });
});

afterAll(() => db?.close());
