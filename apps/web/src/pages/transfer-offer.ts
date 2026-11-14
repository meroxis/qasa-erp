/**
 * What Stock documents offers for "New transfer". A transfer needs two warehouses:
 * - two or more: the form;
 * - one, and the plan allows only one: the plan is what is missing. The link to Plans is for someone who can open
 *   that page (an admin); anyone else reads why, with no button that would land on Home;
 * - one, and the plan allows more: a second warehouse is what is missing. The link to add one is for someone who may
 *   add a warehouse; anyone else reads it as plain text.
 */
export type TransferOffer = 'form' | 'plan-link' | 'plan-note' | 'add-link' | 'add-note';

export function transferOffer(o: {
  /** active warehouses now */
  warehouses: number;
  /** how many the plan allows (null: any number; undefined: not known yet, taken as more than one) */
  planWarehouses: number | null | undefined;
  /** may open Plans and licence */
  mayOpenPlans: boolean;
  /** may add a warehouse */
  mayAddWarehouse: boolean;
}): TransferOffer {
  if (o.warehouses >= 2) return 'form';
  const planHasMore = o.planWarehouses === null || o.planWarehouses === undefined || o.planWarehouses > 1;
  if (!planHasMore) return o.mayOpenPlans ? 'plan-link' : 'plan-note';
  return o.mayAddWarehouse ? 'add-link' : 'add-note';
}
