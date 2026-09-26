import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// `vite build --mode demo` builds the website demo: the API runs in the browser on SQLite (WebAssembly),
// so the server's Node-only imports are swapped for small browser versions.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: [react()],
    base: demo ? './' : '/',
    resolve: demo
      ? { alias: { 'node:sqlite': local('./src/demo/node-sqlite.ts'), 'node:crypto': local('./src/demo/node-crypto.ts') } }
      : {},
    build: demo ? { outDir: 'dist-demo', emptyOutDir: true, chunkSizeWarningLimit: 1500 } : {},
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:4417'
      }
    }
  };
});
