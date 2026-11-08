import { config } from 'zod';

/**
 * In a web browser (the website demo) zod must never try `new Function`: the site's Content-Security-Policy has no
 * 'unsafe-eval', so its JIT probe would raise a securitypolicyviolation on every visit (zod catches it and falls back,
 * but the report still fires). jitless has to be set before the first schema is made, so browser.ts imports this
 * module first. Parsing gives the same results either way.
 */
config({ jitless: true });
