import { createContext, useContext } from 'react';
import type { Party, Warehouse } from './api';
import type { CartLine, CountLine } from './documents';
import type { StockLine } from './staff/stock';

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
  /** 1.1: the stock being moved between two warehouses (until sent) */
  transfer: StockLine[];
  setTransfer(lines: StockLine[]): void;
  transferWarehouses: { from: string | null; to: string | null };
  setTransferWarehouses(w: { from: string | null; to: string | null }): void;
  /** 1.1: what arrived of a purchase order, being counted (until sent) */
  arrival: { orderId: string; lines: StockLine[] } | null;
  setArrival(a: { orderId: string; lines: StockLine[] } | null): void;
}

export const ListsCtx = createContext<Lists | null>(null);
export function useLists(): Lists {
  const l = useContext(ListsCtx);
  if (!l) throw new Error('outside the app');
  return l;
}
