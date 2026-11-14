import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULE_ROUTES } from '../../../packages/server/src/app.ts';
import { openDatabase } from '../../../packages/server/src/db.ts';
import { apiRoutes, type ApiExtension } from '../../../packages/server/src/routes.ts';

// 1.4.1: a browser build asks only for what its server serves. The server's own route list decides: the app's routes
// (a build without the Pro module, a browser on the office network and the website demo all serve them), the routes
// of a module the server names in /api/auth/me → modules (backups, the office network, phones, a database server,
// medicines, the module's licence check: MODULE_ROUTES), and the Pro module's industry routes. The screens that ask for
// a module's routes (Settings: backups, network, database, phones; the till; Plans; the website API) ask only where the
// server said it serves them.

const src = fileURLToPath(new URL('.', import.meta.url));
const read = (file: string) => readFileSync(join(src, file), 'utf8').replace(/\r\n/g, '\n');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(path);
  }
};
walk(src);

/** Every "/api/…" address written in the app, with "x" for what a page fills in, and the files that write it. */
function addresses(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/['`](\/api\/[^'`?\s]*)/g)) {
      const address = m[1]!.replace(/\$\{[^}]+\}/g, 'x').replace(/\/$/, '');
      out.set(address, (out.get(address) ?? new Set()).add(relative(src, file).replace(/\\/g, '/')));
    }
  }
  return out;
}

/** Whether an address is one of these routes: a route's ":id" takes any part, and so does an "x" the page fills in. */
const matcher = (paths: readonly string[]) => {
  const routes = paths.map((p) => p.split('/'));
  return (address: string) => {
    const parts = address.split('/');
    return routes.some((r) => r.length === parts.length && r.every((seg, i) => seg.startsWith(':') || parts[i] === 'x' || seg === parts[i]));
  };
};
const moduleOf = (address: string): string | null =>
  Object.entries(MODULE_ROUTES).find(([, base]) => address === base || address.startsWith(`${base}/`))?.[0] ?? null;

describe('what a browser build asks its server for', () => {
  it('is a route of the server, of a module the server names, or of the Pro module', async () => {
    const db = openDatabase(':memory:');
    try {
      const own = matcher(apiRoutes(db).map((r) => r.path));
      // the website demo runs the same routes in the page
      expect(apiRoutes(db, { demo: true }).map((r) => `${r.method} ${r.path}`).sort()).toEqual(apiRoutes(db).map((r) => `${r.method} ${r.path}`).sort());
      const proFile = fileURLToPath(new URL('../../../pro/src/api.ts', import.meta.url));
      const pro = existsSync(proFile)
        ? matcher(apiRoutes(db, { extensions: ((await import(/* @vite-ignore */ proFile)) as { proApi: readonly ApiExtension[] }).proApi }).map((r) => r.path))
        : null;
      const unknown: string[] = [];
      for (const [address, where] of addresses()) {
        if (address === '/api' || where.has('demo/backend.ts')) continue;
        if (own(address)) continue;
        // a module's route is never one of the app's own (the server names the module only when it serves it)
        if (moduleOf(address)) continue;
        // the Windows app's own companies (its server process adds them; Companies asks only inside the Windows app)
        if (address === '/api/companies' || address.startsWith('/api/companies/')) continue;
        if (pro ? pro(address) : [...where].every((f) => /^industry\/[a-z-]+-api\.ts$|^api\.ts$/.test(f))) continue;
        unknown.push(`${address} <- ${[...where].join(', ')}`);
      }
      expect(unknown).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('asks for a module\'s routes only in a screen that checks the server serves that module', () => {
    // api.ts: which of its calls reach a module's routes
    const api = read('api.ts');
    const moduleCalls = new Map<string, string>();
    for (const m of api.matchAll(/^ {2}(\w+): \([^)]*\)[^\n]*?['`](\/api\/[^'`?]*)/gm)) {
      const module = moduleOf(m[2]!.replace(/\$\{[^}]+\}/g, 'x'));
      if (module) moduleCalls.set(m[1]!, module);
    }
    expect([...new Set(moduleCalls.values())].sort()).toEqual(['backup', 'database', 'network']);
    // a component rendered only by a parent that read the module's status first
    const nested: Record<string, string> = { RelaySection: 'OfficeNetworkCard', CloudBackup: 'ThisPcBackupCard' };
    const screens = ['pages/Settings.tsx', 'pages/Plans.tsx', 'pages/Pos.tsx', 'pages/WebsiteApi.tsx', 'industry/BackupNotice.tsx', 'industry/PharmacyPrompts.tsx', 'App.tsx'];
    const rxCallersGuarded = () => files.filter((f) => /useRxItems\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('PharmacyPrompts.tsx'))
      .every((f) => /useRxItems\(usePharmacyOn\(\)|const pharmacy = usePharmacyOn\(\);[\s\S]*useRxItems\(pharmacy\)/.test(readFileSync(f, 'utf8')));
    const unguarded: string[] = [];
    let checked = 0;
    for (const file of screens) {
      const source = read(file);
      // the file's top-level declarations, each with its own text
      const blocks = source.split(/\n(?=(?:export )?(?:async )?(?:function|const) )/);
      for (const block of blocks) {
        const name = /^(?:export )?(?:async )?(?:function|const) (\w+)/.exec(block)?.[1] ?? '';
        // a table of calls (cloudApi) defines requests and makes none
        if (/Api$/.test(name)) continue;
        const used = new Set<string>();
        for (const m of block.matchAll(/\bapi\.(\w+)\(/g)) { const module = moduleCalls.get(m[1]!); if (module) used.add(module); }
        for (const m of block.matchAll(/['`](\/api\/[^'`?\s]*)/g)) { const module = moduleOf(m[1]!.replace(/\$\{[^}]+\}/g, 'x')); if (module) used.add(module); }
        if (/\bcloudApi\./.test(block)) used.add('backup');
        if (/\bpharmacyApi\./.test(block)) used.add('pharmacy');
        // the website API's view of the office network (industry/webapi-api.ts: GET /api/network)
        if (/\bwebApiClient\.(network|renewOfficeKey)\(/.test(block)) used.add('network');
        for (const module of used) {
          checked++;
          const guard = new RegExp(`useBuildHas\\('${module}'\\)|buildHas\\(modules, '${module}'\\)`);
          const ok = guard.test(block)
            || (module === 'pharmacy' && /usePharmacyOn\(\)/.test(block))
            // a hook told by its caller whether to ask: useRxItems(usePharmacyOn() …), or useRxItems(pharmacy) after pharmacy = usePharmacyOn()
            || (name === 'useRxItems' && /if \(!on\)/.test(block) && rxCallersGuarded())
            // BackupNoticeBar: told by App whether the build serves backups
            || (name === 'BackupNoticeBar' && /if \(!admin \|\| !served\) return;/.test(block))
            || (nested[name] !== undefined && guard.test(blocks.find((b) => b.includes(`function ${nested[name]}(`)) ?? '') && source.includes(`<${name} `));
          if (!ok) unguarded.push(`${file} ${name || '(top level)'}: ${module}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
    expect(unguarded).toEqual([]);
    expect(read('App.tsx')).toContain("<BackupNoticeBar admin={isAdmin} served={buildHas(modules, 'backup')}");
    // the website API's page asks for the office network's link only where it is served
    expect(read('pages/WebsiteApi.tsx')).toContain("servesNetwork ? webApiClient.network()");
  });
});
