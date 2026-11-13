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
        // Written out, not as the 'http://…' shorthand: Vite turns the shorthand into changeOrigin: true, which replaces
        // the request's Host header with the target's (127.0.0.1:4417). The server takes a change only when its Origin
        // names the Host it was sent to (requestRefusal in packages/server/src/app.ts), so every save from this page
        // was refused (403, reason "origin"). With the browser's Host kept, the server sees localhost:5173 in both.
        '/api': { target: 'http://127.0.0.1:4417', changeOrigin: false }
      }
    }
  };
});
