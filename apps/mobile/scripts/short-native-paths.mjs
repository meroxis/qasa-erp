// For a local release build on Windows only (not needed on EAS, Linux or macOS, nor with Windows' long paths on).
//
// Windows stops a path at 260 characters unless long paths are switched on for the PC. CMake names the object file of
// a source that lies outside a library's own folder after the source's whole path, and two of the app's libraries
// (react-native-safe-area-context and react-native-svg) compile their generated code from such a folder: under
// node_modules the names pass 260 and ninja cannot write them. This copies those sources into each library's build
// folder before they are compiled (the same files, compiled the same way), so every path stays short.
//
// It changes node_modules only (npm ci brings the originals back), and runs again harmlessly.
//   node scripts/short-native-paths.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const modules = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const MARK = '# qasa-short-native-paths';

function patch(file, vars) {
  const path = join(modules, file);
  let text = readFileSync(path, 'utf8');
  if (text.includes(MARK)) return false;
  for (const name of vars) {
    const at = text.indexOf(`set(${name} `);
    if (at < 0) throw new Error(`${file}: no set(${name} …) — the library changed; check this script`);
    const end = text.indexOf('\n', at);
    const copy = '${CMAKE_CURRENT_BINARY_DIR}/' + name.toLowerCase();
    text = `${text.slice(0, end + 1)}file(COPY \${${name}}/ DESTINATION ${copy})\nset(${name} ${copy})\n${text.slice(end + 1)}`;
  }
  writeFileSync(path, `${MARK}\n${text}`);
  return true;
}

const done = [
  patch('react-native-safe-area-context/android/src/main/jni/CMakeLists.txt', ['LIB_COMMON_DIR', 'LIB_ANDROID_GENERATED_JNI_DIR']),
  patch('react-native-svg/android/src/main/jni/CMakeLists.txt', ['RNSVG_COMMON_DIR', 'RNSVG_GENERATED_JNI_DIR'])
];
console.log(done.some(Boolean) ? 'short native paths: done' : 'short native paths: already done');
