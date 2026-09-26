import type { Database as SqlJsDatabase, SqlValue } from 'sql.js';

/**
 * Stands in for `node:sqlite` in the website demo. It gives the server's code the few calls it uses
 * (exec, prepare → run / get / all) on top of sql.js, SQLite compiled to WebAssembly.
 */
type Param = SqlValue | boolean | undefined;

const toSql = (value: Param): SqlValue => (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value);

class StatementSync {
  constructor(private readonly db: SqlJsDatabase, private readonly sql: string) {}

  private use<T>(params: Param[], fn: (stmt: ReturnType<SqlJsDatabase['prepare']>) => T): T {
    const stmt = this.db.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params.map(toSql));
      return fn(stmt);
    } finally {
      stmt.free();
    }
  }

  run(...params: Param[]): { changes: number; lastInsertRowid: number } {
    this.use(params, (stmt) => { while (stmt.step()) { /* run to completion */ } });
    return { changes: this.db.getRowsModified(), lastInsertRowid: 0 };
  }

  get(...params: Param[]): Record<string, SqlValue> | undefined {
    return this.use(params, (stmt) => (stmt.step() ? stmt.getAsObject() : undefined));
  }

  all(...params: Param[]): Record<string, SqlValue>[] {
    return this.use(params, (stmt) => {
      const rows: Record<string, SqlValue>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    });
  }
}

export class DatabaseSync {
  private readonly db: SqlJsDatabase;

  constructor(source: string | SqlJsDatabase) {
    if (typeof source === 'string') throw new Error('Files are not available in the browser demo');
    this.db = source;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this.db, sql);
  }

  close(): void {
    this.db.close();
  }
}
