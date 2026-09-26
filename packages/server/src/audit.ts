import type { Db } from './db.ts';

export interface AuditRow {
  id: number;
  at: string;
  user: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
}

export function audit(db: Db, user: string, action: string, entity: string, entityId: string | null, details?: unknown): void {
  db.prepare('INSERT INTO audit_log (at, user, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), user, action, entity, entityId, details === undefined ? null : JSON.stringify(details));
}

export function listAudit(db: Db, limit = 200): AuditRow[] {
  const rows = db.prepare('SELECT id, at, user, action, entity, entity_id, details FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as {
    id: number; at: string; user: string; action: string; entity: string; entity_id: string | null; details: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, at: r.at, user: r.user, action: r.action, entity: r.entity, entityId: r.entity_id, details: r.details ? JSON.parse(r.details) : null }));
}
