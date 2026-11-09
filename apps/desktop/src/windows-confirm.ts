import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

const { dirname, join } = win32;

/**
 * "Confirm with Windows" for File → Reset admin password: Windows Hello (PIN, fingerprint, face or the Windows
 * password, whatever this Windows user has set up) asks the person at this PC to prove they are the signed-in Windows
 * user. Where Hello isn't set up there is no other way to confirm (a dialog anyone at the PC can click proves
 * nothing): the reset then takes the admin recovery code only. Runs in the main process; the result only decides
 * which request the server process gets, and every try reaches its audit log.
 */

export type HelloResult =
  | { kind: 'verified' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; why: string }
  | { kind: 'failed'; why: string };

/**
 * Windows PowerShell 5.1 (on every Windows 10 and 11): WinRT's UserConsentVerifier, awaited through AsTask. The
 * message comes in through an environment variable, never inside the script text.
 */
export const HELLO_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]',
  "$asTask = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  'function Wait-Op($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }',
  '$available = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])',
  "if ([string]$available -ne 'Available') { Write-Output ('unavailable:' + $available); exit 0 }",
  '$result = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync([string]$env:QASA_HELLO_MESSAGE)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])',
  "Write-Output ('result:' + $result)"
].join('; ');

/** What the script printed, as a result. Anything unexpected is a failure, never a pass. */
export function parseHelloOutput(output: string): HelloResult {
  const line = output.trim().split(/\r?\n/).pop()?.trim() ?? '';
  if (line === 'result:Verified') return { kind: 'verified' };
  if (line === 'result:Canceled') return { kind: 'cancelled' };
  const unavailable = /^unavailable:(\w{1,40})$/.exec(line);
  // not set up for this user, or no PIN / sensor: Hello can't confirm anyone here
  if (unavailable) return { kind: 'unavailable', why: unavailable[1]! };
  const result = /^result:(\w{1,40})$/.exec(line);
  return { kind: 'failed', why: result ? result[1]! : 'no_answer' };
}

export type RunScript = (script: string, env: Record<string, string>) => Promise<string>;

/**
 * Windows' own System32 folder: where Windows itself loaded ntdll.dll into this process from. Never taken from the
 * environment (PATH, SystemRoot) or the working folder, which whoever starts the app can point anywhere: a
 * powershell.exe of their own that prints "result:Verified" would reset an admin without Windows Hello.
 */
export function systemFolder(loaded: () => readonly string[] = loadedLibraries): string | null {
  try {
    const ntdll = loaded().find((file) => /^[a-z]:\\.+\\ntdll\.dll$/i.test(file));
    return ntdll ? dirname(ntdll) : null;
  } catch {
    return null;
  }
}

function loadedLibraries(): readonly string[] {
  const report = (process as { report?: { getReport(): unknown } }).report?.getReport() as { sharedObjects?: unknown } | undefined;
  return Array.isArray(report?.sharedObjects) ? report.sharedObjects.filter((f): f is string => typeof f === 'string') : [];
}

const runPowerShell: RunScript = (script, env) => new Promise((resolve, reject) => {
  const system = systemFolder();
  if (!system) { reject(new Error('no_system_folder')); return; }
  const windows = dirname(system);
  // Windows PowerShell by its full path, with none of this process's environment (no PATH, no PSModulePath)
  execFile(join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { SystemRoot: windows, windir: windows, ...env }, cwd: system, windowsHide: true, timeout: 180_000, encoding: 'utf8'
  }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
});

/** Asks Windows Hello to confirm the person at this PC; never throws. */
export async function confirmWithHello(message: string, run: RunScript = runPowerShell): Promise<HelloResult> {
  if (process.platform !== 'win32' && run === runPowerShell) return { kind: 'unavailable', why: 'not_windows' };
  try {
    return parseHelloOutput(await run(HELLO_SCRIPT, { QASA_HELLO_MESSAGE: message.slice(0, 200) }));
  } catch (error) {
    return { kind: 'failed', why: error instanceof Error ? error.message.slice(0, 120) : 'error' };
  }
}

export type ResetAnswer = { ok: boolean; error?: string; retryAfterSeconds?: number };

/**
 * File → Reset admin password "as the Windows user on this PC": Windows Hello must say Verified, or nothing is reset.
 * Without Hello (not set up, no PIN or sensor), cancelled or failed, the server process is told only so it can write
 * the try to the audit log, and the window says why (with no Hello here: use the recovery code).
 */
export async function resetWithWindows(
  input: { username: string; password: string; windowsUser: string; computer: string },
  confirm: () => Promise<HelloResult>,
  ask: (request: Record<string, unknown>) => Promise<ResetAnswer>
): Promise<ResetAnswer> {
  const hello = await confirm();
  const base = { username: input.username, windowsUser: input.windowsUser, computer: input.computer };
  if (hello.kind === 'verified') return ask({ mode: 'windows', ...base, password: input.password, method: 'windows_hello' });
  const outcome = hello.kind === 'unavailable' ? 'hello_unavailable' : hello.kind === 'cancelled' ? 'cancelled' : 'windows_failed';
  await ask({ mode: 'windows_unconfirmed', ...base, outcome }).catch(() => undefined);
  return { ok: false, error: outcome };
}

/**
 * The Windows user as the audit log writes it: PC\name, never empty. The name is the signed-in account's own
 * (os.userInfo(), read from the process's Windows token) and the PC's its own (os.hostname()), never the USERNAME or
 * USERDOMAIN variables: whoever starts the app sets those, and could make the audit log name somebody else.
 */
export function windowsAccount(user: string, computer: string): string {
  const name = (user ?? '').trim() || 'unknown';
  const pc = (computer ?? '').trim();
  return (pc ? `${pc}\\${name}` : name).slice(0, 100);
}
