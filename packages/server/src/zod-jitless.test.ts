// The browser build (the website demo) runs under a CSP without 'unsafe-eval': zod must never probe new Function there.
import { readFileSync } from 'node:fs';
import { globalConfig, util } from 'zod/v4/core';
import { expect, it } from 'vitest';

// on a database server run (QASA_TEST_DB) the setup has loaded the server, and its schemas, before this file: the
// browser entry's load order can only be seen in a fresh module graph, as in the plain run
it.skipIf(!!process.env.QASA_TEST_DB)('the browser entry switches zod to jitless before any schema is made', async () => {
  const source = readFileSync(new URL('./browser.ts', import.meta.url), 'utf8');
  const requests = [...source.matchAll(/^(?:import|export)\b[^;]*?'([^']+)';/gm)].map((m) => m[1]);
  expect(requests[0]).toBe('./zod-jitless.ts');
  await import('./browser.ts');
  expect(globalConfig.jitless).toBe(true);
  // with jitless the eval probe is never run, so a strict CSP sees no violation
  expect(util.allowsEval.value).toBe(false);
});
