/**
 * What the person signed in may change, read from the same permissions the server checks. A menu row, a tile or a
 * button is offered only when its action is one the server would accept from this person: nothing is decided by a
 * role's name here, only by the permissions the server sent with the sign-in.
 *
 * Each action names the permission the server asks for it (packages/server/src/routes.ts RULES, and the `rules` of
 * each feature) and one request it stands for; a server test sends that request as every role and compares the answer
 * with `may` (packages/server/src/offered-actions.test.ts), so this table cannot drift from the server. (That test is
 * why this file imports nothing of the app: nav.ts checks that every `needs` is a permission the server has.)
 */
export const ACTIONS = {
  // sales
  sale: { needs: 'sales', route: 'POST /api/invoices', body: { kind: 'sale' } },
  customer: { needs: 'sales', route: 'POST /api/parties', body: { type: 'customer' } },
  quote: { needs: 'sales', route: 'POST /api/quotes' },
  till: { needs: 'sales', route: 'POST /api/pos/shifts' },
  // purchases
  purchase: { needs: 'purchases', route: 'POST /api/invoices', body: { kind: 'purchase' } },
  supplier: { needs: 'purchases', route: 'POST /api/parties', body: { type: 'supplier' } },
  purchaseOrder: { needs: 'purchases', route: 'POST /api/purchase-orders' },
  // stock: items with their categories, brands, pictures and prices, stock documents, adjustments and counts
  item: { needs: 'stock', route: 'POST /api/items' },
  stockDoc: { needs: 'stock', route: 'POST /api/stock-docs' },
  adjustment: { needs: 'stock', route: 'POST /api/adjustments' },
  writeOff: { needs: 'stock', route: 'POST /api/batches/write-off' },
  // the journal: vouchers and entries, transfers, cheques and bank statements, the dollar rate
  voucher: { needs: 'entries.prepare', route: 'POST /api/vouchers' },
  banking: { needs: 'entries.prepare', route: 'POST /api/banking/transfers' },
  rate: { needs: 'entries.prepare', route: 'POST /api/fx/rates' },
  // the company itself: every change the server lists no rule for needs an admin
  account: { needs: 'admin', route: 'POST /api/accounts' },
  warehouse: { needs: 'admin', route: 'POST /api/warehouses' },
  moneyAccount: { needs: 'admin', route: 'PUT /api/banking/accounts/:code' },
  importPage: { needs: 'admin', route: 'POST /api/import' },
  companyDetails: { needs: 'admin', route: 'PUT /api/settings' },
  users: { needs: 'admin', route: 'POST /api/users' },
  // the daily brief's own settings: the owner's WhatsApp number (and where each quick expense goes)
  briefSettings: { needs: 'admin', route: 'PUT /api/brief/settings' }
} as const satisfies Record<string, { needs: string; route: string; body?: Record<string, string> }>;

/**
 * The industry pages (Pro and Business). Their rules are in the Pro module, which is not part of this repository, so no
 * test here can send these requests: each line states the permission the Pro route asks and names the route it
 * mirrors (the `rules` of pro/src/<feature>/api.ts; a change those rules do not list needs an admin, as in the core).
 * What a record offers once it is open (sell, collect, deliver, cancel…) comes from the server with the record itself,
 * as its `actions`; these are the buttons shown before any record is open, and the few the records do not cover.
 */
export const PRO_ACTIONS = {
  // pro/src/realestate/api.ts: POST /api/real-estate/projects is not in its rules (reserving and selling are 'sales')
  reProject: { needs: 'admin', route: 'POST /api/real-estate/projects' },
  // pro/src/installments/api.ts: POST /api/installments (and PUT, collect and cancel of a contract)
  installment: { needs: 'sales', route: 'POST /api/installments' },
  // pro/src/installments/api.ts: POST /api/guarantors (and PUT and DELETE /api/guarantors/:id)
  guarantor: { needs: 'sales', route: 'POST /api/guarantors' },
  // pro/src/pipeline/api.ts: POST /api/pipeline/deals (and every other change of a deal)
  deal: { needs: 'sales', route: 'POST /api/pipeline/deals' },
  // pro/src/mobile/api.ts: POST /api/mobile/serials (and POST /api/mobile/serials/:id/status)
  mobSerial: { needs: 'stock', route: 'POST /api/mobile/serials' },
  // pro/src/mobile/api.ts: POST /api/mobile/sales/:id/serials
  mobAssign: { needs: 'sales', route: 'POST /api/mobile/sales/:id/serials' },
  // pro/src/mobile/api.ts: POST /api/mobile/trade-in
  mobTradeIn: { needs: 'purchases', route: 'POST /api/mobile/trade-in' },
  // pro/src/mobile/api.ts: POST /api/mobile/repairs (and every other change of a repair)
  mobRepair: { needs: 'sales', route: 'POST /api/mobile/repairs' },
  // pro/src/parts/api.ts: PUT /api/parts/:id (and POST /api/parts/import)
  partData: { needs: 'stock', route: 'PUT /api/parts/:id' },
  // pro/src/works/api.ts: POST /api/works/jobs (linking a job's costs is 'purchases': the job says so in its `actions`)
  job: { needs: 'sales', route: 'POST /api/works/jobs' },
  // pro/src/solar/api.ts: POST /api/solar/systems (and its equipment, its sale, the plans and the visits)
  solarSystem: { needs: 'sales', route: 'POST /api/solar/systems' },
  // pro/src/generators/api.ts: POST /api/generators/subscribers (and bulk, PUT, status, POST /api/generators/collections)
  genSubscriber: { needs: 'sales', route: 'POST /api/generators/subscribers' },
  // pro/src/generators/api.ts: POST /api/generators/runs (and PUT, post, unpost, reverse, DELETE; PUT /api/generators/settings)
  genRun: { needs: 'admin', route: 'POST /api/generators/runs' },
  // pro/src/pharmacy/api.ts: PUT /api/pharmacy/items/:id
  medicine: { needs: 'stock', route: 'PUT /api/pharmacy/items/:id' },
  // pro/src/pharmacy/api.ts: GET /api/pharmacy/controlled and PUT /api/pharmacy/controlled/:invoiceId/:lineNo
  // (correcting a line already recorded needs an admin: pro/src/pharmacy/service.ts)
  controlled: { needs: 'sales', route: 'PUT /api/pharmacy/controlled/:invoiceId/:lineNo' }
} as const satisfies Record<string, { needs: string; route: string }>;

export type Action = keyof typeof ACTIONS | keyof typeof PRO_ACTIONS;

const NEEDS: Record<Action, { needs: string }> = { ...ACTIONS, ...PRO_ACTIONS };

/** The permission the server asks for an action. */
export const needs = (action: Action): string => NEEDS[action].needs;

/** Whether someone with these permissions may do this (the server decides again on every request). */
export function may(permissions: readonly string[] | undefined, action: Action): boolean {
  // (an admin has every permission on the server: auth.ts ROLE_PERMISSIONS)
  return !!permissions && (permissions.includes('admin') || permissions.includes(NEEDS[action].needs));
}

/** Whether they may do at least one of these. */
export function mayAny(permissions: readonly string[] | undefined, actions: readonly Action[]): boolean {
  return actions.some((a) => may(permissions, a));
}

/**
 * The pages that are only a form for one action: opened for someone who may do it, otherwise the address lands on the
 * home page (the form would be filled in and then refused). `arg` is the first part after the page in the address.
 */
export function routeAction(page: string, arg?: string): Action | null {
  switch (page) {
    case 'new-invoice': return arg === 'purchase' ? 'purchase' : 'sale';
    case 'new-quote': case 'edit-quote': return 'quote';
    case 'pos': return 'till';
    case 'new-purchase-order': case 'edit-purchase-order': return 'purchaseOrder';
    case 'new-stock-doc': case 'edit-stock-doc': return 'stockDoc';
    case 'new-stock-adjustment': case 'edit-stock-adjustment': case 'stock-count': return 'adjustment';
    case 'new': case 'edit': return 'voucher';
    case 'new-installment': return 'installment';
    // the two builders of the solar page (a new system, a wiring quotation); its other tabs are read
    case 'solar': return arg === 'new' || arg === 'electrical' ? 'solarSystem' : null;
    default: return null;
  }
}
