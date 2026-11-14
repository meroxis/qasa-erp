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
  importPage: { needs: 'admin', route: 'POST /api/import' }
} as const satisfies Record<string, { needs: string; route: string; body?: Record<string, string> }>;

export type Action = keyof typeof ACTIONS;

/** Whether someone with these permissions may do this (the server decides again on every request). */
export function may(permissions: readonly string[] | undefined, action: Action): boolean {
  // (an admin has every permission on the server: auth.ts ROLE_PERMISSIONS)
  return !!permissions && (permissions.includes('admin') || permissions.includes(ACTIONS[action].needs));
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
    default: return null;
  }
}
