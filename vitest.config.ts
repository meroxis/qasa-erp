import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// QASA_TEST_DB=mariadb|mysql runs the suite on a database server (Pro, see pro/src/mysql/vitest-global.ts)
const onServer = !!process.env.QASA_TEST_DB && existsSync('pro/src/mysql/vitest-setup.ts');

export default defineConfig({
  // the Windows app's server process imports the Pro module by this name; tests use the public stand-in
  resolve: { alias: { '@qasa/pro-module': new URL('./apps/desktop/src/pro-none.ts', import.meta.url).pathname } },
  test: {
    // pro/ is the private Pro module, present only in Meroxis' checkout
    include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx', 'apps/desktop/src/**/*.test.ts', 'pro/src/**/*.test.ts'],
    environment: 'node',
    ...(onServer ? { globalSetup: ['pro/src/mysql/vitest-global.ts'], setupFiles: ['pro/src/mysql/vitest-setup.ts'], testTimeout: 60_000, hookTimeout: 60_000 } : {})
  }
});
