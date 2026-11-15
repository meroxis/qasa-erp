/**
 * What a screen keeps in memory of what it read from the office last (1.1: the safes and banks of the expense form),
 * so it still works when the link drops. It belongs to the office the phone is paired with: kept under that office (its
 * key and this phone's id there), never read for another, and gone when the phone is unpaired or the office removes it
 * (App.tsx). Nothing here is written to the phone's storage.
 */

let scope: string | null = null;
const kept = new Map<string, unknown>();

/** Which office the phone is paired with now (null: none, or the office removed this phone). */
export function officeScope(office: { serverKey: string; deviceId: string | null } | null | undefined): string | null {
  return office?.deviceId ? `${office.serverKey}|${office.deviceId}` : null;
}

/** The office the phone is paired with now: another one (or none) forgets everything kept for the last. */
export function setOfficeScope(next: string | null): void {
  if (next === scope) return;
  kept.clear();
  scope = next;
}

/** Unpairing: everything kept is gone. */
export function forgetOffice(): void {
  kept.clear();
  scope = null;
}

/** Keeps what was read from the office paired now (nothing is kept while none is). */
export function remember<T>(name: string, value: T): void {
  if (scope) kept.set(`${scope}#${name}`, value);
}

/** What was kept of this office (null: nothing, or another office's). */
export function recall<T>(name: string): T | null {
  return scope ? ((kept.get(`${scope}#${name}`) as T | undefined) ?? null) : null;
}
