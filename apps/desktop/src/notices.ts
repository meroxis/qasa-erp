// The third-party notices shipped with the Windows app (Settings → About → Legal; app-preload.ts → qasaDesktop.openNotices).
import { join } from 'node:path';

/** The file's name next to app.asar (electron-builder.yml installs it there with extraResources). */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';

/**
 * Opens the installed notices with the PC's own viewer. Always this one file in the app's resources folder: the page
 * gives no path, so nothing else on the PC can be opened this way. True when Windows opened it; false lets the page
 * offer the online copy instead.
 */
export async function openNotices(
  resourcesPath: string,
  openPath: (path: string) => Promise<string>,
  log: (...parts: unknown[]) => void = () => {}
): Promise<boolean> {
  if (!resourcesPath) return false;
  const file = join(resourcesPath, NOTICES_FILE);
  // Electron's shell.openPath answers '' when it opened the file, otherwise the reason
  const problem = await openPath(file).catch((error: unknown) => String(error) || 'error');
  if (problem) log('could not open the third-party notices', file, problem);
  return !problem;
}
