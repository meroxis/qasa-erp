/**
 * The Visual C++ runtime files a Windows addon asks Windows for, by the names in its import table (plain text in the
 * file). None of them is in Windows itself, so an addon that names one does not load on a new PC: the addon is built
 * with the runtime inside it (.cargo/config.toml), and build.mjs stops a Windows build that still names one.
 */
export function vcRuntimeNeeded(file) {
  const text = file.toString('latin1');
  const names = text.match(/(?:vcruntime\d+(?:_\d+)?|msvcp\d+(?:_\d+)?|api-ms-win-crt-[a-z0-9-]+)\.dll/gi) ?? [];
  return [...new Set(names.map((n) => n.toLowerCase()))].sort();
}
