import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { chequesAhead } from './banking.ts';

let db: Db;
let app: FastifyInstance;
let partyId: string;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const day = (offset: number) => new Date(Date.parse(todayIso() + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
let n = 0;

function cheque(status: string, due: string, opts: { direction?: 'received' | 'issued'; updatedAt?: string; amount?: number; currency?: 'IQD' | 'USD' } = {}) {
  n += 1;
  const now = opts.updatedAt ?? new Date().toISOString();
  db.prepare(`INSERT INTO cheques (id, direction, number, bank, party_id, currency, amount, issue_date, due_date, status, created_by, created_at, updated_at)
              VALUES (?, ?, ?, 'Rafidain', ?, ?, ?, ?, ?, ?, 'test', ?, ?)`)
    .run(`c${n}`, opts.direction ?? 'received', `00${n}`, partyId, opts.currency ?? 'IQD', opts.amount ?? 1_000_000, day(-40), due, status, now, now);
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  partyId = (await app.inject({ method: 'POST', url: '/api/parties', headers, payload: { type: 'customer', name: 'Sanos Company', phone: '07501234567' } })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('cheques ahead (Daily Brief and home)', () => {
  it('lists open cheques due within a week, late ones first, and bounces of the last 30 days', () => {
    cheque('in_hand', day(3), { amount: 2_000_000 });
    cheque('deposited', day(-2));
    cheque('pending', day(6), { direction: 'issued', currency: 'USD', amount: 50_000 });
    cheque('in_hand', day(20));                       // too far ahead
    cheque('cleared', day(1));                        // done
    cheque('bounced', day(-5));                       // bounced now
    cheque('bounced', day(-60), { updatedAt: new Date(Date.now() - 45 * 86_400_000).toISOString() }); // an old bounce
    const r = chequesAhead(db, todayIso());
    expect(r.due.map((c) => c.dueDate)).toEqual([day(-2), day(3), day(6)]);
    expect(r.due[0]).toMatchObject({ daysLate: 2, party: 'Sanos Company', phone: '07501234567' });
    expect(r.due[2]).toMatchObject({ direction: 'issued', currency: 'USD', daysLate: 0 });
    expect(r.dueTotal).toEqual({ IQD: 3_000_000, USD: 50_000 });
    expect(r.bounced).toHaveLength(1);
  });

  it('shows in the Daily Brief and the dashboard', async () => {
    cheque('in_hand', day(-1));
    cheque('bounced', day(-3));
    const brief = (await app.inject({ url: '/api/brief', headers })).json();
    expect(brief.cheques.due).toHaveLength(1);
    expect(brief.cheques.bounced).toHaveLength(1);
    const dash = (await app.inject({ url: '/api/brief/dashboard', headers })).json();
    expect(dash.cheques).toMatchObject({ due: 1, late: 1, bounced: 1, dueTotal: { IQD: 1_000_000, USD: 0 } });
  });
});
