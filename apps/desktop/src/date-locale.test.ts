import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// 2.0.0: Iraqi PCs often run US Windows settings, and the date boxes showed 11/20/2026; the app writes its own dates
it('starts Chromium in a day/month/year locale for the date boxes, unless one was given', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  expect(main).toContain("if (!app.commandLine.hasSwitch('lang')) app.commandLine.appendSwitch('lang', 'en-GB');");
});
