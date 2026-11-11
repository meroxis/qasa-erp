import { createContext, useContext } from 'react';
import type { Party, Warehouse } from './api';
import type { CartLine, CountLine } from './documents';

/** The sale being made and the count being taken, kept by the app while it runs (until sent). */
export interface Lists {
  cart: CartLine[];
  setCart(lines: CartLine[]): void;
  customer: Party | null;
  setCustomer(p: Party | null): void;
  count: CountLine[];
  setCount(lines: CountLine[]): void;
  /** the warehouse picked for sales and counts (the first active one until the user picks) */
  warehouseId: string | null;
  setWarehouseId(id: string): void;
  warehouses: Warehouse[];
}

export const ListsCtx = createContext<Lists | null>(null);
export function useLists(): Lists {
  const l = useContext(ListsCtx);
  if (!l) throw new Error('outside the app');
  return l;
}
