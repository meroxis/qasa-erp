/**
 * Where one screen's time goes on a big company (a developer's tool, never shipped):
 *   npx tsx packages/server/bench/profile-url.ts /tmp/qasa-big.sqlite '/api/reports/trial-balance' ['POST' '{json}']
 * Prints the functions that take the time (with what called them), from a CPU profile of two calls.
 */
import { Session } from 'node:inspector/promises';
import { openDatabase } from '../src/db.ts';
import { buildApp } from '../src/app.ts';

const [file = '/tmp/qasa-big.sqlite', url = '/api/items?active=true', method = 'GET', body] = process.argv.slice(2);
const db = openDatabase(file);
const app = buildApp(db);
const headers = { 'x-qasa-client': '1' };
const call = () => app.inject({ method: method as 'GET', url, headers, ...(body ? { payload: JSON.parse(body) as object } : {}) });
await call();
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 200 });
await session.post('Profiler.start');
const t0 = performance.now();
await call();
const res = await call();
const ms = (performance.now() - t0) / 2;
const { profile } = await session.post('Profiler.stop');
console.log(`${method} ${url}: ${ms.toFixed(0)} ms, ${res.statusCode}, ${(res.body.length / 1024).toFixed(0)} KB`);

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };
const nodes = new Map<number, Node>((profile.nodes as Node[]).map((n) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of nodes.values()) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map<number, number>();
profile.samples!.forEach((s, i) => self.set(s, (self.get(s) ?? 0) + profile.timeDeltas![i]!));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const name = (id: number) => {
  const f = nodes.get(id)!.callFrame;
  return `${f.functionName || '(anon)'}@${f.url.split('/').pop()}:${f.lineNumber + 1}`;
};
// time spent in our own code, inclusive, per function
const inclusive = new Map<string, number>();
for (const [id, t] of self) {
  const seen = new Set<string>();
  for (let x: number | undefined = id; x !== undefined; x = parent.get(x)) {
    const n = name(x);
    if (!n.includes('.ts:') || seen.has(n)) continue;
    seen.add(n);
    inclusive.set(n, (inclusive.get(n) ?? 0) + t);
  }
}
console.log('\nown code, inclusive:');
for (const [n, t] of [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`${((t / total) * 100).toFixed(1).padStart(5)}%  ${n}`);
// what the time is spent on at the bottom (a database call, JSON, …) and who made it
const bottom = new Map<string, number>();
for (const [id, t] of self) {
  const callers: string[] = [];
  for (let x = parent.get(id); x !== undefined && callers.length < 2; x = parent.get(x)) if (name(x).includes('.ts:')) callers.push(name(x));
  const k = `${name(id)} <- ${callers.join(' <- ')}`;
  bottom.set(k, (bottom.get(k) ?? 0) + t);
}
console.log('\nat the bottom:');
for (const [n, t] of [...bottom].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${((t / total) * 100).toFixed(1).padStart(5)}%  ${n}`);
await app.close();
db.close();
