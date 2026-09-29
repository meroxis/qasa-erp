import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // pro/ is the private Pro module, present only in Meroxis' checkout
    include: ['packages/*/src/**/*.test.ts', 'pro/src/**/*.test.ts'],
    environment: 'node'
  }
});
