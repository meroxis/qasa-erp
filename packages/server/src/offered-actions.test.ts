import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ACTIONS, may, type Action } from '../../../apps/web/src/may.ts';
import { buildApp } from './app.ts';
import { permissionsOf, resetLoginThrottle, ROLES, type Role } from './auth.ts';
import { openDatabase, type Db } from './db.ts';

// The app offers a button, a menu row or a form only when `may` (apps/web/src/may.ts) says the person signed in may
// do the action. This sends the request each action stands for as a user of every role and compares the server's own
// answer with `may`: refused (403) exactly when the app would not have offered it. The table in may.ts therefore
// cannot drift from the rules the server enforces.

let db: Db;
let app: FastifyInstance;
type Headers = Record<string, string>;
const owner: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const session = new Map<Role, Headers>();

async function signIn(username: string, password: string): Promise<Headers> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
}

beforeAll(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  const post = (url: string, payload: object, method: 'POST' | 'PUT' = 'POST') => app.inject({ method, url, payload, headers: owner });
  // roles are part of the paid plans: the free month has them
  expect((await post('/api/plan/trial', {})).statusCode).toBe(200);
  const first = (await app.inject({ url: '/api/users', headers: owner })).json()[0] as { id: string; username: string };
  expect((await post(`/api/users/${first.id}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
  const others = ROLES.filter((r) => r !== 'admin');
  for (const [i, role] of others.entries()) {
    const made = await post('/api/users', { username: `user${i}`, name: ['Mer', 'Las', 'Raz'][i % 3]!, password: `user${i}-pass-123`, roles: [role] });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await post('/api/auth/signin', { on: true }, 'PUT')).statusCode).toBe(200);
  session.set('admin', await signIn(first.username, 'admin-pass-123'));
  for (const [i, role] of others.entries()) session.set(role, await signIn(`user${i}`, `user${i}-pass-123`));
});

afterAll(async () => {
  await app.close();
  db.close();
});

it('answers every action the app can offer as the app expects, for every role', async () => {
  const wrong: string[] = [];
  for (const role of ROLES) {
    const permissions = permissionsOf([role]);
    for (const action of Object.keys(ACTIONS) as Action[]) {
      const spec: { needs: string; route: string; body?: Record<string, string> } = ACTIONS[action];
      const [method, path] = spec.route.split(' ') as ['POST' | 'PUT', string];
      const res = await app.inject({ method, url: path.replace(/:[a-z]+/gi, 'none'), payload: spec.body ?? {}, headers: session.get(role)! });
      // allowed: the server goes on to the request itself (and finds this empty one invalid, or its record missing)
      const refused = res.statusCode === 403;
      expect(res.statusCode, `${role} ${spec.route}: ${res.body}`).not.toBe(401);
      if (refused === may(permissions, action)) wrong.push(`${role} ${action} (${spec.route}): the server answered ${res.statusCode}, the app ${may(permissions, action) ? 'offers' : 'hides'} it`);
    }
  }
  expect(wrong).toEqual([]);
});

it('names a real route for every action', async () => {
  const unknown = await app.inject({ method: 'POST', url: '/api/no-such-route', payload: {}, headers: session.get('admin')! });
  expect(unknown.body).toMatch(/Route .* not found/);
  // as the admin nothing is refused, and nothing is unknown to the server
  for (const action of Object.keys(ACTIONS) as Action[]) {
    const spec: { route: string; body?: Record<string, string> } = ACTIONS[action];
    const [method, path] = spec.route.split(' ') as ['POST' | 'PUT', string];
    const res = await app.inject({ method, url: path.replace(/:[a-z]+/gi, 'none'), payload: spec.body ?? {}, headers: session.get('admin')! });
    expect(res.statusCode, `${spec.route}: ${res.body}`).not.toBe(403);
    // (an address the server does not know answers 404 'Route … not found': a record that is missing is another 404)
    expect(res.body, spec.route).not.toMatch(/Route .* not found/);
  }
});
