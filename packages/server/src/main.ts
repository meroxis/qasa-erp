import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './db.ts';
import { buildApp } from './app.ts';

// Data lives outside the program folder so reinstalling the app never touches it.
// The Windows installer will point this at "D:\Qasa Data" (see the concept plan).
const dataDir = resolve(process.env.QASA_DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));
mkdirSync(dataDir, { recursive: true });
const dbFile = resolve(dataDir, 'qasa.sqlite');

const port = Number(process.env.QASA_PORT ?? 4417);
// 127.0.0.1 = this PC only. Office-server mode will listen on the LAN (0.0.0.0).
const host = process.env.QASA_HOST ?? '127.0.0.1';

const db = openDatabase(dbFile);
// Only this PC's own names are answered (a site pointed at 127.0.0.1 can't reach the books). Serving the office from
// here (QASA_HOST=0.0.0.0) needs the names the other PCs use: QASA_ALLOWED_HOSTS=192.168.1.20,office-pc
const allowedHosts = (process.env.QASA_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
const app = buildApp(db, { allowedHosts });

app.listen({ port, host }).then(() => {
  console.log(`Qasa ERP server running at http://${host}:${port}`);
  console.log(`Database: ${dbFile}`);
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}
