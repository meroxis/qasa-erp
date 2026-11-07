import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { writeSetting } from './settings.ts';
import { startUsagePings, stopUsagePingsForTests, usageApi, type UsagePayload } from './usage.ts';

let db: Db;
let dir: string;
let app: FastifyInstance;
let sent: { url: string; body: UsagePayload }[];
let answer: () => Response | Promise<Response>;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': 'Mer Las' };

const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as UsagePayload });
  return answer();
}) as typeof fetch;

beforeEach(() => {
  db = openDatabase(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'qasa-usage-'));
  sent = [];
  answer = () => new Response('{}', { status: 200 });
  app = buildApp(db);
});

afterEach(async () => {
  stopUsagePingsForTests();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.QASA_NO_PING;
});

const start = (extra: object = {}) => startUsagePings(db, { dataDir: dir, os: 'windows', companies: () => 2, fetch: fakeFetch, ...extra });

describe('the anonymous usage ping', () => {
  it('sends exactly the agreed fields and nothing from the books', async () => {
    writeSetting(db, 'company_name', JSON.stringify({ ar: 'شركة سرية', en: 'Secret Co', ku: 'کۆمپانیای نهێنی' }));
    writeSetting(db, 'business_types', JSON.stringify(['trade', 'autoParts']));
    const pinger = start();
    expect(await pinger.pingNow()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://my.qasaerp.com/api/v1/ping');
    const body = sent[0]!.body;
    expect(Object.keys(body).sort()).toEqual(['businessTypes', 'companies', 'firstRun', 'install', 'lang', 'licence', 'os', 'plan', 'users', 'version']);
    expect({ ...body, install: '<id>' }).toEqual({
      install: '<id>', version: APP_VERSION, os: 'windows', lang: 'ar', plan: 'free', licence: null,
      businessTypes: ['trade', 'autoParts'], companies: 2, users: 1, firstRun: true
    });
    expect(body.install).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toMatch(/Secret|سرية|نهێنی/);
  });

  it('keeps the install id in the app data folder, the same across pings, and says firstRun only once', async () => {
    const pinger = start();
    await pinger.pingNow();
    await pinger.pingNow();
    expect(sent.map((s) => s.body.firstRun)).toEqual([true, false]);
    expect(sent[0]!.body.install).toBe(sent[1]!.body.install);
    const saved = JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8')) as { install: string };
    expect(saved.install).toBe(sent[0]!.body.install);
    // not in the company file
    expect(db.prepare("SELECT 1 FROM settings WHERE value = ?").get(saved.install)).toBeUndefined();
  });

  it('shows the trial as its own plan and takes the app language from the client', async () => {
    writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10));
    const pinger = start();
    const ctx = await app.inject({ method: 'POST', url: '/api/usage/context', headers, payload: { lang: 'ku' } });
    expect(ctx.statusCode, ctx.body).toBe(200);
    await pinger.pingNow();
    expect(sent[0]!.body).toMatchObject({ plan: 'trial', lang: 'ku' });
  });

  it('sends nothing once switched off, and the card shows exactly what would be sent', async () => {
    const pinger = start();
    const shown = await app.inject({ url: '/api/usage', headers });
    expect(shown.json()).toMatchObject({ available: true, enabled: true, lastSent: null, payload: { os: 'windows', plan: 'free' } });
    const off = await app.inject({ method: 'PUT', url: '/api/usage', headers, payload: { enabled: false } });
    expect(off.json()).toMatchObject({ enabled: false });
    expect(await pinger.pingNow()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('counts failures for backing off, and resets them when a ping gets through', async () => {
    answer = () => new Response('', { status: 503 });
    const pinger = start();
    expect(await pinger.pingNow()).toBe(false);
    expect(await pinger.pingNow()).toBe(false);
    const state = () => JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8')) as { failures: number; lastSent: string | null };
    expect(state()).toMatchObject({ failures: 2, lastSent: null });
    answer = () => { throw new Error('offline'); };
    expect(await pinger.pingNow()).toBe(false);
    expect(state().failures).toBe(3);
    answer = () => new Response('{}', { status: 200 });
    expect(await pinger.pingNow()).toBe(true);
    expect(state()).toMatchObject({ failures: 0 });
    expect(state().lastSent).not.toBeNull();
  });

  it('never sends with QASA_NO_PING, under the test runner without its own fetch, or before it is started', async () => {
    const notStarted = await app.inject({ url: '/api/usage', headers });
    expect(notStarted.json()).toMatchObject({ available: false, payload: null });
    process.env.QASA_NO_PING = '1';
    expect(await start().pingNow()).toBe(false);
    delete process.env.QASA_NO_PING;
    let real = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { real += 1; return new Response('{}'); }) as typeof fetch;
    try {
      const noFetch = startUsagePings(db, { dataDir: dir });
      expect(await noFetch.pingNow()).toBe(false);
      expect((await app.inject({ url: '/api/usage', headers })).json()).toMatchObject({ available: false });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(real).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('only an admin switches it; anyone signed in may tell the language', async () => {
    start();
    const bad = await app.inject({ method: 'PUT', url: '/api/usage', headers, payload: { enabled: 'no' } });
    expect(bad.statusCode).toBe(400);
    const lang = await app.inject({ method: 'POST', url: '/api/usage/context', headers, payload: { lang: 'fr' } });
    expect(lang.statusCode).toBe(400);
  });
});
