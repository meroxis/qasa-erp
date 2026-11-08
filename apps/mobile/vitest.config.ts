import { defineConfig } from 'vitest/config';

// the app's own tests (the protocol client): plain TypeScript, no React Native needed
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
